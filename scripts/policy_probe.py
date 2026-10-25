#!/usr/bin/env python3
"""Business-rule policies (owner decisions D-01..D-12, 2026-10-25): live probe against a RUNNING local/CI Axelor;
never against production. Roles are TEST FIXTURES: two people who become policy owners and one ordinary user; the
real administrator appoints the first owner. Every record is removed afterwards (policy versions, change-log rows,
the policy-owner role when the probe created it).
Checks:
  access: anonymous 401; an ordinary user cannot read policies (403); an administrator reads every policy, none set
  separation: an administrator who is not a policy owner cannot change a policy (403) but may appoint the first
  owner; once there is one, only owners appoint others
  values: checked against the definition (range, required fields, between-field rules), with a reason, never in the
  past; a scoped policy needs its scope
  dates: a value applies from its date; a change scheduled for tomorrow shows as the next value; history keeps
  who, when and why; the admin change log has every change
  unset: a retired value stops being in force; the last policy owner cannot be removed
Report: logs/policy-probe.json.
"""
import json
import os
import secrets
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

USER, GROUP, ROLE = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Role"
VERSION, AUDIT = "com.ioeti.core.db.PolicyVersion", "com.ioeti.admin.db.AdminAuditEvent"
P = "/ws/ioeti/policies"
OWNER_ROLE = "ioeti-policy-owner"
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
    return e.get("code"), ((e.get("fields") or [{}])[0]).get("field"), ((e.get("fields") or [{}])[0]).get("code")


def main():
    admin = Client()
    login = os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin"))
    assert admin.login(login, os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
    tag = secrets.token_hex(3).upper()
    created = []

    def create(model, values):
        _, body = rest_create(admin, model, values)
        if not ok(body):
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}: {json.dumps(body)[:200]}")
        created.append((model, body["data"][0]["id"]))
        return body["data"][0]

    def search(model, domain, fields=("id",), limit=500):
        _, body = admin.call("POST", f"/ws/rest/{model}/search", {"fields": list(fields), "limit": limit, "data": {"_domain": domain}})
        return body.get("data") or []

    role_before = search(ROLE, f"self.name = '{OWNER_ROLE}'")
    owners_before = search(USER, f"EXISTS (SELECT r FROM Role r WHERE r.name = '{OWNER_ROLE}' AND r MEMBER OF self.roles)")
    if owners_before:
        raise SystemExit("this database already has policy owners; run the probe on a disposable database")
    exit_code = 1
    users = {}
    try:
        group = create(GROUP, {"code": f"policy-u-{tag}", "name": f"Policy users {tag}"})
        sessions = {}
        for label in ("P1", "P2", "U"):
            password = "Pl!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"policy.{label.lower()}.{tag}", "name": f"Policy {label} {tag}", "blocked": False, "language": "ar",
                                         "group": {"id": group["id"]}, "password": axelor_password_hash(password)})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        p1, p2, u, anon = sessions["P1"], sessions["P2"], sessions["U"], Client()
        today, tomorrow = date.today(), date.today() + timedelta(days=1)

        # --- access ----------------------------------------------------------------------------------------
        s1, _ = anon.call("GET", P)
        s2, _ = u.call("GET", P)
        s3, b3 = admin.call("GET", P)
        overview = obj(b3)
        keys = [x["key"] for x in overview.get("policies", [])]
        check("anonymous 401; an ordinary user cannot read policies (403); an administrator reads every decided policy, none in force",
              (s1, s2, s3) == (401, 403, 200) and {"finance.tax", "sales.quote-approval", "sales.won-evidence", "cert.decision", "leads.routing"} <= set(keys)
              and all(x["inForce"] == 0 for x in overview["policies"]) and overview.get("noOwners") is True and overview.get("canEdit") is False,
              (s1, s2, s3, len(keys), overview.get("noOwners")))

        # --- separation of duties --------------------------------------------------------------------------
        tax = {"value": {"ratePercent": 14, "name": "VAT"}, "reason": "probe: rate given by the owner"}
        s_admin, _ = admin.call("POST", P + "/finance.tax", tax)
        s_u, _ = u.call("POST", P + "/owners", {"userId": users["U"]["id"]})
        s_boot, _ = admin.call("POST", P + "/owners", {"userId": users["P1"]["id"]})
        s_again, _ = admin.call("POST", P + "/owners", {"userId": users["P2"]["id"]})
        check("an administrator who is not a policy owner cannot change a policy (403); a user cannot appoint owners (403); "
              "the administrator appoints the first owner, and once there is one only owners appoint",
              (s_admin, s_u, s_boot, s_again) == (403, 403, 200, 403), (s_admin, s_u, s_boot, s_again))

        # --- values are checked ---------------------------------------------------------------------------
        bad = [p1.call("POST", P + "/finance.tax", {**tax, "value": {"ratePercent": 140, "name": "VAT"}}),
               p1.call("POST", P + "/finance.tax", {**tax, "reason": " "}),
               p1.call("POST", P + "/finance.tax", {**tax, "effectiveFrom": (today - timedelta(days=1)).isoformat()}),
               p1.call("POST", P + "/sales.won-evidence", {"value": {"evidence": "ACTIVE_CONTRACT"}, "reason": "x"}),
               p1.call("POST", P + "/cert.decision", {"scope": "ISO 9001:2015", "value": {"mode": "COMMITTEE"}, "reason": "x"}),
               p1.call("POST", P + "/made.up", tax)]
        codes = [(s, err(b)[1], err(b)[2]) for s, b in bad[:5]] + [(bad[5][0],)]
        check("values are checked: out of range, no reason, a date in the past, a missing scope, a rule between fields; an unknown policy → 404",
              codes == [(422, "value.ratePercent", "RANGE"), (422, "reason", "REQUIRED"), (422, "effectiveFrom", "PAST"), (422, "scope", "REQUIRED"),
                        (422, "value.committeeSize", "REQUIRED"), (404,)], codes)

        # --- set, schedule, history -------------------------------------------------------------------------
        s, body = p1.call("POST", P + "/finance.tax", tax)
        d = obj(body)
        now = next((v for v in d.get("values", []) if v["scope"] is None), {})
        check("a policy owner sets the tax from today: it is in force, with who, when and why in its history",
              s == 201 and (now.get("value") or {}).get("ratePercent") == 14 and now.get("since") == today.isoformat()
              and d["versions"][0]["authorName"] == f"Policy P1 {tag}" and d["versions"][0]["reason"] == tax["reason"], (s, now, d.get("versions", [{}])[:1]))
        s, body = p1.call("POST", P + "/finance.tax", {**tax, "value": {"ratePercent": 10, "name": "VAT"}, "effectiveFrom": tomorrow.isoformat(),
                                                      "reason": "probe: scheduled change"})
        now = next((v for v in obj(body).get("values", []) if v["scope"] is None), {})
        check("a change from tomorrow leaves today's value in force and shows as the next value",
              s == 201 and (now.get("value") or {}).get("ratePercent") == 14 and now.get("nextFrom") == tomorrow.isoformat()
              and (now.get("nextValue") or {}).get("ratePercent") == 10, now)
        s, body = p1.call("POST", P + "/sales.won-evidence", {"scope": f"PROBE{tag}", "value": {"evidence": "ACCEPTED_QUOTE"}, "reason": "probe: per line"})
        scoped = [v for v in obj(body).get("values", [])]
        overview = obj(p1.call("GET", P)[1])
        counts = {x["key"]: x["inForce"] for x in overview.get("policies", [])}
        check("a per-line policy is set for its line; the overview counts what is in force and the owner may edit",
              s == 201 and [v["scope"] for v in scoped] == [f"PROBE{tag}"] and counts.get("finance.tax") == 1 and counts.get("sales.won-evidence") == 1
              and overview.get("canEdit") is True, (s, scoped, counts))

        # --- unset ---------------------------------------------------------------------------------------------
        s, body = p1.call("POST", P + "/sales.won-evidence/retire", {"scope": f"PROBE{tag}", "reason": "probe: unset"})
        scoped = obj(body).get("values", [])
        s2, b2 = p1.call("POST", P + "/sales.won-evidence/retire", {"scope": f"PROBE{tag}", "reason": "again"})
        check("a retired value stops being in force; retiring what is not set → 422",
              s == 200 and scoped and scoped[0].get("value") is None and (s2, err(b2)[0]) == (422, "POLICY_NOT_SET"), (s, scoped, s2, err(b2)))

        # --- owners ------------------------------------------------------------------------------------------
        s_a, _ = p1.call("POST", P + "/owners", {"userId": users["P2"]["id"]})
        s_d, b_d = p2.call("POST", f"{P}/owners/{users['P1']['id']}/dismiss")
        s_last, b_last = p2.call("POST", f"{P}/owners/{users['P2']['id']}/dismiss")
        s_p1, _ = p1.call("POST", P + "/finance.tax", tax)
        check("an owner appoints another; the new owner removes the first, who can no longer change policies; the last owner cannot be removed (409)",
              (s_a, s_d, s_p1, s_last, err(b_last)[0]) == (200, 200, 403, 409, "LAST_OWNER") and [o["name"] for o in rows(b_d)] == [f"Policy P2 {tag}"],
              (s_a, s_d, s_p1, s_last, err(b_last), rows(b_d)))
        log = rows(admin.call("GET", "/ws/ioeti/admin/audit?subject=POLICY&limit=20")[1])
        check("every policy change is in the admin change log", sum(1 for r in log if r["action"] in ("POLICY_SET", "POLICY_RETIRED")) >= 4,
              [r["action"] for r in log])

        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
        print(f"\n{sum(r['result'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} checks passed")
    finally:
        ids = [x["id"] for x in users.values()]
        if ids:
            joined = ",".join(map(str, ids))
            created.extend((VERSION, v["id"]) for v in search(VERSION, f"self.author.id in ({joined})"))
            created.extend((AUDIT, a["id"]) for a in search(AUDIT, f"self.actor.id in ({joined}) OR (self.subject = 'USER' AND self.subjectId in ({joined}))"))
            # the administrator's own change-log rows about the policies the probe touched
            created.extend((AUDIT, a["id"]) for a in search(AUDIT, "self.subject = 'POLICY' AND self.action LIKE 'POLICY_%' AND self.subjectLabel LIKE '%PROBE%'"))
        # owners saved each other's user record (updated_by): re-saved by the administrator, without the role,
        # so the fixture users can be removed in any order
        for user in users.values():
            _, row = admin.call("POST", f"/ws/rest/{USER}/search", {"fields": ["id", "version"], "limit": 1, "data": {"_domain": f"self.id = {user['id']}"}})
            current = (row.get("data") or [{}])[0]
            if current:
                # blocking is a real change, so the record's updated_by becomes the administrator
                admin.call("POST", f"/ws/rest/{USER}/{user['id']}", {"data": {"id": user["id"], "version": current.get("version"), "roles": [], "blocked": True}})
        if not role_before:
            created.extend((ROLE, r["id"]) for r in search(ROLE, f"self.name = '{OWNER_ROLE}'"))
        order = {VERSION: 0, AUDIT: 1, ROLE: 9, USER: 10, GROUP: 11}
        complete, left = cleanup(admin, created, order)
        if not complete:
            print(f"FAIL cleanup left {left}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "policy-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
