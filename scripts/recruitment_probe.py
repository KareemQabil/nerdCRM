#!/usr/bin/env python3
"""Wave 4D live probe: recruitment for external clients.

Run against a RUNNING local/CI Axelor; never against production. Roles are TEST FIXTURES built from
native permissions (policy D-07 defines the real ones): RecA and RecB see their own job orders and
candidates only, ReadOnly reads non-restricted records. Clients and candidates are fictional.
Checks, through /ws/ioeti/recruitment:
  job order and candidate validation; restricted profile is write-only (never echoed, read → D-04/D-07)
  pipeline: duplicate attach → 409; invalid transitions → 422; stale version → 409
  submission needs a shortlisted candidate and an unrevoked consent for that job order; consent revoked
  before submission blocks it; sharing the CV with the client → BLOCKED_BY_POLICY (D-04)
  interview → offer → acceptance → placement; duplicate placement → 409; headcount filled → 422
  fee milestones recorded once per kind (idempotent); invoice and replacement → BLOCKED_BY_POLICY
  cross-recruiter isolation: another recruiter's job order, candidate and pipeline answer 404
  N concurrent submissions of one application → one 200 and one 409
Env: PROBE_REC_ROUNDS (default 5). Report: logs/recruitment-probe.json.
"""
import json
import os
import secrets
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PARTNER = "com.axelor.apps.base.db.Partner"
P = "com.ioeti.recruitment.db."
ORDER, CAND, PRIV, CONSENT = P + "ClientJobOrder", P + "RecruitmentCandidate", P + "CandidatePrivateProfile", P + "CandidateConsent"
APP, INTERVIEW, PLACEMENT, FEE = P + "CandidateApplication", P + "ClientInterview", P + "Placement", P + "RecruitmentFeeMilestone"
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
               perm("partner", PARTNER, canRead=True)]
        ro = [perm(f"ro.{m.split('.')[-1].lower()}", m, canRead=True)
              for m in (ORDER, CAND, CONSENT, APP, INTERVIEW, PLACEMENT, FEE, PARTNER)]
        groups = {"rec": create(GROUP, {"code": f"wave4d-rec-{tag}", "name": f"Wave4d recruiter {tag}",
                                        "permissions": [{"id": p["id"]} for p in rec]}),
                  "ro": create(GROUP, {"code": f"wave4d-ro-{tag}", "name": f"Wave4d read-only {tag}",
                                       "permissions": [{"id": p["id"]} for p in ro]})}
        sessions = {}
        for label, group in (("RecA", "rec"), ("RecA2", None), ("RecB", "rec"), ("ReadOnly", "ro")):
            if group is None:
                sessions[label] = Client()
                assert sessions[label].login(users["RecA"]["code"], users["RecA"]["_pw"]) == 200
                continue
            password = "W4d!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"wave4d.{label.lower()}.{tag}", "name": f"Wave4d {label}",
                                         "blocked": False, "language": "en", "group": {"id": groups[group]["id"]},
                                         "password": axelor_password_hash(password)})
            users[label]["_pw"] = password
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        a, a2, b, ro_c = (sessions[k] for k in ("RecA", "RecA2", "RecB", "ReadOnly"))
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
        def to_accepted(client, app_row):
            s, body = call(client, "POST", f"/applications/{app_row['id']}/interviews",
                           {"version": version(APP, app_row["id"]), "round": 1, "scheduledAt": "2026-11-03T10:00"})
            interview = track(INTERVIEW, body)
            s2, _ = call(client, "POST", f"/interviews/{interview['id']}/outcome", {"version": version(INTERVIEW, interview["id"]), "outcome": "PASSED"})
            s3, b3 = call(client, "POST", f"/interviews/{interview['id']}/outcome", {"version": version(INTERVIEW, interview["id"]), "outcome": "FAILED"})
            s4, _ = call(client, "POST", f"/applications/{app_row['id']}/offer", {"version": version(APP, app_row["id"]), "offerDate": "2026-11-05"})
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

        def place(client, app_row):
            s, body = call(client, "POST", f"/applications/{app_row['id']}/placement",
                           {"version": version(APP, app_row["id"]), "startDate": "2026-12-01"})
            return s, body, track(PLACEMENT, body)

        s, body, pl = place(a, app1)
        _, ord_view = call(a, "GET", f"/job-orders/{order['id']}")
        check("placement confirmed (201): guarantee terms pending policy, order FILLED at headcount 1",
              s == 201 and pl.get("guaranteeStatus") == "TERMS_PENDING_POLICY" and pl.get("invoicingStatus") == "BLOCKED_BY_POLICY"
              and (ord_view.get("object") or {}).get("status") == "FILLED", f"{s} {body}")
        s_twice, b_twice, _ = place(a, app1)
        s_full, b_full, _ = place(a, app2)
        check("duplicate placement → 409 ALREADY_PLACED; another placement beyond the headcount → 422 HEADCOUNT_FILLED",
              (s_twice, error(b_twice).get("code"), s_full, error(b_full).get("code")) == (409, "ALREADY_PLACED", 422, "HEADCOUNT_FILLED"),
              f"{s_twice} {s_full}")
        for _ in range(3):
            s_st, b_st = call(a, "POST", f"/placements/{pl['id']}/started", {"startedOn": "2026-12-01"})
        fees = search(FEE, f"self.placement.id = {pl['id']}", ("kindSelect",))
        for row in fees:
            created.append((FEE, row["id"]))
        check("fee milestones recorded once per kind (start recorded 3×): OFFER_ACCEPTED, CANDIDATE_STARTED",
              s_st == 200 and (b_st.get("object") or {}).get("feeMilestones") == ["OFFER_ACCEPTED", "CANDIDATE_STARTED"]
              and len(fees) == 2, f"{s_st} {b_st.get('object')} {len(fees)}")
        s_inv, b_inv = call(a, "POST", f"/placements/{pl['id']}/invoice")
        s_rep, b_rep = call(a, "POST", f"/placements/{pl['id']}/replacement")
        check("fee invoice (D-04, D-06) and guarantee replacement (D-04) → 422 BLOCKED_BY_POLICY",
              s_inv == s_rep == 422 and error(b_inv).get("code") == error(b_rep).get("code") == "BLOCKED_BY_POLICY"
              and "D-06" in error(b_inv).get("message", ""), f"{s_inv} {s_rep}")

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
        check("restricted values never appear in any API response", not any(SECRET_EMAIL in r or "18000" in r for r in seen),
              "leak found")

        failed = [r for r in RESULTS if r["result"] != "PASS"]
        print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
        exit_code = 0 if not failed else 1
    finally:
        order_ids = [r["id"] for r in search(ORDER, f"self.reference like '%{tag}'")]
        cand_ids = [r["id"] for r in search(CAND, f"self.displayName like '%{tag}'")]
        if order_ids:
            ids = ",".join(map(str, order_ids))
            for model, domain in ((FEE, f"self.placement.application.jobOrder.id in ({ids})"),
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
        complete, leftovers = cleanup(admin, created, {FEE: 0, PLACEMENT: 1, INTERVIEW: 2, CONSENT: 3, APP: 3, PRIV: 4,
                                                       ORDER: 5, CAND: 5, PARTNER: 6, USER: 7, GROUP: 8, PERM: 9})
        if not complete:
            print(f"FAIL cleanup left {leftovers}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "recruitment-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
