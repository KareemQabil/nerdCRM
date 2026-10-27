#!/usr/bin/env python3
"""Field visits and visit numbering: live probe against a RUNNING local/CI Axelor; never against
production. Roles are TEST FIXTURES from native permissions: two field people who may plan and run visits,
and a viewer who only reads them. Every record is removed afterwards, and the visit numbering this probe
sets up is removed again if it did not exist before.
Checks:
  numbering: administrators only; without it a visit cannot be saved (422 NUMBERING_REQUIRED, when the
  database has none); a bad prefix → 422; once set, visits are numbered with it; the change log has it
  access: anonymous 401; a viewer reads visits but cannot plan, list assignees or write notes (403)
  planning: purpose required, a contact person is not a client account (404), no planning in the past,
  end after start, plan and reschedule with the version (stale → 409)
  on site: start → pause → resume → finish with the native rules; impossible moves → 422; cancelling a
  planned visit clears its time and assignee
  log: notes are appended (the visit version moves) and read back; empty → 422
  agenda and "mine": a planned visit is in its field person's agenda and list only
Report: logs/visit-probe.json.
"""
import json
import os
import secrets
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PARTNER, VISIT, NOTE = "com.axelor.apps.base.db.Partner", "com.axelor.apps.intervention.db.Intervention", "com.ioeti.operations.db.VisitNote"
SEQUENCE, SEQUENCE_VERSION = "com.axelor.apps.base.db.Sequence", "com.axelor.apps.base.db.SequenceVersion"
RESERVED = "com.axelor.apps.base.db.ReservedSequence"
V, N = "/ws/ioeti/visits", "/ws/ioeti/admin/numbering"
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:240]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def obj(body):
    return (body.get("object") if isinstance(body, dict) else None) or {}


def rows(body):
    value = body.get("object") if isinstance(body, dict) else None
    return value if isinstance(value, list) else []


def err(body):
    e = (body.get("error") or {}) if isinstance(body, dict) else {}
    return e.get("code"), ((e.get("fields") or [{}])[0]).get("code")


def at(days, hour):
    d = datetime.now() + timedelta(days=days)
    return d.replace(hour=hour, minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M")


def main():
    admin = Client()
    assert admin.login(os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin")),
                       os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
    tag = secrets.token_hex(3).upper()
    created, sequence_created = [], None
    before = next((r for r in rows(admin.call("GET", N)[1]) if r["code"] == "intervention"), {})

    def create(model, values):
        _, body = rest_create(admin, model, values)
        if not ok(body):
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}: {json.dumps(body)[:200]}")
        created.append((model, body["data"][0]["id"]))
        return body["data"][0]

    exit_code = 1
    try:
        account = create(PARTNER, {"name": f"مصنع الزيارات {tag}", "partnerTypeSelect": 1, "isProspect": True})
        contact = create(PARTNER, {"name": f"شخص الزيارات {tag}", "partnerTypeSelect": 2, "isContact": True})
        rwc = dict(canRead=True, canWrite=True, canCreate=True)

        def perm(name, model, **rights):
            return create(PERM, {"name": f"visit.{name}.{tag}", "object": model, **rights})
        field = [perm("v", VISIT, **rwc), perm("p", PARTNER, canRead=True)]
        viewer = [perm("vv", VISIT, canRead=True), perm("vp", PARTNER, canRead=True)]
        groups = {"f": create(GROUP, {"code": f"visit-f-{tag}", "name": f"Visit field {tag}", "permissions": [{"id": p["id"]} for p in field]}),
                  "v": create(GROUP, {"code": f"visit-v-{tag}", "name": f"Visit viewer {tag}", "permissions": [{"id": p["id"]} for p in viewer]})}
        sessions, users = {}, {}
        for label, group in (("A", "f"), ("B", "f"), ("V", "v")):
            password = "Vs!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"visit.{label.lower()}.{tag}", "name": f"Visit {label} {tag}", "blocked": False, "language": "ar",
                                         "group": {"id": groups[group]["id"]}, "password": axelor_password_hash(password)})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        a, b, v, anon = sessions["A"], sessions["B"], sessions["V"], Client()

        # --- numbering -------------------------------------------------------------------------------
        if not before.get("configured"):
            s, body = a.call("POST", V, {"accountId": account["id"], "purpose": "زيارة تقييم"})
            check("without visit numbering a visit cannot be saved (422 NUMBERING_REQUIRED)", (s, err(body)[0]) == (422, "NUMBERING_REQUIRED"), (s, err(body)))
        s1, _ = a.call("GET", N)
        s2, b2 = admin.call("POST", N + "/intervention", {"prefix": "a b", "digits": 4})
        s3, _ = a.call("POST", N + "/intervention", {"prefix": "VIS-", "digits": 4})
        check("numbering is for administrators (403 otherwise) and a bad prefix → 422", (s1, s2, err(b2)[1], s3) == (403, 422, "FORMAT", 403), (s1, s2, err(b2), s3))
        if before.get("configured"):
            check("visit numbering was already set up on this database (kept as it was)", True)
        else:
            s, body = admin.call("POST", N + "/intervention", {"prefix": f"V{tag[:3]}-", "digits": 4})
            row = obj(body)
            sequence_created = True
            check("an administrator sets up visit numbering; it shows how the next number looks",
                  s == 200 and row.get("configured") is True and row.get("example") == f"V{tag[:3]}-0001", (s, row))

        # --- planning --------------------------------------------------------------------------------
        s, body = a.call("POST", V, {"accountId": account["id"], "purpose": "زيارة تقييم أولى للمصنع", "assignedToId": users["A"]["id"], "start": at(1, 10)})
        v1 = obj(body)
        if v1.get("id"):
            created.append((VISIT, v1["id"]))
        expected_ref = before.get("prefix") or f"V{tag[:3]}-"
        check("a field person plans a visit for tomorrow: PLANNED, numbered, assigned to them",
              s == 201 and v1.get("status") == "PLANNED" and (v1.get("reference") or "").startswith(expected_ref) and v1.get("mine") is True
              and v1.get("accountName") == f"مصنع الزيارات {tag}", (s, v1))
        s, body = a.call("POST", V, {"accountId": account["id"], "purpose": "متابعة"})
        v2 = obj(body)
        if v2.get("id"):
            created.append((VISIT, v2["id"]))
        check("a visit without a time waits as TO_PLAN", s == 201 and v2.get("status") == "TO_PLAN", (s, v2))
        answers = [
            a.call("POST", V, {"accountId": account["id"], "purpose": " "}),
            a.call("POST", V, {"accountId": contact["id"], "purpose": "x"}),
            a.call("POST", V, {"accountId": account["id"], "purpose": "x", "assignedToId": users["A"]["id"], "start": at(-1, 10)}),
            a.call("POST", V, {"accountId": account["id"], "purpose": "x", "assignedToId": users["A"]["id"], "start": at(1, 10), "end": at(1, 9)}),
        ]
        codes = [(s_, err(b_)[1] or err(b_)[0]) for s_, b_ in answers]
        check("planning is validated: purpose required, a contact person is not a client (404), not in the past, end after start",
              codes == [(422, "REQUIRED"), (404, "NOT_FOUND"), (422, "PAST"), (422, "BEFORE_START")], codes)
        s1, _ = anon.call("GET", V)
        s2, b2 = v.call("GET", V)
        s3, _ = v.call("POST", V, {"accountId": account["id"], "purpose": "x"})
        s4, _ = v.call("GET", V + "/people")
        s5, b5 = a.call("GET", V + "/people")
        check("anonymous 401; a viewer reads visits but cannot plan or list who to assign (403); a field person can",
              (s1, s2, s3, s4, s5) == (401, 200, 403, 403, 200) and any(r["id"] == v1.get("id") for r in rows(b2))
              and any(r["id"] == users["B"]["id"] for r in rows(b5)), (s1, s2, s3, s4, s5))
        s, body = a.call("POST", f"{V}/{v2.get('id')}/plan", {"version": v2.get("version"), "assignedToId": users["B"]["id"], "start": at(2, 11)})
        v2p = obj(body)
        s_stale, _ = a.call("POST", f"{V}/{v2.get('id')}/plan", {"version": v2.get("version"), "assignedToId": users["A"]["id"], "start": at(2, 12)})
        check("the TO_PLAN visit is planned for a colleague with its version; a stale version → 409",
              s == 200 and v2p.get("status") == "PLANNED" and v2p.get("assigneeName") == f"Visit B {tag}" and s_stale == 409, (s, v2p, s_stale))

        # --- on site ---------------------------------------------------------------------------------
        cur, path = v1, []
        for command in ("start", "suspend", "start", "finish"):
            s, body = a.call("POST", f"{V}/{v1.get('id')}/{command}", {"version": cur.get("version")})
            if s == 200:
                cur = obj(body)
            path.append((command, s, cur.get("status")))
        s, body = a.call("POST", f"{V}/{v1.get('id')}/finish", {"version": cur.get("version")})
        s2, body2 = a.call("POST", f"{V}/{v1.get('id')}/cancel", {"version": cur.get("version")})
        check("on site: start → pause → resume → finish (native rules), then finishing again or cancelling → 422",
              [p[2] for p in path] == ["STARTED", "SUSPENDED", "STARTED", "FINISHED"] and cur.get("startedAt") and cur.get("finishedAt")
              and (s, err(body)[0], s2, err(body2)[0]) == (422, "STATUS_NOT_ALLOWED", 422, "STATUS_NOT_ALLOWED"), (path, s, s2))

        # --- the visit log ---------------------------------------------------------------------------
        s, body = a.call("POST", f"{V}/{v1.get('id')}/notes", {"version": cur.get("version"), "text": "خط الإنتاج جاهز؛ العميل طلب موعد التدقيق الأول في ديسمبر"})
        s_empty, b_empty = a.call("POST", f"{V}/{v1.get('id')}/notes", {"version": cur.get("version") + 1, "text": " "})
        s_view, _ = v.call("POST", f"{V}/{v1.get('id')}/notes", {"version": cur.get("version") + 1, "text": "x"})
        detail = obj(a.call("GET", f"{V}/{v1.get('id')}")[1])
        log = detail.get("log") or []
        check("notes are appended (the visit version moves) and read back; empty → 422; a viewer cannot write (403)",
              s == 201 and (detail.get("visit") or {}).get("version", 0) > cur.get("version", 0) and len(log) == 1 and "خط الإنتاج" in log[0]["text"]
              and log[0]["mine"] is True and (s_empty, err(b_empty)[1], s_view) == (422, "REQUIRED", 403), (s, len(log), s_empty, s_view))

        # --- agenda, mine, cancel --------------------------------------------------------------------
        agenda = rows(b.call("GET", f"/ws/ioeti/workspace/agenda?from={datetime.now().date().isoformat()}&to={(datetime.now() + timedelta(days=7)).date().isoformat()}")[1])
        agenda_a = rows(a.call("GET", f"/ws/ioeti/workspace/agenda?from={datetime.now().date().isoformat()}&to={(datetime.now() + timedelta(days=7)).date().isoformat()}")[1])
        mine_b = rows(b.call("GET", V + "?mine=true")[1])
        check("the colleague's planned visit is in their agenda and their list, not in the planner's",
              any(i["type"] == "VISIT" and i["id"] == v2.get("id") and i["title"] == f"مصنع الزيارات {tag}" for i in agenda)
              and not any(i["type"] == "VISIT" and i["id"] == v2.get("id") for i in agenda_a)
              and [r["id"] for r in mine_b] == [v2.get("id")], ([i["title"] for i in agenda], [r["id"] for r in mine_b]))
        s, body = b.call("POST", f"{V}/{v2.get('id')}/cancel", {"version": v2p.get("version")})
        cancelled = obj(body)
        check("cancelling a planned visit clears its time and assignee",
              s == 200 and cancelled.get("status") == "CANCELLED" and cancelled.get("assigneeId") is None and cancelled.get("plannedStart") is None, (s, cancelled))

        if sequence_created:
            s, body = admin.call("GET", "/ws/ioeti/admin/audit?subject=NUMBERING&limit=5")
            check("the change log records the numbering set-up", any(r["action"] == "NUMBERING_SET" for r in rows(body)), rows(body))

        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
        print(f"\n{sum(r['result'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} checks passed")
    finally:
        visit_ids = [rid for m, rid in created if m == VISIT]
        if visit_ids:
            _, notes = admin.call("POST", f"/ws/rest/{NOTE}/search", {"fields": ["id"], "limit": 500,
                                                                     "data": {"_domain": f"self.visit.id in ({','.join(map(str, visit_ids))})"}})
            created.extend((NOTE, n["id"]) for n in notes.get("data") or [])
        if sequence_created:
            _, seqs = admin.call("POST", f"/ws/rest/{SEQUENCE}/search", {"fields": ["id"], "limit": 5,
                                                                        "data": {"_domain": "self.codeSelect = 'intervention' AND self.company IS NULL"}})
            for seq in seqs.get("data") or []:
                _, versions = admin.call("POST", f"/ws/rest/{SEQUENCE_VERSION}/search", {"fields": ["id"], "limit": 50,
                                                                                        "data": {"_domain": f"self.sequence.id = {seq['id']}"}})
                created.extend((SEQUENCE_VERSION, x["id"]) for x in versions.get("data") or [])
                # numbers the visits reserved from this probe's own sequence
                _, reserved = admin.call("POST", f"/ws/rest/{RESERVED}/search", {"fields": ["id"], "limit": 500,
                                                                               "data": {"_domain": f"self.sequence.id = {seq['id']}"}})
                created.extend((RESERVED, x["id"]) for x in reserved.get("data") or [])
                created.append((SEQUENCE, seq["id"]))
        order = {NOTE: 0, VISIT: 1, RESERVED: 2, SEQUENCE_VERSION: 3, SEQUENCE: 4, PARTNER: 5, USER: 10, GROUP: 11, PERM: 12}
        complete, left = cleanup(admin, created, order)
        if not complete:
            print(f"FAIL cleanup left {left}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "visit-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
