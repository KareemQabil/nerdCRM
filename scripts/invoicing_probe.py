#!/usr/bin/env python3
"""D-06 issuing invoices in Axelor accounting from finance's queue: live probe against a RUNNING local/CI Axelor; never
against production. Roles are TEST FIXTURES: a salesperson who owns the order and asks for invoicing, a finance person
with native rights to create invoices, and a policy owner the administrator appoints. The company's accounting set-up
(fiscal year, journal, sequences, accounts) is a TEST FIXTURE entered by the administrator, standing in for finance's
own set-up; order confirmation is done with SQL as in finance_probe.py (D-11). Ventilated invoices and their journal
entries are removed with SQL afterwards (disposable database only); everything else through the API.
Checks:
  access: a salesperson without native invoice rights cannot issue (403); nothing is created
  fail closed: without the owners' payment terms → POLICY_NOT_SET; with them, an incomplete accounting set-up →
  ACCOUNTING_NOT_READY naming each missing item (the readiness view lists the same), and still nothing is created
  issue: with the set-up complete the invoice is created, validated and ventilated natively: the milestone's amount,
  the owners' tax, due date from the payment terms (a native payment condition per policy version), a journal entry;
  the request is ISSUED with the invoice number and leaves the open queue; the milestone is invoiced; issuing again
  is refused; the figures count the invoice
Report: logs/invoicing-probe.json.
"""
import json
import os
import secrets
import sys
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import RESERVED_SEQUENCE, _delete_where, cleanup, purge_company_accounting  # noqa: E402
from db_migrate import DATABASE, psql  # noqa: E402

USER, GROUP, PERM, ROLE = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission", "com.axelor.auth.db.Role"
PARTNER, PRODUCT, COMPANY = "com.axelor.apps.base.db.Partner", "com.axelor.apps.base.db.Product", "com.axelor.apps.base.db.Company"
CURRENCY = "com.axelor.apps.base.db.Currency"
STOCK_LOCATION, STOCK_CONFIG = "com.axelor.apps.stock.db.StockLocation", "com.axelor.apps.stock.db.StockConfig"
ACCOUNT, ACCOUNT_TYPE, ACCOUNT_CONFIG = "com.axelor.apps.account.db.Account", "com.axelor.apps.account.db.AccountType", "com.axelor.apps.account.db.AccountConfig"
ACCOUNT_MANAGEMENT, ACCOUNTING_SITUATION = "com.axelor.apps.account.db.AccountManagement", "com.axelor.apps.account.db.AccountingSituation"
JOURNAL, JOURNAL_TYPE = "com.axelor.apps.account.db.Journal", "com.axelor.apps.account.db.JournalType"
YEAR, PERIOD = "com.axelor.apps.base.db.Year", "com.axelor.apps.base.db.Period"
TAX, TAX_LINE, TAX_TYPE = "com.axelor.apps.account.db.Tax", "com.axelor.apps.account.db.TaxLine", "com.axelor.apps.account.db.TaxType"
PAYMENT_CONDITION, PAYMENT_CONDITION_LINE = "com.axelor.apps.account.db.PaymentCondition", "com.axelor.apps.account.db.PaymentConditionLine"
SALE_ORDER, SALE_ORDER_LINE = "com.axelor.apps.sale.db.SaleOrder", "com.axelor.apps.sale.db.SaleOrderLine"
SALE_ORDER_LINE_TAX, TIMETABLE = "com.axelor.apps.sale.db.SaleOrderLineTax", "com.axelor.apps.supplychain.db.Timetable"
INVOICE = "com.axelor.apps.account.db.Invoice"
SUPPLYCHAIN_CONFIG = "com.axelor.apps.supplychain.db.SupplyChainConfig"
PAYMENT_MODE = "com.axelor.apps.account.db.PaymentMode"
APP_INVOICE = "com.axelor.studio.db.AppInvoice"
ADDRESS, COUNTRY, CITY = "com.axelor.apps.base.db.Address", "com.axelor.apps.base.db.Country", "com.axelor.apps.base.db.City"
SEQUENCE, SEQUENCE_VERSION = "com.axelor.apps.base.db.Sequence", "com.axelor.apps.base.db.SequenceVersion"
OPP, LINE = "com.axelor.apps.crm.db.Opportunity", "com.ioeti.businessline.db.BusinessLine"
VERSION, AUDIT = "com.ioeti.core.db.PolicyVersion", "com.ioeti.admin.db.AdminAuditEvent"
POLICY_TAX, INVOICE_REQUEST = "com.ioeti.commercial.db.PolicyTaxLine", "com.ioeti.workspace.db.InvoiceRequest"
WS, QUOTES, F, P = "/ws/ioeti/workspace", "/ws/ioeti/quotes", "/ws/ioeti/finance", "/ws/ioeti/policies"
OWNER_ROLE = "ioeti-policy-owner"
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:300]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def obj(body):
    return (body.get("object") if isinstance(body, dict) else None) or {}


def rows(body):
    value = body.get("object") if isinstance(body, dict) else None
    return value if isinstance(value, list) else []


def err(body):
    e = (body.get("error") or {}) if isinstance(body, dict) else {}
    return e.get("code"), [f.get("code") for f in e.get("fields") or []]


def dec(value):
    return Decimal(str(value)) if value is not None else None


def main():
    admin = Client()
    assert admin.login(os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin")),
                       os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
    tag = secrets.token_hex(3).upper()
    created = []

    def create(model, values):
        _, body = rest_create(admin, model, values)
        if not ok(body):
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}: {json.dumps(body)[:300]}")
        created.append((model, body["data"][0]["id"]))
        return body["data"][0]

    def update(model, rid, values):
        _, cur = admin.call("POST", f"/ws/rest/{model}/{rid}/fetch", {"fields": ["version"]})
        _, body = admin.call("POST", f"/ws/rest/{model}/{rid}", {"data": {"id": rid, "version": (cur.get("data") or [{}])[0].get("version"), **values}})
        if not ok(body):
            raise SystemExit(f"fixture update failed for {model.split('.')[-1]}: {json.dumps(body)[:300]}")

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
    if search(VERSION, "self.policyKey IN ('finance.tax', 'finance.payment-terms')"):
        raise SystemExit("this database already has finance policies; run the probe on a disposable database")
    role_before = search(ROLE, f"self.name = '{OWNER_ROLE}'")
    taxes_before = {r["id"] for r in search(TAX, "self.code LIKE 'IOETI-%'")}
    tax_types_before = {r["id"] for r in search(TAX_TYPE, "self.code LIKE 'IOETI-%'")}
    app_invoice = (search(APP_INVOICE, "self.id > 0", ("autoGenerateInvoicePrintingFileOnSaleInvoice",)) or [{}])[0]
    prints_on_ventilation = app_invoice.get("autoGenerateInvoicePrintingFileOnSaleInvoice") is True
    exit_code = 1
    users = {}
    co = None
    try:
        egp = search(CURRENCY, "self.codeISO = 'EGP'")[0]
        today = date.today()
        co = create(COMPANY, {"name": f"Invoicing Probe Co {tag}", "code": f"IV{tag}", "currency": {"id": egp["id"]}})
        location = create(STOCK_LOCATION, {"name": f"Invoicing probe {tag}", "company": {"id": co["id"]}, "typeSelect": 1})
        create(STOCK_CONFIG, {"company": {"id": co["id"]}, "pickupDefaultStockLocation": {"id": location["id"]}})
        config = create(ACCOUNT_CONFIG, {"company": {"id": co["id"]}})
        types = {t: create(ACCOUNT_TYPE, {"name": f"TEST ONLY {t} {tag}", "technicalTypeSelect": t}) for t in ("income", "receivable", "tax")}
        sales = create(ACCOUNT, {"name": f"TEST ONLY sales {tag}", "code": f"7{tag}", "company": {"id": co["id"]}, "commonPosition": 0,
                                 "accountType": {"id": types["income"]["id"]}})
        receivable = create(ACCOUNT, {"name": f"TEST ONLY customers {tag}", "code": f"4{tag}", "company": {"id": co["id"]}, "commonPosition": 0,
                                      "accountType": {"id": types["receivable"]["id"]}, "reconcileOk": True, "useForPartnerBalance": True})
        vat = create(ACCOUNT, {"name": f"TEST ONLY VAT collected {tag}", "code": f"V{tag}", "company": {"id": co["id"]}, "commonPosition": 0,
                               "accountType": {"id": types["tax"]["id"]}})
        product = create(PRODUCT, {"name": f"Invoicing probe audit day {tag}", "code": f"IV-{tag}", "sellable": True, "salePrice": "2000",
                                   "saleCurrency": {"id": egp["id"]}, "productTypeSelect": "service"})
        create(ACCOUNT_MANAGEMENT, {"company": {"id": co["id"]}, "product": {"id": product["id"]}, "typeSelect": 1, "saleAccount": {"id": sales["id"]}})
        line = create(LINE, {"code": f"IVL{tag}", "nameEn": f"Invoicing probe line {tag}", "nameAr": "خط تجريبي", "statusSelect": 2})
        account = create(PARTNER, {"name": f"عميل الفوترة {tag}", "isCustomer": True, "partnerTypeSelect": 1})

        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"invprobe.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})
        rwc = dict(canRead=True, canWrite=True, canCreate=True)
        rep = [perm("opp", OPP, "self.user = ?", **rwc), perm("so", SALE_ORDER, "self.salespersonUser = ?", **rwc),
               perm("sol", SALE_ORDER_LINE, "self.saleOrder.salespersonUser = ?", canRead=True, canWrite=True, canCreate=True, canRemove=True),
               perm("tt", TIMETABLE, "self.saleOrder.salespersonUser = ?", canRead=True, canWrite=True, canCreate=True, canRemove=True),
               perm("ireq", INVOICE_REQUEST, "self.requestedBy = ?", **rwc),
               perm("product", PRODUCT, canRead=True), perm("partner", PARTNER, canRead=True), perm("line", LINE, canRead=True)]
        fin = [perm("f.so", SALE_ORDER, canRead=True), perm("f.ireq", INVOICE_REQUEST, canRead=True), perm("f.partner", PARTNER, canRead=True),
               perm("f.tt", TIMETABLE, canRead=True), perm("f.inv", INVOICE, **rwc)]
        none = [perm("n.partner", PARTNER, canRead=True)]
        groups = {k: create(GROUP, {"code": f"invprobe-{k}-{tag}", "name": f"Invoicing probe {k} {tag}", "permissions": [{"id": p["id"]} for p in v]})
                  for k, v in (("rep", rep), ("fin", fin), ("none", none))}
        sessions = {}
        for label, group in (("Rep", "rep"), ("Finance", "fin"), ("Owner", "none")):
            password = "Iv!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"invprobe.{label.lower()}.{tag}", "name": f"Invoicing probe {label} {tag}", "blocked": False,
                                         "language": "ar", "group": {"id": groups[group]["id"]}, "activeCompany": {"id": co["id"]},
                                         "password": axelor_password_hash(password)})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        rep_c, fin_c, owner = sessions["Rep"], sessions["Finance"], sessions["Owner"]
        s, _ = admin.call("POST", P + "/owners", {"userId": users["Owner"]["id"]})
        assert s == 200, f"appointing the policy owner: {s}"

        def set_policy(key, value):
            s_, b_ = owner.call("POST", f"{P}/{key}", {"value": value, "reason": f"probe {tag}"})
            assert s_ == 201, f"setting {key}: {s_} {b_}"

        set_policy("finance.tax", {"ratePercent": 14, "name": f"VAT probe {tag}", "type": "VAT"})

        # --- the order and its request ------------------------------------------------------------------------
        opp = create(OPP, {"name": f"Invoicing probe {tag}", "user": {"id": users["Rep"]["id"]}, "partner": {"id": account["id"]},
                           "ioetiBusinessLine": {"id": line["id"]}})
        s, b = rep_c.call("POST", QUOTES, {"opportunityId": opp["id"], "opportunityVersion": version(OPP, opp["id"])})
        assert s == 201, f"quote {s} {b}"
        quote = obj(b)
        s, b = rep_c.call("POST", f"{QUOTES}/{quote['id']}/lines", {"version": version(SALE_ORDER, quote["id"]), "productId": product["id"], "quantity": 3})
        assert s == 201 and obj(b).get("taxStatus") == "APPLIED", f"line {s} {obj(b).get('taxStatus')}"
        s, b = rep_c.call("POST", f"{QUOTES}/{quote['id']}/milestones", {"version": version(SALE_ORDER, quote["id"]), "title": "Deposit",
                                                                       "percentage": "40", "dueDate": today.isoformat()})
        assert s in (200, 201), f"milestone {s} {b}"
        milestone = [m["id"] for m in search(TIMETABLE, f"self.saleOrder.id = {quote['id']}", ("title",)) if m.get("title") == "Deposit"][0]
        # TEST FIXTURE: stands in for order confirmation (D-11), never done by the product API
        psql(DATABASE, f"UPDATE sale_sale_order SET status_select = 3 WHERE id = {int(quote['id'])};")
        s, b = rep_c.call("POST", f"{WS}/invoice-requests", {"milestoneId": milestone, "quoteVersion": version(SALE_ORDER, quote["id"])})
        assert s == 201, f"invoice request {s} {b}"
        req = obj(b)
        created.append((INVOICE_REQUEST, req["id"]))

        def issue(client):
            return client.call("POST", f"{WS}/invoice-requests/{req['id']}/issue", {"version": version(INVOICE_REQUEST, req["id"])})

        def invoices():
            return search(INVOICE, f"self.partner.id = {account['id']}")

        s_rep, _ = issue(rep_c)
        check("a salesperson without native invoice rights cannot issue (403); nothing is created", s_rep == 403 and invoices() == [], s_rep)

        s_pt, b_pt = issue(fin_c)
        ready = obj(fin_c.call("GET", f"{F}/requests/{req['id']}/readiness")[1])
        check("without the owners' payment terms, issuing is refused (POLICY_NOT_SET) and the readiness view says so",
              (s_pt, err(b_pt)[0]) == (422, "POLICY_NOT_SET") and ready.get("ready") is False
              and "PAYMENT_TERMS_POLICY" in [m["code"] for m in ready.get("missing") or []] and invoices() == [], (s_pt, err(b_pt), ready))

        set_policy("finance.payment-terms", {"dueDays": 30})
        s_nr, b_nr = issue(fin_c)
        ready = obj(fin_c.call("GET", f"{F}/requests/{req['id']}/readiness")[1])
        missing = {m["code"] for m in ready.get("missing") or []}
        expected = {"CUSTOMER_ACCOUNT", "SALES_JOURNAL", "INVOICE_SEQUENCE", "OPEN_PERIOD", "SUPPLYCHAIN_CONFIG", "SALE_ACCOUNT_TAX", "TAX_ACCOUNT",
                    "CLIENT_ADDRESS", "PAYMENT_MODE", "ACCOUNT_INACTIVE"} | ({"INVOICE_PRINT_TEMPLATE"} if prints_on_ventilation else set())
        # (a revenue account that accepts tax must also say its VAT system; checked once the account accepts tax)
        check("with an incomplete accounting set-up issuing is refused (ACCOUNTING_NOT_READY) naming each missing item; nothing is created",
              (s_nr, err(b_nr)[0]) == (422, "ACCOUNTING_NOT_READY") and set(err(b_nr)[1]) == expected and missing == expected
              and invoices() == [], (s_nr, err(b_nr), sorted(missing)))

        # --- TEST FIXTURE: finance's accounting set-up, entered by the administrator ----------------------------------
        year = create(YEAR, {"name": f"FY probe {tag}", "code": f"FY{tag}", "company": {"id": co["id"]}, "typeSelect": 1, "statusSelect": 1,
                             "fromDate": date(today.year, 1, 1).isoformat(), "toDate": date(today.year, 12, 31).isoformat()})
        create(PERIOD, {"name": f"P probe {tag}", "code": f"P{tag}", "year": {"id": year["id"]}, "statusSelect": 1,
                        "fromDate": date(today.year, 1, 1).isoformat(), "toDate": date(today.year, 12, 31).isoformat()})
        move_seq = create(SEQUENCE, {"name": f"Moves probe {tag}", "codeSelect": "move", "company": {"id": co["id"]}, "prefixe": f"M{tag}-",
                                     "padding": 5, "toBeAdded": 1})
        inv_seq = create(SEQUENCE, {"name": f"Invoices probe {tag}", "codeSelect": "invoice", "company": {"id": co["id"]}, "prefixe": f"INV{tag}-",
                                    "padding": 5, "toBeAdded": 1})
        jtype = create(JOURNAL_TYPE, {"name": f"Sales probe {tag}", "code": f"JS{tag}", "technicalTypeSelect": 2})
        journal = create(JOURNAL, {"name": f"Sales probe {tag}", "code": f"VT{tag}", "company": {"id": co["id"]}, "journalType": {"id": jtype["id"]},
                                   "sequence": {"id": move_seq["id"]}, "statusSelect": 1, "authorizedFunctionalOriginSelect": "3"})
        update(ACCOUNT_CONFIG, config["id"], {"customerAccount": {"id": receivable["id"]}, "customerSalesJournal": {"id": journal["id"]},
                                              "custInvSequence": {"id": inv_seq["id"]}})
        create(SUPPLYCHAIN_CONFIG, {"company": {"id": co["id"]}})
        if prints_on_ventilation:
            # TEST FIXTURE: stands in for finance's invoice print template (the Arabic invoice layout is a later slice)
            update(APP_INVOICE, app_invoice["id"], {"autoGenerateInvoicePrintingFileOnSaleInvoice": False})
        # the client's invoicing address (client data the order carries)
        country = search(COUNTRY, "self.alpha2Code = 'EG'") or search(COUNTRY, "self.addressTemplate.name = 'DEFAULT'", limit=1)  # TEST FIXTURE
        city = create(CITY, {"name": f"Probe City {tag}", "country": {"id": country[0]["id"]}})
        address = create(ADDRESS, {"addressl4": "1 Probe Street", "addressl6": "11511 Probe City", "streetName": "Probe Street",
                                   "zip": "11511", "city": {"id": city["id"]}, "country": {"id": country[0]["id"]}})
        mode = create(PAYMENT_MODE, {"name": f"Transfer probe {tag}", "code": f"TR{tag}", "typeSelect": 9, "inOutSelect": 1})
        update(SALE_ORDER, quote["id"], {"mainInvoicingAddress": {"id": address["id"]}, "paymentMode": {"id": mode["id"]}})
        update(ACCOUNT, sales["id"], {"isTaxAuthorizedOnMoveLine": True})
        vat_system = {m["code"] for m in obj(fin_c.call("GET", f"{F}/requests/{req['id']}/readiness")[1]).get("missing") or []}
        update(ACCOUNT, sales["id"], {"vatSystemSelect": 1})
        tax = search(TAX, "self.code = 'IOETI-DEFAULT'")[0]
        create(ACCOUNT_MANAGEMENT, {"company": {"id": co["id"]}, "tax": {"id": tax["id"]}, "typeSelect": 2, "saleTaxVatSystem1Account": {"id": vat["id"]}})
        journal_check = obj(fin_c.call("GET", f"{F}/requests/{req['id']}/readiness")[1]).get("missing") or []
        update(JOURNAL, journal["id"], {"validAccountTypeSet": [{"id": t["id"]} for t in types.values()]})
        inactive = obj(fin_c.call("GET", f"{F}/requests/{req['id']}/readiness")[1]).get("missing") or []
        for a in (receivable, sales, vat):
            update(ACCOUNT, a["id"], {"statusSelect": 1})
        ready = obj(fin_c.call("GET", f"{F}/requests/{req['id']}/readiness")[1])
        check("a revenue account that accepts tax must say its VAT system; the sales journal must allow every account it posts to, and they must be active; "
              "once the set-up is complete the readiness view says it can be issued",
              "SALE_ACCOUNT_VAT_SYSTEM" in vat_system
              and {("JOURNAL_ACCOUNT", a["code"]) for a in (receivable, sales, vat)} <= {(m["code"], m["detail"]) for m in journal_check}
              and sorted((m["code"], m["detail"]) for m in inactive) == sorted(("ACCOUNT_INACTIVE", a["code"]) for a in (receivable, sales, vat))
              and ready.get("ready") is True and ready.get("missing") == [], (sorted(vat_system), journal_check, inactive, ready))

        before = obj(fin_c.call("GET", F + "/summary")[1])
        s_ok, b_ok = issue(fin_c)
        issued = obj(b_ok)
        found = search(INVOICE, f"self.partner.id = {account['id']}", ("invoiceId", "statusSelect", "exTaxTotal", "taxTotal", "inTaxTotal", "dueDate",
                                                                      "paymentCondition.code", "move", "invoiceDate"))
        inv = found[0] if found else {}
        amount = (Decimal("6000") * Decimal("0.40")).quantize(Decimal("0.01"))
        tax_amount = (amount * Decimal("0.14")).quantize(Decimal("0.01"), ROUND_HALF_UP)
        terms = search(VERSION, "self.policyKey = 'finance.payment-terms'")
        check("the invoice is created, validated and ventilated natively: the milestone's amount, the owners' tax, due in 30 days, a journal entry",
              s_ok == 200 and len(found) == 1 and inv.get("statusSelect") == 3 and dec(inv.get("exTaxTotal")) == amount
              and dec(inv.get("taxTotal")) == tax_amount and dec(inv.get("inTaxTotal")) == amount + tax_amount
              and inv.get("dueDate") == (today + timedelta(days=30)).isoformat() and inv.get("move")
              and inv.get("paymentCondition.code") == f"IOETI-PT-{terms[0]['id'] if terms else '?'}"
              and str(inv.get("invoiceId") or "").startswith(f"INV{tag}-"), (s_ok, err(b_ok), found))
        queue_open = {r["id"] for r in rows(fin_c.call("GET", F + "/queue")[1])}
        queue_issued = {r["id"]: r for r in rows(fin_c.call("GET", F + "/queue?state=issued")[1])}
        mt = fetch(TIMETABLE, milestone, ["invoice", "invoiced"])
        check("the request is ISSUED with the invoice number, leaves the open queue, and the milestone is invoiced",
              issued.get("status") == "ISSUED" and issued.get("invoiceNumber") == inv.get("invoiceId") and req["id"] not in queue_open
              and queue_issued.get(req["id"], {}).get("invoiceNumber") == inv.get("invoiceId")
              and dec(queue_issued.get(req["id"], {}).get("invoiceTotal")) == amount + tax_amount and mt.get("invoice"),
              (issued, queue_issued.get(req["id"]), mt))
        s_again, b_again = issue(fin_c)
        after = obj(fin_c.call("GET", F + "/summary")[1])
        egp_before = next((r for r in before.get("rows") or [] if r["currency"] == "EGP"), {})
        egp_after = next((r for r in after.get("rows") or [] if r["currency"] == "EGP"), {})
        check("issuing again is refused; the figures count the invoice (including tax) and nothing as collected",
              (s_again, err(b_again)[0]) == (422, "REQUEST_STATE") and len(invoices()) == 1
              and dec(egp_after.get("invoiced")) - dec(egp_before.get("invoiced") or 0) == amount + tax_amount
              and dec(egp_after.get("collected")) == dec(egp_before.get("collected") or 0), (s_again, err(b_again), egp_before, egp_after))

        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
        print(f"\n{sum(r['result'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} checks passed")
    finally:
        if prints_on_ventilation:
            update(APP_INVOICE, app_invoice["id"], {"autoGenerateInvoicePrintingFileOnSaleInvoice": True})
        if co:
            cid = int(co["id"])
            # TEST FIXTURE ONLY (disposable database): ventilated invoices and their journal entries cannot be removed through the API
            purge_company_accounting(psql, DATABASE, cid)
        if co:
            # every order of the fixture company (found by company: the opportunity link is not reliable once invoiced)
            quotes = [r["id"] for r in search(SALE_ORDER, f"self.company.id = {co['id']}")]
            if quotes:
                qids = ",".join(map(str, quotes))
                for model, domain in ((INVOICE_REQUEST, f"self.quote.id in ({qids})"), (TIMETABLE, f"self.saleOrder.id in ({qids})"),
                                      (SALE_ORDER_LINE_TAX, f"self.saleOrder.id in ({qids})"),
                                      (SALE_ORDER_LINE, f"self.saleOrder.id in ({qids}) OR self.oldVersionSaleOrder.id in ({qids})"),
                                      (SALE_ORDER, f"self.id in ({qids})")):
                    created.extend((model, r["id"]) for r in search(model, domain) if (model, r["id"]) not in created)
        if co:
            for seq in search(SEQUENCE, f"self.company.id = {co['id']}"):
                _delete_where(admin, RESERVED_SEQUENCE, f"self.sequence.id = {seq['id']}")
                created.extend((SEQUENCE_VERSION, r["id"]) for r in search(SEQUENCE_VERSION, f"self.sequence.id = {seq['id']}"))
                if (SEQUENCE, seq["id"]) not in created:
                    created.append((SEQUENCE, seq["id"]))
            created.extend((ACCOUNT_MANAGEMENT, r["id"]) for r in search(ACCOUNT_MANAGEMENT, f"self.company.id = {co['id']}")
                           if (ACCOUNT_MANAGEMENT, r["id"]) not in created)
            created.extend((PERIOD, r["id"]) for r in search(PERIOD, f"self.year.company.id = {co['id']}") if (PERIOD, r["id"]) not in created)
        for pc in search(PAYMENT_CONDITION, "self.code LIKE 'IOETI-PT-%'"):
            created.extend((PAYMENT_CONDITION_LINE, r["id"]) for r in search(PAYMENT_CONDITION_LINE, f"self.paymentCondition.id = {pc['id']}"))
            created.append((PAYMENT_CONDITION, pc["id"]))
        created.extend((POLICY_TAX, r["id"]) for r in search(POLICY_TAX, "self.id > 0"))
        new_taxes = [r["id"] for r in search(TAX, "self.code LIKE 'IOETI-%'") if r["id"] not in taxes_before]
        if new_taxes:
            created.extend((TAX_LINE, r["id"]) for r in search(TAX_LINE, f"self.tax.id in ({','.join(map(str, new_taxes))})"))
            for tid in new_taxes:
                admin.call("POST", f"/ws/rest/{TAX}/{tid}", {"data": {"id": tid, "version": version(TAX, tid), "activeTaxLine": None}})
            created.extend((TAX, t) for t in new_taxes)
        created.extend((TAX_TYPE, r["id"]) for r in search(TAX_TYPE, "self.code LIKE 'IOETI-%'") if r["id"] not in tax_types_before)
        if co:
            update(ACCOUNT_CONFIG, [rid for m, rid in created if m == ACCOUNT_CONFIG][0],
                   {"customerAccount": None, "customerSalesJournal": None, "custInvSequence": None})
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
        order = {INVOICE_REQUEST: 0, TIMETABLE: 1, SALE_ORDER_LINE_TAX: 1, SALE_ORDER_LINE: 2, SALE_ORDER: 3, POLICY_TAX: 4, ACCOUNT_MANAGEMENT: 4,
                 PAYMENT_CONDITION_LINE: 4, PAYMENT_CONDITION: 5, TAX_LINE: 5, TAX: 6, TAX_TYPE: 7, VERSION: 6, AUDIT: 6, OPP: 5, PRODUCT: 6,
                 PARTNER: 6, ADDRESS: 7, CITY: 8, PAYMENT_MODE: 7, LINE: 6, PERIOD: 6, YEAR: 7, JOURNAL: 7, JOURNAL_TYPE: 8, ACCOUNT: 8, ACCOUNT_TYPE: 9, ACCOUNT_CONFIG: 8,
                 STOCK_CONFIG: 8, SUPPLYCHAIN_CONFIG: 8, STOCK_LOCATION: 9, SEQUENCE_VERSION: 9, SEQUENCE: 10, ROLE: 10, USER: 11, GROUP: 12, PERM: 13, COMPANY: 14}
        complete, left = cleanup(admin, list(dict.fromkeys(created)), order)
        if not complete:
            print(f"FAIL cleanup left {left}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "invoicing-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
