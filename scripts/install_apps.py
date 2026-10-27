#!/usr/bin/env python3
"""Install the Axelor Open Suite "apps" IOETI reuses (idempotent).

A fresh AOS database has every functional app uninstalled: menus guarded by
__config__.app.isApp('crm') stay hidden and app init data (sequences, defaults) is missing.
This calls the same server action as the Apps screen (AppController:installApp).

App init data ships only in English and French. Without an app language, Axelor imports it in
application.locale; with "ar" every init-data file is missing (no lead statuses, sequences...) while
the install still reports success. Apps are therefore installed in English, and apps that were
already installed that way are repaired (re-installed with English init data).

Usage: python3 scripts/install_apps.py [app-code ...]   (default: IOETI baseline list)
Env:   IOETI_ADMIN_USER / IOETI_ADMIN_PASSWORD (default admin/admin, dev only)
       IOETI_LOCALE: the application.locale the server runs with (used to detect the repair case)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import Client  # noqa: E402  (shared tiny HTTP client)

# Order matters only for readability; installApp also installs declared dependencies.
DEFAULT_APPS = ["base", "crm", "sale", "contract", "project", "intervention", "quality",
                "marketing", "gdpr"]
DATA_LANGUAGES = ("en", "fr")
APP = "/ws/rest/com.axelor.studio.db.App"


def set_data_language(admin, apps):
    """Pin every app to English init data; un-install apps whose init data was imported in an
    unsupported application locale so that installApp imports it again."""
    locale = (os.environ.get("IOETI_LOCALE") or "").strip()
    broken_locale = bool(locale) and locale not in DATA_LANGUAGES
    repaired = []
    for app in apps.values():
        if app.get("languageSelect") in DATA_LANGUAGES:
            continue
        values = {"id": app["id"], "version": app["version"], "languageSelect": "en"}
        # installed in an unsupported language (stored on the app, or taken from application.locale)
        if app.get("active") and (app.get("languageSelect") or broken_locale):
            values.update(active=False, initDataLoaded=False)
            repaired.append(app["code"])
        _, res = admin.call("POST", f"{APP}/{app['id']}", {"data": values})
        if res.get("status") != 0:
            print(f"FAIL {app['code']}: could not set the data language: {str(res)[:200]}")
            return None
    if repaired:
        print(f"REPAIR init data imported in an unsupported language: re-installing {', '.join(sorted(repaired))}")
    return repaired


def main(codes):
    admin = Client()
    if admin.login(os.environ.get("IOETI_ADMIN_USER", "admin"),
                   os.environ.get("IOETI_ADMIN_PASSWORD", "admin")) != 200:
        print("admin login failed")
        return 1
    fields = ["code", "active", "languageSelect", "version"]
    _, body = admin.call("POST", f"{APP}/search", {"fields": fields, "limit": 200})
    repaired = set_data_language(admin, {a["code"]: a for a in body.get("data", [])})
    if repaired is None:
        return 1
    _, body = admin.call("POST", f"{APP}/search", {"fields": fields, "limit": 200})
    apps = {a["code"]: a for a in body.get("data", [])}
    failed = 0
    for code in list(codes) + [c for c in repaired if c not in codes]:
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
    _, body = admin.call("POST", f"{APP}/search", {"fields": ["code", "active"], "limit": 200})
    active = sorted(a["code"] for a in body.get("data", []) if a.get("active"))
    print("active apps:", ", ".join(active))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or DEFAULT_APPS))
