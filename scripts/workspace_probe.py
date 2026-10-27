#!/usr/bin/env python3
"""Wave 5b live probe: quotation versions, review requests, invoice requests, renewals, Account 360.

Run against a RUNNING local/CI Axelor; never against production. Roles are TEST FIXTURES built from
native permissions (policy D-07 defines the real ones): RepA and RepB sell their own records, Manager
reviews quotations and contracts. Confirming an order and activating a contract are D-06/D-11 and
blocked in the API, so they are done with SQL in the disposable database as stand-ins: TEST FIXTURE ONLY.
Checks:
  native quotation versions: save, list, restore; unknown version → 422; stale → 409; empty → 422
  review requests: one pending per record (409); approving finalizes, so a read-only reviewer → 403; rejecting without the
  owners' policies → POLICY_NOT_SET (D-11, fail closed; scripts/quote_approval_probe.py covers the decisions); contracts →
  BLOCKED_BY_POLICY;
  changes requested with a reason; withdraw; history with actors; contract reviews
  invoice requests: only for a confirmed order; one open per milestone (409, also when concurrent);
  issue → BLOCKED_BY_POLICY (D-06); cancel and request again
  renewals: only active or closed contracts; one per contract (409); business line copied
  Account 360: sections only for what the caller may read; money stages kept apart, unreadable = null
  isolation: another salesperson answers 404
Env: PROBE_WS_ROUNDS (default 5). Report: logs/workspace-probe.json.
"""
import json
import os
import secrets
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import CONTRACT, RESERVED_SEQUENCE, _delete_where, cleanup, delete_contract  # noqa: E402
from db_migrate import DATABASE, psql  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PARTNER, PRODUCT, COMPANY = "com.axelor.apps.base.db.Partner", "com.axelor.apps.base.db.Product", "com.axelor.apps.base.db.Company"
CURRENCY = "com.axelor.apps.base.db.Currency"
STOCK_LOCATION, STOCK_CONFIG = "com.axelor.apps.stock.db.StockLocation", "com.axelor.apps.stock.db.StockConfig"
ACCOUNT, ACCOUNT_CONFIG = "com.axelor.apps.account.db.Account", "com.axelor.apps.account.db.AccountConfig"
ACCOUNT_MANAGEMENT = "com.axelor.apps.account.db.AccountManagement"
SALE_ORDER, SALE_ORDER_LINE = "com.axelor.apps.sale.db.SaleOrder", "com.axelor.apps.sale.db.SaleOrderLine"
TIMETABLE = "com.axelor.apps.supplychain.db.Timetable"
SEQUENCE, SEQUENCE_VERSION = "com.axelor.apps.base.db.Sequence", "com.axelor.apps.base.db.SequenceVersion"
OPP, LINE = "com.axelor.apps.crm.db.Opportunity", "com.ioeti.businessline.db.BusinessLine"
P = "com.ioeti.workspace.db."
REVIEW, REVIEW_EVENT, INVOICE_REQUEST = P + "ReviewRequest", P + "ReviewEvent", P + "InvoiceRequest"
WS, QUOTES = "/ws/ioeti/workspace", "/ws/ioeti/quotes"
MISSING = 987654328
ROUNDS = int(os.environ.get("PROBE_WS_ROUNDS", "5"))
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:200]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def admin_client():
    client = Client()
    assert client.login(os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin")),
                        os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
    return client


def error(body):
    return (body.get("error") or {}) if isinstance(body, dict) else {}


def obj(body):
    return (body.get("object") or {}) if isinstance(body, dict) else {}


def num(value):
    return None if value is None else round(float(value), 2)


def main():
    admin = admin_client()
    tag = secrets.token_hex(3).upper()
    created = []

    def create(model, values):
        _, body = rest_create(admin, model, values)
        if not ok(body):
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}: {json.dumps(body)[:200]}")
        created.append((model, body["data"][0]["id"]))
        return body["data"][0]

    def search(model, domain, fields=("id",)):
        _, body = admin.call("POST", f"/ws/rest/{model}/search",
                             {"fields": list(fields), "limit": 500, "data": {"_domain": domain, "_archived": True}})
        return body.get("data") or []

    def version(model, rid):
        _, body = admin.call("POST", f"/ws/rest/{model}/{rid}/fetch", {"fields": ["version"]})
        return (body.get("data") or [{}])[0].get("version")

    exit_code = 1
    try:
        # --- fictional master data (test fixture only), as in the quotation probe ----------------------
        egp = search(CURRENCY, "self.codeISO = 'EGP'")[0]
        co = create(COMPANY, {"name": f"Wave5b Co {tag}", "code": f"W5B{tag}", "currency": {"id": egp["id"]}})
        location = create(STOCK_LOCATION, {"name": f"Wave5b {tag}", "company": {"id": co["id"]}, "typeSelect": 1})
        create(STOCK_CONFIG, {"company": {"id": co["id"]}, "pickupDefaultStockLocation": {"id": location["id"]}})
        create(ACCOUNT_CONFIG, {"company": {"id": co["id"]}})
        create(SEQUENCE, {"company": {"id": co["id"]}, "name": f"TEST ONLY contracts {tag}", "codeSelect": "customerContract",
                          "padding": 4, "toBeAdded": 1, "prefixe": f"B{tag[:3]}",
                          "sequenceVersionList": [{"startDate": "2026-01-01", "nextNum": 1}]})
        ledger = create(ACCOUNT, {"name": f"TEST ONLY sales {tag}", "code": f"B{tag}", "company": {"id": co["id"]}, "commonPosition": 0})
        product = create(PRODUCT, {"name": f"Wave5b audit day {tag}", "code": f"W5B-{tag}", "sellable": True, "salePrice": "1500",
                                   "saleCurrency": {"id": egp["id"]}, "productTypeSelect": "service"})
        create(ACCOUNT_MANAGEMENT, {"company": {"id": co["id"]}, "product": {"id": product["id"]}, "typeSelect": 1,
                                    "saleAccount": {"id": ledger["id"]}})
        line = create(LINE, {"code": f"W5L{tag}", "nameEn": f"Wave5b ISO {tag}", "nameAr": "خط تجريبي", "statusSelect": 2})
        account = create(PARTNER, {"name": f"Wave5b Nile Foods {tag}", "isProspect": True, "partnerTypeSelect": 1})
        supplier = create(PARTNER, {"name": f"Wave5b Supplier {tag}", "partnerTypeSelect": 1})

        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"wave5b.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})

        rwc = dict(canRead=True, canWrite=True, canCreate=True)
        rep = [perm("opp", OPP, "self.user = ?", **rwc), perm("so", SALE_ORDER, "self.salespersonUser = ?", **rwc),
               perm("sol", SALE_ORDER_LINE, "self.saleOrder.salespersonUser = ?", canRead=True, canWrite=True, canCreate=True,
                    canRemove=True),
               perm("tt", TIMETABLE, "self.saleOrder.salespersonUser = ?", canRead=True, canWrite=True, canCreate=True, canRemove=True),
               perm("contract", CONTRACT, "self.opportunity.user = ?", **rwc),
               perm("cline", "com.axelor.apps.contract.db.ContractLine", canRead=True, canCreate=True),
               perm("review", REVIEW, "self.requestedBy = ?", **rwc), perm("revent", REVIEW_EVENT, "self.review.requestedBy = ?", canRead=True),
               perm("ireq", INVOICE_REQUEST, "self.requestedBy = ?", **rwc),
               perm("product", PRODUCT, canRead=True), perm("partner", PARTNER, canRead=True), perm("line", LINE, canRead=True)]
        mgr = [perm("m.review", REVIEW, canRead=True, canWrite=True), perm("m.revent", REVIEW_EVENT, canRead=True),
               perm("m.so", SALE_ORDER, canRead=True), perm("m.contract", CONTRACT, canRead=True), perm("m.partner", PARTNER, canRead=True)]
        groups = {}
        for key, perms in (("rep", rep), ("mgr", mgr)):
            groups[key] = create(GROUP, {"code": f"wave5b-{key}-{tag}", "name": f"Wave5b {key} {tag}",
                                         "permissions": [{"id": p["id"]} for p in perms]})
        users, sessions = {}, {}
        for label, group in (("RepA", "rep"), ("RepA2", None), ("RepB", "rep"), ("Manager", "mgr")):
            if group is None:
                sessions[label] = Client()
                assert sessions[label].login(users["RepA"]["code"], users["RepA"]["_pw"]) == 200
                continue
            password = "W5b!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"wave5b.{label.lower()}.{tag}", "name": f"Wave5b {label}", "blocked": False,
                                         "language": "en", "group": {"id": groups[group]["id"]}, "activeCompany": {"id": co["id"]},
                                         "password": axelor_password_hash(password)})
            users[label]["_pw"] = password
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        a, a2, b, mgr_c = (sessions[k] for k in ("RepA", "RepA2", "RepB", "Manager"))

        def opportunity(label, owner="RepA"):
            return create(OPP, {"name": f"Wave5b {label} {tag}", "user": {"id": users[owner]["id"]}, "partner": {"id": account["id"]},
                                "ioetiBusinessLine": {"id": line["id"]}})

        def new_quote(client, opp):
            s_, body_ = client.call("POST", QUOTES, {"opportunityId": opp["id"], "opportunityVersion": version(OPP, opp["id"])})
            assert s_ == 201, f"quote fixture {s_} {body_}"
            return obj(body_)

        def add_line(client, quote_id, qty="1"):
            return client.call("POST", f"{QUOTES}/{quote_id}/lines", {"version": version(SALE_ORDER, quote_id), "productId": product["id"],
                                                                       "quantity": qty})

        def new_contract(client, opp):
            s_, body_ = client.call("POST", "/ws/ioeti/contracts", {"opportunityId": opp["id"], "opportunityVersion": version(OPP, opp["id"]),
                                                                    "contractType": "BILLING"})
            assert s_ == 201, f"contract fixture {s_} {body_}"
            return obj(body_)["id"]

        # --- 1. quotation versions (native) -------------------------------------------------------------
        opp1 = opportunity("versions")
        q = new_quote(a, opp1)
        empty_s, empty_b = a.call("POST", f"{QUOTES}/{q['id']}/versions", {"version": version(SALE_ORDER, q["id"])})
        add_line(a, q["id"], "2")
        s_v, b_v = a.call("POST", f"{QUOTES}/{q['id']}/versions", {"version": version(SALE_ORDER, q["id"])})
        add_line(a, q["id"], "3")
        _, listed = a.call("GET", f"{QUOTES}/{q['id']}/versions")
        s_stale, _ = a.call("POST", f"{QUOTES}/{q['id']}/versions/1/restore", {"version": version(SALE_ORDER, q["id"]) - 1})
        s_unk, b_unk = a.call("POST", f"{QUOTES}/{q['id']}/versions/9/restore", {"version": version(SALE_ORDER, q["id"])})
        s_r, b_r = a.call("POST", f"{QUOTES}/{q['id']}/versions/1/restore", {"version": version(SALE_ORDER, q["id"])})
        _, after = a.call("GET", f"{QUOTES}/{q['id']}/versions")
        check("quotation versions: empty → 422 NO_LINES; saved (version 2); listed; stale → 409; unknown → 422; restore brings back v1 "
              "and saves the current lines first",
              (empty_s, error(empty_b).get("code"), s_v, obj(b_v).get("versionNumber"), s_stale, s_unk, error(b_unk).get("code"), s_r)
              == (422, "NO_LINES", 201, 2, 409, 422, "VERSION_UNKNOWN", 200)
              and [v["number"] for v in obj(listed)] == [1] and obj(listed)[0]["lines"] == 1
              and len(obj(b_r).get("lines") or []) == 1 and sorted(v["number"] for v in obj(after)) == [1, 2],
              f"{empty_s} {s_v} {obj(listed)} {s_stale} {s_unk} {s_r} {obj(after)}")

        # --- 2. review requests -------------------------------------------------------------------------
        def review(client, **subject):
            body = {**subject, "version": version(SALE_ORDER if "quoteId" in subject else CONTRACT, list(subject.values())[0])}
            s_, b_ = client.call("POST", f"{WS}/reviews", body)
            if obj(b_).get("id"):
                created.append((REVIEW, obj(b_)["id"]))
            return s_, b_, obj(b_)

        q_empty = new_quote(a, opportunity("empty"))
        s_e, b_e, _ = review(a, quoteId=q_empty["id"])
        s1, b1, r1 = review(a, quoteId=q["id"])
        s2, b2, _ = review(a, quoteId=q["id"])
        s_ap, b_ap = mgr_c.call("POST", f"{WS}/reviews/{r1.get('id')}/approve", {"version": version(REVIEW, r1.get("id"))})
        s_rj, b_rj = mgr_c.call("POST", f"{WS}/reviews/{r1.get('id')}/reject", {"version": version(REVIEW, r1.get("id")), "reason": "PRICING"})
        s_rep_ch, _ = b.call("POST", f"{WS}/reviews/{r1.get('id')}/changes", {"version": version(REVIEW, r1.get("id")), "reason": "PRICING"})
        s_ch, b_ch = mgr_c.call("POST", f"{WS}/reviews/{r1.get('id')}/changes", {"version": version(REVIEW, r1.get("id")), "reason": "PRICING"})
        s_wd, b_wd = a.call("POST", f"{WS}/reviews/{r1.get('id')}/withdraw", {"version": version(REVIEW, r1.get("id"))})
        s3, _, r3 = review(a, quoteId=q["id"])
        s_wd2, b_wd2 = a.call("POST", f"{WS}/reviews/{r3.get('id')}/withdraw", {"version": version(REVIEW, r3.get("id"))})
        _, hist = a.call("GET", f"{WS}/reviews?quoteId={q['id']}")
        c_draft = new_contract(a, opportunity("contract"))
        s_c, _, rc = review(a, contractId=c_draft)
        _, chist = mgr_c.call("GET", f"{WS}/reviews?contractId={c_draft}")
        s_cap, b_cap = mgr_c.call("POST", f"{WS}/reviews/{rc.get('id')}/approve", {"version": version(REVIEW, rc.get("id"))})
        first = next((h for h in obj(hist) if h["id"] == r1.get("id")), {})
        # Wave 7b: the requester is told in the app (linked to the opportunity); the reviewer gets nothing
        _, inbox_a = a.call("GET", "/ws/ioeti/automation/inbox")
        _, inbox_m = mgr_c.call("GET", "/ws/ioeti/automation/inbox")
        notes_a = [(n["kind"], n["subject"], n["subjectId"]) for n in (inbox_a.get("object") or [])]
        check("notices: changes requested reach the requester in the app, linked to the opportunity; none for the reviewer",
              notes_a.count(("REVIEW_CHANGES_REQUESTED", "OPPORTUNITY", opp1["id"])) == 1 and not (inbox_m.get("object") or []),
              f"{notes_a} {inbox_m}")
        check("review: empty quotation → 422; pending with the quotation version; twice → 409; approving finalizes, so a reviewer with"
              " read-only rights on quotations → 403; rejecting without the owners' policies → POLICY_NOT_SET (D-11, fail closed);"
              " a contract's approval → BLOCKED_BY_POLICY",
              (s_e, error(b_e).get("code"), s1, r1.get("status"), r1.get("quoteVersionNumber"), s2, error(b2).get("code"), s_ap, s_rj, s_cap)
              == (422, "NO_LINES", 201, "PENDING", obj(b_r).get("versionNumber"), 409, "REVIEW_PENDING", 403, 422, 422)
              and error(b_rj).get("code") == "POLICY_NOT_SET" and r1.get("approver") is None
              and error(b_cap).get("code") == "BLOCKED_BY_POLICY" and "D-11" in error(b_cap).get("message", ""),
              f"{s_e} {s1} {r1} {s2} {s_ap} {error(b_ap)} {s_rj} {error(b_rj)} {s_cap} {error(b_cap)}")
        check("review: another salesperson → 404; manager sends back with a reason; withdraw of a decided review → 422; "
              "a new review can be withdrawn; history lists every step with its actor; contract reviews too",
              s_rep_ch == 404 and s_ch == 200 and obj(b_ch).get("status") == "CHANGES_REQUESTED" and obj(b_ch).get("reason") == "PRICING"
              and (s_wd, error(b_wd).get("code")) == (422, "REVIEW_STATE") and s3 == 201 and s_wd2 == 200
              and obj(b_wd2).get("status") == "WITHDRAWN"
              and [e["kind"] for e in first.get("events", [])] == ["REQUESTED", "CHANGES_REQUESTED"]
              and first["events"][1]["actorName"] == users["Manager"]["name"]
              and s_c == 201 and [x["id"] for x in obj(chist)] == [rc.get("id")],
              f"{s_rep_ch} {s_ch} {s_wd} {s3} {s_wd2} {first.get('events')} {s_c}")

        # --- 3. invoice requests --------------------------------------------------------------------------
        def milestone(quote_id, title, pct):
            s_, b_ = a.call("POST", f"{QUOTES}/{quote_id}/milestones", {"version": version(SALE_ORDER, quote_id), "title": title,
                                                                          "percentage": pct, "dueDate": "2026-12-01"})
            assert s_ in (200, 201), f"milestone fixture {s_} {b_}"
            return [m["id"] for m in search(TIMETABLE, f"self.saleOrder.id = {quote_id}", ("title",)) if m.get("title") == title][0]

        def invoice_request(client, mid, quote_id):
            s_, b_ = client.call("POST", f"{WS}/invoice-requests", {"milestoneId": mid, "quoteVersion": version(SALE_ORDER, quote_id)})
            if obj(b_).get("id"):
                created.append((INVOICE_REQUEST, obj(b_)["id"]))
            return s_, b_, obj(b_)

        q_inv = new_quote(a, opportunity("invoice"))
        add_line(a, q_inv["id"], "4")
        m1 = milestone(q_inv["id"], "Deposit", "30")
        m2 = milestone(q_inv["id"], "Stage 1 report", "30")
        s_nc, b_nc, _ = invoice_request(a, m1, q_inv["id"])
        # TEST FIXTURE: stands in for order confirmation, which D-06/D-11 govern; never done by the product API
        psql(DATABASE, f"UPDATE sale_sale_order SET status_select = 3 WHERE id = {int(q_inv['id'])};")
        s_i1, b_i1, ir1 = invoice_request(a, m1, q_inv["id"])
        s_i2, b_i2, _ = invoice_request(a, m1, q_inv["id"])
        s_iss, b_iss = a.call("POST", f"{WS}/invoice-requests/{ir1.get('id')}/issue", {"version": version(INVOICE_REQUEST, ir1.get("id"))})
        s_b_cancel, _ = b.call("POST", f"{WS}/invoice-requests/{ir1.get('id')}/cancel", {"version": version(INVOICE_REQUEST, ir1.get("id"))})
        s_cn, b_cn = a.call("POST", f"{WS}/invoice-requests/{ir1.get('id')}/cancel", {"version": version(INVOICE_REQUEST, ir1.get("id"))})
        s_i3, _, _ = invoice_request(a, m1, q_inv["id"])
        _, irs = a.call("GET", f"{WS}/invoice-requests?quoteId={q_inv['id']}")
        check("invoice request: draft order → 422 ORDER_NOT_CONFIRMED; requested with the milestone amount; twice → 409; issue by a "
              "salesperson → 403 (D-06: finance's, native invoice rights); another salesperson → 404; cancel; request again → 201",
              (s_nc, error(b_nc).get("code"), s_i1, s_i2, error(b_i2).get("code"), s_iss, s_b_cancel, s_cn, s_i3)
              == (422, "ORDER_NOT_CONFIRMED", 201, 409, "INVOICE_REQUEST_EXISTS", 403, 404, 200, 201)
              and num(ir1.get("amountBeforeTax")) and ir1.get("invoiceNumber") is None
              and obj(b_cn).get("status") == "CANCELLED" and sorted(x["status"] for x in obj(irs)) == ["CANCELLED", "REQUESTED"],
              f"{s_nc} {s_i1} {s_i2} {s_iss} {s_b_cancel} {s_cn} {s_i3}")
        outcomes = []
        # concurrency: the second milestone, requested twice at the same time, ROUNDS times on fresh orders
        for i in range(ROUNDS):
            qi = q_inv if i == 0 else new_quote(a, opportunity(f"race{i}"))
            if i:
                add_line(a, qi["id"], "1")
            mid = m2 if i == 0 else milestone(qi["id"], f"Race {i}", "50")
            psql(DATABASE, f"UPDATE sale_sale_order SET status_select = 3 WHERE id = {int(qi['id'])};")
            v0 = version(SALE_ORDER, qi["id"])
            gate, answers = threading.Barrier(2), []

            def run(client):
                gate.wait()
                answers.append(client.call("POST", f"{WS}/invoice-requests", {"milestoneId": mid, "quoteVersion": v0}))

            threads = [threading.Thread(target=run, args=(cl,)) for cl in (a, a2)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            for _, resp in answers:
                if obj(resp).get("id"):
                    created.append((INVOICE_REQUEST, obj(resp)["id"]))
            outcomes.append((sorted(s_ for s_, _ in answers),
                             len(search(INVOICE_REQUEST, f"self.milestone.id = {mid} AND self.statusSelect = 1"))))
        check(f"concurrent invoice requests for one milestone: one 201 and one 409, one open request ({ROUNDS} rounds)",
              all(o == ([201, 409], 1) for o in outcomes), outcomes)

        # --- 4. renewals --------------------------------------------------------------------------------
        opp_r = opportunity("renew")
        c_ren = new_contract(a, opp_r)
        s_rd, b_rd = a.call("POST", f"{WS}/contracts/{c_ren}/renewal", {"version": version(CONTRACT, c_ren)})
        # TEST FIXTURE: stands in for the signature that D-11 governs; never done by the product API
        psql(DATABASE, f"UPDATE contract_contract SET status_select = 2 WHERE id = {int(c_ren)};")
        s_rn, b_rn = a.call("POST", f"{WS}/contracts/{c_ren}/renewal", {"version": version(CONTRACT, c_ren)})
        ren = obj(b_rn)
        if ren.get("opportunityId"):
            created.append((OPP, ren["opportunityId"]))
        s_rn2, b_rn2 = a.call("POST", f"{WS}/contracts/{c_ren}/renewal", {"version": version(CONTRACT, c_ren)})
        stored = search(OPP, f"self.id = {ren.get('opportunityId') or 0}", ("ioetiRenewalOf", "ioetiBusinessLine", "partner"))
        check("renewal: draft contract → 422 CONTRACT_NOT_ACTIVE; active → 201 renewal opportunity (contract link, account and "
              "business line copied); twice → 409 RENEWAL_EXISTS",
              (s_rd, error(b_rd).get("code"), s_rn, s_rn2, error(b_rn2).get("code")) == (422, "CONTRACT_NOT_ACTIVE", 201, 409, "RENEWAL_EXISTS")
              and stored and (stored[0].get("ioetiRenewalOf") or {}).get("id") == c_ren
              and (stored[0].get("ioetiBusinessLine") or {}).get("id") == line["id"]
              and (stored[0].get("partner") or {}).get("id") == account["id"], f"{s_rd} {s_rn} {s_rn2} {stored}")

        # --- 5. Account 360 -----------------------------------------------------------------------------
        s_a, b_a = a.call("GET", f"{WS}/account360/{account['id']}")
        sections = {x["key"]: x["count"] for x in obj(b_a).get("sections", [])}
        money = {m["currency"]: m for m in obj(b_a).get("money", [])}
        egp_row = money.get("EGP", {})
        s_b, b_b360 = b.call("GET", f"{WS}/account360/{account['id']}")
        b_sections = {x["key"]: x["count"] for x in obj(b_b360).get("sections", [])}
        s_sup, _ = a.call("GET", f"{WS}/account360/{supplier['id']}")
        s_miss, _ = a.call("GET", f"{WS}/account360/{MISSING}")
        check("Account 360: sections only for readable domains (no donor, job order or engagement section for sales); own records "
              "counted; money stages apart, invoices unreadable → null; another salesperson sees 0; non-client → 404",
              s_a == 200 and sections.get("OPPORTUNITIES", 0) >= 5 and sections.get("CONTRACTS") == 2 and sections.get("QUOTES", 0) >= 3
              and not any(k in sections for k in ("DONOR_PROFILE", "JOB_ORDERS", "ENGAGEMENTS", "CERTIFICATION_CYCLES"))
              and num(egp_row.get("quotedDraft")) and num(egp_row.get("invoiceRequested")) and egp_row.get("invoiced") is None
              and egp_row.get("collected") is None
              and s_b == 200 and b_sections.get("OPPORTUNITIES") == 0 and b_sections.get("QUOTES") == 0
              and s_sup == 404 and s_miss == 404, f"{s_a} {sections} {egp_row} {s_b} {b_sections} {s_sup} {s_miss}")

        failed = [r for r in RESULTS if r["result"] != "PASS"]
        print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
        exit_code = 0 if not failed else 1
    finally:
        opp_ids = [rid for model, rid in created if model == OPP]
        if opp_ids:
            ids = ",".join(map(str, opp_ids))
            quotes = [r["id"] for r in search(SALE_ORDER, f"self.opportunity.id in ({ids})")]
            if quotes:
                qids = ",".join(map(str, quotes))
                for model, domain in ((INVOICE_REQUEST, f"self.quote.id in ({qids})"),
                                      (REVIEW_EVENT, f"self.review.quote.id in ({qids})"), (REVIEW, f"self.quote.id in ({qids})"),
                                      (TIMETABLE, f"self.saleOrder.id in ({qids})"),
                                      (SALE_ORDER_LINE, f"self.saleOrder.id in ({qids}) OR self.oldVersionSaleOrder.id in ({qids})"),
                                      (SALE_ORDER, f"self.id in ({qids})")):
                    for row in search(model, domain):
                        if (model, row["id"]) not in created:
                            created.append((model, row["id"]))
            contracts = [r["id"] for r in search(CONTRACT, f"self.opportunity.id in ({ids})")]
            if contracts:
                cids = ",".join(map(str, contracts))
                for model, domain in ((REVIEW_EVENT, f"self.review.contract.id in ({cids})"), (REVIEW, f"self.contract.id in ({cids})")):
                    for row in search(model, domain):
                        if (model, row["id"]) not in created:
                            created.append((model, row["id"]))
                # renewal opportunities point at the contracts; delete them first
                for row in search(OPP, f"self.ioetiRenewalOf.id in ({cids})"):
                    admin.call("DELETE", f"/ws/rest/{OPP}/{row['id']}")
        order = {INVOICE_REQUEST: 0, REVIEW_EVENT: 0, REVIEW: 1, TIMETABLE: 1, SALE_ORDER_LINE: 1, SALE_ORDER: 2,
                 OPP: 4, ACCOUNT_MANAGEMENT: 5, PRODUCT: 6, PARTNER: 6, LINE: 6, ACCOUNT: 7, ACCOUNT_CONFIG: 8,
                 STOCK_CONFIG: 8, STOCK_LOCATION: 9, SEQUENCE_VERSION: 9, SEQUENCE: 9, USER: 10, GROUP: 11, PERM: 12, COMPANY: 13}
        complete_, leftovers = False, []
        try:
            cleanup(admin, [(m, r) for m, r in created if order.get(m, 99) <= 2], order)
            if opp_ids:
                for row in search(CONTRACT, f"self.opportunity.id in ({','.join(map(str, opp_ids))})"):
                    delete_contract(admin, row["id"])
            for model, rid in list(created):
                if model == SEQUENCE:
                    _delete_where(admin, RESERVED_SEQUENCE, f"self.sequenceVersion.sequence.id = {rid}")
                    for row in search(SEQUENCE_VERSION, f"self.sequence.id = {rid}"):
                        created.append((SEQUENCE_VERSION, row["id"]))
            complete_, leftovers = cleanup(admin, created, order)
        finally:
            if not complete_:
                print(f"FAIL cleanup left {leftovers}")
                exit_code = 1
            os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
            with open(os.path.join(ROOT, "logs", "workspace-probe.json"), "w", encoding="utf-8") as f:
                json.dump({"results": RESULTS, "cleanup_complete": complete_}, f, indent=2)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
