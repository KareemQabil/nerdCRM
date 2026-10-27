#!/usr/bin/env python3
"""Campaigns from the platform: live probe against a RUNNING local/CI Axelor; never against production.
Roles are TEST FIXTURES from native permissions: two marketers who own their leads and opportunities and
may change campaigns, and a viewer who only reads campaigns. Every record is removed afterwards.
Checks:
  access: anonymous 401; a viewer reads the board but cannot add, change or move (403)
  adding: a draft owned by its author; name required, end before start, unknown type → 422; campaign types
  come from the admin lists and a type in use cannot be deleted
  stages: only the allowed moves (draft→planned→started⇄suspended→ended; planned→draft); ended is final;
  a stale version → 409; an unknown stage → 422
  results: attributed leads, conversions and opportunities counted only within the caller's read scope;
  another marketer's lead is not counted for the first and is not listed
  changing: rename with the version, clear the summary
Report: logs/campaign-probe.json.
"""
import json
import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
LEAD, OPP, PARTNER = "com.axelor.apps.crm.db.Lead", "com.axelor.apps.crm.db.Opportunity", "com.axelor.apps.base.db.Partner"
CAMPAIGN, CTYPE, LINE = "com.axelor.apps.marketing.db.Campaign", "com.axelor.apps.marketing.db.CampaignType", "com.ioeti.businessline.db.BusinessLine"
EMAIL_ADDRESS = "com.axelor.message.db.EmailAddress"
C = "/ws/ioeti/campaigns"
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

    def search(model, domain):
        _, body = admin.call("POST", f"/ws/rest/{model}/search", {"fields": ["id"], "limit": 500, "data": {"_domain": domain, "_archived": True}})
        return body.get("data") or []

    exit_code = 1
    try:
        line = create(LINE, {"code": f"CM{tag}", "nameEn": f"Campaign line {tag}", "nameAr": "خط الحملات", "statusSelect": 2})
        rwc = dict(canRead=True, canWrite=True, canCreate=True)

        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"camp.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})
        marketer = [perm("c", CAMPAIGN, **rwc), perm("lead", LEAD, "self.user = ?", **rwc), perm("opp", OPP, "self.user = ?", **rwc),
                    perm("partner", PARTNER, **rwc), perm("line", LINE, canRead=True)]
        viewer = [perm("v.c", CAMPAIGN, canRead=True)]
        groups = {"m": create(GROUP, {"code": f"camp-m-{tag}", "name": f"Camp marketer {tag}", "permissions": [{"id": p["id"]} for p in marketer]}),
                  "v": create(GROUP, {"code": f"camp-v-{tag}", "name": f"Camp viewer {tag}", "permissions": [{"id": p["id"]} for p in viewer]})}
        sessions = {}
        for label, group in (("A", "m"), ("B", "m"), ("V", "v")):
            password = "Cp!" + secrets.token_urlsafe(14)
            create(USER, {"code": f"camp.{label.lower()}.{tag}", "name": f"Campaign {label} {tag}", "blocked": False, "language": "ar",
                          "group": {"id": groups[group]["id"]}, "password": axelor_password_hash(password), "ioetiBusinessLines": [{"id": line["id"]}]})
            sessions[label] = Client()
            assert sessions[label].login(f"camp.{label.lower()}.{tag}", password) == 200, label
        a, b, v, anon = sessions["A"], sessions["B"], sessions["V"], Client()

        # --- types from the admin lists --------------------------------------------------------------
        s, body = admin.call("POST", "/ws/ioeti/admin/lists/campaign-types", {"name": f"معرض {tag}"})
        ctype = obj(body)
        if ctype.get("id"):
            created.append((CTYPE, ctype["id"]))
        types = rows(a.call("GET", C + "/types")[1])
        check("an administrator adds a campaign type in the admin lists; marketers are offered it", s == 201 and any(t["id"] == ctype.get("id") for t in types), (s, types))

        # --- adding ----------------------------------------------------------------------------------
        s, body = a.call("POST", C, {"name": f"معرض القاهرة للجودة {tag}", "typeId": ctype.get("id"), "startDate": "2026-11-01", "endDate": "2026-11-30",
                                     "summary": "حملة المعرض السنوي"})
        camp = obj(body)
        if camp.get("id"):
            created.append((CAMPAIGN, camp["id"]))
        check("a marketer adds a campaign: a draft owned by them, with type and period",
              s == 201 and camp.get("stage") == "DRAFT" and camp.get("ownerName") == f"Campaign A {tag}" and camp.get("type") == f"معرض {tag}"
              and camp.get("startDate") == "2026-11-01" and camp.get("leads") == 0, (s, camp))
        answers = [err(a.call("POST", C, body)[1])[1] for body in (
            {"name": " "}, {"name": f"x {tag}", "startDate": "2026-12-01", "endDate": "2026-11-01"}, {"name": f"y {tag}", "typeId": 999999999})]
        check("adding is validated: name required, end before start, unknown type (422)", answers == ["REQUIRED", "BEFORE_START", "UNAVAILABLE"], answers)
        s1, _ = anon.call("GET", C)
        s2, b2 = v.call("GET", C)
        s3, _ = v.call("POST", C, {"name": f"قراءة {tag}"})
        s4, _ = v.call("POST", f"{C}/{camp.get('id')}/stage", {"version": camp.get("version"), "stage": "PLANNED"})
        check("anonymous 401; a viewer reads the board but cannot add (403) or move (403)",
              (s1, s2, s3, s4) == (401, 200, 403, 403) and any(r["id"] == camp.get("id") for r in rows(b2)), (s1, s2, s3, s4))
        lt = next((r for r in rows(admin.call("GET", "/ws/ioeti/admin/lists/campaign-types")[1]) if r["id"] == ctype.get("id")), {})
        s, body = admin.call("POST", f"/ws/ioeti/admin/lists/campaign-types/{ctype.get('id')}/delete", {"version": lt.get("version")})
        check("the type now shows one use and cannot be deleted (409 IN_USE)", lt.get("uses") == 1 and (s, err(body)[0]) == (409, "IN_USE"), (lt, s, err(body)))

        # --- stages ----------------------------------------------------------------------------------
        s, body = a.call("POST", f"{C}/{camp.get('id')}/stage", {"version": camp.get("version"), "stage": "STARTED"})
        check("draft cannot jump to started (422 STAGE_NOT_ALLOWED)", (s, err(body)[0]) == (422, "STAGE_NOT_ALLOWED"), (s, err(body)))
        s, body = a.call("POST", f"{C}/{camp.get('id')}/stage", {"version": camp.get("version"), "stage": "PLANNED"})
        planned = obj(body)
        s_stale, _ = a.call("POST", f"{C}/{camp.get('id')}/stage", {"version": camp.get("version"), "stage": "DRAFT"})
        s_bad, b_bad = a.call("POST", f"{C}/{camp.get('id')}/stage", {"version": planned.get("version"), "stage": "LAUNCHED"})
        check("draft → planned; a stale version → 409; an unknown stage → 422", s == 200 and planned.get("stage") == "PLANNED" and s_stale == 409
              and (s_bad, err(b_bad)[1]) == (422, "UNAVAILABLE"), (s, planned.get("stage"), s_stale, s_bad))
        current, path = planned, []
        for stage in ("STARTED", "SUSPENDED", "STARTED", "ENDED"):
            s, body = a.call("POST", f"{C}/{camp.get('id')}/stage", {"version": current.get("version"), "stage": stage})
            current = obj(body) if s == 200 else current
            path.append((stage, s))
        s, body = a.call("POST", f"{C}/{camp.get('id')}/stage", {"version": current.get("version"), "stage": "STARTED"})
        check("planned → started ⇄ suspended → ended, and an ended campaign stays ended",
              all(code == 200 for _, code in path) and current.get("stage") == "ENDED" and (s, err(body)[0]) == (422, "STAGE_NOT_ALLOWED"), (path, s))

        # --- results within the read scope -----------------------------------------------------------
        def intake(client, name):
            s_, b_ = client.call("POST", "/ws/ioeti/marketing/leads", {"name": name, "businessLineCode": line["code"], "campaignId": camp["id"], "confirmNotDuplicate": True})
            assert s_ == 201, (s_, b_)
            created.append((LEAD, obj(b_)["id"]))
            return obj(b_)
        lead1 = intake(a, f"عميل حملة أول {tag}")
        intake(a, f"عميل حملة ثاني {tag}")
        lead_b = intake(b, f"عميل زميل {tag}")
        s, body = a.call("POST", f"/ws/ioeti/leads/{lead1['id']}/convert", {"version": lead1["version"], "opportunityName": f"فرصة الحملة {tag}", "businessLineCode": line["code"]})
        conv = obj(body)
        for key, model in (("accountId", PARTNER), ("opportunityId", OPP)):
            if conv.get(key):
                created.append((model, conv[key]))
        for contact in search(PARTNER, f"self.mainPartner.id = {conv.get('accountId') or 0}"):
            created.append((PARTNER, contact["id"]))
        s, body = a.call("GET", f"{C}/{camp.get('id')}")
        detail = obj(body)
        view = detail.get("campaign") or {}
        names = [l["name"] for l in detail.get("leads") or []]
        check("results for the first marketer: 2 attributed leads, 1 converted, 1 opportunity; the colleague's lead is neither counted nor listed",
              (view.get("leads"), view.get("converted"), view.get("opportunities")) == (2, 1, 1) and len(names) == 2
              and not any(str(lead_b["id"]) == str(l["id"]) for l in detail.get("leads") or []) and "عميل زميل" not in json.dumps(body, ensure_ascii=False),
              (view.get("leads"), view.get("converted"), view.get("opportunities"), names))
        s, body = b.call("GET", f"{C}/{camp.get('id')}")
        bv = obj(body).get("campaign") or {}
        check("the colleague sees only their own lead in the same campaign", (bv.get("leads"), bv.get("converted"), bv.get("opportunities")) == (1, 0, 0), bv)

        # --- changing --------------------------------------------------------------------------------
        current = obj(a.call("GET", f"{C}/{camp.get('id')}")[1]).get("campaign") or {}  # attribution moved the version
        s, body = a.call("POST", f"{C}/{camp.get('id')}", {"version": current.get("version"), "name": f"معرض القاهرة الدولي للجودة {tag}", "summary": ""})
        renamed = obj(body)
        s_stale, _ = a.call("POST", f"{C}/{camp.get('id')}", {"version": current.get("version"), "name": "قديم"})
        check("rename with the version and clear the summary; the old version → 409",
              s == 200 and renamed.get("name") == f"معرض القاهرة الدولي للجودة {tag}" and renamed.get("summary") is None and s_stale == 409, (s, renamed, s_stale))

        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
        print(f"\n{sum(r['result'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} checks passed")
    finally:
        lead_ids = [rid for m, rid in created if m == LEAD]
        partner_ids = [rid for m, rid in created if m == PARTNER]
        for model, ids in ((LEAD, lead_ids), (PARTNER, partner_ids)):
            if ids:
                _, found = admin.call("POST", f"/ws/rest/{model}/search", {"fields": ["emailAddress"], "limit": 500,
                                                                           "data": {"_domain": f"self.id in ({','.join(map(str, ids))})", "_archived": True}})
                created.extend((EMAIL_ADDRESS, r["emailAddress"]["id"]) for r in found.get("data") or [] if r.get("emailAddress"))
        contacts = {rid for rid in partner_ids if search(PARTNER, f"self.id = {rid} AND self.mainPartner IS NOT NULL")}
        for rid in set(partner_ids) - contacts:
            _, cur = admin.call("POST", f"/ws/rest/{PARTNER}/{rid}/fetch", {"fields": ["version"]})
            version = (cur.get("data") or [{}])[0].get("version")
            admin.call("POST", f"/ws/rest/{PARTNER}/{rid}", {"data": {"id": rid, "version": version, "contactPartnerSet": []}})
        order = {CAMPAIGN: 0, OPP: 1, LEAD: 2, PARTNER: 4, EMAIL_ADDRESS: 6, CTYPE: 7, USER: 10, GROUP: 11, PERM: 12, LINE: 13}
        phases = ([c for c in created if c[0] in (CAMPAIGN, OPP, LEAD)], [(PARTNER, r) for r in contacts],
                  [c for c in created if c[0] not in (CAMPAIGN, OPP, LEAD) and not (c[0] == PARTNER and c[1] in contacts)])
        outcomes = [cleanup(admin, phase, order) for phase in phases if phase]
        complete, left = all(o[0] for o in outcomes), [x for o in outcomes for x in o[1]]
        if not complete:
            print(f"FAIL cleanup left {left}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "campaign-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
