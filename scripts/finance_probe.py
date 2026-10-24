#!/usr/bin/env python3
"""Finance's invoicing queue within D-06: live probe against a RUNNING local/CI Axelor; never against
production. Roles are TEST FIXTURES from native permissions: two salespeople who own their orders and
their invoice requests, a finance person who reads every order and request (but not accounting
invoices), and a person with no finance rights. Confirming an order is D-06/D-11 and blocked in the API,
so it is done with SQL in the disposable database as a stand-in: TEST FIXTURE ONLY. Every record is
removed afterwards.
Checks:
  access: anonymous 401; no rights on invoice requests → 403 for the queue; a stage the caller may not
  read is null, never zero
  milestones coming due: only confirmed orders, neither invoiced nor requested, within the window
  (overdue included and flagged), within the caller's read scope
  queue: a salesperson's request reaches finance with its order, client, amount, due date, age and
  overdue flag; it leaves the coming list; issuing answers 422 BLOCKED_BY_POLICY and no invoice exists;
  finance cannot cancel someone else's request (403); after a cancel it is in the cancelled list and the
  milestone is due again
  figures: booked (confirmed orders before tax) and requested move by exactly the fixtures' amounts;
  a salesperson's booked is their own orders only
Report: logs/finance-probe.json.
"""
import json
import os
import secrets
import sys
from datetime import date, timedelta
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import RESERVED_SEQUENCE, _delete_where, cleanup  # noqa: E402
from db_migrate import DATABASE, psql  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PARTNER, PRODUCT, COMPANY = "com.axelor.apps.base.db.Partner", "com.axelor.apps.base.db.Product", "com.axelor.apps.base.db.Company"
CURRENCY = "com.axelor.apps.base.db.Currency"
STOCK_LOCATION, STOCK_CONFIG = "com.axelor.apps.stock.db.StockLocation", "com.axelor.apps.stock.db.StockConfig"
ACCOUNT, ACCOUNT_CONFIG = "com.axelor.apps.account.db.Account", "com.axelor.apps.account.db.AccountConfig"
ACCOUNT_MANAGEMENT = "com.axelor.apps.account.db.AccountManagement"
SALE_ORDER, SALE_ORDER_LINE = "com.axelor.apps.sale.db.SaleOrder", "com.axelor.apps.sale.db.SaleOrderLine"
TIMETABLE, INVOICE = "com.axelor.apps.supplychain.db.Timetable", "com.axelor.apps.account.db.Invoice"
SEQUENCE, SEQUENCE_VERSION = "com.axelor.apps.base.db.Sequence", "com.axelor.apps.base.db.SequenceVersion"
OPP, LINE = "com.axelor.apps.crm.db.Opportunity", "com.ioeti.businessline.db.BusinessLine"
INVOICE_REQUEST = "com.ioeti.workspace.db.InvoiceRequest"
WS, QUOTES, F = "/ws/ioeti/workspace", "/ws/ioeti/quotes", "/ws/ioeti/finance"
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:240]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def obj(body):
    return (body.get("object") if isinstance(body, dict) else None) or {}


def rows(body):
    value = body.get("object") if isinstance(body, dict) else None
    return value if isinstance(value, list) else []


def err(body):
    e = (body.get("error") or {}) if isinstance(body, dict) else {}
    return e.get("code"), ((e.get("fields") or [{}])[0]).get("code")


def egp(summary):
    return next((r for r in obj(summary).get("rows", []) if r["currency"] == "EGP"), {})


def dec(value):
    return Decimal(str(value)) if value is not None else Decimal(0)


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

    def search(model, domain, fields=("id",)):
        _, body = admin.call("POST", f"/ws/rest/{model}/search", {"fields": list(fields), "limit": 500, "data": {"_domain": domain, "_archived": True}})
        return body.get("data") or []

    def version(model, rid):
        _, body = admin.call("POST", f"/ws/rest/{model}/{rid}/fetch", {"fields": ["version"]})
        return (body.get("data") or [{}])[0].get("version")

    exit_code = 1
    try:
        cur = search(CURRENCY, "self.codeISO = 'EGP'")[0]
        co = create(COMPANY, {"name": f"Finance Probe Co {tag}", "code": f"FP{tag}", "currency": {"id": cur["id"]}})
        location = create(STOCK_LOCATION, {"name": f"Finance probe {tag}", "company": {"id": co["id"]}, "typeSelect": 1})
        create(STOCK_CONFIG, {"company": {"id": co["id"]}, "pickupDefaultStockLocation": {"id": location["id"]}})
        create(ACCOUNT_CONFIG, {"company": {"id": co["id"]}})
        ledger = create(ACCOUNT, {"name": f"TEST ONLY sales {tag}", "code": f"F{tag}", "company": {"id": co["id"]}, "commonPosition": 0})
        product = create(PRODUCT, {"name": f"Finance probe audit day {tag}", "code": f"FP-{tag}", "sellable": True, "salePrice": "2000",
                                   "saleCurrency": {"id": cur["id"]}, "productTypeSelect": "service"})
        create(ACCOUNT_MANAGEMENT, {"company": {"id": co["id"]}, "product": {"id": product["id"]}, "typeSelect": 1, "saleAccount": {"id": ledger["id"]}})
        line = create(LINE, {"code": f"FPL{tag}", "nameEn": f"Finance probe ISO {tag}", "nameAr": "خط تجريبي", "statusSelect": 2})
        account = create(PARTNER, {"name": f"عميل المالية {tag}", "isProspect": True, "partnerTypeSelect": 1})

        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"finance.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})
        rwc = dict(canRead=True, canWrite=True, canCreate=True)
        rep = [perm("opp", OPP, "self.user = ?", **rwc), perm("so", SALE_ORDER, "self.salespersonUser = ?", **rwc),
               perm("sol", SALE_ORDER_LINE, "self.saleOrder.salespersonUser = ?", canRead=True, canWrite=True, canCreate=True, canRemove=True),
               perm("tt", TIMETABLE, "self.saleOrder.salespersonUser = ?", canRead=True, canWrite=True, canCreate=True, canRemove=True),
               perm("ireq", INVOICE_REQUEST, "self.requestedBy = ?", **rwc),
               perm("product", PRODUCT, canRead=True), perm("partner", PARTNER, canRead=True), perm("line", LINE, canRead=True)]
        fin = [perm("f.so", SALE_ORDER, canRead=True), perm("f.ireq", INVOICE_REQUEST, canRead=True), perm("f.partner", PARTNER, canRead=True),
               perm("f.tt", TIMETABLE, canRead=True)]
        none = [perm("n.partner", PARTNER, canRead=True)]
        groups = {k: create(GROUP, {"code": f"finance-{k}-{tag}", "name": f"Finance probe {k} {tag}", "permissions": [{"id": p["id"]} for p in v]})
                  for k, v in (("rep", rep), ("fin", fin), ("none", none))}
        users, sessions = {}, {}
        for label, group in (("RepA", "rep"), ("RepB", "rep"), ("Finance", "fin"), ("Other", "none")):
            password = "Fp!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"finance.{label.lower()}.{tag}", "name": f"Finance probe {label} {tag}", "blocked": False,
                                         "language": "ar", "group": {"id": groups[group]["id"]}, "activeCompany": {"id": co["id"]},
                                         "password": axelor_password_hash(password)})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        a, b, fin_c, other, anon = sessions["RepA"], sessions["RepB"], sessions["Finance"], sessions["Other"], Client()

        def order(client, owner, qty, milestones):
            opp = create(OPP, {"name": f"Finance probe {owner} {tag}", "user": {"id": users[owner]["id"]}, "partner": {"id": account["id"]},
                               "ioetiBusinessLine": {"id": line["id"]}})
            s_, b_ = client.call("POST", QUOTES, {"opportunityId": opp["id"], "opportunityVersion": version(OPP, opp["id"])})
            assert s_ == 201, f"quote fixture {s_} {b_}"
            q = obj(b_)
            client.call("POST", f"{QUOTES}/{q['id']}/lines", {"version": version(SALE_ORDER, q["id"]), "productId": product["id"], "quantity": qty})
            ids = {}
            for title, pct, due in milestones:
                s_, b_ = client.call("POST", f"{QUOTES}/{q['id']}/milestones", {"version": version(SALE_ORDER, q["id"]), "title": title,
                                                                              "percentage": pct, "dueDate": due.isoformat()})
                assert s_ in (200, 201), f"milestone fixture {s_} {b_}"
                ids[title] = [m["id"] for m in search(TIMETABLE, f"self.saleOrder.id = {q['id']}", ("title",)) if m.get("title") == title][0]
            return q, ids

        today = date.today()
        before = {"fin": fin_c.call("GET", F + "/summary")[1]}

        # --- access ------------------------------------------------------------------------------------
        s1, _ = anon.call("GET", F + "/queue")
        s2, _ = anon.call("GET", F + "/summary")
        s3, _ = other.call("GET", F + "/queue")
        s4, b4 = other.call("GET", F + "/summary")
        s5, _ = other.call("GET", F + "/milestones")
        sm = obj(b4)
        check("anonymous 401; without rights on invoice requests or orders the queue and milestones answer 403, and the figures say what may not be read",
              (s1, s2, s3, s5, s4) == (401, 401, 403, 403, 200) and sm.get("requestsPermitted") is False and sm.get("ordersPermitted") is False
              and sm.get("invoicesPermitted") is False, (s1, s2, s3, s5, s4, sm))

        # --- orders and milestones -----------------------------------------------------------------------
        qa, ma = order(a, "RepA", "3", [("Deposit", "40", today - timedelta(days=3)), ("Stage 1 report", "60", today + timedelta(days=10))])
        qb, mb = order(b, "RepB", "1", [("Final report", "100", today + timedelta(days=60))])
        qd, md = order(a, "RepA", "1", [("Draft milestone", "100", today + timedelta(days=5))])
        # TEST FIXTURE: stands in for order confirmation, which D-06/D-11 govern; never done by the product API
        psql(DATABASE, f"UPDATE sale_sale_order SET status_select = 3 WHERE id IN ({int(qa['id'])}, {int(qb['id'])});")
        due30 = rows(fin_c.call("GET", F + "/milestones?within=30")[1])
        due90 = rows(fin_c.call("GET", F + "/milestones?within=90")[1])
        mine_a = rows(a.call("GET", F + "/milestones?within=90")[1])
        mine_ids = {m["id"] for m in due30}
        deposit = next((m for m in due30 if m["id"] == ma["Deposit"]), {})
        check("milestones coming due: confirmed orders only, within the window, an overdue one flagged; a salesperson sees their own orders only",
              {ma["Deposit"], ma["Stage 1 report"]} <= mine_ids and mb["Final report"] not in mine_ids and md["Draft milestone"] not in mine_ids
              and mb["Final report"] in {m["id"] for m in due90} and deposit.get("overdue") is True and deposit.get("daysLeft") == -3
              and deposit.get("accountName") == f"عميل المالية {tag}" and {m["id"] for m in mine_a} >= {ma["Deposit"]}
              and mb["Final report"] not in {m["id"] for m in mine_a}, (sorted(mine_ids), deposit))
        s_bad, b_bad = fin_c.call("GET", F + "/milestones?within=1000")
        check("an out-of-range window → 422", (s_bad, err(b_bad)[1]) == (422, "RANGE"), (s_bad, err(b_bad)))

        # --- the queue -------------------------------------------------------------------------------------
        s, body = a.call("POST", f"{WS}/invoice-requests", {"milestoneId": ma["Deposit"], "quoteVersion": version(SALE_ORDER, qa["id"])})
        req = obj(body)
        if req.get("id"):
            created.append((INVOICE_REQUEST, req["id"]))
        queue = rows(fin_c.call("GET", F + "/queue")[1])
        row = next((r for r in queue if r["id"] == req.get("id")), {})
        due_now = {m["id"] for m in rows(fin_c.call("GET", F + "/milestones?within=30")[1])}
        check("a salesperson's request reaches finance's queue with order, client, amount, due date, age and overdue flag, and leaves the coming list",
              s == 201 and row.get("status") == "REQUESTED" and row.get("orderReference") and row.get("accountName") == f"عميل المالية {tag}"
              and dec(row.get("amountBeforeTax")) == dec(req.get("amountBeforeTax")) and dec(row.get("amountBeforeTax")) > 0
              and row.get("dueDate") == (today - timedelta(days=3)).isoformat() and row.get("ageDays") == 0 and row.get("overdue") is True
              and row.get("mine") is False and row.get("invoiceStatus") == "BLOCKED_BY_POLICY" and ma["Deposit"] not in due_now, (s, row))
        s_iss, b_iss = fin_c.call("POST", f"{WS}/invoice-requests/{req.get('id')}/issue")
        s_iss_a, b_iss_a = a.call("POST", f"{WS}/invoice-requests/{req.get('id')}/issue")
        invoices = search(INVOICE, f"self.partner.id = {account['id']}")
        check("issuing the invoice answers 422 BLOCKED_BY_POLICY (D-06), finance reading only cannot reach it (403), and no invoice exists",
              (s_iss_a, err(b_iss_a)[0]) == (422, "BLOCKED_BY_POLICY") and s_iss == 403 and invoices == [], (s_iss, err(b_iss), s_iss_a, invoices))

        # --- figures -------------------------------------------------------------------------------------------
        after = fin_c.call("GET", F + "/summary")[1]
        own = egp(a.call("GET", F + "/summary")[1])
        order_totals = {q: dec(admin.call("POST", f"/ws/rest/{SALE_ORDER}/{q}/fetch", {"fields": ["exTaxTotal"]})[1]["data"][0]["exTaxTotal"])
                        for q in (qa["id"], qb["id"])}
        booked_delta = dec(egp(after).get("booked")) - dec(egp(before["fin"]).get("booked"))
        requested_delta = dec(egp(after).get("requested")) - dec(egp(before["fin"]).get("requested"))
        check("booked moves by exactly the two confirmed orders and requested by the request; a salesperson's booked is their own order only; "
              "invoices finance may not read are null",
              booked_delta == order_totals[qa["id"]] + order_totals[qb["id"]] and requested_delta == dec(req.get("amountBeforeTax"))
              and dec(own.get("booked")) == order_totals[qa["id"]] and egp(after).get("invoiced") is None and obj(after).get("invoicesPermitted") is False,
              (booked_delta, requested_delta, order_totals, own, egp(after)))

        # --- cancel -------------------------------------------------------------------------------------------
        s_f, _ = fin_c.call("POST", f"{WS}/invoice-requests/{req.get('id')}/cancel", {"version": version(INVOICE_REQUEST, req.get("id"))})
        s_c, _ = a.call("POST", f"{WS}/invoice-requests/{req.get('id')}/cancel", {"version": version(INVOICE_REQUEST, req.get("id"))})
        open_ids = {r["id"] for r in rows(fin_c.call("GET", F + "/queue")[1])}
        cancelled_ids = {r["id"] for r in rows(fin_c.call("GET", F + "/queue?state=cancelled")[1])}
        due_again = {m["id"] for m in rows(fin_c.call("GET", F + "/milestones?within=30")[1])}
        check("finance cannot cancel someone else's request (403); after the salesperson cancels, it is in the cancelled list and the milestone is due again",
              (s_f, s_c) == (403, 200) and req.get("id") not in open_ids and req.get("id") in cancelled_ids and ma["Deposit"] in due_again,
              (s_f, s_c, req.get("id") in open_ids, req.get("id") in cancelled_ids))

        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
        print(f"\n{sum(r['result'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} checks passed")
    finally:
        opp_ids = [rid for m, rid in created if m == OPP]
        if opp_ids:
            quotes = [r["id"] for r in search(SALE_ORDER, f"self.opportunity.id in ({','.join(map(str, opp_ids))})")]
            if quotes:
                qids = ",".join(map(str, quotes))
                for model, domain in ((INVOICE_REQUEST, f"self.quote.id in ({qids})"), (TIMETABLE, f"self.saleOrder.id in ({qids})"),
                                      (SALE_ORDER_LINE, f"self.saleOrder.id in ({qids}) OR self.oldVersionSaleOrder.id in ({qids})"),
                                      (SALE_ORDER, f"self.id in ({qids})")):
                    for r in search(model, domain):
                        if (model, r["id"]) not in created:
                            created.append((model, r["id"]))
                # quotation numbers reserved for the fixtures' orders (test data only)
                for seq in search(SEQUENCE, f"self.company.id = {co['id']}" if 'co' in locals() else "self.id = 0"):
                    _delete_where(admin, RESERVED_SEQUENCE, f"self.sequence.id = {seq['id']}")
                    created.extend((SEQUENCE_VERSION, r["id"]) for r in search(SEQUENCE_VERSION, f"self.sequence.id = {seq['id']}"))
                    created.append((SEQUENCE, seq["id"]))
        order = {INVOICE_REQUEST: 0, TIMETABLE: 1, SALE_ORDER_LINE: 1, SALE_ORDER: 2, OPP: 4, ACCOUNT_MANAGEMENT: 5, PRODUCT: 6, PARTNER: 6,
                 LINE: 6, ACCOUNT: 7, ACCOUNT_CONFIG: 8, STOCK_CONFIG: 8, STOCK_LOCATION: 9, SEQUENCE_VERSION: 9, SEQUENCE: 10,
                 USER: 11, GROUP: 12, PERM: 13, COMPANY: 14}
        complete, left = cleanup(admin, created, order)
        if not complete:
            print(f"FAIL cleanup left {left}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "finance-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
