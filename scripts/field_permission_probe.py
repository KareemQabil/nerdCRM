#!/usr/bin/env python3
"""Probe: is an Axelor field-level rule (MetaPermission, canRead=false) enforced by the APIs?

Creates (and removes afterwards) a throw-away group + user + MetaPermission hiding
BusinessLine.description, then reads business lines as that user through
  1. the generic /ws/rest search API, and
  2. the IOETI /ws/ioeti/business-lines API.
Result is printed and written to logs/field-permission-probe.json. Requires a running app.
"""
import json
import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import Client, ROOT, axelor_password_hash, ok, rest_create  # noqa: E402

BL = "com.ioeti.businessline.db.BusinessLine"


def main():
    admin = Client()
    assert admin.login(os.environ.get("IOETI_ADMIN_USER", "admin"),
                       os.environ.get("IOETI_ADMIN_PASSWORD", "admin")) == 200
    tag = secrets.token_hex(3)
    created = []

    _, b = rest_create(admin, "com.axelor.auth.db.Permission",
                       {"name": f"perm.probe.{tag}", "object": BL, "canRead": True})
    perm_id = b["data"][0]["id"]
    created.append(("com.axelor.auth.db.Permission", perm_id))
    _, b = rest_create(admin, "com.axelor.meta.db.MetaPermission",
                       {"name": f"meta.probe.{tag}", "object": BL, "active": True,
                        "rules": [{"field": "description", "canRead": False, "canWrite": False,
                                   "canExport": False}]})
    meta_id = b["data"][0]["id"] if ok(b) else None
    created.append(("com.axelor.meta.db.MetaPermission", meta_id))
    _, b = rest_create(admin, "com.axelor.auth.db.Group",
                       {"code": f"probe-{tag}", "name": f"Probe {tag}",
                        "permissions": [{"id": perm_id}], "metaPermissions": [{"id": meta_id}]})
    group_id = b["data"][0]["id"]
    created.append(("com.axelor.auth.db.Group", group_id))
    login, password = f"probe.{tag}", "Pr!" + secrets.token_urlsafe(12)
    _, b = rest_create(admin, "com.axelor.auth.db.User",
                       {"code": login, "name": "probe", "password": axelor_password_hash(password),
                        "blocked": False, "group": {"id": group_id}})
    user_id = b["data"][0]["id"]
    created.insert(0, ("com.axelor.auth.db.User", user_id))

    user = Client()
    assert user.login(login, password) == 200
    _, generic = user.call("POST", f"/ws/rest/{BL}/search",
                           {"fields": ["code", "description"], "limit": 1,
                            "data": {"_domain": "self.code = 'ISO9001'"}})
    _, fetched = user.call("POST", f"/ws/rest/{BL}/1/fetch", {"fields": ["code", "description"]})
    _, custom = user.call("GET", "/ws/ioeti/business-lines/ISO9001")
    _, admin_view = admin.call("POST", f"/ws/rest/{BL}/search",
                               {"fields": ["code", "description"], "limit": 1,
                                "data": {"_domain": "self.code = 'ISO9001'"}})

    def desc(payload):
        data = payload.get("data") if isinstance(payload, dict) else None
        if isinstance(data, list) and data:
            return data[0].get("description", "<field absent>")
        return f"<no data: {str(payload)[:120]}>"

    _, grp = admin.call("POST", f"/ws/rest/com.axelor.auth.db.Group/{group_id}/fetch",
                        {"fields": ["code", "metaPermissions", "permissions"]})
    _, rules = admin.call("POST", "/ws/rest/com.axelor.meta.db.MetaPermissionRule/search",
                          {"fields": ["field", "canRead"],
                           "data": {"_domain": f"self.metaPermission.id = {meta_id or 0}"}})
    report = {
        "setup_meta_permission_id": meta_id,
        "setup_group_meta_permissions": [m.get("id") for m in (grp.get("data") or [{}])[0].get("metaPermissions") or []],
        "setup_rules": [(r.get("field"), r.get("canRead")) for r in rules.get("data") or []],
        "admin_generic_search_description": desc(admin_view),
        "restricted_generic_search_description": desc(generic),
        "restricted_generic_fetch_description": desc(fetched),
        "restricted_ioeti_api_keys": sorted((custom.get("object") or {}).keys()),
    }
    # delete dependants first: user, group, then the permissions the group referenced
    order = ["com.axelor.auth.db.User", "com.axelor.auth.db.Group",
             "com.axelor.meta.db.MetaPermission", "com.axelor.auth.db.Permission"]
    for model, rid in sorted(created, key=lambda c: order.index(c[0])):
        if rid:
            _, res = admin.call("DELETE", f"/ws/rest/{model}/{rid}")
            report.setdefault("cleanup", []).append(f"{model.split('.')[-1]}:{'ok' if ok(res) else 'FAILED'}")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    with open(os.path.join(ROOT, "logs", "field-permission-probe.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
