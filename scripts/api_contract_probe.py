#!/usr/bin/env python3
"""SEC-002 live probe: IOETI API error contract, existence oracle and generic API exposure.

Run against a RUNNING local/CI Axelor with the CRM app installed; never against production.
Creates throw-away users, permissions, partners, leads, a suspended business line and
opportunities, and deletes them at the end (an incomplete cleanup fails the run).

Checks (each one a PASS/FAIL row in logs/api-contract-probe.json, no bodies or credentials stored):
- a record outside the caller's scope and a non-existent id give the same status, code and message
- every IOETI error follows {codeStatus, messageStatus, error{code,message,correlationId,fields}}
  and echoes the X-Correlation-Id header; no internal class/SQL/stack text in any error body
- malformed JSON 400, wrong method 405, wrong content type 415, unknown path 404, validation 422
- generic Axelor APIs (/ws/rest, /ws/action, /ws/meta, /ws/app) refused (403) for ordinary users,
  still available to the administrator
- the account list returns full pages of client accounts only
"""
import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import BASE, BL, ENV, OPP, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PARTNER, LEAD = "com.axelor.apps.base.db.Partner", "com.axelor.apps.crm.db.Lead"
MISSING_ID = 987654321
INTERNAL = re.compile(r"com\.axelor|com\.ioeti|org\.|jakarta\.|hibernate|Exception|SQL|_pkey|crm_|"
                      r"\bat [a-z]+\.[a-z]|stack|duplicate key|constraint", re.IGNORECASE)
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:200]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def raw(client, method, path, body=None, content_type="application/json", headers=None):
    """Like Client.call but returns headers too and accepts raw bodies."""
    data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", content_type)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with client.opener.open(req, timeout=60) as resp:
            text = resp.read().decode() or "{}"
            return resp.status, dict(resp.headers), text
    except urllib.error.HTTPError as err:
        return err.code, dict(err.headers), err.read().decode()


def parse(text):
    try:
        return json.loads(text)
    except ValueError:
        return {}


def contract_ok(status, headers, text, expected_status=None, expected_code=None):
    body = parse(text)
    err = body.get("error") if isinstance(body, dict) else None
    cid = headers.get("X-Correlation-Id")
    good = (isinstance(err, dict) and body.get("codeStatus") == status
            and isinstance(err.get("code"), str) and isinstance(err.get("message"), str)
            and isinstance(err.get("fields"), list) and err.get("correlationId") == cid and cid)
    if expected_status is not None:
        good = good and status == expected_status
    if expected_code is not None:
        good = good and err.get("code") == expected_code
    return bool(good) and not INTERNAL.search(text), body


def main():
    admin = Client()
    assert admin.login(os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin")),
                       os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
    tag = secrets.token_hex(3)
    created = []

    def create(model, values):
        _, body = rest_create(admin, model, values)
        if not ok(body):
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}: {json.dumps(body)[:200]}")
        created.append((model, body["data"][0]["id"]))
        return body["data"][0]

    exit_code = 1
    try:
        # --- fixtures --------------------------------------------------------------------------------
        own = lambda obj, name: create(PERM, {"name": f"sec002.{name}.{tag}", "object": obj, "canRead": True,
                                              "condition": "self.user = ?", "conditionParams": "__user__"})
        perms = [own(OPP, "opp"), own(LEAD, "lead"), own(PARTNER, "partner"),
                 create(PERM, {"name": f"sec002.line.{tag}", "object": BL, "canRead": True,
                               "condition": "self.statusSelect = 2"})]
        group = create(GROUP, {"code": f"sec002-{tag}", "name": "SEC-002 sales",
                               "permissions": [{"id": p["id"]} for p in perms]})
        login, password = f"sec002.a.{tag}", "S2!" + secrets.token_urlsafe(14)
        user_a = create(USER, {"code": login, "name": "SEC-002 A", "blocked": False, "language": "en",
                               "password": axelor_password_hash(password), "group": {"id": group["id"]}})
        _, lines = admin.call("GET", "/ws/ioeti/business-lines")
        iso = next(l for l in lines["object"] if l["code"] == "ISO9001")
        suspended = create(BL, {"code": f"SEC002_{tag.upper()}", "nameEn": "SEC-002 suspended",
                                "nameAr": "خط موقوف للاختبار", "statusSelect": 3})
        opp_a = create(OPP, {"name": f"SEC-002 own {tag}", "user": {"id": user_a["id"]},
                             "ioetiBusinessLine": {"id": iso["id"]}})
        opp_other = create(OPP, {"name": f"SEC-002 other {tag}", "ioetiBusinessLine": {"id": iso["id"]}})
        lead_other = create(LEAD, {"name": f"SEC002 Lead {tag}", "firstName": "Probe"})
        clients = [create(PARTNER, {"name": f"SEC-002 client {i} {tag}", "partnerTypeSelect": 1,
                                    "isCustomer": True}) for i in range(6)]
        for i in range(3):  # newest ids are NOT client accounts: the old list underfilled here
            create(PARTNER, {"name": f"SEC-002 supplier {i} {tag}", "partnerTypeSelect": 1,
                             "isSupplier": True, "isCustomer": False, "isProspect": False})
        a = Client()
        assert a.login(login, password) == 200

        # --- existence oracle: hidden record vs missing id -------------------------------------------
        for name, hidden, missing in (
            ("GET opportunity", f"/ws/ioeti/opportunities/{opp_other['id']}", f"/ws/ioeti/opportunities/{MISSING_ID}"),
            ("GET lead", f"/ws/ioeti/leads/{lead_other['id']}", f"/ws/ioeti/leads/{MISSING_ID}"),
            ("GET account", f"/ws/ioeti/accounts/{clients[0]['id']}", f"/ws/ioeti/accounts/{MISSING_ID}"),
            ("GET business line", f"/ws/ioeti/business-lines/{suspended['code']}", "/ws/ioeti/business-lines/NOPE_X1"),
        ):
            s1, h1, t1 = raw(a, "GET", hidden)
            s2, h2, t2 = raw(a, "GET", missing)
            b1, b2 = parse(t1).get("error", {}), parse(t2).get("error", {})
            check(f"no existence oracle: {name}", s1 == s2 == 404 and b1.get("code") == b2.get("code")
                  and b1.get("message") == b2.get("message"), f"hidden={s1} missing={s2}")
        s1, _, t1 = raw(a, "PUT", f"/ws/ioeti/opportunities/{opp_other['id']}", {"name": "x" * 5, "version": 0})
        s2, _, t2 = raw(a, "PUT", f"/ws/ioeti/opportunities/{MISSING_ID}", {"name": "x" * 5, "version": 0})
        check("no existence oracle: PUT opportunity", s1 == s2 == 404, f"hidden={s1} missing={s2}")
        s, h, t = raw(a, "PUT", f"/ws/ioeti/opportunities/{opp_a['id']}", {"name": "SEC-002 rename", "version": opp_a["version"]})
        good, _ = contract_ok(s, h, t, 403, "FORBIDDEN")
        check("readable but not writable: 403 FORBIDDEN (existence already known)", good, f"http={s}")
        s, _, t = raw(a, "GET", f"/ws/ioeti/opportunities/{opp_a['id']}")
        check("own record still readable", s == 200 and parse(t).get("object", {}).get("id") == opp_a["id"], f"http={s}")

        # --- error contract ---------------------------------------------------------------------------
        cases = [
            ("missing id", a, "GET", f"/ws/ioeti/leads/{MISSING_ID}", None, "application/json", 404, "NOT_FOUND"),
            ("malformed JSON", admin, "POST", "/ws/ioeti/opportunities", b"{not json", "application/json", 400, None),
            ("wrong content type", admin, "POST", "/ws/ioeti/opportunities", b"name=x", "text/plain", 415, None),
            ("unknown IOETI path", a, "GET", "/ws/ioeti/does-not-exist", None, "application/json", 404, None),
            ("method not allowed", a, "DELETE", "/ws/ioeti/leads", None, "application/json", 405, None),
            ("bad pagination", a, "GET", "/ws/ioeti/leads?limit=500", None, "application/json", 400, "INVALID_REQUEST"),
            ("missing version", admin, "PUT", f"/ws/ioeti/opportunities/{opp_a['id']}", {"name": "abc"}, "application/json", 400, "INVALID_REQUEST"),
            ("stale version", admin, "PUT", f"/ws/ioeti/opportunities/{opp_a['id']}", {"name": "abcd", "version": 999}, "application/json", 409, "CONFLICT"),
            ("model-level denied", Client(), "GET", "/ws/ioeti/opportunities", None, "application/json", 401, None),
        ]
        for name, client, method, path, body, ctype, exp_status, exp_code in cases:
            s, h, t = raw(client, method, path, body, ctype, {"X-Correlation-Id": f"probe-{tag}-{len(RESULTS)}"})
            if exp_status == 401:  # Shiro/pac4j answers before JAX-RS; only the status is contractual
                check(f"error contract: {name}", s == 401, f"http={s}")
                continue
            good, parsed = contract_ok(s, h, t, exp_status, exp_code)
            echoed = h.get("X-Correlation-Id", "").startswith(f"probe-{tag}-")
            check(f"error contract: {name}", good and echoed, f"http={s} code={parsed.get('error', {}).get('code')}")
        s, h, t = raw(admin, "POST", "/ws/ioeti/opportunities", {"name": "ab", "businessLineCode": "ISO9001"})
        good, body = contract_ok(s, h, t, 422, "VALIDATION_FAILED")
        check("validation: field error for name", good and body["error"]["fields"][0]["field"] == "name", f"http={s}")
        s1, _, t1 = raw(admin, "POST", "/ws/ioeti/opportunities", {"name": "abcd", "businessLineCode": suspended["code"]})
        s2, _, t2 = raw(admin, "POST", "/ws/ioeti/opportunities", {"name": "abcd", "businessLineCode": "NO_SUCH_LINE"})
        check("validation: inactive and unknown line rejected identically",
              s1 == s2 == 422 and parse(t1)["error"] == {**parse(t2)["error"], "correlationId": parse(t1)["error"]["correlationId"]},
              f"inactive={s1} unknown={s2}")
        s, h, _ = raw(a, "GET", "/ws/ioeti/business-lines")
        check("success responses carry X-Correlation-Id", s == 200 and bool(h.get("X-Correlation-Id")), f"http={s}")

        # --- generic Axelor API exposure ---------------------------------------------------------------
        for name, method, path, body in (
            ("rest search", "POST", f"/ws/rest/{OPP}/search", {"fields": ["name"], "limit": 5}),
            ("rest fetch", "POST", f"/ws/rest/{OPP}/{opp_a['id']}/fetch", {"fields": ["name"]}),
            ("rest update", "POST", f"/ws/rest/{OPP}/{opp_a['id']}", {"data": {"id": opp_a["id"], "name": "pwn"}}),
            ("action", "POST", "/ws/action", {"action": "com.axelor.meta.web.MetaController:restoreAll", "data": {}}),
            ("meta", "GET", f"/ws/meta/fields/{OPP}", None),
            ("app info", "GET", "/ws/app/info", None),
        ):
            s, h, t = raw(a, method, path, body)
            good, _ = contract_ok(s, h, t, 403, "FORBIDDEN")
            check(f"generic API closed to ordinary users: {name}", good and "data" not in parse(t), f"http={s}")
        s, _, t = raw(admin, "POST", f"/ws/rest/{OPP}/search", {"fields": ["name"], "limit": 1})
        check("generic API still available to the administrator", s == 200 and parse(t).get("status") == 0, f"http={s}")
        _, after = admin.call("POST", f"/ws/rest/{OPP}/{opp_a['id']}/fetch", {"fields": ["name"]})
        check("refused generic write left the record unchanged",
              (after.get("data") or [{}])[0].get("name") == opp_a["name"])

        # --- account list: full pages of client accounts ----------------------------------------------
        s, _, t = raw(admin, "GET", "/ws/ioeti/accounts?limit=5")
        names = [r["name"] for r in parse(t).get("object") or []]
        check("account list returns a full page", s == 200 and len(names) == 5, f"returned={len(names)}")
        check("account list contains client accounts only", not any("supplier" in n for n in names))
        for path, allowed in (("/ws/ioeti/accounts?limit=5", {"id", "name", "reference", "customer", "prospect"}),
                              ("/ws/ioeti/opportunities?limit=5", {"id", "version", "name", "reference", "businessLineCode",
                                                                    "businessLineNameAr", "businessLineNameEn", "stage"})):
            _, _, t = raw(admin, "GET", path)
            check(f"DTO allowlist: {path.split('?')[0]}",
                  all(set(r) <= allowed for r in parse(t).get("object") or []))

        failed = [r for r in RESULTS if r["result"] != "PASS"]
        print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
        exit_code = 0 if not failed else 1
    finally:
        order = {OPP: 0, LEAD: 1, PARTNER: 2, USER: 3, GROUP: 4, PERM: 5, BL: 6}
        results = []
        for model, rid in sorted(reversed(created), key=lambda c: order.get(c[0], 9)):
            _, body = admin.call("DELETE", f"/ws/rest/{model}/{rid}")
            results.append(ok(body))
        complete = all(results)
        print("CLEANUP", "complete" if complete else "INCOMPLETE", len(results))
        if not complete:
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "api-contract-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
