#!/usr/bin/env python3
"""D-07 retention review (signed 2026-10-25): live probe against a RUNNING local/CI Axelor; never against production.
Principals are TEST FIXTURES: a policy owner the administrator appoints and a person who is not one. Records are fixtures
too (leads, candidates, a contact); their age is set with SQL in the disposable database as a stand-in for time passing.
Every record is removed afterwards.
Checks:
  access: someone who is not a policy owner, and an administrator who is not one, are refused (403)
  fail closed: with no period set, a data type reports "not set" (never zero due) and its queue and decisions are refused
  (422 POLICY_NOT_SET)
  queue: once set, the records whose last activity is older than the period are listed, the longest overdue first, with
  the date they became due; recent activity (a follow-up) keeps a record off; listing changes nothing
  keep: needs a reason and a date after today and at most one more period away; a record that is not due is refused;
  a kept record leaves the queue, and the decision keeps the policy version and the last activity
  anonymize: refused while documents are filed on the record and for shared partner records (contacts); a lead is
  anonymized in place (still there) with its e-mail, phones, tracking messages, follow-ups, drafted messages and notices
  scrubbed; a candidate with its private profile; it leaves the queue and cannot be decided again
  log: every decision is listed with its reason and who decided; no old name survives in it
  unset: retiring the period closes the queue again
Report: logs/retention-probe.json.
"""
import json
import os
import secrets
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from db_migrate import DATABASE, psql  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

USER, GROUP = "com.axelor.auth.db.User", "com.axelor.auth.db.Group"
LEAD, EVENT, EMAIL = "com.axelor.apps.crm.db.Lead", "com.axelor.apps.crm.db.Event", "com.axelor.message.db.EmailAddress"
PARTNER, MESSAGE = "com.axelor.apps.base.db.Partner", "com.axelor.mail.db.MailMessage"
CANDIDATE, PRIVATE = "com.ioeti.recruitment.db.RecruitmentCandidate", "com.ioeti.recruitment.db.CandidatePrivateProfile"
DOC, NOTICE, OUTBOUND = "com.ioeti.content.db.RecordDocument", "com.ioeti.automation.db.InboxNotice", "com.ioeti.automation.db.OutboundMessage"
VERSION, DECISION = "com.ioeti.core.db.PolicyVersion", "com.ioeti.workspace.db.RetentionDecision"
AUDIT = "com.ioeti.admin.db.AdminAuditEvent"
T = "com.ioeti.training.db."
COURSE, COHORT, ENROLLMENT, NATID = T + "TrainingCourse", T + "TrainingCohort", T + "TrainingEnrollment", T + "TrainingNationalId"
R, P = "/ws/ioeti/privacy/retention", "/ws/ioeti/policies"
KEY = "privacy.retention"
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

    def fetch(model, rid, fields):
        return (search(model, f"self.id = {int(rid)}", fields) or [{}])[0]

    def age(table, ids, days):
        if ids:
            psql(DATABASE, f"UPDATE {table} SET created_on = now() - interval '{int(days)} days', updated_on = now() - interval '{int(days)} days' "
                           f"WHERE id IN ({','.join(str(int(i)) for i in ids)});")

    existing = search(VERSION, f"self.policyKey = '{KEY}'")
    if existing:
        raise SystemExit(f"this database already has {len(existing)} '{KEY}' policy versions; run the probe on a clean disposable database")

    exit_code = 1
    users, sessions = {}, {}
    try:
        group = create(GROUP, {"code": f"retprobe-{tag}", "name": f"Retention probe {tag}"})
        for label in ("Owner", "Other"):
            password = "Rt!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"retprobe.{label.lower()}.{tag}", "name": f"Retention probe {label} {tag}", "blocked": False,
                                         "language": "ar", "group": {"id": group["id"]}, "password": axelor_password_hash(password)})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        owner, other = sessions["Owner"], sessions["Other"]
        s, _ = admin.call("POST", P + "/owners", {"userId": users["Owner"]["id"]})
        assert s == 200, f"appointing the policy owner: {s}"
        today = date.today()

        # --- fixtures: who and what ---------------------------------------------------------------------------------
        name = f"Retention Person {tag}"

        def lead(n, email=None):
            e = create(EMAIL, {"address": email}) if email else None
            return create(LEAD, {"name": f"{name} {n}", "firstName": "Probe", "mobilePhone": f"+20100{tag}{n}", "fixedPhone": "+2022222222",
                                 "description": f"notes about {name} {n}", **({"emailAddress": {"id": e["id"]}} if e else {})})
        old, recent, kept, filed, followed = (lead(1, f"ret1.{tag}@example.test"), lead(2), lead(3), lead(4), lead(5))
        event = create(EVENT, {"subject": f"Call {name} 1", "description": f"talked to {name} 1", "startDateTime": f"{today - timedelta(days=500)}T10:00:00",
                               "endDateTime": f"{today - timedelta(days=500)}T10:30:00", "typeSelect": 1, "statusSelect": 1, "eventLead": {"id": old["id"]}})
        recent_event = create(EVENT, {"subject": f"Call {name} 5", "startDateTime": f"{today}T10:00:00", "endDateTime": f"{today}T10:30:00",
                                      "typeSelect": 1, "statusSelect": 1, "eventLead": {"id": followed["id"]}})
        create(DOC, {"title": f"ID scan {tag}", "kindSelect": 1, "subjectSelect": 1, "subjectId": filed["id"]})
        create(NOTICE, {"recipient": {"id": users["Owner"]["id"]}, "kind": "LEAD_ASSIGNED", "subject": "LEAD", "subjectId": old["id"],
                        "title": f"New lead {name} 1", "seen": False, "createdAt": f"{today - timedelta(days=500)}T09:00:00"})
        create(OUTBOUND, {"lead": {"id": old["id"]}, "channelSelect": 1, "subjectLine": f"Hello {name} 1", "body": f"Dear {name} 1",
                          "statusSelect": 1, "createdAt": f"{today - timedelta(days=500)}T09:00:00"})
        cand, cand_recent = (create(CANDIDATE, {"displayName": f"{name} C{n}", "headline": "Quality engineer", "yearsExperience": 7}) for n in (1, 2))
        private = create(PRIVATE, {"candidate": {"id": cand["id"]}, "email": f"cand.{tag}@example.test", "phone": "+201000000000", "cvReference": "CV-1"})
        contact = create(PARTNER, {"name": f"{name} K", "isContact": True, "partnerTypeSelect": 2})
        # national IDs (owner decision 2026-10-29): counted from the certificate, or from the cohort's end without one
        course = create(COURSE, {"code": f"RET-{tag}", "name": f"Retention course {tag}"})
        trainee = create(PARTNER, {"name": f"{name} T", "partnerTypeSelect": 2})
        ids_due, ids_recent = [], []
        for n, ended in ((1, today - timedelta(days=400)), (2, today - timedelta(days=30))):
            cohort = create(COHORT, {"code": f"RET-{tag}-{n}", "course": {"id": course["id"]}, "capacity": 5, "statusSelect": 3,
                                     "startDate": str(ended - timedelta(days=10)), "endDate": str(ended)})
            enrol = create(ENROLLMENT, {"cohort": {"id": cohort["id"]}, "trainee": {"id": trainee["id"]}, "statusSelect": 1})
            nat = create(NATID, {"enrollment": {"id": enrol["id"]}, "idNumber": f"2900101{n:07d}", "recordedAt": f"{ended}T09:00:00"})
            (ids_due if n == 1 else ids_recent).append(nat["id"])
        age("crm_lead", [old["id"], kept["id"], filed["id"], followed["id"]], 400)
        age("ical_event", [event["id"]], 500)
        age("ioeti_rec_candidate", [cand["id"]], 800)
        age("ioeti_rec_candidate_private", [private["id"]], 800)
        age("base_partner", [contact["id"]], 400)

        # --- access and fail closed ---------------------------------------------------------------------------------
        refused = [other.call("GET", R)[0], other.call("GET", R + "/LEADS")[0], other.call("POST", f"{R}/LEADS/{old['id']}/keep", {})[0],
                   admin.call("GET", R)[0], admin.call("POST", f"{R}/LEADS/{old['id']}/anonymize", {"reason": "x"})[0]]
        check("access: someone who is not a policy owner, and an administrator who is not one, are refused (403)", refused == [403] * 5, refused)
        s, b = owner.call("GET", R)
        leads_row = next((t for t in obj(b).get("types", []) if t.get("dataType") == "LEADS"), {})
        s2, b2 = owner.call("GET", R + "/LEADS")
        s3, b3 = owner.call("POST", f"{R}/LEADS/{old['id']}/keep", {"reason": "x", "reviewAgainOn": str(today + timedelta(days=10))})
        check("fail closed: with no period a type reports 'not set' (no due count, never zero); its queue and decisions are refused (POLICY_NOT_SET)",
              s == 200 and leads_row.get("set") is False and leads_row.get("due") is None and (s2, err(b2)[0]) == (422, "POLICY_NOT_SET")
              and (s3, err(b3)[0]) == (422, "POLICY_NOT_SET"), (s, leads_row, s2, err(b2), s3, err(b3)))
        s, _ = owner.call("GET", R + "/EVERYTHING")
        check("an unknown data type is not found (404)", s == 404, s)

        for scope in ("LEADS", "CANDIDATES", "CONTACTS", "NATIONAL_IDS"):
            s, b = owner.call("POST", f"{P}/{KEY}", {"scope": scope, "value": {"months": 12}, "reason": f"probe {tag}"})
            assert s == 201, f"setting the period for {scope}: {s} {b}"

        # --- queue --------------------------------------------------------------------------------------------------
        s, b = owner.call("GET", R)
        types = {t["dataType"]: t for t in obj(b).get("types", [])}
        check("overview: a set type reports its period, policy version and due count; an unset type stays 'not set'",
              s == 200 and types["LEADS"]["set"] and types["LEADS"]["months"] == 12 and types["LEADS"]["policyVersionId"]
              and types["LEADS"]["due"] >= 3 and types["TRAINEES"]["set"] is False and types["TRAINEES"]["due"] is None
              and types["LEADS"]["canAnonymize"] and not types["CONTACTS"]["canAnonymize"], types)
        s, b = owner.call("GET", R + "/LEADS")
        q = obj(b)
        rows = {r["id"]: r for r in q.get("rows", [])}
        mine = [r["id"] for r in q.get("rows", []) if r["id"] in (old["id"], kept["id"], filed["id"])]
        last = date.fromisoformat(rows.get(old["id"], {}).get("lastActivityOn", "1900-01-01"))
        check("queue: leads idle longer than the period are listed with the date they became due; a recent follow-up keeps a lead off",
              s == 200 and set(mine) == {old["id"], kept["id"], filed["id"]} and recent["id"] not in rows and followed["id"] not in rows
              and last == today - timedelta(days=400) and rows[old["id"]]["dueSince"] == (last.replace(year=last.year + 1)).isoformat()
              and q.get("total") >= 3, (s, mine, rows.get(old["id"]), q.get("total")))
        ordered = [r["lastActivityOn"] for r in q.get("rows", [])]
        check("queue: the longest overdue first", ordered == sorted(ordered), ordered[:5])
        still = fetch(LEAD, old["id"], ["name", "mobilePhone"])
        check("listing changes nothing (no automatic removal or change)", still.get("name") == f"{name} 1" and still.get("mobilePhone"), still)
        s, b = owner.call("GET", R + "/CANDIDATES")
        cand_ids = [r["id"] for r in obj(b).get("rows", [])]
        check("queue: a candidate idle longer than the period is listed; a recent one is not",
              cand["id"] in cand_ids and cand_recent["id"] not in cand_ids, cand_ids[:10])

        # --- keep ---------------------------------------------------------------------------------------------------
        probes = [owner.call("POST", f"{R}/LEADS/{kept['id']}/keep", body) for body in (
            {"reason": " ", "reviewAgainOn": str(today + timedelta(days=30))},
            {"reason": "client asked", "reviewAgainOn": str(today)},
            {"reason": "client asked", "reviewAgainOn": str(today + timedelta(days=400))},
            {"reason": "client asked", "reviewAgainOn": "soon"})]
        codes = [(s_, err(b_)[1:]) for s_, b_ in probes]
        check("keep: needs a reason and a date after today, at most one more period away",
              codes == [(422, ("reason", "REQUIRED")), (422, ("reviewAgainOn", "PAST")), (422, ("reviewAgainOn", "RANGE")),
                        (422, ("reviewAgainOn", "FORMAT"))], codes)
        s, b = owner.call("POST", f"{R}/LEADS/{recent['id']}/keep", {"reason": "x", "reviewAgainOn": str(today + timedelta(days=30))})
        s2, _ = owner.call("POST", f"{R}/LEADS/999999999/keep", {"reason": "x", "reviewAgainOn": str(today + timedelta(days=30))})
        check("keep: a record that is not due is refused (NOT_DUE); one that does not exist is not found", (s, err(b)[0], s2) == (422, "NOT_DUE", 404),
              (s, err(b), s2))
        again = today + timedelta(days=30)
        s, b = owner.call("POST", f"{R}/LEADS/{kept['id']}/keep", {"reason": f"open dispute {tag}", "reviewAgainOn": str(again)})
        d = obj(b)
        listed = [r["id"] for r in obj(owner.call("GET", R + "/LEADS")[1]).get("rows", [])]
        check("keep: the record leaves the queue; the decision keeps its reason, date, policy version and last activity",
              s == 200 and d.get("decision") == "KEEP" and d.get("reviewAgainOn") == str(again) and d.get("policyVersionId") == types["LEADS"]["policyVersionId"]
              and d.get("lastActivityOn") == str(today - timedelta(days=400)) and kept["id"] not in listed and old["id"] in listed, (s, d))

        # --- anonymize ----------------------------------------------------------------------------------------------
        s, b = owner.call("POST", f"{R}/LEADS/{filed['id']}/anonymize", {"reason": "period over"})
        check("anonymize: refused while documents are filed on the record (FILES_FILED); nothing changes",
              (s, err(b)[0]) == (422, "FILES_FILED") and fetch(LEAD, filed["id"], ["name"]).get("name") == f"{name} 4", (s, err(b)))
        s, b = owner.call("POST", f"{R}/CONTACTS/{contact['id']}/anonymize", {"reason": "period over"})
        s2, b2 = owner.call("POST", f"{R}/CONTACTS/{contact['id']}/keep", {"reason": f"active client contact {tag}", "reviewAgainOn": str(again)})
        check("anonymize: a shared partner record (contact) can only be kept (ANONYMIZE_NOT_AVAILABLE); keeping it works",
              (s, err(b)[0], s2) == (422, "ANONYMIZE_NOT_AVAILABLE", 200), (s, err(b), s2, b2))
        s, b = owner.call("POST", f"{R}/LEADS/{old['id']}/anonymize", {"reason": " "})
        check("anonymize: needs a reason", (s, err(b)[1:]) == (422, ("reason", "REQUIRED")), (s, err(b)))
        s, b = owner.call("POST", f"{R}/LEADS/{old['id']}/anonymize", {"reason": f"period over {tag}"})
        after = fetch(LEAD, old["id"], ["name", "firstName", "fullName", "mobilePhone", "fixedPhone", "description", "emailAddress.address"])
        texts = json.dumps([search(MESSAGE, f"self.relatedModel = '{LEAD}' AND self.relatedId = {old['id']}", ("body", "subject", "relatedName")),
                            search(MESSAGE, f"self.relatedModel = '{EVENT}' AND self.relatedId = {event['id']}", ("body", "subject", "relatedName")),
                            fetch(EVENT, event["id"], ["subject", "description"]),
                            search(OUTBOUND, f"self.lead.id = {old['id']}", ("subjectLine", "body")),
                            search(NOTICE, f"self.subject = 'LEAD' AND self.subjectId = {old['id']}", ("title",))], ensure_ascii=False)
        messages = search(MESSAGE, f"self.relatedModel = '{LEAD}' AND self.relatedId = {old['id']}")
        check("anonymize: the lead stays, with its name, phones, notes and e-mail overwritten",
              s == 200 and obj(b).get("decision") == "ANONYMIZED" and after.get("name") == "Anonymized" and after.get("firstName") is None
              and after.get("mobilePhone") is None and after.get("fixedPhone") is None and after.get("description") is None
              and str(after.get("emailAddress.address", "")).endswith("@invalid"), (s, b, after))
        check("anonymize: no copy of the name survives in its tracking messages, follow-ups, drafted messages or notices",
              name not in texts and f"ret1.{tag}" not in texts and len(messages) >= 1, texts[:240])
        listed = [r["id"] for r in obj(owner.call("GET", R + "/LEADS")[1]).get("rows", [])]
        s, b = owner.call("POST", f"{R}/LEADS/{old['id']}/anonymize", {"reason": "again"})
        check("anonymize: the record leaves the queue and cannot be decided again (NOT_DUE)",
              old["id"] not in listed and (s, err(b)[0]) == (422, "NOT_DUE"), (s, err(b)))
        s, b = owner.call("POST", f"{R}/CANDIDATES/{cand['id']}/anonymize", {"reason": f"period over {tag}"})
        c_after = fetch(CANDIDATE, cand["id"], ["displayName", "headline", "yearsExperience"])
        p_after = fetch(PRIVATE, private["id"], ["email", "phone", "cvReference"])
        check("anonymize: a candidate and its private profile are overwritten in place",
              s == 200 and c_after.get("displayName") == "Anonymized" and c_after.get("headline") is None
              and (p_after.get("email"), p_after.get("phone"), p_after.get("cvReference")) == (None, None, None), (s, c_after, p_after))

        # --- national IDs ----------------------------------------------------------------------------------------------
        s, b = owner.call("GET", R + "/NATIONAL_IDS")
        nat_rows = {r["id"]: r for r in obj(b).get("rows", [])}
        s2, b2 = owner.call("POST", f"{R}/NATIONAL_IDS/{ids_due[0]}/anonymize", {"reason": f"one year after the cohort {tag}"})
        left = search(NATID, f"self.id IN ({ids_due[0]}, {ids_recent[0]})")
        check("national IDs: due one period after the cohort ended without a certificate (a recent cohort is not); erasing removes the "
              "number and keeps the enrolment; nothing else is touched",
              s == 200 and ids_due[0] in nat_rows and ids_recent[0] not in nat_rows and s2 == 200
              and [x["id"] for x in left] == [ids_recent[0]] and fetch(ENROLLMENT, enrol["id"], ("id",)).get("id") == enrol["id"],
              (s, list(nat_rows), s2, left))

        # --- the decision log ---------------------------------------------------------------------------------------
        s, b = owner.call("GET", R + "/decisions")
        log = [d for d in (b.get("object") or b.get("data") or []) if f"{tag}" in (d.get("reason") or "")]
        kinds = sorted((d["dataType"], d["decision"]) for d in log)
        check("log: every decision is listed with its reason and who decided; no old name is in it",
              s == 200 and kinds == sorted([("LEADS", "KEEP"), ("CONTACTS", "KEEP"), ("LEADS", "ANONYMIZED"), ("CANDIDATES", "ANONYMIZED"), ("NATIONAL_IDS", "ANONYMIZED")])
              and all(d.get("decidedBy") == users["Owner"]["name"] for d in log) and name not in json.dumps(log, ensure_ascii=False), kinds)
        s, _ = other.call("GET", R + "/decisions")
        check("log: someone who is not a policy owner cannot read it (403)", s == 403, s)

        # --- unset -------------------------------------------------------------------------------------------------
        s, b = owner.call("POST", f"{P}/{KEY}/retire", {"scope": "LEADS", "reason": f"probe {tag}"})
        s2, b2 = owner.call("GET", R + "/LEADS")
        check("unset: retiring the period closes the queue again (POLICY_NOT_SET)", s == 200 and (s2, err(b2)[0]) == (422, "POLICY_NOT_SET"),
              (s, s2, err(b2)))
        created.extend((DECISION, d["id"]) for d in search(DECISION, f"self.decidedBy.id = {users['Owner']['id']}"))
        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
    finally:
        if users.get("Owner"):
            created.extend((DECISION, d["id"]) for d in search(DECISION, f"self.decidedBy.id = {users['Owner']['id']}"))
            # the policy changes and the owner's appointment are in the admin change log
            created.extend((AUDIT, a["id"]) for a in search(AUDIT, f"self.actor.id = {users['Owner']['id']} OR self.createdBy.id = {users['Owner']['id']}"))
        created.extend((VERSION, v["id"]) for v in search(VERSION, f"self.policyKey = '{KEY}'"))
        # the change-tracking messages Axelor wrote about the fixtures
        for model in (LEAD, EVENT, PARTNER, CANDIDATE):
            ids = [i for m, i in created if m == model]
            if ids:
                created.extend((MESSAGE, m["id"]) for m in search(MESSAGE, f"self.relatedModel = '{model}' AND self.relatedId IN ({','.join(map(str, ids))})"))
        order = {DECISION: 0, AUDIT: 0, VERSION: 1, MESSAGE: 1, NOTICE: 2, OUTBOUND: 2, DOC: 2, EVENT: 2, PRIVATE: 2, NATID: 2, ENROLLMENT: 3,
                 COHORT: 4, COURSE: 5, LEAD: 3, CANDIDATE: 3, PARTNER: 6, EMAIL: 4, USER: 7, GROUP: 8}
        complete, left = cleanup(admin, list(dict.fromkeys(created)), order)
        if not complete:
            print(f"FAIL cleanup left {left}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "retention-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
