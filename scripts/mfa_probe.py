#!/usr/bin/env python3
"""D-07 optional two-step sign-in (native Axelor TOTP): live probe against a RUNNING local/CI Axelor; never against production.
Principals are TEST FIXTURES: one person, and the administrator. Every record is removed afterwards.
Checks:
  set-up: off at first; confirming before starting is refused; start returns a key and a QR image; a wrong code leaves it
  off; the right code turns it on and returns recovery codes once; starting again is refused
  sign-in: with it on, the password alone gives no session (the callback asks for the code); a wrong code gives no session;
  the app's code does (second step on the native MfaClient); a recovery code does once, and not twice
  turning off and new recovery codes need a current code; an administrator resets it for a lost device, someone else
  cannot (403); after a reset the password alone signs in again
  audit: MFA_ENABLED, MFA_RECOVERY_CODES, MFA_DISABLED and MFA_RESET are in the admin change log; no secret or code is
Report: logs/mfa-probe.json.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import struct
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

USER, MFA, AUDIT = "com.axelor.auth.db.User", "com.axelor.auth.db.MFA", "com.ioeti.admin.db.AdminAuditEvent"
ME = "/ws/ioeti/me/mfa"
STEP2 = "/callback?client_name=MfaClient"  # the native MFA client takes the second step
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:240]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def obj(body):
    return (body.get("object") if isinstance(body, dict) else None) or {}


def err(body):
    e = (body.get("error") or {}) if isinstance(body, dict) else {}
    return e.get("code"), ((e.get("fields") or [{}])[0]).get("field"), ((e.get("fields") or [{}])[0]).get("code")


def totp(secret, at=None):
    """RFC 6238: SHA-1, 6 digits, 30-second steps (the native defaults)."""
    key = base64.b32decode(secret.upper() + "=" * (-len(secret) % 8))
    counter = int((at or time.time()) // 30)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    return str((struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1_000_000).zfill(6)


def fresh_code(secret, used):
    """A code from a time step not used yet (a code is not accepted twice)."""
    while True:
        step = int(time.time() // 30)
        if step not in used:
            used.add(step)
            return totp(secret)
        time.sleep(31 - time.time() % 30)


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

    password = "Mf!" + secrets.token_urlsafe(14)
    exit_code = 1
    used = set()
    person = None
    try:
        person = create(USER, {"code": f"mfaprobe.{tag}", "name": f"MFA probe {tag}", "blocked": False, "language": "ar",
                               "password": axelor_password_hash(password)})
        me = Client()
        assert me.login(person["code"], password) == 200

        def signed_in(client):
            s_, b_ = client.call("GET", "/ws/ioeti/session")
            return s_ == 200 and (b_.get("code") == person["code"] or obj(b_).get("code") == person["code"])

        # --- set-up -----------------------------------------------------------------------------------------------
        s, b = me.call("GET", ME)
        check("set-up: off at first", s == 200 and obj(b).get("enabled") is False, (s, b))
        s, b = me.call("POST", ME + "/confirm", {"code": "123456"})
        check("set-up: confirming before starting is refused", s == 422 and err(b)[0] == "MFA_NOT_STARTED", (s, err(b)))
        s, b = me.call("POST", ME + "/start", {})
        setup = obj(b)
        secret = setup.get("secret") or ""
        check("set-up: start returns a key and a QR image", s == 200 and len(secret) >= 16 and str(setup.get("qrCode", "")).startswith("data:image/png;base64,"),
              (s, len(secret)))
        wrong = str((int(totp(secret)) + 1) % 1_000_000).zfill(6)
        s, b = me.call("POST", ME + "/confirm", {"code": wrong})
        s2, b2 = me.call("GET", ME)
        check("set-up: a wrong code leaves it off", s == 422 and err(b)[1:] == ("code", "INVALID") and obj(b2).get("enabled") is False, (s, err(b), b2))
        s, b = me.call("POST", ME + "/confirm", {"code": fresh_code(secret, used)})
        recovery = obj(b).get("recoveryCodes") or []
        check("set-up: the right code turns it on and returns recovery codes once",
              s == 200 and obj(b).get("status", {}).get("enabled") is True and len(recovery) >= 5, (s, b))
        s, b = me.call("POST", ME + "/start", {})
        check("set-up: starting again is refused", s == 422 and err(b)[0] == "MFA_ALREADY_ON", (s, err(b)))

        # --- sign-in ----------------------------------------------------------------------------------------------
        c = Client()
        s, b = c.call("POST", "/callback", {"username": person["code"], "password": password})
        route = (b.get("route") or {}) if isinstance(b, dict) else {}
        check("sign-in: the password alone gives no session; the callback asks for the code",
              route.get("path") == "/mfa" and not signed_in(c), (s, route))
        s, b = c.call("POST", STEP2, {"username": person["code"], "mfaCode": wrong, "mfaMethod": "TOTP"})
        check("sign-in: a wrong code gives no session", not signed_in(c), (s, b))
        s, b = c.call("POST", STEP2, {"username": person["code"], "mfaCode": fresh_code(secret, used), "mfaMethod": "TOTP"})
        check("sign-in: the app's code signs in", signed_in(c), (s, b))
        r = Client()
        r.call("POST", "/callback", {"username": person["code"], "password": password})
        r.call("POST", STEP2, {"username": person["code"], "mfaCode": recovery[0], "mfaMethod": "RECOVERY"})
        first = signed_in(r)
        again = Client()
        again.call("POST", "/callback", {"username": person["code"], "password": password})
        again.call("POST", STEP2, {"username": person["code"], "mfaCode": recovery[0], "mfaMethod": "RECOVERY"})
        check("sign-in: a recovery code signs in once, not twice", first and not signed_in(again), (first,))

        # --- recovery codes and turning off -------------------------------------------------------------------------
        s, b = me.call("POST", ME + "/recovery-codes", {"code": wrong})
        check("codes: new recovery codes need a current code", s == 422 and err(b)[1:] == ("code", "INVALID"), (s, err(b)))
        s, b = me.call("POST", ME + "/recovery-codes", {"code": fresh_code(secret, used)})
        fresh = obj(b).get("recoveryCodes") or []
        check("codes: a current code gives new recovery codes", s == 200 and len(fresh) >= 5 and not set(fresh) & set(recovery), (s, len(fresh)))
        s, b = me.call("POST", ME + "/disable", {"code": wrong})
        check("off: turning off needs a current code", s == 422 and err(b)[1:] == ("code", "INVALID"), (s, err(b)))
        s, b = me.call("POST", ME + "/disable", {"code": fresh[0], "recovery": True})
        check("off: a recovery code turns it off", s == 200 and obj(b).get("enabled") is False, (s, b))

        # --- administrator reset ------------------------------------------------------------------------------------
        s, b = me.call("POST", ME + "/start", {})
        secret = obj(b).get("secret") or ""
        used.clear()
        me.call("POST", ME + "/confirm", {"code": fresh_code(secret, used)})
        s, _ = me.call("POST", f"/ws/ioeti/admin/users/{person['id']}/mfa/reset", {})
        check("reset: someone who is not an administrator cannot reset (403)", s == 403, s)
        s, b = admin.call("POST", f"/ws/ioeti/admin/users/{person['id']}/mfa/reset", {})
        check("reset: an administrator resets it", s == 200 and obj(b).get("enabled") is False, (s, b))
        s, b = admin.call("POST", f"/ws/ioeti/admin/users/{person['id']}/mfa/reset", {})
        check("reset: resetting what is off is refused", s == 422 and err(b)[0] == "MFA_NOT_ON", (s, err(b)))
        after = Client()
        after.call("POST", "/callback", {"username": person["code"], "password": password})
        check("reset: afterwards the password alone signs in", signed_in(after))

        # --- audit ----------------------------------------------------------------------------------------------------
        events = search(AUDIT, f"self.subject = 'USER' AND self.subjectId = {person['id']} AND self.action LIKE 'MFA_%'", ("action", "changes"))
        actions = sorted(e.get("action") for e in events)
        text = json.dumps(events)
        check("audit: enabling, new codes, turning off and the reset are logged, with no secret or code",
              actions == sorted(["MFA_ENABLED", "MFA_ENABLED", "MFA_RECOVERY_CODES", "MFA_DISABLED", "MFA_RESET"])
              and secret not in text and all(code not in text for code in recovery + fresh), actions)
        created.extend((AUDIT, e["id"]) for e in events)
        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
    finally:
        if person:
            created.extend((MFA, m["id"]) for m in search(MFA, f"self.owner.id = {person['id']}"))
        order = {AUDIT: 0, MFA: 1, USER: 2}
        complete, left = cleanup(admin, list(dict.fromkeys(created)), order)
        if not complete:
            print(f"FAIL cleanup left {left}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "mfa-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
