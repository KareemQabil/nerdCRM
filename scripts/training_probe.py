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
  certificate and cohort cancellation → 422 BLOCKED_BY_POLICY (D-03)
  N concurrent enrolments on one cohort version → one 201 and one 409; never above capacity
Env: PROBE_TRAINING_ROUNDS (default 5). Report: logs/training-probe.json.
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
COURSE, COHORT = "com.ioeti.training.db.TrainingCourse", "com.ioeti.training.db.TrainingCohort"
ENROLLMENT, SESSION = "com.ioeti.training.db.TrainingEnrollment", "com.ioeti.training.db.CohortSession"
ATTENDANCE = "com.ioeti.training.db.TrainingAttendance"
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
                 perm("partner", PARTNER, canRead=True)]
        ro = [perm(f"ro.{m.split('.')[-1].lower()}", m, canRead=True)
              for m in (COURSE, COHORT, ENROLLMENT, SESSION, ATTENDANCE, PARTNER)]
        groups = {"coord": create(GROUP, {"code": f"wave4-coord-{tag}", "name": f"Wave4 coordinator {tag}",
                                          "permissions": [{"id": p["id"]} for p in coord]}),
                  "ro": create(GROUP, {"code": f"wave4-ro-{tag}", "name": f"Wave4 read-only {tag}",
                                       "permissions": [{"id": p["id"]} for p in ro]})}
        sessions, users = {}, {}
        for label, group in (("CoordA", "coord"), ("CoordA2", None), ("CoordB", "coord"), ("ReadOnly", "ro")):
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
        s_cert, b_cert = call(a, "POST", f"/enrollments/{e2['id']}/certificate")
        s_cancel, b_cancel = call(a, "POST", f"/cohorts/{k1['id']}/cancel")
        check("certificate and cohort cancellation → 422 BLOCKED_BY_POLICY (D-03)",
              s_cert == s_cancel == 422 and all(error(x).get("code") == "BLOCKED_BY_POLICY" and "D-03" in error(x).get("message", "")
                                                for x in (b_cert, b_cancel)), f"{s_cert} {s_cancel}")
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

        failed = [r for r in RESULTS if r["result"] != "PASS"]
        print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
        exit_code = 0 if not failed else 1
    finally:
        # anything created under this tag through the API, also by a failed run
        cohort_ids = [r["id"] for r in search(COHORT, f"self.code like '%{tag}'")]
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
        complete, leftovers = cleanup(admin, created, {ATTENDANCE: 0, SESSION: 1, ENROLLMENT: 1, COHORT: 2, COURSE: 3,
                                                       PARTNER: 4, USER: 5, GROUP: 6, PERM: 7})
        if not complete:
            print(f"FAIL cleanup left {leftovers}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "training-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
