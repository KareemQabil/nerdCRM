#!/usr/bin/env python3
"""Wave 3 live probe: catalog and draft quotations from opportunities (native AOS SaleOrder).

Run against a RUNNING local/CI Axelor with the IOETI baseline apps installed; never against production.
All master data below is a disposable TEST FIXTURE, and it is fictional: two companies, stock and account
configuration, a "TEST ONLY" ledger account, products, an account and opportunities. No tax is created:
taxes are policy D-06, and the API exposes totals before tax only. Roles are fixtures too (D-07).

Checks:
  catalog          sellable products only, safe fields, bounded search
  create           201 from an opportunity with the native salesperson/account/company/currency
                   refusals, each creating nothing:
                   no company → 422 SETUP_REQUIRED; no account → 422 ACCOUNT_REQUIRED; stale → 409;
                   another rep's opportunity → the same 404 as a missing id; read-only → 403
  lines            native line computation (quantity × catalog price) and refusals, each adding nothing:
                   stale → 409; unknown or non-sellable product → identical 422; bad quantity → 422;
                   product without accounting setup → 422 SETUP_REQUIRED; another rep → 404
  concurrency      two sessions add a line with the same version: exactly one 201 and one 409,
                   one line added (PROBE_QUOTE_ROUNDS rounds, default 5)
  milestones       native Timetable: amount = % of total, total ≤ 100 % (also under concurrency), stale → 409,
                   bad input → 422, another rep → 404, amounts follow line changes, booked / invoiced /
                   collected reported apart (all zero for a draft), invoicing → 422 BLOCKED_BY_POLICY (D-06)
  finalize         422 BLOCKED_BY_POLICY (D-06, D-11), quotation stays a draft
Report: logs/quote-probe.json.
"""
import json
import os
import secrets
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, OPP, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PARTNER, PRODUCT, COMPANY = "com.axelor.apps.base.db.Partner", "com.axelor.apps.base.db.Product", "com.axelor.apps.base.db.Company"
CURRENCY = "com.axelor.apps.base.db.Currency"
STOCK_LOCATION, STOCK_CONFIG = "com.axelor.apps.stock.db.StockLocation", "com.axelor.apps.stock.db.StockConfig"
ACCOUNT, ACCOUNT_CONFIG = "com.axelor.apps.account.db.Account", "com.axelor.apps.account.db.AccountConfig"
ACCOUNT_MANAGEMENT = "com.axelor.apps.account.db.AccountManagement"
SALE_ORDER, SALE_ORDER_LINE = "com.axelor.apps.sale.db.SaleOrder", "com.axelor.apps.sale.db.SaleOrderLine"
TIMETABLE, INVOICE = "com.axelor.apps.supplychain.db.Timetable", "com.axelor.apps.account.db.Invoice"
MISSING = 987654322
ROUNDS = int(os.environ.get("PROBE_QUOTE_ROUNDS", "5"))
RESULTS = []
CLEANUP_ORDER = {TIMETABLE: 0, SALE_ORDER_LINE: 0, SALE_ORDER: 1, OPP: 2, ACCOUNT_MANAGEMENT: 3, PRODUCT: 4, PARTNER: 5,
                 ACCOUNT: 6, ACCOUNT_CONFIG: 7, STOCK_CONFIG: 7, STOCK_LOCATION: 8, USER: 9, GROUP: 10,
                 PERM: 11, COMPANY: 12}


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:200]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def admin_client():
    client = Client()
    assert client.login(os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin")),
                        os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
    return client


def main():
    admin = admin_client()
    tag = secrets.token_hex(3)
    created = []

    def create(model, values):
        _, body = rest_create(admin, model, values)
        if not ok(body):
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}: {json.dumps(body)[:200]}")
        created.append((model, body["data"][0]["id"]))
        return body["data"][0]

    def fetch(model, rid, fields):
        _, body = admin.call("POST", f"/ws/rest/{model}/{rid}/fetch", {"fields": fields})
        return (body.get("data") or [{}])[0]

    def search(model, domain, fields=("id",)):
        _, body = admin.call("POST", f"/ws/rest/{model}/search",
                             {"fields": list(fields), "limit": 200, "data": {"_domain": domain}})
        return body.get("data") or []

    def ref_id(value):
        return value.get("id") if isinstance(value, dict) else None

    def quotes_of(opp_id):
        return len(search(SALE_ORDER, f"self.opportunity.id = {opp_id}"))

    def lines_of(quote_id):
        return len(search(SALE_ORDER_LINE, f"self.saleOrder.id = {quote_id}"))

    exit_code = 1
    try:
        egp = search(CURRENCY, "self.code = 'EGP'")[0]
        # --- fictional master data (test fixture only) -------------------------------------------------
        co = create(COMPANY, {"name": f"Wave3 Probe Co {tag}", "code": f"W3{tag}", "currency": {"id": egp["id"]}})
        create(COMPANY, {"name": f"Wave3 Other Co {tag}", "code": f"W3O{tag}", "currency": {"id": egp["id"]}})
        location = create(STOCK_LOCATION, {"name": f"Wave3 probe {tag}", "company": {"id": co["id"]}, "typeSelect": 1})
        create(STOCK_CONFIG, {"company": {"id": co["id"]}, "pickupDefaultStockLocation": {"id": location["id"]}})
        create(ACCOUNT_CONFIG, {"company": {"id": co["id"]}})
        ledger = create(ACCOUNT, {"name": f"TEST ONLY sales {tag}", "code": f"T{tag}", "company": {"id": co["id"]},
                                  "commonPosition": 0})
        product = create(PRODUCT, {"name": f"Wave3 audit day {tag}", "code": f"W3-{tag}", "sellable": True,
                                   "salePrice": "1500", "saleCurrency": {"id": egp["id"]}, "productTypeSelect": "service"})
        create(ACCOUNT_MANAGEMENT, {"company": {"id": co["id"]}, "product": {"id": product["id"]}, "typeSelect": 1,
                                    "saleAccount": {"id": ledger["id"]}})
        unconfigured = create(PRODUCT, {"name": f"Wave3 unconfigured {tag}", "code": f"W3U-{tag}", "sellable": True,
                                        "salePrice": "900", "productTypeSelect": "service"})
        not_sellable = create(PRODUCT, {"name": f"Wave3 internal {tag}", "code": f"W3N-{tag}", "sellable": False,
                                        "productTypeSelect": "service"})
        account = create(PARTNER, {"name": f"Wave3 Client {tag}", "isProspect": True, "partnerTypeSelect": 1})

        # --- principals (test-only roles) --------------------------------------------------------------
        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"wave3.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})

        rep_perms = [perm("opp", OPP, "self.user = ?", canRead=True, canWrite=True, canCreate=True),
                     perm("so", SALE_ORDER, "self.salespersonUser = ?", canRead=True, canWrite=True, canCreate=True),
                     perm("sol", SALE_ORDER_LINE, "self.saleOrder.salespersonUser = ?", canRead=True, canWrite=True,
                          canCreate=True),
                     perm("tt", TIMETABLE, "self.saleOrder.salespersonUser = ?", canRead=True, canWrite=True,
                          canCreate=True, canRemove=True),
                     perm("product", PRODUCT, canRead=True), perm("partner", PARTNER, canRead=True)]
        ro_perms = [perm("ro.opp", OPP, canRead=True), perm("ro.so", SALE_ORDER, canRead=True),
                    perm("ro.product", PRODUCT, canRead=True), perm("ro.partner", PARTNER, canRead=True)]
        rep_group = create(GROUP, {"code": f"wave3-rep-{tag}", "name": f"Wave3 rep {tag}",
                                   "permissions": [{"id": p["id"]} for p in rep_perms]})
        ro_group = create(GROUP, {"code": f"wave3-ro-{tag}", "name": f"Wave3 read-only {tag}",
                                  "permissions": [{"id": p["id"]} for p in ro_perms]})
        users, sessions, passwords = {}, {}, {}
        for label, group, company in (("RepA", rep_group, co), ("RepB", rep_group, co), ("NoCo", rep_group, None),
                                      ("ReadOnly", ro_group, co)):
            passwords[label] = "W3!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"wave3.{label.lower()}.{tag}", "name": f"Wave3 {label}",
                                         "blocked": False, "language": "en", "group": {"id": group["id"]},
                                         "password": axelor_password_hash(passwords[label]),
                                         "activeCompany": {"id": company["id"]} if company else None})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], passwords[label]) == 200, label
        a, b, noco, ro = sessions["RepA"], sessions["RepB"], sessions["NoCo"], sessions["ReadOnly"]

        def opportunity(label, owner, with_account=True):
            return create(OPP, {"name": f"Wave3 {label} {tag}", "user": {"id": users[owner]["id"]},
                                **({"partner": {"id": account["id"]}} if with_account else {})})

        opp_a, opp_b = opportunity("OA", "RepA"), opportunity("OB", "RepB")
        opp_no_account, opp_noco = opportunity("ONA", "RepA", with_account=False), opportunity("ONC", "NoCo")

        def version(model, rid):
            return fetch(model, rid, ["version"]).get("version")

        def new_quote(client, opp, **override):
            body = {"opportunityId": opp["id"], "opportunityVersion": version(OPP, opp["id"]), **override}
            return client.call("POST", "/ws/ioeti/quotes", body)

        # --- 1. catalog -----------------------------------------------------------------------------------
        s, body = a.call("GET", f"/ws/ioeti/catalog/products?q={tag}")
        codes = {p["code"] for p in body.get("object") or []}
        check("catalog: sellable products only (non-sellable hidden)",
              s == 200 and codes == {product["code"], unconfigured["code"]}, f"{s} {codes}")
        check("catalog: safe fields only (no cost, supplier or stock data)",
              all(set(p) <= {"id", "code", "name", "unit", "salePrice", "currency"} for p in body.get("object") or []),
              body.get("object"))
        s, body = a.call("GET", "/ws/ioeti/catalog/products?q=" + "x" * 81)
        check("catalog: overlong search → 422", s == 422, s)

        # --- 2. create refusals ---------------------------------------------------------------------------
        s, body = new_quote(noco, opp_noco)
        check("no company for the user (several exist) → 422 SETUP_REQUIRED, nothing created",
              s == 422 and body.get("error", {}).get("code") == "SETUP_REQUIRED" and quotes_of(opp_noco["id"]) == 0,
              f"{s} {body.get('error')}")
        s, body = new_quote(a, opp_no_account)
        check("opportunity without account → 422 ACCOUNT_REQUIRED, nothing created",
              s == 422 and (body.get("error", {}).get("fields") or [{}])[0].get("code") == "ACCOUNT_REQUIRED"
              and quotes_of(opp_no_account["id"]) == 0, f"{s} {body.get('error')}")
        s, body = new_quote(a, opp_a, opportunityVersion=version(OPP, opp_a["id"]) - 1)
        check("stale opportunity version → 409, nothing created", s == 409 and quotes_of(opp_a["id"]) == 0, s)
        s_other, b_other = new_quote(a, opp_b)
        s_missing, b_missing = a.call("POST", "/ws/ioeti/quotes", {"opportunityId": MISSING, "opportunityVersion": 0})
        check("another rep's opportunity → same 404 as a missing id",
              s_other == s_missing == 404 and b_other.get("error", {}).get("code") == b_missing.get("error", {}).get("code")
              and quotes_of(opp_b["id"]) == 0, f"{s_other} {s_missing}")
        s, _ = new_quote(ro, opp_a)
        check("read-only user → 403, nothing created", s == 403 and quotes_of(opp_a["id"]) == 0, s)

        # --- 3. create ------------------------------------------------------------------------------------
        s, body = new_quote(a, opp_a)
        quote = body.get("object") or {}
        if quote.get("id"):
            created.append((SALE_ORDER, quote["id"]))
        check("draft quotation created from the opportunity (201)",
              s == 201 and quote.get("status") == "DRAFT" and quote.get("currency") == "EGP"
              and quote.get("opportunityId") == opp_a["id"] and quote.get("accountId") == account["id"]
              and quote.get("taxStatus") == "BLOCKED_BY_POLICY", f"{s} {quote}")
        check("no tax amounts exposed (D-06)",
              not ({"taxTotal", "inTaxTotal", "taxes"} & set(quote)), sorted(quote))
        stored = fetch(SALE_ORDER, quote.get("id"), ["salespersonUser", "clientPartner", "opportunity", "company",
                                                     "statusSelect"])
        check("persisted natively: salesperson, account, opportunity, company, draft",
              ref_id(stored.get("salespersonUser")) == users["RepA"]["id"]
              and ref_id(stored.get("clientPartner")) == account["id"]
              and ref_id(stored.get("opportunity")) == opp_a["id"] and ref_id(stored.get("company")) == co["id"]
              and stored.get("statusSelect") == 1, stored)
        s, body = a.call("GET", f"/ws/ioeti/quotes?opportunityId={opp_a['id']}")
        check("owner lists the opportunity's quotations",
              s == 200 and [q["id"] for q in body.get("object") or []] == [quote.get("id")], f"{s} {body}")
        s_b, b_b = b.call("GET", f"/ws/ioeti/quotes/{quote.get('id')}")
        s_m, b_m = b.call("GET", f"/ws/ioeti/quotes/{MISSING}")
        s_l, _ = b.call("GET", f"/ws/ioeti/quotes?opportunityId={opp_a['id']}")
        check("another rep: quotation and its opportunity's list answer like missing ids (404)",
              s_b == s_m == s_l == 404, f"{s_b} {s_m} {s_l}")

        # --- 4. lines -------------------------------------------------------------------------------------
        qid = quote.get("id")

        def add_line(client, **body):
            return client.call("POST", f"/ws/ioeti/quotes/{qid}/lines",
                               {"version": version(SALE_ORDER, qid), "productId": product["id"], "quantity": 2, **body})

        s, body = add_line(a)
        q2 = body.get("object") or {}
        line = (q2.get("lines") or [{}])[0]
        check("line added with the native computation: 2 × 1500.00 = 3000.00 before tax",
              s == 201 and len(q2.get("lines") or []) == 1 and float(line.get("unitPriceBeforeTax") or 0) == 1500
              and float(line.get("totalBeforeTax") or 0) == 3000 and float(q2.get("totalBeforeTax") or 0) == 3000,
              f"{s} {q2}")
        s, _ = a.call("POST", f"/ws/ioeti/quotes/{qid}/lines",
                      {"version": version(SALE_ORDER, qid) - 1, "productId": product["id"], "quantity": 1})
        check("stale quotation version → 409, no line added", s == 409 and lines_of(qid) == 1, s)
        refusals = {}
        for label, extra in (("unknown", {"productId": MISSING}), ("non-sellable", {"productId": not_sellable["id"]})):
            st, bd = add_line(a, **extra)
            refusals[label] = (st, [(f["field"], f["code"]) for f in bd.get("error", {}).get("fields") or []])
        check("unknown and non-sellable products refused identically (422 productId)",
              refusals["unknown"] == refusals["non-sellable"] == (422, [("productId", "UNAVAILABLE")]), refusals)
        bad = [add_line(a, quantity=q)[0] for q in (0, "1.00001", 100001)]
        check("quantity 0, 5 decimals, above 100000 → 422", bad == [422, 422, 422], bad)
        s, body = add_line(a, productId=unconfigured["id"])
        check("product without accounting setup → 422 SETUP_REQUIRED (no 500, no raw message)",
              s == 422 and body.get("error", {}).get("code") == "SETUP_REQUIRED"
              and "Accounting" not in json.dumps(body), f"{s} {body}")
        s, _ = add_line(b)
        check("another rep → 404", s == 404, s)
        check("refused line commands added nothing", lines_of(qid) == 1, lines_of(qid))

        # --- 5. concurrent line additions -----------------------------------------------------------------
        a2 = Client()
        assert a2.login(users["RepA"]["code"], passwords["RepA"]) == 200
        outcomes = []
        for _ in range(ROUNDS):
            before, current = lines_of(qid), version(SALE_ORDER, qid)
            gate, answers = threading.Barrier(2), []

            def run(client):
                gate.wait()
                answers.append(client.call("POST", f"/ws/ioeti/quotes/{qid}/lines",
                                           {"version": current, "productId": product["id"], "quantity": 1})[0])

            threads = [threading.Thread(target=run, args=(c,)) for c in (a, a2)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            outcomes.append((sorted(answers), lines_of(qid) - before))
        check(f"concurrent line additions: one 201 and one 409, one line per round ({ROUNDS} rounds)",
              all(o == ([201, 409], 1) for o in outcomes), outcomes)
        total = float(fetch(SALE_ORDER, qid, ["exTaxTotal"]).get("exTaxTotal") or 0)
        check("quotation total matches its lines after concurrency",
              total == 3000 + 1500 * sum(1 for o in outcomes if o[1] == 1), total)

        # --- 6. payment milestones (native Timetable) ------------------------------------------------------
        def milestones_of():
            return len(search(TIMETABLE, f"self.saleOrder.id = {qid}"))

        def add_milestone(client, **body):
            return client.call("POST", f"/ws/ioeti/quotes/{qid}/milestones",
                               {"version": version(SALE_ORDER, qid), "title": "Contract signature",
                                "percentage": 30, "dueDate": "2027-01-31", **body})

        def near(x, y):
            return abs(float(x or 0) - float(y or 0)) < 0.011

        quote_total = float(fetch(SALE_ORDER, qid, ["exTaxTotal"]).get("exTaxTotal") or 0)
        s, body = add_milestone(a)
        plan = body.get("object") or {}
        first = (plan.get("milestones") or [{}])[0]
        check("milestone added: 30 % of the total before tax, state PLANNED",
              s == 201 and len(plan.get("milestones") or []) == 1 and near(first.get("amountBeforeTax"), quote_total * 0.3)
              and first.get("state") == "PLANNED", f"{s} {plan}")
        check("booked / invoiced / collected kept apart and zero for a draft; invoicing policy-blocked",
              plan.get("bookingStatus") == "NOT_BOOKED" and near(plan.get("bookedBeforeTax"), 0)
              and near(plan.get("invoiced"), 0) and near(plan.get("collected"), 0)
              and plan.get("invoicingStatus") == "BLOCKED_BY_POLICY", plan)
        s, body = add_milestone(a, percentage=80)
        check("milestones above 100 % in total → 422 TOTAL_EXCEEDED, nothing added",
              s == 422 and (body.get("error", {}).get("fields") or [{}])[0].get("code") == "TOTAL_EXCEEDED"
              and milestones_of() == 1, f"{s} {body.get('error')}")
        bad = [add_milestone(a, **b)[0] for b in ({"percentage": 0}, {"percentage": "33.333"}, {"percentage": "100.01"},
                                                 {"dueDate": "31/01/2027"}, {"title": "ab"})]
        check("bad percentage, date or title → 422, nothing added", bad == [422] * 5 and milestones_of() == 1, bad)
        s, _ = add_milestone(a, version=version(SALE_ORDER, qid) - 1)
        check("stale quotation version → 409, nothing added", s == 409 and milestones_of() == 1, s)
        s_list, _ = b.call("GET", f"/ws/ioeti/quotes/{qid}/milestones")
        s_add, _ = add_milestone(b)
        check("another rep: milestones answer like a missing quotation (404)", s_list == s_add == 404 and milestones_of() == 1,
              f"{s_list} {s_add}")
        current, gate, answers = version(SALE_ORDER, qid), threading.Barrier(2), []

        def race(client):
            gate.wait()
            answers.append(client.call("POST", f"/ws/ioeti/quotes/{qid}/milestones",
                                       {"version": current, "title": "Delivery", "percentage": 40,
                                        "dueDate": "2027-03-31"})[0])

        threads = [threading.Thread(target=race, args=(c,)) for c in (a, a2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        check("concurrent milestone additions: one 201 and one 409, total stays at 70 %",
              sorted(answers) == [201, 409] and milestones_of() == 2, f"{sorted(answers)} {milestones_of()}")
        add_line(a, quantity=1)
        new_total = float(fetch(SALE_ORDER, qid, ["exTaxTotal"]).get("exTaxTotal") or 0)
        rows = search(TIMETABLE, f"self.saleOrder.id = {qid}", ("percentage", "amount"))
        check("milestone amounts follow a line change (native updateTimetableAmounts)",
              new_total > quote_total and all(near(r.get("amount"), new_total * float(r["percentage"]) / 100) for r in rows),
              f"{new_total} {rows}")
        target = rows[0]["id"]
        s, body = a.call("POST", f"/ws/ioeti/quotes/{qid}/milestones/{target}/invoice")
        check("invoicing a milestone → 422 BLOCKED_BY_POLICY (D-06), no invoice created",
              s == 422 and body.get("error", {}).get("code") == "BLOCKED_BY_POLICY"
              and len(search(INVOICE, f"self.saleOrder.id = {qid}")) == 0, f"{s} {body.get('error')}")
        s_stale, _ = a.call("DELETE", f"/ws/ioeti/quotes/{qid}/milestones/{target}?version={version(SALE_ORDER, qid) - 1}")
        s_other, _ = b.call("DELETE", f"/ws/ioeti/quotes/{qid}/milestones/{target}?version={version(SALE_ORDER, qid)}")
        s_missing, _ = a.call("DELETE", f"/ws/ioeti/quotes/{qid}/milestones/{MISSING}?version={version(SALE_ORDER, qid)}")
        check("remove: stale → 409, another rep → 404, unknown milestone → 404; nothing removed",
              (s_stale, s_other, s_missing) == (409, 404, 404) and milestones_of() == 2, (s_stale, s_other, s_missing))
        s, body = a.call("DELETE", f"/ws/ioeti/quotes/{qid}/milestones/{target}?version={version(SALE_ORDER, qid)}")
        check("owner removes an uninvoiced milestone", s == 200 and milestones_of() == 1, f"{s} {body.get('error')}")

        # --- 7. finalize is policy-blocked -----------------------------------------------------------------
        s, body = a.call("POST", f"/ws/ioeti/quotes/{qid}/finalize")
        check("finalize → 422 BLOCKED_BY_POLICY (D-06, D-11); still a draft",
              s == 422 and body.get("error", {}).get("code") == "BLOCKED_BY_POLICY"
              and fetch(SALE_ORDER, qid, ["statusSelect"]).get("statusSelect") == 1, f"{s} {body.get('error')}")
        s, _ = b.call("POST", f"/ws/ioeti/quotes/{qid}/finalize")
        check("finalize by another rep → 404", s == 404, s)

        failed = [r for r in RESULTS if r["result"] != "PASS"]
        print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
        exit_code = 0 if not failed else 1
    finally:
        # quotations and lines created through the API (also by a failed run)
        opp_ids = [rid for model, rid in created if model == OPP]
        if opp_ids:
            for row in search(SALE_ORDER, f"self.opportunity.id in ({','.join(map(str, opp_ids))})"):
                if (SALE_ORDER, row["id"]) not in created:
                    created.append((SALE_ORDER, row["id"]))
        quote_ids = [rid for model, rid in created if model == SALE_ORDER]
        if quote_ids:
            for row in search(TIMETABLE, f"self.saleOrder.id in ({','.join(map(str, quote_ids))})"):
                created.append((TIMETABLE, row["id"]))
            for row in search(SALE_ORDER_LINE, f"self.saleOrder.id in ({','.join(map(str, quote_ids))})"):
                created.append((SALE_ORDER_LINE, row["id"]))
        complete, leftovers = cleanup(admin, created, CLEANUP_ORDER)
        if not complete:
            print(f"FAIL cleanup left {leftovers}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "quote-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
