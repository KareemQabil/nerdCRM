#!/usr/bin/env python3
"""Scenario S5 (live): one client from the first enquiry to cash, under the owners' decided rules.

Run against a RUNNING local/CI Axelor; never against production. The per-rule probes each set one policy by hand; this
scenario starts the way a new company would: a policy owner applies the recommended starting values (R1) in one step, and
then every team works one fictional client through them. Roles are TEST FIXTURES built from native permissions (D-07
defines the real ones): a marketer records enquiries; RepA and RepB are the line's sales team; the Manager holds the sales
manager role and manages the line; Finance issues invoices and records payments. Finance's accounting set-up (fiscal year,
journals, sequences, accounts, payment modes) is entered by the administrator, standing in for finance's own.
Steps, through the IOETI APIs only (generic /ws/rest is used by the administrator for fixtures and reads):
  1 the policy owner applies the recommended values: tax 14%, payment terms 30 days, approval tiers 5/10/20, validity 30
    days, won on an accepted quotation, response targets and working hours, routing to the line's responsible team
  2 three enquiries are routed round robin inside the team (RepA, RepB, RepA); each owner is told; the targets are DUE
  3 RepA calls the first within its target (MET); the lead is converted to an account and an opportunity
  4 the quotation: 3 audit days at 10,000, an 8% discount → the sales manager's tier; finalizing directly is refused;
    the review goes to the manager, who approves: finalized with VAT 14% and valid for 30 days
  5 the client's purchase order is filed and recorded as the acceptance: the order is confirmed natively; the
    opportunity is won on it (ACCEPTED_QUOTE)
  6 deposit 30%: invoiced by finance with the tax and a due date 30 days out; paid in two transfers; a third is refused
  7 balance 70%: invoiced; half of it credited with a reason
  8 every figure is exact; nothing was sent outside the CRM
Report: logs/scenario-quote-to-cash.json.
"""
import base64
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
CURRENCY, TEAM, SOURCE = "com.axelor.apps.base.db.Currency", "com.axelor.team.db.Team", "com.axelor.apps.base.db.Source"
STOCK_LOCATION, STOCK_CONFIG = "com.axelor.apps.stock.db.StockLocation", "com.axelor.apps.stock.db.StockConfig"
ACCOUNT, ACCOUNT_TYPE, ACCOUNT_CONFIG = "com.axelor.apps.account.db.Account", "com.axelor.apps.account.db.AccountType", "com.axelor.apps.account.db.AccountConfig"
ACCOUNT_MANAGEMENT = "com.axelor.apps.account.db.AccountManagement"
JOURNAL, JOURNAL_TYPE = "com.axelor.apps.account.db.Journal", "com.axelor.apps.account.db.JournalType"
YEAR, PERIOD = "com.axelor.apps.base.db.Year", "com.axelor.apps.base.db.Period"
TAX, TAX_LINE, TAX_TYPE = "com.axelor.apps.account.db.Tax", "com.axelor.apps.account.db.TaxLine", "com.axelor.apps.account.db.TaxType"
PAYMENT_CONDITION, PAYMENT_CONDITION_LINE = "com.axelor.apps.account.db.PaymentCondition", "com.axelor.apps.account.db.PaymentConditionLine"
SALE_ORDER, SALE_ORDER_LINE = "com.axelor.apps.sale.db.SaleOrder", "com.axelor.apps.sale.db.SaleOrderLine"
SALE_ORDER_LINE_TAX, TIMETABLE = "com.axelor.apps.sale.db.SaleOrderLineTax", "com.axelor.apps.supplychain.db.Timetable"
INVOICE, INVOICE_PAYMENT = "com.axelor.apps.account.db.Invoice", "com.axelor.apps.account.db.InvoicePayment"
SUPPLYCHAIN_CONFIG, PAYMENT_MODE = "com.axelor.apps.supplychain.db.SupplyChainConfig", "com.axelor.apps.account.db.PaymentMode"
APP_INVOICE = "com.axelor.studio.db.AppInvoice"
ADDRESS, COUNTRY, CITY = "com.axelor.apps.base.db.Address", "com.axelor.apps.base.db.Country", "com.axelor.apps.base.db.City"
SEQUENCE, SEQUENCE_VERSION = "com.axelor.apps.base.db.Sequence", "com.axelor.apps.base.db.SequenceVersion"
LEAD, EVENT, OPP = "com.axelor.apps.crm.db.Lead", "com.axelor.apps.crm.db.Event", "com.axelor.apps.crm.db.Opportunity"
LINE, ROUTING, MISS = "com.ioeti.businessline.db.BusinessLine", "com.ioeti.businessline.db.LeadRouting", "com.ioeti.businessline.db.LeadResponseMiss"
VERSION, AUDIT = "com.ioeti.core.db.PolicyVersion", "com.ioeti.admin.db.AdminAuditEvent"
POLICY_TAX, INVOICE_REQUEST = "com.ioeti.commercial.db.PolicyTaxLine", "com.ioeti.workspace.db.InvoiceRequest"
REVIEW, REVIEW_EVENT = "com.ioeti.workspace.db.ReviewRequest", "com.ioeti.workspace.db.ReviewEvent"
DOC, REV, META_FILE = "com.ioeti.content.db.RecordDocument", "com.ioeti.content.db.DocumentRevision", "com.axelor.meta.db.MetaFile"
NOTICE, MESSAGE, OUTBOX = "com.ioeti.automation.db.InboxNotice", "com.axelor.mail.db.MailMessage", "com.axelor.message.db.Message"
WS, QUOTES, F, P = "/ws/ioeti/workspace", "/ws/ioeti/quotes", "/ws/ioeti/finance", "/ws/ioeti/policies"
MK, LD, OPPS = "/ws/ioeti/marketing", "/ws/ioeti/leads", "/ws/ioeti/opportunities"
OWNER_ROLE, MANAGER_ROLE = "ioeti-policy-owner", "ioeti-sales-manager"
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


def money(value):
    return Decimal(value).quantize(Decimal("0.01"), ROUND_HALF_UP)


def pdf(text):
    return b"%PDF-1.4\n% " + text.encode() + b"\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"


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
        raise SystemExit("this database already has policy owners; run the scenario on a disposable database")
    if search(VERSION, "self.id > 0"):
        raise SystemExit("this database already has policy values; run the scenario on a disposable database")
    roles_before = {r["name"] for r in search(ROLE, f"self.name IN ('{OWNER_ROLE}', '{MANAGER_ROLE}')", ("name",))}
    taxes_before = {r["id"] for r in search(TAX, "self.code LIKE 'IOETI-%'")}
    tax_types_before = {r["id"] for r in search(TAX_TYPE, "self.code LIKE 'IOETI-%'")}
    outbox_before = len(search(OUTBOX, "self.id > 0", limit=100000))
    app_invoice = (search(APP_INVOICE, "self.id > 0", ("autoGenerateInvoicePrintingFileOnSaleInvoice",)) or [{}])[0]
    prints_on_ventilation = app_invoice.get("autoGenerateInvoicePrintingFileOnSaleInvoice") is True
    exit_code = 1
    users = {}
    co = line = None
    try:
        egp = search(CURRENCY, "self.codeISO = 'EGP'")[0]
        today = date.today()
        # --- the company, as finance and the administrator set it up (TEST FIXTURES) ----------------------------------
        co = create(COMPANY, {"name": f"Quote to Cash Co {tag}", "code": f"QC{tag}", "currency": {"id": egp["id"]}})
        location = create(STOCK_LOCATION, {"name": f"Quote to cash {tag}", "company": {"id": co["id"]}, "typeSelect": 1})
        create(STOCK_CONFIG, {"company": {"id": co["id"]}, "pickupDefaultStockLocation": {"id": location["id"]}})
        create(SUPPLYCHAIN_CONFIG, {"company": {"id": co["id"]}})
        config = create(ACCOUNT_CONFIG, {"company": {"id": co["id"]}})
        create(SEQUENCE, {"name": f"Quotations {tag}", "codeSelect": "saleOrder", "company": {"id": co["id"]}, "prefixe": f"Q{tag}-",
                          "padding": 4, "toBeAdded": 1})
        types = {t: create(ACCOUNT_TYPE, {"name": f"TEST ONLY {t} {tag}", "technicalTypeSelect": t}) for t in ("income", "receivable", "tax", "cash")}
        sales = create(ACCOUNT, {"name": f"TEST ONLY sales {tag}", "code": f"7{tag}", "company": {"id": co["id"]}, "commonPosition": 0,
                                 "accountType": {"id": types["income"]["id"]}, "isTaxAuthorizedOnMoveLine": True, "vatSystemSelect": 1, "statusSelect": 1})
        receivable = create(ACCOUNT, {"name": f"TEST ONLY customers {tag}", "code": f"4{tag}", "company": {"id": co["id"]}, "commonPosition": 0,
                                      "accountType": {"id": types["receivable"]["id"]}, "reconcileOk": True, "useForPartnerBalance": True, "statusSelect": 1})
        vat = create(ACCOUNT, {"name": f"TEST ONLY VAT collected {tag}", "code": f"V{tag}", "company": {"id": co["id"]}, "commonPosition": 0,
                               "accountType": {"id": types["tax"]["id"]}, "statusSelect": 1})
        bank = create(ACCOUNT, {"name": f"TEST ONLY bank {tag}", "code": f"5{tag}", "company": {"id": co["id"]}, "commonPosition": 0,
                                "accountType": {"id": types["cash"]["id"]}, "statusSelect": 1})
        product = create(PRODUCT, {"name": f"Audit day {tag}", "code": f"QC-{tag}", "sellable": True, "salePrice": "10000",
                                   "saleCurrency": {"id": egp["id"]}, "productTypeSelect": "service"})
        create(ACCOUNT_MANAGEMENT, {"company": {"id": co["id"]}, "product": {"id": product["id"]}, "typeSelect": 1, "saleAccount": {"id": sales["id"]}})
        year = create(YEAR, {"name": f"FY {tag}", "code": f"FY{tag}", "company": {"id": co["id"]}, "typeSelect": 1, "statusSelect": 1,
                             "fromDate": date(today.year, 1, 1).isoformat(), "toDate": date(today.year + 1, 12, 31).isoformat()})
        create(PERIOD, {"name": f"P {tag}", "code": f"P{tag}", "year": {"id": year["id"]}, "statusSelect": 1,
                        "fromDate": date(today.year, 1, 1).isoformat(), "toDate": date(today.year + 1, 12, 31).isoformat()})

        def journal(kind, code, technical, origin, account_types):
            seq = create(SEQUENCE, {"name": f"{kind} moves {tag}", "codeSelect": "move", "company": {"id": co["id"]}, "prefixe": f"{code}{tag}-",
                                    "padding": 5, "toBeAdded": 1})
            jtype = create(JOURNAL_TYPE, {"name": f"{kind} {tag}", "code": f"J{code}{tag}", "technicalTypeSelect": technical})
            return create(JOURNAL, {"name": f"{kind} {tag}", "code": f"{code}{tag}", "company": {"id": co["id"]}, "journalType": {"id": jtype["id"]},
                                    "sequence": {"id": seq["id"]}, "statusSelect": 1, "authorizedFunctionalOriginSelect": origin,
                                    "validAccountTypeSet": [{"id": types[t]["id"]} for t in account_types]})
        sales_journal = journal("Sales", "VT", 2, "3", ("income", "receivable", "tax"))
        bank_journal = journal("Bank", "BQ", 4, "5", ("receivable", "cash"))
        cn_journal = journal("Credit notes", "AV", 3, "3", ("income", "receivable", "tax"))
        inv_seq = create(SEQUENCE, {"name": f"Invoices {tag}", "codeSelect": "invoice", "company": {"id": co["id"]}, "prefixe": f"INV{tag}-",
                                    "padding": 5, "toBeAdded": 1})
        ref_seq = create(SEQUENCE, {"name": f"Credit notes {tag}", "codeSelect": "invoice", "company": {"id": co["id"]}, "prefixe": f"CN{tag}-",
                                    "padding": 5, "toBeAdded": 1})
        for code, prefix in (("reconcile", "RC"), ("reconcileGroupDraft", "RGD"), ("reconcileGroupFinal", "RGF")):
            create(SEQUENCE, {"name": f"Reconciliations {code} {tag}", "codeSelect": code, "company": {"id": co["id"]}, "prefixe": f"{prefix}{tag}-",
                              "padding": 5, "toBeAdded": 1})
        mode = create(PAYMENT_MODE, {"name": f"Transfer {tag}", "code": f"TR{tag}", "typeSelect": 9, "inOutSelect": 1})
        refund_mode = create(PAYMENT_MODE, {"name": f"Refund {tag}", "code": f"RF{tag}", "typeSelect": 9, "inOutSelect": 2})
        create(ACCOUNT_MANAGEMENT, {"company": {"id": co["id"]}, "paymentMode": {"id": mode["id"]}, "typeSelect": 3,
                                    "journal": {"id": bank_journal["id"]}, "cashAccount": {"id": bank["id"]}})
        update(ACCOUNT_CONFIG, config["id"], {"customerAccount": {"id": receivable["id"]}, "customerSalesJournal": {"id": sales_journal["id"]},
                                              "custInvSequence": {"id": inv_seq["id"]}, "customerCreditNoteJournal": {"id": cn_journal["id"]},
                                              "custRefSequence": {"id": ref_seq["id"]}, "outPaymentMode": {"id": refund_mode["id"]}})
        if prints_on_ventilation:
            # TEST FIXTURE: stands in for finance's invoice print template (the Arabic invoice layout is a later slice)
            update(APP_INVOICE, app_invoice["id"], {"autoGenerateInvoicePrintingFileOnSaleInvoice": False})
        country = search(COUNTRY, "self.alpha2Code = 'EG'") or search(COUNTRY, "self.addressTemplate.name = 'DEFAULT'", limit=1)
        city = create(CITY, {"name": f"Scenario City {tag}", "country": {"id": country[0]["id"]}})
        address = create(ADDRESS, {"addressl4": "1 Scenario Street", "addressl6": "11511 Scenario City", "streetName": "Scenario Street",
                                   "zip": "11511", "city": {"id": city["id"]}, "country": {"id": country[0]["id"]}})

        # --- people and their native rights (TEST FIXTURES) ------------------------------------------------------------
        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"qc.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})
        rwc = dict(canRead=True, canWrite=True, canCreate=True)
        marketing = [perm("m.lead", LEAD, **rwc), perm("m.line", LINE, canRead=True), perm("m.source", SOURCE, canRead=True)]
        rep = [perm("lead", LEAD, "self.user = ?", **rwc), perm("event", EVENT, "self.user = ?", **rwc), perm("opp", OPP, "self.user = ?", **rwc),
               perm("partner", PARTNER, **rwc), perm("so", SALE_ORDER, "self.salespersonUser = ?", **rwc),
               perm("sol", SALE_ORDER_LINE, "self.saleOrder.salespersonUser = ?", canRead=True, canWrite=True, canCreate=True, canRemove=True),
               perm("tt", TIMETABLE, "self.saleOrder.salespersonUser = ?", canRead=True, canWrite=True, canCreate=True, canRemove=True),
               perm("ireq", INVOICE_REQUEST, "self.requestedBy = ?", **rwc), perm("review", REVIEW, **rwc),
               perm("product", PRODUCT, canRead=True), perm("line", LINE, canRead=True), perm("source", SOURCE, canRead=True)]
        manager = [perm("g.opp", OPP, canRead=True), perm("g.so", SALE_ORDER, **rwc), perm("g.sol", SALE_ORDER_LINE, **rwc),
                   perm("g.partner", PARTNER, canRead=True), perm("g.line", LINE, canRead=True), perm("g.review", REVIEW, **rwc),
                   perm("g.lead", LEAD, canRead=True)]
        fin = [perm("f.so", SALE_ORDER, canRead=True), perm("f.ireq", INVOICE_REQUEST, canRead=True), perm("f.partner", PARTNER, canRead=True),
               perm("f.tt", TIMETABLE, canRead=True), perm("f.inv", INVOICE, **rwc), perm("f.pay", INVOICE_PAYMENT, **rwc)]
        none = [perm("n.partner", PARTNER, canRead=True)]
        groups = {k: create(GROUP, {"code": f"qc-{k}-{tag}", "name": f"Quote to cash {k} {tag}", "permissions": [{"id": p["id"]} for p in v]})
                  for k, v in (("marketing", marketing), ("rep", rep), ("manager", manager), ("fin", fin), ("none", none))}
        found = search(ROLE, f"self.name = '{MANAGER_ROLE}'")
        manager_role = found[0]["id"] if found else create(ROLE, {"name": MANAGER_ROLE})["id"]
        line = create(LINE, {"code": f"QCL{tag}", "nameEn": f"Quote to cash line {tag}", "nameAr": "خط السيناريو", "statusSelect": 2})
        sessions = {}
        for label, group, roles, lines in (("Marketer", "marketing", [], [line]), ("RepA", "rep", [], [line]), ("RepB", "rep", [], [line]),
                                           ("Manager", "manager", [manager_role], [line]), ("Finance", "fin", [], []), ("Owner", "none", [], [])):
            password = "Qc!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"qc.{label.lower()}.{tag}", "name": f"Scenario {label} {tag}", "blocked": False, "language": "ar",
                                         "group": {"id": groups[group]["id"]}, "activeCompany": {"id": co["id"]},
                                         "roles": [{"id": r} for r in roles], "password": axelor_password_hash(password),
                                         "ioetiBusinessLines": [{"id": x["id"]} for x in lines]})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        mk, rep_a, rep_b, mgr, fin_c, owner = (sessions[k] for k in ("Marketer", "RepA", "RepB", "Manager", "Finance", "Owner"))
        uid = {k: u["id"] for k, u in users.items()}
        team = create(TEAM, {"name": f"Scenario sales {tag}", "code": f"QCT{tag}", "members": [{"id": uid["RepA"]}, {"id": uid["RepB"]}]})
        update(LINE, line["id"], {"responsibleTeam": {"id": team["id"]}, "manager": {"id": uid["Manager"]}})
        s, _ = admin.call("POST", P + "/owners", {"userId": uid["Owner"]})
        assert s == 200, f"appointing the policy owner: {s}"

        def inbox(client):
            return [(n["kind"], n["subject"], n["subjectId"]) for n in rows(client.call("GET", "/ws/ioeti/automation/inbox")[1])]

        # --- 1. the owners' rules: the recommended starting values, applied in one step --------------------------------
        wanted = ["finance.tax|", "finance.payment-terms|", "sales.quote-approval|", "sales.quote-validity|", f"sales.won-evidence|{line['code']}",
                  "leads.response-target|", "work.calendar|", f"leads.routing|{line['code']}"]
        recs = {r["id"]: r for r in obj(owner.call("GET", P + "/recommended")[1]).get("recommendations", [])}
        s, body = owner.call("POST", P + "/recommended/apply", {"ids": wanted})
        applied = obj(body).get("applied") or []
        routing_rule = (recs.get(f"leads.routing|{line['code']}") or {}).get("value") or {}
        check("1 the policy owner applies the recommended values in one step: tax, terms, approval tiers, validity, won evidence, "
              "response targets, working hours and routing to the line's responsible team",
              s == 200 and sorted(applied) == sorted(wanted) and routing_rule.get("rules") == [{"teamId": team["id"]}],
              (s, err(body), applied, routing_rule))

        # --- 2. enquiries routed round robin inside the team -------------------------------------------------------------
        leads = []
        for n, org in enumerate(("مصنع النصر للأغذية", "شركة الفجر للمقاولات", "مستشفى الشفاء"), start=1):
            s_, b_ = mk.call("POST", MK + "/leads", {"name": f"عميل السيناريو {n} {tag}", "organization": f"{org} {tag}",
                                                      "businessLineCode": line["code"], "governorate": "CAIRO", "confirmNotDuplicate": True})
            if obj(b_).get("id"):
                created.append((LEAD, obj(b_)["id"]))
            leads.append(obj(b_))
        owners = [(fetch(LEAD, l_.get("id"), ["user"]).get("user") or {}).get("id") for l_ in leads]
        told_a = inbox(rep_a).count(("LEAD_ROUTED", "LEAD", leads[0].get("id")))
        told_b = inbox(rep_b).count(("LEAD_ROUTED", "LEAD", leads[1].get("id")))
        first = obj(rep_a.call("GET", f"{LD}/{leads[0].get('id')}")[1])
        check("2 three enquiries go round robin inside the line's team (RepA, RepB, RepA); each owner is told; the response target is DUE",
              owners == [uid["RepA"], uid["RepB"], uid["RepA"]] and told_a == 1 and told_b == 1
              and (first.get("response") or {}).get("status") == "DUE", (owners, told_a, told_b, first.get("response")))

        # --- 3. contacted within the target, then converted ---------------------------------------------------------------
        s, body = rep_a.call("POST", WS + "/activities", {"record": "LEAD", "recordId": first["id"], "version": first.get("version"), "kind": "CALL",
                                                          "subject": "مكالمة تعارف", "outcome": "مهتمين بشهادة أيزو 9001"})
        if obj(body).get("id"):
            created.append((EVENT, obj(body)["id"]))
        met = obj(rep_a.call("GET", f"{LD}/{first['id']}")[1])
        s_cv, b_cv = rep_a.call("POST", f"{LD}/{first['id']}/convert", {"version": met.get("version"), "opportunityName": f"شهادة أيزو للنصر {tag}",
                                                                        "businessLineCode": line["code"]})
        conv = obj(b_cv)
        for model, key in ((PARTNER, "accountId"), (PARTNER, "contactId"), (OPP, "opportunityId")):
            if conv.get(key):
                created.append((model, conv[key]))
        check("3 RepA calls within the target (MET) and converts the lead into an account and an opportunity on the line",
              s == 201 and (met.get("response") or {}).get("status") == "MET" and s_cv == 201 and conv.get("accountId") and conv.get("opportunityId"),
              (s, met.get("response"), s_cv, err(b_cv), conv))
        opp_id, account_id = conv.get("opportunityId"), conv.get("accountId")

        # --- 4. the quotation, the discount and the manager's approval ----------------------------------------------------
        s, b = rep_a.call("POST", QUOTES, {"opportunityId": opp_id, "opportunityVersion": version(OPP, opp_id)})
        quote = obj(b)
        qid = quote.get("id")
        s_l, b_l = rep_a.call("POST", f"{QUOTES}/{qid}/lines", {"version": version(SALE_ORDER, qid), "productId": product["id"], "quantity": 3})
        q = obj(b_l)
        s_d, b_d = rep_a.call("POST", f"{QUOTES}/{qid}/lines/{q['lines'][0]['id']}/discount", {"version": version(SALE_ORDER, qid), "percent": 8})
        q = obj(b_d)
        for title, pct, due in (("Deposit", "30", today), ("Balance", "70", today + timedelta(days=60))):
            s_m, b_m = rep_a.call("POST", f"{QUOTES}/{qid}/milestones", {"version": version(SALE_ORDER, qid), "title": title, "percentage": pct,
                                                                          "dueDate": due.isoformat()})
            assert s_m in (200, 201), f"milestone {s_m} {b_m}"
        update(SALE_ORDER, qid, {"mainInvoicingAddress": {"id": address["id"]}, "paymentMode": {"id": mode["id"]}})  # client data finance needs
        s_fin, b_fin = rep_a.call("POST", f"{QUOTES}/{qid}/finalize", {"version": version(SALE_ORDER, qid)})
        check("4a 3 audit days at 10,000 with an 8% discount fall in the sales manager's tier (recommended 5/10/20): finalizing directly is refused",
              s == 201 and s_l == 201 and s_d == 200 and dec(q.get("totalBeforeTax")) == Decimal("27600")
              and (q.get("approval") or {}).get("status") == "NEEDED" and q["approval"].get("approver") == "SALES_MANAGER"
              and (s_fin, err(b_fin)[0]) == (422, "APPROVAL_REQUIRED"), (s, s_l, s_d, q.get("totalBeforeTax"), q.get("approval"), s_fin, err(b_fin)))
        s_req, b_req = rep_a.call("POST", f"{WS}/reviews", {"quoteId": qid, "version": version(SALE_ORDER, qid)})
        review = obj(b_req)
        told_m = inbox(mgr).count(("REVIEW_APPROVAL_NEEDED", "OPPORTUNITY", opp_id))
        s_ap, b_ap = mgr.call("POST", f"{WS}/reviews/{review.get('id')}/approve", {"version": version(REVIEW, review.get("id"))})
        done = obj(rep_a.call("GET", f"{QUOTES}/{qid}")[1])
        tax_total = money(Decimal("27600") * Decimal("0.14"))
        check("4b the review goes to the manager, who approves: the quotation is finalized with VAT 14% and valid for 30 days",
              s_req == 201 and review.get("approver") == "SALES_MANAGER" and told_m == 1 and s_ap == 200
              and fetch(SALE_ORDER, qid, ["statusSelect"]).get("statusSelect") == 2 and dec(done.get("totalWithTax")) == Decimal("27600") + tax_total
              and (done.get("approval") or {}).get("validUntil") == (today + timedelta(days=30)).isoformat(),
              (s_req, review.get("approver"), told_m, s_ap, err(b_ap), done.get("totalWithTax"), done.get("approval")))

        # --- 5. the client's purchase order, and the opportunity won on it -----------------------------------------------
        s_doc, b_doc = rep_a.call("POST", "/ws/ioeti/content/documents", {"subject": "QUOTE", "subjectId": qid, "title": f"PO {tag}", "kind": "EVIDENCE",
                                                                          "fileName": f"po-{tag}.pdf", "contentBase64": base64.b64encode(pdf(f"PO {tag}")).decode()})
        s_acc, b_acc = rep_a.call("POST", f"{WS}/quotes/{qid}/accept", {"version": version(SALE_ORDER, qid), "kind": "PURCHASE_ORDER",
                                                                        "reference": f"PO-{tag}", "acceptedOn": today.isoformat(),
                                                                        "documentId": obj(b_doc).get("id")})
        won = next((st for st in rows(rep_a.call("GET", f"{OPPS}/stages")[1]) if st.get("kind") == "WON"), {})
        s_won, b_won = rep_a.call("POST", f"{OPPS}/{opp_id}/stage", {"version": version(OPP, opp_id), "stageId": won.get("id")})
        check("5 the purchase order is filed and recorded as the acceptance (order confirmed); the opportunity is won on it (ACCEPTED_QUOTE)",
              s_doc == 201 and s_acc == 200 and fetch(SALE_ORDER, qid, ["statusSelect"]).get("statusSelect") == 3
              and s_won == 200 and obj(b_won).get("stageKind") == "WON", (s_doc, s_acc, err(b_acc), s_won, err(b_won)))

        # --- 6. the deposit: invoiced, then paid in two transfers ---------------------------------------------------------
        stones = {m.get("title"): m["id"] for m in search(TIMETABLE, f"self.saleOrder.id = {qid}", ("title",))}
        tax = search(TAX, "self.code = 'IOETI-DEFAULT'")
        if tax:  # the VAT account for the tax the policy created (finance's set-up)
            create(ACCOUNT_MANAGEMENT, {"company": {"id": co["id"]}, "tax": {"id": tax[0]["id"]}, "typeSelect": 2, "saleTaxVatSystem1Account": {"id": vat["id"]}})
        before = obj(fin_c.call("GET", F + "/summary")[1])
        s_r, b_r = rep_a.call("POST", f"{WS}/invoice-requests", {"milestoneId": stones.get("Deposit"), "quoteVersion": version(SALE_ORDER, qid)})
        req = obj(b_r)
        if req.get("id"):
            created.append((INVOICE_REQUEST, req["id"]))
        s_i, b_i = fin_c.call("POST", f"{WS}/invoice-requests/{req.get('id')}/issue", {"version": version(INVOICE_REQUEST, req.get("id"))})
        invoices = search(INVOICE, f"self.saleOrder.id = {qid} AND self.operationTypeSelect = 3",
                          ("invoiceId", "statusSelect", "exTaxTotal", "taxTotal", "inTaxTotal", "dueDate"))
        dep = invoices[0] if invoices else {}
        dep_ex = money(Decimal("27600") * Decimal("0.30"))
        dep_total = dep_ex + money(dep_ex * Decimal("0.14"))
        check("6a the deposit (30% = 8,280) is invoiced by finance with VAT 14% and due in 30 days (the recommended terms)",
              s_r == 201 and s_i == 200 and len(invoices) == 1 and dep.get("statusSelect") == 3 and dec(dep.get("exTaxTotal")) == dep_ex
              and dec(dep.get("inTaxTotal")) == dep_total and dep.get("dueDate") == (today + timedelta(days=30)).isoformat(),
              (s_r, err(b_r), s_i, err(b_i), invoices))
        dep_id = dep.get("id")

        def pay(amount, ref):
            return fin_c.call("POST", f"{F}/invoices/{dep_id}/payments", {"version": version(INVOICE, dep_id), "amount": float(amount), "reference": ref})
        s_p1, b_p1 = pay(Decimal("5000"), f"TRX-{tag}-1")
        s_p2, b_p2 = pay(dep_total - Decimal("5000"), f"TRX-{tag}-2")
        s_p3, b_p3 = pay(Decimal("1"), f"TRX-{tag}-3")
        check("6b paid in two transfers: partly paid, then paid; a third payment is refused (ALREADY_PAID)",
              s_p1 == 201 and obj(b_p1).get("status") == "PARTLY_PAID" and s_p2 == 201 and obj(b_p2).get("status") == "PAID"
              and (s_p3, err(b_p3)[0]) == (422, "ALREADY_PAID"), (s_p1, err(b_p1), s_p2, err(b_p2), s_p3, err(b_p3)))

        # --- 7. the balance: invoiced, half credited ----------------------------------------------------------------------
        s_r2, b_r2 = rep_a.call("POST", f"{WS}/invoice-requests", {"milestoneId": stones.get("Balance"), "quoteVersion": version(SALE_ORDER, qid)})
        req2 = obj(b_r2)
        if req2.get("id"):
            created.append((INVOICE_REQUEST, req2["id"]))
        s_i2, _ = fin_c.call("POST", f"{WS}/invoice-requests/{req2.get('id')}/issue", {"version": version(INVOICE_REQUEST, req2.get("id"))})
        balance = next((x for x in search(INVOICE, f"self.saleOrder.id = {qid} AND self.operationTypeSelect = 3", ("exTaxTotal", "inTaxTotal"))
                        if x["id"] != dep_id), {})
        bal_ex = Decimal("27600") - dep_ex
        s_cn, b_cn = fin_c.call("POST", f"{F}/invoices/{balance.get('id')}/credit-notes", {"version": version(INVOICE, balance.get("id")), "percent": 50,
                                                                                          "reason": f"half the audit days cancelled {tag}"})
        refunds = search(INVOICE, f"self.originalInvoice.id = {balance.get('id') or 0}", ("statusSelect", "exTaxTotal", "operationTypeSelect"))
        check("7 the balance (70% = 19,320) is invoiced; half of it is credited with its reason (9,660), issued natively",
              s_r2 == 201 and s_i2 == 200 and dec(balance.get("exTaxTotal")) == bal_ex and s_cn == 201 and len(refunds) == 1
              and refunds[0].get("statusSelect") == 3 and dec(refunds[0].get("exTaxTotal")) == money(bal_ex / 2),
              (s_r2, s_i2, balance, s_cn, err(b_cn), refunds))

        # --- 8. the figures agree, and nothing left the CRM --------------------------------------------------------------
        after = obj(fin_c.call("GET", F + "/summary")[1])
        egp_b = next((r for r in before.get("rows") or [] if r["currency"] == "EGP"), {})
        egp_a = next((r for r in after.get("rows") or [] if r["currency"] == "EGP"), {})
        outbox_after = len(search(OUTBOX, "self.id > 0", limit=100000))
        bal_total = money(bal_ex * Decimal("1.14"))
        credit_total = money(money(bal_ex / 2) * Decimal("1.14"))
        check("8 collected grows by exactly the money received (the deposit, not the credit note); invoiced grows by both invoices less the "
              "credit note; the quotation total equals the two invoices; nothing was sent out",
              dec(egp_a.get("collected")) - dec(egp_b.get("collected") or 0) == dep_total
              and dec(egp_a.get("invoiced")) - dec(egp_b.get("invoiced") or 0) == dep_total + bal_total - credit_total
              and dec(dep.get("exTaxTotal") or 0) + dec(balance.get("exTaxTotal") or 0) == Decimal("27600") and outbox_after == outbox_before,
              (egp_b.get("collected"), egp_a.get("collected"), egp_b.get("invoiced"), egp_a.get("invoiced"), dep_total + bal_total - credit_total,
               outbox_before, outbox_after))

        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
        print(f"\n{sum(r['result'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} checks passed")
    finally:
        if prints_on_ventilation:
            update(APP_INVOICE, app_invoice["id"], {"autoGenerateInvoicePrintingFileOnSaleInvoice": True})
        if co:
            # TEST FIXTURE ONLY (disposable database): ventilated invoices and their journal entries cannot be removed through the API
            purge_company_accounting(psql, DATABASE, int(co["id"]))
            quotes = [r["id"] for r in search(SALE_ORDER, f"self.company.id = {co['id']}")]
            if quotes:
                qids = ",".join(map(str, quotes))
                for model, domain in ((INVOICE_REQUEST, f"self.quote.id in ({qids})"), (TIMETABLE, f"self.saleOrder.id in ({qids})"),
                                      (REVIEW_EVENT, f"self.review.quote.id in ({qids})"), (REVIEW, f"self.quote.id in ({qids})"),
                                      (SALE_ORDER_LINE_TAX, f"self.saleOrder.id in ({qids})"),
                                      (SALE_ORDER_LINE, f"self.saleOrder.id in ({qids}) OR self.oldVersionSaleOrder.id in ({qids})"),
                                      (SALE_ORDER, f"self.id in ({qids})")):
                    created.extend((model, r["id"]) for r in search(model, domain) if (model, r["id"]) not in created)
                for d in search(DOC, f"self.subjectSelect = 4 AND self.subjectId in ({qids})"):
                    for r in search(REV, f"self.document.id = {d['id']}", ("id", "file")):
                        created.append((REV, r["id"]))
                        if r.get("file"):
                            created.append((META_FILE, r["file"]["id"]))
                    created.append((DOC, d["id"]))
            for seq in search(SEQUENCE, f"self.company.id = {co['id']}"):
                _delete_where(admin, RESERVED_SEQUENCE, f"self.sequence.id = {seq['id']}")
                created.extend((SEQUENCE_VERSION, r["id"]) for r in search(SEQUENCE_VERSION, f"self.sequence.id = {seq['id']}"))
                if (SEQUENCE, seq["id"]) not in created:
                    created.append((SEQUENCE, seq["id"]))
            created.extend((ACCOUNT_MANAGEMENT, r["id"]) for r in search(ACCOUNT_MANAGEMENT, f"self.company.id = {co['id']}")
                           if (ACCOUNT_MANAGEMENT, r["id"]) not in created)
            created.extend((PERIOD, r["id"]) for r in search(PERIOD, f"self.year.company.id = {co['id']}") if (PERIOD, r["id"]) not in created)
            update(ACCOUNT_CONFIG, config["id"], {"customerAccount": None, "customerSalesJournal": None, "custInvSequence": None,
                                                  "customerCreditNoteJournal": None, "custRefSequence": None, "outPaymentMode": None})
        lead_ids = [rid for m, rid in created if m == LEAD]
        partner_ids = [rid for m, rid in created if m == PARTNER]
        opp_ids = [rid for m, rid in created if m == OPP]
        if lead_ids:
            ids = ",".join(map(str, lead_ids))
            for model, domain in ((ROUTING, f"self.lead.id IN ({ids})"), (MISS, f"self.lead.id IN ({ids})"), (EVENT, f"self.eventLead.id IN ({ids})"),
                                  (NOTICE, f"self.subject = 'LEAD' AND self.subjectId IN ({ids})"),
                                  (MESSAGE, f"self.relatedModel = '{LEAD}' AND self.relatedId IN ({ids})")):
                created.extend((model, r["id"]) for r in search(model, domain) if (model, r["id"]) not in created)
        for model, ids, field in ((EVENT, partner_ids, "partner"), (EVENT, opp_ids, "opportunity")):
            if ids:
                created.extend((model, r["id"]) for r in search(model, f"self.{field}.id IN ({','.join(map(str, ids))})") if (model, r["id"]) not in created)
        if opp_ids:
            created.extend((NOTICE, r["id"]) for r in search(NOTICE, f"self.subject = 'OPPORTUNITY' AND self.subjectId IN ({','.join(map(str, opp_ids))})"))
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
        if line:
            update(LINE, line["id"], {"responsibleTeam": None, "manager": None})
        if partner_ids:
            # TEST FIXTURE ONLY (disposable database): the converted account lists its contact; saving the account to empty the
            # list would run Axelor's accounting checks on a company whose set-up is being removed, so the link row goes by SQL
            psql(DATABASE, "DELETE FROM base_partner_contact_partner_set WHERE base_partner IN (" + ",".join(str(int(r)) for r in partner_ids) + ");")
        ids = [x["id"] for x in users.values()]
        if ids:
            joined = ",".join(map(str, ids))
            created.extend((VERSION, v["id"]) for v in search(VERSION, f"self.author.id in ({joined})"))
            created.extend((AUDIT, a["id"]) for a in search(AUDIT, f"self.actor.id in ({joined}) OR (self.subject = 'USER' AND self.subjectId in ({joined}))"))
            created.extend((NOTICE, n["id"]) for n in search(NOTICE, f"self.recipient.id in ({joined})") if (NOTICE, n["id"]) not in created)
            for user in users.values():
                current = fetch(USER, user["id"], ["version"])
                if current:
                    admin.call("POST", f"/ws/rest/{USER}/{user['id']}", {"data": {"id": user["id"], "version": current.get("version"), "roles": [], "blocked": True}})
        for name in (OWNER_ROLE, MANAGER_ROLE):
            if name not in roles_before:
                created.extend((ROLE, r["id"]) for r in search(ROLE, f"self.name = '{name}'"))
        order = {NOTICE: 0, ROUTING: 0, MISS: 0, MESSAGE: 0, INVOICE_REQUEST: 0, REVIEW_EVENT: 0, EVENT: 0, REVIEW: 1, TIMETABLE: 1, SALE_ORDER_LINE_TAX: 1,
                 REV: 1, DOC: 2, META_FILE: 3, SALE_ORDER_LINE: 2, SALE_ORDER: 3, POLICY_TAX: 4, ACCOUNT_MANAGEMENT: 4, PAYMENT_CONDITION_LINE: 4,
                 PAYMENT_CONDITION: 5, TAX_LINE: 5, TAX: 6, TAX_TYPE: 7, VERSION: 6, AUDIT: 6, OPP: 4, LEAD: 5, PRODUCT: 6, PARTNER: 6, ADDRESS: 7,
                 CITY: 8, PAYMENT_MODE: 7, LINE: 12, TEAM: 6, PERIOD: 6, YEAR: 7, JOURNAL: 7, JOURNAL_TYPE: 8, ACCOUNT: 8, ACCOUNT_TYPE: 9,
                 ACCOUNT_CONFIG: 8, STOCK_CONFIG: 8, SUPPLYCHAIN_CONFIG: 8, STOCK_LOCATION: 9, SEQUENCE_VERSION: 9, SEQUENCE: 10, ROLE: 10,
                 USER: 11, GROUP: 12, PERM: 13, COMPANY: 14}
        complete, left = cleanup(admin, list(dict.fromkeys(created)), order)
        # change-tracking messages written for the fixtures (users, groups, permissions, team, line), by the fixtures' tag
        for m in search(MESSAGE, f"self.relatedName LIKE '%{tag}%'"):
            admin.call("DELETE", f"/ws/rest/{MESSAGE}/{m['id']}")
        if not complete:
            print(f"FAIL cleanup left {left}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "scenario-quote-to-cash.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
