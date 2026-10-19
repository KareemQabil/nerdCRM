#!/usr/bin/env python3
"""End-to-end checks of the IOETI business line slice against a RUNNING local Axelor instance.

Covers: login, IOETI REST API, generic /ws/rest API, repository validation, the Opportunity
listener, and record-level / model-level permissions for a non-admin user.

Usage:  python3 scripts/api_smoke_test.py            (reads .env for the port)
Env:    IOETI_ADMIN_USER / IOETI_ADMIN_PASSWORD (default admin/admin, dev only)
Writes a JSON report to logs/api-smoke-test.json and exits non-zero on any failure.
"""
import http.cookiejar
import json
import os
import glob
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_env():
    env = {}
    path = os.path.join(ROOT, ".env")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k] = v
    return env


ENV = load_env()
BASE = f"http://localhost:{ENV.get('IOETI_APP_PORT', '8080')}/axelor-erp"
BL = "com.ioeti.businessline.db.BusinessLine"
OPP = "com.axelor.apps.crm.db.Opportunity"
RESULTS = []


class Client:
    def __init__(self):
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, method, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(BASE + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")
        try:
            with self.opener.open(req, timeout=60) as resp:
                raw = resp.read().decode() or "{}"
                return resp.status, json.loads(raw)
        except urllib.error.HTTPError as err:
            raw = err.read().decode()
            try:
                return err.code, json.loads(raw)
            except ValueError:
                return err.code, {"raw": raw[:300]}

    def login(self, user, password):
        status, _ = self.call("POST", "/callback", {"username": user, "password": password})
        return status


def axelor_password_hash(plain):
    """Hash with Axelor's own Shiro 2 PasswordService (argon2id) using the jars of the build.

    The generic /ws/rest API stores the User.password value as given (it does not hash it), so a
    test user must be created with an already hashed password.
    """
    cache = os.path.expanduser("~/.gradle/caches/modules-2/files-2.1")
    groups = ["org.apache.shiro", "org.apache.shiro.crypto", "org.bouncycastle",
              "org.slf4j/slf4j-api", "org.apache.commons/commons-lang3"]
    latest = {}
    for group in groups:
        for jar in glob.glob(f"{cache}/{group}/**/*.jar", recursive=True):
            if jar.endswith("-sources.jar"):
                continue
            artifact, version = jar.split("/")[-4], jar.split("/")[-3]
            key = tuple(int(x) for x in re.findall(r"\d+", version)[:3])
            if artifact not in latest or key > latest[artifact][0]:
                latest[artifact] = (key, jar)
    classpath = os.pathsep.join(j for _, j in latest.values())
    helper = os.path.join(ROOT, "scripts", "support", "HashPassword.java")
    out = subprocess.run(["java", "-cp", classpath, helper, plain], capture_output=True, text=True,
                         check=True)
    return [l for l in out.stdout.splitlines() if l.startswith("$shiro")][0]


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": detail})
    print(("PASS " if condition else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


def ok(payload):
    return isinstance(payload, dict) and payload.get("status") == 0


def rest_create(client, model, data):
    return client.call("PUT", f"/ws/rest/{model}", {"data": data})


def main():
    admin = Client()
    check("admin login", admin.login(ENV.get("IOETI_ADMIN_USER", os.environ.get("IOETI_ADMIN_USER", "admin")),
                                      os.environ.get("IOETI_ADMIN_PASSWORD", "admin")) == 200)

    # --- IOETI REST API (custom controller) -------------------------------------------------
    status, body = admin.call("GET", "/ws/ioeti/business-lines")
    codes = [l["code"] for l in body.get("object", [])] if isinstance(body, dict) else []
    check("GET /ws/ioeti/business-lines returns the 5 seeded lines",
          status == 200 and {"ISO9001", "ISO22000", "TRAINING", "RECRUITMENT", "FUNDRAISING"} <= set(codes),
          f"http={status} codes={codes}")
    status, body = admin.call("GET", "/ws/ioeti/business-lines/iso22000")
    obj = body.get("object", {}) if isinstance(body, dict) else {}
    check("GET /ws/ioeti/business-lines/{code} is case-insensitive and returns Arabic name",
          status == 200 and obj.get("code") == "ISO22000" and obj.get("nameAr") == "أيزو 22000",
          f"http={status} body={obj}")

    # --- validation through the generic API (repository save) -----------------------------
    status, body = rest_create(admin, BL, {"code": "x", "nameEn": "Bad", "nameAr": "No Arabic", "statusSelect": 2})
    check("generic API rejects invalid business line (repository validation)",
          not ok(body), f"http={status} body={json.dumps(body, ensure_ascii=False)[:160]}")

    suffix = secrets.token_hex(3).upper()
    test_code = f"TST_SUSP_{suffix}"
    status, body = rest_create(admin, BL, {"code": test_code.lower(), "nameEn": "Test suspended",
                                           "nameAr": "خط تجريبي موقوف", "statusSelect": 3})
    created = ok(body)
    line_id = body["data"][0]["id"] if created else None
    stored_code = body["data"][0].get("code") if created else None
    check("generic API creates a suspended test line and normalises its code",
          created and stored_code == test_code, f"http={status} code={stored_code}")

    # --- Opportunity listener -----------------------------------------------------------------
    status, body = rest_create(admin, OPP, {"name": f"Opp on suspended {suffix}",
                                            "ioetiBusinessLine": {"id": line_id}})
    check("opportunity on a suspended business line is rejected (JPA listener)",
          not ok(body) and "not active" in json.dumps(body), f"http={status}")
    status, body = admin.call("GET", "/ws/ioeti/business-lines/ISO9001")
    iso_id = body.get("object", {}).get("id")
    status, body = rest_create(admin, OPP, {"name": f"Opp on ISO 9001 {suffix}",
                                            "ioetiBusinessLine": {"id": iso_id}})
    opp_id = body["data"][0]["id"] if ok(body) else None
    check("opportunity on an active business line is accepted", opp_id is not None,
          f"http={status} body={json.dumps(body)[:160]}")

    # --- non-admin user in the viewer group -------------------------------------------------
    status, body = admin.call("POST", "/ws/rest/com.axelor.auth.db.Group/search",
                              {"data": {"_domain": "self.code = 'ioeti-bl-viewer'"}, "fields": ["code"]})
    group_id = body["data"][0]["id"] if ok(body) and body.get("data") else None
    viewer_login = f"ioeti.viewer.{suffix.lower()}"
    viewer_password = "Iv!" + secrets.token_urlsafe(12)
    status, body = rest_create(admin, "com.axelor.auth.db.User",
                               {"code": viewer_login, "name": "IOETI test viewer",
                               "password": axelor_password_hash(viewer_password), "blocked": False,
                                "group": {"id": group_id}, "language": "en"})
    user_id = body["data"][0]["id"] if ok(body) else None
    check("test viewer user created in group ioeti-bl-viewer", user_id is not None and group_id is not None,
          f"http={status} body={json.dumps(body)[:160]}")

    viewer = Client()
    check("viewer login", viewer.login(viewer_login, viewer_password) == 200)

    status, body = viewer.call("GET", "/ws/ioeti/business-lines")
    vcodes = [l["code"] for l in body.get("object", [])] if isinstance(body, dict) else []
    check("NEG viewer list via IOETI API hides the suspended line (record-level condition)",
          status == 200 and test_code not in vcodes and "ISO9001" in vcodes, f"http={status} codes={vcodes}")
    status, body = viewer.call("GET", f"/ws/ioeti/business-lines/{test_code}")
    check("NEG viewer cannot fetch the suspended line by code", status == 404,
          f"http={status} body={json.dumps(body, ensure_ascii=False)[:200]}")

    status, body = viewer.call("POST", f"/ws/rest/{BL}/search", {"fields": ["code"], "limit": 50})
    check("NEG generic /ws/rest is closed to non-maintenance users (SEC-002)",
          status == 403 and "data" not in body, f"http={status}")

    status, body = viewer.call("POST", f"/ws/rest/{BL}/{iso_id}", {"data": {"id": iso_id, "nameEn": "hacked"}})
    check("NEG viewer cannot update a business line (no write permission)",
          not ok(body) or status in (401, 403), f"http={status} body={json.dumps(body)[:120]}")

    status, body = viewer.call("POST", f"/ws/rest/{OPP}/search", {"fields": ["name"], "limit": 5})
    check("NEG viewer cannot read opportunities (deny by default)",
          not ok(body) or status in (401, 403), f"http={status} body={json.dumps(body)[:120]}")

    status, body = Client().call("GET", "/ws/ioeti/business-lines")
    check("NEG anonymous call to IOETI API is refused", status in (401, 403) or (status == 200 and "object" not in body),
          f"http={status}")

    # --- cleanup of test records (admin) ---------------------------------------------------------
    cleanup = []
    for model, rid in ((OPP, opp_id), (BL, line_id), ("com.axelor.auth.db.User", user_id)):
        if rid:
            s, b = admin.call("DELETE", f"/ws/rest/{model}/{rid}")
            cleanup.append(f"{model.split('.')[-1]}:{'ok' if ok(b) else s}")
    check("cleanup of test records", all(c.endswith(":ok") for c in cleanup), ", ".join(cleanup))

    os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
    with open(os.path.join(ROOT, "logs", "api-smoke-test.json"), "w", encoding="utf-8") as out:
        json.dump({"base": BASE, "results": RESULTS}, out, ensure_ascii=False, indent=2)
    failed = [r for r in RESULTS if r["result"] != "PASS"]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
