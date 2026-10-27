#!/usr/bin/env python3
"""Scenario S1 (live): one ISO client from the first enquiry to its certification cycle, across every team.

Run against a RUNNING local/CI Axelor; never against production. The earlier probes test each area on
its own; this one follows a single fictional client through all of them, with several users at once, and
checks that every area agrees on the same records at the end. Roles are TEST FIXTURES built from native
permissions (policy D-07 defines the real ones):
  RepA owns the client (intake, conversion, quotation, contract, handover request, documents); RepB is
  another salesperson; Manager reviews; Ops runs operations; Config keeps the handover checklist;
  CertMgr manages certification cycles.
Steps, through the IOETI APIs only (generic /ws/rest is used by the administrator for fixtures and reads):
  1 intake with an Arabic duplicate (another spelling and Arabic-Indic digits) → 409; RepB's own copy allowed
  2 conversion → account, contact, opportunity on the business line; RepB → 404
  3 quotation with lines, a saved version, review sent back for pricing (notice to RepA), revised and
    re-sent; approval stays BLOCKED_BY_POLICY (D-11)
  4 milestones 30/70 with exact amounts; contract with the quotation's lines (same total)
  5 handover refused before activation; activation by SQL (TEST FIXTURE: stands in for the signature,
    D-11); order confirmation by SQL (TEST FIXTURE: D-06/D-11); invoice request for the deposit with its
    exact amount, issuing blocked (D-06)
  6 handover with the configured checklist: incomplete → 422, rework with a reason (notice), the signed
    contract filed as a document and cited as evidence, resubmitted, accepted → exactly one engagement
    (notice); a second acceptance → 409; Ops files the kick-off report on the engagement
  7 certification cycle opened for the converted client; decision BLOCKED_BY_POLICY (D-02)
  8 Account 360, the sales report and every inbox agree exactly with what happened, per caller's rights
  9 a permission removed from RepA's group mid-session takes effect on the next request (no cached
    rights); restored, the record is back
 10 backup taken mid-scenario and restored into a new database: every scenario row is identical
Nothing is sent outside the CRM (the native message queue does not grow). Report: logs/scenario-iso-lifecycle.json.
"""
import base64
import json
import os
import secrets
import subprocess
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import CONTRACT, RESERVED_SEQUENCE, _delete_where, cleanup, delete_contract  # noqa: E402
from db_migrate import CONTAINER, DATABASE, USER as DB_USER, psql  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PARTNER, PRODUCT, COMPANY = "com.axelor.apps.base.db.Partner", "com.axelor.apps.base.db.Product", "com.axelor.apps.base.db.Company"
CURRENCY, SOURCE = "com.axelor.apps.base.db.Currency", "com.axelor.apps.base.db.Source"
EMAIL_ADDRESS = "com.axelor.message.db.EmailAddress"
STOCK_LOCATION, STOCK_CONFIG = "com.axelor.apps.stock.db.StockLocation", "com.axelor.apps.stock.db.StockConfig"
ACCOUNT, ACCOUNT_CONFIG = "com.axelor.apps.account.db.Account", "com.axelor.apps.account.db.AccountConfig"
ACCOUNT_MANAGEMENT = "com.axelor.apps.account.db.AccountManagement"
SALE_ORDER, SALE_ORDER_LINE = "com.axelor.apps.sale.db.SaleOrder", "com.axelor.apps.sale.db.SaleOrderLine"
TIMETABLE = "com.axelor.apps.supplychain.db.Timetable"
SEQUENCE, SEQUENCE_VERSION = "com.axelor.apps.base.db.Sequence", "com.axelor.apps.base.db.SequenceVersion"
LEAD, EVENT, OPP = "com.axelor.apps.crm.db.Lead", "com.axelor.apps.crm.db.Event", "com.axelor.apps.crm.db.Opportunity"
CONTRACT_LINE = "com.axelor.apps.contract.db.ContractLine"
PROJECT, TASK, TEAM = "com.axelor.apps.project.db.Project", "com.axelor.apps.project.db.ProjectTask", "com.axelor.team.db.Team"
LINE = "com.ioeti.businessline.db.BusinessLine"
W, O, C, D = "com.ioeti.workspace.db.", "com.ioeti.operations.db.", "com.ioeti.certification.db.", "com.ioeti.content.db."
REVIEW, REVIEW_EVENT, INVOICE_REQUEST = W + "ReviewRequest", W + "ReviewEvent", W + "InvoiceRequest"
REQ, HANDOVER, ITEM, H_EVENT = O + "HandoverRequirement", O + "HandoverRequest", O + "HandoverItem", O + "HandoverEvent"
META_FILE = "com.axelor.meta.db.MetaFile"
CYCLE, AUDIT, NC, QUAL = C + "CertificationCycle", C + "CertificationAudit", C + "Nonconformity", C + "AuditorQualification"
DOC, REV = D + "RecordDocument", D + "DocumentRevision"
MK, WS, QUOTES, OPS, CT, CERT = ("/ws/ioeti/marketing", "/ws/ioeti/workspace", "/ws/ioeti/quotes", "/ws/ioeti/operations",
                                 "/ws/ioeti/content", "/ws/ioeti/certification")
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:300]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def admin_client():
    client = Client()
    assert client.login(os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin")),
                        os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
    return client


def error(body):
    return (body.get("error") or {}) if isinstance(body, dict) else {}


def obj(body):
    return (body.get("object") if isinstance(body, dict) else None) or {}


def rows(body):
    value = body.get("object") if isinstance(body, dict) else None
    return value if isinstance(value, list) else []


def num(value):
    return None if value is None else round(float(value), 2)


def pdf(text):
    return f"%PDF-1.4\n% {text}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n".encode()


def b64(data):
    return base64.b64encode(data).decode()


def main():
    admin = admin_client()
    tag = secrets.token_hex(3).upper()
    created = []
    ids = {}  # scenario records, for clean-up and the restore comparison

    def create(model, values):
        _, body = rest_create(admin, model, values)
        if not ok(body):
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}: {json.dumps(body)[:200]}")
        created.append((model, body["data"][0]["id"]))
        return body["data"][0]

    def track(model, rid):
        if rid and (model, rid) not in created:
            created.append((model, rid))
        return rid

    def search(model, domain, fields=("id",)):
        _, body = admin.call("POST", f"/ws/rest/{model}/search",
                             {"fields": list(fields), "limit": 500, "data": {"_domain": domain, "_archived": True}})
        return body.get("data") or []

    def fetch(model, rid, fields):
        _, body = admin.call("POST", f"/ws/rest/{model}/{rid}/fetch", {"fields": list(fields)})
        return (body.get("data") or [{}])[0]

    def version(model, rid):
        return fetch(model, rid, ["version"]).get("version")

    sent_before = int(psql(DATABASE, "SELECT count(*) FROM message_message").strip())
    exit_code = 1
    try:
        # --- fictional master data (test fixture only) ----------------------------------------------------
        egp = search(CURRENCY, "self.codeISO = 'EGP'")[0]
        co = create(COMPANY, {"name": f"S1 Co {tag}", "code": f"S1{tag}", "currency": {"id": egp["id"]}})
        location = create(STOCK_LOCATION, {"name": f"S1 {tag}", "company": {"id": co["id"]}, "typeSelect": 1})
        create(STOCK_CONFIG, {"company": {"id": co["id"]}, "pickupDefaultStockLocation": {"id": location["id"]}})
        create(ACCOUNT_CONFIG, {"company": {"id": co["id"]}})
        create(SEQUENCE, {"company": {"id": co["id"]}, "name": f"TEST ONLY contracts {tag}", "codeSelect": "customerContract",
                          "padding": 4, "toBeAdded": 1, "prefixe": f"S{tag[:3]}",
                          "sequenceVersionList": [{"startDate": "2026-01-01", "nextNum": 1}]})
        ledger = create(ACCOUNT, {"name": f"TEST ONLY sales {tag}", "code": f"S{tag}", "company": {"id": co["id"]}, "commonPosition": 0})
        product = create(PRODUCT, {"name": f"S1 audit day {tag}", "code": f"S1-{tag}", "sellable": True, "salePrice": "1500",
                                   "saleCurrency": {"id": egp["id"]}, "productTypeSelect": "service"})
        create(ACCOUNT_MANAGEMENT, {"company": {"id": co["id"]}, "product": {"id": product["id"]}, "typeSelect": 1,
                                    "saleAccount": {"id": ledger["id"]}})
        line = create(LINE, {"code": f"S1L{tag}", "nameEn": f"S1 ISO 9001 {tag}", "nameAr": "خط تجريبي", "statusSelect": 2})
        source = create(SOURCE, {"name": f"S1 exhibition {tag}"})
        team = create(TEAM, {"name": f"S1 delivery {tag}"})

        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"s1.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})

        rwc = dict(canRead=True, canWrite=True, canCreate=True)
        rep_contract = perm("contract", CONTRACT, "self.opportunity.user = ?", **rwc)
        rep = [perm("lead", LEAD, "self.user = ?", **rwc), perm("event", EVENT, "self.user = ?", **rwc),
               perm("opp", OPP, "self.user = ?", **rwc), perm("partner", PARTNER, **rwc),
               perm("so", SALE_ORDER, "self.salespersonUser = ?", **rwc),
               perm("sol", SALE_ORDER_LINE, "self.saleOrder.salespersonUser = ?", **rwc, canRemove=True),
               perm("tt", TIMETABLE, "self.saleOrder.salespersonUser = ?", **rwc, canRemove=True),
               rep_contract, perm("cline", CONTRACT_LINE, canRead=True, canCreate=True),
               perm("review", REVIEW, "self.requestedBy = ?", **rwc), perm("revent", REVIEW_EVENT, "self.review.requestedBy = ?", canRead=True),
               perm("ireq", INVOICE_REQUEST, "self.requestedBy = ?", **rwc),
               perm("handover", HANDOVER, "self.requestedBy = ?", **rwc),
               perm("item", ITEM, "self.handover.requestedBy = ?", canRead=True, canWrite=True),
               perm("hevent", H_EVENT, "self.handover.requestedBy = ?", canRead=True), perm("req", REQ, canRead=True),
               perm("product", PRODUCT, canRead=True), perm("line", LINE, canRead=True), perm("source", SOURCE, canRead=True)]
        mgr = [perm("m.review", REVIEW, canRead=True, canWrite=True), perm("m.revent", REVIEW_EVENT, canRead=True),
               perm("m.so", SALE_ORDER, canRead=True), perm("m.contract", CONTRACT, canRead=True), perm("m.partner", PARTNER, canRead=True)]
        ops = [perm("o.handover", HANDOVER, canRead=True, canWrite=True), perm("o.item", ITEM, canRead=True, canWrite=True),
               perm("o.event", H_EVENT, canRead=True), perm("o.project", PROJECT, **rwc), perm("o.task", TASK, **rwc),
               perm("o.contract", CONTRACT, canRead=True), perm("o.partner", PARTNER, canRead=True), perm("o.req", REQ, canRead=True),
               perm("o.line", LINE, canRead=True), perm("o.team", TEAM, canRead=True)]
        config = [perm("c.req", REQ, **rwc), perm("c.line", LINE, canRead=True)]
        cert = [perm("q.qual", QUAL, canRead=True, canCreate=True), perm("q.cycle", CYCLE, "self.manager = ?", **rwc),
                perm("q.audit", AUDIT, "self.cycle.manager = ?", **rwc), perm("q.nc", NC, "self.audit.cycle.manager = ?", **rwc),
                perm("q.partner", PARTNER, canRead=True), perm("q.line", LINE, canRead=True)]
        groups = {}
        for key, perms in (("rep", rep), ("mgr", mgr), ("ops", ops), ("config", config), ("cert", cert)):
            groups[key] = create(GROUP, {"code": f"s1-{key}-{tag}", "name": f"S1 {key} {tag}",
                                         "permissions": [{"id": p["id"]} for p in perms]})
        users, sessions = {}, {}
        for label, group in (("RepA", "rep"), ("RepB", "rep"), ("Manager", "mgr"), ("Ops", "ops"), ("Config", "config"),
                             ("CertMgr", "cert")):
            password = "S1!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"s1.{label.lower()}.{tag}", "name": f"S1 {label} {tag}", "blocked": False,
                                         "language": "en", "group": {"id": groups[group]["id"]}, "activeCompany": {"id": co["id"]},
                                         "ioetiBusinessLines": [{"id": line["id"]}] if group == "rep" else [],
                                         "password": axelor_password_hash(password)})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        a, b, mgr_c, op, cfg, cm = (sessions[k] for k in ("RepA", "RepB", "Manager", "Ops", "Config", "CertMgr"))

        # --- 1. intake with an Arabic duplicate -------------------------------------------------------------
        digits = f"{secrets.randbelow(10**8):08d}"
        org = f"شركة النيل للأغذية {tag}"
        person = dict(firstName="أحمد", name="عبد الله", organization=org, email=f"ahmed.{tag.lower()}@example.test",
                      phone=f"+20 10{digits[:4]} {digits[4:]}", businessLineCode=line["code"], sourceId=source["id"])

        def intake(client, **values):
            s_, b_ = client.call("POST", f"{MK}/leads", values)
            track(LEAD, obj(b_).get("id"))
            return s_, b_, obj(b_)

        s_l, b_l, lead = intake(a, **person)
        arabic_digits = "".join("٠١٢٣٤٥٦٧٨٩"[int(d)] for d in "010" + digits)
        s_dup, b_dup, _ = intake(a, firstName="احمد", name="عبد اللّه", organization=f"شركه النيل للاغذيه {tag}",
                                 phone=arabic_digits, businessLineCode=line["code"])
        s_b_lead, _, lead_b = intake(b, **person)
        check("1 intake: lead recorded (201); the same person spelled differently with Arabic-Indic digits → 409 POSSIBLE_DUPLICATE; "
              "another salesperson's own copy is allowed and reveals nothing",
              (s_l, s_dup, error(b_dup).get("code"), s_b_lead) == (201, 409, "POSSIBLE_DUPLICATE", 201)
              and lead.get("businessLineCode") == line["code"], f"{s_l} {b_l} {s_dup} {b_dup} {s_b_lead}")

        # --- 2. conversion -----------------------------------------------------------------------------------
        s_cb, _ = b.call("POST", f"/ws/ioeti/leads/{lead['id']}/convert", {"version": version(LEAD, lead["id"])})
        s_cv, b_cv = a.call("POST", f"/ws/ioeti/leads/{lead['id']}/convert", {"version": version(LEAD, lead["id"])})
        conv = obj(b_cv)
        for model, key in ((PARTNER, "accountId"), (PARTNER, "contactId"), (OPP, "opportunityId")):
            track(model, conv.get(key))
        account_id, opp_id = conv.get("accountId"), conv.get("opportunityId")
        opp = fetch(OPP, opp_id, ["user", "partner", "ioetiBusinessLine", "ioetiOriginLead"]) if opp_id else {}
        check("2 conversion: another salesperson → 404; owner → 201 with account, contact and opportunity on the business line",
              s_cb == 404 and s_cv == 201 and all(conv.get(k) for k in ("accountId", "contactId", "opportunityId"))
              and (opp.get("user") or {}).get("id") == users["RepA"]["id"] and (opp.get("partner") or {}).get("id") == account_id
              and (opp.get("ioetiBusinessLine") or {}).get("id") == line["id"]
              and (opp.get("ioetiOriginLead") or {}).get("id") == lead["id"], f"{s_cb} {s_cv} {b_cv} {opp}")

        # --- 3. quotation, versions and review ----------------------------------------------------------------
        def add_line(quote_id, qty):
            s_, b_ = a.call("POST", f"{QUOTES}/{quote_id}/lines", {"version": version(SALE_ORDER, quote_id),
                                                                    "productId": product["id"], "quantity": qty})
            assert s_ in (200, 201), f"quote line {s_} {b_}"

        def total(quote_id):
            return num(fetch(SALE_ORDER, quote_id, ["exTaxTotal"]).get("exTaxTotal"))

        s_q, b_q = a.call("POST", QUOTES, {"opportunityId": opp_id, "opportunityVersion": version(OPP, opp_id)})
        quote_id = track(SALE_ORDER, obj(b_q).get("id"))
        add_line(quote_id, "3")
        add_line(quote_id, "2")
        s_v, b_v = a.call("POST", f"{QUOTES}/{quote_id}/versions", {"version": version(SALE_ORDER, quote_id)})
        s_r1, b_r1 = a.call("POST", f"{WS}/reviews", {"quoteId": quote_id, "version": version(SALE_ORDER, quote_id)})
        r1 = obj(b_r1)
        s_ch, b_ch = mgr_c.call("POST", f"{WS}/reviews/{r1.get('id')}/changes", {"version": version(REVIEW, r1.get("id")), "reason": "PRICING"})
        total_v1 = total(quote_id)
        add_line(quote_id, "1")
        s_r2, b_r2 = a.call("POST", f"{WS}/reviews", {"quoteId": quote_id, "version": version(SALE_ORDER, quote_id)})
        r2 = obj(b_r2)
        s_ap, b_ap = mgr_c.call("POST", f"{WS}/reviews/{r2.get('id')}/approve")
        check("3 quotation: 3 + 2 audit days at 1,500 = 7,500 EGP; version saved; review sent back for pricing; "
              "revised to 9,000 and re-sent; approval → BLOCKED_BY_POLICY (D-11)",
              (s_q, s_v, s_r1, s_ch, obj(b_ch).get("status"), s_r2, r2.get("status"), s_ap)
              == (201, 201, 201, 200, "CHANGES_REQUESTED", 201, "PENDING", 422)
              and total_v1 == 7500.0 and total(quote_id) == 9000.0
              and error(b_ap).get("code") == "BLOCKED_BY_POLICY" and "D-11" in error(b_ap).get("message", ""),
              f"{s_q} {s_v} {b_v} {s_r1} {s_ch} {s_r2} {r2} {s_ap} {total_v1} {total(quote_id)}")

        queue = {k: [(r["id"], r.get("opportunityId")) for r in rows(c.call("GET", f"{WS}/reviews?pending=true")[1])]
                 for k, c in (("Manager", mgr_c), ("RepA", a), ("RepB", b))}
        check("3 reviewer's queue: the pending review appears for the manager, linked to its opportunity; never for the "
              "requester or another salesperson",
              queue["Manager"].count((r2.get("id"), opp_id)) == 1 and r2.get("id") not in [x for x, _ in queue["RepA"] + queue["RepB"]],
              queue)

        # --- 4. milestones and the contract ---------------------------------------------------------------
        for title, pct in (("Deposit", "30"), ("Final report", "70")):
            s_m, b_m = a.call("POST", f"{QUOTES}/{quote_id}/milestones", {"version": version(SALE_ORDER, quote_id), "title": title,
                                                                           "percentage": pct, "dueDate": "2026-12-01"})
            assert s_m in (200, 201), f"milestone {s_m} {b_m}"
        stones = {m["title"]: m for m in search(TIMETABLE, f"self.saleOrder.id = {quote_id}", ("title", "percentage", "amount"))}
        s_k, b_k = a.call("POST", "/ws/ioeti/contracts", {"opportunityId": opp_id, "opportunityVersion": version(OPP, opp_id),
                                                          "contractType": "BILLING"})
        contract_id = obj(b_k).get("id")
        ids["contract"] = contract_id
        s_fill, _ = a.call("POST", f"/ws/ioeti/contracts/{contract_id}/lines-from-quote",
                           {"version": version(CONTRACT, contract_id), "quoteId": quote_id})
        c_lines = search(CONTRACT_LINE, f"self.contractVersion.contract.id = {contract_id}", ("exTaxTotal", "qty"))
        check("4 milestones 30/70 → 2,700 and 6,300 EGP; contract created and filled from the quotation with the same 9,000 total",
              {t: (num(m.get("percentage")), num(m.get("amount"))) for t, m in stones.items()}
              == {"Deposit": (30.0, 2700.0), "Final report": (70.0, 6300.0)}
              and (s_k, s_fill) == (201, 201) and len(c_lines) == 3 and sum(num(x["exTaxTotal"]) for x in c_lines) == 9000.0,
              f"{stones} {s_k} {s_fill} {c_lines}")

        # --- 5. activation stand-in, order confirmation stand-in, invoice request -------------------------
        s_early, b_early = a.call("POST", f"{OPS}/handovers", {"contractId": contract_id})
        # TEST FIXTURES: stand in for the signature (D-11) and order confirmation (D-06/D-11); never done by the product API
        psql(DATABASE, f"UPDATE contract_contract SET status_select = 2 WHERE id = {int(contract_id)};")
        psql(DATABASE, f"UPDATE sale_sale_order SET status_select = 3 WHERE id = {int(quote_id)};")
        s_ir, b_ir = a.call("POST", f"{WS}/invoice-requests", {"milestoneId": stones["Deposit"]["id"],
                                                               "quoteVersion": version(SALE_ORDER, quote_id)})
        ir = obj(b_ir)
        track(INVOICE_REQUEST, ir.get("id"))
        s_iss, b_iss = a.call("POST", f"{WS}/invoice-requests/{ir.get('id')}/issue")
        check("5 handover before activation → 422 CONTRACT_NOT_ACTIVE; deposit invoice request 2,700 EGP (201); "
              "issuing → BLOCKED_BY_POLICY (D-06), nothing invoiced",
              (s_early, error(b_early).get("code"), s_ir, num(ir.get("amountBeforeTax")), ir.get("currency"), s_iss,
               error(b_iss).get("code")) == (422, "CONTRACT_NOT_ACTIVE", 201, 2700.0, "EGP", 422, "BLOCKED_BY_POLICY")
              and ir.get("invoiceStatus") == "BLOCKED_BY_POLICY", f"{s_early} {b_early} {s_ir} {ir} {s_iss} {b_iss}")

        # --- 6. handover → engagement, with documents ---------------------------------------------------------
        for title, seq in (("Signed contract on file", 10), ("Kick-off meeting planned with the client", 20)):
            s_rq, b_rq = cfg.call("POST", f"{OPS}/requirements", {"businessLineCode": line["code"], "title": title,
                                                                  "mandatory": True, "sequence": seq})
            assert s_rq == 201, f"requirement {s_rq} {b_rq}"
            track(REQ, obj(b_rq).get("id"))
        s_h, b_h = a.call("POST", f"{OPS}/handovers", {"contractId": contract_id})
        h = obj(b_h)
        hid = ids["handover"] = h.get("id")

        def accept(client, v=None):
            return client.call("POST", f"{OPS}/handovers/{hid}/accept",
                               {"version": v if v is not None else version(HANDOVER, hid), "operationsLeadId": users["Ops"]["id"],
                                "teamId": team["id"], "startDate": date.today().isoformat()})

        def complete(client, iid, evidence=None):
            return client.call("POST", f"{OPS}/items/{iid}/complete",
                               {"version": version(ITEM, iid), **({"evidenceReference": evidence} if evidence else {})})

        s_inc, b_inc = accept(op)
        s_rw, _ = op.call("POST", f"{OPS}/handovers/{hid}/rework", {"version": version(HANDOVER, hid), "reason": "MISSING_DOCUMENTS"})
        signed = pdf(f"signed contract {tag}")
        s_doc, b_doc = a.call("POST", f"{CT}/documents", {"subject": "CONTRACT", "subjectId": contract_id, "title": "Signed contract",
                                                          "kind": "CONTRACT", "language": "BILINGUAL", "fileName": "contract.pdf",
                                                          "contentBase64": b64(signed), "changeSummary": "Signed copy"})
        doc = obj(b_doc)
        track(DOC, doc.get("id"))
        items = obj(op.call("GET", f"{OPS}/handovers/{hid}")[1]).get("items") or []
        s_i1, _ = complete(a, items[0]["id"], f"DOC-{doc.get('id')}")
        s_rs, _ = a.call("POST", f"{OPS}/handovers/{hid}/resubmit", {"version": version(HANDOVER, hid)})
        s_i2, _ = complete(op, items[1]["id"])
        v_before = version(HANDOVER, hid)
        s_acc, b_acc = accept(op, v_before)
        eng = obj(b_acc)
        track(PROJECT, eng.get("id"))
        ids["engagement"] = eng.get("id")
        s_acc2, _ = accept(op, v_before)
        projects = search(PROJECT, f"self.ioetiHandover.id = {hid}", ("clientPartner",))
        check("6 handover: checklist copied (2 required); accept while incomplete → 422 CHECKLIST_INCOMPLETE; rework; signed "
              "contract filed and cited as evidence; resubmitted; accepted → one engagement for the client; stale accept → 409",
              (s_h, len(h.get("items") or []), h.get("missingRequired"), s_inc, error(b_inc).get("code"), s_rw, s_doc, s_i1, s_rs, s_i2,
               s_acc, s_acc2) == (201, 2, 2, 422, "CHECKLIST_INCOMPLETE", 200, 201, 200, 200, 200, 201, 409)
              and len(projects) == 1 and projects[0]["id"] == eng.get("id")
              and (projects[0].get("clientPartner") or {}).get("id") == account_id and eng.get("clientId") == account_id,
              f"{s_h} {h} {s_inc} {s_rw} {s_doc} {s_i1} {s_rs} {s_i2} {s_acc} {b_acc} {s_acc2} {projects}")
        report = pdf(f"kick-off {tag}")
        s_kick, b_kick = op.call("POST", f"{CT}/documents", {"subject": "ENGAGEMENT", "subjectId": eng.get("id"), "title": "Kick-off minutes",
                                                             "kind": "REPORT", "language": "EN", "fileName": "kickoff.pdf",
                                                             "contentBase64": b64(report), "changeSummary": "First issue"})
        track(DOC, obj(b_kick).get("id"))
        s_rep_eng, _ = a.call("GET", f"{CT}/documents?subject=ENGAGEMENT&subjectId={eng.get('id')}")
        s_b_con, _ = b.call("GET", f"{CT}/documents?subject=CONTRACT&subjectId={contract_id}")
        _, a_con = a.call("GET", f"{CT}/documents?subject=CONTRACT&subjectId={contract_id}")
        check("6 documents follow their record: Ops files on the engagement; sales, with no right on engagements, → 403; "
              "another salesperson cannot list the contract's (404); the owner lists exactly the signed contract",
              s_kick == 201 and s_rep_eng == 403 and s_b_con == 404 and [x["id"] for x in rows(a_con)] == [doc.get("id")],
              f"{s_kick} {b_kick} {s_rep_eng} {s_b_con} {rows(a_con)}")

        # --- 7. certification cycle for the converted client ----------------------------------------------
        s_cy, b_cy = cm.call("POST", f"{CERT}/cycles", {"reference": f"s1-{tag}", "clientId": account_id, "standardCode": "ISO9001",
                                                         "scope": "Production of packaged foods", "siteCount": 1})
        cyc = obj(b_cy)
        track(CYCLE, cyc.get("id"))
        ids["cycle"] = cyc.get("id")
        s_dec, b_dec = cm.call("POST", f"{CERT}/cycles/{cyc.get('id')}/decision")
        s_cy_a, _ = a.call("GET", f"{CERT}/cycles/{cyc.get('id')}")
        check("7 certification cycle opened for the converted client (201); decision → BLOCKED_BY_POLICY (D-02); sales, with no "
              "right on cycles, → 403",
              (s_cy, cyc.get("clientId"), s_dec, error(b_dec).get("code"), s_cy_a) == (201, account_id, 422, "BLOCKED_BY_POLICY", 403)
              and "D-02" in error(b_dec).get("message", ""), f"{s_cy} {b_cy} {s_dec} {b_dec} {s_cy_a}")

        # --- 8. every area agrees -----------------------------------------------------------------------------
        def a360(client):
            s_, b_ = client.call("GET", f"{WS}/account360/{account_id}")
            body_ = obj(b_)
            return s_, {x["key"]: x["count"] for x in body_.get("sections", [])}, {m["currency"]: m for m in body_.get("money", [])}

        s_x, sec_x, money_x = a360(admin)
        s_a, sec_a, money_a = a360(a)
        s_b, sec_b, money_b = a360(b)
        egp_x, egp_a = money_x.get("EGP", {}), money_a.get("EGP", {})
        check("8 Account 360 (administrator): one each of opportunity, quotation, contract, handover, engagement and cycle; "
              "money per stage: 0 draft, 9,000 booked, 2,700 requested, 0 invoiced, 0 collected (a request is not revenue)",
              s_x == 200 and sec_x == {"OPPORTUNITIES": 1, "QUOTES": 1, "CONTRACTS": 1, "HANDOVERS": 1, "ENGAGEMENTS": 1,
                                       "CERTIFICATION_CYCLES": 1, "TRAINING_ENROLLMENTS": 0, "JOB_ORDERS": 0, "DONOR_PROFILE": 0,
                                       "FIELD_VISITS": 0, "QUALITY_ISSUES": 0}
              and [num(egp_x.get(k)) for k in ("quotedDraft", "bookedActive", "invoiceRequested", "invoiced", "collected")]
              == [0.0, 9000.0, 2700.0, 0.0, 0.0] and list(money_x) == ["EGP"], f"{s_x} {sec_x} {money_x}")
        check("8 Account 360 (RepA): only the areas sales may read (no engagement or cycle section), same figures; invoices "
              "unreadable → null, never zero; RepB sees the account but none of RepA's records",
              s_a == 200 and sec_a == {"OPPORTUNITIES": 1, "QUOTES": 1, "CONTRACTS": 1, "HANDOVERS": 1}
              and [num(egp_a.get(k)) for k in ("quotedDraft", "bookedActive", "invoiceRequested")] == [0.0, 9000.0, 2700.0]
              and egp_a.get("invoiced") is None and egp_a.get("collected") is None
              and s_b == 200 and sec_b == {"OPPORTUNITIES": 0, "QUOTES": 0, "CONTRACTS": 0, "HANDOVERS": 0},
              f"{s_a} {sec_a} {money_a} {s_b} {sec_b} {money_b}")

        def sales(client):
            s_, b_ = client.call("GET", f"/ws/ioeti/reports/sales?businessLine={line['code']}")
            body_ = obj(b_)
            pipeline = sum(r["count"] for r in body_.get("pipeline") or [])
            funnel = body_.get("leads") or {}
            return s_, pipeline, (funnel.get("total"), funnel.get("open"), funnel.get("converted"), funnel.get("lost")), \
                [(r["source"], r["total"], r["converted"]) for r in funnel.get("bySource") or []]

        r_a, r_b, r_x = sales(a), sales(b), sales(admin)
        check("8 sales report on the business line: RepA 1 opportunity, 1 lead converted from the exhibition; RepB only its own "
              "open lead; the administrator both (exact counts)",
              r_a == (200, 1, (1, 0, 1, 0), [(source["name"], 1, 1)]) and r_b == (200, 0, (1, 1, 0, 0), [(source["name"], 1, 0)])
              and r_x == (200, 1, (2, 1, 1, 0), [(source["name"], 2, 1)]), f"{r_a} {r_b} {r_x}")

        def inbox(client):
            return sorted((n["kind"], n["subject"], n["subjectId"]) for n in rows(client.call("GET", "/ws/ioeti/automation/inbox")[1]))

        boxes = {k: inbox(sessions[k]) for k in sessions}
        sent_after = int(psql(DATABASE, "SELECT count(*) FROM message_message").strip())
        check("8 notices reach exactly the requester: review sent back (on the opportunity), handover rework and acceptance; "
              "nobody else is notified, and nothing left the CRM",
              boxes["RepA"] == sorted([("REVIEW_CHANGES_REQUESTED", "OPPORTUNITY", opp_id), ("HANDOVER_REWORK", "HANDOVER", hid),
                                       ("HANDOVER_ACCEPTED", "HANDOVER", hid)])
              and all(not v for k, v in boxes.items() if k != "RepA") and sent_after == sent_before,
              f"{boxes} {sent_before}->{sent_after}")

        # --- 9. a permission removed mid-session ----------------------------------------------------------------
        def set_group_perms(perms):
            g = fetch(GROUP, groups["rep"]["id"], ["version"])
            s_, b_ = admin.call("POST", f"/ws/rest/{GROUP}/{groups['rep']['id']}",
                                {"data": {"id": groups["rep"]["id"], "version": g.get("version"),
                                          "permissions": [{"id": p["id"]} for p in perms]}})
            assert ok(b_), f"group update {s_} {b_}"

        set_group_perms([p for p in rep if p["id"] != rep_contract["id"]])
        s_rv_360, sec_rv, _ = a360(a)
        s_rv_doc, _ = a.call("GET", f"{CT}/documents?subject=CONTRACT&subjectId={contract_id}")
        s_rv_fill, _ = a.call("POST", f"/ws/ioeti/contracts/{contract_id}/lines-from-quote",
                              {"version": version(CONTRACT, contract_id), "quoteId": quote_id})
        set_group_perms(rep)
        s_back, sec_back, _ = a360(a)
        _, a_con2 = a.call("GET", f"{CT}/documents?subject=CONTRACT&subjectId={contract_id}")
        check("9 contract right removed from RepA's group mid-session: the very next requests no longer see contracts "
              "(section gone, documents and writes → 403); restored → visible again, nothing changed meanwhile",
              s_rv_360 == 200 and "CONTRACTS" not in sec_rv and (s_rv_doc, s_rv_fill) == (403, 403)
              and s_back == 200 and sec_back.get("CONTRACTS") == 1 and [x["id"] for x in rows(a_con2)] == [doc.get("id")]
              and len(search(CONTRACT_LINE, f"self.contractVersion.contract.id = {contract_id}")) == 3,
              f"{s_rv_360} {sec_rv} {s_rv_doc} {s_rv_fill} {s_back} {sec_back}")

        # --- 10. backup and restore mid-scenario ------------------------------------------------------------
        uid = users["RepA"]["id"]
        fingerprint = [
            f"SELECT row_to_json(t)::text FROM crm_lead t WHERE id = {int(lead['id'])}",
            f"SELECT row_to_json(t)::text FROM sale_sale_order t WHERE id = {int(quote_id)}",
            f"SELECT row_to_json(t)::text FROM sale_sale_order_line t WHERE sale_order = {int(quote_id)} ORDER BY id",
            f"SELECT row_to_json(t)::text FROM contract_contract t WHERE id = {int(contract_id)}",
            f"SELECT row_to_json(l)::text FROM contract_contract_line l JOIN contract_contract c ON l.contract_version = "
            f"c.current_contract_version WHERE c.id = {int(contract_id)} ORDER BY l.id",
            f"SELECT row_to_json(t)::text FROM ioeti_ws_review t WHERE quote = {int(quote_id)} ORDER BY id",
            f"SELECT row_to_json(t)::text FROM ioeti_ws_invoice_request t WHERE id = {int(ir.get('id') or 0)}",
            f"SELECT row_to_json(t)::text FROM ioeti_ops_handover t WHERE id = {int(hid)}",
            f"SELECT row_to_json(t)::text FROM ioeti_ops_handover_item t WHERE handover = {int(hid)} ORDER BY id",
            f"SELECT row_to_json(t)::text FROM ioeti_ops_handover_event t WHERE handover = {int(hid)} ORDER BY id",
            f"SELECT row_to_json(t)::text FROM project_project t WHERE ioeti_handover = {int(hid)}",
            f"SELECT row_to_json(t)::text FROM ioeti_doc_revision t WHERE document IN ({int(doc.get('id') or 0)}, "
            f"{int(obj(b_kick).get('id') or 0)}) ORDER BY id",
            f"SELECT row_to_json(t)::text FROM ioeti_cert_cycle t WHERE id = {int(cyc.get('id') or 0)}",
            f"SELECT row_to_json(t)::text FROM ioeti_auto_notification t WHERE recipient = {int(uid)} ORDER BY id",
        ]
        live = [psql(DATABASE, q) for q in fingerprint]
        scratch = f"ioeti_s1_restore_{tag.lower()}"
        restored, restore_ok = [], False
        try:
            dump = subprocess.run(["docker", "exec", CONTAINER, "sh", "-c",
                                   f"pg_dump -U {DB_USER} -d {DATABASE} -Fc -f /tmp/{scratch}.dump && "
                                   f"createdb -U {DB_USER} {scratch} && pg_restore -U {DB_USER} -d {scratch} --no-owner /tmp/{scratch}.dump"],
                                  capture_output=True, text=True, timeout=600)
            restore_ok = dump.returncode == 0
            if restore_ok:
                restored = [psql(scratch, q) for q in fingerprint]
        finally:
            subprocess.run(["docker", "exec", CONTAINER, "sh", "-c",
                            f"rm -f /tmp/{scratch}.dump; dropdb -U {DB_USER} --if-exists {scratch}"], capture_output=True, timeout=120)
        check("10 backup taken mid-scenario and restored into a new database: every scenario row (lead, quotation and lines, "
              "contract and lines, reviews, invoice request, handover, checklist, trail, engagement, documents, cycle, notices) "
              "is identical",
              restore_ok and all(x.strip() for x in live) and restored == live,
              f"{restore_ok} {[i for i, (x, y) in enumerate(zip(live, restored)) if x != y]}")

        failed = [r for r in RESULTS if r["result"] != "PASS"]
        print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
        exit_code = 0 if not failed else 1
    finally:
        # gather everything the scenario produced, then delete in dependency order
        opp_ids = [rid for model, rid in created if model == OPP]
        quote_ids = [r["id"] for r in search(SALE_ORDER, f"self.opportunity.id in ({','.join(map(str, opp_ids))})")] if opp_ids else []
        contract_ids = [r["id"] for r in search(CONTRACT, f"self.opportunity.id in ({','.join(map(str, opp_ids))})")] if opp_ids else []
        doc_ids = [rid for model, rid in created if model == DOC]
        extra = []
        if quote_ids:
            q = ",".join(map(str, quote_ids))
            extra += [(INVOICE_REQUEST, f"self.quote.id in ({q})"), (REVIEW_EVENT, f"self.review.quote.id in ({q})"),
                      (REVIEW, f"self.quote.id in ({q})"), (TIMETABLE, f"self.saleOrder.id in ({q})"),
                      (SALE_ORDER_LINE, f"self.saleOrder.id in ({q}) OR self.oldVersionSaleOrder.id in ({q})")]
        if contract_ids:
            c = ",".join(map(str, contract_ids))
            handovers = [r["id"] for r in search(HANDOVER, f"self.contract.id in ({c})")]
            if handovers:
                h_ids = ",".join(map(str, handovers))
                psql(DATABASE, f"UPDATE ioeti_ops_handover SET engagement = NULL WHERE id IN ({h_ids});")
                extra += [(TASK, f"self.project.ioetiHandover.id in ({h_ids})"), (PROJECT, f"self.ioetiHandover.id in ({h_ids})"),
                          (H_EVENT, f"self.handover.id in ({h_ids})"), (ITEM, f"self.handover.id in ({h_ids})"),
                          (HANDOVER, f"self.id in ({h_ids})")]
            extra += [(REVIEW_EVENT, f"self.review.contract.id in ({c})"), (REVIEW, f"self.contract.id in ({c})")]
        if doc_ids:
            for row in search(REV, f"self.document.id in ({','.join(map(str, doc_ids))})", ("file",)):
                track(REV, row["id"])
                if row.get("file"):
                    track(META_FILE, row["file"]["id"])
        extra += [(REQ, f"self.businessLine.code = 'S1L{tag}'"), (CYCLE, f"self.reference like '%{tag}%'"),
                  (LEAD, f"self.ioetiBusinessLine.code = 'S1L{tag}'"),
                  (EMAIL_ADDRESS, f"self.address like '%{tag.lower()}@example.test'")]
        for model, domain in extra:
            for row in search(model, domain):
                track(model, row["id"])
        for rid in quote_ids:
            track(SALE_ORDER, rid)
        # a converted account and its contact reference each other
        for model, rid in list(created):
            if model == PARTNER:
                row = fetch(PARTNER, rid, ["contactPartnerSet"])
                if row.get("contactPartnerSet"):
                    admin.call("POST", f"/ws/rest/{PARTNER}/{rid}", {"data": {"id": rid, "version": row.get("version"),
                                                                              "contactPartnerSet": []}})
        order = {TASK: 0, INVOICE_REQUEST: 0, REVIEW_EVENT: 0, REV: 0, PROJECT: 1, H_EVENT: 1, ITEM: 1, REVIEW: 1, TIMETABLE: 1,
                 SALE_ORDER_LINE: 1, DOC: 1, CYCLE: 1, HANDOVER: 2, SALE_ORDER: 2, REQ: 3, OPP: 4, LEAD: 5,
                 ACCOUNT_MANAGEMENT: 5, PRODUCT: 6, PARTNER: 6, EMAIL_ADDRESS: 7, META_FILE: 7, SOURCE: 7, TEAM: 7, ACCOUNT: 7, ACCOUNT_CONFIG: 8,
                 STOCK_CONFIG: 8, STOCK_LOCATION: 9, SEQUENCE_VERSION: 9, SEQUENCE: 9, USER: 10, GROUP: 11, PERM: 12, LINE: 12, COMPANY: 13}
        complete_, leftovers = False, []
        try:
            cleanup(admin, [(m, r) for m, r in created if order.get(m, 99) <= 3], order)
            for cid in contract_ids:
                delete_contract(admin, cid)
            for model, rid in list(created):
                if model == SEQUENCE:
                    _delete_where(admin, RESERVED_SEQUENCE, f"self.sequenceVersion.sequence.id = {rid}")
                    for row in search(SEQUENCE_VERSION, f"self.sequence.id = {rid}"):
                        track(SEQUENCE_VERSION, row["id"])
            complete_, leftovers = cleanup(admin, created, order)
        finally:
            if not complete_:
                print(f"FAIL cleanup left {leftovers}")
                exit_code = 1
            os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
            with open(os.path.join(ROOT, "logs", "scenario-iso-lifecycle.json"), "w", encoding="utf-8") as f:
                json.dump({"results": RESULTS, "cleanup_complete": complete_}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
