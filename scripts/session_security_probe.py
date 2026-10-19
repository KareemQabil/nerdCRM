#!/usr/bin/env python3
"""SEC-004 live probe: cookies, session fixation, CSRF, logout, login throttling, session expiry.

Run against a RUNNING local/CI Axelor; never against production. Creates throw-away users and an
opportunity and deletes them at the end. Report: logs/session-security-probe.json (no cookies,
tokens or credentials are stored).

Default mode (fits the main CI job):
  cookie flags, session id rotation at login, CSRF on IOETI writes (browser Origin without token,
  forged token, real token), refused writes leave data unchanged, logout invalidates the old cookie,
  per-user login throttling (429 + Retry-After, other users unaffected).
--expiry mode (needs a server started with AXELOR_CONFIG_SESSION_TIMEOUT=1,
  AXELOR_CONFIG_IOETI_SECURITY_LOGIN_WINDOW=1 and AXELOR_CONFIG_IOETI_SECURITY_LOGIN_IP_MAX=4):
  an idle session expires, an active one survives, the per-address throttle engages and is
  released when the window passes.
"""
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import BASE, ENV, OPP, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
MAIL = "com.axelor.mail.db.MailMessage"
ORIGIN = BASE.split("/axelor-erp")[0]
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:160]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def cookies(client):
    return {c.name: c for h in client.opener.handlers if hasattr(h, "cookiejar") for c in h.cookiejar}


def send(client, method, path, body=None, headers=None, timeout=60):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json", "Accept": "application/json",
                                          **(headers or {})})
    try:
        with client.opener.open(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers), json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as err:
        text = err.read().decode()
        try:
            return err.code, dict(err.headers), json.loads(text or "{}")
        except ValueError:
            return err.code, dict(err.headers), {}


def delete(admin, model, rid):
    """Deletes a fixture. A test user that cannot be deleted is blocked and stripped instead."""
    if ok(admin.call("DELETE", f"/ws/rest/{model}/{rid}")[1]):
        return True
    if model != USER:
        return False
    # change tracking authored by the test user references it; remove those messages first
    _, found = admin.call("POST", f"/ws/rest/{MAIL}/search",
                          {"fields": ["id"], "limit": 500, "data": {"_domain": f"self.author.id = {int(rid)}"}})
    for row in found.get("data") or []:
        admin.call("DELETE", f"/ws/rest/{MAIL}/{row['id']}")
    if ok(admin.call("DELETE", f"/ws/rest/{model}/{rid}")[1]):
        return True
    _, cur = admin.call("POST", f"/ws/rest/{USER}/{rid}/fetch", {"fields": ["version"]})
    version = (cur.get("data") or [{}])[0].get("version")
    admin.call("POST", f"/ws/rest/{USER}/{rid}", {"data": {"id": rid, "version": version, "blocked": True,
                                                           "group": None, "password": secrets.token_hex(32)}})
    return False  # still reported as incomplete


def admin_client():
    client = Client()
    assert client.login(os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin")),
                        os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
    return client


def default_mode(admin, created, tag):
    # --- cookies and fixation ------------------------------------------------------------------
    c = Client()
    c.call("GET", "/login")
    before = cookies(c).get("JSESSIONID")
    password = "S4!" + secrets.token_urlsafe(14)
    # least privilege: create/read/write own opportunities and read business lines, nothing else
    perms = []
    for name, obj, rights in ((f"sec004.opp.{tag}", OPP, {"canRead": True, "canWrite": True, "canCreate": True}),
                              (f"sec004.line.{tag}", "com.ioeti.businessline.db.BusinessLine", {"canRead": True})):
        _, body = rest_create(admin, PERM, {"name": name, "object": obj, **rights})
        perms.append(body["data"][0]["id"])
        created.append((PERM, perms[-1]))
    _, body = rest_create(admin, GROUP, {"code": f"sec004-{tag}", "name": "SEC-004 sales",
                                         "permissions": [{"id": p} for p in perms]})
    created.append((GROUP, body["data"][0]["id"]))
    group_id = body["data"][0]["id"]
    login = f"sec004.a.{tag}"
    _, body = rest_create(admin, USER, {"code": login, "name": "SEC-004 A", "blocked": False,
                                        "password": axelor_password_hash(password),
                                        "group": {"id": group_id}, "language": "en"})
    created.append((USER, body["data"][0]["id"]))
    check("login with fixture user", c.login(login, password) == 200)
    jar = cookies(c)
    session, csrf = jar.get("JSESSIONID"), jar.get("CSRF-TOKEN")
    check("session id rotated at login (no fixation)", before is not None and session is not None
          and session.value != before.value)
    check("session cookie is HttpOnly", session is not None and session.has_nonstandard_attr("HttpOnly"))
    same_site = (session.get_nonstandard_attr("SameSite") or "").lower() if session else ""
    check("session cookie SameSite is Lax or Strict", same_site in ("lax", "strict"), same_site)
    check("CSRF cookie is readable by the page (needed to send the header)",
          csrf is not None and not csrf.has_nonstandard_attr("HttpOnly"))
    if BASE.startswith("https://"):
        check("session cookie is Secure over HTTPS", session.secure)

    # --- CSRF on IOETI writes (browser-like Origin) ------------------------------------------------
    status, _, body = send(c, "POST", "/ws/ioeti/opportunities", {"name": f"SEC-004 {tag}", "businessLineCode": "ISO9001"},
                           {"Origin": ORIGIN, "X-CSRF-Token": csrf.value})
    check("browser write with the CSRF token succeeds", status == 201, status)
    opp = body.get("object") or {}
    if opp.get("id"):
        created.append((OPP, opp["id"]))
    for name, headers in (("no token", {"Origin": ORIGIN}), ("forged token", {"Origin": ORIGIN, "X-CSRF-Token": "forged"})):
        status, _, _ = send(c, "PUT", f"/ws/ioeti/opportunities/{opp.get('id')}",
                            {"name": "SEC-004 must not be saved", "version": opp.get("version")}, headers)
        check(f"browser write refused: {name}", status == 403, status)
        status, _, _ = send(c, "POST", "/ws/ioeti/opportunities",
                            {"name": "SEC-004 must not be created", "businessLineCode": "ISO9001"}, headers)
        check(f"browser create refused: {name}", status == 403, status)
    status, _, body = send(c, "GET", f"/ws/ioeti/opportunities/{opp.get('id')}", None, {"Origin": ORIGIN})
    check("safe read needs no CSRF token", status == 200, status)
    current = body.get("object") or {}
    check("refused writes left the record unchanged",
          current.get("name") == opp.get("name") and current.get("version") == opp.get("version"))
    _, _, search = send(admin, "POST", f"/ws/rest/{OPP}/search",
                        {"fields": ["name"], "data": {"_domain": "self.name = 'SEC-004 must not be created'"}})
    check("refused creates persisted nothing", ok(search) and not search.get("data"))

    # --- logout ---------------------------------------------------------------------------------------
    status, _, _ = send(c, "GET", "/logout")
    check("logout accepted", status in (200, 204, 302), status)
    old = Client()
    for h in old.opener.handlers:
        if hasattr(h, "cookiejar"):
            h.cookiejar.set_cookie(session)
    status, _, _ = send(old, "GET", "/ws/ioeti/session")
    check("old session cookie refused after logout", status == 401, status)
    status, _, _ = send(old, "GET", "/ws/ioeti/opportunities")
    check("old session cookie cannot read data after logout", status == 401, status)

    # --- login throttling per user + address --------------------------------------------------------
    victim = Client()
    statuses = [victim.login(login, "wrong-password") for _ in range(5)]
    check("wrong passwords rejected", all(s == 401 for s in statuses), statuses)
    status, headers, body = send(Client(), "POST", "/callback", {"username": login, "password": password})
    check("6th attempt throttled even with the right password (429)", status == 429, status)
    check("throttle response carries Retry-After and the error contract",
          headers.get("Retry-After", "").isdigit() and body.get("error", {}).get("code") == "RATE_LIMITED")
    check("other users from the same address can still sign in", admin_client() is not None)


def expiry_mode(admin, created, tag):
    idle, active = admin_client(), admin_client()
    check("idle session valid at start", send(idle, "GET", "/ws/ioeti/session")[0] == 200)
    deadline = time.monotonic() + 80
    while time.monotonic() < deadline:  # keep one session active, leave the other idle
        assert send(active, "GET", "/ws/ioeti/session")[0] == 200
        time.sleep(15)
    check("idle session expired after the timeout (401)", send(idle, "GET", "/ws/ioeti/session")[0] == 401)
    check("active session survived", send(active, "GET", "/ws/ioeti/session")[0] == 200)

    statuses = [Client().login(f"nobody{i}.{tag}", "wrong") for i in range(4)]
    check("failures from one address counted", all(s == 401 for s in statuses), statuses)
    status = send(Client(), "POST", "/callback", {"username": "admin", "password": "x"})[0]
    check("address over its limit is throttled for every user (429)", status == 429, status)
    time.sleep(65)
    check("throttle released after the window", admin_client() is not None)


def main():
    expiry = "--expiry" in sys.argv
    admin = admin_client()
    tag = secrets.token_hex(3)
    created = []
    exit_code = 1
    try:
        (expiry_mode if expiry else default_mode)(admin, created, tag)
        failed = [r for r in RESULTS if r["result"] != "PASS"]
        print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
        exit_code = 0 if not failed else 1
    except AssertionError as e:
        check("probe ran to completion", False, repr(e))
    finally:
        cleanup = admin_client()
        order = {OPP: 0, USER: 1, GROUP: 2, PERM: 3}
        results = [delete(cleanup, m, i) for m, i in sorted(created, key=lambda c: order.get(c[0], 9))]
        complete = all(results)
        print("CLEANUP", "complete" if complete else "INCOMPLETE", len(results))
        if not complete:
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        name = "session-security-probe.expiry.json" if expiry else "session-security-probe.json"
        with open(os.path.join(ROOT, "logs", name), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
