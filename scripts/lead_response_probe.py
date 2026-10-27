#!/usr/bin/env python3
"""D-12 lead response targets (signed 2026-10-25): live probe against a RUNNING local/CI Axelor; never against production.
Principals are TEST FIXTURES: a policy owner, a line manager who reads the line's leads, a rep who owns some of them, and
the administrator. Leads are fixtures too; when they arrived and when the policies took effect are set with SQL in the
disposable database, as a stand-in for time passing. Every record is removed afterwards.
Checks:
  fail closed: without working hours a lead's status is NOT_SET (CALENDAR); with them but no target, NOT_SET (TARGET); a
  line without a target stays NOT_SET
  working hours: the first-contact deadline is counted in working hours (a lead arriving an hour before closing is due the
  next working morning); a line-and-source target wins over the line's
  status: no contact past the deadline is OVERDUE, contact in time MET, after it LATE, a lost lead CLOSED, a new lead DUE;
  the qualification deadline is reported when the line has one
  check: a missed target is recorded once per lead and target, with the policy versions; the line manager gets one in-app
  notice per miss, naming the lead's number and line only; a second run records nothing; nothing is reassigned; only an
  administrator may run it on demand
  overdue list: each reader sees only the overdue leads they may read; a lead contacted late leaves it, and its miss stays
Report: logs/lead-response-probe.json.
"""
import json
import os
import secrets
import sys
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from db_migrate import DATABASE, psql  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
LEAD, EVENT, SOURCE = "com.axelor.apps.crm.db.Lead", "com.axelor.apps.crm.db.Event", "com.axelor.apps.base.db.Source"
LINE, LOST_REASON, MESSAGE = "com.ioeti.businessline.db.BusinessLine", "com.axelor.apps.crm.db.LostReason", "com.axelor.mail.db.MailMessage"
VERSION, AUDIT = "com.ioeti.core.db.PolicyVersion", "com.ioeti.admin.db.AdminAuditEvent"
MISS, NOTICE = "com.ioeti.businessline.db.LeadResponseMiss", "com.ioeti.automation.db.InboxNotice"
LD, WS, P = "/ws/ioeti/leads", "/ws/ioeti/workspace", "/ws/ioeti/policies"
KEYS = ("work.calendar", "leads.response-target")
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:240]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def obj(body):
    return (body.get("object") if isinstance(body, dict) else None) or {}


def at(day, hour, minute=0):
    return datetime(day.year, day.month, day.day, hour, minute)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def minute(dt):
    """Axelor writes date-times to the minute ("2026-10-22T13:00Z", wall clock)."""
    return dt.strftime("%Y-%m-%dT%H:%M")


def main():
    admin = Client()
    assert admin.login(os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin")),
                       os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
    tag = secrets.token_hex(3).lower()
    created = []

    def create(model, values):
        _, body = rest_create(admin, model, values)
        if not ok(body):
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}: {json.dumps(body)[:300]}")
        created.append((model, body["data"][0]["id"]))
        return body["data"][0]

    def search(model, domain, fields=("id",), limit=500):
        _, body = admin.call("POST", f"/ws/rest/{model}/search", {"fields": list(fields), "limit": limit, "data": {"_domain": domain, "_archived": True}})
        return body.get("data") or []

    existing = search(VERSION, "self.policyKey IN ('work.calendar', 'leads.response-target')")
    if existing:
        raise SystemExit(f"this database already has {len(existing)} working-hours or response-target versions; run on a clean disposable database")

    exit_code = 1
    users = {}
    try:
        line = create(LINE, {"code": f"RSP{tag}".upper(), "nameEn": f"Response probe {tag}", "nameAr": "خط تجريبي", "statusSelect": 2})
        other_line = create(LINE, {"code": f"RSQ{tag}".upper(), "nameEn": f"Response probe other {tag}", "nameAr": "خط تجريبي آخر", "statusSelect": 2})
        source = create(SOURCE, {"name": f"Response fair {tag}"})
        reason = create(LOST_REASON, {"name": f"Response budget {tag}"})

        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"rsp.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})
        rwc = dict(canRead=True, canWrite=True, canCreate=True)
        rep = [perm("lead", LEAD, "self.user = ?", **rwc), perm("event", EVENT, "self.user = ?", **rwc), perm("line", LINE, canRead=True)]
        manager = [perm("m.lead", LEAD, canRead=True), perm("m.event", EVENT, canRead=True), perm("m.line", LINE, canRead=True)]
        groups = {"rep": create(GROUP, {"code": f"rsp-rep-{tag}", "name": f"Response rep {tag}", "permissions": [{"id": p["id"]} for p in rep]}),
                  "manager": create(GROUP, {"code": f"rsp-mgr-{tag}", "name": f"Response manager {tag}", "permissions": [{"id": p["id"]} for p in manager]}),
                  "none": create(GROUP, {"code": f"rsp-none-{tag}", "name": f"Response none {tag}"})}
        sessions = {}
        for label, group in (("Rep", "rep"), ("Manager", "manager"), ("Owner", "none")):
            password = "Rs!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"rsp.{label.lower()}.{tag}", "name": f"Response {label} {tag}", "blocked": False, "language": "ar",
                                         "group": {"id": groups[group]["id"]}, "password": axelor_password_hash(password),
                                         "ioetiBusinessLines": [{"id": line["id"]}]})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        rep_c, mgr, owner = sessions["Rep"], sessions["Manager"], sessions["Owner"]
        admin.call("POST", f"/ws/rest/{LINE}/{line['id']}", {"data": {"id": line["id"], "version": line["version"], "manager": {"id": users["Manager"]["id"]}}})
        s, _ = admin.call("POST", P + "/owners", {"userId": users["Owner"]["id"]})
        assert s == 200, f"appointing the policy owner: {s}"

        # --- leads and when they arrived ---------------------------------------------------------------------------
        today = date.today()
        d5 = today - timedelta(days=5)

        def lead(n, received, lead_line=line, with_source=False, assigned=True):
            values = {"name": f"Response Person {tag} {n}", "ioetiBusinessLine": {"id": lead_line["id"]}}
            if with_source:
                values["source"] = {"id": source["id"]}
            if assigned:
                values["user"] = {"id": users["Rep"]["id"]}
            row = create(LEAD, values)
            if received is not None:
                psql(DATABASE, f"UPDATE crm_lead SET created_on = '{iso(received)}' WHERE id = {int(row['id'])};")
            return row
        overdue = lead(1, at(d5, 9))                                  # no contact; line target 4 h → 13:00 that day
        sourced = lead(2, at(d5, 15), with_source=True, assigned=False)  # line+source target 2 h → next morning 09:00
        on_time = lead(3, at(d5, 9))
        late = lead(4, at(d5, 9))
        lost = lead(5, at(d5, 9))
        fresh = lead(6, None)
        untargeted = lead(7, at(d5, 9), lead_line=other_line)

        def view(lead_row, client=rep_c):
            return obj(client.call("GET", f"{LD}/{lead_row['id']}")[1])

        def log_contact(lead_row, when):
            v = view(lead_row).get("version")
            s_, b_ = rep_c.call("POST", WS + "/activities", {"record": "LEAD", "recordId": lead_row["id"], "version": v, "kind": "CALL",
                                                             "subject": "first call", "at": when.strftime("%Y-%m-%dT%H:%M")})
            if obj(b_).get("id"):
                created.append((EVENT, obj(b_)["id"]))
            return s_
        assert log_contact(on_time, at(d5, 10)) == 201
        assert log_contact(late, at(d5 + timedelta(days=2), 10)) == 201
        s, b = rep_c.call("POST", f"{LD}/{lost['id']}/lose", {"version": view(lost).get("version"), "lostReasonId": reason["id"], "note": "probe"})
        assert s == 200, f"losing the lead: {s} {b}"

        # --- fail closed ------------------------------------------------------------------------------------------
        r = view(overdue).get("response") or {}
        check("fail closed: without working hours a lead has no timer (NOT_SET, CALENDAR)", (r.get("status"), r.get("missing")) == ("NOT_SET", "CALENDAR"), r)

        def set_policy(key, value, scope=None):
            body = {"value": value, "reason": f"probe {tag}"}
            if scope:
                body["scope"] = scope
            s_, b_ = owner.call("POST", f"{P}/{key}", body)
            assert s_ == 201, f"setting {key}: {s_} {b_}"
        set_policy("work.calendar", {"days": ["SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI"], "start": "08:00", "end": "16:00"})
        # the policies "took effect" before the leads arrived (test fixture for time passing)
        psql(DATABASE, f"UPDATE ioeti_policy_version SET effective_from = '{today - timedelta(days=30)}' WHERE policy_key IN ('work.calendar', 'leads.response-target');")
        r = view(overdue).get("response") or {}
        check("fail closed: with working hours but no target for the line, still NOT_SET (TARGET)", (r.get("status"), r.get("missing")) == ("NOT_SET", "TARGET"), r)
        set_policy("leads.response-target", {"firstContactHours": 4, "qualificationHours": 9}, line["code"])
        set_policy("leads.response-target", {"firstContactHours": 2}, f"{line['code']}/{source['id']}")
        psql(DATABASE, f"UPDATE ioeti_policy_version SET effective_from = '{today - timedelta(days=30)}' WHERE policy_key IN ('work.calendar', 'leads.response-target');")

        # --- status -----------------------------------------------------------------------------------------------
        r1, r2 = view(overdue, mgr).get("response") or {}, view(sourced, mgr).get("response") or {}
        check("working hours: no contact past the deadline is OVERDUE; the deadline counts working hours only (4 h from 09:00 is 13:00)",
              r1.get("status") == "OVERDUE" and str(r1.get("dueAt", "")).startswith(minute(at(d5, 13))), r1)
        check("working hours: a lead arriving an hour before closing is due the next working morning; the line-and-source target wins",
              r2.get("status") == "OVERDUE" and str(r2.get("dueAt", "")).startswith(minute(at(d5 + timedelta(days=1), 9))) and r2.get("qualification") is None, r2)
        check("qualification: the line's qualification deadline is reported (9 working hours: 7 that day, then the next morning until 10:00), overdue while unconverted",
              r1.get("qualification") == "OVERDUE" and str(r1.get("qualifyDueAt", "")).startswith(minute(at(d5 + timedelta(days=1), 10))), r1)
        statuses = {n: (view(x).get("response") or {}).get("status") for n, x in (("on_time", on_time), ("late", late), ("lost", lost), ("fresh", fresh))}
        statuses["untargeted"] = (view(untargeted, mgr).get("response") or {}).get("status")
        check("status: contact in time is MET, after the deadline LATE, a lost lead CLOSED, a new lead DUE, a line without a target NOT_SET",
              statuses == {"on_time": "MET", "late": "LATE", "lost": "CLOSED", "fresh": "DUE", "untargeted": "NOT_SET"}, statuses)

        # --- the check --------------------------------------------------------------------------------------------
        s, _ = mgr.call("POST", LD + "/response/check", {})
        check("check: only an administrator may run it on demand (403)", s == 403, s)
        before = {x["id"]: (search(LEAD, f"self.id = {x['id']}", ("user",)) or [{}])[0].get("user") for x in (overdue, sourced)}
        s, b = admin.call("POST", LD + "/response/check", {})
        mine = search(MISS, f"self.lead.id IN ({overdue['id']},{sourced['id']},{on_time['id']},{late['id']},{lost['id']},{fresh['id']},{untargeted['id']})",
                      ("lead", "target", "dueAt", "targetPolicy", "calendarPolicy", "notified"))
        got = sorted((m["lead"]["id"], m["target"]) for m in mine)
        # contacted in time or late, but never converted: their qualification deadline passed too; the line-and-source value
        # has no qualification target, and the most specific value applies whole
        expected = sorted([(overdue["id"], "FIRST_CONTACT"), (overdue["id"], "QUALIFICATION"), (sourced["id"], "FIRST_CONTACT"),
                           (on_time["id"], "QUALIFICATION"), (late["id"], "QUALIFICATION")])
        check("check: each missed target is recorded once (first contact and qualification), with the policy versions and the manager notified",
              # (the 15-minute schedule may have recorded them first; either way each is there exactly once)
              s == 200 and got == expected
              and all(m.get("targetPolicy") and m.get("calendarPolicy") and (m.get("notified") or {}).get("id") == users["Manager"]["id"] for m in mine),
              (s, got, mine[:2]))
        notices = search(NOTICE, f"self.recipient.id = {users['Manager']['id']}", ("kind", "subject", "subjectId", "title"))
        kinds = sorted((n["kind"], n["subjectId"]) for n in notices)
        check("check: the line manager gets one in-app notice per miss, naming only the lead's number and line",
              kinds == sorted([("LEAD_FIRST_CONTACT_OVERDUE" if t == "FIRST_CONTACT" else "LEAD_QUALIFICATION_OVERDUE", i) for i, t in expected])
              and all(n["subject"] == "LEAD" and f"Response Person" not in n["title"] and line["code"] in n["title"] for n in notices), notices)
        s, b = admin.call("POST", LD + "/response/check", {})
        again = search(NOTICE, f"self.recipient.id = {users['Manager']['id']}")
        check("check: a second run records nothing and sends nothing", s == 200 and obj(b).get("recorded") == 0 and len(again) == len(notices), (b, len(again)))
        after = {x["id"]: (search(LEAD, f"self.id = {x['id']}", ("user",)) or [{}])[0].get("user") for x in (overdue, sourced)}
        check("check: nothing is reassigned", after == before, (before, after))

        # --- the overdue list -------------------------------------------------------------------------------------
        m_ids = [x["id"] for x in (mgr.call("GET", LD + "/overdue")[1].get("object") or [])]
        s, b = rep_c.call("GET", LD + "/overdue")
        r_ids = [x["id"] for x in (b.get("object") or b.get("data") or [])]
        check("overdue list: each reader sees only the overdue leads they may read (the rep, their own; the manager, the line's)",
              {overdue["id"], sourced["id"]} <= set(m_ids) and overdue["id"] in r_ids and sourced["id"] not in r_ids, (m_ids, r_ids))
        assert log_contact(overdue, datetime.now() - timedelta(minutes=5)) == 201
        r = view(overdue).get("response") or {}
        r_ids = [x["id"] for x in (rep_c.call("GET", LD + "/overdue")[1].get("object") or [])]
        still = search(MISS, f"self.lead.id = {overdue['id']}")
        check("overdue list: a lead contacted late is LATE and leaves the list; its recorded miss stays",
              r.get("status") == "LATE" and overdue["id"] not in r_ids and len(still) == 2, (r, r_ids, len(still)))

        exit_code = 0 if all(x["result"] == "PASS" for x in RESULTS) else 1
    finally:
        lead_ids = [i for m, i in created if m == LEAD]
        if lead_ids:
            ids = ",".join(map(str, lead_ids))
            created.extend((MISS, m["id"]) for m in search(MISS, f"self.lead.id IN ({ids})"))
            created.extend((EVENT, e["id"]) for e in search(EVENT, f"self.eventLead.id IN ({ids})"))
            created.extend((MESSAGE, m["id"]) for m in search(MESSAGE, f"self.relatedModel = '{LEAD}' AND self.relatedId IN ({ids})"))
            created.extend((NOTICE, n["id"]) for n in search(NOTICE, f"self.subject = 'LEAD' AND self.subjectId IN ({ids})"))
        created.extend((VERSION, v["id"]) for v in search(VERSION, "self.policyKey IN ('work.calendar', 'leads.response-target')"))
        for row in [r for m, r in created if m == LINE]:
            # the manager link would keep the manager's user from being deleted
            cur = (search(LINE, f"self.id = {row}", ("version",)) or [{}])[0]
            if cur.get("id"):
                admin.call("POST", f"/ws/rest/{LINE}/{row}", {"data": {"id": row, "version": cur.get("version"), "manager": None}})
        if users.get("Owner"):
            created.extend((AUDIT, a["id"]) for a in search(AUDIT, f"self.actor.id = {users['Owner']['id']} OR self.createdBy.id = {users['Owner']['id']}"))
        order = {MISS: 0, NOTICE: 0, AUDIT: 0, MESSAGE: 1, EVENT: 1, VERSION: 1, LEAD: 2, LOST_REASON: 3, SOURCE: 3, USER: 4, GROUP: 5, PERM: 6, LINE: 7}
        complete, left = cleanup(admin, list(dict.fromkeys(created)), order)
        if not complete:
            print(f"FAIL cleanup left {left}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "lead-response-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
