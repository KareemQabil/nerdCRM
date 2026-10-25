#!/usr/bin/env python3
"""D-11 quotation approval from the owners' policies: live probe against a RUNNING local/CI Axelor; never against production.
Roles are TEST FIXTURES: a salesperson who owns the quotations, a peer with the same native rights and no approver role,
a sales manager and a general manager (the Axelor roles ioeti-sales-manager and ioeti-gm, given by the administrator),
and a policy owner the administrator appoints. Every record is removed afterwards.
Checks:
  fail closed: without the approval and validity policies a draft cannot be finalized (POLICY_NOT_SET) and shows why
  tiers: a line discount (native, checked) selects the first tier that covers the discount and value; above every tier
  the quotation is refused (OUTSIDE_APPROVAL_TIERS); a tier with an approver refuses direct finalizing (APPROVAL_REQUIRED)
  numbering: a company without a quotation sequence is told so (SALES_SEQUENCE_MISSING), nothing is finalized
  no approval needed: the rep finalizes natively (number from the sequence, end of validity from the policy, approval recorded)
  review: holders of the tier's role get a notice; the requester, a peer without the role and a holder of another role
  cannot decide (403); a quotation changed after the request is refused (409); the manager approves: native finalize with
  the tier, discount, approver, policy versions and validity; the requester is told; deciding twice is refused
  reject: a holder of the tier's role rejects with a reason; the quotation stays a draft; the requester is told
  sending: only a finalized, still valid quotation is recorded as sent, by someone with native rights; nothing is e-mailed
Report: logs/quote-approval-probe.json.
"""
import json
import os
import secrets
import sys
from datetime import date, timedelta
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import RESERVED_SEQUENCE, _delete_where, cleanup  # noqa: E402

USER, GROUP, PERM, ROLE = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission", "com.axelor.auth.db.Role"
PARTNER, PRODUCT, COMPANY = "com.axelor.apps.base.db.Partner", "com.axelor.apps.base.db.Product", "com.axelor.apps.base.db.Company"
CURRENCY = "com.axelor.apps.base.db.Currency"
STOCK_LOCATION, STOCK_CONFIG = "com.axelor.apps.stock.db.StockLocation", "com.axelor.apps.stock.db.StockConfig"
ACCOUNT, ACCOUNT_CONFIG = "com.axelor.apps.account.db.Account", "com.axelor.apps.account.db.AccountConfig"
ACCOUNT_MANAGEMENT = "com.axelor.apps.account.db.AccountManagement"
TAX, TAX_LINE, TAX_TYPE = "com.axelor.apps.account.db.Tax", "com.axelor.apps.account.db.TaxLine", "com.axelor.apps.account.db.TaxType"
SALE_ORDER, SALE_ORDER_LINE = "com.axelor.apps.sale.db.SaleOrder", "com.axelor.apps.sale.db.SaleOrderLine"
SALE_ORDER_LINE_TAX = "com.axelor.apps.sale.db.SaleOrderLineTax"
SEQUENCE, SEQUENCE_VERSION = "com.axelor.apps.base.db.Sequence", "com.axelor.apps.base.db.SequenceVersion"
OPP, LINE = "com.axelor.apps.crm.db.Opportunity", "com.ioeti.businessline.db.BusinessLine"
VERSION, AUDIT = "com.ioeti.core.db.PolicyVersion", "com.ioeti.admin.db.AdminAuditEvent"
POLICY_TAX = "com.ioeti.commercial.db.PolicyTaxLine"
REVIEW, REVIEW_EVENT = "com.ioeti.workspace.db.ReviewRequest", "com.ioeti.workspace.db.ReviewEvent"
NOTICE = "com.ioeti.automation.db.InboxNotice"
QUOTES, WS, P = "/ws/ioeti/quotes", "/ws/ioeti/workspace", "/ws/ioeti/policies"
OWNER_ROLE, MANAGER_ROLE, GM_ROLE = "ioeti-policy-owner", "ioeti-sales-manager", "ioeti-gm"
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:240]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def obj(body):
    return (body.get("object") if isinstance(body, dict) else None) or {}


def err(body):
    e = (body.get("error") or {}) if isinstance(body, dict) else {}
    return e.get("code"), ((e.get("fields") or [{}])[0]).get("field"), ((e.get("fields") or [{}])[0]).get("code")


def dec(value):
    return Decimal(str(value)) if value is not None else None


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
    if search(VERSION, "self.policyKey IN ('finance.tax', 'sales.quote-approval', 'sales.quote-validity')"):
        raise SystemExit("this database already has these policies; run the probe on a disposable database")
    roles_before = {r["name"] for r in search(ROLE, f"self.name IN ('{OWNER_ROLE}', '{MANAGER_ROLE}', '{GM_ROLE}')", ("name",))}
    taxes_before = {r["id"] for r in search(TAX, "self.code LIKE 'IOETI-%'")}
    tax_types_before = {r["id"] for r in search(TAX_TYPE, "self.code LIKE 'IOETI-%'")}
    exit_code = 1
    users = {}
    try:
        egp = search(CURRENCY, "self.codeISO = 'EGP'")[0]
        co = create(COMPANY, {"name": f"Approval Probe Co {tag}", "code": f"AP{tag}", "currency": {"id": egp["id"]}})
        location = create(STOCK_LOCATION, {"name": f"Approval probe {tag}", "company": {"id": co["id"]}, "typeSelect": 1})
        create(STOCK_CONFIG, {"company": {"id": co["id"]}, "pickupDefaultStockLocation": {"id": location["id"]}})
        create(ACCOUNT_CONFIG, {"company": {"id": co["id"]}})
        ledger = create(ACCOUNT, {"name": f"TEST ONLY sales {tag}", "code": f"A{tag}", "company": {"id": co["id"]}, "commonPosition": 0})
        product = create(PRODUCT, {"name": f"Approval probe audit day {tag}", "code": f"AP-{tag}", "sellable": True, "salePrice": "10000",
                                   "saleCurrency": {"id": egp["id"]}, "productTypeSelect": "service"})
        create(ACCOUNT_MANAGEMENT, {"company": {"id": co["id"]}, "product": {"id": product["id"]}, "typeSelect": 1, "saleAccount": {"id": ledger["id"]}})
        line = create(LINE, {"code": f"APL{tag}", "nameEn": f"Approval probe line {tag}", "nameAr": "خط تجريبي", "statusSelect": 2})
        account = create(PARTNER, {"name": f"عميل الموافقات {tag}", "isProspect": True, "partnerTypeSelect": 1})

        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"approbe.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})
        rwc = dict(canRead=True, canWrite=True, canCreate=True)
        own = [perm("opp", OPP, "self.user = ?", **rwc), perm("so", SALE_ORDER, "self.salespersonUser = ?", **rwc),
               perm("sol", SALE_ORDER_LINE, "self.saleOrder.salespersonUser = ?", canRead=True, canWrite=True, canCreate=True, canRemove=True),
               perm("product", PRODUCT, canRead=True), perm("partner", PARTNER, canRead=True), perm("line", LINE, canRead=True),
               perm("review", REVIEW, **rwc)]
        # reviewers see and change every quotation of the probe company (the approver still needs the tier's role)
        everyone = [perm("r.opp", OPP, canRead=True), perm("r.so", SALE_ORDER, **rwc), perm("r.sol", SALE_ORDER_LINE, **rwc),
                    perm("r.partner", PARTNER, canRead=True), perm("r.line", LINE, canRead=True), perm("r.review", REVIEW, **rwc)]
        none = [perm("n.partner", PARTNER, canRead=True)]
        groups = {k: create(GROUP, {"code": f"approbe-{k}-{tag}", "name": f"Approval probe {k} {tag}", "permissions": [{"id": p["id"]} for p in v]})
                  for k, v in (("rep", own), ("reviewer", everyone), ("none", none))}
        role_ids = {}
        for name in (MANAGER_ROLE, GM_ROLE):
            found = search(ROLE, f"self.name = '{name}'")
            role_ids[name] = found[0]["id"] if found else create(ROLE, {"name": name})["id"]
        sessions = {}
        for label, group, roles in (("Rep", "rep", []), ("Peer", "reviewer", []), ("Manager", "reviewer", [MANAGER_ROLE]),
                                    ("GM", "reviewer", [GM_ROLE]), ("Other", "none", []), ("Owner", "none", [])):
            password = "Ap!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"approbe.{label.lower()}.{tag}", "name": f"Approval probe {label} {tag}", "blocked": False,
                                         "language": "ar", "group": {"id": groups[group]["id"]}, "activeCompany": {"id": co["id"]},
                                         "roles": [{"id": role_ids[r]} for r in roles], "password": axelor_password_hash(password)})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        rep, peer, mgr, gm, other, owner = (sessions[k] for k in ("Rep", "Peer", "Manager", "GM", "Other", "Owner"))
        s, _ = admin.call("POST", P + "/owners", {"userId": users["Owner"]["id"]})
        assert s == 200, f"appointing the policy owner: {s}"
        today = date.today()

        def set_policy(key, value, scope=None):
            body = {"value": value, "reason": f"probe {tag}"}
            if scope:
                body["scope"] = scope
            s_, b_ = owner.call("POST", f"{P}/{key}", body)
            assert s_ == 201, f"setting {key}: {s_} {b_}"
            return b_

        def new_quote(name, quantity=1):
            opp = create(OPP, {"name": f"Approval probe {name} {tag}", "user": {"id": users["Rep"]["id"]}, "partner": {"id": account["id"]},
                               "ioetiBusinessLine": {"id": line["id"]}})
            _, b_ = rep.call("POST", QUOTES, {"opportunityId": opp["id"], "opportunityVersion": version(OPP, opp["id"])})
            q_ = obj(b_)
            _, b_ = rep.call("POST", f"{QUOTES}/{q_.get('id')}/lines", {"version": version(SALE_ORDER, q_.get("id")), "productId": product["id"],
                                                                       "quantity": quantity})
            return opp, obj(b_)

        def discount(client, q_, percent, line_id=None):
            return client.call("POST", f"{QUOTES}/{q_['id']}/lines/{line_id or q_['lines'][0]['id']}/discount",
                               {"version": version(SALE_ORDER, q_["id"]), "percent": percent})

        def finalize(client, qid):
            return client.call("POST", f"{QUOTES}/{qid}/finalize", {"version": version(SALE_ORDER, qid)})

        def decide(client, rid, action, **extra):
            return client.call("POST", f"{WS}/reviews/{rid}/{action}", {"version": version(REVIEW, rid), **extra})

        def inbox(client):
            return [(n["kind"], n["subject"], n["subjectId"]) for n in obj(client.call("GET", "/ws/ioeti/automation/inbox")[1]) or []]

        # --- fail closed ----------------------------------------------------------------------------------------
        opp1, q1 = new_quote("tiers")
        set_policy("finance.tax", {"ratePercent": 14, "name": f"VAT probe {tag}", "type": "VAT"})
        rep.call("POST", f"{QUOTES}/{q1['id']}/tax", {"version": version(SALE_ORDER, q1["id"])})
        s, body = finalize(rep, q1["id"])
        view = obj(rep.call("GET", f"{QUOTES}/{q1['id']}")[1])
        check("without the approval and validity policies a draft is not finalized (POLICY_NOT_SET) and shows why",
              (s, err(body)[0]) == (422, "POLICY_NOT_SET") and (view.get("approval") or {}).get("status") == "POLICY_NOT_SET"
              and fetch(SALE_ORDER, q1["id"], ["statusSelect"]).get("statusSelect") == 1, (s, err(body), view.get("approval")))

        set_policy("sales.quote-approval", {"tiers": [{"maxDiscountPercent": 5, "approver": "NONE"},
                                                      {"maxDiscountPercent": 15, "approver": "SALES_MANAGER"},
                                                      {"maxDiscountPercent": 30, "maxAmount": 50000, "approver": "GM"}]}, scope=line["code"])
        set_policy("sales.quote-validity", {"days": 30}, scope=line["code"])
        s_seq, b_seq = finalize(rep, q1["id"])  # tier NONE at 0%, but the company has no quotation sequence yet
        seq = create(SEQUENCE, {"name": f"Quotations probe {tag}", "codeSelect": "saleOrder", "company": {"id": co["id"]}, "prefixe": f"Q{tag}-",
                                "padding": 4, "toBeAdded": 1})
        check("without a quotation sequence the company is told so and nothing is finalized",
              (s_seq, err(b_seq)[0]) == (422, "SALES_SEQUENCE_MISSING") and fetch(SALE_ORDER, q1["id"], ["statusSelect"]).get("statusSelect") == 1,
              (s_seq, err(b_seq)))

        # --- tiers ------------------------------------------------------------------------------------------------
        bad = [discount(rep, q1, p) for p in (101, -1, "5.555")]
        s_other_line, b_other_line = discount(rep, q1, 5, line_id=10 ** 9)
        s_peer, _ = discount(other, q1, 5)
        s10, b10 = discount(rep, q1, 10)
        q = obj(b10)
        native_line = fetch(SALE_ORDER_LINE, q1["lines"][0]["id"], ["discountTypeSelect", "discountAmount", "priceDiscounted"])
        s_fin, b_fin = finalize(rep, q1["id"])
        check("a line discount is checked and set natively; 10% falls in the sales manager's tier, so direct finalizing is refused",
              [(s_, err(b_)[1], err(b_)[2]) for s_, b_ in bad] == [(422, "percent", "RANGE")] * 3
              and (s_other_line, err(b_other_line)[1]) == (422, "lineId") and s_peer in (403, 404) and s10 == 200
              and dec(q["lines"][0].get("discountPercent")) == 10 and dec(q.get("totalBeforeTax")) == Decimal("9000")
              and native_line.get("discountTypeSelect") == 1 and dec(native_line.get("priceDiscounted")) == Decimal("9000")
              and q.get("approval", {}).get("status") == "NEEDED" and q["approval"].get("approver") == "SALES_MANAGER"
              and dec(q["approval"].get("discountPercent")) == 10 and (s_fin, err(b_fin)[0]) == (422, "APPROVAL_REQUIRED"),
              ([(s_, err(b_)) for s_, b_ in bad], s_other_line, s_peer, s10, q.get("lines"), native_line, q.get("approval"), s_fin, err(b_fin)))

        s40, b40 = discount(rep, q1, 40)
        s_out, b_out = finalize(rep, q1["id"])
        _, q_cap = new_quote("cap", quantity=7)  # 70 000 at 20% = 56 000: within the GM tier's discount, above its 50 000 cap
        rep.call("POST", f"{QUOTES}/{q_cap['id']}/tax", {"version": version(SALE_ORDER, q_cap["id"])})
        capped = obj(discount(rep, q_cap, 20)[1])
        s_back, b_back = discount(rep, q1, 10)
        check("above every tier the quotation is refused (OUTSIDE_APPROVAL_TIERS); a tier's value cap counts too",
              s40 == 200 and obj(b40).get("approval", {}).get("status") == "OUTSIDE_APPROVAL_TIERS" and (s_out, err(b_out)[0]) == (422, "OUTSIDE_APPROVAL_TIERS")
              and capped.get("approval", {}).get("status") == "OUTSIDE_APPROVAL_TIERS" and dec(capped.get("totalBeforeTax")) == Decimal("56000")
              and s_back == 200 and obj(b_back).get("approval", {}).get("approver") == "SALES_MANAGER",
              (s40, obj(b40).get("approval"), s_out, err(b_out), capped.get("approval"), capped.get("totalBeforeTax"), s_back))

        # --- no approval needed ------------------------------------------------------------------------------------------
        opp2, q2 = new_quote("direct")
        rep.call("POST", f"{QUOTES}/{q2['id']}/tax", {"version": version(SALE_ORDER, q2["id"])})
        s_ok, b_ok = finalize(rep, q2["id"])
        done = obj(b_ok)
        native = fetch(SALE_ORDER, q2["id"], ["statusSelect", "saleOrderSeq", "endOfValidityDate", "ioetiApprovalTier", "ioetiApprovedBy",
                                              "ioetiApprovalPolicy", "ioetiValidityPolicy"])
        check("the rep finalizes a tier needing no approval natively: numbered, valid for the policy's days, approval recorded",
              s_ok == 200 and done.get("status") == "FINALIZED"
              and native.get("statusSelect") == 2 and (native.get("saleOrderSeq") or "").startswith(f"Q{tag}-")
              and native.get("endOfValidityDate") == (today + timedelta(days=30)).isoformat() and native.get("ioetiApprovalTier") == "NONE"
              and (native.get("ioetiApprovedBy") or {}).get("id") == users["Rep"]["id"] and native.get("ioetiApprovalPolicy")
              and native.get("ioetiValidityPolicy") and done.get("approval", {}).get("status") == "APPROVED"
              and done["approval"].get("validUntil") == (today + timedelta(days=30)).isoformat(),
              (s_ok, done.get("status"), native, done.get("approval")))

        # --- review: who decides ---------------------------------------------------------------------------------------
        s_req, b_req = rep.call("POST", f"{WS}/reviews", {"quoteId": q1["id"], "version": version(SALE_ORDER, q1["id"])})
        r1 = obj(b_req)
        notified = {k: inbox(sessions[k]).count(("REVIEW_APPROVAL_NEEDED", "OPPORTUNITY", opp1["id"])) for k in ("Manager", "GM", "Peer")}
        queue_m = {r["id"]: r for r in obj(mgr.call("GET", f"{WS}/reviews?pending=true")[1]) or []}
        queue_p = {r["id"]: r for r in obj(peer.call("GET", f"{WS}/reviews?pending=true")[1]) or []}
        check("asking for a review records the tier's approver; only its holders are told; only they see they may decide",
              s_req == 201 and r1.get("approver") == "SALES_MANAGER" and notified == {"Manager": 1, "GM": 0, "Peer": 0}
              and queue_m.get(r1.get("id"), {}).get("canDecide") is True and queue_p.get(r1.get("id"), {}).get("canDecide") is False
              and r1.get("canDecide") is False, (s_req, r1.get("approver"), notified, queue_m.get(r1.get("id")), queue_p.get(r1.get("id"))))

        s_own, b_own = decide(rep, r1["id"], "approve")
        s_np, b_np = decide(peer, r1["id"], "approve")
        s_gm, b_gm = decide(gm, r1["id"], "approve")
        s_none, _ = decide(other, r1["id"], "approve")
        s_nr, b_nr = decide(peer, r1["id"], "reject", reason="PRICING")
        check("the requester, a peer without the role and a holder of another role cannot decide; without native rights neither",
              (s_own, err(b_own)[0]) == (403, "OWN_REQUEST") and (s_np, err(b_np)[0]) == (403, "NOT_APPROVER")
              and (s_gm, err(b_gm)[0]) == (403, "NOT_APPROVER") and s_none in (403, 404) and (s_nr, err(b_nr)[0]) == (403, "NOT_APPROVER")
              and fetch(SALE_ORDER, q1["id"], ["statusSelect"]).get("statusSelect") == 1,
              (s_own, err(b_own), s_np, err(b_np), s_gm, err(b_gm), s_none, s_nr, err(b_nr)))

        s_12, _ = discount(rep, q1, 12)  # a real change after the request (still the sales manager's tier)
        s_chg, b_chg = decide(mgr, r1["id"], "approve")
        s_wd, _ = rep.call("POST", f"{WS}/reviews/{r1['id']}/withdraw", {"version": version(REVIEW, r1["id"])})
        s_req2, b_req2 = rep.call("POST", f"{WS}/reviews", {"quoteId": q1["id"], "version": version(SALE_ORDER, q1["id"])})
        r2 = obj(b_req2)
        check("a quotation changed after the request is refused (409 QUOTE_CHANGED); the rep withdraws and asks again",
              s_12 == 200 and (s_chg, err(b_chg)[0]) == (409, "QUOTE_CHANGED") and s_wd == 200 and s_req2 == 201, (s_12, s_chg, err(b_chg), s_wd, s_req2))

        s_ap, b_ap = decide(mgr, r2["id"], "approve", rationale="ok within margin")
        approved = obj(b_ap)
        native = fetch(SALE_ORDER, q1["id"], ["statusSelect", "saleOrderSeq", "endOfValidityDate", "ioetiApprovalTier", "ioetiApprovedBy",
                                              "ioetiDiscountPercent", "ioetiApprovalPolicy", "ioetiValidityPolicy"])
        s_twice, b_twice = decide(mgr, r2["id"], "approve")
        s_line, b_line = discount(rep, q1, 5)
        check("the manager approves: the quotation is finalized natively under the tier with the discount, approver, policy versions"
              " and validity; the requester is told; deciding again and changing it are refused",
              s_ap == 200 and approved.get("status") == "APPROVED" and approved.get("reviewedBy") == users["Manager"]["name"]
              and approved.get("rationale") == "ok within margin" and [e["kind"] for e in approved.get("events") or []][-1] == "APPROVED"
              and native.get("statusSelect") == 2 and (native.get("saleOrderSeq") or "").startswith(f"Q{tag}-")
              and native.get("ioetiApprovalTier") == "SALES_MANAGER" and (native.get("ioetiApprovedBy") or {}).get("id") == users["Manager"]["id"]
              and dec(native.get("ioetiDiscountPercent")) == 12 and native.get("endOfValidityDate") == (today + timedelta(days=30)).isoformat()
              and native.get("ioetiApprovalPolicy") and native.get("ioetiValidityPolicy")
              and inbox(rep).count(("REVIEW_APPROVED", "OPPORTUNITY", opp1["id"])) == 1
              and (s_twice, err(b_twice)[0]) == (422, "REVIEW_STATE") and (s_line, err(b_line)[0]) == (422, "QUOTE_NOT_DRAFT"),
              (s_ap, approved.get("status"), approved.get("reviewedBy"), native, s_twice, err(b_twice), s_line, err(b_line)))

        # --- reject ----------------------------------------------------------------------------------------------------
        opp3, q3 = new_quote("reject")
        rep.call("POST", f"{QUOTES}/{q3['id']}/tax", {"version": version(SALE_ORDER, q3["id"])})
        discount(rep, q3, 20)
        _, b_r3 = rep.call("POST", f"{WS}/reviews", {"quoteId": q3["id"], "version": version(SALE_ORDER, q3["id"])})
        r3 = obj(b_r3)
        s_mr, b_mr = decide(mgr, r3["id"], "reject", reason="PRICING")
        s_bad, b_bad = decide(gm, r3["id"], "reject", reason="NOPE")
        s_rj, b_rj = decide(gm, r3["id"], "reject", reason="PRICING", rationale="too deep")
        rejected = obj(b_rj)
        check("20% needs the general manager: the manager cannot reject it; the general manager rejects with a reason; the quotation"
              " stays a draft and the requester is told",
              r3.get("approver") == "GM" and (s_mr, err(b_mr)[0]) == (403, "NOT_APPROVER") and (s_bad, err(b_bad)[1]) == (422, "reason")
              and s_rj == 200 and rejected.get("status") == "REJECTED" and rejected.get("reason") == "PRICING" and rejected.get("rationale") == "too deep"
              and fetch(SALE_ORDER, q3["id"], ["statusSelect"]).get("statusSelect") == 1
              and inbox(rep).count(("REVIEW_REJECTED", "OPPORTUNITY", opp3["id"])) == 1,
              (r3.get("approver"), s_mr, err(b_mr), s_bad, err(b_bad), s_rj, rejected.get("status"), rejected.get("reason")))

        # --- sending ---------------------------------------------------------------------------------------------------
        s_draft, b_draft = rep.call("POST", f"{QUOTES}/{q3['id']}/sent", {"version": version(SALE_ORDER, q3["id"]), "via": "x"})
        s_none, _ = other.call("POST", f"{QUOTES}/{q1['id']}/sent", {"version": version(SALE_ORDER, q1["id"]), "via": "x"})
        s_long, b_long = rep.call("POST", f"{QUOTES}/{q1['id']}/sent", {"version": version(SALE_ORDER, q1["id"]), "via": "x" * 301})
        # TEST FIXTURE: the validity ran out (no product API moves the date)
        admin.call("POST", f"/ws/rest/{SALE_ORDER}/{q1['id']}", {"data": {"id": q1["id"], "version": version(SALE_ORDER, q1["id"]),
                                                                           "endOfValidityDate": (today - timedelta(days=1)).isoformat()}})
        expired = obj(rep.call("GET", f"{QUOTES}/{q1['id']}")[1])
        s_exp, b_exp = rep.call("POST", f"{QUOTES}/{q1['id']}/sent", {"version": version(SALE_ORDER, q1["id"]), "via": "x"})
        admin.call("POST", f"/ws/rest/{SALE_ORDER}/{q1['id']}", {"data": {"id": q1["id"], "version": version(SALE_ORDER, q1["id"]),
                                                                           "endOfValidityDate": (today + timedelta(days=30)).isoformat()}})
        s_sent, b_sent = rep.call("POST", f"{QUOTES}/{q1['id']}/sent", {"version": version(SALE_ORDER, q1["id"]), "via": " e-mail from my account "})
        sent = obj(b_sent).get("approval") or {}
        check("only a finalized, still valid quotation is recorded as sent, by someone with native rights, with how it was sent",
              (s_draft, err(b_draft)[0]) == (422, "QUOTE_NOT_FINALIZED") and s_none in (403, 404) and (s_long, err(b_long)[1]) == (422, "via")
              and expired.get("approval", {}).get("expired") is True and (s_exp, err(b_exp)[0]) == (422, "QUOTE_EXPIRED")
              and s_sent == 200 and sent.get("sentBy") == users["Rep"]["name"] and sent.get("sentVia") == "e-mail from my account" and sent.get("sentAt"),
              (s_draft, err(b_draft), s_none, s_long, expired.get("approval"), s_exp, err(b_exp), s_sent, sent))

        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
        print(f"\n{sum(r['result'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} checks passed")
    finally:
        opp_ids = [rid for m, rid in created if m == OPP]
        if opp_ids:
            quotes = [r["id"] for r in search(SALE_ORDER, f"self.company.id = {co['id']}")] if "co" in locals() else []
            if quotes:
                qids = ",".join(map(str, quotes))
                for model, domain in ((REVIEW_EVENT, f"self.review.quote.id in ({qids})"), (REVIEW, f"self.quote.id in ({qids})"),
                                      (SALE_ORDER_LINE_TAX, f"self.saleOrder.id in ({qids})"),
                                      (SALE_ORDER_LINE, f"self.saleOrder.id in ({qids}) OR self.oldVersionSaleOrder.id in ({qids})"),
                                      (SALE_ORDER, f"self.id in ({qids})")):
                    created.extend((model, r["id"]) for r in search(model, domain) if (model, r["id"]) not in created)
            for seq in search(SEQUENCE, f"self.company.id = {co['id']}" if "co" in locals() else "self.id = 0"):
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
        for name in (OWNER_ROLE, MANAGER_ROLE, GM_ROLE):
            if name not in roles_before:
                created.extend((ROLE, r["id"]) for r in search(ROLE, f"self.name = '{name}'") if (ROLE, r["id"]) not in created)
        order = {REVIEW_EVENT: 0, NOTICE: 0, REVIEW: 1, SALE_ORDER_LINE_TAX: 0, SALE_ORDER_LINE: 1, SALE_ORDER: 2, POLICY_TAX: 3, TAX_LINE: 4,
                 TAX: 5, TAX_TYPE: 6, VERSION: 4, AUDIT: 4, OPP: 4, ACCOUNT_MANAGEMENT: 5, PRODUCT: 6, PARTNER: 6, LINE: 6, ACCOUNT: 7,
                 ACCOUNT_CONFIG: 8, STOCK_CONFIG: 8, STOCK_LOCATION: 9, SEQUENCE_VERSION: 9, SEQUENCE: 10, ROLE: 12, USER: 11, GROUP: 12,
                 PERM: 13, COMPANY: 14}
        complete, left = cleanup(admin, list(dict.fromkeys(created)), order)
        if not complete:
            print(f"FAIL cleanup left {left}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "quote-approval-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
