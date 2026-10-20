#!/usr/bin/env python3
"""Wave 6 live probe: lead intake, duplicates, Arabic search, consent, attribution, saved views, follow-ups.

Run against a RUNNING local/CI Axelor; never against production. Roles are TEST FIXTURES built from
native permissions (policy D-07 defines the real ones): RepA and RepB see only the leads they own;
RepA may also attribute leads to marketing campaigns. Every name, e-mail and phone is fictional.
Checks:
  intake: invalid e-mail/phone → 422; the stored search key equals the SQL backfill of V012
  duplicates: same person spelled differently (hamza, teh marbuta, alef maksura, shadda, Arabic-Indic
  digits, upper-case e-mail) → 409 POSSIBLE_DUPLICATE, then recorded once confirmed; another
  salesperson's leads are never compared or revealed
  search: server-side, Arabic-normalized, filters; only readable leads
  saved views: owner only (others 404); duplicate name → 422
  consent: consent needs evidence, an opt-out does not; native do-not-email/call flags follow; history
  newest first; stale → 409; concurrent changes → one wins, the rest 409
  attribution: campaign write right required; once per campaign (409); concurrent attributions of
  different leads to one campaign are all kept
  follow-ups: native CRM events; overdue queue; done once (422 after); timeline merges activities
  and consent changes; routing → BLOCKED_BY_POLICY (D-12); isolation → 404
Env: PROBE_MKT_ROUNDS (default 6). Report: logs/marketing-probe.json.
"""
import datetime
import json
import os
import re
import secrets
import sys
import threading
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402
from db_migrate import DATABASE, psql  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
LEAD, EVENT, CAMPAIGN = "com.axelor.apps.crm.db.Lead", "com.axelor.apps.crm.db.Event", "com.axelor.apps.marketing.db.Campaign"
EMAIL_ADDRESS, SOURCE = "com.axelor.message.db.EmailAddress", "com.axelor.apps.base.db.Source"
LINE = "com.ioeti.businessline.db.BusinessLine"
P = "com.ioeti.marketing.db."
CONSENT, SAVED_VIEW = P + "LeadConsentEvent", P + "SavedLeadView"
MK = "/ws/ioeti/marketing"
ROUNDS = int(os.environ.get("PROBE_MKT_ROUNDS", "6"))
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


def obj(body):
    return (body.get("object") if isinstance(body, dict) else None) or {}


def rows(body):
    value = body.get("object") if isinstance(body, dict) else None
    return value if isinstance(value, list) else []


def backfill_key(lead_id):
    """The key V012's SQL backfill computes for one lead (the functions are taken from the migration)."""
    sql = open(os.path.join(ROOT, "db", "migrations", "V012__ioeti_marketing.sql"), encoding="utf-8").read()
    functions = re.search(r"CREATE FUNCTION pg_temp\.ioeti_norm.*?(?=\nUPDATE )", sql, re.S).group(0)
    select = re.search(r"UPDATE public\.crm_lead l SET ioeti_search_key = (left\(concat_ws.*?, 1000\))", sql, re.S).group(1)
    out = psql(DATABASE, functions + f"""
        SELECT {select} FROM public.crm_lead l LEFT JOIN public.message_email_address e ON e.id = l.email_address
         WHERE l.id = {int(lead_id)};""")
    return (out or "").strip().splitlines()[-1] if (out or "").strip() else ""


def main():
    admin = admin_client()
    tag = secrets.token_hex(3).upper()
    digits = str(secrets.randbelow(10 ** 8)).zfill(8)
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

    def fetch(model, rid, fields):
        _, body = admin.call("POST", f"/ws/rest/{model}/{rid}/fetch", {"fields": list(fields)})
        return (body.get("data") or [{}])[0]

    def version(model, rid):
        return fetch(model, rid, ["version"]).get("version")

    exit_code = 1
    try:
        # --- fictional fixtures (test only) -----------------------------------------------------------
        line = create(LINE, {"code": f"W6L{tag}", "nameEn": f"Wave6 ISO {tag}", "nameAr": "خط تجريبي", "statusSelect": 2})
        source = create(SOURCE, {"name": f"Wave6 exhibition {tag}"})
        campaign = create(CAMPAIGN, {"name": f"Wave6 campaign {tag}"})

        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"wave6.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})

        rwc = dict(canRead=True, canWrite=True, canCreate=True)
        rep = [perm("lead", LEAD, "self.user = ?", **rwc), perm("event", EVENT, "self.user = ?", **rwc),
               perm("line", LINE, canRead=True), perm("campaign", CAMPAIGN, canRead=True)]
        marketer = [perm("m.campaign", CAMPAIGN, canRead=True, canWrite=True)]
        groups = {}
        for key, perms in (("rep", rep), ("mkt", rep + marketer)):
            groups[key] = create(GROUP, {"code": f"wave6-{key}-{tag}", "name": f"Wave6 {key} {tag}",
                                         "permissions": [{"id": p["id"]} for p in perms]})
        users, sessions = {}, {}
        for label, group in (("RepA", "mkt"), ("RepB", "rep")):
            password = "W6!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"wave6.{label.lower()}.{tag}", "name": f"Wave6 {label}", "blocked": False,
                                         "language": "en", "group": {"id": groups[group]["id"]},
                                         "password": axelor_password_hash(password)})
            users[label]["_pw"] = password
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        a, b = sessions["RepA"], sessions["RepB"]
        racers_a = []  # separate sessions of RepA for the concurrency checks
        for _ in range(max(3, ROUNDS)):
            racers_a.append(Client())
            assert racers_a[-1].login(users["RepA"]["code"], users["RepA"]["_pw"]) == 200

        def intake(client, **values):
            s_, b_ = client.call("POST", f"{MK}/leads", values)
            if obj(b_).get("id"):
                created.append((LEAD, obj(b_)["id"]))
            return s_, b_, obj(b_)

        # --- 1. intake and the search key ---------------------------------------------------------------
        org = f"مؤسسة الهدى {tag}"
        person = dict(firstName="أحمد", name="عبد الله", organization=org, email=f"Ahmed.{tag}@Example.TEST",
                      phone=f"+20 10{digits[:4]} {digits[4:]}", businessLineCode=line["code"], sourceId=source["id"])
        s_bad_e, b_bad_e, _ = intake(a, **{**person, "email": "ahmed@example"})
        s_bad_p, b_bad_p, _ = intake(a, **{**person, "phone": "call me"})
        s1, b1, lead1 = intake(a, **person)
        key = (search(LEAD, f"self.id = {lead1.get('id', 0)}", ("ioetiSearchKey",)) or [{}])[0].get("ioetiSearchKey")
        check("intake: invalid e-mail and phone → 422 on the field; valid lead recorded with business line",
              (s_bad_e, (error(b_bad_e).get("fields") or [{}])[0].get("field"), s_bad_p,
               (error(b_bad_p).get("fields") or [{}])[0].get("field"), s1, lead1.get("businessLineCode"))
              == (422, "email", 422, "phone", 201, line["code"]), f"{s_bad_e} {s_bad_p} {s1} {b1}")
        check("search key: Arabic-normalized names, e-mail and phone; identical to the V012 SQL backfill",
              bool(key) and key.startswith("احمد | عبد الله | موسسه الهدي") and f"ahmed.{tag.lower()}@example.test" in key
              and key.endswith(f"0{digits}"[-9:]) and key == backfill_key(lead1["id"]), f"{key!r} vs {backfill_key(lead1.get('id', 0))!r}")

        # --- 2. duplicates ------------------------------------------------------------------------------
        variant = dict(firstName="احمد", name="عبد اللّه", organization=f"موسسه الهدي {tag}", businessLineCode=line["code"])
        s_dup_name, b_dup_name, _ = intake(a, **variant)
        s_dup_phone, _, _ = intake(a, name="Someone else", phone="٠١" + "".join("٠١٢٣٤٥٦٧٨٩"[int(d)] for d in "0" + digits))
        s_dup_mail, _, _ = intake(a, name="Third person", email=f"AHMED.{tag}@example.test")
        _, d_a = a.call("POST", f"{MK}/leads/duplicates", variant)
        _, d_b = b.call("POST", f"{MK}/leads/duplicates", {**person})
        s_b_new, _, lead_b = intake(b, **person)
        s_conf, _, lead2 = intake(a, **variant, confirmNotDuplicate=True)
        check("duplicates: name spelled differently, phone in Arabic-Indic digits and upper-case e-mail → 409 POSSIBLE_DUPLICATE",
              (s_dup_name, error(b_dup_name).get("code"), s_dup_phone, s_dup_mail) == (409, "POSSIBLE_DUPLICATE", 409, 409),
              f"{s_dup_name} {s_dup_phone} {s_dup_mail}")
        check("duplicates: listed for the owner; recorded once confirmed",
              [r["id"] for r in rows(d_a)] == [lead1.get("id")] and s_conf == 201, f"{rows(d_a)} {s_conf}")
        check("duplicates: another salesperson's leads are never compared or revealed (RepB sees none, may record)",
              rows(d_b) == [] and s_b_new == 201, f"{rows(d_b)} {s_b_new}")

        # --- 3. server-side search and filters ----------------------------------------------------------
        def leads(client, **query):
            _, body = client.call("GET", f"{MK}/leads?" + urllib.parse.urlencode(query))
            return [r["id"] for r in rows(body)]

        ids_a = {lead1.get("id"), lead2.get("id")}
        found_hamza = leads(a, q=f"أحمد {tag}")
        found_plain = leads(a, q=f"احمد الهدى {tag}")
        found_line = leads(a, businessLine=line["code"], q=tag)
        found_source = leads(a, sourceId=source["id"])
        found_b = leads(b, q=f"احمد {tag}")
        s_page, _ = a.call("GET", f"{MK}/leads?limit=500")
        check("search: Arabic-normalized words on the server, any spelling; filters by line and source; bad page → 400",
              set(found_hamza) == ids_a and set(found_plain) == ids_a and set(found_line) == ids_a
              and found_source == [lead1.get("id")] and s_page == 400,
              f"{found_hamza} {found_plain} {found_line} {found_source} {s_page}")
        check("search: only readable leads (RepB finds only its own)", found_b == [lead_b.get("id")], found_b)

        # --- 4. saved views ----------------------------------------------------------------------------
        view = {"name": f"Hot ISO {tag}", "searchText": "الهدى", "sourceId": source["id"], "businessLineCode": line["code"], "onlyMine": True}
        s_v, b_v = a.call("POST", f"{MK}/saved-views", view)
        if obj(b_v).get("id"):
            created.append((SAVED_VIEW, obj(b_v)["id"]))
        s_v2, b_v2 = a.call("POST", f"{MK}/saved-views", view)
        s_v3, _ = a.call("POST", f"{MK}/saved-views", {**view, "name": f"x {tag}", "sourceId": 987654321})
        _, list_a = a.call("GET", f"{MK}/saved-views")
        _, list_b = b.call("GET", f"{MK}/saved-views")
        s_del_b, _ = b.call("POST", f"{MK}/saved-views/{obj(b_v).get('id')}/delete")
        s_del_a, _ = a.call("POST", f"{MK}/saved-views/{obj(b_v).get('id')}/delete")
        if s_del_a == 200:
            created.remove((SAVED_VIEW, obj(b_v)["id"]))
        check("saved views: saved for the owner; same name → 422; unknown source → 422; others neither list nor delete them (404)",
              (s_v, s_v2, error(b_v2).get("code"), s_v3, s_del_b, s_del_a) == (201, 422, "VALIDATION_FAILED", 422, 404, 200)
              and [r["name"] for r in rows(list_a)] == [view["name"]] and rows(list_b) == [],
              f"{s_v} {s_v2} {b_v2} {s_v3} {s_del_b} {s_del_a} {rows(list_a)}")

        # --- 5. consent and opt-outs ---------------------------------------------------------------------
        lid = lead1["id"]

        def consent(client, rid, **values):
            return client.call("POST", f"{MK}/leads/{rid}/consents", {"version": version(LEAD, rid), **values})

        s_noev, b_noev = consent(a, lid, channel="EMAIL", allowed=True, method="WEB_FORM")
        s_out, _ = consent(a, lid, channel="EMAIL", allowed=False, method="EMAIL")
        flags_out = fetch(LEAD, lid, ["isDoNotSendEmail", "isDoNotCall"])
        s_in, _ = consent(a, lid, channel="EMAIL", allowed=True, method="WRITTEN", evidenceReference=f"Signed form {tag}")
        s_call, _ = consent(a, lid, channel="CALL", allowed=False, method="PHONE")
        flags_in = fetch(LEAD, lid, ["isDoNotSendEmail", "isDoNotCall"])
        s_stale, _ = a.call("POST", f"{MK}/leads/{lid}/consents",
                            {"version": version(LEAD, lid) - 1, "channel": "CALL", "allowed": False, "method": "PHONE"})
        s_sms, _ = consent(a, lid, channel="SMS", allowed=False, method="PHONE")
        _, state = a.call("GET", f"{MK}/leads/{lid}/consents")
        s_b_cons, b_b_cons = b.call("GET", f"{MK}/leads/{lid}/consents")
        s_b_rec, _ = consent(b, lid, channel="CALL", allowed=False, method="PHONE")
        history = obj(state).get("history") or []
        check("consent: needs an evidence reference (422); an opt-out does not; unknown channel → 422; stale → 409",
              (s_noev, (error(b_noev).get("fields") or [{}])[0].get("field"), s_out, s_in, s_call, s_sms, s_stale)
              == (422, "evidenceReference", 201, 201, 201, 422, 409), f"{s_noev} {s_out} {s_in} {s_call} {s_sms} {s_stale}")
        check("consent: native do-not-email / do-not-call flags follow the latest change",
              (flags_out.get("isDoNotSendEmail"), flags_in.get("isDoNotSendEmail"), flags_in.get("isDoNotCall")) == (True, False, True),
              f"{flags_out} {flags_in}")
        check("consent: history newest first with method, evidence and actor; current state per channel",
              [(h["channel"], h["allowed"]) for h in history] == [("CALL", False), ("EMAIL", True), ("EMAIL", False)]
              and history[1]["evidenceReference"] == f"Signed form {tag}" and history[1]["recordedBy"] == "Wave6 RepA"
              and obj(state).get("channels") == [{"channel": "EMAIL", "allowed": True}, {"channel": "CALL", "allowed": False}],
              f"{history} {obj(state).get('channels')}")
        check("consent: another salesperson can neither read nor change it (404)",
              (s_b_cons, s_b_rec) == (404, 404) and not obj(b_b_cons), f"{s_b_cons} {s_b_rec}")

        race_ok = True
        for _ in range(ROUNDS):
            start, codes = version(LEAD, lid), []
            barrier = threading.Barrier(3)

            def change(client, allowed):
                barrier.wait()
                codes.append(client.call("POST", f"{MK}/leads/{lid}/consents", {"version": start, "channel": "CALL", "allowed": allowed,
                                                                           "method": "PHONE", "evidenceReference": "race"})[0])
            threads = [threading.Thread(target=change, args=(racers_a[i], i % 2 == 0)) for i in range(3)]
            [t.start() for t in threads]
            [t.join() for t in threads]
            race_ok &= sorted(codes) == [201, 409, 409]
        events = int(psql(DATABASE, f"SELECT count(*) FROM ioeti_mkt_consent WHERE lead = {int(lid)}").strip())
        check(f"consent concurrency ({ROUNDS} rounds of 3 changes on one version): one wins, the rest 409; no lost history",
              race_ok and events == 3 + ROUNDS, f"{race_ok} {events}")

        # --- 6. attribution -----------------------------------------------------------------------------
        s_att, b_att = a.call("POST", f"{MK}/leads/{lid}/campaigns", {"version": version(LEAD, lid), "campaignId": campaign["id"]})
        s_att2, b_att2 = a.call("POST", f"{MK}/leads/{lid}/campaigns", {"version": version(LEAD, lid), "campaignId": campaign["id"]})
        s_att_b, _ = b.call("POST", f"{MK}/leads/{lead_b['id']}/campaigns", {"version": version(LEAD, lead_b["id"]), "campaignId": campaign["id"]})
        _, att = a.call("GET", f"{MK}/leads/{lid}/attribution")
        check("attribution: source and campaign shown; same campaign again → 409; without campaign write right → 403",
              (s_att, s_att2, error(b_att2).get("code"), s_att_b) == (200, 409, "ALREADY_ATTRIBUTED", 403)
              and obj(att).get("sourceId") == source["id"] and [c["id"] for c in obj(att).get("campaigns") or []] == [campaign["id"]],
              f"{s_att} {s_att2} {s_att_b} {obj(att)}")
        racers = []
        for i in range(ROUNDS):
            _, _, extra = intake(a, name=f"Wave6 racer {i} {tag}", confirmNotDuplicate=True)
            racers.append(extra["id"])
        codes, barrier = [], threading.Barrier(len(racers))

        def attribute(client, rid):
            v = version(LEAD, rid)
            barrier.wait()
            s_, b_ = client.call("POST", f"{MK}/leads/{rid}/campaigns", {"version": v, "campaignId": campaign["id"]})
            codes.append(s_)
            if s_ != 200:
                answers.append(error(b_).get("code"))
        answers = []
        threads = [threading.Thread(target=attribute, args=(racers_a[i], r)) for i, r in enumerate(racers)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        members = int(psql(DATABASE, f"SELECT count(*) FROM marketing_campaign_lead_set WHERE marketing_campaign = {int(campaign['id'])}").strip())
        check(f"attribution concurrency ({ROUNDS} leads at once to one campaign): every attribution kept",
              sorted(codes) == [200] * ROUNDS and members == ROUNDS + 1, f"{codes} {answers} {members}")
        s_int_c, _, lead_c = intake(a, name=f"Wave6 campaign intake {tag}", campaignId=campaign["id"], confirmNotDuplicate=True)
        _, att_c = a.call("GET", f"{MK}/leads/{lead_c.get('id')}/attribution")
        check("attribution: a campaign chosen at intake is recorded", s_int_c == 201
              and [c["id"] for c in obj(att_c).get("campaigns") or []] == [campaign["id"]], f"{s_int_c} {obj(att_c)}")

        # --- 7. follow-ups and timeline ------------------------------------------------------------------
        now = datetime.datetime.now().replace(microsecond=0)

        def plan(client, rid, **values):
            s_, b_ = client.call("POST", f"{MK}/leads/{rid}/follow-ups", {"version": version(LEAD, rid), **values})
            if obj(b_).get("id"):
                created.append((EVENT, obj(b_)["id"]))
            return s_, b_, obj(b_)

        s_f1, _, f1 = plan(a, lid, type="CALL", subject="Call back about ISO 9001", at=(now - datetime.timedelta(days=1)).isoformat())
        s_f2, _, f2 = plan(a, lid, type="MEETING", subject="Site visit", at=(now + datetime.timedelta(days=3)).isoformat())
        s_f_bad, _, _ = plan(a, lid, type="CALL", subject="x", at="tomorrow")
        s_f_type, _, _ = plan(a, lid, type="SMS", subject="x", at=now.isoformat())
        s_f_b, _, _ = plan(b, lid, type="CALL", subject="x", at=now.isoformat())
        _, overdue = a.call("GET", f"{MK}/follow-ups?overdue=true")
        _, queue = a.call("GET", f"{MK}/follow-ups")
        _, queue_b = b.call("GET", f"{MK}/follow-ups")
        check("follow-ups: native events planned; bad date or type → 422; on another's lead → 404",
              (s_f1, s_f2, s_f_bad, s_f_type, s_f_b) == (201, 201, 422, 422, 404) and f1.get("overdue") is True and f2.get("overdue") is False,
              f"{s_f1} {s_f2} {s_f_bad} {s_f_type} {s_f_b}")
        check("follow-up queue: the caller's planned follow-ups, oldest first; overdue filter; none of another's",
              [r["id"] for r in rows(overdue)] == [f1.get("id")] and [r["id"] for r in rows(queue)] == [f1.get("id"), f2.get("id")]
              and rows(queue_b) == [] and rows(queue)[0]["leadId"] == lid, f"{rows(overdue)} {rows(queue)} {rows(queue_b)}")
        s_done, b_done = a.call("POST", f"{MK}/follow-ups/{f1.get('id')}/done", {"version": f1.get("version")})
        s_done2, b_done2 = a.call("POST", f"{MK}/follow-ups/{f1.get('id')}/done", {"version": obj(b_done).get("version")})
        s_done_b, _ = b.call("POST", f"{MK}/follow-ups/{f2.get('id')}/done", {"version": f2.get("version")})
        _, overdue_after = a.call("GET", f"{MK}/follow-ups?overdue=true")
        check("follow-ups: done once (again → 422 FOLLOW_UP_STATE); another cannot close it (404); leaves the overdue queue",
              (s_done, obj(b_done).get("status"), s_done2, error(b_done2).get("code"), s_done_b) == (200, "DONE", 422, "FOLLOW_UP_STATE", 404)
              and rows(overdue_after) == [], f"{s_done} {s_done2} {s_done_b} {rows(overdue_after)}")
        _, tl = a.call("GET", f"{MK}/leads/{lid}/timeline")
        s_tl_b, _ = b.call("GET", f"{MK}/leads/{lid}/timeline")
        kinds = [t["kind"] for t in rows(tl)]
        stamps = [t["at"] for t in rows(tl)]
        check("timeline: activities and consent changes together, newest first; hidden from others (404)",
              kinds[0] == "ACTIVITY_MEETING" and "ACTIVITY_CALL" in kinds and "CONSENT_GIVEN" in kinds and "OPTED_OUT" in kinds
              and stamps == sorted(stamps, reverse=True) and s_tl_b == 404, f"{kinds} {s_tl_b}")

        # --- 8. policy blocks, unauthenticated -----------------------------------------------------------
        s_route, b_route = a.call("POST", f"{MK}/leads/{lid}/route")
        s_route_b, _ = b.call("POST", f"{MK}/leads/{lid}/route")
        s_anon, _ = Client().call("GET", f"{MK}/leads")
        check("routing and response targets → 422 BLOCKED_BY_POLICY (D-12); another's lead → 404; anonymous → 401",
              (s_route, error(b_route).get("code"), "D-12" in (error(b_route).get("message") or ""),
               s_route_b, s_anon) == (422, "BLOCKED_BY_POLICY", True, 404, 401), f"{s_route} {b_route} {s_route_b} {s_anon}")

        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
        print(f"\n{sum(r['result'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} checks passed")
    finally:
        lead_ids = [rid for model, rid in created if model == LEAD]
        email_ids = []
        if lead_ids:
            ids = ",".join(map(str, lead_ids))
            for model, domain in ((CONSENT, f"self.lead.id in ({ids})"), (EVENT, f"self.eventLead.id in ({ids})")):
                for row in search(model, domain):
                    if (model, row["id"]) not in created:
                        created.append((model, row["id"]))
            email_ids = [r["emailAddress"]["id"] for r in search(LEAD, f"self.id in ({ids})", ("emailAddress",)) if r.get("emailAddress")]
        for row_owner in search(USER, f"self.code like 'wave6.%.{tag.lower()}'"):
            owner = row_owner["id"]
            for row in search(SAVED_VIEW, f"self.owner.id = {owner}"):
                if (SAVED_VIEW, row["id"]) not in created:
                    created.append((SAVED_VIEW, row["id"]))
        created.extend((EMAIL_ADDRESS, e) for e in email_ids)
        order = {CONSENT: 0, EVENT: 0, SAVED_VIEW: 0, CAMPAIGN: 1, LEAD: 2, EMAIL_ADDRESS: 3, SOURCE: 4, LINE: 4,
                 USER: 10, GROUP: 11, PERM: 12}
        complete_, leftovers = cleanup(admin, created, order)
        if not complete_:
            print(f"FAIL cleanup left {leftovers}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "marketing-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete_}, f, indent=2)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
