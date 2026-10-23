#!/usr/bin/env python3
"""One-time bootstrap inside the Railway container, run by start.sh after Tomcat starts.

1. waits for Axelor; while the default admin/admin still works, replaces it with IOETI_ADMIN_PASSWORD
   (a public URL must never keep the default password)
2. installs the Axelor apps IOETI reuses (idempotent: installed apps are skipped)
3. when IOETI_SHOWCASE_PASSWORD is set and no showcase exists yet, seeds the fictional showcase
   (scripts/showcase_seed.py, without policy-blocked demonstration states); every fictional person
   signs in with that password
Nothing here prints a secret.
"""
import json
import os
import subprocess
import sys
import time

ROOT = os.environ.get("IOETI_ROOT", "/opt/ioeti")
os.environ.setdefault("IOETI_BASE_URL", "http://127.0.0.1:8080/axelor-erp")
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from api_smoke_test import Client, axelor_password_hash, ok  # noqa: E402

USER = "com.axelor.auth.db.User"


def log(message):
    print(f"[ioeti-bootstrap] {message}", flush=True)


def wait_for_axelor(limit=1800):
    start = time.time()
    while time.time() - start < limit:
        try:
            status, _ = Client().call("GET", "/ws/ioeti/session")
            if status in (200, 401, 403):
                return True
        except Exception:  # noqa: BLE001 - not up yet
            pass
        time.sleep(10)
    return False


def main():
    if not wait_for_axelor():
        log("Axelor did not start in time; bootstrap skipped")
        return 1
    password = os.environ["IOETI_ADMIN_PASSWORD"]
    default = Client()
    if default.login("admin", "admin") == 200:
        _, body = default.call("POST", f"/ws/rest/{USER}/search", {"fields": ["id", "version"], "data": {"_domain": "self.code = 'admin'"}})
        row = (body.get("data") or [{}])[0]
        _, saved = default.call("POST", f"/ws/rest/{USER}/{row.get('id')}",
                                {"data": {"id": row.get("id"), "version": row.get("version"), "password": axelor_password_hash(password)}})
        log("default admin password replaced" if ok(saved) else "FAILED to replace the default admin password")
        if not ok(saved):
            return 1
    admin = Client()
    if admin.login("admin", password) != 200:
        log("admin sign-in with IOETI_ADMIN_PASSWORD failed; bootstrap stopped")
        return 1
    env = {**os.environ, "IOETI_ADMIN_USER": "admin", "IOETI_ADMIN_PASSWORD": password}
    result = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "install_apps.py")], env=env, capture_output=True, text=True)
    log("apps: " + (result.stdout.strip().splitlines() or ["(no output)"])[-1])
    if os.environ.get("IOETI_SHOWCASE_PASSWORD"):
        _, found = admin.call("POST", f"/ws/rest/{USER}/search", {"fields": ["id"], "data": {"_domain": "self.code = 'showcase.sara'"}})
        if found.get("data"):
            log("showcase already present")
        else:
            seeded = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "showcase_seed.py"), "setup"], env=env,
                                    capture_output=True, text=True)
            log("showcase: " + ((seeded.stdout.strip().splitlines() or [""])[-1] or seeded.stderr.strip()[-300:]))
    log("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
