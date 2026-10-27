#!/usr/bin/env python3
"""The calendar: live probe against a RUNNING local/CI Axelor; never against production. Roles are TEST FIXTURES built
from native permissions: RepA and RepB share a team and own their own activities; Lead is in the same team and may read and
change every activity natively; Outsider is in no team; Viewer only reads. Every name is fictional and removed afterwards.
Checks:
  personal items: a planned item without a record, its length, and a done one in the past; length limits; a read-only
  person cannot add one
  move: to another time keeping its length, or with a new length; stale version → 409; into the past → 422 PAST;
  another person's item → 404; a done item → 422 NOT_PLANNED
  done and cancel: done with an outcome (never returned), not twice; a cancelled item leaves the calendar
  overdue: the owner's planned items whose time passed are listed (only theirs) until done or postponed
  whose calendar: the people list is the caller and their teammates; a teammate's calendar shows only what the caller's
  own rights let them read, and nothing in it can be moved; someone outside the team → 404; anonymous → 401
Report: logs/calendar-probe.json.
"""
import json
import os
import secrets
import sys
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
EVENT, TEAM, MESSAGE = "com.axelor.apps.crm.db.Event", "com.axelor.team.db.Team", "com.axelor.mail.db.MailMessage"
WS = "/ws/ioeti/workspace"
ZONE = "Africa/Cairo"
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:240]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def err(body):
    e = (body.get("error") or {}) if isinstance(body, dict) else {}
    return e.get("code"), ((e.get("fields") or [{}])[0]).get("code")


def obj(body):
    return (body.get("object") if isinstance(body, dict) else None) or {}


def rows(body):
    value = body.get("object") if isinstance(body, dict) else None
    return value if isinstance(value, list) else []


def minute(value):
    return (value or "")[:16]


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

    def search(model, domain, fields=("id",)):
        _, body = admin.call("POST", f"/ws/rest/{model}/search", {"fields": list(fields), "limit": 500, "data": {"_domain": domain, "_archived": True}})
        return body.get("data") or []

    exit_code = 1
    users = {}
    try:
        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"cal.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})
        rwc = dict(canRead=True, canWrite=True, canCreate=True)
        rep = [perm("event", EVENT, "self.user = ?", **rwc)]
        lead = [perm("l.event", EVENT, **rwc)]  # may read and change every activity natively
        view = [perm("v.event", EVENT, canRead=True)]
        groups = {k: create(GROUP, {"code": f"cal-{k}-{tag}", "name": f"Calendar {k} {tag}", "permissions": [{"id": p["id"]} for p in v]})
                  for k, v in (("rep", rep), ("lead", lead), ("view", view))}
        sessions = {}
        for label, group in (("RepA", "rep"), ("RepB", "rep"), ("Lead", "lead"), ("Outsider", "rep"), ("Viewer", "view")):
            password = "Ca!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"cal.{label.lower()}.{tag}", "name": f"Calendar {label} {tag}", "blocked": False, "language": "ar",
                                         "group": {"id": groups[group]["id"]}, "password": axelor_password_hash(password)})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        team = create(TEAM, {"code": f"CAL{tag}", "name": f"Calendar team {tag}",
                             "members": [{"id": users[k]["id"]} for k in ("RepA", "RepB", "Lead")]})
        a, b, lead_s, out, v, anon = *(sessions[k] for k in ("RepA", "RepB", "Lead", "Outsider", "Viewer")), Client()

        day = date.today() + timedelta(days=2)
        at = f"{day.isoformat()}T10:00"
        frm, to = (date.today() - timedelta(days=1)).isoformat(), (date.today() + timedelta(days=6)).isoformat()

        def add(client, **values):
            s_, b_ = client.call("POST", WS + "/activities", {"kind": "MEETING", "zone": ZONE, **values})
            if obj(b_).get("id"):
                created.append((EVENT, obj(b_)["id"]))
            return s_, b_

        def agenda(client, user_id=None):
            s_, b_ = client.call("GET", f"{WS}/agenda?from={frm}&to={to}" + (f"&userId={user_id}" if user_id else ""))
            return s_, rows(b_)

        # --- personal items -----------------------------------------------------------------------------
        s, body = add(a, subject=f"تجهيز عرض الإدارة {tag}", at=at, minutes=45, planned=True)
        mine = obj(body)
        s2, items = agenda(a)
        it = next((i for i in items if i["id"] == mine.get("id")), {})
        check("a personal planned item needs no record; it is on the owner's calendar with its length, and movable",
              s == 201 and mine.get("status") == "PLANNED" and it.get("recordType") is None and minute(it.get("at")) == at
              and minute(it.get("endsAt")) == f"{day.isoformat()}T10:45" and it.get("movable") is True and it.get("version") is not None, (s, mine, it))
        past = (datetime.now() - timedelta(days=1)).replace(hour=9, minute=0).strftime("%Y-%m-%dT%H:%M")
        s, body = add(a, subject=f"مكالمة سريعة {tag}", at=past, kind="CALL")
        done_item = obj(body)
        check("a personal item in the past is recorded as done", s == 201 and done_item.get("status") == "DONE", (s, done_item))
        s1, b1 = add(a, subject="x", at=at, minutes=3, planned=True)
        s2, b2 = add(a, subject="x", at=at, minutes=721, planned=True)
        check("an item lasts 5 minutes to 12 hours (422 RANGE)", (s1, err(b1)[1], s2, err(b2)[1]) == (422, "RANGE", 422, "RANGE"), (s1, err(b1), s2, err(b2)))
        s, _ = add(v, subject="x", at=at, planned=True)
        check("a read-only person cannot add an item (403)", s == 403, s)

        # --- move ---------------------------------------------------------------------------------------
        later = f"{(day + timedelta(days=1)).isoformat()}T14:15"
        s, body = a.call("POST", f"{WS}/activities/{mine.get('id')}/move", {"version": it.get("version"), "at": later, "zone": ZONE})
        moved = obj(body)
        _, items = agenda(a)
        it2 = next((i for i in items if i["id"] == mine.get("id")), {})
        check("moving keeps the length and the new time shows on the calendar",
              s == 200 and minute(it2.get("at")) == later and minute(it2.get("endsAt")) == f"{(day + timedelta(days=1)).isoformat()}T15:00", (s, moved, it2))
        s, body = a.call("POST", f"{WS}/activities/{mine.get('id')}/move", {"version": it2.get("version"), "at": later, "minutes": 90, "zone": ZONE})
        _, items = agenda(a)
        it3 = next((i for i in items if i["id"] == mine.get("id")), {})
        check("moving with a new length changes the end", s == 200 and minute(it3.get("endsAt")) == f"{(day + timedelta(days=1)).isoformat()}T15:45", (s, it3))
        s1, _ = a.call("POST", f"{WS}/activities/{mine.get('id')}/move", {"version": it.get("version"), "at": at, "zone": ZONE})
        s2, b2 = a.call("POST", f"{WS}/activities/{mine.get('id')}/move", {"version": it3.get("version"), "at": past, "zone": ZONE})
        check("a stale version → 409 and a time in the past → 422 PAST", (s1, s2, err(b2)[1]) == (409, 422, "PAST"), (s1, s2, err(b2)))
        s, _ = b.call("POST", f"{WS}/activities/{mine.get('id')}/move", {"version": it3.get("version"), "at": at, "zone": ZONE})
        check("a teammate cannot move someone else's item (404, no existence oracle)", s == 404, s)
        s, _ = lead_s.call("POST", f"{WS}/activities/{mine.get('id')}/move", {"version": it3.get("version"), "at": at, "zone": ZONE})
        check("a person whose native rights cover every activity still cannot move another's from the calendar (403)", s == 403, s)
        dv = next((i for i in agenda(a)[1] if i["id"] == done_item.get("id")), None)
        s, body = a.call("POST", f"{WS}/activities/{done_item.get('id')}/move", {"version": (dv or {}).get("version", 0), "at": at, "zone": ZONE})
        check("a done item is on the calendar but not movable", dv is not None and dv.get("movable") is False, dv)
        check("moving a done item → 422 NOT_PLANNED", s == 422 and err(body)[0] == "NOT_PLANNED", (s, err(body)))

        # --- done and cancel ----------------------------------------------------------------------------
        s, body = a.call("POST", f"{WS}/activities/{mine.get('id')}/done", {"version": it3.get("version"), "outcome": f"وافقوا على النطاق {tag}"})
        finished = obj(body)
        _, items = agenda(a)
        it4 = next((i for i in items if i["id"] == mine.get("id")), {})
        check("done with what came of it: DONE on the calendar, no longer movable, and the outcome text is never returned",
              s == 200 and it4.get("status") == "DONE" and it4.get("movable") is False and "وافقوا" not in json.dumps(body) + json.dumps(items), (s, finished, it4))
        s, body = a.call("POST", f"{WS}/activities/{mine.get('id')}/done", {"version": it4.get("version")})
        check("not done twice (422 NOT_PLANNED)", s == 422 and err(body)[0] == "NOT_PLANNED", (s, err(body)))
        s, body = add(a, subject=f"اجتماع سيتلغى {tag}", at=at, planned=True)
        to_cancel = obj(body)
        s, body = a.call("POST", f"{WS}/activities/{to_cancel.get('id')}/cancel", {"version": to_cancel.get("version")})
        _, items = agenda(a)
        check("a cancelled item leaves the calendar", s == 200 and not any(i["id"] == to_cancel.get("id") for i in items), (s, [i["id"] for i in items]))
        s, _ = b.call("POST", f"{WS}/activities/{done_item.get('id')}/cancel", {"version": 0})
        check("a teammate cannot cancel another's item (404)", s == 404, s)

        # --- overdue: a planned item whose time has passed stays in view ------------------------------
        s, body = add(a, subject=f"متابعة فات ميعادها {tag}", at=at, planned=True)
        stale = obj(body)
        # the clock moves on: the fixture's time is put in the past directly (a planned item cannot be created there)
        _, fetched = admin.call("POST", f"/ws/rest/{EVENT}/{stale.get('id')}/fetch", {"fields": ["version"]})
        admin.call("POST", f"/ws/rest/{EVENT}/{stale.get('id')}", {"data": {"id": stale.get("id"), "version": (fetched.get("data") or [{}])[0].get("version"),
                                                                       "startDateTime": f"{past}:00", "endDateTime": f"{past[:11]}09:30:00"}})
        s1, b1 = a.call("GET", f"{WS}/agenda/overdue?zone={ZONE}")
        s2, b2 = b.call("GET", f"{WS}/agenda/overdue?zone={ZONE}")
        late = next((i for i in rows(b1) if i["id"] == stale.get("id")), {})
        check("the overdue list has the owner's planned item whose time passed (movable), and only theirs",
              s1 == 200 and late.get("movable") is True and late.get("status") == "PLANNED" and s2 == 200 and not any(i["id"] == stale.get("id") for i in rows(b2)), (s1, rows(b1), s2))
        s, body = a.call("POST", f"{WS}/activities/{stale.get('id')}/move", {"version": late.get("version"), "at": at, "zone": ZONE})
        _, b1 = a.call("GET", f"{WS}/agenda/overdue?zone={ZONE}")
        check("postponing it to a future time takes it off the overdue list", s == 200 and not any(i["id"] == stale.get("id") for i in rows(b1)), (s, rows(b1)))

        # --- whose calendar -----------------------------------------------------------------------------
        s, body = a.call("GET", WS + "/agenda/people")
        people = rows(body)
        ids = {p["id"] for p in people}
        me = [p for p in people if p.get("me")]
        check("the people list is the caller first, then their teammates; not someone outside the team",
              s == 200 and len(me) == 1 and me[0]["id"] == users["RepA"]["id"] and people[0]["id"] == users["RepA"]["id"]
              and {users["RepB"]["id"], users["Lead"]["id"]} <= ids and users["Outsider"]["id"] not in ids, people)
        s, body = out.call("GET", WS + "/agenda/people")
        check("someone in no team sees only themselves", s == 200 and [p["id"] for p in rows(body)] == [users["Outsider"]["id"]], rows(body))
        s, body = add(b, subject=f"زيارة عميل {tag}", at=at, planned=True)
        b_item = obj(body)
        s1, seen_by_lead = agenda(lead_s, users["RepB"]["id"])
        s2, seen_by_a = agenda(a, users["RepB"]["id"])
        lead_view = next((i for i in seen_by_lead if i["id"] == b_item.get("id")), {})
        check("a teammate who may read every item sees RepB's planned item, and cannot move it from there",
              s1 == 200 and lead_view.get("title") == f"زيارة عميل {tag}" and lead_view.get("movable") is False, (s1, seen_by_lead))
        check("a teammate whose rights cover only their own items sees none of RepB's (native rights still apply)",
              s2 == 200 and not any(i["id"] == b_item.get("id") for i in seen_by_a), (s2, seen_by_a))
        s1, _ = out.call("GET", f"{WS}/agenda?from={frm}&to={to}&userId={users['RepA']['id']}")
        s2, _ = anon.call("GET", f"{WS}/agenda?from={frm}&to={to}")
        s3, _ = anon.call("GET", WS + "/agenda/people")
        check("someone outside the team asking for RepA's calendar → 404; anonymous → 401", (s1, s2, s3) == (404, 401, 401), (s1, s2, s3))

        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
        print(f"\n{sum(r['result'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} checks passed")
    finally:
        user_ids = [u["id"] for u in users.values()]
        if user_ids:
            for row in search(EVENT, f"self.user.id in ({','.join(map(str, user_ids))})"):
                if (EVENT, row["id"]) not in created:
                    created.append((EVENT, row["id"]))
        order = {EVENT: 0, TEAM: 5, USER: 10, GROUP: 11, PERM: 12}
        complete, left = cleanup(admin, created, order)
        # the change-tracking messages Axelor wrote for the fixtures (users, groups, permissions, team), by the fixtures' tag
        for m in search(MESSAGE, f"self.relatedName LIKE '%{tag}%' AND self.relatedModel IN ('{USER}', '{GROUP}', '{PERM}', '{TEAM}', '{EVENT}')"):
            admin.call("DELETE", f"/ws/rest/{MESSAGE}/{m['id']}")
        if not complete:
            print(f"FAIL cleanup left {left}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "calendar-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
