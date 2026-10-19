#!/usr/bin/env python3
"""Probe: does a non-admin user intermittently bypass record-level permission filters?

Observed in scripts/api_smoke_test.py: the 'viewer' sometimes sees a suspended business line that
its permission condition (self.statusSelect = 2) must hide. This probe measures the leak rate
under different preceding admin activity. Report: logs/record-filter-leak-probe.json.
Requires a running app. Cleans up its records.
"""
import json
import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import BL, OPP, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402

N = int(os.environ.get("PROBE_ROUNDS", "20"))


def viewer_round(viewer, code):
    """Return (list_leaked, get_leaked, generic_leaked) for one round."""
    _, body = viewer.call("GET", "/ws/ioeti/business-lines")
    list_leak = code in [l["code"] for l in (body.get("object") or [])]
    status, _ = viewer.call("GET", f"/ws/ioeti/business-lines/{code}")
    get_leak = status == 200
    _, body = viewer.call("POST", f"/ws/rest/{BL}/search",
                          {"fields": ["code"], "data": {"_domain": f"self.code = '{code}'"}})
    generic_leak = bool(body.get("data"))
    return list_leak, get_leak, generic_leak


def main():
    admin = Client()
    assert admin.login(os.environ.get("IOETI_ADMIN_USER", "admin"),
                       os.environ.get("IOETI_ADMIN_PASSWORD", "admin")) == 200
    tag = secrets.token_hex(2).upper()
    code = f"PROBE_SUSP_{tag}"
    _, b = rest_create(admin, BL, {"code": code, "nameEn": "probe", "nameAr": "اختبار", "statusSelect": 3})
    line_id = b["data"][0]["id"]
    _, b = admin.call("POST", "/ws/rest/com.axelor.auth.db.Group/search",
                      {"data": {"_domain": "self.code = 'ioeti-bl-viewer'"}, "fields": ["code"]})
    group_id = b["data"][0]["id"]
    login, password = f"probe.viewer.{tag.lower()}", "Pv!" + secrets.token_urlsafe(10)
    _, b = rest_create(admin, "com.axelor.auth.db.User",
                       {"code": login, "name": "probe viewer", "blocked": False,
                        "password": axelor_password_hash(password), "group": {"id": group_id}})
    user_id = b["data"][0]["id"]
    viewer = Client()
    assert viewer.login(login, password) == 200

    scenarios = {}

    def run(name, before):
        counts = [0, 0, 0]
        for _ in range(N):
            before()
            for i, leaked in enumerate(viewer_round(viewer, code)):
                counts[i] += int(leaked)
        scenarios[name] = {"rounds": N, "list_leaks": counts[0], "get_leaks": counts[1],
                           "generic_leaks": counts[2]}
        print(name, scenarios[name])

    run("A_viewer_only", lambda: None)
    run("B_after_admin_read", lambda: admin.call("GET", "/ws/ioeti/business-lines"))
    run("C_after_admin_failed_opportunity_save",
        lambda: rest_create(admin, OPP, {"name": "probe", "ioetiBusinessLine": {"id": line_id}}))
    run("D_after_admin_failed_businessline_save",
        lambda: rest_create(admin, BL, {"code": "x", "nameEn": "bad", "nameAr": "bad", "statusSelect": 2}))
    run("E_viewer_only_again", lambda: None)

    for model, rid in (("com.axelor.auth.db.User", user_id), (BL, line_id)):
        admin.call("DELETE", f"/ws/rest/{model}/{rid}")
    os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
    with open(os.path.join(ROOT, "logs", "record-filter-leak-probe.json"), "w") as out:
        json.dump(scenarios, out, indent=2)


if __name__ == "__main__":
    main()
