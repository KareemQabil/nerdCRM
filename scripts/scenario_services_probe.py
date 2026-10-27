#!/usr/bin/env python3
"""Scenarios S2–S4 (live): one client served by training, recruitment and fundraising at once, under load.

Run against a RUNNING local/CI Axelor; never against production. The per-area probes race two requests
on one version; these scenarios put many users on the same records at the same moment, the way a busy
morning would, and then check that every area agrees. Roles are TEST FIXTURES built from native
permissions (policy D-07 defines the real ones). The client, trainees, candidates and donors are fictional.
  S2 training rush: 10 coordinator sessions enrol 10 trainees into a 3-seat cohort at once, each retrying
     on a stale version → every trainee enrolled exactly once, 3 confirmed, waitlist exactly 1..7; then
     the 3 confirmed enrolments are cancelled at the same moment → the first 3 waitlisted are promoted,
     the waitlist closes up to 1..4, never above capacity
  S3 recruitment: two accepted candidates for a one-position job order are placed at the same moment →
     one placement, the other HEADCOUNT_FILLED, the order FILLED
  S4 fundraising: two fundraisers record the same bank reference on different commitments at the same
     moment (no shared lock) → one collection, the other 409 DUPLICATE_COLLECTION, never a 500; collected
     totals equal the accepted collections exactly; a pledge never appears as revenue
  cross-area: Account 360 counts each area once for the administrator; a salesperson sees none of it
Env: PROBE_SCENARIO_ROUNDS (default 5). Report: logs/scenario-services.json.
"""
import json
import os
import random
import secrets
import sys
import threading
import time
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PARTNER = "com.axelor.apps.base.db.Partner"
T = "com.ioeti.training.db."
COURSE, COHORT, ENROLLMENT = T + "TrainingCourse", T + "TrainingCohort", T + "TrainingEnrollment"
R = "com.ioeti.recruitment.db."
ORDER, CAND, PRIV, CONSENT = R + "ClientJobOrder", R + "RecruitmentCandidate", R + "CandidatePrivateProfile", R + "CandidateConsent"
APP, INTERVIEW, PLACEMENT, FEE = R + "CandidateApplication", R + "ClientInterview", R + "Placement", R + "RecruitmentFeeMilestone"
F = "com.ioeti.fundraising.db."
DONOR, SENS, F_OPP, COMMIT = F + "DonorProfile", F + "DonorSensitiveProfile", F + "FundingOpportunity", F + "FundingCommitment"
INST, COLL, DELIV, STEW = F + "PledgeInstallment", F + "DonationCollection", F + "GrantDeliverable", F + "StewardshipActivity"
TR, RC, FR, WS = "/ws/ioeti/training", "/ws/ioeti/recruitment", "/ws/ioeti/fundraising", "/ws/ioeti/workspace"
ROUNDS = int(os.environ.get("PROBE_SCENARIO_ROUNDS", "5"))
RUSH = 10
SEATS = 3
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


def at_once(jobs):
    """Runs every job in its own thread, released together; returns their answers in job order."""
    gate, answers = threading.Barrier(len(jobs)), [None] * len(jobs)

    def run(i, job):
        gate.wait()
        answers[i] = job()

    threads = [threading.Thread(target=run, args=(i, job)) for i, job in enumerate(jobs)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return answers


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

    def track(model, body):
        rid = obj(body).get("id")
        if rid and (model, rid) not in created:
            created.append((model, rid))
        return obj(body)

    def search(model, domain, fields=("id",)):
        _, body = admin.call("POST", f"/ws/rest/{model}/search",
                             {"fields": list(fields), "limit": 500, "data": {"_domain": domain, "_archived": True}})
        return body.get("data") or []

    def version(model, rid):
        _, body = admin.call("POST", f"/ws/rest/{model}/{rid}/fetch", {"fields": ["version"]})
        return (body.get("data") or [{}])[0].get("version")

    exit_code = 1
    try:
        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"s24.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})

        rw = dict(canRead=True, canWrite=True, canCreate=True)
        coord = [perm("course", COURSE, canRead=True, canCreate=True), perm("cohort", COHORT, "self.coordinator = ?", **rw),
                 perm("enrol", ENROLLMENT, "self.cohort.coordinator = ?", **rw), perm("t.partner", PARTNER, canRead=True)]
        rec = [perm("order", ORDER, "self.recruiter = ?", **rw), perm("cand", CAND, "self.owner = ?", **rw),
               perm("consent", CONSENT, "self.candidate.owner = ?", **rw), perm("app", APP, "self.jobOrder.recruiter = ?", **rw),
               perm("interview", INTERVIEW, "self.application.jobOrder.recruiter = ?", **rw),
               perm("placement", PLACEMENT, "self.application.jobOrder.recruiter = ?", **rw), perm("r.partner", PARTNER, canRead=True)]
        own = {DONOR: "self.relationshipManager = ?", F_OPP: "self.donor.relationshipManager = ?",
               COMMIT: "self.opportunity.donor.relationshipManager = ?", INST: "self.commitment.opportunity.donor.relationshipManager = ?",
               COLL: "self.installment.commitment.opportunity.donor.relationshipManager = ?"}
        fund = [perm(f"f.{m.split('.')[-1].lower()}", m, cond, **rw) for m, cond in own.items()] + [perm("f.partner", PARTNER, canRead=True)]
        sales = [perm("s.partner", PARTNER, canRead=True)]
        groups = {k: create(GROUP, {"code": f"s24-{k}-{tag}", "name": f"S2-4 {k} {tag}", "permissions": [{"id": p["id"]} for p in v]})
                  for k, v in (("coord", coord), ("rec", rec), ("fund", fund), ("sales", sales))}
        users, passwords = {}, {}
        for label, group in (("Coord", "coord"), ("Rec", "rec"), ("FundA", "fund"), ("FundB", "fund"), ("Sales", "sales")):
            passwords[label] = "S24!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"s24.{label.lower()}.{tag}", "name": f"S2-4 {label} {tag}", "blocked": False,
                                         "language": "en", "group": {"id": groups[group]["id"]},
                                         "password": axelor_password_hash(passwords[label])})

        def session(label):
            c = Client()
            assert c.login(users[label]["code"], passwords[label]) == 200, label
            return c

        coord_c, rec_c, rec_c2, fund_a, fund_b, sales_c = (session(k) for k in ("Coord", "Rec", "Rec", "FundA", "FundB", "Sales"))
        client_org = create(PARTNER, {"name": f"S2-4 Delta Group {tag}", "isCustomer": True, "partnerTypeSelect": 1})
        other_donor = create(PARTNER, {"name": f"S2-4 Red Sea Foundation {tag}", "isProspect": True, "partnerTypeSelect": 1})
        trainees = [create(PARTNER, {"firstName": "Trainee", "name": f"S24-{i} {tag}", "partnerTypeSelect": 2}) for i in range(RUSH)]

        # --- S2 training rush -------------------------------------------------------------------------------
        s_c, b_c = coord_c.call("POST", f"{TR}/courses", {"code": f"c-{tag}", "name": "Internal auditor ISO 9001", "durationHours": 16})
        course = track(COURSE, b_c)
        s_k, b_k = coord_c.call("POST", f"{TR}/cohorts", {"courseId": course.get("id"), "code": f"k-{tag}", "capacity": SEATS,
                                                          "startDate": "2026-12-01", "endDate": "2026-12-03"})
        cohort = track(COHORT, b_k)
        s_o, _ = coord_c.call("POST", f"{TR}/cohorts/{cohort.get('id')}/open", {"version": version(COHORT, cohort.get("id"))})
        assert (s_c, s_k, s_o) == (201, 201, 200), f"training fixtures {s_c} {s_k} {s_o} {b_k}"
        rushers = [session("Coord") for _ in range(RUSH)]

        def enrol_until_done(client, trainee_id):
            attempts, statuses = 0, []
            while attempts < 40:
                attempts += 1
                s_, b_ = client.call("POST", f"{TR}/cohorts/{cohort['id']}/enrollments",
                                     {"version": version(COHORT, cohort["id"]), "traineeId": trainee_id, "clientId": client_org["id"]})
                statuses.append(s_)
                if s_ == 201:
                    track(ENROLLMENT, b_)
                    return statuses
                if s_ != 409:
                    return statuses
                time.sleep(random.uniform(0.01, 0.15))
            return statuses

        rush = at_once([lambda c=c, t=t: enrol_until_done(c, t["id"]) for c, t in zip(rushers, trainees)])

        def roster():
            _, body = coord_c.call("GET", f"{TR}/cohorts/{cohort['id']}/enrollments")
            return [(r["traineeId"], r["status"], r["waitlistPosition"]) for r in rows(body)]

        before = roster()
        confirmed = [r for r in before if r[1] == "CONFIRMED"]
        waiting = sorted((r for r in before if r[1] == "WAITLISTED"), key=lambda r: r[2])
        check(f"S2 rush: {RUSH} sessions enrol {RUSH} trainees into {SEATS} seats at once (retrying on 409) → each enrolled once, "
              f"{SEATS} confirmed, waitlist exactly 1..{RUSH - SEATS}; only 201 or 409 answered",
              all(s[-1] == 201 for s in rush) and all(set(s) <= {201, 409} for s in rush)
              and len(before) == RUSH and len({r[0] for r in before}) == RUSH and len(confirmed) == SEATS
              and [r[2] for r in waiting] == list(range(1, RUSH - SEATS + 1)),
              f"{[s for s in rush]} {before}")
        by_trainee = {e["traineeId"]: e for e in rows(coord_c.call("GET", f"{TR}/cohorts/{cohort['id']}/enrollments")[1])}
        cancellers = rushers[:SEATS]
        cancels = at_once([lambda c=c, e=by_trainee[r[0]]: c.call("POST", f"{TR}/enrollments/{e['id']}/cancel",
                                                                  {"version": version(ENROLLMENT, e["id"])})[0]
                           for c, r in zip(cancellers, confirmed)])
        after = roster()
        now_confirmed = sorted(r[0] for r in after if r[1] == "CONFIRMED")
        now_waiting = sorted((r for r in after if r[1] == "WAITLISTED"), key=lambda r: r[2])
        _, view = coord_c.call("GET", f"{TR}/cohorts/{cohort['id']}")
        check(f"S2 the {SEATS} confirmed cancelled at the same moment → the first {SEATS} waitlisted promoted in order, waitlist "
              f"closes up to 1..{RUSH - 2 * SEATS}; cohort never above capacity",
              cancels == [200] * SEATS and now_confirmed == sorted(r[0] for r in waiting[:SEATS])
              and [(r[0], r[2]) for r in now_waiting] == [(r[0], i + 1) for i, r in enumerate(waiting[SEATS:])]
              and (obj(view).get("confirmed"), obj(view).get("waitlisted"), obj(view).get("seatsLeft")) == (SEATS, RUSH - 2 * SEATS, 0),
              f"{cancels} {after} {obj(view)}")

        # --- S3 recruitment: concurrent placements on the last position ----------------------------------------
        s_jo, b_jo = rec_c.call("POST", f"{RC}/job-orders", {"reference": f"jo-{tag}", "clientId": client_org["id"],
                                                             "title": "Quality manager", "headcount": 1, "location": "Cairo"})
        order = track(ORDER, b_jo)
        apps = []
        for i in range(2):
            _, b_cd = rec_c.call("POST", f"{RC}/candidates", {"displayName": f"Candidate {i} {tag}", "headline": "QA lead", "yearsExperience": 8})
            cand = track(CAND, b_cd)
            _, b_ap = rec_c.call("POST", f"{RC}/job-orders/{order['id']}/applications",
                                 {"version": version(ORDER, order["id"]), "candidateId": cand["id"]})
            app = track(APP, b_ap)
            for stage in ("SCREENED", "SHORTLISTED"):
                rec_c.call("POST", f"{RC}/applications/{app['id']}/stage", {"version": version(APP, app["id"]), "stage": stage})
            _, b_cs = rec_c.call("POST", f"{RC}/candidates/{cand['id']}/consents",
                                 {"version": version(CAND, cand["id"]), "jobOrderId": order["id"], "method": "WRITTEN",
                                  "givenOn": "2026-10-01", "evidenceReference": f"SIGNED-{tag}-{i}"})
            track(CONSENT, b_cs)
            rec_c.call("POST", f"{RC}/applications/{app['id']}/submit", {"version": version(APP, app["id"])})
            _, b_iv = rec_c.call("POST", f"{RC}/applications/{app['id']}/interviews",
                                 {"version": version(APP, app["id"]), "round": 1, "scheduledAt": "2026-11-03T10:00"})
            iv = track(INTERVIEW, b_iv)
            rec_c.call("POST", f"{RC}/interviews/{iv['id']}/outcome", {"version": version(INTERVIEW, iv["id"]), "outcome": "PASSED"})
            rec_c.call("POST", f"{RC}/applications/{app['id']}/offer", {"version": version(APP, app["id"]), "offerDate": "2026-11-05"})
            _, b_acc = rec_c.call("POST", f"{RC}/applications/{app['id']}/offer-answer", {"version": version(APP, app["id"]), "accepted": True})
            assert obj(b_acc).get("offerStatus") == "ACCEPTED", f"offer fixture {b_acc}"
            apps.append(app)
        placed = at_once([lambda c=c, a=a, v=version(APP, a["id"]): c.call("POST", f"{RC}/applications/{a['id']}/placement",
                                                                             {"version": v, "startDate": "2026-12-01"})
                          for c, a in zip((rec_c, rec_c2), apps)])
        for _, body in placed:
            track(PLACEMENT, body)
        outcome = sorted((s_, error(b_).get("code")) for s_, b_ in placed)
        _, ov = rec_c.call("GET", f"{RC}/job-orders/{order['id']}")
        check("S3 two accepted candidates placed at the same moment on a one-position order → one placement (201), the other "
              "422 HEADCOUNT_FILLED; the order is FILLED with exactly one placement",
              outcome == [(201, None), (422, "HEADCOUNT_FILLED")] and obj(ov).get("status") == "FILLED"
              and len(search(PLACEMENT, f"self.application.jobOrder.id = {order['id']}")) == 1, f"{outcome} {obj(ov)}")

        # --- S4 fundraising: the same bank reference on two commitments at once ---------------------------------
        def pledge(client, partner_id, ref):
            _, b_d = client.call("POST", f"{FR}/donors", {"partnerId": partner_id, "donorType": "FOUNDATION"})
            donor = track(DONOR, b_d)
            _, b_o = client.call("POST", f"{FR}/opportunities", {"reference": ref, "donorId": donor["id"], "title": "Quality scholarships",
                                                                  "purpose": "Scholarships", "kind": "GRANT", "proposedAmount": "100000.00",
                                                                  "currencyCode": "EGP"})
            opp = track(F_OPP, b_o)
            for stage in ("PROPOSAL", "SUBMITTED"):
                client.call("POST", f"{FR}/opportunities/{opp['id']}/stage", {"version": version(F_OPP, opp["id"]), "stage": stage})
            _, b_cm = client.call("POST", f"{FR}/opportunities/{opp['id']}/approve",
                                  {"version": version(F_OPP, opp["id"]), "committedAmount": "100000.00", "approvedOn": "2026-10-01",
                                   "periodEnd": "2027-09-30", "restricted": False, "agreementReference": f"AGR-{ref}"})
            com = track(COMMIT, b_cm)
            _, b_in = client.call("POST", f"{FR}/commitments/{com['id']}/installments",
                                  {"version": version(COMMIT, com["id"]), "dueDate": (date.today() + timedelta(days=30)).isoformat(),
                                   "amount": "100000"})
            inst = track(INST, b_in)
            assert inst.get("id"), f"pledge fixture {b_d} {b_o} {b_cm} {b_in}"
            return com, inst

        com_a, inst_a = pledge(fund_a, client_org["id"], f"ga-{tag}")
        com_b, inst_b = pledge(fund_b, other_donor["id"], f"gb-{tag}")
        outcomes, accepted = [], {"A": 0, "B": 0}
        for i in range(ROUNDS):
            ref = f"CIB-{tag}-{i:04d}"
            answers = at_once([lambda c=c, inst=inst: c.call("POST", f"{FR}/installments/{inst['id']}/collections",
                                                              {"version": version(INST, inst["id"]), "amount": "1000",
                                                               "receivedOn": "2026-10-16", "bankReference": ref})
                               for c, inst in ((fund_a, inst_a), (fund_b, inst_b))])
            for who, (s_, b_) in zip("AB", answers):
                track(COLL, b_)
                if s_ == 201:
                    accepted[who] += 1000
            outcomes.append((sorted((s_, error(b_).get("code")) for s_, b_ in answers),
                             len(search(COLL, f"self.bankReference = '{ref}'"))))
        _, ca = fund_a.call("GET", f"{FR}/commitments/{com_a['id']}")
        _, cb = fund_b.call("GET", f"{FR}/commitments/{com_b['id']}")
        check(f"S4 the same bank reference recorded on two commitments by two fundraisers at the same moment ({ROUNDS} rounds) → "
              "one 201 and one 409 DUPLICATE_COLLECTION, never a server error; one collection per reference",
              all(o == ([(201, None), (409, "DUPLICATE_COLLECTION")], 1) for o in outcomes), outcomes)
        check("S4 collected totals equal exactly the accepted collections; committed stays 100,000 (a pledge is not collected)",
              num(obj(ca).get("collected")) == accepted["A"] and num(obj(cb).get("collected")) == accepted["B"]
              and accepted["A"] + accepted["B"] == 1000 * ROUNDS and num(obj(ca).get("committed")) == 100000
              and num(obj(ca).get("outstanding")) == 100000 - accepted["A"], f"{accepted} {obj(ca)} {obj(cb)}")

        # --- cross-area: one client, three areas ------------------------------------------------------------
        _, x360 = admin.call("GET", f"{WS}/account360/{client_org['id']}")
        sec_x = {s["key"]: s["count"] for s in obj(x360).get("sections", [])}
        s_s, s360 = sales_c.call("GET", f"{WS}/account360/{client_org['id']}")
        check("cross-area: Account 360 (administrator) counts the client's 10 enrolments, 1 job order and 1 donor profile once each; "
              "donations never appear as invoiced or collected revenue; a salesperson sees none of these areas",
              (sec_x.get("TRAINING_ENROLLMENTS"), sec_x.get("JOB_ORDERS"), sec_x.get("DONOR_PROFILE")) == (RUSH, 1, 1)
              and all(not num(m.get("invoiced")) and not num(m.get("collected")) for m in obj(x360).get("money", []))
              and s_s == 200 and not ({"TRAINING_ENROLLMENTS", "JOB_ORDERS", "DONOR_PROFILE"} & {s["key"] for s in obj(s360).get("sections", [])}),
              f"{sec_x} {obj(x360).get('money')} {s_s} {obj(s360)}")

        failed = [r for r in RESULTS if r["result"] != "PASS"]
        print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
        exit_code = 0 if not failed else 1
    finally:
        cohort_ids = [r["id"] for r in search(COHORT, f"self.code like '%{tag}'")]
        order_ids = [r["id"] for r in search(ORDER, f"self.reference like '%{tag}'")]
        cand_ids = [r["id"] for r in search(CAND, f"self.displayName like '%{tag}'")]
        donor_ids = [r["id"] for r in search(DONOR, f"self.partner.name like '%{tag}'")]
        gather = []
        if cohort_ids:
            gather += [(ENROLLMENT, f"self.cohort.id in ({','.join(map(str, cohort_ids))})")]
        if order_ids:
            o = ",".join(map(str, order_ids))
            gather += [(FEE, f"self.placement.application.jobOrder.id in ({o})"), (PLACEMENT, f"self.application.jobOrder.id in ({o})"),
                       (INTERVIEW, f"self.application.jobOrder.id in ({o})"), (CONSENT, f"self.jobOrder.id in ({o})"),
                       (APP, f"self.jobOrder.id in ({o})")]
        if cand_ids:
            gather += [(PRIV, f"self.candidate.id in ({','.join(map(str, cand_ids))})")]
        if donor_ids:
            d = ",".join(map(str, donor_ids))
            gather += [(COLL, f"self.installment.commitment.opportunity.donor.id in ({d})"),
                       (INST, f"self.commitment.opportunity.donor.id in ({d})"), (COMMIT, f"self.opportunity.donor.id in ({d})"),
                       (F_OPP, f"self.donor.id in ({d})"), (DONOR, f"self.id in ({d})")]
        gather += [(COHORT, f"self.code like '%{tag}'"), (COURSE, f"self.code like '%{tag}'"), (ORDER, f"self.reference like '%{tag}'"),
                   (CAND, f"self.displayName like '%{tag}'")]
        for model, domain in gather:
            for row in search(model, domain):
                if (model, row["id"]) not in created:
                    created.append((model, row["id"]))
        complete, leftovers = cleanup(admin, created, {
            ENROLLMENT: 0, FEE: 0, COLL: 0, PLACEMENT: 1, INST: 1, INTERVIEW: 2, COMMIT: 2, CONSENT: 3, APP: 3, PRIV: 4, F_OPP: 3,
            COHORT: 4, DONOR: 4, ORDER: 5, CAND: 5, COURSE: 5, PARTNER: 6, USER: 7, GROUP: 8, PERM: 9})
        if not complete:
            print(f"FAIL cleanup left {leftovers}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "scenario-services.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
