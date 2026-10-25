#!/usr/bin/env python3
"""D-11 binding commitments on uploaded evidence: live probe against a RUNNING local/CI Axelor; never against production.
Roles are TEST FIXTURES: a salesperson who owns the opportunities, quotations and contracts; a general manager (Axelor role
ioeti-gm, given by the administrator) with native rights on quotations and contracts; a person with no rights; and a policy
owner the administrator appoints. Every record is removed afterwards; confirmed orders and active contracts are removed
with SQL in the disposable database (TEST FIXTURE clean-up only).
Checks:
  acceptance: the evidence must be a document filed on that quotation; kind, purchase order number and date are checked;
  someone without native rights is refused; recording it confirms the order natively and pins the document revision and
  its hash; an expired quotation is refused; a confirmed quotation is not accepted twice
  won: without the business line's sales.won-evidence nothing is won (POLICY_NOT_SET); with ACTIVE_CONTRACT an accepted
  quotation is not enough (WON_EVIDENCE_MISSING); with ACCEPTED_QUOTE it is; with ACTIVE_CONTRACT an activated contract is
  activation: the contract's view says POLICY_NOT_SET / NOT_SIGNATORY / READY; without sales.contract-signatory activation
  fails closed; the rep (not the signatory role) is refused; dates and the evidence document are checked; the general
  manager activates it natively on the signed copy (pinned revision and hash, signatory policy version, who and when);
  a contract is not activated twice; a contract review is not decided through approve (USE_CONTRACT_ACTIVATION)
Report: logs/commitment-probe.json.
"""
import base64
import hashlib
import json
import os
import secrets
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from db_migrate import DATABASE, psql  # noqa: E402
from probe_fixtures import CONTRACT, RESERVED_SEQUENCE, _delete_where, cleanup, delete_contract  # noqa: E402

USER, GROUP, PERM, ROLE = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission", "com.axelor.auth.db.Role"
PARTNER, PRODUCT, COMPANY, CURRENCY = ("com.axelor.apps.base.db.Partner", "com.axelor.apps.base.db.Product", "com.axelor.apps.base.db.Company",
                                       "com.axelor.apps.base.db.Currency")
STOCK_LOCATION, STOCK_CONFIG = "com.axelor.apps.stock.db.StockLocation", "com.axelor.apps.stock.db.StockConfig"
SUPPLYCHAIN_CONFIG = "com.axelor.apps.supplychain.db.SupplyChainConfig"
ACCOUNT, ACCOUNT_CONFIG = "com.axelor.apps.account.db.Account", "com.axelor.apps.account.db.AccountConfig"
ACCOUNT_MANAGEMENT = "com.axelor.apps.account.db.AccountManagement"
TAX, TAX_LINE, TAX_TYPE = "com.axelor.apps.account.db.Tax", "com.axelor.apps.account.db.TaxLine", "com.axelor.apps.account.db.TaxType"
SALE_ORDER, SALE_ORDER_LINE = "com.axelor.apps.sale.db.SaleOrder", "com.axelor.apps.sale.db.SaleOrderLine"
SALE_ORDER_LINE_TAX = "com.axelor.apps.sale.db.SaleOrderLineTax"
CONTRACT_LINE = "com.axelor.apps.contract.db.ContractLine"
SEQUENCE, SEQUENCE_VERSION = "com.axelor.apps.base.db.Sequence", "com.axelor.apps.base.db.SequenceVersion"
OPP, LINE = "com.axelor.apps.crm.db.Opportunity", "com.ioeti.businessline.db.BusinessLine"
VERSION, AUDIT = "com.ioeti.core.db.PolicyVersion", "com.ioeti.admin.db.AdminAuditEvent"
POLICY_TAX = "com.ioeti.commercial.db.PolicyTaxLine"
REVIEW, REVIEW_EVENT = "com.ioeti.workspace.db.ReviewRequest", "com.ioeti.workspace.db.ReviewEvent"
DOC, REV = "com.ioeti.content.db.RecordDocument", "com.ioeti.content.db.DocumentRevision"
META_FILE, NOTICE = "com.axelor.meta.db.MetaFile", "com.ioeti.automation.db.InboxNotice"
QUOTES, WS, P, OPPS = "/ws/ioeti/quotes", "/ws/ioeti/workspace", "/ws/ioeti/policies", "/ws/ioeti/opportunities"
OWNER_ROLE, GM_ROLE = "ioeti-policy-owner", "ioeti-gm"
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:240]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def obj(body):
    return (body.get("object") if isinstance(body, dict) else None) or {}


def err(body):
    e = (body.get("error") or {}) if isinstance(body, dict) else {}
    return e.get("code"), ((e.get("fields") or [{}])[0]).get("field"), ((e.get("fields") or [{}])[0]).get("code")


def pdf(text):
    return b"%PDF-1.4\n% " + text.encode() + b"\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"


def main():
    admin = Client()
    assert admin.login(os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin")),
                       os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
    tag = secrets.token_hex(3).upper()
    created = []

    def create(model, values):
        _, body = rest_create(admin, model, values)
        if not ok(body):
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}: {json.dumps(body)[:200]}")
        created.append((model, body["data"][0]["id"]))
        return body["data"][0]

    def search(model, domain, fields=("id",), limit=500):
        _, body = admin.call("POST", f"/ws/rest/{model}/search", {"fields": list(fields), "limit": limit, "data": {"_domain": domain, "_archived": True}})
        return body.get("data") or []

    def fetch(model, rid, fields):
        _, body = admin.call("POST", f"/ws/rest/{model}/{rid}/fetch", {"fields": list(fields)})
        return (body.get("data") or [{}])[0]

    def version(model, rid):
        return fetch(model, rid, ["version"]).get("version")

    if search(USER, f"EXISTS (SELECT r FROM Role r WHERE r.name = '{OWNER_ROLE}' AND r MEMBER OF self.roles)"):
        raise SystemExit("this database already has policy owners; run the probe on a disposable database")
    if search(VERSION, "self.policyKey LIKE 'sales.%' OR self.policyKey = 'finance.tax'"):
        raise SystemExit("this database already has sales or tax policies; run the probe on a disposable database")
    roles_before = {r["name"] for r in search(ROLE, f"self.name IN ('{OWNER_ROLE}', '{GM_ROLE}')", ("name",))}
    taxes_before = {r["id"] for r in search(TAX, "self.code LIKE 'IOETI-%'")}
    tax_types_before = {r["id"] for r in search(TAX_TYPE, "self.code LIKE 'IOETI-%'")}
    exit_code = 1
    users = {}
    co = None
    try:
        egp = search(CURRENCY, "self.codeISO = 'EGP'")[0]
        co = create(COMPANY, {"name": f"Commitment Probe Co {tag}", "code": f"CM{tag}", "currency": {"id": egp["id"]}})
        location = create(STOCK_LOCATION, {"name": f"Commitment probe {tag}", "company": {"id": co["id"]}, "typeSelect": 1})
        create(STOCK_CONFIG, {"company": {"id": co["id"]}, "pickupDefaultStockLocation": {"id": location["id"]}})
        create(SUPPLYCHAIN_CONFIG, {"company": {"id": co["id"]}})
        create(ACCOUNT_CONFIG, {"company": {"id": co["id"]}})
        create(SEQUENCE, {"name": f"Quotations probe {tag}", "codeSelect": "saleOrder", "company": {"id": co["id"]}, "prefixe": f"Q{tag}-",
                          "padding": 4, "toBeAdded": 1})
        create(SEQUENCE, {"company": {"id": co["id"]}, "name": f"TEST ONLY contracts {tag}", "codeSelect": "customerContract", "padding": 4,
                          "toBeAdded": 1, "prefixe": f"K{tag}-", "sequenceVersionList": [{"startDate": "2026-01-01", "nextNum": 1}]})
        ledger = create(ACCOUNT, {"name": f"TEST ONLY sales {tag}", "code": f"C{tag}", "company": {"id": co["id"]}, "commonPosition": 0})
        product = create(PRODUCT, {"name": f"Commitment probe audit day {tag}", "code": f"CM-{tag}", "sellable": True, "salePrice": "10000",
                                   "saleCurrency": {"id": egp["id"]}, "productTypeSelect": "service"})
        create(ACCOUNT_MANAGEMENT, {"company": {"id": co["id"]}, "product": {"id": product["id"]}, "typeSelect": 1, "saleAccount": {"id": ledger["id"]}})
        line = create(LINE, {"code": f"CML{tag}", "nameEn": f"Commitment probe line {tag}", "nameAr": "خط تجريبي", "statusSelect": 2})
        account = create(PARTNER, {"name": f"عميل الالتزام {tag}", "isProspect": True, "partnerTypeSelect": 1})

        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"cmprobe.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})
        rwc = dict(canRead=True, canWrite=True, canCreate=True)
        own = [perm("opp", OPP, "self.user = ?", **rwc), perm("so", SALE_ORDER, "self.salespersonUser = ?", **rwc),
               perm("sol", SALE_ORDER_LINE, "self.saleOrder.salespersonUser = ?", canRead=True, canWrite=True, canCreate=True, canRemove=True),
               perm("contract", CONTRACT, "self.opportunity.user = ?", **rwc), perm("cline", CONTRACT_LINE, canRead=True, canCreate=True),
               perm("product", PRODUCT, canRead=True), perm("partner", PARTNER, canRead=True), perm("line", LINE, canRead=True),
               perm("review", REVIEW, **rwc)]
        signer = [perm("g.opp", OPP, canRead=True), perm("g.so", SALE_ORDER, **rwc), perm("g.contract", CONTRACT, **rwc),
                  perm("g.cline", CONTRACT_LINE, canRead=True), perm("g.partner", PARTNER, canRead=True), perm("g.line", LINE, canRead=True),
                  perm("g.review", REVIEW, **rwc)]
        none = [perm("n.partner", PARTNER, canRead=True)]
        groups = {k: create(GROUP, {"code": f"cmprobe-{k}-{tag}", "name": f"Commitment probe {k} {tag}", "permissions": [{"id": p["id"]} for p in v]})
                  for k, v in (("rep", own), ("signer", signer), ("none", none))}
        found = search(ROLE, f"self.name = '{GM_ROLE}'")
        gm_role = found[0]["id"] if found else create(ROLE, {"name": GM_ROLE})["id"]
        sessions = {}
        for label, group, roles in (("Rep", "rep", []), ("GM", "signer", [gm_role]), ("Other", "none", []), ("Owner", "none", [])):
            password = "Cm!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"cmprobe.{label.lower()}.{tag}", "name": f"Commitment probe {label} {tag}", "blocked": False,
                                         "language": "ar", "group": {"id": groups[group]["id"]}, "activeCompany": {"id": co["id"]},
                                         "roles": [{"id": r} for r in roles], "password": axelor_password_hash(password)})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        rep, gm, other, owner = (sessions[k] for k in ("Rep", "GM", "Other", "Owner"))
        s, _ = admin.call("POST", P + "/owners", {"userId": users["Owner"]["id"]})
        assert s == 200, f"appointing the policy owner: {s}"
        today = date.today()

        def set_policy(key, value, scope=None):
            body = {"value": value, "reason": f"probe {tag}"}
            if scope:
                body["scope"] = scope
            s_, b_ = owner.call("POST", f"{P}/{key}", body)
            assert s_ == 201, f"setting {key}: {s_} {b_}"

        set_policy("finance.tax", {"ratePercent": 14, "name": f"VAT probe {tag}", "type": "VAT"})
        set_policy("sales.quote-approval", {"tiers": [{"maxDiscountPercent": 5, "approver": "NONE"}]}, scope=line["code"])
        set_policy("sales.quote-validity", {"days": 30}, scope=line["code"])

        def opportunity(name):
            return create(OPP, {"name": f"Commitment probe {name} {tag}", "user": {"id": users["Rep"]["id"]}, "partner": {"id": account["id"]},
                                "ioetiBusinessLine": {"id": line["id"]}})

        def finalized_quote(opp):
            _, b_ = rep.call("POST", QUOTES, {"opportunityId": opp["id"], "opportunityVersion": version(OPP, opp["id"])})
            qid = obj(b_).get("id")
            rep.call("POST", f"{QUOTES}/{qid}/lines", {"version": version(SALE_ORDER, qid), "productId": product["id"], "quantity": 1})
            s_, b_ = rep.call("POST", f"{QUOTES}/{qid}/finalize", {"version": version(SALE_ORDER, qid)})
            assert s_ == 200, f"finalizing: {s_} {b_}"
            return qid

        def file_doc(client, subject, subject_id, title, kind="EVIDENCE"):
            s_, b_ = client.call("POST", "/ws/ioeti/content/documents", {"subject": subject, "subjectId": subject_id, "title": title, "kind": kind,
                                                                         "fileName": f"{title}.pdf", "contentBase64": base64.b64encode(pdf(title)).decode()})
            return s_, obj(b_)

        def accept(client, qid, **body):
            return client.call("POST", f"{WS}/quotes/{qid}/accept", {"version": version(SALE_ORDER, qid), **body})

        # --- client acceptance ---------------------------------------------------------------------------------------------
        opp1 = opportunity("accepted")
        q1 = finalized_quote(opp1)
        s_doc_opp, doc_opp = file_doc(rep, "OPPORTUNITY", opp1["id"], f"Elsewhere {tag}")
        s_missing, b_missing = accept(rep, q1, kind="SIGNED_QUOTE", acceptedOn=today.isoformat())
        s_elsewhere, b_elsewhere = accept(rep, q1, kind="SIGNED_QUOTE", acceptedOn=today.isoformat(), documentId=doc_opp.get("id"))
        s_doc, doc = file_doc(rep, "QUOTE", q1, f"Signed quote {tag}")
        bad = [accept(rep, q1, kind="EMAIL", acceptedOn=today.isoformat(), documentId=doc.get("id")),
               accept(rep, q1, kind="PURCHASE_ORDER", acceptedOn=today.isoformat(), documentId=doc.get("id")),
               accept(rep, q1, kind="SIGNED_QUOTE", acceptedOn=(today + timedelta(days=1)).isoformat(), documentId=doc.get("id"))]
        s_other, _ = accept(other, q1, kind="SIGNED_QUOTE", acceptedOn=today.isoformat(), documentId=doc.get("id"))
        check("acceptance needs a document filed on that quotation; kind, purchase order number and date are checked; no rights → refused",
              (s_doc_opp, s_doc) == (201, 201) and (s_missing, err(b_missing)[1]) == (422, "documentId") and (s_elsewhere, err(b_elsewhere)[1]) == (422, "documentId")
              and [(s_, err(b_)[1]) for s_, b_ in bad] == [(422, "kind"), (422, "reference"), (422, "acceptedOn")] and s_other in (403, 404)
              and fetch(SALE_ORDER, q1, ["statusSelect"]).get("statusSelect") == 2,
              (s_doc_opp, s_doc, s_missing, err(b_missing), s_elsewhere, err(b_elsewhere), [(s_, err(b_)) for s_, b_ in bad], s_other))

        s_acc, b_acc = accept(rep, q1, kind="PURCHASE_ORDER", reference=f" PO-{tag} ", acceptedOn=today.isoformat(), documentId=doc.get("id"))
        native = fetch(SALE_ORDER, q1, ["statusSelect", "ioetiAcceptanceKind", "ioetiAcceptanceReference", "ioetiAcceptedOn", "ioetiAcceptanceDocument",
                                        "ioetiAcceptanceRevision", "ioetiAcceptanceSha256", "ioetiAcceptedBy"])
        view = obj(rep.call("GET", f"{QUOTES}/{q1}")[1])
        s_twice, b_twice = accept(rep, q1, kind="SIGNED_QUOTE", acceptedOn=today.isoformat(), documentId=doc.get("id"))
        check("recording the acceptance confirms the order natively and pins the document revision and its hash; not twice",
              s_acc == 200 and native.get("statusSelect") == 3 and native.get("ioetiAcceptanceKind") == "PURCHASE_ORDER"
              and native.get("ioetiAcceptanceReference") == f"PO-{tag}" and native.get("ioetiAcceptedOn") == today.isoformat()
              and native.get("ioetiAcceptanceDocument") == doc.get("id") and native.get("ioetiAcceptanceRevision") == 1
              and native.get("ioetiAcceptanceSha256") == hashlib.sha256(pdf(f"Signed quote {tag}")).hexdigest()
              and (native.get("ioetiAcceptedBy") or {}).get("id") == users["Rep"]["id"] and view.get("status") == "CONFIRMED"
              and (view.get("approval") or {}).get("acceptance", {}).get("documentId") == doc.get("id")
              and (s_twice, err(b_twice)[0]) == (422, "QUOTE_NOT_FINALIZED"),
              (s_acc, err(b_acc), native, view.get("status"), (view.get("approval") or {}).get("acceptance"), s_twice, err(b_twice)))

        opp2 = opportunity("expired")
        q2 = finalized_quote(opp2)
        _, doc2 = file_doc(rep, "QUOTE", q2, f"Late PO {tag}")
        # TEST FIXTURE: the validity ran out (no product API moves the date)
        admin.call("POST", f"/ws/rest/{SALE_ORDER}/{q2}", {"data": {"id": q2, "version": version(SALE_ORDER, q2),
                                                                    "endOfValidityDate": (today - timedelta(days=1)).isoformat()}})
        s_exp, b_exp = accept(rep, q2, kind="SIGNED_QUOTE", acceptedOn=today.isoformat(), documentId=doc2.get("id"))
        check("an expired quotation is not accepted (QUOTE_EXPIRED), nothing confirmed",
              (s_exp, err(b_exp)[0]) == (422, "QUOTE_EXPIRED") and fetch(SALE_ORDER, q2, ["statusSelect"]).get("statusSelect") == 2, (s_exp, err(b_exp)))

        # --- won ------------------------------------------------------------------------------------------------------------
        stages = obj(rep.call("GET", f"{OPPS}/stages")[1])
        won = next((st for st in stages if st.get("kind") == "WON"), {})

        def win(opp):
            return rep.call("POST", f"{OPPS}/{opp['id']}/stage", {"version": version(OPP, opp["id"]), "stageId": won.get("id")})

        s_nopol, b_nopol = win(opp1)
        set_policy("sales.won-evidence", {"evidence": "ACTIVE_CONTRACT"}, scope=line["code"])
        s_nocontract, b_nocontract = win(opp1)
        set_policy("sales.won-evidence", {"evidence": "ACCEPTED_QUOTE"}, scope=line["code"])
        s_won, b_won = win(opp1)
        s_notyet, b_notyet = win(opp2)
        check("won: without the line's setting → POLICY_NOT_SET; ACTIVE_CONTRACT needs a contract; ACCEPTED_QUOTE wins on the recorded acceptance",
              bool(won) and (s_nopol, err(b_nopol)[0]) == (422, "POLICY_NOT_SET") and (s_nocontract, err(b_nocontract)[0]) == (422, "WON_EVIDENCE_MISSING")
              and s_won == 200 and obj(b_won).get("stageKind") == "WON" and (s_notyet, err(b_notyet)[0]) == (422, "WON_EVIDENCE_MISSING"),
              (won, s_nopol, err(b_nopol), s_nocontract, err(b_nocontract), s_won, obj(b_won).get("stageKind"), s_notyet, err(b_notyet)))

        # --- contract activation ----------------------------------------------------------------------------------------------
        opp3 = opportunity("contract")
        q3 = finalized_quote(opp3)
        _, b_c = rep.call("POST", "/ws/ioeti/contracts", {"opportunityId": opp3["id"], "opportunityVersion": version(OPP, opp3["id"]), "contractType": "BILLING"})
        cid = obj(b_c).get("id")
        rep.call("POST", f"/ws/ioeti/contracts/{cid}/lines-from-quote", {"version": version(CONTRACT, cid), "quoteId": q3})

        def activation(client):
            return obj(client.call("GET", f"/ws/ioeti/contracts/{cid}")[1]).get("activation") or {}

        def activate(client, **body):
            return client.call("POST", f"{WS}/contracts/{cid}/activate", {"version": version(CONTRACT, cid), **body})

        before = activation(rep)
        _, signed = file_doc(rep, "CONTRACT", cid, f"Signed contract {tag}", kind="CONTRACT")
        s_nopol, b_nopol = activate(gm, signedOn=today.isoformat(), documentId=signed.get("id"))
        set_policy("sales.contract-signatory", {"signatory": "GM"}, scope=line["code"])
        rep_view, gm_view = activation(rep), activation(gm)
        s_rep, b_rep = activate(rep, signedOn=today.isoformat(), documentId=signed.get("id"))
        _, quote_doc = file_doc(rep, "QUOTE", q3, f"Not the contract {tag}")
        bad = [activate(gm, signedOn=(today + timedelta(days=1)).isoformat(), documentId=signed.get("id")),
               activate(gm, signedOn=today.isoformat(), startOn=(today - timedelta(days=1)).isoformat(), documentId=signed.get("id")),
               activate(gm, signedOn=today.isoformat(), documentId=quote_doc.get("id"))]
        s_none, _ = activate(other, signedOn=today.isoformat(), documentId=signed.get("id"))
        check("activation: POLICY_NOT_SET until the signatory is set; the rep sees NOT_SIGNATORY and is refused (403); the general manager"
              " sees READY; dates and the evidence document are checked; no rights → refused",
              before.get("status") == "POLICY_NOT_SET" and (s_nopol, err(b_nopol)[0]) == (422, "POLICY_NOT_SET")
              and rep_view.get("status") == "NOT_SIGNATORY" and rep_view.get("signatory") == "GM" and gm_view.get("status") == "READY"
              and (s_rep, err(b_rep)[0]) == (403, "NOT_SIGNATORY")
              and [(s_, err(b_)[1]) for s_, b_ in bad] == [(422, "signedOn"), (422, "startOn"), (422, "documentId")] and s_none in (403, 404)
              and fetch(CONTRACT, cid, ["statusSelect"]).get("statusSelect") == 1,
              (before, s_nopol, err(b_nopol), rep_view, gm_view, s_rep, err(b_rep), [(s_, err(b_)) for s_, b_ in bad], s_none))

        s_act, b_act = activate(gm, signedOn=(today - timedelta(days=2)).isoformat(), startOn=today.isoformat(), documentId=signed.get("id"))
        native = fetch(CONTRACT, cid, ["statusSelect", "startDate", "ioetiSignatureDocument", "ioetiSignatureRevision", "ioetiSignatureSha256",
                                       "ioetiSignedOn", "ioetiActivatedBy", "ioetiSignatoryPolicy"])
        after = activation(rep)
        s_again, b_again = activate(gm, signedOn=today.isoformat(), documentId=signed.get("id"))
        check("the general manager activates natively on the signed copy: active from the start date, revision and hash pinned, signatory"
              " policy version, who; not twice",
              s_act == 200 and native.get("statusSelect") == 2 and native.get("startDate") == today.isoformat()
              and native.get("ioetiSignatureDocument") == signed.get("id") and native.get("ioetiSignatureRevision") == 1
              and native.get("ioetiSignatureSha256") == hashlib.sha256(pdf(f"Signed contract {tag}")).hexdigest()
              and native.get("ioetiSignedOn") == (today - timedelta(days=2)).isoformat()
              and (native.get("ioetiActivatedBy") or {}).get("id") == users["GM"]["id"] and native.get("ioetiSignatoryPolicy")
              and after.get("status") == "SIGNED" and after.get("documentId") == signed.get("id")
              and (s_again, err(b_again)[0]) == (422, "CONTRACT_NOT_DRAFT"),
              (s_act, err(b_act), native, after, s_again, err(b_again)))

        set_policy("sales.won-evidence", {"evidence": "ACTIVE_CONTRACT"}, scope=line["code"])
        s_won3, b_won3 = win(opp3)
        # a contract review is decided by activation, not through approve
        opp4 = opportunity("review")
        _, b_c4 = rep.call("POST", "/ws/ioeti/contracts", {"opportunityId": opp4["id"], "opportunityVersion": version(OPP, opp4["id"]), "contractType": "BILLING"})
        c4 = obj(b_c4).get("id")
        _, b_r = rep.call("POST", f"{WS}/reviews", {"contractId": c4, "version": version(CONTRACT, c4)})
        rid = obj(b_r).get("id")
        s_rev, b_rev = gm.call("POST", f"{WS}/reviews/{rid}/approve", {"version": version(REVIEW, rid)})
        check("won on ACTIVE_CONTRACT once the contract is activated; a contract review is not approved (USE_CONTRACT_ACTIVATION)",
              s_won3 == 200 and obj(b_won3).get("stageKind") == "WON" and (s_rev, err(b_rev)[0]) == (422, "USE_CONTRACT_ACTIVATION"),
              (s_won3, err(b_won3), s_rev, err(b_rev)))

        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
        print(f"\n{sum(r['result'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} checks passed")
    finally:
        if co:
            # TEST FIXTURE clean-up in the disposable database: confirmed orders and active contracts are not removable by API
            psql(DATABASE, f"UPDATE sale_sale_order SET status_select = 1 WHERE company = {int(co['id'])};")
            for c in search(CONTRACT, f"self.company.id = {co['id']}"):
                for model, domain in ((REVIEW_EVENT, f"self.review.contract.id = {c['id']}"), (REVIEW, f"self.contract.id = {c['id']}")):
                    created.extend((model, r["id"]) for r in search(model, domain) if (model, r["id"]) not in created)
            quotes = [r["id"] for r in search(SALE_ORDER, f"self.company.id = {co['id']}")]
            if quotes:
                qids = ",".join(map(str, quotes))
                for model, domain in ((REVIEW_EVENT, f"self.review.quote.id in ({qids})"), (REVIEW, f"self.quote.id in ({qids})"),
                                      (SALE_ORDER_LINE_TAX, f"self.saleOrder.id in ({qids})"),
                                      (SALE_ORDER_LINE, f"self.saleOrder.id in ({qids}) OR self.oldVersionSaleOrder.id in ({qids})"),
                                      (SALE_ORDER, f"self.id in ({qids})")):
                    created.extend((model, r["id"]) for r in search(model, domain) if (model, r["id"]) not in created)
            # documents filed on the probe's records (subject codes: OPPORTUNITY 2, QUOTE 4, CONTRACT 5)
            subjects = {4: quotes, 5: [c["id"] for c in search(CONTRACT, f"self.company.id = {co['id']}")],
                        2: [rid for m, rid in created if m == OPP]}
            for code, ids in subjects.items():
                if ids:
                    for d in search(DOC, f"self.subjectSelect = {code} AND self.subjectId in ({','.join(map(str, ids))})"):
                        for r in search(REV, f"self.document.id = {d['id']}", ("id", "file")):
                            created.append((REV, r["id"]))
                            if r.get("file"):
                                created.append((META_FILE, r["file"]["id"]))
                        created.append((DOC, d["id"]))
            for c in search(CONTRACT, f"self.company.id = {co['id']}"):
                _delete_where(admin, REVIEW_EVENT, f"self.review.contract.id = {c['id']}")
                _delete_where(admin, REVIEW, f"self.contract.id = {c['id']}")
                delete_contract(admin, c["id"])
            for seq in search(SEQUENCE, f"self.company.id = {co['id']}"):
                _delete_where(admin, RESERVED_SEQUENCE, f"self.sequence.id = {seq['id']}")
                created.extend((SEQUENCE_VERSION, r["id"]) for r in search(SEQUENCE_VERSION, f"self.sequence.id = {seq['id']}"))
                if (SEQUENCE, seq["id"]) not in created:
                    created.append((SEQUENCE, seq["id"]))
        created.extend((POLICY_TAX, r["id"]) for r in search(POLICY_TAX, "self.id > 0"))
        new_taxes = [r["id"] for r in search(TAX, "self.code LIKE 'IOETI-%'") if r["id"] not in taxes_before]
        if new_taxes:
            created.extend((TAX_LINE, r["id"]) for r in search(TAX_LINE, f"self.tax.id in ({','.join(map(str, new_taxes))})"))
            for tid in new_taxes:
                admin.call("POST", f"/ws/rest/{TAX}/{tid}", {"data": {"id": tid, "version": version(TAX, tid), "activeTaxLine": None}})
            created.extend((TAX, t) for t in new_taxes)
        created.extend((TAX_TYPE, r["id"]) for r in search(TAX_TYPE, "self.code LIKE 'IOETI-%'") if r["id"] not in tax_types_before)
        ids = [x["id"] for x in users.values()]
        if ids:
            joined = ",".join(map(str, ids))
            created.extend((NOTICE, n["id"]) for n in search(NOTICE, f"self.recipient.id in ({joined})"))
            created.extend((VERSION, v["id"]) for v in search(VERSION, f"self.author.id in ({joined})"))
            created.extend((AUDIT, a["id"]) for a in search(AUDIT, f"self.actor.id in ({joined}) OR (self.subject = 'USER' AND self.subjectId in ({joined}))"))
            for user in users.values():
                current = fetch(USER, user["id"], ["version"])
                if current:
                    admin.call("POST", f"/ws/rest/{USER}/{user['id']}", {"data": {"id": user["id"], "version": current.get("version"), "roles": [], "blocked": True}})
            created.extend((AUDIT, a["id"]) for a in search(AUDIT, f"self.subject = 'USER' AND self.action LIKE 'POLICY_OWNER_%' AND self.subjectId in ({joined})"))
        for name in (OWNER_ROLE, GM_ROLE):
            if name not in roles_before:
                created.extend((ROLE, r["id"]) for r in search(ROLE, f"self.name = '{name}'") if (ROLE, r["id"]) not in created)
        order = {REVIEW_EVENT: 0, NOTICE: 0, REV: 0, REVIEW: 1, DOC: 1, META_FILE: 2, SALE_ORDER_LINE_TAX: 0, SALE_ORDER_LINE: 1, SALE_ORDER: 2,
                 POLICY_TAX: 3, TAX_LINE: 4, TAX: 5, TAX_TYPE: 6, VERSION: 4, AUDIT: 4, OPP: 4, ACCOUNT_MANAGEMENT: 5, PRODUCT: 6, PARTNER: 6,
                 LINE: 6, ACCOUNT: 7, ACCOUNT_CONFIG: 8, STOCK_CONFIG: 8, SUPPLYCHAIN_CONFIG: 8, STOCK_LOCATION: 9, SEQUENCE_VERSION: 9,
                 SEQUENCE: 10, ROLE: 12, USER: 11, GROUP: 12, PERM: 13, COMPANY: 14}
        complete, left = cleanup(admin, list(dict.fromkeys(created)), order)
        if not complete:
            print(f"FAIL cleanup left {left}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "commitment-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
