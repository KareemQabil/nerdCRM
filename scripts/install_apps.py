#!/usr/bin/env python3
"""Install the Axelor Open Suite "apps" IOETI reuses (idempotent).

A fresh AOS database has every functional app uninstalled: menus guarded by
__config__.app.isApp('crm') stay hidden and app init data (sequences, defaults) is missing.
This calls the same server action as the Apps screen (AppController:installApp).

Usage: python3 scripts/install_apps.py [app-code ...]   (default: IOETI baseline list)
Env:   IOETI_ADMIN_USER / IOETI_ADMIN_PASSWORD (default admin/admin, dev only)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import Client  # noqa: E402  (shared tiny HTTP client)

# Order matters only for readability; installApp also installs declared dependencies.
DEFAULT_APPS = ["base", "crm", "sale", "contract", "project", "intervention", "quality",
                "marketing", "gdpr"]


def main(codes):
    admin = Client()
    if admin.login(os.environ.get("IOETI_ADMIN_USER", "admin"),
                   os.environ.get("IOETI_ADMIN_PASSWORD", "admin")) != 200:
        print("admin login failed")
        return 1
    _, body = admin.call("POST", "/ws/rest/com.axelor.studio.db.App/search",
                         {"fields": ["code", "active"], "limit": 200})
    apps = {a["code"]: a for a in body.get("data", [])}
    failed = 0
    for code in codes:
        app = apps.get(code)
        if app is None:
            print(f"SKIP {code}: unknown app")
            failed += 1
            continue
        if app.get("active"):
            print(f"OK   {code}: already installed")
            continue
        _, res = admin.call("POST", "/ws/action", {
            "action": "com.axelor.studio.app.web.AppController:installApp",
            "model": "com.axelor.studio.db.App",
            "data": {"context": {"_model": "com.axelor.studio.db.App", "id": app["id"],
                                 "code": code, "languageSelect": "en"}}})
        good = res.get("status") == 0
        failed += 0 if good else 1
        print(f"{'OK  ' if good else 'FAIL'} {code}: {'installed' if good else str(res)[:200]}")
    _, body = admin.call("POST", "/ws/rest/com.axelor.studio.db.App/search",
                         {"fields": ["code", "active"], "limit": 200})
    active = sorted(a["code"] for a in body.get("data", []) if a.get("active"))
    print("active apps:", ", ".join(active))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or DEFAULT_APPS))
