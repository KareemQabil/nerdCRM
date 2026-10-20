#!/usr/bin/env python3
"""Wave 7b live probe: in-app inbox and mentions, the held outbox, reports from authorized queries.

Run against a RUNNING local/CI Axelor; never against production. Roles are TEST FIXTURES built from
native permissions (policy D-07 defines the real ones): RepA and RepB own their leads and
opportunities, NoPipe reads leads but no opportunities. Every name, address and amount is fictional.
Checks:
  mentions: only on records the sender may read; the notice gives the recipient no access; self,
  blocked or unknown recipients and long texts → 422; inbox entries are private to their recipient
  outbox: drafts need write on the lead and an address; an opt-out blocks drafting and sending (checked
  again at send time); sending is BLOCKED_BY_POLICY (D-10) and nothing is queued in the native
  message table; cancel once; stale → 409; others → 404
  reports: pipeline counts and expected values are aggregated inside each caller's own scope, per
  currency and never added across currencies; areas the caller cannot read are left out (null), not 0;
  lead funnel, campaign attribution and the caller's follow-ups; bad ranges → 422; the system page is
  for administrators only and lists the 12 policy decisions
Report: logs/insights-probe.json.
"""
import json
import os
import secrets
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402
from db_migrate import DATABASE, psql  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
LEAD, OPP, EVENT = "com.axelor.apps.crm.db.Lead", "com.axelor.apps.crm.db.Opportunity", "com.axelor.apps.crm.db.Event"
OPP_STATUS, CURRENCY, PARTNER = "com.axelor.apps.crm.db.OpportunityStatus", "com.axelor.apps.base.db.Currency", "com.axelor.apps.base.db.Partner"
CAMPAIGN, SOURCE, LINE = "com.axelor.apps.marketing.db.Campaign", "com.axelor.apps.base.db.Source", "com.ioeti.businessline.db.BusinessLine"
EMAIL_ADDRESS, CONSENT = "com.axelor.message.db.EmailAddress", "com.ioeti.marketing.db.LeadConsentEvent"
NOTICE, OUTBOUND = "com.ioeti.automation.db.InboxNotice", "com.ioeti.automation.db.OutboundMessage"
AU, RP, MK = "/ws/ioeti/automation", "/ws/ioeti/reports", "/ws/ioeti/marketing"
RESULTS = []


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


def code(body):
    return error(body).get("code"), ((error(body).get("fields") or [{}])[0]).get("code")


def obj(body):
    return (body.get("object") if isinstance(body, dict) else None) or {}


def rows(body):
    value = body.get("object") if isinstance(body, dict) else None
    return value if isinstance(value, list) else []


def money(amounts):
    return {a["currency"]: round(float(a["amount"]), 2) for a in amounts}


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
                             {"fields": list(fields), "limit": 500, "data": {"_domain": domain, "_archived": True}})
        return body.get("data") or []

    def version(model, rid):
        _, body = admin.call("POST", f"/ws/rest/{model}/{rid}/fetch", {"fields": ["version"]})
        return (body.get("data") or [{}])[0].get("version")

    exit_code = 1
    try:
        # --- fictional fixtures (test only) -----------------------------------------------------------
        line = create(LINE, {"code": f"W7B{tag}", "nameEn": f"Wave7b ISO {tag}", "nameAr": "خط تجريبي", "statusSelect": 2})
        source = create(SOURCE, {"name": f"Wave7b fair {tag}"})
        campaign = create(CAMPAIGN, {"name": f"Wave7b campaign {tag}"})
        partner = create(PARTNER, {"name": f"Wave7b account {tag}", "isProspect": True, "partnerTypeSelect": 1})
        egp = search(CURRENCY, "self.codeISO = 'EGP'")[0]
        usd = search(CURRENCY, "self.codeISO = 'USD'")[0]
        stages = search(OPP_STATUS, "self.id > 0", ("name", "sequence"))
        stages.sort(key=lambda s: (s.get("sequence") or 0, s["id"]))
        s1, s2 = stages[0], stages[1]

        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"wave7b.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})
        rwc = dict(canRead=True, canWrite=True, canCreate=True)
        base = [perm("lead", LEAD, "self.user = ?", **rwc), perm("event", EVENT, "self.user = ?", **rwc), perm("line", LINE, canRead=True),
                perm("campaign", CAMPAIGN, canRead=True)]
        rep = base + [perm("opp", OPP, "self.user = ?", **rwc)]
        groups = {"rep": create(GROUP, {"code": f"wave7b-rep-{tag}", "name": f"Wave7b rep {tag}", "permissions": [{"id": p["id"]} for p in rep]}),
                  "nopipe": create(GROUP, {"code": f"wave7b-np-{tag}", "name": f"Wave7b nopipe {tag}", "permissions": [{"id": p["id"]} for p in base]})}
        users, sessions = {}, {}
        for label, group, blocked in (("RepA", "rep", False), ("RepB", "rep", False), ("NoPipe", "nopipe", False), ("Gone", "rep", True)):
            password = "W7b!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"wave7b.{label.lower()}.{tag}", "name": f"Wave7b {label} {tag}", "blocked": blocked,
                                         "language": "en", "group": {"id": groups[group]["id"]}, "password": axelor_password_hash(password)})
            if not blocked:
                sessions[label] = Client()
                assert sessions[label].login(users[label]["code"], password) == 200, label
        a, b, np = sessions["RepA"], sessions["RepB"], sessions["NoPipe"]

        def intake(client, **values):
            s_, b_ = client.call("POST", f"{MK}/leads", {"businessLineCode": line["code"], "sourceId": source["id"], "confirmNotDuplicate": True, **values})
            assert s_ == 201, f"lead fixture {s_} {b_}"
            created.append((LEAD, obj(b_)["id"]))
            return obj(b_)
        lead_a = intake(a, name=f"Wave7b Nour {tag}", email=f"nour.{tag.lower()}@example.test")
        lead_nomail = intake(a, name=f"Wave7b Mona {tag}")
        lead_b = intake(b, name=f"Wave7b Sara {tag}", email=f"sara.{tag.lower()}@example.test")

        def opportunity(owner, amount, currency, stage):
            return create(OPP, {"name": f"Wave7b {owner} {amount} {tag}", "user": {"id": users[owner]["id"]}, "partner": {"id": partner["id"]},
                                "ioetiBusinessLine": {"id": line["id"]}, "amount": str(amount), "currency": {"id": currency["id"]},
                                "opportunityStatus": {"id": stage["id"]}})
        opportunity("RepA", 1000, egp, s1)
        opportunity("RepA", 500, usd, s2)
        opportunity("RepB", 9999, egp, s1)

        # --- 1. mentions and the inbox ---------------------------------------------------------------
        s_m, _ = a.call("POST", f"{AU}/mentions", {"recipientId": users["RepB"]["id"], "subject": "LEAD", "subjectId": lead_a["id"],
                                                  "message": "Can you call them about the audit dates?"})
        _, inbox_b = b.call("GET", f"{AU}/inbox")
        _, count_b = b.call("GET", f"{AU}/inbox/count")
        note = next((n for n in rows(inbox_b) if n["kind"] == "MENTION"), {})
        s_open, _ = b.call("GET", f"/ws/ioeti/leads/{lead_a['id']}")
        check("mentions: delivered to the colleague's inbox with the sender and the link; the notice grants no access to the lead (404)",
              s_m == 201 and (note.get("subject"), note.get("subjectId"), note.get("actorName"), note.get("read")) == ("LEAD", lead_a["id"], users["RepA"]["name"], False)
              and obj(count_b).get("unread") == 1 and s_open == 404, f"{s_m} {rows(inbox_b)} {obj(count_b)} {s_open}")
        attempts = {
            "unreadable record": a.call("POST", f"{AU}/mentions", {"recipientId": users["RepB"]["id"], "subject": "LEAD", "subjectId": lead_b["id"], "message": "x"})[0],
            "self": code(a.call("POST", f"{AU}/mentions", {"recipientId": users["RepA"]["id"], "subject": "LEAD", "subjectId": lead_a["id"], "message": "x"})[1])[1],
            "blocked": code(a.call("POST", f"{AU}/mentions", {"recipientId": users["Gone"]["id"], "subject": "LEAD", "subjectId": lead_a["id"], "message": "x"})[1])[1],
            "too long": code(a.call("POST", f"{AU}/mentions", {"recipientId": users["RepB"]["id"], "subject": "LEAD", "subjectId": lead_a["id"], "message": "x" * 281})[1])[1],
            "anonymous": Client().call("GET", f"{AU}/inbox")[0],
        }
        check("mentions: unreadable record → 404; self, blocked recipient, over 280 characters → 422; anonymous → 401",
              attempts == {"unreadable record": 404, "self": "SELF", "blocked": "UNAVAILABLE", "too long": "TOO_LONG", "anonymous": 401}, attempts)
        s_steal, _ = a.call("POST", f"{AU}/inbox/{note.get('id')}/read")
        _, inbox_a = a.call("GET", f"{AU}/inbox")
        s_read, b_read = b.call("POST", f"{AU}/inbox/{note.get('id')}/read")
        _, count_after = b.call("GET", f"{AU}/inbox/count")
        _, all_read = b.call("POST", f"{AU}/inbox/read-all")
        check("inbox: private to its recipient (another user → 404, never listed); read once; read-all then marks nothing",
              s_steal == 404 and note.get("id") not in [n["id"] for n in rows(inbox_a)] and s_read == 200 and obj(b_read).get("read") is True
              and obj(count_after).get("unread") == 0 and obj(all_read).get("marked") == 0, f"{s_steal} {s_read} {obj(count_after)} {obj(all_read)}")
        _, short = a.call("GET", f"{AU}/people?q=W")
        _, people = a.call("GET", f"{AU}/people?q=Wave7b%20Re")
        names = [p["name"] for p in rows(people)]
        check("people: at least 2 characters; active colleagues only (not blocked users, not oneself)",
              rows(short) == [] and users["RepB"]["name"] in names and users["Gone"]["name"] not in names and users["RepA"]["name"] not in names, names)

        # --- 2. the held outbox ----------------------------------------------------------------------
        sent_before = int(psql(DATABASE, "SELECT count(*) FROM message_message").strip())
        s_d, b_d = a.call("POST", f"{AU}/outbox", {"leadId": lead_a["id"], "channel": "EMAIL", "subjectLine": "Audit dates", "body": "Dear Nour, ..."})
        draft = obj(b_d)
        if draft.get("id"):
            created.append((OUTBOUND, draft["id"]))
        s_send, b_send = a.call("POST", f"{AU}/outbox/{draft.get('id')}/send", {"version": draft.get("version")})
        s_nomail, b_nomail = a.call("POST", f"{AU}/outbox", {"leadId": lead_nomail["id"], "channel": "EMAIL", "subjectLine": "x", "body": "x"})
        s_wa, b_wa = a.call("POST", f"{AU}/outbox", {"leadId": lead_a["id"], "channel": "WHATSAPP", "subjectLine": "x", "body": "x"})
        check("outbox: a draft is kept (sending shown as blocked); sending → 422 BLOCKED_BY_POLICY (D-10); no address → 422; only e-mail exists",
              (s_d, draft.get("status"), draft.get("sendStatus"), s_send, error(b_send).get("code"), "D-10" in (error(b_send).get("message") or ""),
               s_nomail, error(b_nomail).get("code"), s_wa, code(b_wa)[1]) == (201, "DRAFT", "BLOCKED_BY_POLICY", 422, "BLOCKED_BY_POLICY", True, 422, "NO_ADDRESS", 422, "UNAVAILABLE"),
              f"{s_d} {draft} {s_send} {b_send} {s_nomail} {s_wa}")
        s_out, _ = a.call("POST", f"{MK}/leads/{lead_a['id']}/consents", {"version": version(LEAD, lead_a["id"]), "channel": "EMAIL", "allowed": False, "method": "EMAIL"})
        s_send2, b_send2 = a.call("POST", f"{AU}/outbox/{draft.get('id')}/send", {"version": draft.get("version")})
        s_d2, b_d2 = a.call("POST", f"{AU}/outbox", {"leadId": lead_a["id"], "channel": "EMAIL", "subjectLine": "Again", "body": "x"})
        check("outbox: after an opt-out, sending an existing draft → 422 OPTED_OUT (checked again) and new drafts are refused",
              (s_out, s_send2, error(b_send2).get("code"), s_d2, error(b_d2).get("code")) == (201, 422, "OPTED_OUT", 422, "OPTED_OUT"), f"{s_out} {s_send2} {s_d2}")
        s_b_list, _ = b.call("GET", f"{AU}/outbox?leadId={lead_a['id']}")
        s_b_cancel, _ = b.call("POST", f"{AU}/outbox/{draft.get('id')}/cancel", {"version": draft.get("version")})
        s_stale, _ = a.call("POST", f"{AU}/outbox/{draft.get('id')}/cancel", {"version": draft.get("version") - 1})
        s_c, b_c = a.call("POST", f"{AU}/outbox/{draft.get('id')}/cancel", {"version": draft.get("version")})
        s_c2, b_c2 = a.call("POST", f"{AU}/outbox/{draft.get('id')}/cancel", {"version": obj(b_c).get("version")})
        sent_after = int(psql(DATABASE, "SELECT count(*) FROM message_message").strip())
        check("outbox: others → 404; stale → 409; cancelled once (again → 422); nothing reached the native message queue",
              (s_b_list, s_b_cancel, s_stale, s_c, obj(b_c).get("status"), s_c2, error(b_c2).get("code")) == (404, 404, 409, 200, "CANCELLED", 422, "MESSAGE_STATE")
              and sent_after == sent_before, f"{s_b_list} {s_b_cancel} {s_stale} {s_c} {s_c2} {sent_before}->{sent_after}")

        # --- 3. reports inside each caller's scope -------------------------------------------------------
        admin.call("POST", f"{MK}/leads/{lead_a['id']}/campaigns", {"version": version(LEAD, lead_a["id"]), "campaignId": campaign["id"]})
        a.call("POST", f"{MK}/leads/{lead_nomail['id']}/follow-ups", {"version": version(LEAD, lead_nomail["id"]), "type": "CALL",
                                                                       "subject": "Call back", "at": (datetime.now() - timedelta(days=1)).replace(microsecond=0).isoformat()})

        def sales(client):
            s_, b_ = client.call("GET", f"{RP}/sales?businessLine={line['code']}")
            return s_, obj(b_)

        def stage_rows(report):
            return {(r["stage"]): (r["count"], money(r["amounts"])) for r in report.get("pipeline") or []}
        sa, ra = sales(a)
        sb, rb = sales(b)
        sx, rx = sales(admin)
        sn, rn = sales(np)
        check("pipeline: each salesperson's own figures; the administrator sees both; values stay per currency (EGP and USD never added)",
              (sa, sb, sx) == (200, 200, 200)
              and stage_rows(ra) == {s1["name"]: (1, {"EGP": 1000.0}), s2["name"]: (1, {"USD": 500.0})}
              and stage_rows(rb) == {s1["name"]: (1, {"EGP": 9999.0})}
              and stage_rows(rx) == {s1["name"]: (2, {"EGP": 10999.0}), s2["name"]: (1, {"USD": 500.0})}, f"{stage_rows(ra)} {stage_rows(rb)} {stage_rows(rx)}")
        check("an area the caller cannot read is left out (pipeline null), not shown as zero",
              sn == 200 and rn.get("pipeline") is None and rn.get("leads") is not None, f"{sn} {rn}")
        leads_a, leads_b = ra.get("leads") or {}, rb.get("leads") or {}
        camp_a = {c["id"]: c["leads"] for c in ra.get("campaigns") or []}
        camp_b = {c["id"]: c["leads"] for c in rb.get("campaigns") or []}
        check("lead funnel and campaigns counted only over readable leads; the caller's own follow-ups (one overdue)",
              (leads_a.get("total"), leads_a.get("open"), leads_b.get("total")) == (2, 2, 1)
              and [(r["source"], r["total"]) for r in leads_a.get("bySource") or []] == [(source["name"], 2)]
              and camp_a.get(campaign["id"]) == 1 and camp_b.get(campaign["id"]) == 0
              and (ra.get("followUps") or {}).get("overdue") == 1 and (rb.get("followUps") or {}).get("overdue") == 0,
              f"{leads_a} {leads_b} {camp_a} {camp_b} {ra.get('followUps')}")
        s_r1, b_r1 = a.call("GET", f"{RP}/sales?from=2026-05-01&to=2026-01-01")
        s_r2, b_r2 = a.call("GET", f"{RP}/sales?from=yesterday")
        tomorrow = (datetime.now() + timedelta(days=2)).date().isoformat()
        _, future = a.call("GET", f"{RP}/sales?from={tomorrow}&businessLine={line['code']}")
        check("date range: end before start → 422; bad date → 422; a range with no records gives empty results",
              (s_r1, code(b_r1)[1], s_r2, code(b_r2)[1]) == (422, "BEFORE_START", 422, "FORMAT")
              and obj(future).get("pipeline") == [] and (obj(future).get("leads") or {}).get("total") == 0, f"{s_r1} {s_r2} {obj(future)}")
        _, areas_a = a.call("GET", f"{RP}/areas")
        _, areas_x = admin.call("GET", f"{RP}/areas")
        keys_a = [r["key"] for r in obj(areas_a).get("areas") or []]
        keys_x = [r["key"] for r in obj(areas_x).get("areas") or []]
        check("areas: a salesperson without training, certification, recruitment, operations or fundraising rights sees none of them; the administrator sees all 8",
              keys_a == [] and len(keys_x) == 8, f"{keys_a} {keys_x}")
        s_sys_a, _ = a.call("GET", f"{RP}/system")
        s_sys, b_sys = admin.call("GET", f"{RP}/system")
        system = obj(b_sys)
        check("system page: administrators only (403 otherwise); lists the IOETI modules and the 12 policy decisions",
              s_sys_a == 403 and s_sys == 200 and {"ioeti-automation", "ioeti-reports", "ioeti-core"} <= set(system.get("modules") or [])
              and [p["id"] for p in system.get("policies") or []] == [f"D-{i:02d}" for i in range(1, 13)], f"{s_sys_a} {s_sys} {system.get('modules')}")
        s_anon, _ = Client().call("GET", f"{RP}/sales")
        check("reports: anonymous → 401", s_anon == 401, s_anon)

        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
        print(f"\n{sum(r['result'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} checks passed")
    finally:
        lead_ids = [rid for model, rid in created if model == LEAD]
        email_ids = []
        if lead_ids:
            ids = ",".join(map(str, lead_ids))
            for model, domain in ((OUTBOUND, f"self.lead.id in ({ids})"), (CONSENT, f"self.lead.id in ({ids})"), (EVENT, f"self.eventLead.id in ({ids})")):
                for row in search(model, domain):
                    if (model, row["id"]) not in created:
                        created.append((model, row["id"]))
            email_ids = [r["emailAddress"]["id"] for r in search(LEAD, f"self.id in ({ids})", ("emailAddress",)) if r.get("emailAddress")]
        user_ids = [rid for model, rid in created if model == USER]
        if user_ids:
            ids = ",".join(map(str, user_ids))
            for row in search(NOTICE, f"self.recipient.id in ({ids}) OR self.actor.id in ({ids})"):
                created.append((NOTICE, row["id"]))
        created.extend((EMAIL_ADDRESS, e) for e in email_ids)
        order = {NOTICE: 0, OUTBOUND: 0, CONSENT: 0, EVENT: 0, OPP: 1, CAMPAIGN: 1, LEAD: 2, EMAIL_ADDRESS: 3, PARTNER: 4, SOURCE: 4, LINE: 4,
                 USER: 10, GROUP: 11, PERM: 12}
        complete_, leftovers = cleanup(admin, created, order)
        if not complete_:
            print(f"FAIL cleanup left {leftovers}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "insights-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete_}, f, indent=2)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
