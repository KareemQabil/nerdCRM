#!/usr/bin/env python3
"""Wave 4 live probe: external training (courses, cohorts, enrolment, waitlist, sessions, attendance).

Run against a RUNNING local/CI Axelor; never against production. Roles are TEST FIXTURES built from
native permissions (policy D-07 defines the real ones): CoordA and CoordB coordinate their own cohorts,
ReadOnly reads everything. Trainees are fictional partners.
Checks, through /ws/ioeti/training:
  course and cohort validation (code, capacity, dates, unknown course) refuse with field errors
  enrolment only while the cohort is open; confirmed up to capacity, then a waitlist 1..n
  duplicate trainee → 409; unknown trainee → 422; stale cohort version → 409
  cancelling a confirmed enrolment promotes the first waitlisted trainee; positions close up
  attendance: confirmed trainees of the session's cohort only, one row per trainee and session
  another coordinator's cohort → the same 404 as a missing id; read-only → 403
  N concurrent enrolments on one cohort version → one 201 and one 409; never above capacity
D-03 (signed 2026-10-25), with a policy owner the administrator appoints (disposable database: no owner may exist yet)
and a Finance fixture role (native invoice rights):
  fail closed: no certificate (POLICY_NOT_SET) and no national ID stored while the course's policies are not set
  national ID per course: REQUIRED refuses an enrolment without it, a bad number is refused, NOT_ASKED refuses one;
  stored apart, never returned (only identityProvided), unreadable even for the coordinator
  assessment: 0-100, read-only 403; eligibility names the reason; ineligible → 422 NOT_ELIGIBLE with the reason
  certificates: numbering missing → NUMBERING_NOT_SET; serial from the native sequence; twice → ALREADY_CERTIFIED;
  stale → 409; bulk issues only the eligible; another coordinator → 404; revoke needs a reason, then re-issue
  money: the coordinator cannot link invoices (403); finance links an issued invoice with the enrolment's share
  (share above the invoice refused, twice → 409); a paid enrolment is not cancelled without training.cancellation
  (POLICY_NOT_SET); with it, cancelling requests the refund computed from the steps and what was paid; finance is
  told in-app; approving needs native invoice rights (403), a matching credit note (422 otherwise), refuses a stale
  version (409) and a second decision (REFUND_STATE); an unpaid, unlinked enrolment → INVOICE_REQUIRED
  cohort cancellation: refused while certificates are issued; then every trainee is cancelled and paid ones get the
  refund for a cancellation by us; finance rejects it with a reason
The issued invoice, its payment and the credit note are SQL test fixtures in the disposable database (the D-06 credit
note service itself is covered by invoicing_probe.py); they are removed with SQL afterwards.
Env: PROBE_TRAINING_ROUNDS (default 5). Report: logs/training-probe.json.
"""
import json
import os
import secrets
import sys
import threading
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import RESERVED_SEQUENCE, _delete_where, cleanup  # noqa: E402
from db_migrate import DATABASE, psql  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PARTNER = "com.axelor.apps.base.db.Partner"
COURSE, COHORT = "com.ioeti.training.db.TrainingCourse", "com.ioeti.training.db.TrainingCohort"
ENROLLMENT, SESSION = "com.ioeti.training.db.TrainingEnrollment", "com.ioeti.training.db.CohortSession"
ATTENDANCE = "com.ioeti.training.db.TrainingAttendance"
CERT, NATID = "com.ioeti.training.db.TrainingCertificate", "com.ioeti.training.db.TrainingNationalId"
FEE, REFUND = "com.ioeti.training.db.TrainingFee", "com.ioeti.training.db.TrainingRefund"
INVOICE, ROLE = "com.axelor.apps.account.db.Invoice", "com.axelor.auth.db.Role"
SEQUENCE, SEQUENCE_VERSION = "com.axelor.apps.base.db.Sequence", "com.axelor.apps.base.db.SequenceVersion"
VERSION, AUDIT = "com.ioeti.core.db.PolicyVersion", "com.ioeti.admin.db.AdminAuditEvent"
NOTICE, LINE = "com.ioeti.automation.db.InboxNotice", "com.ioeti.businessline.db.BusinessLine"
P, OWNER_ROLE, CERT_SEQUENCE = "/ws/ioeti/policies", "ioeti-policy-owner", "ioetiTrainingCertificate"
BASE = "/ws/ioeti/training"
MISSING = 987654323
ROUNDS = int(os.environ.get("PROBE_TRAINING_ROUNDS", "5"))
RESULTS = []
ENROLLMENT_FIELDS = {"id", "version", "traineeId", "traineeName", "clientName", "status", "waitlistPosition"}


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
    created = []

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

    if search(USER, f"EXISTS (SELECT r FROM Role r WHERE r.name = '{OWNER_ROLE}' AND r MEMBER OF self.roles)"):
        raise SystemExit("this database already has policy owners; run the probe on a disposable database")
    role_before = search(ROLE, f"self.name = '{OWNER_ROLE}'")
    sequence_before = search(SEQUENCE, f"self.codeSelect = '{CERT_SEQUENCE}'")
    sql_invoices = []
    users = {}
    exit_code = 1
    try:
        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"wave4.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})

        coord = [perm("course", COURSE, canRead=True, canCreate=True),
                 perm("cohort", COHORT, "self.coordinator = ?", canRead=True, canWrite=True, canCreate=True),
                 perm("enrol", ENROLLMENT, "self.cohort.coordinator = ?", canRead=True, canWrite=True, canCreate=True),
                 perm("session", SESSION, "self.cohort.coordinator = ?", canRead=True, canWrite=True, canCreate=True),
                 perm("attend", ATTENDANCE, "self.session.cohort.coordinator = ?", canRead=True, canWrite=True,
                      canCreate=True),
                 perm("partner", PARTNER, canRead=True),
                 # D-03: certificates of their cohorts; national IDs can be written, never read; refunds read and requested
                 perm("cert", CERT, "self.enrollment.cohort.coordinator = ?", canRead=True, canWrite=True, canCreate=True),
                 perm("natid", NATID, canWrite=True, canCreate=True),
                 perm("refund", REFUND, "self.enrollment.cohort.coordinator = ?", canRead=True, canCreate=True)]
        ro = [perm(f"ro.{m.split('.')[-1].lower()}", m, canRead=True)
              for m in (COURSE, COHORT, ENROLLMENT, SESSION, ATTENDANCE, PARTNER, CERT, REFUND)]
        # finance (fixture): native invoice rights, links invoices and decides refunds; reads every cohort
        fin = [perm(f"fin.{m.split('.')[-1].lower()}", m, canRead=True) for m in (COURSE, COHORT, ENROLLMENT, PARTNER, CERT)] + [
            perm("fin.invoice", INVOICE, canRead=True, canWrite=True, canCreate=True),
            perm("fin.fee", FEE, canRead=True, canWrite=True, canCreate=True, canRemove=True),
            perm("fin.refund", REFUND, canRead=True, canWrite=True)]
        groups = {"coord": create(GROUP, {"code": f"wave4-coord-{tag}", "name": f"Wave4 coordinator {tag}",
                                          "permissions": [{"id": p["id"]} for p in coord]}),
                  "ro": create(GROUP, {"code": f"wave4-ro-{tag}", "name": f"Wave4 read-only {tag}",
                                       "permissions": [{"id": p["id"]} for p in ro]}),
                  "fin": create(GROUP, {"code": f"wave4-fin-{tag}", "name": f"Wave4 finance {tag}",
                                        "permissions": [{"id": p["id"]} for p in fin]})}
        sessions = {}
        for label, group in (("CoordA", "coord"), ("CoordA2", None), ("CoordB", "coord"), ("ReadOnly", "ro"),
                             ("Finance", "fin"), ("Owner", "ro")):
            if group is None:
                sessions[label] = Client()
                assert sessions[label].login(users["CoordA"]["code"], users["CoordA"]["_pw"]) == 200
                continue
            password = "W4!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"wave4.{label.lower()}.{tag}", "name": f"Wave4 {label}",
                                         "blocked": False, "language": "en", "group": {"id": groups[group]["id"]},
                                         "password": axelor_password_hash(password)})
            users[label]["_pw"] = password
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        a, a2, b, ro_c = (sessions[k] for k in ("CoordA", "CoordA2", "CoordB", "ReadOnly"))
        fin_c, owner = sessions["Finance"], sessions["Owner"]
        trainees = [create(PARTNER, {"firstName": "Trainee", "name": f"W4-{i} {tag}", "partnerTypeSelect": 2})
                    for i in range(1, 7)]
        sponsor = create(PARTNER, {"name": f"Wave4 Sponsor Co {tag}", "isCustomer": True, "partnerTypeSelect": 1})

        def call(client, method, path, body=None):
            return client.call(method, BASE + path, body if body is not None else ({} if method == "POST" else None))

        def version(model, rid):
            _, body = admin.call("POST", f"/ws/rest/{model}/{rid}/fetch", {"fields": ["version"]})
            return (body.get("data") or [{}])[0].get("version")

        def track(model, body):
            rid = (body.get("object") or {}).get("id") if isinstance(body, dict) else None
            if rid:
                created.append((model, rid))
            return body.get("object") or {}

        # --- 1. course and cohort validation ------------------------------------------------------------
        s, body = call(a, "POST", "/courses", {"code": f"c-{tag}", "name": "Internal auditor ISO 9001",
                                               "nameAr": "مراجع داخلي أيزو 9001", "durationHours": 16})
        course = track(COURSE, body)
        check("course created with a normalized code (201)", s == 201 and course.get("code") == f"C-{tag}", f"{s} {body}")
        bad = {}
        for label, cmd in (("duplicate code", {"code": f"C-{tag}", "name": "x"}), ("bad code", {"code": "a b", "name": "x"}),
                           ("no name", {"code": f"D-{tag}"}), ("hours", {"code": f"E-{tag}", "name": "x", "durationHours": 0})):
            s, body = call(a, "POST", "/courses", cmd)
            bad[label] = (s, field(body))
        check("course validation: duplicate/bad code, missing name, hours → 422 field errors",
              bad == {"duplicate code": (422, "code"), "bad code": (422, "code"), "no name": (422, "name"),
                      "hours": (422, "durationHours")}, bad)

        def cohort(client, code, capacity=2, **extra):
            return call(client, "POST", "/cohorts", {"courseId": course.get("id"), "code": code, "capacity": capacity,
                                                     "startDate": "2026-11-01", "endDate": "2026-11-05", **extra})

        bad = {}
        for label, (cap, extra) in {"capacity 0": (0, {}), "capacity 501": (501, {}),
                                    "min seats > capacity": (2, {"minSeats": 3}),
                                    "end before start": (2, {"endDate": "2026-10-01"}),
                                    "bad date": (2, {"startDate": "01/11/2026"}),
                                    "unknown course": (2, {"courseId": MISSING})}.items():
            s, body = cohort(a, f"X-{tag}", cap, **extra)
            bad[label] = (s, field(body))
        check("cohort validation → 422 with the right field, nothing created",
              all(s == 422 for s, _ in bad.values()) and [f for _, f in bad.values()] ==
              ["capacity", "capacity", "minSeats", "endDate", "startDate", "courseId"]
              and not search(COHORT, f"self.code = 'X-{tag}'"), bad)
        s, body = cohort(a, f"K1-{tag}", 2, location="Cairo")
        k1 = track(COHORT, body)
        check("cohort planned by its coordinator (201, PLANNED, 2 seats)",
              s == 201 and k1.get("status") == "PLANNED" and k1.get("coordinatedByMe") is True
              and k1.get("seatsLeft") == 2, f"{s} {body}")

        # --- 2. enrolment, capacity and waitlist ------------------------------------------------------
        def enroll(client, cohort_row, trainee_id, **extra):
            s, body = call(client, "POST", f"/cohorts/{cohort_row['id']}/enrollments",
                           {"version": version(COHORT, cohort_row["id"]), "traineeId": trainee_id, **extra})
            track(ENROLLMENT, body)
            return s, body

        s, body = enroll(a, k1, trainees[0]["id"])
        check("enrolment in a planned cohort → 422 COHORT_NOT_OPEN", s == 422 and error(body).get("code") == "COHORT_NOT_OPEN",
              f"{s} {body}")
        s_stale, _ = call(a, "POST", f"/cohorts/{k1['id']}/open", {"version": version(COHORT, k1["id"]) - 1})
        s, body = call(a, "POST", f"/cohorts/{k1['id']}/open", {"version": version(COHORT, k1["id"])})
        check("open: stale version → 409, then 200 OPEN", s_stale == 409 and s == 200
              and (body.get("object") or {}).get("status") == "OPEN", f"{s_stale} {s}")
        results = [enroll(a, k1, t["id"], **({"clientId": sponsor["id"]} if i == 0 else {})) for i, t in enumerate(trainees[:4])]
        rows = [(s, (body.get("object") or {}).get("status"), (body.get("object") or {}).get("waitlistPosition"))
                for s, body in results]
        check("capacity 2: two confirmed, then waitlist positions 1 and 2",
              rows == [(201, "CONFIRMED", None), (201, "CONFIRMED", None), (201, "WAITLISTED", 1), (201, "WAITLISTED", 2)], rows)
        e1, e2, e3, e4 = (body["object"] for _, body in results)
        check("enrolment view: safe fields only, sponsor name shown",
              set(e1) <= ENROLLMENT_FIELDS and e1.get("clientName") == f"Wave4 Sponsor Co {tag}", e1)
        s_dup, b_dup = enroll(a, k1, trainees[1]["id"])
        s_unk, b_unk = enroll(a, k1, MISSING)
        s_stale, _ = call(a, "POST", f"/cohorts/{k1['id']}/enrollments",
                          {"version": version(COHORT, k1["id"]) - 1, "traineeId": trainees[4]["id"]})
        check("duplicate trainee → 409 ALREADY_ENROLLED; unknown trainee → 422 traineeId; stale cohort → 409",
              s_dup == 409 and error(b_dup).get("code") == "ALREADY_ENROLLED" and s_unk == 422
              and field(b_unk) == "traineeId" and s_stale == 409, f"{s_dup} {s_unk} {s_stale}")
        s, body = call(a, "GET", f"/cohorts/{k1['id']}")
        v = body.get("object") or {}
        check("cohort counts: 2 confirmed, 2 waitlisted, 0 seats left",
              (v.get("confirmed"), v.get("waitlisted"), v.get("seatsLeft")) == (2, 2, 0), v)

        def statuses():
            _, body = call(a, "GET", f"/cohorts/{k1['id']}/enrollments")
            return {r["id"]: (r["status"], r["waitlistPosition"]) for r in body.get("object") or []}

        s, body = call(a, "POST", f"/enrollments/{e1['id']}/cancel", {"version": version(ENROLLMENT, e1["id"])})
        st = statuses()
        check("cancelling a confirmed seat promotes waitlist #1; #2 becomes #1",
              s == 200 and st.get(e1["id"]) == ("CANCELLED", None) and st.get(e3["id"]) == ("CONFIRMED", None)
              and st.get(e4["id"]) == ("WAITLISTED", 1), f"{s} {st}")
        s, body = call(a, "POST", f"/enrollments/{e1['id']}/cancel", {"version": version(ENROLLMENT, e1["id"])})
        check("cancel twice → 422 ALREADY_CANCELLED", s == 422 and error(body).get("code") == "ALREADY_CANCELLED", f"{s} {body}")
        s, body = call(a, "POST", f"/enrollments/{e4['id']}/cancel", {"version": version(ENROLLMENT, e4["id"])})
        st = statuses()
        check("cancelling a waitlisted enrolment promotes nobody",
              s == 200 and st.get(e4["id"]) == ("CANCELLED", None)
              and sum(1 for x in st.values() if x[0] == "CONFIRMED") == 2, st)

        # --- 3. sessions and attendance ---------------------------------------------------------------
        s_bad, b_bad = call(a, "POST", f"/cohorts/{k1['id']}/sessions",
                            {"version": version(COHORT, k1["id"]), "title": "Day 1", "startsAt": "tomorrow"})
        s, body = call(a, "POST", f"/cohorts/{k1['id']}/sessions",
                       {"version": version(COHORT, k1["id"]), "title": "Day 1", "startsAt": "2026-11-01T09:00",
                        "durationMinutes": 240})
        day1 = track(SESSION, body)
        check("session: bad time → 422 startsAt; scheduled (201)", s_bad == 422 and field(b_bad) == "startsAt"
              and s == 201 and day1.get("title") == "Day 1", f"{s_bad} {s}")

        def attend(client, enrollment_id, status, session_row=None):
            row = session_row or day1
            s, body = call(client, "POST", f"/sessions/{row['id']}/attendance",
                           {"version": version(SESSION, row["id"]), "enrollmentId": enrollment_id, "status": status})
            track(ATTENDANCE, body)
            return s, body

        s1, _ = attend(a, e2["id"], "PRESENT")
        s2, _ = attend(a, e2["id"], "ABSENT")
        _, body = call(a, "GET", f"/sessions/{day1['id']}/attendance")
        rows = body.get("object") or []
        check("attendance recorded then corrected: one row, latest status",
              s1 == s2 == 200 and [(r["enrollmentId"], r["status"]) for r in rows] == [(e2["id"], "ABSENT")], rows)
        bad = {}
        for label, (enrollment_id, status) in {"cancelled trainee": (e1["id"], "PRESENT"),
                                               "unknown enrolment": (MISSING, "PRESENT"),
                                               "bad status": (e2["id"], "LATE")}.items():
            s, body = attend(a, enrollment_id, status)
            bad[label] = (s, field(body))
        check("attendance refused: cancelled or unknown enrolment, bad status (422)",
              bad == {"cancelled trainee": (422, "enrollmentId"), "unknown enrolment": (422, "enrollmentId"),
                      "bad status": (422, "status")}, bad)

        # --- 4. scopes and policy ---------------------------------------------------------------------
        s_other, b_other = call(b, "GET", f"/cohorts/{k1['id']}")
        s_missing, b_missing = call(b, "GET", f"/cohorts/{MISSING}")
        s_enrol_b, _ = call(b, "POST", f"/cohorts/{k1['id']}/enrollments",
                            {"version": version(COHORT, k1["id"]), "traineeId": trainees[5]["id"]})
        s_att_b, _ = call(b, "GET", f"/sessions/{day1['id']}/attendance")
        check("another coordinator: cohort, enrolment and attendance answer like missing ids (404)",
              s_other == s_missing == s_enrol_b == s_att_b == 404
              and error(b_other).get("code") == error(b_missing).get("code"), f"{s_other} {s_missing} {s_enrol_b} {s_att_b}")
        _, listed = call(b, "GET", "/cohorts")
        check("another coordinator's cohort list does not include it",
              k1["id"] not in [c["id"] for c in listed.get("object") or []], listed)
        s_ro_get, _ = call(ro_c, "GET", f"/cohorts/{k1['id']}/enrollments")
        s_ro_post, _ = call(ro_c, "POST", f"/cohorts/{k1['id']}/close", {"version": version(COHORT, k1["id"])})
        check("read-only: reads (200), cannot change (403)", s_ro_get == 200 and s_ro_post == 403, f"{s_ro_get} {s_ro_post}")
        s_cert, b_cert = call(a, "POST", f"/enrollments/{e2['id']}/certificate", {"version": version(ENROLLMENT, e2["id"])})
        s_cancel, b_cancel = call(a, "POST", f"/cohorts/{k1['id']}/cancel", {})
        check("D-03 fail closed: no certificate without the course's criteria (422 POLICY_NOT_SET); cancelling needs a version (400)",
              s_cert == 422 and error(b_cert).get("code") == "POLICY_NOT_SET" and s_cancel == 400
              and not search(CERT, f"self.enrollment.id = {e2['id']}"), f"{s_cert} {b_cert} {s_cancel}")
        s, _ = call(a, "POST", f"/cohorts/{k1['id']}/close", {"version": version(COHORT, k1["id"])})
        s2, b2 = enroll(a, k1, trainees[5]["id"])
        check("closed cohort refuses enrolment (422 COHORT_NOT_OPEN)",
              s == 200 and s2 == 422 and error(b2).get("code") == "COHORT_NOT_OPEN", f"{s} {s2}")

        # --- 5. concurrency ---------------------------------------------------------------------------
        outcomes = []
        for i in range(ROUNDS):
            s, body = cohort(a, f"R{i}-{tag}", 1)
            row = track(COHORT, body)
            call(a, "POST", f"/cohorts/{row['id']}/open", {"version": version(COHORT, row["id"])})
            v0 = version(COHORT, row["id"])
            gate, answers = threading.Barrier(2), []

            def run(client, trainee_id):
                gate.wait()
                answers.append(client.call("POST", f"{BASE}/cohorts/{row['id']}/enrollments",
                                           {"version": v0, "traineeId": trainee_id}))

            threads = [threading.Thread(target=run, args=(c, t["id"])) for c, t in ((a, trainees[0]), (a2, trainees[1]))]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            for _, body in answers:
                track(ENROLLMENT, body)
            enrolled = search(ENROLLMENT, f"self.cohort.id = {row['id']}", ("statusSelect",))
            outcomes.append((sorted(s for s, _ in answers), len(enrolled),
                             sum(1 for e in enrolled if e.get("statusSelect") == 1)))
        check(f"concurrent enrolments on one version: one 201 and one 409, one seat taken ({ROUNDS} cohorts)",
              all(s == [201, 409] and n == 1 and confirmed == 1 for s, n, confirmed in outcomes), outcomes)

        # --- 6. D-03: national ID, assessment, certificates, refunds and cohort cancellation ----------------------
        today = date.today()
        s, _ = admin.call("POST", P + "/owners", {"userId": users["Owner"]["id"]})
        assert s == 200, f"appointing the policy owner: {s}"

        def set_policy(key, value, scope=None):
            s_, b_ = owner.call("POST", f"{P}/{key}", {"value": value, "reason": f"training probe {tag}", **({"scope": scope} if scope else {})})
            assert s_ == 201, f"setting {key}: {s_} {b_}"

        def obj(body):
            return body.get("object") if isinstance(body, dict) else None

        more = [create(PARTNER, {"firstName": "Trainee", "name": f"W4-D03-{i} {tag}", "partnerTypeSelect": 2}) for i in range(1, 5)]
        s, body = cohort(a, f"K2-{tag}", 5, startDate=str(today + timedelta(days=10)), endDate=str(today + timedelta(days=11)))
        k2 = track(COHORT, body)
        call(a, "POST", f"/cohorts/{k2['id']}/open", {"version": version(COHORT, k2["id"])})
        cid = str(course.get("id"))
        _, rules = call(a, "GET", f"/cohorts/{k2['id']}/rules")
        rules = obj(rules) or {}
        s_id, b_id = enroll(a, k2, more[0]["id"], clientId=sponsor["id"], nationalId="29001011234567")
        check("D-03 fail closed: rules unset; a national ID offered before the course's policy is refused (POLICY_NOT_SET), nothing stored",
              rules.get("criteriaSet") is False and rules.get("identityCollection") is None and s_id == 422
              and error(b_id).get("code") == "POLICY_NOT_SET" and not search(ENROLLMENT, f"self.cohort.id = {k2['id']}"), f"{rules} {s_id} {b_id}")

        set_policy("training.national-id", {"collect": "REQUIRED"}, cid)
        set_policy("training.certificate", {"minAttendancePercent": 50, "passMark": 60}, cid)
        bad = {}
        for label, extra in (("missing", {}), ("format", {"nationalId": "1234"})):
            s, body = enroll(a, k2, more[0]["id"], clientId=sponsor["id"], **extra)
            bad[label] = (s, field(body), ((error(body).get("fields") or [{}])[0]).get("code"))
        s1, b1 = enroll(a, k2, more[0]["id"], clientId=sponsor["id"], nationalId="29001011234567")
        s2, b2 = enroll(a, k2, more[1]["id"], clientId=sponsor["id"], nationalId="٣٠١٠١٠١١٢٣٤٥٦٨")
        d1, d2 = obj(b1) or {}, obj(b2) or {}
        stored = search(NATID, f"self.enrollment.id in ({d1.get('id', 0)},{d2.get('id', 0)})", ("idNumber",))
        check("national ID REQUIRED: missing and malformed refused (422 nationalId), valid ones stored apart (ASCII digits) and never returned",
              bad == {"missing": (422, "nationalId", "REQUIRED"), "format": (422, "nationalId", "FORMAT")} and s1 == s2 == 201
              and d1.get("identityProvided") is True and "29001011234567" not in json.dumps(b1) and "nationalId" not in json.dumps(b1)
              and sorted(r.get("idNumber") for r in stored) == ["29001011234567", "30101011234568"], f"{bad} {s1} {s2} {stored}")
        _, coord_read = a.call("POST", f"/ws/rest/{NATID}/search", {"fields": ["idNumber"], "data": {"_domain": "self.id > 0"}})
        _, ro_read = ro_c.call("POST", f"/ws/rest/{NATID}/search", {"fields": ["idNumber"], "data": {"_domain": "self.id > 0"}})
        _, listed = call(a, "GET", f"/cohorts/{k2['id']}/enrollments")
        check("national IDs are unreadable for the coordinator and read-only users; lists only say identityProvided",
              not ok(coord_read) and not ok(ro_read) and "29001011234567" not in json.dumps(listed)
              and all(r.get("identityProvided") is True for r in obj(listed) or []), f"{coord_read} {ro_read}")

        # two sessions: trainee 1 attends both, trainee 2 neither
        days = []
        for n in (1, 2):
            s, body = call(a, "POST", f"/cohorts/{k2['id']}/sessions", {"version": version(COHORT, k2["id"]), "title": f"D{n}",
                                                                         "startsAt": f"{today + timedelta(days=9 + n)}T09:00", "durationMinutes": 120})
            days.append(track(SESSION, body))
        for row in days:
            attend(a, d1["id"], "PRESENT", row)
            attend(a, d2["id"], "ABSENT", row)

        def standing():
            _, body = call(a, "GET", f"/cohorts/{k2['id']}/eligibility")
            return {r["enrollmentId"]: r for r in (obj(body) or {}).get("rows", [])}

        st = standing()
        check("eligibility: attendance from recorded sessions, the reason named (SCORE_MISSING, ATTENDANCE_BELOW)",
              (st.get(d1["id"], {}).get("attendancePercent"), st.get(d1["id"], {}).get("reason")) == (100, "SCORE_MISSING")
              and (st.get(d2["id"], {}).get("attendancePercent"), st.get(d2["id"], {}).get("reason")) == (0, "ATTENDANCE_BELOW"), st)

        def assess(client, enrollment_id, score, v=None):
            return call(client, "POST", f"/enrollments/{enrollment_id}/assessment",
                        {"version": v if v is not None else version(ENROLLMENT, enrollment_id), "score": score})

        s_range, b_range = assess(a, d1["id"], 101)
        s_ro, _ = assess(ro_c, d1["id"], 80)
        s_low, _ = assess(a, d1["id"], 55)
        low = standing().get(d1["id"], {}).get("reason")
        s_ok, _ = assess(a, d1["id"], 75)
        st = standing()
        check("assessment: 0-100 (422 score), read-only 403; below the pass mark → SCORE_BELOW; at or above → eligible",
              (s_range, field(b_range), s_ro, s_low, low, s_ok) == (422, "score", 403, 200, "SCORE_BELOW", 200)
              and st.get(d1["id"], {}).get("eligible") is True, f"{s_range} {s_ro} {s_low} {low} {s_ok}")

        def issue(client, enrollment_id, v=None):
            s_, b_ = call(client, "POST", f"/enrollments/{enrollment_id}/certificate",
                          {"version": v if v is not None else version(ENROLLMENT, enrollment_id)})
            track(CERT, b_)
            return s_, b_

        if not sequence_before:
            s_num, b_num = issue(a, d1["id"])
            check("no certificate numbering → 422 NUMBERING_NOT_SET", s_num == 422 and error(b_num).get("code") == "NUMBERING_NOT_SET", f"{s_num} {b_num}")
            create(SEQUENCE, {"name": f"TEST ONLY training certificates {tag}", "codeSelect": CERT_SEQUENCE, "prefixe": f"TC{tag}-",
                              "padding": 4, "toBeAdded": 1, "sequenceVersionList": [{"startDate": f"{today.year}-01-01", "nextNum": 1}]})
        s_no, b_no = issue(a, d2["id"])
        check("ineligible → 422 NOT_ELIGIBLE with the reason, no certificate",
              s_no == 422 and error(b_no).get("code") == "NOT_ELIGIBLE"
              and ((error(b_no).get("fields") or [{}])[0]).get("code") == "ATTENDANCE_BELOW"
              and not search(CERT, f"self.enrollment.id = {d2['id']}"), f"{s_no} {b_no}")
        s_stale, _ = issue(a, d1["id"], version(ENROLLMENT, d1["id"]) - 1)
        s_c1, b_c1 = issue(a, d1["id"])
        cert1 = obj(b_c1) or {}
        s_twice, b_twice = issue(a, d1["id"])
        check("certificate issued with a serial from the native numbering; stale → 409; twice → ALREADY_CERTIFIED",
              s_stale == 409 and s_c1 == 201 and bool(cert1.get("serial")) and (sequence_before or cert1["serial"].startswith(f"TC{tag}-"))
              and cert1.get("traineeName") and cert1.get("status") == "ISSUED" and s_twice == 422
              and error(b_twice).get("code") == "ALREADY_CERTIFIED", f"{s_stale} {s_c1} {cert1} {s_twice}")
        s_bulk, b_bulk = call(a, "POST", f"/cohorts/{k2['id']}/certificates", {"version": version(COHORT, k2["id"])})
        bulk = obj(b_bulk) or {}
        s_b404, _ = call(b, "GET", f"/certificates/{cert1.get('id')}")
        check("bulk issue: nobody new is eligible (issued 0, trainee 2 skipped with the reason); another coordinator → 404",
              s_bulk == 200 and bulk.get("issued") == [] and [(x["enrollmentId"], x["reason"]) for x in bulk.get("skipped", [])]
              == [(d2["id"], "ATTENDANCE_BELOW")] and s_b404 == 404, f"{s_bulk} {bulk} {s_b404}")
        s_nr, b_nr = call(a, "POST", f"/certificates/{cert1['id']}/revoke", {"version": version(CERT, cert1["id"]), "reason": " "})
        s_rv, b_rv = call(a, "POST", f"/certificates/{cert1['id']}/revoke", {"version": version(CERT, cert1["id"]), "reason": "Probe: issued in error"})
        s_c2, b_c2 = issue(a, d1["id"])
        cert2 = obj(b_c2) or {}
        check("revoke needs a reason (422), keeps it out of the response; a new certificate gets a new serial",
              s_nr == 422 and field(b_nr) == "reason" and s_rv == 200 and (obj(b_rv) or {}).get("status") == "REVOKED"
              and "issued in error" not in json.dumps(b_rv) and s_c2 == 201 and cert2.get("serial") not in (None, cert1.get("serial")),
              f"{s_nr} {s_rv} {s_c2} {cert2}")

        # money: an issued customer invoice of the sponsor (11 400 incl. tax, fully paid), as a SQL fixture
        company = psql(DATABASE, "SELECT id FROM base_company ORDER BY id LIMIT 1;").strip()
        egp = psql(DATABASE, "SELECT id FROM base_currency WHERE codeiso = 'EGP' LIMIT 1;").strip()
        inv = int(psql(DATABASE, f"""INSERT INTO account_invoice (id, version, archived, company, currency, partner, operation_type_select,
            operation_sub_type_select, status_select, ex_tax_total, in_tax_total, amount_paid, amount_remaining, invoice_id, invoice_date)
            VALUES (nextval('account_invoice_seq'), 0, false, {company}, {egp}, {sponsor['id']}, 3, 1, 3, 10000, 11400, 11400, 0,
            'TRPROBE-{tag}', CURRENT_DATE) RETURNING id;""").split()[0])
        sql_invoices.append(inv)
        psql(DATABASE, f"""INSERT INTO account_invoice_payment (id, version, amount, currency, payment_date, invoice, status_select, type_select)
            VALUES (nextval('account_invoice_payment_seq'), 0, 11400, {egp}, CURRENT_DATE, {inv}, 1, 2);""")
        s_coord, _ = call(a, "POST", f"/enrollments/{d2['id']}/fee", {"invoiceId": inv, "amount": 5700})
        _, choices = call(fin_c, "GET", f"/enrollments/{d2['id']}/invoices")
        s_big, b_big = call(fin_c, "POST", f"/enrollments/{d2['id']}/fee", {"invoiceId": inv, "amount": 11400.01})
        s_l2, b_l2 = call(fin_c, "POST", f"/enrollments/{d2['id']}/fee", {"invoiceId": inv, "amount": 5700})
        s_dup, _ = call(fin_c, "POST", f"/enrollments/{d2['id']}/fee", {"invoiceId": inv, "amount": 1})
        s_l1, _ = call(fin_c, "POST", f"/enrollments/{d1['id']}/fee", {"invoiceId": inv})
        fees = search(FEE, f"self.invoice.id = {inv}", ("amount",))
        check("invoice link: the coordinator cannot (403); finance sees the invoice, links shares (above the invoice refused, twice 409)",
              s_coord == 403 and inv in [c["id"] for c in obj(choices) or []] and s_big == 422 and field(b_big) == "amount"
              and s_l2 == 201 and (obj(b_l2) or {}).get("paid") == 5700 and s_dup == 409 and s_l1 == 201
              and sorted(float(f["amount"]) for f in fees) == [5700.0, 5700.0], f"{s_coord} {s_big} {s_l2} {b_l2} {s_dup} {s_l1} {fees}")

        has_cancellation = search(VERSION, "self.policyKey = 'training.cancellation'")
        line = search(LINE, "self.code = 'TRAINING'", ("code",))
        line_scope = "TRAINING" if line else None
        if not has_cancellation:
            _, prev = call(a, "GET", f"/enrollments/{d2['id']}/cancellation")
            s_pc, b_pc = call(a, "POST", f"/enrollments/{d2['id']}/cancel", {"version": version(ENROLLMENT, d2["id"])})
            check("a paid enrolment is not cancelled without training.cancellation (preview and 422 POLICY_NOT_SET)",
                  (obj(prev) or {}).get("outcome") == "POLICY_NOT_SET" and s_pc == 422 and error(b_pc).get("code") == "POLICY_NOT_SET"
                  and search(ENROLLMENT, f"self.id = {d2['id']} AND self.statusSelect = 1"), f"{prev} {s_pc}")
        set_policy("training.cancellation", {"steps": [{"daysBeforeStart": 14, "refundPercent": 100}, {"daysBeforeStart": 7, "refundPercent": 50},
                                                       {"daysBeforeStart": 0, "refundPercent": 0}], "cohortCancelledRefundPercent": 100}, line_scope)
        _, prev = call(a, "GET", f"/enrollments/{d2['id']}/cancellation")
        prev = obj(prev) or {}
        s_cx, _ = call(a, "POST", f"/enrollments/{d2['id']}/cancel", {"version": version(ENROLLMENT, d2["id"])})
        rf = search(REFUND, f"self.enrollment.id = {d2['id']}", ("amount", "paidAmount", "refundPercent", "creditPercent", "statusSelect", "daysBeforeStart"))
        check("cancelling 10 days before the start: preview then refund requested = 50% of the 5 700 paid (2 850), 25% of the invoice",
              (prev.get("outcome"), prev.get("daysBeforeStart"), prev.get("refundPercent"), prev.get("refundAmount")) == ("REFUND", 10, 50, 2850)
              and s_cx == 200 and len(rf) == 1 and float(rf[0]["amount"]) == 2850 and float(rf[0]["paidAmount"]) == 5700
              and float(rf[0]["creditPercent"]) == 25 and rf[0]["statusSelect"] == 1 and rf[0]["daysBeforeStart"] == 10, f"{prev} {s_cx} {rf}")
        refund1 = rf[0] if rf else {"id": 0}
        _, notices = fin_c.call("GET", "/ws/ioeti/automation/inbox")
        _, queue = call(fin_c, "GET", "/refunds")
        check("finance is told in-app and sees the request in its queue (canDecide)",
              any(n.get("kind") == "TRAINING_REFUND_REQUESTED" and n.get("subjectId") == refund1["id"] for n in obj(notices) or [])
              and any(r["id"] == refund1["id"] and r.get("canDecide") for r in obj(queue) or []), f"{notices} {queue}")

        # the credit note finance issues through D-06 (SQL fixture): 25% of the invoice, 2 850 including tax
        credit = int(psql(DATABASE, f"""INSERT INTO account_invoice (id, version, archived, company, currency, partner, operation_type_select,
            operation_sub_type_select, status_select, ex_tax_total, in_tax_total, original_invoice, invoice_id, invoice_date)
            VALUES (nextval('account_invoice_seq'), 0, false, {company}, {egp}, {sponsor['id']}, 4, 1, 3, 2500, 2850, {inv},
            'TRPROBE-CN-{tag}', CURRENT_DATE) RETURNING id;""").split()[0])
        sql_invoices.insert(0, credit)

        def decide(client, action, rid, **extra):
            return call(client, "POST", f"/refunds/{rid}/{action}", {"version": version(REFUND, rid), **extra})

        s_ca, _ = decide(a, "approve", refund1["id"], creditInvoiceId=credit)
        s_mm, b_mm = decide(fin_c, "approve", refund1["id"], creditInvoiceId=inv)
        s_st, _ = call(fin_c, "POST", f"/refunds/{refund1['id']}/approve", {"version": version(REFUND, refund1["id"]) - 1, "creditInvoiceId": credit})
        s_ap, b_ap = decide(fin_c, "approve", refund1["id"], creditInvoiceId=credit)
        s_ag, b_ag = decide(fin_c, "approve", refund1["id"], creditInvoiceId=credit)
        done = obj(b_ap) or {}
        check("approve: the coordinator cannot (403); a non-matching credit note → 422; stale → 409; then CREDITED with the credit note;"
              " deciding again → REFUND_STATE",
              s_ca == 403 and s_mm == 422 and field(b_mm) == "creditInvoiceId" and s_st == 409 and s_ap == 200
              and (done.get("status"), done.get("creditId"), done.get("creditedAmount")) == ("CREDITED", credit, 2850)
              and s_ag == 422 and error(b_ag).get("code") == "REFUND_STATE", f"{s_ca} {s_mm} {s_st} {s_ap} {done} {s_ag}")

        # an unlinked enrolment cancelled: no refund; asking for one → INVOICE_REQUIRED; NOT_ASKED refuses a national ID
        s3, b3 = enroll(a, k2, more[2]["id"], nationalId="29001011234575")
        d3 = obj(b3) or {"id": 0}
        call(a, "POST", f"/enrollments/{d3['id']}/cancel", {"version": version(ENROLLMENT, d3["id"])})
        s_rq, b_rq = call(a, "POST", f"/enrollments/{d3['id']}/refund", {"version": version(ENROLLMENT, d3["id"])})
        set_policy("training.national-id", {"collect": "NOT_ASKED"}, cid)
        s_na, b_na = enroll(a, k2, more[3]["id"], nationalId="29001011234583")
        check("unlinked enrolment: cancelled without a refund, requesting one → INVOICE_REQUIRED; NOT_ASKED refuses a national ID",
              s3 == 201 and s_rq == 422 and error(b_rq).get("code") == "INVOICE_REQUIRED"
              and not search(REFUND, f"self.enrollment.id = {d3['id']}") and s_na == 422 and field(b_na) == "nationalId",
              f"{s3} {s_rq} {b_rq} {s_na} {b_na}")

        # cohort cancellation: refused while a certificate is issued; then every trainee cancelled, the paid one refunded 100%
        s_ci, b_ci = call(a, "POST", f"/cohorts/{k2['id']}/cancel", {"version": version(COHORT, k2["id"])})
        call(a, "POST", f"/certificates/{cert2['id']}/revoke", {"version": version(CERT, cert2["id"]), "reason": "Probe: cohort cancelled"})
        _, cprev = call(a, "GET", f"/cohorts/{k2['id']}/cancellation")
        cprev = obj(cprev) or {}
        s_cs, _ = call(a, "POST", f"/cohorts/{k2['id']}/cancel", {"version": version(COHORT, k2["id"]) - 1})
        s_cc, b_cc = call(a, "POST", f"/cohorts/{k2['id']}/cancel", {"version": version(COHORT, k2["id"])})
        rf2 = search(REFUND, f"self.enrollment.id = {d1['id']}", ("amount", "causeSelect", "refundPercent"))
        active = search(ENROLLMENT, f"self.cohort.id = {k2['id']} AND self.statusSelect <> 3")
        check("cohort cancel: CERTIFICATES_ISSUED first; preview 1 refund of 5 700; stale 409; then CANCELLED, nobody active,"
              " the paid trainee refunded 100% for a cancellation by us",
              s_ci == 422 and error(b_ci).get("code") == "CERTIFICATES_ISSUED" and (cprev.get("refunds"), cprev.get("refundTotal")) == (1, 5700)
              and s_cs == 409 and s_cc == 200 and (obj(b_cc) or {}).get("status") == "CANCELLED" and not active
              and len(rf2) == 1 and float(rf2[0]["amount"]) == 5700 and rf2[0]["causeSelect"] == 2, f"{s_ci} {cprev} {s_cs} {s_cc} {rf2} {active}")
        refund2 = rf2[0] if rf2 else {"id": 0}
        s_rn, b_rn = decide(fin_c, "reject", refund2["id"], reason="")
        s_rj, b_rj = decide(fin_c, "reject", refund2["id"], reason="Probe: paid by the sponsor's credit instead")
        check("finance rejects with a reason (none → 422); nothing is credited",
              s_rn == 422 and field(b_rn) == "reason" and s_rj == 200 and (obj(b_rj) or {}).get("status") == "REJECTED"
              and (obj(b_rj) or {}).get("creditId") is None, f"{s_rn} {s_rj} {b_rj}")

        failed = [r for r in RESULTS if r["result"] != "PASS"]
        print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
        exit_code = 0 if not failed else 1
    finally:
        # anything created under this tag through the API, also by a failed run
        cohort_ids = [r["id"] for r in search(COHORT, f"self.code like '%{tag}'")]
        # D-03 records first (they point at enrolments and at the SQL invoices), then the SQL invoice fixtures
        if cohort_ids:
            joined = ",".join(map(str, cohort_ids))
            refund_ids = [r["id"] for r in search(REFUND, f"self.enrollment.cohort.id in ({joined})")]
            if refund_ids:
                _delete_where(admin, NOTICE, f"self.subject = 'TRAINING_REFUND' AND self.subjectId in ({','.join(map(str, refund_ids))})")
            for model in (REFUND, FEE, CERT, NATID):
                _delete_where(admin, model, f"self.enrollment.cohort.id in ({joined})")
        for inv_id in sql_invoices:
            psql(DATABASE, f"DELETE FROM account_invoice_payment WHERE invoice = {int(inv_id)}; DELETE FROM account_invoice WHERE id = {int(inv_id)};")
        if not sequence_before:
            for seq in search(SEQUENCE, f"self.codeSelect = '{CERT_SEQUENCE}'"):
                _delete_where(admin, RESERVED_SEQUENCE, f"self.sequence.id = {seq['id']}")
                created.extend((SEQUENCE_VERSION, r["id"]) for r in search(SEQUENCE_VERSION, f"self.sequence.id = {seq['id']}"))
                if (SEQUENCE, seq["id"]) not in created:
                    created.append((SEQUENCE, seq["id"]))
        user_ids = [u["id"] for u in users.values()]
        if user_ids:
            joined = ",".join(map(str, user_ids))
            created.extend((VERSION, v["id"]) for v in search(VERSION, f"self.author.id in ({joined})"))
            created.extend((AUDIT, x["id"]) for x in search(AUDIT, f"self.actor.id in ({joined}) OR (self.subject = 'USER' AND self.subjectId in ({joined}))"))
            created.extend((NOTICE, n["id"]) for n in search(NOTICE, f"self.recipient.id in ({joined}) OR self.actor.id in ({joined})"))
            # the policy owner's role goes before the user can be removed
            owner_row = users.get("Owner")
            if owner_row:
                current = search(USER, f"self.id = {owner_row['id']}", ("version",))
                if current:
                    admin.call("POST", f"/ws/rest/{USER}/{owner_row['id']}", {"data": {"id": owner_row["id"], "version": current[0].get("version"),
                                                                                    "roles": [], "blocked": True}})
        if not role_before:
            created.extend((ROLE, r["id"]) for r in search(ROLE, f"self.name = '{OWNER_ROLE}'") if (ROLE, r["id"]) not in created)
        for model, domain in ((ATTENDANCE, "self.session.cohort.id in ({})"), (SESSION, "self.cohort.id in ({})"),
                              (ENROLLMENT, "self.cohort.id in ({})")):
            if cohort_ids:
                for row in search(model, domain.format(",".join(map(str, cohort_ids)))):
                    if (model, row["id"]) not in created:
                        created.append((model, row["id"]))
        for model in (COHORT, COURSE):
            for row in search(model, f"self.code like '%{tag}'"):
                if (model, row["id"]) not in created:
                    created.append((model, row["id"]))
        complete, leftovers = cleanup(admin, list(dict.fromkeys(created)), {
            REFUND: 0, FEE: 0, CERT: 0, NATID: 0, NOTICE: 0, VERSION: 0, AUDIT: 0, ATTENDANCE: 0, SESSION: 1, ENROLLMENT: 1, COHORT: 2,
            COURSE: 3, SEQUENCE_VERSION: 3, SEQUENCE: 4, PARTNER: 4, USER: 5, ROLE: 6, GROUP: 6, PERM: 7})
        if not complete:
            print(f"FAIL cleanup left {leftovers}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "training-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
