#!/usr/bin/env python3
"""Daily work (journeys plan, phase 2): live probe against a RUNNING local/CI Axelor; never against
production. Roles are TEST FIXTURES built from native permissions (D-07 defines the real ones): RepA and
RepB own their leads, opportunities and events and may change accounts; Viewer only reads. Every name,
address and amount is fictional and removed afterwards.
Checks:
  leads: edit own lead (search follows), stale → 409, another rep's lead → 404, read-only → 403, an e-mail
  of another lead → 409 POSSIBLE_DUPLICATE until confirmed, bad e-mail → 422, converted lead → 422
  accounts: add (contact details never returned), Arabic-variant duplicate → 409 until confirmed, similar
  list, edit with version, add a contact (listed, account version moves), read-only and anonymous refused,
  a contact person is not an account (404)
  opportunities: stages with kinds; move between open stages; won without the line's evidence setting → POLICY_NOT_SET (D-11); lost only by
  its command with a reason; moving a lost one → 422; reopen → default stage; plan amount/currency/date/
  probability with range checks; another rep → 404; read-only → 403; stale → 409
  activities: log done and planned activities on a lead, account and opportunity; time rules; the outcome
  text is never returned; another rep cannot read them; read-only cannot log
  agenda: the caller's planned items only, other reps' items excluded, range limit
  search: Arabic-normalised, only readable records, minimum length, anonymous refused
  menu: the session lists only the pages whose records the person may read
Report: logs/daily-work-probe.json.
"""
import json
import os
import secrets
import sys
from datetime import date, datetime, timedelta
from urllib.parse import quote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
LEAD, OPP, EVENT = "com.axelor.apps.crm.db.Lead", "com.axelor.apps.crm.db.Opportunity", "com.axelor.apps.crm.db.Event"
PARTNER, SOURCE, LINE = "com.axelor.apps.base.db.Partner", "com.axelor.apps.base.db.Source", "com.ioeti.businessline.db.BusinessLine"
EMAIL_ADDRESS, LOST_REASON = "com.axelor.message.db.EmailAddress", "com.axelor.apps.crm.db.LostReason"
MK, LD, AC, OP, WS = "/ws/ioeti/marketing", "/ws/ioeti/leads", "/ws/ioeti/accounts", "/ws/ioeti/opportunities", "/ws/ioeti/workspace"
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

    def version(model, rid):
        _, body = admin.call("POST", f"/ws/rest/{model}/{rid}/fetch", {"fields": ["version"]})
        return (body.get("data") or [{}])[0].get("version")

    exit_code = 1
    try:
        line = create(LINE, {"code": f"DW{tag}", "nameEn": f"Daily line {tag}", "nameAr": "خط يومي", "statusSelect": 2})
        source = create(SOURCE, {"name": f"Daily fair {tag}"})
        reason = create(LOST_REASON, {"name": f"Daily budget {tag}"})

        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"daily.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})
        rwc = dict(canRead=True, canWrite=True, canCreate=True)
        rep = [perm("lead", LEAD, "self.user = ?", **rwc), perm("event", EVENT, "self.user = ?", **rwc), perm("opp", OPP, "self.user = ?", **rwc),
               perm("partner", PARTNER, **rwc), perm("line", LINE, canRead=True), perm("source", SOURCE, canRead=True)]
        view = [perm("v.lead", LEAD, canRead=True), perm("v.event", EVENT, canRead=True), perm("v.opp", OPP, canRead=True),
                perm("v.partner", PARTNER, canRead=True), perm("v.line", LINE, canRead=True)]
        groups = {"rep": create(GROUP, {"code": f"daily-rep-{tag}", "name": f"Daily rep {tag}", "permissions": [{"id": p["id"]} for p in rep]}),
                  "view": create(GROUP, {"code": f"daily-view-{tag}", "name": f"Daily viewer {tag}", "permissions": [{"id": p["id"]} for p in view]})}
        sessions, users = {}, {}
        for label, group in (("RepA", "rep"), ("RepB", "rep"), ("Viewer", "view")):
            password = "Dw!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"daily.{label.lower()}.{tag}", "name": f"Daily {label} {tag}", "blocked": False, "language": "ar",
                                         "group": {"id": groups[group]["id"]}, "password": axelor_password_hash(password),
                                         "ioetiBusinessLines": [{"id": line["id"]}]})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        a, b, v, anon = sessions["RepA"], sessions["RepB"], sessions["Viewer"], Client()

        def intake(client, **values):
            s_, b_ = client.call("POST", f"{MK}/leads", {"businessLineCode": line["code"], "sourceId": source["id"], "confirmNotDuplicate": True, **values})
            assert s_ == 201, f"lead fixture {s_} {b_}"
            created.append((LEAD, obj(b_)["id"]))
            return obj(b_)
        lead_a = intake(a, name=f"أحمد اليومي {tag}", organization="مصنع الدلتا", email=f"ahmed.{tag.lower()}@example.test")
        lead_a2 = intake(a, name=f"منى اليومية {tag}", email=f"mona.{tag.lower()}@example.test")
        lead_b = intake(b, name=f"سارة اليومية {tag}")

        # --- leads -----------------------------------------------------------------------------------------
        s, body = a.call("POST", f"{MK}/leads/{lead_a['id']}", {"version": lead_a["version"], "name": f"احمد المعدل {tag}", "organization": "مصنع الدلتا للأغذية", "phone": "01001234567"})
        edited = obj(body)
        check("a rep edits their own lead", s == 200 and edited.get("organization") == "مصنع الدلتا للأغذية" and edited.get("version") > lead_a["version"], (s, edited))
        s, body = a.call("GET", f"{MK}/leads?q=" + quote("أحمد المعدل"))
        check("the Arabic-normalised search follows the edit (أ = ا)", any(r["id"] == lead_a["id"] for r in rows(body)), [r.get("name") for r in rows(body)])
        s, _ = a.call("POST", f"{MK}/leads/{lead_a['id']}", {"version": lead_a["version"], "name": "قديم"})
        check("a lead edit on a stale version → 409", s == 409, s)
        s, _ = b.call("POST", f"{MK}/leads/{lead_a['id']}", {"version": edited["version"], "name": "تسلل"})
        check("another rep cannot edit the lead (404, no existence oracle)", s == 404, s)
        s, _ = v.call("POST", f"{MK}/leads/{lead_a['id']}", {"version": edited["version"], "name": "قراءة"})
        check("a read-only person cannot edit the lead (403)", s == 403, s)
        s, body = a.call("POST", f"{MK}/leads/{lead_a2['id']}", {"version": lead_a2["version"], "email": f"ahmed.{tag.lower()}@example.test"})
        check("using another lead's e-mail → 409 POSSIBLE_DUPLICATE", s == 409 and err(body)[0] == "POSSIBLE_DUPLICATE", (s, err(body)))
        s, body = a.call("POST", f"{MK}/leads/{lead_a2['id']}", {"version": lead_a2["version"], "email": f"ahmed.{tag.lower()}@example.test", "confirmNotDuplicate": True})
        check("confirming saves it", s == 200, (s, err(body)))
        s, body = a.call("POST", f"{MK}/leads/{lead_a2['id']}", {"version": obj(body).get("version"), "email": "not-an-address"})
        check("a bad e-mail → 422 FORMAT", s == 422 and err(body)[1] == "FORMAT", (s, err(body)))

        # --- accounts --------------------------------------------------------------------------------------
        name = f"شركة الأمل للتجارة {tag}"
        s, body = a.call("POST", AC, {"name": name, "phone": "0223456789", "email": f"info.{tag.lower()}@example.test", "website": "https://amal.example"})
        account = obj(body)
        if account.get("id"):
            created.append((PARTNER, account["id"]))
        check("a rep adds an account directly: a prospect with a reference; contact details are not returned",
              s == 201 and account.get("prospect") is True and account.get("reference") and "info." not in json.dumps(body) and "phone" not in account, (s, account))
        variant = name.replace("الأمل", "الامل")
        s, body = a.call("POST", AC, {"name": variant})
        check("the same name with another Arabic spelling → 409 POSSIBLE_DUPLICATE", s == 409 and err(body)[0] == "POSSIBLE_DUPLICATE", (s, err(body)))
        s, body = a.call("POST", AC + "/similar", {"name": variant})
        check("the similar list shows the existing account", any(r["id"] == account.get("id") for r in rows(body)), rows(body))
        s, body = a.call("POST", AC, {"name": variant, "confirmNotDuplicate": True})
        if obj(body).get("id"):
            created.append((PARTNER, obj(body)["id"]))
        check("confirming adds the second account", s == 201, s)
        s, _ = a.call("POST", f"{AC}/{account.get('id')}", {"version": account.get("version", 0) - 1, "name": "قديم"})
        check("an account edit on a stale version → 409", s == 409, s)
        s, body = a.call("POST", f"{AC}/{account.get('id')}", {"version": account.get("version"), "name": name + " ش.م.م"})
        renamed = obj(body)
        check("a rep renames the account", s == 200 and renamed.get("name", "").endswith("ش.م.م"), (s, renamed))
        s, body = a.call("POST", f"{AC}/{account.get('id')}/contacts", {"version": renamed.get("version"), "firstName": "هدى", "name": f"سمير {tag}",
                                                                         "phone": "01112223334", "email": f"hoda.{tag.lower()}@example.test"})
        contact = obj(body)
        if contact.get("id"):
            created.append((PARTNER, contact["id"]))
        _, listed = a.call("GET", f"{AC}/{account.get('id')}/contacts")
        _, after = a.call("GET", f"{AC}/{account.get('id')}")
        check("a contact is added, listed on the account, and the account version moves",
              s == 201 and any(c["id"] == contact.get("id") for c in rows(listed)) and obj(after).get("version", 0) > renamed.get("version", 0)
              and "hoda." not in json.dumps(body), (s, contact, obj(after).get("version")))
        s1, _ = v.call("POST", AC, {"name": f"قراءة فقط {tag}", "confirmNotDuplicate": True})
        s2, _ = anon.call("POST", AC, {"name": f"مجهول {tag}"})
        check("a read-only person cannot add an account (403) and anonymous gets 401", (s1, s2) == (403, 401), (s1, s2))
        s, _ = a.call("POST", f"{AC}/{contact.get('id')}", {"version": 0, "name": "ليس حسابا"})
        check("a contact person is not an account (404)", s == 404, s)

        # --- opportunities ---------------------------------------------------------------------------------
        s, body = a.call("GET", OP + "/stages")
        stages = rows(body)
        kinds = {st["kind"] for st in stages}
        opens = [st for st in stages if st["kind"] == "OPEN"]
        won = next((st for st in stages if st["kind"] == "WON"), None)
        lost = next((st for st in stages if st["kind"] == "LOST"), None)
        check("stages come in order with their kinds (OPEN, WON, LOST)", s == 200 and {"OPEN", "WON", "LOST"} <= kinds and len(opens) >= 2, [(st["name"], st["kind"]) for st in stages])
        s, body = a.call("GET", OP + "/lost-reasons")
        s2, _ = anon.call("GET", OP + "/lost-reasons")
        check("lost reasons are offered to whoever reads opportunities (anonymous → 401)",
              s == 200 and any(r["id"] == reason["id"] for r in rows(body)) and s2 == 401, (s, s2))
        s, body = a.call("POST", OP, {"name": f"توريد أنظمة جودة {tag}", "businessLineCode": line["code"]})
        opp = obj(body)
        if opp.get("id"):
            created.append((OPP, opp["id"]))
        target = next((st for st in opens if st["id"] != opp.get("stageId")), opens[-1])
        s, body = a.call("POST", f"{OP}/{opp.get('id')}/stage", {"version": opp.get("version"), "stageId": target["id"]})
        moved = obj(body)
        check("a rep moves their opportunity to another open stage", s == 200 and moved.get("stageId") == target["id"] and moved.get("stageKind") == "OPEN", (s, moved))
        s, _ = a.call("POST", f"{OP}/{opp.get('id')}/stage", {"version": opp.get("version"), "stageId": opens[0]["id"]})
        check("a stage move on a stale version → 409", s == 409, s)
        s, body = a.call("POST", f"{OP}/{opp.get('id')}/stage", {"version": moved.get("version"), "stageId": won["id"] if won else 0})
        check("moving to won without the business line's evidence setting → 422 POLICY_NOT_SET (D-11, fail closed; commitment_probe covers the evidence)",
              s == 422 and err(body)[0] == "POLICY_NOT_SET", (s, err(body)))
        s, body = a.call("POST", f"{OP}/{opp.get('id')}/stage", {"version": moved.get("version"), "stageId": lost["id"] if lost else 0})
        check("moving to lost by drag → 422 USE_LOSE (losing needs a reason)", s == 422 and err(body)[0] == "USE_LOSE", (s, err(body)))
        s, body = a.call("POST", f"{OP}/{opp.get('id')}/lose", {"version": moved.get("version")})
        check("losing without a reason → 422", s == 422 and err(body)[1] == "REQUIRED", (s, err(body)))
        s, body = a.call("POST", f"{OP}/{opp.get('id')}/lose", {"version": moved.get("version"), "lostReasonId": reason["id"], "note": "اختاروا مورد آخر"})
        lost_view = obj(body)
        check("losing with a reason → LOST with the reason name", s == 200 and lost_view.get("stageKind") == "LOST" and lost_view.get("lostReason") == reason.get("name")
              and "مورد آخر" not in json.dumps(body), (s, lost_view))
        s, body = a.call("POST", f"{OP}/{opp.get('id')}/stage", {"version": lost_view.get("version"), "stageId": opens[0]["id"]})
        check("a lost opportunity cannot be moved before it is reopened", s == 422 and err(body)[0] == "STAGE_CLOSED", (s, err(body)))
        s, body = a.call("POST", f"{OP}/{opp.get('id')}/reopen", {"version": lost_view.get("version")})
        reopened = obj(body)
        check("reopen → OPEN at the default stage, reason cleared", s == 200 and reopened.get("stageKind") == "OPEN" and reopened.get("lostReason") is None, (s, reopened))
        bad = [({"amount": -1}, "RANGE"), ({"amount": 10.123}, "RANGE"), ({"currencyCode": "QQQ"}, "UNKNOWN"), ({"probability": 120}, "RANGE"),
               ({"expectedCloseDate": "31/12/2026"}, "FORMAT")]
        bad_codes = [err(a.call("POST", f"{OP}/{opp.get('id')}/plan", {"version": reopened.get("version"), **values})[1])[1] for values, _ in bad]
        check("plan values are range-checked (422 with the field)", bad_codes == [code for _, code in bad], bad_codes)
        close = (date.today() + timedelta(days=45)).isoformat()
        s, body = a.call("POST", f"{OP}/{opp.get('id')}/plan", {"version": reopened.get("version"), "amount": 150000.5, "currencyCode": "egp",
                                                               "expectedCloseDate": close, "probability": 40})
        planned = obj(body)
        check("a rep sets amount, currency, expected close date and probability", s == 200 and float(planned.get("amount") or 0) == 150000.5
              and planned.get("currencyCode") == "EGP" and planned.get("expectedCloseDate") == close and float(planned.get("probability") or 0) == 40, (s, planned))
        s1, _ = b.call("POST", f"{OP}/{opp.get('id')}/stage", {"version": planned.get("version"), "stageId": opens[0]["id"]})
        s2, _ = v.call("POST", f"{OP}/{opp.get('id')}/plan", {"version": planned.get("version"), "amount": 1})
        check("another rep → 404 and a read-only person → 403 on the opportunity", (s1, s2) == (404, 403), (s1, s2))

        # --- activities ------------------------------------------------------------------------------------
        lead_now = obj(a.call("GET", f"{LD}/{lead_a['id']}")[1])
        s, body = a.call("POST", WS + "/activities", {"record": "LEAD", "recordId": lead_a["id"], "version": lead_now.get("version"), "kind": "CALL",
                                                      "subject": "مكالمة تعريفية", "outcome": "طلب عرض سعر لنظام 22000", "at": (datetime.now() - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M")})
        logged = obj(body)
        if logged.get("id"):
            created.append((EVENT, logged["id"]))
        lead_after = obj(a.call("GET", f"{LD}/{lead_a['id']}")[1])
        check("a rep logs a call that happened on their lead (DONE); the lead version moves",
              s == 201 and logged.get("status") == "DONE" and logged.get("kind") == "CALL" and lead_after.get("version", 0) > lead_now.get("version", 0), (s, logged))
        future = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M")
        past = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M")
        s1, b1 = a.call("POST", WS + "/activities", {"record": "LEAD", "recordId": lead_a["id"], "version": lead_after.get("version"), "kind": "CALL", "subject": "x", "at": future})
        s2, b2 = a.call("POST", WS + "/activities", {"record": "LEAD", "recordId": lead_a["id"], "version": lead_after.get("version"), "kind": "CALL", "subject": "x", "at": past, "planned": True})
        s3, b3 = a.call("POST", WS + "/activities", {"record": "LEAD", "recordId": lead_a["id"], "version": lead_after.get("version"), "kind": "FAX", "subject": "x"})
        check("time rules: a done activity is not in the future, a planned one not in the past; unknown kind → 422",
              (s1, err(b1)[1], s2, err(b2)[1], s3, err(b3)[1]) == (422, "FUTURE", 422, "PAST", 422, "UNAVAILABLE"), (s1, err(b1), s2, err(b2), s3, err(b3)))
        # times are wall-clock times: "already happened" is judged on the caller's own clock (browser zone)
        from zoneinfo import ZoneInfo
        far_east = datetime.now(ZoneInfo("Pacific/Kiritimati")).strftime("%Y-%m-%dT%H:%M")
        lead_now2 = obj(a.call("GET", f"{LD}/{lead_a['id']}")[1])
        s1, b1 = a.call("POST", WS + "/activities", {"record": "LEAD", "recordId": lead_a["id"], "version": lead_now2.get("version"), "kind": "NOTE",
                                                     "subject": "x", "at": far_east})
        s2, b2 = a.call("POST", WS + "/activities", {"record": "LEAD", "recordId": lead_a["id"], "version": lead_now2.get("version"), "kind": "NOTE",
                                                     "subject": "ملاحظة من منطقة زمنية أخرى", "at": far_east, "zone": "Pacific/Kiritimati"})
        if obj(b2).get("id"):
            created.append((EVENT, obj(b2)["id"]))
        lead_now2 = obj(a.call("GET", f"{LD}/{lead_a['id']}")[1])
        s3, b3 = a.call("POST", WS + "/activities", {"record": "LEAD", "recordId": lead_a["id"], "version": lead_now2.get("version"), "kind": "NOTE",
                                                     "subject": "x", "zone": "Mars/Olympus"})
        check("the caller's time zone decides what already happened (UTC+14 now: FUTURE without the zone, accepted with it; unknown zone → 422)",
              (s1, err(b1)[1], s2, s3, err(b3)[1]) == (422, "FUTURE", 201, 422, "UNKNOWN"), (s1, err(b1), s2, s3, err(b3)))
        opp_now = obj(a.call("GET", f"{OP}/{opp.get('id')}")[1])
        s, body = a.call("POST", WS + "/activities", {"record": "OPPORTUNITY", "recordId": opp.get("id"), "version": opp_now.get("version"), "kind": "MEETING",
                                                      "subject": "اجتماع مراجعة العرض", "at": future, "planned": True})
        planned_meeting = obj(body)
        if planned_meeting.get("id"):
            created.append((EVENT, planned_meeting["id"]))
        check("a rep plans a meeting on their opportunity (PLANNED)", s == 201 and planned_meeting.get("status") == "PLANNED", (s, planned_meeting))
        acc_now = obj(a.call("GET", f"{AC}/{account.get('id')}")[1])
        s, body = a.call("POST", WS + "/activities", {"record": "ACCOUNT", "recordId": account.get("id"), "version": acc_now.get("version"), "kind": "NOTE",
                                                      "subject": "ملاحظة عن الحساب", "outcome": "يفضلون التواصل صباحًا"})
        if obj(body).get("id"):
            created.append((EVENT, obj(body)["id"]))
        check("a rep adds a note on an account", s == 201 and obj(body).get("kind") == "NOTE", (s, obj(body)))
        s, body = a.call("GET", f"{WS}/activities?record=LEAD&recordId={lead_a['id']}")
        check("the lead's activities list the call; the outcome text is never returned",
              s == 200 and any(r["id"] == logged.get("id") and r.get("outcomeRecorded") is True for r in rows(body)) and "عرض سعر لنظام" not in json.dumps(body), (s, rows(body)))
        s1, _ = b.call("GET", f"{WS}/activities?record=LEAD&recordId={lead_a['id']}")
        s2, _ = v.call("POST", WS + "/activities", {"record": "LEAD", "recordId": lead_a["id"], "version": lead_after.get("version"), "kind": "CALL", "subject": "x"})
        check("another rep cannot read them (404) and a read-only person cannot log (403)", (s1, s2) == (404, 403), (s1, s2))

        # --- agenda ----------------------------------------------------------------------------------------
        b_lead = obj(b.call("GET", f"{LD}/{lead_b['id']}")[1])
        s, body = b.call("POST", WS + "/activities", {"record": "LEAD", "recordId": lead_b["id"], "version": b_lead.get("version"), "kind": "CALL",
                                                      "subject": "مكالمة لسارة", "at": future, "planned": True})
        if obj(body).get("id"):
            created.append((EVENT, obj(body)["id"]))
        s, body = a.call("GET", f"{WS}/agenda?from={date.today().isoformat()}&to={(date.today() + timedelta(days=7)).isoformat()}")
        items = rows(body)
        check("the agenda has the caller's planned meeting, linked to the opportunity, and not another rep's call",
              s == 200 and any(i["id"] == planned_meeting.get("id") and i["recordType"] == "OPPORTUNITY" and i["recordId"] == opp.get("id") for i in items)
              and not any(i.get("title") == "مكالمة لسارة" for i in items), [(i["type"], i.get("title")) for i in items])
        s, _ = a.call("GET", f"{WS}/agenda?from=2026-01-01&to=2026-06-30")
        check("an agenda range over 62 days → 400", s == 400, s)

        # --- the menu: the session lists the pages whose records the person may read ----------------------
        _, me_a = a.call("GET", "/ws/ioeti/session")
        _, me_v = v.call("GET", "/ws/ioeti/session")
        pages_a, pages_v = set(me_a.get("pages") or []), set(me_v.get("pages") or [])
        check("the session lists the pages a person may read: a rep gets leads, accounts and opportunities but not certification or recruitment",
              {"leads", "accounts", "opportunities"} <= pages_a and not pages_a & {"certification", "recruitment", "fundraising", "finance"}
              and {"leads", "accounts", "opportunities"} <= pages_v and me_a.get("administrator") is False, (sorted(pages_a), sorted(pages_v)))

        # --- search ----------------------------------------------------------------------------------------
        s, body = a.call("GET", f"{WS}/search?q=" + quote("احمد المعدل"))
        hits = rows(body)
        check("search finds the rep's lead with another Arabic spelling", s == 200 and any(h["type"] == "LEAD" and h["id"] == lead_a["id"] for h in hits), hits)
        s, body = a.call("GET", f"{WS}/search?q=" + quote("الامل للتجارة"))
        check("search finds the account by name", any(h["type"] == "ACCOUNT" and h["id"] == account.get("id") for h in rows(body)), rows(body))
        s, body = b.call("GET", f"{WS}/search?q=" + quote("احمد المعدل"))
        check("another rep's search does not reveal the lead", not any(h["type"] == "LEAD" and h["id"] == lead_a["id"] for h in rows(body)), rows(body))
        s1, b1 = a.call("GET", f"{WS}/search?q=a")
        s2, _ = anon.call("GET", f"{WS}/search?q=" + quote("احمد"))
        check("search needs two characters (422) and a session (401)", (s1, err(b1)[1], s2) == (422, "TOO_SHORT", 401), (s1, err(b1), s2))

        # --- converted lead stays as it was ------------------------------------------------------------
        lead_now = obj(a.call("GET", f"{LD}/{lead_a2['id']}")[1])
        s_cv, b_cv = a.call("POST", f"{LD}/{lead_a2['id']}/convert", {"version": lead_now.get("version"), "opportunityName": f"فرصة منى {tag}", "businessLineCode": line["code"]})
        conv = obj(b_cv)
        for key, model in (("accountId", PARTNER), ("opportunityId", OPP)):
            if conv.get(key):
                created.append((model, conv[key]))
        for c in search(PARTNER, f"self.mainPartner.id = {conv.get('accountId') or 0}"):
            created.append((PARTNER, c["id"]))
        lead_now = obj(a.call("GET", f"{LD}/{lead_a2['id']}")[1])
        s, body = a.call("POST", f"{MK}/leads/{lead_a2['id']}", {"version": lead_now.get("version"), "name": "تعديل بعد التحويل"})
        check("a converted lead cannot be edited (422 LEAD_CONVERTED)", s_cv in (200, 201) and s == 422 and err(body)[0] == "LEAD_CONVERTED", (s_cv, s, err(body)))

        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
        print(f"\n{sum(r['result'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} checks passed")
    finally:
        lead_ids = [rid for model, rid in created if model == LEAD]
        partner_ids = [rid for model, rid in created if model == PARTNER]
        opp_ids = [rid for model, rid in created if model == OPP]
        for model, ids, field in ((EVENT, lead_ids, "eventLead"), (EVENT, partner_ids, "partner"), (EVENT, opp_ids, "opportunity")):
            if ids:
                for row in search(model, f"self.{field}.id in ({','.join(map(str, ids))})"):
                    if (model, row["id"]) not in created:
                        created.append((model, row["id"]))
        email_ids = []
        for model, ids in ((LEAD, lead_ids), (PARTNER, partner_ids)):
            if ids:
                email_ids += [r["emailAddress"]["id"] for r in search(model, f"self.id in ({','.join(map(str, ids))})", ("emailAddress",)) if r.get("emailAddress")]
        created.extend((EMAIL_ADDRESS, e) for e in email_ids)
        # records first, then contacts (they point at their account), then accounts and the rest
        contacts = {rid for rid in partner_ids if search(PARTNER, f"self.id = {rid} AND self.mainPartner IS NOT NULL")}
        for rid in set(partner_ids) - contacts:  # the account's contact list holds its contacts
            admin.call("POST", f"/ws/rest/{PARTNER}/{rid}", {"data": {"id": rid, "version": version(PARTNER, rid), "contactPartnerSet": []}})
        order = {EVENT: 0, OPP: 1, LEAD: 2, PARTNER: 4, EMAIL_ADDRESS: 6, SOURCE: 7, LOST_REASON: 7, USER: 10, GROUP: 11, PERM: 12, LINE: 13}
        phases = ([c for c in created if c[0] in (EVENT, OPP, LEAD)], [(PARTNER, r) for r in contacts],
                  [c for c in created if c[0] not in (EVENT, OPP, LEAD) and not (c[0] == PARTNER and c[1] in contacts)])
        outcomes = [cleanup(admin, phase, order) for phase in phases if phase]
        complete_a, left_a = all(o[0] for o in outcomes), [x for o in outcomes for x in o[1]]
        complete_b, left_b = True, []
        if not (complete_a and complete_b):
            print(f"FAIL cleanup left {left_a + left_b}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "daily-work-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete_a and complete_b}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
