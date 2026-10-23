#!/usr/bin/env python3
"""Scenario S7 fixture: a fictional salesperson for the live browser test (apps/ioeti-web/tests/live.spec.ts).

Run against a RUNNING local/CI Axelor; never against production.
  setup <file>     creates a business line, a lead source, permissions, a group and an Arabic-speaking
                   user with a random password, and writes them to <file> (a scratch path, never committed)
  teardown <file>  removes everything the user and the browser test created under the fixture's tag
"""
import json
import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PARTNER, SOURCE, CAMPAIGN = "com.axelor.apps.base.db.Partner", "com.axelor.apps.base.db.Source", "com.axelor.apps.marketing.db.Campaign"
LEAD, EVENT, OPP = "com.axelor.apps.crm.db.Lead", "com.axelor.apps.crm.db.Event", "com.axelor.apps.crm.db.Opportunity"
EMAIL_ADDRESS, LINE = "com.axelor.message.db.EmailAddress", "com.ioeti.businessline.db.BusinessLine"
CONSENT, SAVED_VIEW = "com.ioeti.marketing.db.LeadConsentEvent", "com.ioeti.marketing.db.SavedLeadView"


def admin_client():
    client = Client()
    assert client.login(os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin")),
                        os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
    return client


def setup(path):
    admin = admin_client()
    tag = secrets.token_hex(3).upper()
    created = []

    def create(model, values):
        _, body = rest_create(admin, model, values)
        if not ok(body):
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}: {json.dumps(body)[:200]}")
        created.append([model, body["data"][0]["id"]])
        return body["data"][0]

    line = create(LINE, {"code": f"S7L{tag}", "nameEn": f"S7 ISO {tag}", "nameAr": f"أيزو تجريبي {tag}", "statusSelect": 2})
    source = create(SOURCE, {"name": f"S7 معرض {tag}"})

    def perm(name, model, condition=None, **rights):
        return create(PERM, {"name": f"s7.{name}.{tag}", "object": model, **rights,
                             **({"condition": condition, "conditionParams": "__user__"} if condition else {})})

    rwc = dict(canRead=True, canWrite=True, canCreate=True)
    perms = [perm("lead", LEAD, "self.user = ?", **rwc), perm("event", EVENT, "self.user = ?", **rwc),
             perm("opp", OPP, "self.user = ?", **rwc), perm("partner", PARTNER, **rwc), perm("line", LINE, canRead=True),
             perm("source", SOURCE, canRead=True), perm("campaign", CAMPAIGN, canRead=True)]
    group = create(GROUP, {"code": f"s7-rep-{tag}", "name": f"S7 rep {tag}", "permissions": [{"id": p["id"]} for p in perms]})
    password = "S7!" + secrets.token_urlsafe(14)
    user = create(USER, {"code": f"s7.rep.{tag.lower()}", "name": f"S7 مندوب {tag}", "blocked": False, "language": "ar",
                         "group": {"id": group["id"]}, "ioetiBusinessLines": [{"id": line["id"]}],
                         "password": axelor_password_hash(password)})
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"tag": tag, "user": user["code"], "userId": user["id"], "password": password, "lineCode": line["code"],
                   "lineNameAr": f"أيزو تجريبي {tag}", "sourceId": source["id"], "created": created}, f, ensure_ascii=False)
    os.chmod(path, 0o600)
    print(f"S7 fixture ready: tag {tag}")


def teardown(path):
    admin = admin_client()
    with open(path, encoding="utf-8") as f:
        fixture = json.load(f)
    tag, uid = fixture["tag"], fixture["userId"]
    created = [tuple(c) for c in fixture["created"]]

    def search(model, domain, fields=("id",)):
        _, body = admin.call("POST", f"/ws/rest/{model}/search",
                             {"fields": list(fields), "limit": 500, "data": {"_domain": domain, "_archived": True}})
        return body.get("data") or []

    leads = search(LEAD, f"self.user.id = {uid}", ("emailAddress",))
    lead_ids = ",".join(str(r["id"]) for r in leads) or "0"
    found = [(CONSENT, f"self.lead.id in ({lead_ids})"), (EVENT, f"self.user.id = {uid}"), (SAVED_VIEW, f"self.owner.id = {uid}"),
             (OPP, f"self.user.id = {uid}"), (LEAD, f"self.id in ({lead_ids})"),
             (PARTNER, f"self.name like '%{tag}%' OR self.createdBy.id = {uid}"), (EMAIL_ADDRESS, f"self.createdBy.id = {uid}")]
    for model, domain in found:
        created += [(model, r["id"]) for r in search(model, domain)]
    # a converted account and its contact reference each other
    for model, rid in created:
        if model == PARTNER:
            _, body = admin.call("POST", f"/ws/rest/{PARTNER}/{rid}/fetch", {"fields": ["contactPartnerSet", "mainPartner"]})
            row = (body.get("data") or [{}])[0] if ok(body) else {}
            if row.get("contactPartnerSet") or row.get("mainPartner"):
                admin.call("POST", f"/ws/rest/{PARTNER}/{rid}", {"data": {"id": rid, "version": row.get("version"),
                                                                          "contactPartnerSet": [], "mainPartner": None}})
    complete, leftovers = cleanup(admin, created, {CONSENT: 0, EVENT: 0, SAVED_VIEW: 0, OPP: 1, LEAD: 2, PARTNER: 3, EMAIL_ADDRESS: 4,
                                                   USER: 5, GROUP: 6, PERM: 7, LINE: 8, SOURCE: 8})
    os.remove(path)
    print("S7 fixture removed" if complete else f"FAIL cleanup left {leftovers}")
    return 0 if complete else 1


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("setup", "teardown"):
        raise SystemExit("usage: live_ui_fixture.py setup|teardown <file>")
    sys.exit(setup(sys.argv[2]) or 0 if sys.argv[1] == "setup" else teardown(sys.argv[2]))
