#!/usr/bin/env python3
"""D-07 role templates (deny by default): live probe against a RUNNING local/CI Axelor; never against production.
Principals are TEST FIXTURES: the administrator, and one person on a profile created through the template API.
Every record is removed afterwards.
Checks:
  catalogue: nine templates, no policy owner among them; record types carry their SEC-003 scopes; private data is
  marked restricted; someone who is not an administrator is refused (403) for the catalogue, profile creation and rights
  profile: created from a template with its role and no rights; unknown template, bad code, taken code and the
  administrators' code are refused
  rights (native permissions, enforced by the existing endpoints on the next request):
    without a right the person's lead list answers 403; read in the OWN scope shows their lead only; ALL shows both;
    all off removes the right and the list answers 403 again
    write without read, a scope the record type lacks, an unknown record type and a stale profile version are refused;
    the administrators' profile is fixed; a right managed elsewhere on the same record type is not widened
  audit: the creation and every change are in the admin change log with before → after
Report: logs/roles-probe.json.
"""
import json
import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

USER, GROUP, PERM, ROLE = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission", "com.axelor.auth.db.Role"
LEAD, AUDIT = "com.axelor.apps.crm.db.Lead", "com.ioeti.admin.db.AdminAuditEvent"
A, LEADS = "/ws/ioeti/admin", "/ws/ioeti/leads"
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
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}: {json.dumps(body)[:200]}")
        created.append((model, body["data"][0]["id"]))
        return body["data"][0]

    def search(model, domain, fields=("id",), limit=500):
        _, body = admin.call("POST", f"/ws/rest/{model}/search", {"fields": list(fields), "limit": limit, "data": {"_domain": domain, "_archived": True}})
        return body.get("data") or []

    roles_before = {r["name"] for r in search(ROLE, "self.name LIKE 'ioeti-%'", ("name",))}
    exit_code = 1
    profile_code = f"probe-mgr-{tag}"
    try:
        # --- catalogue ---------------------------------------------------------------------------------------
        s, b = admin.call("GET", A + "/role-templates")
        cat = obj(b)
        codes = [t["code"] for t in cat.get("templates", [])]
        check("catalogue: nine templates", s == 200 and len(codes) == 9, codes)
        check("catalogue: the policy owner is not a template", all("owner" not in t["role"] for t in cat.get("templates", [])), cat.get("templates"))
        lead_type = next((t for t in cat.get("recordTypes", []) if t["key"] == "Lead"), {})
        check("catalogue: leads carry own, team, line and all scopes", sorted(lead_type.get("scopes", [])) == ["ALL", "LINE", "OWN", "TEAM"], lead_type)
        private = next((t for t in cat.get("recordTypes", []) if t["key"] == "CandidatePrivateProfile"), {})
        check("catalogue: candidate private data is marked restricted", private.get("restricted") is True, private)

        # --- profile from a template ---------------------------------------------------------------------------
        s, b = admin.call("POST", A + "/profiles", {"code": profile_code, "name": f"Probe sales manager {tag}", "template": "NOPE"})
        check("profile: an unknown template is refused", s == 422 and err(b)[1:] == ("template", "UNKNOWN"), (s, err(b)))
        s, b = admin.call("POST", A + "/profiles", {"code": "Bad Code!", "name": f"Probe bad {tag}", "template": "SALES_MANAGER"})
        check("profile: a malformed code is refused", s == 422 and err(b)[1:] == ("code", "FORMAT"), (s, err(b)))
        s, b = admin.call("POST", A + "/profiles", {"code": "admins", "name": f"Probe admins {tag}", "template": "SALES_MANAGER"})
        check("profile: the administrators' code is refused", s == 422 and err(b)[1:] == ("code", "TAKEN"), (s, err(b)))
        s, b = admin.call("POST", A + "/profiles", {"code": profile_code, "name": f"Probe sales manager {tag}", "template": "SALES_MANAGER"})
        prof = obj(b)
        group_id = (search(GROUP, f"self.code = '{profile_code}'") or [{}])[0].get("id")
        if group_id:
            created.append((GROUP, group_id))
        check("profile: created from the template with its role and no rights (deny by default)",
              s == 201 and prof.get("roles") == ["ioeti-sales-manager"] and prof.get("rights") == [], (s, prof))
        s, b = admin.call("POST", A + "/profiles", {"code": profile_code, "name": f"Probe other {tag}", "template": "GM"})
        check("profile: a taken code is refused", s == 422 and err(b)[1:] == ("code", "TAKEN"), (s, err(b)))

        # --- a person on that profile -----------------------------------------------------------------------------
        password = "Rl!" + secrets.token_urlsafe(14)
        person = create(USER, {"code": f"rlprobe.{tag}", "name": f"Roles probe {tag}", "blocked": False, "language": "ar",
                               "group": {"id": group_id}, "password": axelor_password_hash(password)})
        me = Client()
        assert me.login(person["code"], password) == 200
        mine = create(LEAD, {"name": f"Roles probe own lead {tag}", "user": {"id": person["id"]}})
        theirs = create(LEAD, {"name": f"Roles probe other lead {tag}"})

        def visible():
            s_, b_ = me.call("GET", LEADS + "?limit=50")
            ids = {r.get("id") for r in (b_.get("object") or [])} if s_ == 200 else None
            return s_, ids

        def right(**values):
            current = obj(admin.call("GET", A + f"/profiles/{profile_code}")[1])
            body = {"version": current.get("version"), "object": "Lead", "read": False, "write": False, "create": False, "remove": False}
            body.update(values)
            return admin.call("POST", A + f"/profiles/{profile_code}/rights", body)

        s, _ = visible()
        check("rights: with no right the lead list answers 403", s == 403, s)

        # --- refusals -------------------------------------------------------------------------------------------
        s, b = right(write=True)
        check("rights: write without read is refused", s == 422 and err(b)[1:] == ("read", "REQUIRED"), (s, err(b)))
        current = obj(admin.call("GET", A + f"/profiles/{profile_code}")[1])
        s, b = admin.call("POST", A + f"/profiles/{profile_code}/rights", {"version": current.get("version"), "object": "Product", "read": True,
                                                                            "write": False, "create": False, "remove": False, "scope": "LINE"})
        check("rights: a scope the record type lacks is refused", s == 422 and err(b)[1:] == ("scope", "UNAVAILABLE"), (s, err(b)))
        s, b = admin.call("POST", A + f"/profiles/{profile_code}/rights", {"version": current.get("version"), "object": "com.axelor.auth.db.User",
                                                                            "read": True, "write": False, "create": False, "remove": False})
        check("rights: a record type outside the catalogue is refused", s == 422 and err(b)[1:] == ("object", "UNKNOWN"), (s, err(b)))
        s, b = admin.call("POST", A + "/profiles/admins/rights", {"version": obj(admin.call("GET", A + "/profiles/admins")[1]).get("version"),
                                                                   "object": "Lead", "read": True, "write": False, "create": False, "remove": False})
        check("rights: the administrators' profile is fixed", s == 422 and err(b)[0] == "ADMIN_PROFILE_FIXED", (s, err(b)))

        # --- grants take effect on the next request ---------------------------------------------------------------
        s, b = right(read=True, scope="OWN")
        rights = obj(b).get("rights") or []
        check("rights: read in the OWN scope is stored as a managed native permission",
              s == 200 and len(rights) == 1 and rights[0].get("scope") == "OWN" and rights[0].get("managed") is True, (s, rights))
        s, ids = visible()
        check("rights: OWN shows the person's own lead and not the other", s == 200 and mine["id"] in ids and theirs["id"] not in ids, (s, ids))
        stale = obj(admin.call("GET", A + f"/profiles/{profile_code}")[1]).get("version", 0) - 1
        s, b = admin.call("POST", A + f"/profiles/{profile_code}/rights", {"version": stale, "object": "Lead", "read": True,
                                                                            "write": False, "create": False, "remove": False})
        check("rights: a stale profile version is refused", s == 409, s)
        s, b = right(read=True, write=True, scope="ALL")
        s2, ids = visible()
        check("rights: ALL shows both leads", s == 200 and s2 == 200 and {mine["id"], theirs["id"]} <= ids, (s, s2, ids))
        s, b = right()
        s2, _ = visible()
        check("rights: all off removes the right; the list answers 403 again", s == 200 and obj(b).get("rights") == [] and s2 == 403, (s, s2))

        # --- a right managed elsewhere ----------------------------------------------------------------------------
        foreign = create(PERM, {"name": f"rlprobe.foreign.{tag}", "object": LEAD, "canRead": True})
        other = create(GROUP, {"code": f"rlprobe-other-{tag}", "name": f"Roles probe other {tag}", "permissions": [{"id": foreign["id"]}]})
        s, b = admin.call("POST", A + f"/profiles/{other['code'] if 'code' in other else f'rlprobe-other-{tag}'}/rights",
                          {"version": other.get("version", 0), "object": "Lead", "read": True, "write": True, "create": False, "remove": False})
        check("rights: a right managed elsewhere is not widened", s == 422 and err(b)[0] == "RIGHT_MANAGED_ELSEWHERE", (s, err(b)))

        # --- not an administrator ------------------------------------------------------------------------------------
        s1, _ = me.call("GET", A + "/role-templates")
        s2, _ = me.call("POST", A + "/profiles", {"code": f"rlprobe-x-{tag}", "name": "x", "template": "GM"})
        s3, _ = me.call("POST", A + f"/profiles/{profile_code}/rights", {"version": 0, "object": "Lead", "read": True})
        check("access: someone who is not an administrator is refused (403) everywhere", (s1, s2, s3) == (403, 403, 403), (s1, s2, s3))

        # --- audit -----------------------------------------------------------------------------------------------------
        events = search(AUDIT, f"self.subject = 'PROFILE' AND self.subjectId = {group_id}", ("action", "changes"))
        actions = [e.get("action") for e in events]
        changes = " | ".join(e.get("changes") or "" for e in events)
        check("audit: the creation and each change are logged with before → after",
              actions.count("PROFILE_CREATED") == 1 and actions.count("PROFILE_RIGHT_SET") == 3
              and "Lead: none→read@OWN" in changes and "read@OWN→read+write@ALL" in changes and "read+write@ALL→none" in changes, (actions, changes))
        created.extend((AUDIT, e["id"]) for e in events)
        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
    finally:
        for user in search(USER, f"self.code = 'rlprobe.{tag}'", ("version",)):
            admin.call("POST", f"/ws/rest/{USER}/{user['id']}", {"data": {"id": user["id"], "version": user.get("version"), "group": None, "blocked": True}})
        for g in search(GROUP, f"self.code = '{profile_code}'", ("id",)):
            for p in search(PERM, f"self.name LIKE 'ioeti.{profile_code}.%'"):
                created.append((PERM, p["id"]))
            if (GROUP, g["id"]) not in created:
                created.append((GROUP, g["id"]))
        for r in search(ROLE, "self.name LIKE 'ioeti-%'", ("name",)):
            if r["name"] not in roles_before:
                created.append((ROLE, r["id"]))
        order = {AUDIT: 0, LEAD: 1, USER: 2, GROUP: 3, PERM: 4, ROLE: 5}
        complete, left = cleanup(admin, list(dict.fromkeys(created)), order)
        if not complete:
            print(f"FAIL cleanup left {left}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "roles-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
