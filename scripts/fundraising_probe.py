#!/usr/bin/env python3
"""Wave 4E live probe: fundraising and partnerships.

Run against a RUNNING local/CI Axelor; never against production. Roles are TEST FIXTURES built from
native permissions (policy D-07 defines the real ones): FundA and FundB manage their own donors only,
Reporter reads fundraising records but not the sensitive profile, Sales reads accounts only. Donors,
amounts and references are fictional.
Checks, through /ws/ioeti/fundraising:
  donor profile and opportunity validation; the sensitive profile is write-only (read → D-05/D-07)
  stages: invalid moves → 422; stale version → 409; approval only of a submitted proposal, once (409)
  money stays apart: proposed ≠ committed ≠ scheduled ≠ collected; a pledge is not collected
  schedule never exceeds the commitment; a collection never exceeds what is due; the same bank
  reference twice → 409; voiding keeps the row and stops counting it; bank references never returned
  posting collections and invoicing installments (D-06) → BLOCKED_BY_POLICY
  M1 (D-05 signed): only finance (native rights on receipts) issues a receipt, only for a recorded collection
  (voided → 422), once (409), uniquely numbered, with the collection's amount, donor and date; a collection with
  a receipt in force cannot be voided; a receipt is voided with a reason (stale → 409, twice → 422) and a reissue
  gets a new number; restrictions map to active native analytic accounts (finance only); a restricted commitment
  is allocated once (unrestricted → 422, twice → 409) and its recorded collections, later ones included, carry
  the analytic account; the restricted-funds report sums them per restriction
  deliverables and stewardship; archive keeps history; renewal of an approved opportunity
  isolation: another fundraiser → 404; sales → 403 and Account 360 shows no fundraising data;
  fundraisers are denied quotations; anonymous donors are unnamed for the reporter
  N concurrent installments on one commitment → one 201, the schedule never exceeds the commitment
Env: PROBE_FUND_ROUNDS (default 5). Report: logs/fundraising-probe.json.
"""
import json
import os
import secrets
import sys
import threading
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PARTNER, CAMPAIGN = "com.axelor.apps.base.db.Partner", "com.axelor.apps.marketing.db.Campaign"
P = "com.ioeti.fundraising.db."
DONOR, SENS, OPP, COMMIT = P + "DonorProfile", P + "DonorSensitiveProfile", P + "FundingOpportunity", P + "FundingCommitment"
INST, COLL, DELIV, STEW = P + "PledgeInstallment", P + "DonationCollection", P + "GrantDeliverable", P + "StewardshipActivity"
RECEIPT, RESTR, ANALYTIC = P + "DonationReceipt", P + "FundRestriction", "com.axelor.apps.account.db.AnalyticAccount"
BASE = "/ws/ioeti/fundraising"
MISSING = 987654326
ROUNDS = int(os.environ.get("PROBE_FUND_ROUNDS", "5"))
RESULTS = []
SECRET_NOTE = "prefers-whatsapp-after-9pm-private"
SECRET_CAPACITY = "7777777.77"


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


def field(body):
    return (error(body).get("fields") or [{}])[0].get("field")


def obj(body):
    return (body.get("object") or {}) if isinstance(body, dict) else {}


def num(value):
    return None if value is None else round(float(value), 2)


def main():
    admin = admin_client()
    tag = secrets.token_hex(3).upper()
    created, seen, bank_refs = [], [], []

    def create(model, values):
        _, body = rest_create(admin, model, values)
        if not ok(body):
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}: {json.dumps(body)[:200]}")
        created.append((model, body["data"][0]["id"]))
        return body["data"][0]

    def search(model, domain, fields=("id",)):
        _, body = admin.call("POST", f"/ws/rest/{model}/search",
                             {"fields": list(fields), "limit": 500, "data": {"_domain": domain}})
        return body.get("data") or []

    def version(model, rid):
        _, body = admin.call("POST", f"/ws/rest/{model}/{rid}/fetch", {"fields": ["version"]})
        return (body.get("data") or [{}])[0].get("version")

    exit_code = 1
    users = {}
    try:
        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"wave4e.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})

        rw = dict(canRead=True, canWrite=True, canCreate=True)
        own = {DONOR: "self.relationshipManager = ?", SENS: "self.donor.relationshipManager = ?",
               OPP: "self.donor.relationshipManager = ?", COMMIT: "self.opportunity.donor.relationshipManager = ?",
               INST: "self.commitment.opportunity.donor.relationshipManager = ?",
               COLL: "self.installment.commitment.opportunity.donor.relationshipManager = ?",
               DELIV: "self.commitment.opportunity.donor.relationshipManager = ?", STEW: "self.donor.relationshipManager = ?"}
        fund = [perm(f"f.{m.split('.')[-1].lower()}", m, cond, **rw) for m, cond in own.items()]
        fund += [perm("f.partner", PARTNER, canRead=True), perm("f.campaign", CAMPAIGN, canRead=True)]
        rep = [perm(f"r.{m.split('.')[-1].lower()}", m, canRead=True) for m in own if m != SENS]
        rep += [perm("r.partner", PARTNER, canRead=True)]
        sales = [perm("s.partner", PARTNER, canRead=True)]
        # finance (fixture): reads fundraising money, issues receipts and maps restrictions; no fundraising writes
        finance = [perm(f"n.{m.split('.')[-1].lower()}", m, canRead=True) for m in (OPP, COMMIT, INST, COLL, DONOR, PARTNER)]
        finance += [perm("n.receipt", RECEIPT, **rw), perm("n.restr", RESTR, **rw), perm("n.analytic", ANALYTIC, canRead=True)]
        groups = {}
        for key, perms in (("fund", fund), ("rep", rep), ("sales", sales), ("fin", finance)):
            groups[key] = create(GROUP, {"code": f"wave4e-{key}-{tag}", "name": f"Wave4e {key} {tag}",
                                         "permissions": [{"id": p["id"]} for p in perms]})
        sessions = {}
        for label, group in (("FundA", "fund"), ("FundA2", None), ("FundB", "fund"), ("Reporter", "rep"), ("Sales", "sales"), ("Finance", "fin")):
            if group is None:
                sessions[label] = Client()
                assert sessions[label].login(users["FundA"]["code"], users["FundA"]["_pw"]) == 200
                continue
            password = "W4e!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"wave4e.{label.lower()}.{tag}", "name": f"Wave4e {label}",
                                         "blocked": False, "language": "en", "group": {"id": groups[group]["id"]},
                                         "password": axelor_password_hash(password)})
            users[label]["_pw"] = password
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        a, a2, b, rep_c, sales_c, fin = (sessions[k] for k in ("FundA", "FundA2", "FundB", "Reporter", "Sales", "Finance"))
        foundation = create(PARTNER, {"name": f"Wave4e Nile Delta Foundation {tag}", "partnerTypeSelect": 1, "isProspect": True})
        quiet = create(PARTNER, {"name": f"Wave4e Quiet Benefactor {tag}", "partnerTypeSelect": 2, "firstName": "Quiet"})
        campaign = create(CAMPAIGN, {"name": f"Wave4e Scholarships {tag}"})

        def call(client, method, path, body=None):
            s, resp = client.call(method, BASE + path, body if body is not None else ({} if method in ("POST", "PUT") else None))
            seen.append(json.dumps(resp))
            return s, resp

        # --- 1. donors and the sensitive profile ---------------------------------------------------------
        s, body = call(a, "POST", "/donors", {"partnerId": foundation["id"], "donorType": "FOUNDATION"})
        donor = obj(body)
        s_dup, b_dup = call(a, "POST", "/donors", {"partnerId": foundation["id"], "donorType": "FOUNDATION"})
        s_bad, b_bad = call(a, "POST", "/donors", {"partnerId": quiet["id"], "donorType": "ALIEN"})
        check("donor profile opened (201, managed by me); same account twice → 409 ALREADY_DONOR; bad type → 422",
              s == 201 and donor.get("managedByMe") is True and donor.get("name") == foundation["name"]
              and (s_dup, error(b_dup).get("code"), s_bad, field(b_bad)) == (409, "ALREADY_DONOR", 422, "donorType"),
              f"{s} {s_dup} {s_bad} {body}")
        s_anon, b_anon = call(a, "POST", "/donors", {"partnerId": quiet["id"], "donorType": "INDIVIDUAL", "anonymous": True})
        anon = obj(b_anon)
        s_sv, b_sv = call(a, "PUT", f"/donors/{donor['id']}/sensitive",
                          {"version": version(DONOR, donor["id"]), "givingCapacity": SECRET_CAPACITY,
                           "contactPreference": SECRET_NOTE, "relationshipNote": "Board chair " + SECRET_NOTE})
        stored = search(SENS, f"self.donor.id = {donor['id']}", ("givingCapacity", "contactPreference"))
        s_rd, b_rd = call(a, "GET", f"/donors/{donor['id']}/sensitive")
        check("sensitive profile write-only: stored, flagged on file, never echoed; read → BLOCKED_BY_POLICY (D-05, D-07)",
              s_anon == 201 and s_sv == 200 and obj(b_sv).get("sensitiveOnFile") is True and SECRET_NOTE not in json.dumps(b_sv)
              and len(stored) == 1 and stored[0].get("contactPreference") == SECRET_NOTE
              and (s_rd, error(b_rd).get("code")) == (422, "BLOCKED_BY_POLICY") and "D-05" in error(b_rd).get("message", ""),
              f"{s_sv} {s_rd} {stored}")

        # --- 2. opportunities and stages ----------------------------------------------------------------
        def new_opp(client, ref, donor_id, amount="500000.00", **extra):
            payload = {"reference": ref, "donorId": donor_id, "title": "STEM scholarships for girls", "purpose": "Scholarships",
                       "kind": "GRANT", "proposedAmount": amount, "currencyCode": "EGP", "campaignId": campaign["id"], **extra}
            s_, b_ = call(client, "POST", "/opportunities", payload)
            if obj(b_).get("id"):
                created.append((OPP, obj(b_)["id"]))
            return s_, b_, obj(b_)

        s_cur, b_cur, _ = new_opp(a, f"g0-{tag}", donor["id"], currencyCode="QQQ")
        s_amt, b_amt, _ = new_opp(a, f"g1-{tag}", donor["id"], amount="10.123")
        s_neg, b_neg, _ = new_opp(a, f"g2-{tag}", donor["id"], amount="-5")
        s, body, opp = new_opp(a, f"gr-{tag}", donor["id"])
        check("opportunity validation (currency, 2-decimal positive amount) → 422 field; opened IDENTIFIED with campaign",
              (s_cur, field(b_cur), s_amt, field(b_amt), s_neg, field(b_neg)) == (422, "currencyCode", 422, "proposedAmount", 422, "proposedAmount")
              and s == 201 and opp.get("stage") == "IDENTIFIED" and opp.get("campaignName") == campaign["name"]
              and opp.get("currency") == "EGP", f"{s_cur} {s_amt} {s_neg} {s} {body}")

        def stage(client, o, to, v=None):
            return call(client, "POST", f"/opportunities/{o['id']}/stage", {"version": v if v is not None else version(OPP, o["id"]), "stage": to})

        def approve(client, o, amount="400000.00", **extra):
            payload = {"version": version(OPP, o["id"]), "committedAmount": amount, "approvedOn": "2026-10-01",
                       "periodEnd": "2027-09-30", "restricted": True, "restrictionPurpose": "Girls' STEM scholarships",
                       "agreementReference": f"AGR-{tag}", **extra}
            s_, b_ = call(client, "POST", f"/opportunities/{o['id']}/approve", payload)
            if obj(b_).get("id"):
                created.append((COMMIT, obj(b_)["id"]))
            return s_, b_, obj(b_)

        s_skip, b_skip = stage(a, opp, "SUBMITTED")
        s_early, b_early, _ = approve(a, opp)
        s_stale, _ = stage(a, opp, "PROPOSAL", v=version(OPP, opp["id"]) - 1 if version(OPP, opp["id"]) else -1)
        s_p, _ = stage(a, opp, "PROPOSAL")
        s_s, b_s = stage(a, opp, "SUBMITTED")
        check("invalid moves → 422 STAGE_TRANSITION (skip to submitted; approve before submission); stale → 409; proposal → submitted",
              (s_skip, error(b_skip).get("code"), s_early, error(b_early).get("code"), s_stale, s_p, s_s)
              == (422, "STAGE_TRANSITION", 422, "STAGE_TRANSITION", 409, 200, 200) and obj(b_s).get("stage") == "SUBMITTED",
              f"{s_skip} {s_early} {s_stale} {s_p} {s_s}")

        # --- 3. commitment: a pledge is not collected ------------------------------------------------------
        s_np, b_np, _ = approve(a, opp, restrictionPurpose=" ")
        s, body, com = approve(a, opp)
        s_twice, b_twice, _ = approve(a, opp)
        _, ov = call(a, "GET", "/overview")
        egp = next((t for t in obj(ov).get("totals", []) if t["currency"] == "EGP"), {})
        check("approval: restricted without purpose → 422; commitment 201 (committed 400000, collected 0, outstanding 400000); again → 409",
              (s_np, field(b_np)) == (422, "restrictionPurpose") and s == 201 and num(com.get("committed")) == 400000
              and num(com.get("collected")) == 0 and num(com.get("outstanding")) == 400000 and com.get("restricted") is True
              and com.get("allocationStatus") == "PENDING_ALLOCATION" and (s_twice, error(b_twice).get("code")) == (409, "ALREADY_COMMITTED"),
              f"{s_np} {s} {s_twice} {body}")
        check("overview keeps money apart: the approved amount is committed, not proposed and not collected",
              num(egp.get("committed")) >= 400000 and num(egp.get("collected")) == 0
              and num(egp.get("restrictedCommitted")) >= 400000 and obj(ov).get("stages", {}).get("APPROVED", 0) >= 1, egp)

        # --- 4. schedule and collections ------------------------------------------------------------------
        def schedule(client, c, due, amount, v=None):
            s_, b_ = call(client, "POST", f"/commitments/{c['id']}/installments",
                          {"version": v if v is not None else version(COMMIT, c["id"]), "dueDate": due, "amount": amount})
            if obj(b_).get("id"):
                created.append((INST, obj(b_)["id"]))
            return s_, b_, obj(b_)

        # due dates relative to today: an installment past its due date is OVERDUE even when partly paid
        due = [(date.today() + timedelta(days=d)).isoformat() for d in (30, 120, 210, 300)]
        s1, _, i1 = schedule(a, com, due[0], "150000")
        s2, _, i2 = schedule(a, com, due[1], "150000")
        s3, _, i3 = schedule(a, com, due[2], "100000")
        s4, b4, _ = schedule(a, com, due[3], "1")
        check("schedule 150000 + 150000 + 100000 = commitment; one more → 422 SCHEDULE_EXCEEDS_COMMITMENT",
              (s1, s2, s3, s4, error(b4).get("code")) == (201, 201, 201, 422, "SCHEDULE_EXCEEDS_COMMITMENT")
              and [i1.get("sequence"), i2.get("sequence"), i3.get("sequence")] == [1, 2, 3], f"{s1} {s2} {s3} {s4}")

        def collect(client, inst, amount, ref, on="2026-10-16"):
            bank_refs.append(ref)
            s_, b_ = call(client, "POST", f"/installments/{inst['id']}/collections",
                          {"version": version(INST, inst["id"]), "amount": amount, "receivedOn": on, "bankReference": ref})
            if obj(b_).get("id"):
                created.append((COLL, obj(b_)["id"]))
            return s_, b_, obj(b_)

        ref1 = f"NBE-{tag}-0001"
        sc1, _, k1 = collect(a, i1, "100000", ref1)
        sdup, bdup, _ = collect(a, i1, "100000", ref1)
        sover, bover, _ = collect(a, i1, "60000", f"NBE-{tag}-0002")
        sfut, bfut, _ = collect(a, i1, "10", f"NBE-{tag}-0003", on="2099-01-01")
        _, rows = call(a, "GET", f"/commitments/{com['id']}/installments")
        st1 = next(r for r in obj(rows) if r["id"] == i1["id"]) if isinstance(obj(rows), list) else {}
        _, c_now = call(a, "GET", f"/commitments/{com['id']}")
        check("collection recorded; same bank reference → 409 DUPLICATE_COLLECTION; more than due → 422; future → 422; installment PARTIAL",
              (sc1, sdup, error(bdup).get("code"), sover, error(bover).get("code"), sfut, field(bfut))
              == (201, 409, "DUPLICATE_COLLECTION", 422, "OVER_COLLECTION", 422, "receivedOn")
              and st1.get("status") == "PARTIAL" and num(obj(c_now).get("collected")) == 100000
              and num(obj(c_now).get("outstanding")) == 300000, f"{sc1} {sdup} {sover} {sfut} {st1}")
        sv, bv = call(a, "POST", f"/collections/{k1['id']}/void", {"version": version(COLL, k1["id"]), "reason": "WRONG_AMOUNT"})
        sv2, bv2 = call(a, "POST", f"/collections/{k1['id']}/void", {"version": version(COLL, k1["id"]), "reason": "WRONG_AMOUNT"})
        _, klist = call(a, "GET", f"/installments/{i1['id']}/collections")
        sc2, _, k2 = collect(a, i1, "150000", f"NBE-{tag}-0004")
        _, c_after = call(a, "GET", f"/commitments/{com['id']}")
        check("void keeps the row (listed as VOIDED) and stops counting it; void twice → 422; the corrected collection counts",
              sv == 200 and obj(bv).get("status") == "VOIDED" and (sv2, error(bv2).get("code")) == (422, "ALREADY_VOIDED")
              and [k["status"] for k in obj(klist)] == ["VOIDED"] and sc2 == 201
              and num(obj(c_after).get("collected")) == 150000, f"{sv} {sv2} {obj(klist)} {sc2} {obj(c_after)}")
        blocked = [call(a, "POST", path) for path in (f"/collections/{k1['id']}/post", f"/installments/{i1['id']}/invoice")]
        before = len(search(COLL, f"self.installment.commitment.id = {com['id']}"))
        check("posting a collection and invoicing an installment (D-06) → 422 BLOCKED_BY_POLICY, nothing created",
              all(s_ == 422 and error(b_).get("code") == "BLOCKED_BY_POLICY" for s_, b_ in blocked)
              and "D-06" in error(blocked[1][1]).get("message", "") and before == 2, [s_ for s_, _ in blocked])

        # --- 4b. D-05 receipts: finance only, recorded collections only, once, numbered -----------------------
        def receipt(client, coll_id):
            s_, b_ = call(client, "POST", f"/collections/{coll_id}/receipt")
            if obj(b_).get("id"):
                created.append((RECEIPT, obj(b_)["id"]))
            return s_, b_, obj(b_)

        s_fa, _, _ = receipt(a, k2["id"])
        s_void_k, b_void_k, _ = receipt(fin, k1["id"])
        s_r1, b_r1, r1 = receipt(fin, k2["id"])
        s_r_dup, b_r_dup, _ = receipt(fin, k2["id"])
        year = str(date.today().year)
        check("receipt: fundraiser without finance rights → 403; voided collection → 422 COLLECTION_VOIDED; finance issues it (201): "
              "unique number, the collection's amount, donor and date; again → 409 RECEIPT_EXISTS",
              s_fa == 403 and (s_void_k, error(b_void_k).get("code")) == (422, "COLLECTION_VOIDED") and s_r1 == 201
              and str(r1.get("number", "")).startswith(f"DR-{year}-") and len(r1.get("number", "")) == 14 and num(r1.get("amount")) == 150000
              and r1.get("donorName") == foundation["name"] and r1.get("receivedOn") == "2026-10-16" and r1.get("status") == "ISSUED"
              and (s_r_dup, error(b_r_dup).get("code")) == (409, "RECEIPT_EXISTS"), f"{s_fa} {s_void_k} {s_r1} {r1} {s_r_dup}")
        _, fin_k = call(fin, "GET", f"/installments/{i1['id']}/collections")
        _, own_k = call(a, "GET", f"/installments/{i1['id']}/collections")
        fin_row = next((k for k in obj(fin_k) if k["id"] == k2["id"]), {}) if isinstance(obj(fin_k), list) else {}
        own_row = next((k for k in obj(own_k) if k["id"] == k2["id"]), {}) if isinstance(obj(own_k), list) else {}
        s_kv, b_kv = call(a, "POST", f"/collections/{k2['id']}/void", {"version": version(COLL, k2["id"]), "reason": "WRONG_AMOUNT"})
        s_rb, _ = call(b, "GET", f"/receipts/{r1.get('id')}")
        s_rr, _ = call(rep_c, "GET", "/receipts")
        check("the collection shows its receipt (number for finance only); a collection with a receipt in force cannot be voided (422); "
              "receipts are closed to other fundraisers and the reporter (403)",
              fin_row.get("receiptStatus") == "ISSUED" and fin_row.get("receiptNumber") == r1.get("number")
              and own_row.get("receiptStatus") == "ISSUED" and own_row.get("receiptNumber") is None and own_row.get("canIssueReceipt") is False
              and (s_kv, error(b_kv).get("code")) == (422, "RECEIPT_ISSUED") and s_rb == 403 and s_rr == 403,
              f"{fin_row} {own_row} {s_kv} {s_rb} {s_rr}")
        v_r1 = version(RECEIPT, r1["id"])
        s_rv_stale, _ = call(fin, "POST", f"/receipts/{r1['id']}/void", {"version": v_r1 - 1 if v_r1 else -1, "reason": "WRONG_DONOR_DETAILS"})
        s_rv_bad, b_rv_bad = call(fin, "POST", f"/receipts/{r1['id']}/void", {"version": v_r1, "reason": "CHANGED_MIND"})
        s_rv_a, _ = call(a, "POST", f"/receipts/{r1['id']}/void", {"version": v_r1, "reason": "WRONG_DONOR_DETAILS"})
        s_rv, b_rv = call(fin, "POST", f"/receipts/{r1['id']}/void", {"version": v_r1, "reason": "WRONG_DONOR_DETAILS"})
        s_rv2, b_rv2 = call(fin, "POST", f"/receipts/{r1['id']}/void", {"version": version(RECEIPT, r1["id"]), "reason": "DUPLICATE"})
        s_r2, _, r2 = receipt(fin, k2["id"])
        _, all_r = call(fin, "GET", f"/receipts?collectionId={k2['id']}")
        check("void: stale → 409; unknown reason → 422; fundraiser → 403; finance voids with a reason (kept, VOIDED); twice → 422; "
              "the reissue gets a new number and names the one it replaces",
              s_rv_stale == 409 and (s_rv_bad, field(b_rv_bad)) == (422, "reason") and s_rv_a == 403 and s_rv == 200
              and obj(b_rv).get("status") == "VOIDED" and obj(b_rv).get("voidReason") == "WRONG_DONOR_DETAILS"
              and (s_rv2, error(b_rv2).get("code")) == (422, "RECEIPT_VOIDED") and s_r2 == 201 and r2.get("number") != r1.get("number")
              and r2.get("replacesNumber") == r1.get("number") and sorted(x["status"] for x in obj(all_r)) == ["ISSUED", "VOIDED"],
              f"{s_rv_stale} {s_rv_bad} {s_rv_a} {s_rv} {s_rv2} {s_r2} {r2}")

        # owner decision 2026-10-29: a donor who asked to stay anonymous gets a receipt with no name (shown as anonymous)
        _, dcur = admin.call("POST", f"/ws/rest/{DONOR}/{donor['id']}/fetch", {"fields": ["version"]})
        admin.call("POST", f"/ws/rest/{DONOR}/{donor['id']}", {"data": {"id": donor["id"], "version": (dcur.get("data") or [{}])[0].get("version"),
                                                                      "anonymous": True}})
        s_rv3, _ = call(fin, "POST", f"/receipts/{r2['id']}/void", {"version": version(RECEIPT, r2["id"]), "reason": "WRONG_DONOR_DETAILS"})
        s_r3, _, r3 = receipt(fin, k2["id"])
        _, dcur = admin.call("POST", f"/ws/rest/{DONOR}/{donor['id']}/fetch", {"fields": ["version"]})
        admin.call("POST", f"/ws/rest/{DONOR}/{donor['id']}", {"data": {"id": donor["id"], "version": (dcur.get("data") or [{}])[0].get("version"),
                                                                      "anonymous": False}})
        check("a donor who asked to stay anonymous: the reissued receipt carries no name (printed as anonymous), the amount stays",
              s_rv3 == 200 and s_r3 == 201 and r3.get("donorName") is None and num(r3.get("amount")) == 150000
              and foundation["name"] not in json.dumps(r3), f"{s_rv3} {s_r3} {r3}")

        # --- 4c. D-05 restricted funds: restriction → analytic account; allocation; the balance report ----------
        acct = create(ANALYTIC, {"code": f"AN{tag}", "name": f"Probe STEM {tag}", "statusSelect": 1})
        idle = create(ANALYTIC, {"code": f"AX{tag}", "name": f"Probe inactive {tag}", "statusSelect": 0})
        def restriction(client, code, account_id, name="Girls' STEM scholarships"):
            s_, b_ = call(client, "POST", "/fund-restrictions", {"code": code, "name": name, "analyticAccountId": account_id})
            if obj(b_).get("id"):
                created.append((RESTR, obj(b_)["id"]))
            return s_, b_, obj(b_)
        s_ra, _, _ = restriction(a, f"R{tag}", acct["id"])
        s_ri, b_ri, _ = restriction(fin, f"R{tag}", idle["id"])
        s_rc, b_rc, _ = restriction(fin, "x y", acct["id"])
        s_rok, b_rok, restr = restriction(fin, f"r{tag}", acct["id"])
        s_rdup, b_rdup, _ = restriction(fin, f"R{tag}", acct["id"])
        _, accts = call(fin, "GET", f"/analytic-accounts?q={tag}")
        check("restriction mapping: fundraiser → 403; inactive analytic account → 422; bad code → 422; finance maps it (201); "
              "duplicate code → 422; only active analytic accounts are offered",
              s_ra == 403 and (s_ri, field(b_ri), error(b_ri).get("fields", [{}])[0].get("code")) == (422, "analyticAccountId", "INACTIVE")
              and (s_rc, field(b_rc)) == (422, "code") and s_rok == 201 and restr.get("code") == f"R{tag}"
              and restr.get("analyticAccountCode") == f"AN{tag}" and (s_rdup, field(b_rdup)) == (422, "code")
              and [x["code"] for x in obj(accts)] == [f"AN{tag}"], f"{s_ra} {s_ri} {s_rc} {s_rok} {restr} {s_rdup} {obj(accts)}")
        _, _, plain = new_opp(a, f"gp-{tag}", donor["id"])
        stage(a, plain, "PROPOSAL")
        stage(a, plain, "SUBMITTED")
        _, _, plain_c = approve(a, plain, amount="1000", restricted=False, restrictionPurpose=None)
        s_al_a, _ = call(a, "POST", f"/commitments/{com['id']}/allocate", {"version": version(COMMIT, com["id"]), "restrictionId": restr.get("id")})
        s_al_plain, b_al_plain = call(fin, "POST", f"/commitments/{plain_c.get('id')}/allocate", {"version": version(COMMIT, plain_c.get("id")), "restrictionId": restr.get("id")})
        s_al_stale, _ = call(fin, "POST", f"/commitments/{com['id']}/allocate", {"version": version(COMMIT, com["id"]) - 1, "restrictionId": restr.get("id")})
        s_al, b_al = call(fin, "POST", f"/commitments/{com['id']}/allocate", {"version": version(COMMIT, com["id"]), "restrictionId": restr.get("id")})
        s_al2, b_al2 = call(fin, "POST", f"/commitments/{com['id']}/allocate", {"version": version(COMMIT, com["id"]), "restrictionId": restr.get("id")})
        allocated = {r["id"]: r for r in search(COLL, f"self.installment.commitment.id = {com['id']}", ("analyticAccount", "statusSelect"))}
        sc3, _, k3 = collect(a, i2, "20000", f"NBE-{tag}-0005")
        k3_row = (search(COLL, f"self.id = {k3.get('id') or 0}", ("analyticAccount",)) or [{}])[0]
        check("allocation: fundraiser → 403; unrestricted → 422 NOT_RESTRICTED; stale → 409; finance allocates (ALLOCATED, analytic account); "
              "twice → 409; the recorded collection (not the voided one) and a later one carry the analytic account",
              s_al_a == 403 and (s_al_plain, error(b_al_plain).get("code")) == (422, "NOT_RESTRICTED") and s_al_stale == 409 and s_al == 200
              and obj(b_al).get("allocationStatus") == "ALLOCATED" and obj(b_al).get("analyticAccount") == f"AN{tag} - Probe STEM {tag}"
              and (s_al2, error(b_al2).get("code")) == (409, "ALREADY_ALLOCATED")
              and (allocated.get(k2["id"], {}).get("analyticAccount") or {}).get("id") == acct["id"]
              and not allocated.get(k1["id"], {}).get("analyticAccount") and sc3 == 201
              and (k3_row.get("analyticAccount") or {}).get("id") == acct["id"], f"{s_al_a} {s_al_plain} {s_al_stale} {s_al} {obj(b_al)} {s_al2} {allocated} {k3_row}")
        _, rf = call(fin, "GET", "/restricted-funds")
        row = next((r for r in obj(rf) if r.get("code") == f"R{tag}"), {}) if isinstance(obj(rf), list) else {}
        s_rf_a, _ = call(a, "GET", "/restricted-funds")
        check("restricted-funds report (finance): the restriction's analytic account, committed 400000 and collected 170000 (voided excluded); "
              "fundraiser without restriction rights → 403",
              row.get("analyticAccountCode") == f"AN{tag}" and num(row.get("committed")) == 400000 and num(row.get("collected")) == 170000
              and row.get("allocated") is True and row.get("currency") == "EGP" and s_rf_a == 403, f"{row} {s_rf_a}")

        # --- 5. deliverables, stewardship, timeline, archive, renewal --------------------------------------
        sd, bd = call(a, "POST", f"/commitments/{com['id']}/deliverables",
                      {"version": version(COMMIT, com["id"]), "title": "Mid-year impact report", "dueDate": "2027-03-31"})
        deliv = obj(bd)
        if deliv.get("id"):
            created.append((DELIV, deliv["id"]))
        sacc_early, _ = call(a, "POST", f"/deliverables/{deliv.get('id')}/status", {"version": version(DELIV, deliv.get("id")), "stage": "ACCEPTED"})
        ssub, _ = call(a, "POST", f"/deliverables/{deliv.get('id')}/status", {"version": version(DELIV, deliv.get("id")), "stage": "SUBMITTED"})
        sacc, bacc = call(a, "POST", f"/deliverables/{deliv.get('id')}/status", {"version": version(DELIV, deliv.get("id")), "stage": "ACCEPTED"})
        check("deliverable: accept before submission → 422; submitted then accepted",
              (sd, sacc_early, ssub, sacc) == (201, 422, 200, 200) and obj(bacc).get("status") == "ACCEPTED", f"{sd} {sacc_early} {ssub} {sacc}")
        sst, _ = call(a, "POST", f"/donors/{donor['id']}/stewardship",
                      {"version": version(DONOR, donor["id"]), "kind": "THANK_YOU", "occurredOn": "2026-10-02", "subject": "Thank-you call to the board"})
        sstf, bstf = call(a, "POST", f"/donors/{donor['id']}/stewardship",
                          {"version": version(DONOR, donor["id"]), "kind": "VISIT", "occurredOn": "2099-01-01", "subject": "Visit"})
        s_x, b_x, other = new_opp(a, f"gx-{tag}", donor["id"])
        stage(a, other, "DECLINED")
        s_arc, b_arc = call(a, "POST", f"/opportunities/{other['id']}/archive", {"version": version(OPP, other["id"])})
        s_arc2, b_arc2 = call(a, "POST", f"/opportunities/{opp['id']}/archive", {"version": version(OPP, opp["id"])})
        _, listed = call(a, "GET", f"/opportunities?donorId={donor['id']}")
        # /ws/rest search hides archived rows; fetch reads the row itself
        _, kept_body = admin.call("POST", f"/ws/rest/{OPP}/{other['id']}/fetch", {"fields": ["archived"]})
        kept = kept_body.get("data") or []
        _, tl = call(a, "GET", f"/donors/{donor['id']}/timeline")
        kinds = {e["kind"] for e in obj(tl)} if isinstance(obj(tl), list) else set()
        check("stewardship recorded (future → 422); archive keeps the row and hides it; committed opportunity → 422 HAS_COMMITMENT",
              sst == 201 and (sstf, field(bstf)) == (422, "occurredOn") and s_arc == 200
              and (s_arc2, error(b_arc2).get("code")) == (422, "HAS_COMMITMENT")
              and other["id"] not in [o["id"] for o in obj(listed)] and kept and kept[0].get("archived") is True,
              f"{sst} {sstf} {s_arc} {s_arc2} {kept}")
        check("donor timeline: opened, approved, collected, voided, deliverable, thank-you and archived events",
              {"OPPORTUNITY_OPENED", "COMMITMENT_APPROVED", "COLLECTION_RECORDED", "COLLECTION_VOIDED", "DELIVERABLE_SUBMITTED",
               "THANK_YOU", "OPPORTUNITY_ARCHIVED"} <= kinds, kinds)
        s_ren, b_ren = call(a, "POST", f"/opportunities/{opp['id']}/renewal", {"version": version(OPP, opp["id"]), "reference": f"gn-{tag}"})
        if obj(b_ren).get("id"):
            created.append((OPP, obj(b_ren)["id"]))
        s_ren2, b_ren2 = call(a, "POST", f"/opportunities/{other['id']}/renewal", {"version": version(OPP, other["id"]), "reference": f"gm-{tag}"})
        check("renewal of the approved grant opens IDENTIFIED with renewalOf; renewal of a declined one → 422",
              s_ren == 201 and obj(b_ren).get("renewalOf") == opp["reference"] and obj(b_ren).get("stage") == "IDENTIFIED"
              and (s_ren2, error(b_ren2).get("code")) == (422, "STAGE_TRANSITION"), f"{s_ren} {s_ren2}")

        # --- 6. isolation and privacy across roles ----------------------------------------------------------
        sb = [call(b, "GET", p)[0] for p in (f"/donors/{donor['id']}", f"/opportunities/{opp['id']}", f"/commitments/{com['id']}",
                                             f"/installments/{i1['id']}/collections", f"/donors/{MISSING}")]
        sb_post, _ = call(b, "POST", f"/installments/{i2['id']}/collections",
                          {"version": version(INST, i2["id"]), "amount": "1", "receivedOn": "2026-10-16", "bankReference": f"NBE-{tag}-B"})
        _, b_list = call(b, "GET", "/opportunities")
        check("another fundraiser: donor, grant, commitment and collections answer 404 like missing ids; cannot record a collection",
              sb == [404] * 5 and sb_post == 404 and opp["id"] not in [o["id"] for o in obj(b_list)], f"{sb} {sb_post}")
        _, rep_donors = call(rep_c, "GET", "/donors")
        rep_anon = next((d for d in obj(rep_donors) if d["id"] == anon.get("id")), {})
        _, a_anon = call(a, "GET", f"/donors/{anon.get('id')}")
        s_rep_ov, b_rep_ov = call(rep_c, "GET", "/overview")
        s_rep_w, _ = stage(rep_c, other, "WITHDRAWN")
        s_rep_s, _ = call(rep_c, "PUT", f"/donors/{donor['id']}/sensitive", {"version": version(DONOR, donor["id"]), "contactPreference": "x"})
        check("reporter: overview 200; anonymous donor unnamed for the reporter but named for its manager; writes → 403",
              s_rep_ov == 200 and rep_anon.get("anonymous") is True and rep_anon.get("name") is None
              and obj(a_anon).get("donor", {}).get("name") == quiet["name"] and s_rep_w == 403 and s_rep_s == 403,
              f"{s_rep_ov} {rep_anon} {s_rep_w} {s_rep_s}")
        s_sales = [call(sales_c, "GET", p)[0] for p in ("/donors", "/overview", "/opportunities", f"/donors/{donor['id']}/sensitive")]
        acct = [sales_c.call("GET", f"/ws/ioeti/accounts/{foundation['id']}{suffix}") for suffix in ("", "/opportunities", "/contacts")]
        acct_text = json.dumps([r for _, r in acct])
        check("sales: fundraising endpoints → 403/404; Account 360 of the donor shows no grant, amount or restriction",
              all(s_ in (403, 404) for s_ in s_sales) and acct[0][0] == 200
              and not any(x in acct_text for x in ("STEM", "400000", "scholarships", f"GR-{tag}")), f"{s_sales} {[s_ for s_, _ in acct]}")
        s_q, _ = a.call("GET", "/ws/ioeti/quotes")
        s_o, _ = a.call("GET", "/ws/ioeti/opportunities")
        check("fundraiser is denied unrelated financial data (quotations, sales opportunities) → 403",
              s_q in (403, 404) and s_o in (403, 404), f"{s_q} {s_o}")

        # --- 7. concurrency --------------------------------------------------------------------------------
        outcomes = []
        for i in range(ROUNDS):
            _, _, o = new_opp(a, f"r{i}-{tag}", donor["id"], amount="1000")
            stage(a, o, "PROPOSAL")
            stage(a, o, "SUBMITTED")
            _, _, c = approve(a, o, amount="1000", restricted=False, restrictionPurpose=None)
            v0 = version(COMMIT, c["id"])
            gate, answers = threading.Barrier(2), []

            def run(client):
                gate.wait()
                answers.append(client.call("POST", f"{BASE}/commitments/{c['id']}/installments",
                                           {"version": v0, "dueDate": "2027-01-01", "amount": "1000"}))

            threads = [threading.Thread(target=run, args=(cl,)) for cl in (a, a2)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            for _, resp in answers:
                if obj(resp).get("id"):
                    created.append((INST, obj(resp)["id"]))
            total = sum(float(r.get("amount") or 0) for r in search(INST, f"self.commitment.id = {c['id']}", ("amount",)))
            outcomes.append((sorted(s_ for s_, _ in answers), total))
        check(f"concurrent installments on one commitment: one 201 and one 409, schedule never above the commitment ({ROUNDS} rounds)",
              all(o == [201, 409] and t == 1000 for o, t in outcomes), outcomes)
        check("restricted values (sensitive profile, bank references) never appear in any API response",
              not any(SECRET_NOTE in r or SECRET_CAPACITY in r or any(ref in r for ref in bank_refs) for r in seen), "leak found")

        failed = [r for r in RESULTS if r["result"] != "PASS"]
        print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
        exit_code = 0 if not failed else 1
    finally:
        donor_ids = [r["id"] for r in search(DONOR, f"self.partner.name like '%{tag}'")]
        if donor_ids:
            ids = ",".join(map(str, donor_ids))
            # a reissued receipt points at the voided one it replaces: those go first
            for row in search(RECEIPT, f"self.collection.installment.commitment.opportunity.donor.id in ({ids}) AND self.replaces IS NOT NULL"):
                admin.call("DELETE", f"/ws/rest/{RECEIPT}/{row['id']}")
            for model, domain in ((RECEIPT, f"self.collection.installment.commitment.opportunity.donor.id in ({ids})"),
                                  (COLL, f"self.installment.commitment.opportunity.donor.id in ({ids})"),
                                  (INST, f"self.commitment.opportunity.donor.id in ({ids})"),
                                  (DELIV, f"self.commitment.opportunity.donor.id in ({ids})"),
                                  (COMMIT, f"self.opportunity.donor.id in ({ids})"),
                                  (OPP, f"self.donor.id in ({ids})"), (STEW, f"self.donor.id in ({ids})"),
                                  (SENS, f"self.donor.id in ({ids})"), (DONOR, f"self.id in ({ids})")):
                for row in search(model, domain):
                    if (model, row["id"]) not in created:
                        created.append((model, row["id"]))
        created.extend((RESTR, r["id"]) for r in search(RESTR, f"self.code like '%{tag}'") if (RESTR, r["id"]) not in created)
        complete, leftovers = cleanup(admin, created, {RECEIPT: -1, COLL: 0, INST: 1, DELIV: 1, COMMIT: 2, OPP: 3, STEW: 3, SENS: 3,
                                                       DONOR: 4, RESTR: 4, CAMPAIGN: 5, PARTNER: 5, ANALYTIC: 5, USER: 6, GROUP: 7, PERM: 8})
        if not complete:
            print(f"FAIL cleanup left {leftovers}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "fundraising-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
