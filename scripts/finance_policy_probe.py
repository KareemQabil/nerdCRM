#!/usr/bin/env python3
"""D-06 tax and exchange rates read from the owners' policies: live probe against a RUNNING local/CI Axelor; never
against production. The server must run with AXELOR_CONFIG_IOETI_FX_URL=http://127.0.0.1:18089/latest/ (CI does), so
the public exchange-rate source is a stub this probe serves; no outside service is called. Roles are TEST
FIXTURES: a salesperson who owns the quotation, a finance person with native rights on conversion lines, a person
with none, and a policy owner the administrator appoints. Every record is removed afterwards, including the native
taxes, tax versions and conversion lines the policies created.
Checks:
  tax: without a policy a quotation carries no tax (POLICY_NOT_SET, no amounts); once the default is set the draft
  shows it is out of date until the tax is applied; the native tax version has the policy's rate and date; a
  business line's own value wins over the default; when that value is retired the line has no tax (no silent
  fall back to the default)
  exchange rates: read needs native rights (403); nothing without the policy (422 POLICY_NOT_SET); manual-only
  refuses a fetch; a hand-entered rate is checked (currency listed, rate, date, reason), mirrored as one native
  conversion line per date with no overlap, and reported stale when older than the policy allows; the public
  source's rate is recorded, a manual rate wins on its date, fetching twice records nothing new, and an
  unreachable source records nothing (502)
  summary: amounts in the company currency are given with the rate's status
Report: logs/finance-policy-probe.json.
"""
import http.server
import json
import os
import secrets
import sys
import threading
import time
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import RESERVED_SEQUENCE, _delete_where, cleanup  # noqa: E402

USER, GROUP, PERM, ROLE = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission", "com.axelor.auth.db.Role"
PARTNER, PRODUCT, COMPANY = "com.axelor.apps.base.db.Partner", "com.axelor.apps.base.db.Product", "com.axelor.apps.base.db.Company"
CURRENCY, CONVERSION = "com.axelor.apps.base.db.Currency", "com.axelor.apps.base.db.CurrencyConversionLine"
STOCK_LOCATION, STOCK_CONFIG = "com.axelor.apps.stock.db.StockLocation", "com.axelor.apps.stock.db.StockConfig"
ACCOUNT, ACCOUNT_CONFIG = "com.axelor.apps.account.db.Account", "com.axelor.apps.account.db.AccountConfig"
ACCOUNT_MANAGEMENT = "com.axelor.apps.account.db.AccountManagement"
TAX, TAX_LINE, TAX_TYPE = "com.axelor.apps.account.db.Tax", "com.axelor.apps.account.db.TaxLine", "com.axelor.apps.account.db.TaxType"
SALE_ORDER, SALE_ORDER_LINE = "com.axelor.apps.sale.db.SaleOrder", "com.axelor.apps.sale.db.SaleOrderLine"
SALE_ORDER_LINE_TAX = "com.axelor.apps.sale.db.SaleOrderLineTax"
SEQUENCE, SEQUENCE_VERSION = "com.axelor.apps.base.db.Sequence", "com.axelor.apps.base.db.SequenceVersion"
OPP, LINE = "com.axelor.apps.crm.db.Opportunity", "com.ioeti.businessline.db.BusinessLine"
VERSION, AUDIT = "com.ioeti.core.db.PolicyVersion", "com.ioeti.admin.db.AdminAuditEvent"
POLICY_TAX, FX_RATE = "com.ioeti.commercial.db.PolicyTaxLine", "com.ioeti.workspace.db.FxRate"
QUOTES, F, P = "/ws/ioeti/quotes", "/ws/ioeti/finance", "/ws/ioeti/policies"
OWNER_ROLE = "ioeti-policy-owner"
STUB_PORT = int(os.environ.get("IOETI_FX_STUB_PORT", "18089"))
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:240]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def obj(body):
    return (body.get("object") if isinstance(body, dict) else None) or {}


def err(body):
    e = (body.get("error") or {}) if isinstance(body, dict) else {}
    return e.get("code"), ((e.get("fields") or [{}])[0]).get("field"), ((e.get("fields") or [{}])[0]).get("code")


def dec(value):
    return Decimal(str(value)) if value is not None else None


class Stub(http.server.BaseHTTPRequestHandler):
    """The public exchange-rate source, as open.er-api.com answers: how much of each currency one EGP buys."""
    answer = {}
    calls = 0

    def do_GET(self):  # noqa: N802
        Stub.calls += 1
        body = json.dumps(Stub.answer).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


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

    def search(model, domain, fields=("id",), limit=500):
        _, body = admin.call("POST", f"/ws/rest/{model}/search", {"fields": list(fields), "limit": limit, "data": {"_domain": domain, "_archived": True}})
        return body.get("data") or []

    def fetch(model, rid, fields):
        _, body = admin.call("POST", f"/ws/rest/{model}/{rid}/fetch", {"fields": list(fields)})
        return (body.get("data") or [{}])[0]

    def version(model, rid):
        return fetch(model, rid, ["version"]).get("version")

    if search(USER, f"EXISTS (SELECT r FROM Role r WHERE r.name = '{OWNER_ROLE}' AND r MEMBER OF self.roles)"):
        raise SystemExit("this database already has policy owners; run the probe on a disposable database")
    if search(VERSION, "self.policyKey IN ('finance.tax', 'finance.fx')"):
        raise SystemExit("this database already has finance policies; run the probe on a disposable database")
    role_before = search(ROLE, f"self.name = '{OWNER_ROLE}'")
    taxes_before = {r["id"] for r in search(TAX, "self.code LIKE 'IOETI-%'")}
    tax_types_before = {r["id"] for r in search(TAX_TYPE, "self.code LIKE 'IOETI-%'")}
    lines_before = {r["id"]: r.get("toDate") for r in search(CONVERSION, "self.endCurrency.codeISO = 'EGP' AND self.startCurrency.codeISO IN ('USD', 'EUR')",
                                                             ("id", "toDate"))}
    fx_before = {r["id"] for r in search(FX_RATE, "self.id > 0")}

    server = http.server.ThreadingHTTPServer(("127.0.0.1", STUB_PORT), Stub)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    exit_code = 1
    users = {}
    try:
        egp = search(CURRENCY, "self.codeISO = 'EGP'")[0]
        co = create(COMPANY, {"name": f"FX Probe Co {tag}", "code": f"FX{tag}", "currency": {"id": egp["id"]}})
        location = create(STOCK_LOCATION, {"name": f"FX probe {tag}", "company": {"id": co["id"]}, "typeSelect": 1})
        create(STOCK_CONFIG, {"company": {"id": co["id"]}, "pickupDefaultStockLocation": {"id": location["id"]}})
        create(ACCOUNT_CONFIG, {"company": {"id": co["id"]}})
        ledger = create(ACCOUNT, {"name": f"TEST ONLY sales {tag}", "code": f"X{tag}", "company": {"id": co["id"]}, "commonPosition": 0})
        product = create(PRODUCT, {"name": f"FX probe audit day {tag}", "code": f"FX-{tag}", "sellable": True, "salePrice": "1234.50",
                                   "saleCurrency": {"id": egp["id"]}, "productTypeSelect": "service"})
        create(ACCOUNT_MANAGEMENT, {"company": {"id": co["id"]}, "product": {"id": product["id"]}, "typeSelect": 1, "saleAccount": {"id": ledger["id"]}})
        line = create(LINE, {"code": f"FXL{tag}", "nameEn": f"FX probe line {tag}", "nameAr": "خط تجريبي", "statusSelect": 2})
        account = create(PARTNER, {"name": f"عميل الضريبة {tag}", "isProspect": True, "partnerTypeSelect": 1})

        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"fxprobe.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})
        rwc = dict(canRead=True, canWrite=True, canCreate=True)
        rep = [perm("opp", OPP, "self.user = ?", **rwc), perm("so", SALE_ORDER, "self.salespersonUser = ?", **rwc),
               perm("sol", SALE_ORDER_LINE, "self.saleOrder.salespersonUser = ?", canRead=True, canWrite=True, canCreate=True, canRemove=True),
               perm("product", PRODUCT, canRead=True), perm("partner", PARTNER, canRead=True), perm("line", LINE, canRead=True)]
        fin = [perm("f.ccl", CONVERSION, **rwc), perm("f.so", SALE_ORDER, canRead=True)]
        none = [perm("n.partner", PARTNER, canRead=True)]
        groups = {k: create(GROUP, {"code": f"fxprobe-{k}-{tag}", "name": f"FX probe {k} {tag}", "permissions": [{"id": p["id"]} for p in v]})
                  for k, v in (("rep", rep), ("fin", fin), ("none", none))}
        sessions = {}
        for label, group in (("Rep", "rep"), ("Finance", "fin"), ("Other", "none"), ("Owner", "none")):
            password = "Fx!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"fxprobe.{label.lower()}.{tag}", "name": f"FX probe {label} {tag}", "blocked": False,
                                         "language": "ar", "group": {"id": groups[group]["id"]}, "activeCompany": {"id": co["id"]},
                                         "password": axelor_password_hash(password)})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        rep_c, fin_c, other, owner = sessions["Rep"], sessions["Finance"], sessions["Other"], sessions["Owner"]
        s, _ = admin.call("POST", P + "/owners", {"userId": users["Owner"]["id"]})
        assert s == 200, f"appointing the policy owner: {s}"
        today = date.today()

        def set_policy(key, value, scope=None, effective=None):
            body = {"value": value, "reason": f"probe {tag}"}
            if scope:
                body["scope"] = scope
            if effective:
                body["effectiveFrom"] = effective.isoformat()
            s_, b_ = owner.call("POST", f"{P}/{key}", body)
            assert s_ == 201, f"setting {key}: {s_} {b_}"
            return b_

        def quote_now(qid):
            return obj(rep_c.call("GET", f"{QUOTES}/{qid}")[1])

        # --- tax --------------------------------------------------------------------------------------------
        opp = create(OPP, {"name": f"FX probe {tag}", "user": {"id": users["Rep"]["id"]}, "partner": {"id": account["id"]},
                           "ioetiBusinessLine": {"id": line["id"]}})
        s, body = rep_c.call("POST", QUOTES, {"opportunityId": opp["id"], "opportunityVersion": version(OPP, opp["id"])})
        quote = obj(body)
        s2, body2 = rep_c.call("POST", f"{QUOTES}/{quote.get('id')}/lines", {"version": version(SALE_ORDER, quote.get("id")),
                                                                            "productId": product["id"], "quantity": 2})
        q = obj(body2)
        native = fetch(SALE_ORDER, quote.get("id"), ["taxTotal", "inTaxTotal", "exTaxTotal"])
        check("without a tax policy the quotation carries no tax: POLICY_NOT_SET, no amounts, nothing taxed natively",
              (s, s2) == (201, 201) and q.get("taxStatus") == "POLICY_NOT_SET" and q.get("taxTotal") is None and q.get("totalWithTax") is None
              and q.get("tax") is None and q.get("taxOutdated") is False and dec(native.get("taxTotal")) == 0
              and dec(q.get("totalBeforeTax")) == Decimal("2469.00"), (s, s2, q.get("taxStatus"), q.get("taxTotal"), native))

        detail = obj(set_policy("finance.tax", {"ratePercent": 14, "name": f"VAT probe {tag}", "type": "VAT"}))
        default_version = (detail.get("values") or [{}])[0].get("versionId")
        stale = quote_now(quote["id"])
        s, body = rep_c.call("POST", f"{QUOTES}/{quote['id']}/tax", {"version": version(SALE_ORDER, quote["id"])})
        q = obj(body)
        native = fetch(SALE_ORDER, quote["id"], ["taxTotal", "inTaxTotal"])
        tax_line = search(TAX_LINE, f"self.tax.code = 'IOETI-DEFAULT'", ("value", "startDate", "endDate"))
        expected = (Decimal("2469.00") * Decimal("0.14")).quantize(Decimal("0.01"), ROUND_HALF_UP)
        check("once the default tax is set the draft shows it is out of date; applying it taxes the lines natively at the policy's rate, "
              "with the version used",
              stale.get("taxOutdated") is True and stale.get("taxStatus") == "POLICY_NOT_SET" and s == 200 and q.get("taxStatus") == "APPLIED"
              and dec(q.get("taxTotal")) == expected and dec(q.get("totalWithTax")) == Decimal("2469.00") + expected
              and (q.get("tax") or {}).get("policyVersionId") == default_version and dec((q.get("tax") or {}).get("ratePercent")) == 14
              and q.get("taxOutdated") is False and dec(native.get("taxTotal")) == expected
              and len(tax_line) == 1 and dec(tax_line[0].get("value")) == 14 and tax_line[0].get("startDate") == today.isoformat()
              and tax_line[0].get("endDate") is None, (stale.get("taxOutdated"), s, q.get("taxStatus"), q.get("taxTotal"), q.get("tax"), native, tax_line))

        detail = obj(set_policy("finance.tax", {"ratePercent": 5, "name": f"Reduced probe {tag}", "type": "OTHER"}, scope=line["code"]))
        scoped_version = next((v["versionId"] for v in detail.get("values") or [] if v.get("scope") == line["code"]), None)
        s, body = rep_c.call("POST", f"{QUOTES}/{quote['id']}/lines", {"version": version(SALE_ORDER, quote["id"]), "productId": product["id"], "quantity": 1})
        q = obj(body)
        expected = (Decimal("3703.50") * Decimal("0.05")).quantize(Decimal("0.01"), ROUND_HALF_UP)
        check("the business line's own value wins over the default, for every line of the quotation",
              s == 201 and q.get("taxStatus") == "APPLIED" and (q.get("tax") or {}).get("policyVersionId") == scoped_version
              and dec(q.get("totalBeforeTax")) == Decimal("3703.50") and dec(q.get("taxTotal")) == expected
              and search(TAX, f"self.code = 'IOETI-{line['code']}'", ("name",))[0].get("name") == f"Reduced probe {tag}",
              (s, q.get("taxStatus"), q.get("tax"), q.get("taxTotal")))

        s_r, _ = owner.call("POST", f"{P}/finance.tax/retire", {"scope": line["code"], "reason": f"probe {tag}"})
        outdated = quote_now(quote["id"])
        s, body = rep_c.call("POST", f"{QUOTES}/{quote['id']}/tax", {"version": version(SALE_ORDER, quote["id"])})
        q = obj(body)
        s_o, _ = other.call("POST", f"{QUOTES}/{quote['id']}/tax", {"version": version(SALE_ORDER, quote["id"])})
        check("when the line's value is retired the quotation has no tax again (no silent fall back to the default); others cannot apply tax",
              s_r == 200 and outdated.get("taxOutdated") is True and s == 200 and q.get("taxStatus") == "POLICY_NOT_SET" and q.get("taxTotal") is None
              and dec(fetch(SALE_ORDER, quote["id"], ["taxTotal"]).get("taxTotal")) == 0 and s_o in (403, 404),
              (s_r, outdated.get("taxOutdated"), s, q.get("taxStatus"), s_o))

        # --- exchange rates --------------------------------------------------------------------------------------
        s_other, _ = other.call("GET", F + "/fx")
        s_fin, b_fin = fin_c.call("GET", F + "/fx")
        s_ov, b_ov = fin_c.call("POST", F + "/fx/rates", {"currency": "USD", "rate": 48.5, "reason": "probe"})
        check("rates need native rights on conversion lines (403); without the finance.fx policy nothing converts and nothing is entered",
              s_other == 403 and s_fin == 200 and obj(b_fin).get("policySet") is False and obj(b_fin).get("baseCurrency") == "EGP"
              and (s_ov, err(b_ov)[0]) == (422, "POLICY_NOT_SET"), (s_other, s_fin, obj(b_fin).get("policySet"), s_ov, err(b_ov)))

        set_policy("finance.fx", {"source": "MANUAL_ONLY", "currencies": "USD,EUR", "maxAgeHours": 48})
        s_ref, b_ref = fin_c.call("POST", F + "/fx/refresh")
        bad = [fin_c.call("POST", F + "/fx/rates", body) for body in (
            {"currency": "GBP", "rate": 60, "reason": "probe"}, {"currency": "USD", "rate": 0, "reason": "probe"},
            {"currency": "USD", "rate": 48.5, "reason": " "}, {"currency": "USD", "rate": 48.5, "reason": "probe",
                                                                "rateDate": (today + timedelta(days=1)).isoformat()})]
        s_ok, b_ok = fin_c.call("POST", F + "/fx/rates", {"currency": "USD", "rate": 48.5, "reason": f"bank rate {tag}"})
        s_eur, b_eur = fin_c.call("POST", F + "/fx/rates", {"currency": "EUR", "rate": 52, "reason": "probe", "rateDate": (today - timedelta(days=3)).isoformat()})
        fx = {c["currency"]: c for c in obj(b_eur).get("currencies") or []}
        usd_lines = search(CONVERSION, "self.startCurrency.codeISO = 'USD' AND self.endCurrency.codeISO = 'EGP' AND self.appBase IS NOT NULL",
                           ("exchangeRate", "fromDate", "toDate"))
        check("manual only refuses a fetch; a hand-entered rate is checked (listed currency, rate, date, reason)",
              (s_ref, err(b_ref)[0]) == (422, "FX_MANUAL_ONLY")
              and [(s_, err(b_)[1], err(b_)[2]) for s_, b_ in bad] == [(422, "currency", "UNAVAILABLE"), (422, "rate", "RANGE"),
                                                                       (422, "reason", "REQUIRED"), (422, "rateDate", "RANGE")],
              (s_ref, err(b_ref), [(s_, err(b_)) for s_, b_ in bad]))
        check("a hand-entered rate is in use, mirrored as a native conversion line; one older than the policy allows is reported stale",
              (s_ok, s_eur) == (201, 201) and dec(fx["USD"].get("rate")) == Decimal("48.5") and fx["USD"].get("source") == "MANUAL"
              and fx["USD"].get("stale") is False and fx["EUR"].get("stale") is True
              and [(dec(r["exchangeRate"]), r["fromDate"], r.get("toDate")) for r in usd_lines] == [(Decimal("48.5"), today.isoformat(), None)],
              (s_ok, s_eur, fx, usd_lines))

        s_back, _ = fin_c.call("POST", F + "/fx/rates", {"currency": "USD", "rate": 47, "reason": "probe", "rateDate": (today - timedelta(days=2)).isoformat()})
        usd_lines = sorted(search(CONVERSION, "self.startCurrency.codeISO = 'USD' AND self.endCurrency.codeISO = 'EGP' AND self.appBase IS NOT NULL",
                                  ("exchangeRate", "fromDate", "toDate")), key=lambda r: r["fromDate"])
        in_use = {c["currency"]: c for c in obj(fin_c.call("GET", F + "/fx")[1]).get("currencies") or []}
        check("a back-dated rate gets its own native line ending the day before the next; today's rate stays in use",
              s_back == 201 and [(dec(r["exchangeRate"]), r["fromDate"], r.get("toDate")) for r in usd_lines]
              == [(Decimal("47"), (today - timedelta(days=2)).isoformat(), (today - timedelta(days=1)).isoformat()),
                  (Decimal("48.5"), today.isoformat(), None)] and dec(in_use["USD"].get("rate")) == Decimal("48.5"), (s_back, usd_lines))

        set_policy("finance.fx", {"source": "PUBLIC_API", "currencies": "USD,EUR", "maxAgeHours": 48})
        Stub.answer = {"result": "success", "time_last_update_unix": int(time.time()) - 60, "base_code": "EGP",
                       "rates": {"EGP": 1, "USD": 0.02, "EUR": 0.0185, "GBP": 0.016}}
        s1, b1 = fin_c.call("POST", F + "/fx/refresh")
        calls = Stub.calls
        s2, _ = fin_c.call("POST", F + "/fx/refresh")
        cur = {c["currency"]: c for c in obj(b1).get("currencies") or []}
        public = search(FX_RATE, "self.source = 'PUBLIC_API'", ("rate", "provider", "currency.codeISO"))
        check("the public source's rates are recorded (EGP per unit); a manual rate wins on its date; fetching again records nothing new",
              (s1, s2) == (200, 200) and calls >= 1 and len(public) == 2 and {p["provider"] for p in public} == {"127.0.0.1"}
              and dec(cur["EUR"].get("rate")) == Decimal("54.054054") and cur["EUR"].get("source") == "PUBLIC_API" and cur["EUR"].get("stale") is False
              and dec(cur["USD"].get("rate")) == Decimal("48.5") and cur["USD"].get("source") == "MANUAL",
              (s1, s2, calls, public, cur))

        server.shutdown()
        server.server_close()
        s3, b3 = fin_c.call("POST", F + "/fx/refresh")
        check("an unreachable source answers 502 and records nothing", (s3, err(b3)[0]) == (502, "FX_SOURCE_UNAVAILABLE")
              and len(search(FX_RATE, "self.source = 'PUBLIC_API'")) == 2, (s3, err(b3)))

        summary = obj(fin_c.call("GET", F + "/summary")[1])
        egp_row = next((r for r in summary.get("rows") or [] if r["currency"] == "EGP"), {})
        check("the summary gives figures in the company currency with the rate's status",
              summary.get("baseCurrency") == "EGP" and (not egp_row or (egp_row.get("fxStatus") == "BASE"
                                                                          and dec(egp_row.get("bookedInBase")) == dec(egp_row.get("booked")))),
              (summary.get("baseCurrency"), egp_row))

        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
        print(f"\n{sum(r['result'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} checks passed")
    finally:
        try:
            server.shutdown()
            server.server_close()
        except Exception:  # noqa: BLE001
            pass
        opp_ids = [rid for m, rid in created if m == OPP]
        if opp_ids:
            quotes = [r["id"] for r in search(SALE_ORDER, f"self.opportunity.id in ({','.join(map(str, opp_ids))})")]
            if quotes:
                qids = ",".join(map(str, quotes))
                for model, domain in ((SALE_ORDER_LINE_TAX, f"self.saleOrder.id in ({qids})"),
                                      (SALE_ORDER_LINE, f"self.saleOrder.id in ({qids}) OR self.oldVersionSaleOrder.id in ({qids})"),
                                      (SALE_ORDER, f"self.id in ({qids})")):
                    created.extend((model, r["id"]) for r in search(model, domain) if (model, r["id"]) not in created)
                for seq in search(SEQUENCE, f"self.company.id = {co['id']}" if 'co' in locals() else "self.id = 0"):
                    _delete_where(admin, RESERVED_SEQUENCE, f"self.sequence.id = {seq['id']}")
                    created.extend((SEQUENCE_VERSION, r["id"]) for r in search(SEQUENCE_VERSION, f"self.sequence.id = {seq['id']}"))
                    created.append((SEQUENCE, seq["id"]))
        # what the policies created natively: tax versions and taxes, conversion lines (pre-existing ones get their end date back)
        created.extend((FX_RATE, r["id"]) for r in search(FX_RATE, "self.id > 0") if r["id"] not in fx_before)
        created.extend((POLICY_TAX, r["id"]) for r in search(POLICY_TAX, "self.id > 0"))
        new_taxes = [r["id"] for r in search(TAX, "self.code LIKE 'IOETI-%'") if r["id"] not in taxes_before]
        if new_taxes:
            created.extend((TAX_LINE, r["id"]) for r in search(TAX_LINE, f"self.tax.id in ({','.join(map(str, new_taxes))})"))
            for tid in new_taxes:  # the tax points at its active version
                admin.call("POST", f"/ws/rest/{TAX}/{tid}", {"data": {"id": tid, "version": version(TAX, tid), "activeTaxLine": None}})
            created.extend((TAX, t) for t in new_taxes)
        created.extend((TAX_TYPE, r["id"]) for r in search(TAX_TYPE, "self.code LIKE 'IOETI-%'") if r["id"] not in tax_types_before)
        for r in search(CONVERSION, "self.endCurrency.codeISO = 'EGP' AND self.startCurrency.codeISO IN ('USD', 'EUR')", ("id", "toDate", "version")):
            if r["id"] not in lines_before:
                created.append((CONVERSION, r["id"]))
            elif r.get("toDate") != lines_before[r["id"]]:
                admin.call("POST", f"/ws/rest/{CONVERSION}/{r['id']}", {"data": {"id": r["id"], "version": r["version"], "toDate": lines_before[r["id"]]}})
        ids = [x["id"] for x in users.values()]
        if ids:
            joined = ",".join(map(str, ids))
            created.extend((VERSION, v["id"]) for v in search(VERSION, f"self.author.id in ({joined})"))
            created.extend((AUDIT, a["id"]) for a in search(AUDIT, f"self.actor.id in ({joined}) OR (self.subject = 'USER' AND self.subjectId in ({joined}))"))
            for user in users.values():
                current = fetch(USER, user["id"], ["version"])
                if current:
                    admin.call("POST", f"/ws/rest/{USER}/{user['id']}", {"data": {"id": user["id"], "version": current.get("version"), "roles": [], "blocked": True}})
            created.extend((AUDIT, a["id"]) for a in search(AUDIT, f"self.subject = 'USER' AND self.action LIKE 'POLICY_OWNER_%' AND self.subjectId in ({joined})"))
        if not role_before:
            created.extend((ROLE, r["id"]) for r in search(ROLE, f"self.name = '{OWNER_ROLE}'"))
        order = {FX_RATE: 0, SALE_ORDER_LINE_TAX: 0, SALE_ORDER_LINE: 1, SALE_ORDER: 2, POLICY_TAX: 3, TAX_LINE: 4, TAX: 5, TAX_TYPE: 6,
                 CONVERSION: 3, VERSION: 4, AUDIT: 4, OPP: 4, ACCOUNT_MANAGEMENT: 5, PRODUCT: 6, PARTNER: 6, LINE: 6, ACCOUNT: 7,
                 ACCOUNT_CONFIG: 8, STOCK_CONFIG: 8, STOCK_LOCATION: 9, SEQUENCE_VERSION: 9, SEQUENCE: 10, ROLE: 10, USER: 11, GROUP: 12,
                 PERM: 13, COMPANY: 14}
        complete, left = cleanup(admin, list(dict.fromkeys(created)), order)
        if not complete:
            print(f"FAIL cleanup left {left}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "finance-policy-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
