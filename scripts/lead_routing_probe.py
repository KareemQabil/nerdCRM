#!/usr/bin/env python3
"""D-12 lead routing (signed 2026-10-25): live probe against a RUNNING local/CI Axelor; never against production.
Principals are TEST FIXTURES: a coordinator who records leads, three sales people in one team (A, B, C), a team member who
is not in the line (D), a second team (F), the line's manager, a policy owner, and the administrator. Every record is
removed afterwards.
Checks:
  fail closed: without the line's rules a new lead stays with whoever recorded it, and routing one is refused
  (POLICY_NOT_SET); a rule naming a team that does not exist is refused
  rules: the first matching rule names the team (a governorate rule before the catch-all); a lead can match no rule
  round robin: A, B, C in turn, then A again; a team member outside the line never receives one; someone away is
  skipped; someone at the workload cap is skipped; when nobody can take it, the lead stays unassigned and the line's manager
  is told; once someone is back it can be routed
  never reassigned: routing a lead that has an owner is refused (409); two people routing one lead at once give it one owner
  keep it: the person recording a lead may keep it instead of routing it
  notices and log: the person who receives a lead is told in-app (number and line only); every routing is logged with the
  rule, team and policy version
  away dates: only administrators set them; the end cannot be before the start; the change is audited
Report: logs/lead-routing-probe.json.
"""
import json
import os
import secrets
import sys
import threading
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup, exists  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
LEAD, SOURCE, TEAM = "com.axelor.apps.crm.db.Lead", "com.axelor.apps.base.db.Source", "com.axelor.team.db.Team"
LINE, MESSAGE = "com.ioeti.businessline.db.BusinessLine", "com.axelor.mail.db.MailMessage"
VERSION, AUDIT = "com.ioeti.core.db.PolicyVersion", "com.ioeti.admin.db.AdminAuditEvent"
ROUTING, NOTICE = "com.ioeti.businessline.db.LeadRouting", "com.ioeti.automation.db.InboxNotice"
MK, P, ADM = "/ws/ioeti/marketing", "/ws/ioeti/policies", "/ws/ioeti/admin"
KEY = "leads.routing"
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:240]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def obj(body):
    return (body.get("object") if isinstance(body, dict) else None) or {}


def err(body):
    e = (body.get("error") or {}) if isinstance(body, dict) else {}
    return e.get("code"), ((e.get("fields") or [{}])[0]).get("field"), ((e.get("fields") or [{}])[0]).get("code")


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

    def owner_of(lead_id):
        return ((search(LEAD, f"self.id = {int(lead_id)}", ("user",)) or [{}])[0].get("user") or {}).get("id")

    if search(VERSION, f"self.policyKey = '{KEY}'"):
        raise SystemExit(f"this database already has '{KEY}' versions; run on a clean disposable database")

    exit_code = 1
    users = {}
    try:
        line = create(LINE, {"code": f"RTA{tag}".upper(), "nameEn": f"Routing probe {tag}", "nameAr": "خط توزيع تجريبي", "statusSelect": 2})
        line2 = create(LINE, {"code": f"RTB{tag}".upper(), "nameEn": f"Routing probe B {tag}", "nameAr": "خط توزيع تجريبي ب", "statusSelect": 2})

        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"rtg.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})
        coord = [perm("c.lead", LEAD, canRead=True, canWrite=True, canCreate=True), perm("c.line", LINE, canRead=True), perm("c.source", SOURCE, canRead=True)]
        sales = [perm("s.lead", LEAD, "self.user = ?", canRead=True, canWrite=True), perm("s.line", LINE, canRead=True)]
        groups = {"coord": create(GROUP, {"code": f"rtg-coord-{tag}", "name": f"Routing coordinator {tag}", "permissions": [{"id": p["id"]} for p in coord]}),
                  "sales": create(GROUP, {"code": f"rtg-sales-{tag}", "name": f"Routing sales {tag}", "permissions": [{"id": p["id"]} for p in sales]})}
        sessions = {}
        for label, group, lines in (("Coordinator", "coord", [line, line2]), ("A", "sales", [line]), ("B", "sales", [line]), ("C", "sales", [line]),
                                    ("D", "sales", [line2]), ("F", "sales", [line]), ("Manager", "sales", [line, line2]), ("Owner", "sales", [])):
            password = "Rt!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"rtg.{label.lower()}.{tag}", "name": f"Routing {label} {tag}", "blocked": False, "language": "ar",
                                         "group": {"id": groups[group]["id"]}, "password": axelor_password_hash(password),
                                         "ioetiBusinessLines": [{"id": x["id"]} for x in lines]})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        k, owner = sessions["Coordinator"], sessions["Owner"]
        uid = {name: u["id"] for name, u in users.items()}
        team = create(TEAM, {"name": f"Routing team {tag}", "members": [{"id": uid[n]} for n in ("A", "B", "C", "D")]})
        team2 = create(TEAM, {"name": f"Routing coast {tag}", "members": [{"id": uid["F"]}]})
        source = create(SOURCE, {"name": f"Routing fair {tag}"})
        for row in (line, line2):
            cur = search(LINE, f"self.id = {row['id']}", ("version",))[0]
            admin.call("POST", f"/ws/rest/{LINE}/{row['id']}", {"data": {"id": row["id"], "version": cur["version"], "manager": {"id": uid["Manager"]}}})
        s, _ = admin.call("POST", P + "/owners", {"userId": uid["Owner"]})
        assert s == 200, f"appointing the policy owner: {s}"

        n = [0]

        def intake(lead_line=line, **extra):
            n[0] += 1
            s_, b_ = k.call("POST", MK + "/leads", {"name": f"Routing Person {tag} {n[0]}", "businessLineCode": lead_line["code"],
                                                     "confirmNotDuplicate": True, **extra})
            if obj(b_).get("id"):
                created.append((LEAD, obj(b_)["id"]))
            return s_, b_, obj(b_).get("id")

        # --- fail closed ------------------------------------------------------------------------------------------
        s, b, before = intake()
        s2, b2 = k.call("POST", f"{MK}/leads/{before}/route", {})
        check("fail closed: without the line's rules a new lead stays with whoever recorded it; routing it is refused (409, it has an owner)",
              s == 201 and owner_of(before) == uid["Coordinator"] and (s2, err(b2)[0]) == (409, "ALREADY_ASSIGNED"), (s, owner_of(before), s2, err(b2)))
        # an unassigned lead without rules
        loose = create(LEAD, {"name": f"Routing Person {tag} loose", "ioetiBusinessLine": {"id": line["id"]}})
        s, b = k.call("POST", f"{MK}/leads/{loose['id']}/route", {})
        check("fail closed: routing an unassigned lead without the line's rules is refused (POLICY_NOT_SET)", (s, err(b)[0]) == (422, "POLICY_NOT_SET"), (s, err(b)))
        s, b = owner.call("POST", f"{P}/{KEY}", {"scope": line["code"], "reason": f"probe {tag}",
                                                 "value": {"rules": [{"teamId": 999999999}], "workloadCap": 2}})
        check("fail closed: a rule naming a team that does not exist is refused", (s, err(b)[1:]) == (422, ("value.rules[0].teamId", "UNAVAILABLE")), (s, err(b)))
        s, b = k.call("POST", MK + "/leads", {"name": f"Routing Person {tag} bad", "businessLineCode": line["code"], "governorate": "ATLANTIS",
                                              "confirmNotDuplicate": True})
        check("a lead's governorate is one of Egypt's 27", (s, err(b)[1:]) == (422, ("governorate", "UNAVAILABLE")), (s, err(b)))

        for scope, value in ((line["code"], {"rules": [{"governorate": "ALEXANDRIA", "teamId": team2["id"]}, {"teamId": team["id"]}], "workloadCap": 2}),
                             (line2["code"], {"rules": [{"governorate": "GIZA", "teamId": team["id"]}], "workloadCap": 2})):
            s, b = owner.call("POST", f"{P}/{KEY}", {"scope": scope, "value": value, "reason": f"probe {tag}"})
            assert s == 201, f"setting the rules: {s} {b}"
        version = (obj(owner.call("GET", f"{P}/{KEY}")[1]).get("values") or [{}])

        # --- round robin ------------------------------------------------------------------------------------------
        got = []
        for _ in range(4):
            s, b, lid = intake(governorate="CAIRO")
            got.append((s, owner_of(lid), obj(b).get("assignedToMe"), lid))
        names = {v: name for name, v in uid.items()}
        order = [names.get(o) for _, o, _, _ in got]
        check("round robin: A, B, C in turn, then A again; the member outside the line (D) never receives one",
              order == ["A", "B", "C", "A"] and all(x[0] == 201 for x in got) and all(x[2] is False for x in got), got)
        s, b, coast = intake(governorate="ALEXANDRIA")
        check("rules: the first matching rule names the team (an Alexandria lead goes to the coast team)", names.get(owner_of(coast)) == "F", names.get(owner_of(coast)))
        s, b, kept = intake(governorate="CAIRO", keepMine=True)
        check("keep it: the person recording a lead may keep it instead of routing it",
              owner_of(kept) == uid["Coordinator"] and not search(ROUTING, f"self.lead.id = {kept}"), owner_of(kept))

        # --- away and the cap -------------------------------------------------------------------------------------
        b_ver = search(USER, f"self.id = {uid['B']}", ("version",))[0]["version"]
        s1, _ = sessions["Manager"].call("POST", f"{ADM}/users/{uid['B']}/away", {"version": b_ver, "from": str(date.today()), "until": str(date.today())})
        s2, b2 = admin.call("POST", f"{ADM}/users/{uid['B']}/away", {"version": b_ver, "from": str(date.today()), "until": str(date.today() - timedelta(days=1))})
        s3, b3 = admin.call("POST", f"{ADM}/users/{uid['B']}/away", {"version": b_ver, "from": str(date.today() - timedelta(days=1)), "until": str(date.today() + timedelta(days=2))})
        check("away dates: only administrators set them (403); the end cannot be before the start; saved",
              s1 == 403 and (s2, err(b2)[1:]) == (422, ("until", "BEFORE_START")) and s3 == 200 and obj(b3).get("awayUntil") == str(date.today() + timedelta(days=2)),
              (s1, s2, err(b2), s3, obj(b3).get("awayFrom")))
        s, b, fifth = intake(governorate="CAIRO")
        check("someone away is skipped and someone at the workload cap is skipped (B away, A at 2 of 2: C)", names.get(owner_of(fifth)) == "C", names.get(owner_of(fifth)))
        s, b, sixth = intake(governorate="CAIRO")
        log6 = search(ROUTING, f"self.lead.id = {sixth}", ("outcome",))
        check("when nobody can take it the lead stays unassigned (NO_ONE_AVAILABLE) and the line's manager is told",
              owner_of(sixth) is None and [r["outcome"] for r in log6] == ["NO_ONE_AVAILABLE"]
              and search(NOTICE, f"self.recipient.id = {uid['Manager']} AND self.kind = 'LEAD_UNROUTED' AND self.subjectId = {sixth}"), (owner_of(sixth), log6))
        b_ver = search(USER, f"self.id = {uid['B']}", ("version",))[0]["version"]
        assert admin.call("POST", f"{ADM}/users/{uid['B']}/away", {"version": b_ver, "from": "", "until": ""})[0] == 200
        s, b = k.call("POST", f"{MK}/leads/{sixth}/route", {})
        check("once someone is back the unassigned lead can be routed (to B)", s == 200 and obj(b).get("outcome") == "ASSIGNED" and names.get(owner_of(sixth)) == "B",
              (s, obj(b).get("outcome"), names.get(owner_of(sixth))))
        audit = search(AUDIT, f"self.action = 'USER_AWAY' AND self.subjectId = {uid['B']}")
        check("away dates: each change is in the admin change log", len(audit) == 2, len(audit))

        # --- no rule, never reassigned, concurrency ------------------------------------------------------------------
        s, b, cairo2 = intake(lead_line=line2, governorate="CAIRO")
        log = search(ROUTING, f"self.lead.id = {cairo2}", ("outcome",))
        check("rules: a lead that matches no rule stays unassigned (NO_RULE) and the line's manager is told",
              owner_of(cairo2) is None and [r["outcome"] for r in log] == ["NO_RULE"]
              and search(NOTICE, f"self.recipient.id = {uid['Manager']} AND self.kind = 'LEAD_UNROUTED' AND self.subjectId = {cairo2}"), (owner_of(cairo2), log))
        s, b = k.call("POST", f"{MK}/leads/{got[0][3]}/route", {})
        check("never reassigned: routing a lead that has an owner is refused (409) and its owner stays",
              (s, err(b)[0]) == (409, "ALREADY_ASSIGNED") and owner_of(got[0][3]) == uid["A"], (s, err(b)))
        # an Alexandria lead: F (coast team) has room
        race = create(LEAD, {"name": f"Routing Person {tag} race", "ioetiBusinessLine": {"id": line["id"]}, "ioetiGovernorate": "ALEXANDRIA"})
        answers = []

        def go():
            answers.append(k.call("POST", f"{MK}/leads/{race['id']}/route", {})[0])
        threads = [threading.Thread(target=go) for _ in range(2)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        logs = search(ROUTING, f"self.lead.id = {race['id']}", ("outcome",))
        check("never reassigned: two people routing one lead at once give it one owner (one 200, one 409)",
              sorted(answers) == [200, 409] and [r["outcome"] for r in logs] == ["ASSIGNED"] and owner_of(race["id"]) is not None, (answers, logs))

        # --- notices and the log ----------------------------------------------------------------------------------
        notices = search(NOTICE, f"self.kind = 'LEAD_ROUTED' AND self.recipient.id IN ({uid['A']},{uid['B']},{uid['C']},{uid['F']})", ("recipient", "subjectId", "title"))
        rows = search(ROUTING, f"self.lead.id IN ({','.join(str(i) for _, i in created if _ == LEAD)})", ("outcome", "ruleIndex", "team", "assignee", "policyVersion"))
        assigned = [r for r in rows if r["outcome"] == "ASSIGNED"]
        check("notices: whoever receives a lead is told in-app, by the lead's number and line only",
              len(notices) == len(assigned) and all("Routing Person" not in x["title"] and line["code"] in x["title"] for x in notices), (len(notices), len(assigned)))
        check("log: every routing records the rule, the team and the policy version",
              len(rows) >= 9 and all(r.get("policyVersion") for r in rows) and all(r.get("team") and r.get("ruleIndex") is not None for r in assigned)
              and any(r["ruleIndex"] == 0 for r in assigned) and bool(version), len(rows))
        exit_code = 0 if all(x["result"] == "PASS" for x in RESULTS) else 1
    finally:
        lead_ids = [i for m, i in created if m == LEAD]
        if lead_ids:
            ids = ",".join(map(str, lead_ids))
            created.extend((ROUTING, r["id"]) for r in search(ROUTING, f"self.lead.id IN ({ids})"))
            created.extend((NOTICE, x["id"]) for x in search(NOTICE, f"self.subject = 'LEAD' AND self.subjectId IN ({ids})"))
            created.extend((MESSAGE, m["id"]) for m in search(MESSAGE, f"self.relatedModel = '{LEAD}' AND self.relatedId IN ({ids})"))
        created.extend((VERSION, v["id"]) for v in search(VERSION, f"self.policyKey = '{KEY}'"))
        if users:
            ids = ",".join(str(u["id"]) for u in users.values())
            created.extend((AUDIT, a["id"]) for a in search(AUDIT, f"self.actor.id IN ({ids}) OR self.createdBy.id IN ({ids}) OR (self.subject = 'USER' AND self.subjectId IN ({ids}))"))
            for model in (TEAM, LINE):
                created.extend((MESSAGE, m["id"]) for m in search(MESSAGE, f"self.relatedModel = '{model}' AND self.relatedId IN ({','.join(str(i) for mm, i in created if mm == model) or 0})"))
        for row in [r for m, r in created if m == LINE]:
            cur = (search(LINE, f"self.id = {row}", ("version",)) or [{}])[0]
            if cur.get("id"):
                admin.call("POST", f"/ws/rest/{LINE}/{row}", {"data": {"id": row, "version": cur.get("version"), "manager": None}})
        order = {ROUTING: 0, NOTICE: 0, AUDIT: 0, MESSAGE: 1, VERSION: 1, LEAD: 2, SOURCE: 3, TEAM: 3, USER: 4, GROUP: 5, PERM: 6, LINE: 7}
        complete, left = cleanup(admin, list(dict.fromkeys(created)), order)
        # tracking messages the asynchronous audit queue wrote or updated after the first sweep: by the fixtures' tag
        for m in search(MESSAGE, f"self.relatedModel = '{LEAD}' AND self.relatedName LIKE '%Routing Person {tag}%'"):
            admin.call("DELETE", f"/ws/rest/{MESSAGE}/{m['id']}")
        left = [(m, r) for m, r in left if exists(admin, {"MailMessage": MESSAGE}.get(m, m), r)] if left else left
        complete = not left
        if not complete:
            print(f"FAIL cleanup left {left}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "lead-routing-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
