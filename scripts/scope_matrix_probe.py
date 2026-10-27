#!/usr/bin/env python3
"""SEC-003 live probe: Own / Team / Business Line / All record scopes on IOETI opportunities.

Run against a RUNNING local/CI Axelor with the CRM app installed; never against production.
Every role below is a TEST FIXTURE built from native Axelor permissions (conditions with
__user__ parameters); IOETI's production role matrix is policy D-07 and is NOT defined here.

Fixtures: team T; lines ISO9001 and TRAINING; opportunities
  O1 owner RepA, team T, ISO9001 · O2 owner RepB, no team, TRAINING · O3 owner admin, team T, TRAINING
Principals and their read/write condition:
  RepA, RepB   Own   self.user = __user__
  Manager      Team  self.team in (__user__.teamSet)          (member of T)
  LineIso      Line  self.ioetiBusinessLine in (__user__.ioetiBusinessLines)   (member of ISO9001)
  LineNone     Line  same condition, member of no line (empty collection parameter)
  All          All   unconditional
  ReadOnly     group ioeti-bl-viewer (no opportunity permission)
For every principal and fixture: list membership, GET (200 when in scope, otherwise the same 404 as a
missing id), PUT with the real version (200 in scope, otherwise 404) and, afterwards, that refused
writes changed nothing. Also: generic /ws/rest refused, create eligibility by line membership,
membership revocation effective on the next request. Report: logs/scope-matrix-probe.json.
"""
import json
import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import BL, ENV, OPP, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
TEAM, MAIL = "com.axelor.team.db.Team", "com.axelor.mail.db.MailMessage"
MISSING = 987654320
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:160]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def admin_client():
    client = Client()
    assert client.login(os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin")),
                        os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
    return client


def main():
    admin = admin_client()
    tag = secrets.token_hex(3)
    created = []

    def create(model, values):
        _, body = rest_create(admin, model, values)
        if not ok(body):
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}: {json.dumps(body)[:200]}")
        created.append((model, body["data"][0]["id"]))
        return body["data"][0]

    def fetch(model, rid, fields):
        _, body = admin.call("POST", f"/ws/rest/{model}/{rid}/fetch", {"fields": fields})
        return (body.get("data") or [{}])[0]

    exit_code = 1
    try:
        _, lines = admin.call("GET", "/ws/ioeti/business-lines")
        line = {l["code"]: l for l in lines["object"]}
        iso, training = line["ISO9001"], line["TRAINING"]

        def scope_group(name, condition, params, create_right=False):
            rights = {"canRead": True, "canWrite": True, "canCreate": create_right}
            opp = create(PERM, {"name": f"sec003.{name}.{tag}", "object": OPP, **rights,
                                **({"condition": condition, "conditionParams": params} if condition else {})})
            bl = create(PERM, {"name": f"sec003.{name}.line.{tag}", "object": BL, "canRead": True})
            return create(GROUP, {"code": f"sec003-{name}-{tag}", "name": f"SEC-003 {name} {tag}",
                                  "permissions": [{"id": opp["id"]}, {"id": bl["id"]}]})

        groups = {
            "own": scope_group("own", "self.user = ?", "__user__", create_right=True),
            "team": scope_group("team", "self.team in (?)", "__user__.teamSet"),
            "line": scope_group("line", "self.ioetiBusinessLine in (?)", "__user__.ioetiBusinessLines", True),
            "all": scope_group("all", None, None),
        }
        _, viewer = admin.call("POST", f"/ws/rest/{GROUP}/search",
                               {"data": {"_domain": "self.code = 'ioeti-bl-viewer'"}, "fields": ["code"]})
        passwords = {}

        def user(label, group_id, lines=()):
            password = "S3!" + secrets.token_urlsafe(14)
            row = create(USER, {"code": f"sec003.{label.lower()}.{tag}", "name": f"SEC-003 {label}",
                                "blocked": False, "language": "en", "password": axelor_password_hash(password),
                                "group": {"id": group_id}, "ioetiBusinessLines": [{"id": l["id"]} for l in lines]})
            passwords[label] = (row["code"], password)
            return row

        users = {"RepA": user("RepA", groups["own"]["id"]), "RepB": user("RepB", groups["own"]["id"]),
                 "Manager": user("Manager", groups["team"]["id"]),
                 "LineIso": user("LineIso", groups["line"]["id"], [iso]),
                 "LineNone": user("LineNone", groups["line"]["id"]),
                 "All": user("All", groups["all"]["id"]),
                 "ReadOnly": user("ReadOnly", viewer["data"][0]["id"])}
        team = create(TEAM, {"name": f"SEC-003 team {tag}",
                             "members": [{"id": users["Manager"]["id"]}, {"id": users["RepA"]["id"]}]})
        o1 = create(OPP, {"name": f"SEC-003 O1 {tag}", "user": {"id": users["RepA"]["id"]},
                          "team": {"id": team["id"]}, "ioetiBusinessLine": {"id": iso["id"]}})
        o2 = create(OPP, {"name": f"SEC-003 O2 {tag}", "user": {"id": users["RepB"]["id"]},
                          "ioetiBusinessLine": {"id": training["id"]}})
        o3 = create(OPP, {"name": f"SEC-003 O3 {tag}", "team": {"id": team["id"]},
                          "ioetiBusinessLine": {"id": training["id"]}})
        fixtures = {"O1": o1, "O2": o2, "O3": o3}
        expected = {"RepA": {"O1"}, "RepB": {"O2"}, "Manager": {"O1", "O3"}, "LineIso": {"O1"},
                    "LineNone": set(), "All": {"O1", "O2", "O3"}, "ReadOnly": None}
        sessions = {}
        for label in expected:
            sessions[label] = Client()
            assert sessions[label].login(*passwords[label]) == 200, label

        # --- read scope -------------------------------------------------------------------------------
        for label, visible in expected.items():
            c = sessions[label]
            status, body = c.call("GET", "/ws/ioeti/opportunities?limit=50")
            if visible is None:
                check(f"{label}: opportunities model denied (403)", status == 403, status)
            else:
                seen = {k for k, o in fixtures.items() if o["id"] in {r["id"] for r in body.get("object") or []}}
                check(f"{label}: list shows exactly its scope", status == 200 and seen == visible,
                      f"http={status} seen={sorted(seen)} expected={sorted(visible)}")
            missing_status, missing_body = c.call("GET", f"/ws/ioeti/opportunities/{MISSING}")
            for key, opp in fixtures.items():
                status, body = c.call("GET", f"/ws/ioeti/opportunities/{opp['id']}")
                if visible is None:
                    ok_case = status == 403
                elif key in visible:
                    ok_case = status == 200 and body.get("object", {}).get("id") == opp["id"]
                else:  # out of scope must look exactly like a missing id
                    ok_case = (status == missing_status == 404
                               and body.get("error", {}).get("code") == missing_body.get("error", {}).get("code"))
                check(f"{label}: GET {key} {'in' if visible and key in visible else 'out of'} scope", ok_case, status)

        # --- write scope (real versions; in-scope writes are allowed, others must change nothing) --------
        for label, visible in expected.items():
            if visible is None:
                continue
            c = sessions[label]
            for key, opp in fixtures.items():
                current = fetch(OPP, opp["id"], ["name", "version"])
                status, _ = c.call("PUT", f"/ws/ioeti/opportunities/{opp['id']}",
                                   {"name": current["name"], "version": current["version"]})
                expected_status = 200 if key in visible else 404
                check(f"{label}: PUT {key} -> {expected_status}", status == expected_status, status)
        for key, opp in fixtures.items():
            check(f"{key}: name never changed by any write", fetch(OPP, opp["id"], ["name"]).get("name") == opp["name"])

        # --- generic API ---------------------------------------------------------------------------------
        for label in expected:
            status, body = sessions[label].call("POST", f"/ws/rest/{OPP}/search", {"fields": ["name"], "limit": 5})
            check(f"{label}: generic /ws/rest refused", status == 403 and "data" not in body, status)

        # --- create eligibility by membership (D-07 pending: membership is the fail-closed default) -------
        for label, code, want in (("LineIso", "ISO9001", 201), ("LineIso", "TRAINING", 422),
                                  ("RepA", "ISO9001", 422), ("LineNone", "ISO9001", 422)):
            status, body = sessions[label].call("POST", "/ws/ioeti/opportunities",
                                                {"name": f"SEC-003 create {label} {code} {tag}", "businessLineCode": code})
            if status == 201:
                created.append((OPP, body["object"]["id"]))
            check(f"{label}: create in {code} -> {want}", status == want, status)
        _, body = sessions["LineIso"].call("GET", "/ws/ioeti/business-lines?creatable=true")
        check("LineIso: creatable lines = its memberships",
              {l["code"] for l in body.get("object") or []} == {"ISO9001"})
        _, body = sessions["RepA"].call("GET", "/ws/ioeti/business-lines?creatable=true")
        check("RepA (no membership): no creatable lines", body.get("object") == [], body.get("object"))

        # --- revocation takes effect on the next request -------------------------------------------------
        cur = fetch(USER, users["LineIso"]["id"], ["version"])
        _, body = admin.call("POST", f"/ws/rest/{USER}/{users['LineIso']['id']}",
                             {"data": {"id": users["LineIso"]["id"], "version": cur["version"], "ioetiBusinessLines": []}})
        check("membership removed by admin", ok(body))
        status, _ = sessions["LineIso"].call("GET", f"/ws/ioeti/opportunities/{o1['id']}")
        check("LineIso: revoked membership hides O1 on the next request (404)", status == 404, status)
        status, _ = sessions["LineIso"].call("POST", "/ws/ioeti/opportunities",
                                             {"name": f"SEC-003 after revoke {tag}", "businessLineCode": "ISO9001"})
        check("LineIso: revoked membership refuses create (422)", status == 422, status)

        failed = [r for r in RESULTS if r["result"] != "PASS"]
        print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
        exit_code = 0 if not failed else 1
    finally:
        complete, leftovers = cleanup(admin, created, {OPP: 0, TEAM: 1, USER: 2, GROUP: 3, PERM: 4})
        print("CLEANUP", "complete" if complete else f"INCOMPLETE {leftovers}", len(created))
        if not complete:
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "scope-matrix-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
