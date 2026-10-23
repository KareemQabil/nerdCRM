#!/usr/bin/env python3
"""Administration from the platform (journeys plan, phase 1): live probe against a RUNNING local/CI
Axelor; never against production. Every person, team and line it creates is fictional and removed.
Checks:
  access: every /ws/ioeti/admin endpoint answers 401 without a session and 403 to a signed-in person
  who is not an administrator (nothing relies on hidden buttons)
  people: sign-in name, password and e-mail rules (422 with the field), duplicates, unknown profile or
  line; the e-mail is written but never returned (contactOnFile only); a new person must change the
  temporary password at the first sign-in (Axelor answers the change-password route, no session) and can
  then work; deactivate → sign-in refused, activate → allowed; a reset forces a new change; stale
  version → 409; an administrator cannot deactivate themselves, remove their own administrator profile
  or reset their own password here (422)
  teams and business lines: create (duplicates 422, codes normalised, lines start in set-up), rename,
  status, members set exactly (the people's own line membership changes), stale → 409
  audit: one entry per change, newest first, with who and what; no e-mail address or password in it
Report: logs/admin-probe.json.
"""
import json
import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client  # noqa: E402
from db_migrate import DATABASE, psql  # noqa: E402

AD = "/ws/ioeti/admin"
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


def password():
    return "Probe-" + secrets.token_hex(5) + "A9"


def main():
    admin = Client()
    admin_user = os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin"))
    assert admin.login(admin_user, os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
    tag = secrets.token_hex(3).lower()
    probe_email = f"probe.{tag}@ioeti.example"
    users, teams, lines = [], [], []
    try:
        # --- access: anonymous and non-admin -----------------------------------------------------------
        anon = Client()
        endpoints = [("GET", "/users"), ("POST", "/users"), ("GET", "/profiles"), ("GET", "/teams"),
                     ("POST", "/teams"), ("GET", "/business-lines"), ("POST", "/business-lines"), ("GET", "/audit")]
        anon_codes = {anon.call(m, AD + p, {} if m == "POST" else None)[0] for m, p in endpoints}
        check("anonymous calls to the admin API are refused with 401", anon_codes == {401}, anon_codes)

        # --- people: validation --------------------------------------------------------------------------
        good = {"code": f"probe.{tag}", "name": "مستخدم تجربة", "email": probe_email, "language": "ar",
                "temporaryPassword": password(), "businessLines": ["ISO9001"], "teamIds": []}
        for field, value, expected in (("code", "x", "FORMAT"), ("code", "سارة", "FORMAT"), ("temporaryPassword", "short1A", "TOO_SHORT"),
                                       ("temporaryPassword", "nouppercase12345", "WEAK"), ("email", "not-an-address", "FORMAT"),
                                       ("language", "de", "UNAVAILABLE"), ("profileCode", f"nope-{tag}", "UNKNOWN"),
                                       ("businessLines", ["NOPE"], "UNKNOWN")):
            s, b = admin.call("POST", AD + "/users", {**good, field: value})
            check(f"adding a person with a bad {field} → 422 {expected}", s == 422 and err(b)[1] == expected, (s, err(b)))
        temp = good["temporaryPassword"]
        s, b = admin.call("POST", AD + "/users", good)
        person = obj(b)
        if person.get("id"):
            users.append(person["id"])
        check("an administrator adds a person (201) with lines, language and a temporary password",
              s == 201 and person.get("code") == f"probe.{tag}" and person.get("businessLines") == ["ISO9001"]
              and person.get("language") == "ar" and person.get("mustChangePassword") is True and person.get("active") is True, (s, person))
        check("the e-mail is stored but never returned (contactOnFile only)",
              person.get("contactOnFile") is True and probe_email not in json.dumps(b) and "email" not in person, person)
        s, b = admin.call("POST", AD + "/users", {**good, "code": f"PROBE.{tag.upper()}"})
        check("a sign-in name already in use (any case) → 422 DUPLICATE", s == 422 and err(b)[1] == "DUPLICATE", (s, err(b)))

        # --- the new person: first sign-in must change the password -------------------------------------
        newcomer = Client()
        s, b = newcomer.call("POST", "/callback", {"username": f"probe.{tag}", "password": temp})
        route = ((b or {}).get("route") or {}).get("path") if isinstance(b, dict) else None
        s2, _ = newcomer.call("GET", "/ws/ioeti/session")
        check("the first sign-in asks for a new password and opens no session", route == "/change-password" and s2 in (401, 302), (s, route, s2))
        new_password = password()
        s, b = newcomer.call("POST", "/callback", {"username": f"probe.{tag}", "password": temp, "newPassword": new_password})
        s2, me = newcomer.call("GET", "/ws/ioeti/session")
        check("after choosing a new password the person is signed in", s == 200 and s2 == 200 and me.get("code") == f"probe.{tag}", (s, s2, me))
        non_admin_codes = {newcomer.call(m, AD + p, {} if m == "POST" else None)[0] for m, p in endpoints}
        check("a signed-in person who is not an administrator gets 403 from every admin endpoint", non_admin_codes == {403}, non_admin_codes)
        s, b = admin.call("GET", f"{AD}/users/{person.get('id')}")
        detail = obj(b).get("user") or {}
        check("after the change the person no longer has to change the password", s == 200 and detail.get("mustChangePassword") is False, detail)

        # --- update, stale version, e-mail removal ------------------------------------------------------
        version = detail.get("version")
        s, b = admin.call("POST", f"{AD}/users/{person.get('id')}", {"version": version - 1, "name": "اسم قديم"})
        check("a change on a stale version → 409", s == 409, s)
        s, b = admin.call("POST", f"{AD}/users/{person.get('id')}", {"version": version, "name": "مستخدم تجربة ٢", "language": "en",
                                                                    "businessLines": ["ISO9001", "TRAINING"], "email": ""})
        changed = obj(b)
        check("an administrator changes name, language and lines and removes the e-mail",
              s == 200 and changed.get("name") == "مستخدم تجربة ٢" and changed.get("language") == "en"
              and changed.get("businessLines") == ["ISO9001", "TRAINING"] and changed.get("contactOnFile") is False, (s, changed))

        # --- deactivate / activate / reset ---------------------------------------------------------------
        working = Client()
        working.login(f"probe.{tag}", new_password)
        s0, _ = working.call("GET", "/ws/ioeti/automation/inbox/count")
        s, b = admin.call("POST", f"{AD}/users/{person.get('id')}/deactivate", {"version": changed.get("version")})
        check("deactivate → the person is inactive", s == 200 and obj(b).get("active") is False, (s, obj(b)))
        check("a deactivated person cannot sign in", Client().login(f"probe.{tag}", new_password) == 401)
        s1, _ = working.call("GET", "/ws/ioeti/automation/inbox/count")
        s2, _ = working.call("GET", "/ws/ioeti/automation/inbox/count")
        check("a session opened before the deactivation is refused at its next call (native filter: 403, then 401)",
              s0 == 200 and s1 in (401, 403) and s2 == 401, (s0, s1, s2))
        s, b = admin.call("POST", f"{AD}/users/{person.get('id')}/activate", {"version": obj(b).get("version")})
        check("activate → the person can sign in again", s == 200 and obj(b).get("active") is True
              and Client().login(f"probe.{tag}", new_password) == 200, (s, obj(b)))
        reset = password()
        s, b = admin.call("POST", f"{AD}/users/{person.get('id')}/password", {"version": obj(b).get("version"), "temporaryPassword": reset})
        again = Client()
        s2, b2 = again.call("POST", "/callback", {"username": f"probe.{tag}", "password": reset})
        check("a password reset is temporary: the next sign-in asks for a new one",
              s == 200 and obj(b).get("mustChangePassword") is True and ((b2 or {}).get("route") or {}).get("path") == "/change-password", (s, s2))

        # --- self-protection -----------------------------------------------------------------------------
        s, b = admin.call("GET", f"{AD}/users?q={admin_user}")
        me_row = next((u for u in rows(b) if u.get("code") == admin_user), {})
        s1, b1 = admin.call("POST", f"{AD}/users/{me_row.get('id')}/deactivate", {"version": me_row.get("version")})
        other = next((p["code"] for p in rows(admin.call("GET", AD + "/profiles")[1]) if not p.get("administrator")), None)
        s2, b2 = admin.call("POST", f"{AD}/users/{me_row.get('id')}", {"version": me_row.get("version"), "profileCode": other})
        s3, b3 = admin.call("POST", f"{AD}/users/{me_row.get('id')}/password", {"version": me_row.get("version"), "temporaryPassword": password()})
        check("an administrator cannot deactivate themselves, drop their own admin profile or reset their own password here",
              (s1, err(b1)[0], s2, err(b2)[0], s3, err(b3)[0]) == (422, "SELF_LOCKOUT", 422, "SELF_LOCKOUT", 422, "SELF_PASSWORD"),
              (s1, err(b1), s2, err(b2), s3, err(b3)))

        # --- profiles ------------------------------------------------------------------------------------
        s, b = admin.call("GET", AD + "/profiles")
        admins = next((p for p in rows(b) if p.get("code") == "admins"), {})
        check("profiles list the administrator profile with its people count", s == 200 and admins.get("administrator") is True
              and admins.get("people", 0) >= 1, admins)
        s, b = admin.call("GET", AD + "/profiles/nope-" + tag)
        check("an unknown profile → 404", s == 404, s)

        # --- teams ---------------------------------------------------------------------------------------
        s, b = admin.call("POST", AD + "/teams", {"name": f"فريق تجربة {tag}", "memberIds": [person.get("id")]})
        team = obj(b)
        if team.get("id"):
            teams.append(team["id"])
        check("an administrator adds a team with members", s == 201 and [m["id"] for m in team.get("members", [])] == [person.get("id")], (s, team))
        s, b = admin.call("POST", AD + "/teams", {"name": f"فريق تجربة {tag}"})
        check("a team name already in use → 422 DUPLICATE", s == 422 and err(b)[1] == "DUPLICATE", (s, err(b)))
        s, b = admin.call("POST", f"{AD}/teams/{team.get('id')}", {"version": team.get("version"), "name": f"فريق تجربة {tag} ب", "memberIds": []})
        check("rename a team and empty it", s == 200 and obj(b).get("members") == [] and obj(b).get("name", "").endswith(" ب"), (s, obj(b)))
        s, b = admin.call("POST", f"{AD}/teams/{team.get('id')}", {"version": team.get("version"), "name": "قديم"})
        check("a team change on a stale version → 409", s == 409, s)

        # --- business lines ------------------------------------------------------------------------------
        line_code = f"PRB{tag.upper()}"
        s, b = admin.call("POST", AD + "/business-lines", {"code": line_code.lower(), "nameEn": "Probe line", "nameAr": "خط تجربة",
                                                           "sequence": 900, "responsibleTeamId": team.get("id"), "managerId": person.get("id")})
        line = obj(b)
        if line.get("id"):
            lines.append(line["id"])
        check("an administrator adds a business line: code capitalised, starts in set-up, team and manager set",
              s == 201 and line.get("code") == line_code and line.get("status") == 1 and (line.get("responsibleTeam") or {}).get("id") == team.get("id")
              and (line.get("manager") or {}).get("id") == person.get("id"), (s, line))
        s, b = admin.call("POST", AD + "/business-lines", {"code": line_code, "nameEn": "Again", "nameAr": "مرة أخرى"})
        check("a line code already in use → 422 DUPLICATE", s == 422 and err(b)[1] == "DUPLICATE", (s, err(b)))
        s, b = admin.call("POST", AD + "/business-lines", {"code": "bad code", "nameEn": "x", "nameAr": "س"})
        check("a line code with a space → 422 FORMAT", s == 422 and err(b)[1] == "FORMAT", (s, err(b)))
        s, b = admin.call("POST", f"{AD}/business-lines/{line_code}", {"version": line.get("version"), "status": 2, "nameAr": "خط تجربة نشط"})
        check("activate and rename a line", s == 200 and obj(b).get("status") == 2 and obj(b).get("nameAr") == "خط تجربة نشط", (s, obj(b)))
        s, b = admin.call("POST", f"{AD}/business-lines/{line_code}", {"version": line.get("version"), "status": 3})
        check("a line change on a stale version → 409", s == 409, s)
        current = next((l for l in rows(admin.call("GET", AD + "/business-lines")[1]) if l["code"] == line_code), {})
        s, b = admin.call("POST", f"{AD}/business-lines/{line_code}", {"version": current.get("version"), "status": 9})
        check("an unknown line status → 422", s == 422 and err(b)[1] == "UNAVAILABLE", (s, err(b)))
        s, b = admin.call("POST", f"{AD}/business-lines/{line_code}/members", {"userIds": [person.get("id")]})
        check("set the line's members", s == 200 and [m["id"] for m in rows(b)] == [person.get("id")], (s, rows(b)))
        s, b = admin.call("GET", f"{AD}/users/{person.get('id')}")
        check("the person's own lines now include the new line", line_code in (obj(b).get("user") or {}).get("businessLines", []), obj(b))
        s, b = admin.call("POST", f"{AD}/business-lines/{line_code}/members", {"userIds": []})
        s2, b2 = admin.call("GET", f"{AD}/users/{person.get('id')}")
        check("emptying the members removes the line from the person", s == 200 and rows(b) == []
              and line_code not in (obj(b2).get("user") or {}).get("businessLines", []), (s, obj(b2)))

        # --- audit ---------------------------------------------------------------------------------------
        s, b = admin.call("GET", f"{AD}/audit?subject=USER&subjectId={person.get('id')}&limit=50")
        actions = [e["action"] for e in rows(b)]
        check("the audit trail has every change to the person, newest first",
              s == 200 and actions[:6] == ["USER_PASSWORD_RESET", "USER_ACTIVATED", "USER_DEACTIVATED", "USER_UPDATED", "USER_CREATED"][:len(actions[:6])]
              and {"USER_CREATED", "USER_UPDATED", "USER_DEACTIVATED", "USER_ACTIVATED", "USER_PASSWORD_RESET"} <= set(actions), actions)
        everything = json.dumps(rows(admin.call("GET", f"{AD}/audit?limit=200")[1]), ensure_ascii=False)
        check("no e-mail address or password appears in the audit trail",
              probe_email not in everything and temp not in everything and new_password not in everything and reset not in everything)
        s, b = admin.call("GET", f"{AD}/audit?subject=BUSINESS_LINE&subjectId={line.get('id')}")
        check("line changes are audited with who made them", s == 200 and {"LINE_CREATED", "LINE_UPDATED", "LINE_MEMBERS"} <= {e["action"] for e in rows(b)}
              and all(e.get("actorName") for e in rows(b)), [e["action"] for e in rows(b)])
    finally:
        ids = lambda xs: ",".join(str(int(x)) for x in xs) or "NULL"  # noqa: E731
        psql(DATABASE, f"""
            DELETE FROM ioeti_admin_audit WHERE (subject = 'USER' AND subject_id IN ({ids(users)}))
               OR (subject = 'TEAM' AND subject_id IN ({ids(teams)})) OR (subject = 'BUSINESS_LINE' AND subject_id IN ({ids(lines)}));
            DELETE FROM ioeti_user_business_line WHERE user_id IN ({ids(users)}) OR business_line_id IN ({ids(lines)});
            DELETE FROM ioeti_business_line WHERE id IN ({ids(lines)});
            DELETE FROM team_team_members WHERE team_set IN ({ids(teams)}) OR members IN ({ids(users)});
            DELETE FROM team_team WHERE id IN ({ids(teams)});
            UPDATE auth_user SET active_team = NULL WHERE id IN ({ids(users)});
            DELETE FROM auth_user WHERE id IN ({ids(users)});
        """, single_transaction=True)
        left = psql(DATABASE, f"SELECT (SELECT count(*) FROM auth_user WHERE id IN ({ids(users)})) + (SELECT count(*) FROM team_team WHERE id IN ({ids(teams)}))"
                              f" + (SELECT count(*) FROM ioeti_business_line WHERE id IN ({ids(lines)}));").strip()
        check("cleanup removed every probe person, team and line", left == "0", left)
    passed = sum(r["result"] == "PASS" for r in RESULTS)
    print(f"\n{passed}/{len(RESULTS)} checks passed")
    os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
    with open(os.path.join(ROOT, "logs", "admin-probe.json"), "w", encoding="utf-8") as f:
        json.dump({"checks": RESULTS}, f, indent=2, ensure_ascii=False)
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
