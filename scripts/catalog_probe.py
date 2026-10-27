#!/usr/bin/env python3
"""Service catalogue managed from the platform: live probe against a RUNNING local/CI Axelor; never against
production. Roles are TEST FIXTURES from native permissions: a catalogue manager (read, write, create on
products) and a seller (read only). Every service, account and user created here is removed afterwards.
Checks:
  access: anonymous 401; a seller reads the services on sale only, and gets 403 for the whole catalogue,
  adding and changing; units and categories are offered
  adding: code upper-cased and unique ignoring case, format, required name/price/currency, price range,
  unknown currency, end before start; a new service is on sale and not yet ready to invoice
  changing: with its version (stale → 409), clearing the summary, taking a service off sale hides it from
  sellers but not from the manager
  accounting: a service with a revenue account for the manager's company shows as ready to invoice
Report: logs/catalog-probe.json.
"""
import json
import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PRODUCT, COMPANY = "com.axelor.apps.base.db.Product", "com.axelor.apps.base.db.Company"
ACCOUNT, ACCOUNT_MANAGEMENT = "com.axelor.apps.account.db.Account", "com.axelor.apps.account.db.AccountManagement"
CP = "/ws/ioeti/catalog/products"
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:240]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def obj(body):
    return (body.get("object") if isinstance(body, dict) else None) or {}


def rows(body):
    value = body.get("object") if isinstance(body, dict) else None
    return value if isinstance(value, list) else []


def field(body):
    e = (body.get("error") or {}) if isinstance(body, dict) else {}
    f = (e.get("fields") or [{}])[0]
    return f.get("field"), f.get("code")


def main():
    admin = Client()
    assert admin.login(os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin")),
                       os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
    tag = secrets.token_hex(3).upper()
    created = []

    def create(model, values):
        _, body = rest_create(admin, model, values)
        if not ok(body):
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}: {json.dumps(body)[:200]}")
        created.append((model, body["data"][0]["id"]))
        return body["data"][0]

    exit_code = 1
    try:
        # a company of its own, so the probe behaves the same on a fresh database (CI has none) and a seeded one
        _, currencies = admin.call("POST", "/ws/rest/com.axelor.apps.base.db.Currency/search",
                                   {"fields": ["id"], "limit": 1, "data": {"_domain": "self.codeISO = 'EGP'"}})
        company = create(COMPANY, {"name": f"Catalog Probe Co {tag}", "code": f"CT{tag}", "currency": {"id": currencies["data"][0]["id"]}})
        sessions = {}
        for label, rights in (("manager", dict(canRead=True, canWrite=True, canCreate=True)), ("seller", dict(canRead=True))):
            perm = create(PERM, {"name": f"catalog.{label}.{tag}", "object": PRODUCT, **rights})
            group = create(GROUP, {"code": f"catalog-{label}-{tag}", "name": f"Catalog {label} {tag}", "permissions": [{"id": perm["id"]}]})
            password = "Ct!" + secrets.token_urlsafe(14)
            create(USER, {"code": f"catalog.{label}.{tag}", "name": f"Catalog {label} {tag}", "blocked": False, "language": "ar",
                          "group": {"id": group["id"]}, "password": axelor_password_hash(password),
                          "activeCompany": {"id": company["id"]}, "companySet": [{"id": company["id"]}]})
            sessions[label] = Client()
            assert sessions[label].login(f"catalog.{label}.{tag}", password) == 200, label
        manager, seller, anon = sessions["manager"], sessions["seller"], Client()

        def add(**values):
            s, body = manager.call("POST", CP, {"name": f"يوم مراجعة {tag}", "salePrice": 4500, "currencyCode": "EGP", **values})
            if obj(body).get("id"):
                created.append((PRODUCT, obj(body)["id"]))
            return s, body

        # --- access ----------------------------------------------------------------------------------
        s1, _ = anon.call("GET", CP + "?all=true")
        s2, _ = seller.call("GET", CP + "?all=true")
        s3, _ = seller.call("POST", CP, {"code": f"X{tag}", "name": "x", "salePrice": 1, "currencyCode": "EGP"})
        s4, b4 = seller.call("GET", CP + "/units")
        s5, b5 = manager.call("GET", CP + "/categories")
        check("anonymous 401; a seller gets 403 for the whole catalogue and for adding; units and categories are offered",
              (s1, s2, s3, s4, s5) == (401, 403, 403, 200, 200), (s1, s2, s3, s4, s5))

        # --- adding ----------------------------------------------------------------------------------
        s, body = add(code=f"iso-day-{tag.lower()}", summary="يوم عمل لمراجع معتمد في موقع العميل")
        svc = obj(body)
        check("a manager adds a service: code upper-cased, on sale, not yet ready to invoice, no tax set",
              s == 201 and svc.get("code") == f"ISO-DAY-{tag}" and svc.get("onSale") is True and svc.get("accountingReady") is False
              and svc.get("type") == "service" and float(svc.get("salePrice") or 0) == 4500, (s, svc))
        bad = [
            ({"code": f"iso-DAY-{tag}"}, ("code", "DUPLICATE")),
            ({"code": "a b"}, ("code", "FORMAT")),
            ({"code": f"N{tag}", "name": " "}, ("name", "REQUIRED")),
            ({"code": f"P{tag}", "salePrice": None}, ("salePrice", "REQUIRED")),
            ({"code": f"Q{tag}", "salePrice": -1}, ("salePrice", "RANGE")),
            ({"code": f"R{tag}", "salePrice": 10.123}, ("salePrice", "RANGE")),
            ({"code": f"S{tag}", "currencyCode": "QQQ"}, ("currencyCode", "UNKNOWN")),
            ({"code": f"T{tag}", "startDate": "2026-12-01", "endDate": "2026-11-01"}, ("endDate", "BEFORE_START")),
        ]
        answers = []
        for values, expected in bad:
            s, body = add(**values)
            answers.append((s, field(body)))
        check("adding is validated: duplicate code ignoring case, format, required fields, price range, currency, dates",
              answers == [(422, e) for _, e in bad], answers)
        s, body = seller.call("GET", CP + "?q=" + f"ISO-DAY-{tag}")
        check("sellers see the new service at once (for their quotations)", any(r["id"] == svc.get("id") for r in rows(body)), rows(body))

        # --- changing --------------------------------------------------------------------------------
        s, body = manager.call("POST", f"{CP}/{svc.get('id')}", {"version": svc.get("version"), "name": f"يوم مراجعة معتمد {tag}", "salePrice": 5000, "summary": ""})
        changed = obj(body)
        s_stale, _ = manager.call("POST", f"{CP}/{svc.get('id')}", {"version": svc.get("version"), "salePrice": 1})
        s_seller, _ = seller.call("POST", f"{CP}/{svc.get('id')}", {"version": changed.get("version"), "salePrice": 1})
        check("a manager changes name and price and clears the summary; stale → 409; a seller → 403",
              s == 200 and changed.get("name") == f"يوم مراجعة معتمد {tag}" and float(changed.get("salePrice") or 0) == 5000 and changed.get("summary") is None
              and (s_stale, s_seller) == (409, 403), (s, changed, s_stale, s_seller))
        s, body = manager.call("POST", f"{CP}/{svc.get('id')}", {"version": changed.get("version"), "onSale": False})
        seller_sees = any(r["id"] == svc.get("id") for r in rows(seller.call("GET", CP + "?q=" + f"ISO-DAY-{tag}")[1]))
        manager_row = next((r for r in rows(manager.call("GET", CP + "?all=true&q=" + f"ISO-DAY-{tag}")[1]) if r["id"] == svc.get("id")), None)
        check("taken off sale: hidden from sellers, still in the manager's catalogue", s == 200 and not seller_sees and manager_row and manager_row["onSale"] is False,
              (s, seller_sees, manager_row))

        # --- accounting readiness --------------------------------------------------------------------
        ledger = create(ACCOUNT, {"name": f"Catalog revenue {tag}", "code": f"CT{tag}", "company": {"id": company["id"]}, "commonPosition": 0})
        create(ACCOUNT_MANAGEMENT, {"company": {"id": company["id"]}, "product": {"id": svc["id"]}, "typeSelect": 1, "saleAccount": {"id": ledger["id"]}})
        s, body = manager.call("GET", f"{CP}/{svc.get('id')}")
        check("with finance's revenue account for the manager's company, the service shows ready to invoice", obj(body).get("accountingReady") is True, obj(body))

        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
        print(f"\n{sum(r['result'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} checks passed")
    finally:
        order = {ACCOUNT_MANAGEMENT: 0, PRODUCT: 1, ACCOUNT: 2, USER: 10, GROUP: 11, PERM: 12, COMPANY: 13}
        complete, left = cleanup(admin, created, order)
        if not complete:
            print(f"FAIL cleanup left {left}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "catalog-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
