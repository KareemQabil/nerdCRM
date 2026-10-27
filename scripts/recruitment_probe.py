#!/usr/bin/env python3
"""Wave 4D live probe: recruitment for external clients.

Run against a RUNNING local/CI Axelor; never against production. Roles are TEST FIXTURES built from
native permissions (policy D-07 defines the real ones): RecA and RecB see their own job orders and
candidates only, ReadOnly reads non-restricted records. Clients and candidates are fictional.
Checks, through /ws/ioeti/recruitment:
  job order and candidate validation; restricted profile is write-only (never echoed, read → D-04/D-07)
  pipeline: duplicate attach → 409; invalid transitions → 422; stale version → 409
  submission needs a shortlisted candidate and an unrevoked consent for that job order; consent revoked
  before submission blocks it; sharing the CV with the client → BLOCKED_BY_POLICY (D-04: only through the
  client portal, D-10, not built)
  interview → offer → acceptance → placement; duplicate placement → 409; headcount filled → 422
  M1 (D-04 signed): without the client agreement (policy recruitment.agreement) the fee → 422 POLICY_NOT_SET;
  with it (START_DATE): the start (recorded once) dates the guarantee, the offered salary (write-only, never
  returned) makes one fee request for finance (15% of salary), again → the same one; finance is notified;
  fee amount hidden from read-only; another recruiter → 404; stale exit → 409; an exit within the guarantee
  under REPLACE reopens the job order and the next placement is a free replacement (no fee, FEE_WAIVED);
  OFFER_ACCEPTED + PARTIAL_REFUND: the fee is requested at placement, an exit within the guarantee asks finance
  for a 40% credit; an exit after the guarantee changes nothing
  cross-client: a consent for another client's job order does not cover this one
  cross-recruiter isolation: another recruiter's job order, candidate and pipeline answer 404
  N concurrent submissions of one application → one 200 and one 409
Env: PROBE_REC_ROUNDS (default 5). Report: logs/recruitment-probe.json.
Needs a disposable database without recruitment.agreement policy versions (the probe appoints a fixture policy
owner, sets the agreement per fixture client and removes every version it wrote).
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
PARTNER = "com.axelor.apps.base.db.Partner"
P = "com.ioeti.recruitment.db."
ORDER, CAND, PRIV, CONSENT = P + "ClientJobOrder", P + "RecruitmentCandidate", P + "CandidatePrivateProfile", P + "CandidateConsent"
APP, INTERVIEW, PLACEMENT, FEE = P + "CandidateApplication", P + "ClientInterview", P + "Placement", P + "RecruitmentFeeMilestone"
OFFER, FEE_REQ = P + "OfferPrivateTerms", P + "RecruitmentFeeRequest"
ROLE, VERSION = "com.axelor.auth.db.Role", "com.ioeti.core.db.PolicyVersion"
NOTICE, AUDIT = "com.ioeti.automation.db.InboxNotice", "com.ioeti.admin.db.AdminAuditEvent"
POLICIES, KEY, FINANCE_ROLE = "/ws/ioeti/policies", "recruitment.agreement", "ioeti-finance"
SECRET_SALARY = "240000"
BASE = "/ws/ioeti/recruitment"
MISSING = 987654325
ROUNDS = int(os.environ.get("PROBE_REC_ROUNDS", "5"))
RESULTS = []
SECRET_EMAIL = "candidate.private@example.invalid"


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


def main():
    admin = admin_client()
    tag = secrets.token_hex(3).upper()
    created, seen = [], []

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

    if search(VERSION, f"self.policyKey = '{KEY}'"):
        raise SystemExit(f"this database already has '{KEY}' versions; run on a clean disposable database")
    roles_before = {r["name"] for r in search(ROLE, f"self.name = '{FINANCE_ROLE}'", ("name",))}
    exit_code = 1
    users = {}
    try:
        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"wave4d.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})

        rw = dict(canRead=True, canWrite=True, canCreate=True)
        rec = [perm("order", ORDER, "self.recruiter = ?", **rw),
               perm("cand", CAND, "self.owner = ?", **rw),
               perm("priv", PRIV, "self.candidate.owner = ?", **rw),
               perm("consent", CONSENT, "self.candidate.owner = ?", **rw),
               perm("app", APP, "self.jobOrder.recruiter = ?", **rw),
               perm("interview", INTERVIEW, "self.application.jobOrder.recruiter = ?", **rw),
               perm("placement", PLACEMENT, "self.application.jobOrder.recruiter = ?", **rw),
               perm("fee", FEE, "self.placement.application.jobOrder.recruiter = ?", **rw),
               perm("offer", OFFER, "self.application.jobOrder.recruiter = ?", **rw),
               perm("feereq", FEE_REQ, "self.placement.application.jobOrder.recruiter = ?", canRead=True),
               perm("partner", PARTNER, canRead=True)]
        ro = [perm(f"ro.{m.split('.')[-1].lower()}", m, canRead=True)
              for m in (ORDER, CAND, CONSENT, APP, INTERVIEW, PLACEMENT, FEE, PARTNER)]
        fin = [perm("fin.feereq", FEE_REQ, canRead=True), perm("fin.partner", PARTNER, canRead=True)]
        groups = {"rec": create(GROUP, {"code": f"wave4d-rec-{tag}", "name": f"Wave4d recruiter {tag}",
                                        "permissions": [{"id": p["id"]} for p in rec]}),
                  "ro": create(GROUP, {"code": f"wave4d-ro-{tag}", "name": f"Wave4d read-only {tag}",
                                       "permissions": [{"id": p["id"]} for p in ro]}),
                  "fin": create(GROUP, {"code": f"wave4d-fin-{tag}", "name": f"Wave4d finance {tag}",
                                        "permissions": [{"id": p["id"]} for p in fin]}),
                  "none": create(GROUP, {"code": f"wave4d-none-{tag}", "name": f"Wave4d policy owner {tag}", "permissions": []})}
        found_role = search(ROLE, f"self.name = '{FINANCE_ROLE}'")
        finance_role = found_role[0]["id"] if found_role else create(ROLE, {"name": FINANCE_ROLE})["id"]
        sessions = {}
        for label, group in (("RecA", "rec"), ("RecA2", None), ("RecB", "rec"), ("ReadOnly", "ro"), ("Finance", "fin"), ("Owner", "none")):
            if group is None:
                sessions[label] = Client()
                assert sessions[label].login(users["RecA"]["code"], users["RecA"]["_pw"]) == 200
                continue
            password = "W4d!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"wave4d.{label.lower()}.{tag}", "name": f"Wave4d {label}",
                                         "blocked": False, "language": "en", "group": {"id": groups[group]["id"]},
                                         "roles": [{"id": finance_role}] if label == "Finance" else [],
                                         "password": axelor_password_hash(password)})
            users[label]["_pw"] = password
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        a, a2, b, ro_c, fin_c, owner = (sessions[k] for k in ("RecA", "RecA2", "RecB", "ReadOnly", "Finance", "Owner"))
        s_own, _ = admin.call("POST", POLICIES + "/owners", {"userId": users["Owner"]["id"]})
        assert s_own == 200, f"appointing the fixture policy owner: {s_own} (run on a database without policy owners)"

        def set_agreement(client_id, value):
            s_, b_ = owner.call("POST", f"{POLICIES}/{KEY}", {"value": value, "scope": str(client_id), "reason": f"probe {tag}"})
            assert s_ == 201, f"setting {KEY}: {s_} {b_}"

        today = date.today()
        past = lambda days: (today - timedelta(days=days)).isoformat()  # noqa: E731
        client_org = create(PARTNER, {"name": f"Wave4d Delta Hotels {tag}", "isCustomer": True, "partnerTypeSelect": 1})

        def call(client, method, path, body=None):
            s, resp = client.call(method, BASE + path, body if body is not None else ({} if method in ("POST", "PUT") else None))
            seen.append(json.dumps(resp))
            return s, resp

        def track(model, body):
            rid = (body.get("object") or {}).get("id") if isinstance(body, dict) else None
            if rid and (model, rid) not in created:
                created.append((model, rid))
            return body.get("object") or {}

        # --- 1. job orders and candidates ---------------------------------------------------------------
        def new_order(client, ref, headcount=1, **extra):
            s, body = call(client, "POST", "/job-orders", {"reference": ref, "clientId": client_org["id"], "title": "Front office supervisor",
                                                           "headcount": headcount, "location": "Cairo", **extra})
            return s, body, track(ORDER, body)

        s, body, order = new_order(a, f"jo-{tag}")
        check("job order opened (201, OPEN, recruited by me)", s == 201 and order.get("reference") == f"JO-{tag}"
              and order.get("status") == "OPEN" and order.get("recruitedByMe") is True, f"{s} {body}")
        bad = {}
        for label, (ref, extra) in {"duplicate": (f"JO-{tag}", {}), "bad reference": ("a b", {}), "no client": (f"X1-{tag}", {"clientId": MISSING}),
                                    "headcount": (f"X2-{tag}", {"headcount": 0}), "no title": (f"X3-{tag}", {"title": " "})}.items():
            s, body, _ = new_order(a, ref, **extra)
            bad[label] = (s, field(body))
        check("job order validation → 422 with the right field",
              [f for _, f in bad.values()] == ["reference", "reference", "clientId", "headcount", "title"]
              and all(s == 422 for s, _ in bad.values()), bad)

        def new_candidate(client, name):
            s, body = call(client, "POST", "/candidates", {"displayName": name, "headline": "Hotel reception, 6 years", "yearsExperience": 6})
            return s, track(CAND, body)

        s, cand = new_candidate(a, f"Candidate One {tag}")
        s_priv, b_priv = call(a, "PUT", f"/candidates/{cand['id']}/private",
                              {"version": version(CAND, cand["id"]), "email": SECRET_EMAIL, "phone": "+20 100 555 0101",
                               "expectedSalary": "18000.00", "cvReference": f"DMS-{tag}"})
        stored = search(PRIV, f"self.candidate.id = {cand['id']}", ("email",))
        check("restricted profile recorded write-only: stored, flagged on file, never echoed",
              s == 201 and s_priv == 200 and (b_priv.get("object") or {}).get("privateProfileOnFile") is True
              and stored and stored[0].get("email") == SECRET_EMAIL and SECRET_EMAIL not in json.dumps(b_priv), f"{s} {s_priv}")
        for model, rid in ((PRIV, r["id"]) for r in stored):
            created.append((model, rid))
        s_bad, b_bad = call(a, "PUT", f"/candidates/{cand['id']}/private", {"version": version(CAND, cand["id"]), "email": "not-an-email"})
        s_read, b_read = call(a, "GET", f"/candidates/{cand['id']}/private")
        s_read_b, _ = call(b, "GET", f"/candidates/{cand['id']}/private")
        check("restricted profile: bad e-mail → 422; owner read → BLOCKED_BY_POLICY (D-04, D-07); other recruiter → 404",
              (s_bad, field(b_bad)) == (422, "email") and s_read == 422 and error(b_read).get("code") == "BLOCKED_BY_POLICY"
              and all(d in error(b_read).get("message", "") for d in ("D-04", "D-07")) and s_read_b == 404, f"{s_bad} {s_read} {s_read_b}")

        # --- 2. pipeline --------------------------------------------------------------------------------
        def attach(client, order_row, cand_id):
            s, body = call(client, "POST", f"/job-orders/{order_row['id']}/applications",
                           {"version": version(ORDER, order_row["id"]), "candidateId": cand_id})
            return s, body, track(APP, body)

        def move(client, app_row, stage, ver=None):
            return call(client, "POST", f"/applications/{app_row['id']}/stage",
                        {"version": version(APP, app_row["id"]) if ver is None else ver, "stage": stage})

        s, body, app1 = attach(a, order, cand["id"])
        s_dup, b_dup, _ = attach(a, order, cand["id"])
        check("candidate added to pipeline (SOURCED); twice → 409 ALREADY_IN_PIPELINE",
              s == 201 and app1.get("stage") == "SOURCED" and s_dup == 409 and error(b_dup).get("code") == "ALREADY_IN_PIPELINE", f"{s} {s_dup}")
        s_skip, b_skip = move(a, app1, "INTERVIEWING")
        s_sub_early, b_sub_early = call(a, "POST", f"/applications/{app1['id']}/submit", {"version": version(APP, app1["id"])})
        s_stale, _ = move(a, app1, "SCREENED", ver=version(APP, app1["id"]) - 1)
        check("invalid transitions → 422 STAGE_TRANSITION (skip to interview, submit unscreened); stale version → 409",
              (s_skip, error(b_skip).get("code"), s_sub_early, error(b_sub_early).get("code"), s_stale)
              == (422, "STAGE_TRANSITION", 422, "STAGE_TRANSITION", 409), f"{s_skip} {s_sub_early} {s_stale}")
        move(a, app1, "SCREENED")
        s, body = move(a, app1, "SHORTLISTED")
        check("screened then shortlisted", s == 200 and (body.get("object") or {}).get("stage") == "SHORTLISTED", f"{s} {body}")

        # --- 3. consent and submission ---------------------------------------------------------------------
        def consent(client, cand_id, order_id, given="2026-10-01", method="WRITTEN"):
            s, body = call(client, "POST", f"/candidates/{cand_id}/consents",
                           {"version": version(CAND, cand_id), "jobOrderId": order_id, "method": method, "givenOn": given,
                            "evidenceReference": f"SIGNED-{tag}"})
            return s, body, track(CONSENT, body)

        def submit(client, app_row):
            return call(client, "POST", f"/applications/{app_row['id']}/submit", {"version": version(APP, app_row["id"])})

        # consent is per job order: a consent for another client's order does not cover this client
        other_client = create(PARTNER, {"name": f"Wave4d Red Sea Resorts {tag}", "isCustomer": True, "partnerTypeSelect": 1})
        _, _, other_order = new_order(a, f"jo2-{tag}", headcount=2, clientId=other_client["id"])
        s_oc, _, _ = consent(a, cand["id"], other_order["id"])
        s_cross, b_cross = submit(a, app1)
        check("consent for another client's job order does not allow submission here → 422 CONSENT_REQUIRED",
              (s_oc, s_cross, error(b_cross).get("code")) == (201, 422, "CONSENT_REQUIRED"), f"{s_oc} {s_cross} {b_cross}")
        s_none, b_none = submit(a, app1)
        s_future, b_future, _ = consent(a, cand["id"], order["id"], given="2099-01-01")
        s_c, _, c1 = consent(a, cand["id"], order["id"])
        s_rev, _ = call(a, "POST", f"/consents/{c1['id']}/revoke", {"version": version(CONSENT, c1["id"])})
        s_after, b_after = submit(a, app1)
        check("no consent → 422 CONSENT_REQUIRED; future-dated consent → 422; consent revoked before submission → still refused",
              (s_none, error(b_none).get("code"), s_future, field(b_future), s_c, s_rev, s_after, error(b_after).get("code"))
              == (422, "CONSENT_REQUIRED", 422, "givenOn", 201, 200, 422, "CONSENT_REQUIRED"), f"{s_none} {s_future} {s_c} {s_rev} {s_after}")
        consent(a, cand["id"], order["id"], method="EMAIL")
        s, body = submit(a, app1)
        s_cv, b_cv = call(a, "POST", f"/applications/{app1['id']}/share-cv")
        check("consenting shortlisted candidate submitted; sharing the CV → BLOCKED_BY_POLICY (D-04)",
              s == 200 and (body.get("object") or {}).get("stage") == "SUBMITTED" and (body.get("object") or {}).get("consentOnFile") is True
              and s_cv == 422 and error(b_cv).get("code") == "BLOCKED_BY_POLICY" and "D-04" in error(b_cv).get("message", ""), f"{s} {s_cv}")

        # --- 4. interview → offer → placement ------------------------------------------------------------
        def to_accepted(client, app_row, salary=None):
            s, body = call(client, "POST", f"/applications/{app_row['id']}/interviews",
                           {"version": version(APP, app_row["id"]), "round": 1, "scheduledAt": "2026-11-03T10:00"})
            interview = track(INTERVIEW, body)
            s2, _ = call(client, "POST", f"/interviews/{interview['id']}/outcome", {"version": version(INTERVIEW, interview["id"]), "outcome": "PASSED"})
            s3, b3 = call(client, "POST", f"/interviews/{interview['id']}/outcome", {"version": version(INTERVIEW, interview["id"]), "outcome": "FAILED"})
            offer = {"version": version(APP, app_row["id"]), "offerDate": past(60)}
            if salary:
                offer.update({"annualSalary": salary, "currencyCode": "EGP"})
            s4, _ = call(client, "POST", f"/applications/{app_row['id']}/offer", offer)
            s5, b5 = call(client, "POST", f"/applications/{app_row['id']}/offer-answer", {"version": version(APP, app_row["id"]), "accepted": True})
            return (s, s2, s3, error(b3).get("code"), s4, s5, (b5.get("object") or {}).get("offerStatus"))

        steps = to_accepted(a, app1)
        check("interview scheduled, outcome PASSED (second outcome → 422), offer, accepted",
              steps == (201, 200, 422, "OUTCOME_RECORDED", 200, 200, "ACCEPTED"), steps)
        # a second consenting candidate reaches an accepted offer too
        _, cand2 = new_candidate(a, f"Candidate Two {tag}")
        _, _, app2 = attach(a, order, cand2["id"])
        move(a, app2, "SCREENED")
        move(a, app2, "SHORTLISTED")
        consent(a, cand2["id"], order["id"])
        submit(a, app2)
        to_accepted(a, app2)

        def place(client, app_row, start=None):
            s, body = call(client, "POST", f"/applications/{app_row['id']}/placement",
                           {"version": version(APP, app_row["id"]), "startDate": start or past(10)})
            return s, body, track(PLACEMENT, body)

        s, body, pl = place(a, app1)
        _, ord_view = call(a, "GET", f"/job-orders/{order['id']}")
        check("placement confirmed (201) without a client agreement: guarantee TERMS_PENDING, fee POLICY_NOT_SET; order FILLED",
              s == 201 and pl.get("guaranteeStatus") == "TERMS_PENDING" and pl.get("invoicingStatus") == "POLICY_NOT_SET"
              and (ord_view.get("object") or {}).get("status") == "FILLED", f"{s} {body}")
        s_twice, b_twice, _ = place(a, app1)
        s_full, b_full, _ = place(a, app2)
        check("duplicate placement → 409 ALREADY_PLACED; another placement beyond the headcount → 422 HEADCOUNT_FILLED",
              (s_twice, error(b_twice).get("code"), s_full, error(b_full).get("code")) == (409, "ALREADY_PLACED", 422, "HEADCOUNT_FILLED"),
              f"{s_twice} {s_full}")
        s_inv0, b_inv0 = call(a, "POST", f"/placements/{pl['id']}/invoice")
        s_exit0, b_exit0 = call(a, "POST", f"/placements/{pl['id']}/early-exit", {"version": version(PLACEMENT, pl["id"]), "exitedOn": past(1), "reason": "RESIGNED"})
        s_old, _ = call(a, "POST", f"/placements/{pl['id']}/replacement")
        check("fail closed: no client agreement → fee 422 POLICY_NOT_SET; departure before the start → 422 NOT_STARTED; old replacement endpoint gone",
              (s_inv0, error(b_inv0).get("code"), s_exit0, error(b_exit0).get("code")) == (422, "POLICY_NOT_SET", 422, "NOT_STARTED")
              and KEY in error(b_inv0).get("message", "") and s_old in (404, 405), f"{s_inv0} {b_inv0} {s_exit0} {b_exit0} {s_old}")

        # --- 4b. the client agreement: START_DATE, 90 days, REPLACE ---------------------------------------
        set_agreement(client_org["id"], {"feePercent": 15, "invoiceOn": "START_DATE", "guaranteeDays": 90, "replacement": "REPLACE"})
        s_fut, b_fut = call(a, "POST", f"/placements/{pl['id']}/started", {"startedOn": (today + timedelta(days=3)).isoformat()})
        for _ in range(3):
            s_st, b_st = call(a, "POST", f"/placements/{pl['id']}/started", {"startedOn": past(10)})
        fees = search(FEE, f"self.placement.id = {pl['id']}", ("kindSelect",))
        for row in fees:
            created.append((FEE, row["id"]))
        st = b_st.get("object") or {}
        check("start recorded once (3×; future → 422): milestones OFFER_ACCEPTED + CANDIDATE_STARTED; agreement applied, guarantee ends start+90, "
              "fee waits for the offered salary",
              (s_fut, field(b_fut)) == (422, "startedOn") and s_st == 200
              and st.get("feeMilestones") == ["OFFER_ACCEPTED", "CANDIDATE_STARTED"] and len(fees) == 2
              and st.get("guaranteeStatus") == "ACTIVE" and st.get("guaranteeEndsOn") == (today + timedelta(days=80)).isoformat()
              and st.get("guaranteeDaysLeft") == 80 and st.get("invoicingStatus") == "OFFER_TERMS_MISSING" and st.get("replacementRule") == "REPLACE",
              f"{s_fut} {s_st} {st}")
        s_bad_sal, b_bad_sal = call(a, "PUT", f"/applications/{app1['id']}/offer-terms",
                                    {"version": version(APP, app1["id"]), "annualSalary": "-5", "currencyCode": "EGP"})
        s_sal, b_sal = call(a, "PUT", f"/applications/{app1['id']}/offer-terms",
                            {"version": version(APP, app1["id"]), "annualSalary": SECRET_SALARY, "currencyCode": "EGP"})
        stored_offer = search(OFFER, f"self.application.id = {app1['id']}", ("annualSalary",))
        for row in stored_offer:
            created.append((OFFER, row["id"]))
        _, b_pl = call(a, "GET", f"/placements/{pl['id']}")
        plv = b_pl.get("object") or {}
        check("offered salary write-only (bad → 422; stored; never echoed); the fee request is created: 15% of 240000 = 36000 EGP",
              (s_bad_sal, field(b_bad_sal)) == (422, "annualSalary") and s_sal == 200 and (b_sal.get("object") or {}).get("offerTermsOnFile") is True
              and stored_offer and float(stored_offer[0]["annualSalary"]) == 240000 and SECRET_SALARY not in json.dumps(b_sal)
              and plv.get("invoicingStatus") == "REQUESTED" and float(plv.get("feeAmount") or 0) == 36000 and plv.get("feeCurrency") == "EGP",
              f"{s_bad_sal} {s_sal} {plv}")
        again = [call(a, "POST", f"/placements/{pl['id']}/invoice") for _ in range(2)]
        requests_ = search(FEE_REQ, f"self.placement.id = {pl['id']}", ("kindSelect", "amountBeforeTax", "statusSelect"))
        for row in requests_:
            created.append((FEE_REQ, row["id"]))
        notices = search(NOTICE, f"self.recipient.id = {users['Finance']['id']} AND self.kind = 'RECRUITMENT_FEE_REQUESTED' AND self.subjectId = {pl['id']}")
        s_locked, b_locked = call(a, "PUT", f"/applications/{app1['id']}/offer-terms",
                                  {"version": version(APP, app1["id"]), "annualSalary": "999999", "currencyCode": "EGP"})
        check("one fee request per placement (invoice 2× more → 200, still 1); finance notified; salary locked once requested → 422 FEE_REQUESTED",
              all(s_ == 200 for s_, _ in again) and len(requests_) == 1 and float(requests_[0]["amountBeforeTax"]) == 36000
              and len(notices) >= 1 and (s_locked, error(b_locked).get("code")) == (422, "FEE_REQUESTED"),
              f"{[s_ for s_, _ in again]} {requests_} {len(notices)} {s_locked}")
        _, fin_list = call(fin_c, "GET", "/fee-requests")
        fin_row = next((r for r in (fin_list.get("object") or []) if r.get("placementId") == pl["id"]), {})
        _, b_list = call(b, "GET", "/fee-requests")
        s_b_pl, _ = call(b, "GET", f"/placements/{pl['id']}")
        _, ro_pl = call(ro_c, "GET", f"/placements/{pl['id']}")
        s_ro_inv, _ = call(ro_c, "POST", f"/placements/{pl['id']}/invoice")
        s_sales, _ = call(ro_c, "GET", "/fee-requests")
        check("finance lists the request (36000, 15%); another recruiter sees neither it nor the placement (404); read-only reads the placement "
              "without the amount, cannot request (403) or list fee requests (403)",
              fin_row.get("kind") == "FEE_INVOICE" and float(fin_row.get("amount") or 0) == 36000 and float(fin_row.get("ratePercent") or 0) == 15
              and pl["id"] not in [r.get("placementId") for r in (b_list.get("object") or [])] and s_b_pl == 404
              and (ro_pl.get("object") or {}).get("invoicingStatus") == "REQUESTED" and (ro_pl.get("object") or {}).get("feeAmount") is None
              and s_ro_inv == 403 and s_sales == 403, f"{fin_row} {s_b_pl} {ro_pl.get('object')} {s_ro_inv} {s_sales}")

        # --- 4c. early exit within the guarantee under REPLACE: a free replacement ----------------------------
        v_pl = version(PLACEMENT, pl["id"])
        s_stale_x, _ = call(a, "POST", f"/placements/{pl['id']}/early-exit", {"version": v_pl - 1, "exitedOn": past(2), "reason": "RESIGNED"})
        s_x_ro, _ = call(ro_c, "POST", f"/placements/{pl['id']}/early-exit", {"version": v_pl, "exitedOn": past(2), "reason": "RESIGNED"})
        s_x_bad, b_x_bad = call(a, "POST", f"/placements/{pl['id']}/early-exit", {"version": v_pl, "exitedOn": past(20), "reason": "RESIGNED"})
        s_x, b_x = call(a, "POST", f"/placements/{pl['id']}/early-exit", {"version": v_pl, "exitedOn": past(2), "reason": "RESIGNED"})
        s_x2, b_x2 = call(a, "POST", f"/placements/{pl['id']}/early-exit", {"version": version(PLACEMENT, pl["id"]), "exitedOn": past(1), "reason": "OTHER"})
        _, ord_after = call(a, "GET", f"/job-orders/{order['id']}")
        xo = b_x.get("object") or {}
        check("departure: stale → 409; read-only → 403; before the start → 422; within the guarantee → EARLY_EXIT, REPLACEMENT_OPENED, "
              "job order OPEN again; twice → 409 ALREADY_EXITED",
              s_stale_x == 409 and s_x_ro == 403 and (s_x_bad, field(b_x_bad)) == (422, "exitedOn") and s_x == 200
              and xo.get("guaranteeStatus") == "EARLY_EXIT" and xo.get("exitOutcome") == "REPLACEMENT_OPENED"
              and (ord_after.get("object") or {}).get("status") == "OPEN" and (s_x2, error(b_x2).get("code")) == (409, "ALREADY_EXITED"),
              f"{s_stale_x} {s_x_ro} {s_x_bad} {s_x} {xo} {s_x2}")
        s_rep, b_rep, pl2 = place(a, app2, start=past(1))
        s_rep_inv, b_rep_inv = call(a, "POST", f"/placements/{pl2.get('id')}/invoice")
        _, ord_refilled = call(a, "GET", f"/job-orders/{order['id']}")
        rep_fees = search(FEE_REQ, f"self.placement.id = {pl2.get('id') or 0}")
        check("the next placement is the free replacement: replacementOf set, fee WAIVED_REPLACEMENT (request → 422 FEE_WAIVED), no fee request; order FILLED",
              s_rep == 201 and pl2.get("replacementOfId") == pl["id"] and pl2.get("feeWaived") is True
              and pl2.get("invoicingStatus") == "WAIVED_REPLACEMENT" and (s_rep_inv, error(b_rep_inv).get("code")) == (422, "FEE_WAIVED")
              and rep_fees == [] and (ord_refilled.get("object") or {}).get("status") == "FILLED", f"{s_rep} {pl2} {s_rep_inv}")

        # --- 4d. OFFER_ACCEPTED, 30 days, PARTIAL_REFUND 50%: the fee at placement; a credit within; nothing after ---
        set_agreement(other_client["id"], {"feePercent": 20, "invoiceOn": "OFFER_ACCEPTED", "guaranteeDays": 30,
                                           "replacement": "PARTIAL_REFUND", "refundPercent": 40})
        partial = []
        for n, start_days in ((3, 5), (4, 40)):
            _, cn = new_candidate(a, f"Candidate {n} {tag}")
            _, _, ap = attach(a, other_order, cn["id"])
            move(a, ap, "SCREENED")
            move(a, ap, "SHORTLISTED")
            consent(a, cn["id"], other_order["id"])
            submit(a, ap)
            to_accepted(a, ap, salary="180000")
            s_p, _, pp = place(a, ap, start=past(start_days))
            s_start, _ = call(a, "POST", f"/placements/{pp.get('id')}/started", {"startedOn": past(start_days)})
            partial.append((s_p, pp, s_start))
        (s_p3, p3, s_st3), (s_p4, p4, s_st4) = partial
        check("OFFER_ACCEPTED agreement: the fee request exists right after the placement (20% of 180000 = 36000); "
              "recording the start afterwards keeps that one request (200)",
              s_p3 == s_p4 == 201 and p3.get("invoicingStatus") == "REQUESTED" and float(p3.get("feeAmount") or 0) == 36000
              and s_st3 == s_st4 == 200 and len(search(FEE_REQ, f"self.placement.id = {p3.get('id') or 0}")) == 1,
              f"{s_p3} {s_p4} {s_st3} {s_st4} {p3}")
        s_r, b_r = call(a, "POST", f"/placements/{p3['id']}/early-exit", {"version": version(PLACEMENT, p3["id"]), "exitedOn": past(0), "reason": "DISMISSED"})
        s_o, b_o = call(a, "POST", f"/placements/{p4['id']}/early-exit", {"version": version(PLACEMENT, p4["id"]), "exitedOn": past(1), "reason": "RESIGNED"})
        credits = search(FEE_REQ, f"self.placement.id = {p3['id']} AND self.kindSelect = 2", ("amountBeforeTax",))
        no_credit = search(FEE_REQ, f"self.placement.id = {p4['id']} AND self.kindSelect = 2")
        refund_notice = search(NOTICE, f"self.recipient.id = {users['Finance']['id']} AND self.kind = 'RECRUITMENT_REFUND_REQUESTED' AND self.subjectId = {p3['id']}")
        _, other_after = call(a, "GET", f"/job-orders/{other_order['id']}")
        ro_ = b_r.get("object") or {}
        check("PARTIAL_REFUND: an exit within 30 days asks finance for a 40% credit (14400) and notifies it; an exit after the guarantee "
              "is EXITED_AFTER with no credit; the job order is not reopened",
              s_r == 200 and ro_.get("exitOutcome") == "REFUND_REQUESTED" and ro_.get("refundStatus") == "REQUESTED"
              and float(ro_.get("refundAmount") or 0) == 14400 and len(credits) == 1 and float(credits[0]["amountBeforeTax"]) == 14400
              and len(refund_notice) >= 1 and s_o == 200 and (b_o.get("object") or {}).get("exitOutcome") == "OUTSIDE_GUARANTEE"
              and (b_o.get("object") or {}).get("guaranteeStatus") == "EXITED_AFTER" and no_credit == []
              and (other_after.get("object") or {}).get("status") == "FILLED", f"{s_r} {ro_} {credits} {s_o} {b_o.get('object')}")
        s_cv, b_cv = call(a, "POST", f"/applications/{app1['id']}/share-cv")
        check("sharing the CV or contact details with the client stays closed (D-04: only through the client portal, D-10)",
              s_cv == 422 and error(b_cv).get("code") == "BLOCKED_BY_POLICY" and "portal" in error(b_cv).get("message", ""), f"{s_cv} {b_cv}")

        # --- 5. isolation ----------------------------------------------------------------------------------
        s_o, b_o = call(b, "GET", f"/job-orders/{order['id']}")
        s_m, b_m = call(b, "GET", f"/job-orders/{MISSING}")
        s_c_b, _ = call(b, "GET", f"/candidates/{cand['id']}")
        s_p_b, _ = call(b, "GET", f"/job-orders/{order['id']}/applications")
        _, _, order_b = new_order(b, f"JB-{tag}")
        s_att_b, b_att_b, _ = attach(b, order_b, cand["id"])
        _, lst = call(b, "GET", "/candidates")
        check("another recruiter: job order, candidate and pipeline answer 404 like missing ids; cannot attach someone else's candidate",
              s_o == s_m == s_c_b == s_p_b == 404 and error(b_o).get("code") == error(b_m).get("code")
              and (s_att_b, field(b_att_b)) == (422, "candidateId")
              and cand["id"] not in [c["id"] for c in lst.get("object") or []], f"{s_o} {s_m} {s_c_b} {s_p_b} {s_att_b}")
        s_ro_get, _ = call(ro_c, "GET", f"/job-orders/{order['id']}/applications")
        s_ro_post, _ = move(ro_c, app2, "REJECTED")
        s_ro_priv, _ = call(ro_c, "PUT", f"/candidates/{cand['id']}/private", {"version": version(CAND, cand["id"]), "email": "x@y.zz"})
        check("read-only: reads the pipeline (200), cannot change it or the restricted profile (403)",
              s_ro_get == 200 and s_ro_post == 403 and s_ro_priv == 403, f"{s_ro_get} {s_ro_post} {s_ro_priv}")

        # --- 6. concurrency ------------------------------------------------------------------------------
        outcomes = []
        for i in range(ROUNDS):
            _, _, o = new_order(a, f"R{i}-{tag}")
            _, c = new_candidate(a, f"Race {i} {tag}")
            _, _, ap = attach(a, o, c["id"])
            move(a, ap, "SCREENED")
            move(a, ap, "SHORTLISTED")
            consent(a, c["id"], o["id"])
            v0 = version(APP, ap["id"])
            gate, answers = threading.Barrier(2), []

            def run(client):
                gate.wait()
                answers.append(client.call("POST", f"{BASE}/applications/{ap['id']}/submit", {"version": v0}))

            threads = [threading.Thread(target=run, args=(cl,)) for cl in (a, a2)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            outcomes.append(sorted(s for s, _ in answers))
        check(f"concurrent submissions of one application: one 200 and one 409 ({ROUNDS} rounds)",
              all(o == [200, 409] for o in outcomes), outcomes)
        check("restricted values (contact data, expected and offered salary) never appear in any API response",
              not any(SECRET_EMAIL in r or "18000" in r or SECRET_SALARY in r for r in seen), "leak found")

        failed = [r for r in RESULTS if r["result"] != "PASS"]
        print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
        exit_code = 0 if not failed else 1
    finally:
        order_ids = [r["id"] for r in search(ORDER, f"self.reference like '%{tag}'")]
        cand_ids = [r["id"] for r in search(CAND, f"self.displayName like '%{tag}'")]
        if order_ids:
            ids = ",".join(map(str, order_ids))
            # credits point at the fee they credit, and a replacement at the placement it replaces: those links go first
            for row in search(FEE_REQ, f"self.placement.application.jobOrder.id in ({ids}) AND self.refundOf IS NOT NULL"):
                admin.call("DELETE", f"/ws/rest/{FEE_REQ}/{row['id']}")
            for row in search(PLACEMENT, f"self.application.jobOrder.id in ({ids}) AND self.replacementOf IS NOT NULL", ("version",)):
                admin.call("POST", f"/ws/rest/{PLACEMENT}/{row['id']}", {"data": {"id": row["id"], "version": row.get("version"), "replacementOf": None}})
            for model, domain in ((FEE_REQ, f"self.placement.application.jobOrder.id in ({ids})"),
                                  (OFFER, f"self.application.jobOrder.id in ({ids})"),
                                  (FEE, f"self.placement.application.jobOrder.id in ({ids})"),
                                  (PLACEMENT, f"self.application.jobOrder.id in ({ids})"),
                                  (INTERVIEW, f"self.application.jobOrder.id in ({ids})"),
                                  (CONSENT, f"self.jobOrder.id in ({ids})"), (APP, f"self.jobOrder.id in ({ids})"),
                                  (ORDER, f"self.id in ({ids})")):
                for row in search(model, domain):
                    if (model, row["id"]) not in created:
                        created.append((model, row["id"]))
        if cand_ids:
            ids = ",".join(map(str, cand_ids))
            for model, domain in ((PRIV, f"self.candidate.id in ({ids})"), (CAND, f"self.id in ({ids})")):
                for row in search(model, domain):
                    if (model, row["id"]) not in created:
                        created.append((model, row["id"]))
        created.extend((VERSION, v["id"]) for v in search(VERSION, f"self.policyKey = '{KEY}'"))
        if users:
            uids = ",".join(str(u["id"]) for u in users.values())
            created.extend((NOTICE, n["id"]) for n in search(NOTICE, f"self.recipient.id in ({uids})"))
            created.extend((AUDIT, x["id"]) for x in search(AUDIT, f"self.actor.id in ({uids}) OR (self.subject = 'USER' AND self.subjectId in ({uids}))"))
            for user in users.values():
                current = search(USER, f"self.id = {user['id']}", ("version",))
                if current:
                    admin.call("POST", f"/ws/rest/{USER}/{user['id']}", {"data": {"id": user["id"], "version": current[0].get("version"), "roles": [], "blocked": True}})
        if FINANCE_ROLE not in roles_before:
            created.extend((ROLE, r["id"]) for r in search(ROLE, f"self.name = '{FINANCE_ROLE}'"))
        complete, leftovers = cleanup(admin, list(dict.fromkeys(created)), {NOTICE: 0, AUDIT: 0, FEE_REQ: 0, OFFER: 0, FEE: 0, VERSION: 6,
                                                                          PLACEMENT: 1, INTERVIEW: 2, CONSENT: 3, APP: 3, PRIV: 4,
                                                                          ORDER: 5, CAND: 5, PARTNER: 6, USER: 7, ROLE: 8, GROUP: 8, PERM: 9})
        if not complete:
            print(f"FAIL cleanup left {leftovers}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "recruitment-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
