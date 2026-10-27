#!/usr/bin/env python3
"""Scenario S6 (live): a busy morning, many people on the same records at the same moment, under the owners' rules.

Run against a RUNNING local/CI Axelor; never against production. Roles are TEST FIXTURES built from native permissions
(D-07 defines the real ones). Every person and record is fictional and removed afterwards.
  routing rush: three marketers record 12 enquiries at once for a line whose team has four people. One is on leave; the
    workload cap is 3. → 9 leads go to the three people who are in, exactly 3 each (round robin under the team lock, never
    above the cap); the person on leave gets none; the 3 that nobody can take stay unassigned, and the line's manager is
    told once for each; every routing is logged once
  approval race: two sales managers approve the same quotation at the same moment → exactly one approval, the quotation
    is finalized once with one number; the other is refused (409/422), never a 500
  calendar race: two tabs of the same person move the same planned item at the same moment with the same version →
    one move, the other 409; then done and cancel race → one wins
  rules change mid-flight: a new approval tier scheduled from tomorrow leaves today's decision alone and shows as the
    next value; unsetting the tax today makes a new quotation line carry no tax (POLICY_NOT_SET) while the finalized
    quotation keeps its tax
Env: PROBE_SCENARIO_ROUNDS (default 3). Report: logs/scenario-busy-day.json.
"""
import json
import os
import secrets
import sys
import threading
from datetime import date, timedelta
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import RESERVED_SEQUENCE, _delete_where, cleanup  # noqa: E402

USER, GROUP, PERM, ROLE = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission", "com.axelor.auth.db.Role"
PARTNER, PRODUCT, COMPANY = "com.axelor.apps.base.db.Partner", "com.axelor.apps.base.db.Product", "com.axelor.apps.base.db.Company"
CURRENCY, TEAM, SOURCE = "com.axelor.apps.base.db.Currency", "com.axelor.team.db.Team", "com.axelor.apps.base.db.Source"
STOCK_LOCATION, STOCK_CONFIG = "com.axelor.apps.stock.db.StockLocation", "com.axelor.apps.stock.db.StockConfig"
ACCOUNT, ACCOUNT_CONFIG, ACCOUNT_MANAGEMENT = "com.axelor.apps.account.db.Account", "com.axelor.apps.account.db.AccountConfig", "com.axelor.apps.account.db.AccountManagement"
TAX, TAX_LINE, TAX_TYPE = "com.axelor.apps.account.db.Tax", "com.axelor.apps.account.db.TaxLine", "com.axelor.apps.account.db.TaxType"
SALE_ORDER, SALE_ORDER_LINE, SALE_ORDER_LINE_TAX = "com.axelor.apps.sale.db.SaleOrder", "com.axelor.apps.sale.db.SaleOrderLine", "com.axelor.apps.sale.db.SaleOrderLineTax"
SEQUENCE, SEQUENCE_VERSION = "com.axelor.apps.base.db.Sequence", "com.axelor.apps.base.db.SequenceVersion"
LEAD, EVENT, OPP = "com.axelor.apps.crm.db.Lead", "com.axelor.apps.crm.db.Event", "com.axelor.apps.crm.db.Opportunity"
LINE, ROUTING = "com.ioeti.businessline.db.BusinessLine", "com.ioeti.businessline.db.LeadRouting"
VERSION, AUDIT = "com.ioeti.core.db.PolicyVersion", "com.ioeti.admin.db.AdminAuditEvent"
POLICY_TAX = "com.ioeti.commercial.db.PolicyTaxLine"
REVIEW, REVIEW_EVENT = "com.ioeti.workspace.db.ReviewRequest", "com.ioeti.workspace.db.ReviewEvent"
NOTICE, MESSAGE = "com.ioeti.automation.db.InboxNotice", "com.axelor.mail.db.MailMessage"
WS, QUOTES, P, MK = "/ws/ioeti/workspace", "/ws/ioeti/quotes", "/ws/ioeti/policies", "/ws/ioeti/marketing"
OWNER_ROLE, MANAGER_ROLE = "ioeti-policy-owner", "ioeti-sales-manager"
ROUNDS = int(os.environ.get("PROBE_SCENARIO_ROUNDS", "3"))
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
    return e.get("code")


def together(calls):
    """Runs the calls at the same moment (released by one barrier) and returns their (status, body) in order."""
    barrier = threading.Barrier(len(calls))
    out = [None] * len(calls)

    def run(i, fn):
        barrier.wait()
        try:
            out[i] = fn()
        except Exception as e:  # noqa: BLE001 - a transport failure is reported as such
            out[i] = (0, {"error": {"code": type(e).__name__}})
    threads = [threading.Thread(target=run, args=(i, fn)) for i, fn in enumerate(calls)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return out


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
    exit_code = 1
    users = {}
    co = line = None
    try:
        egp = search(CURRENCY, "self.codeISO = 'EGP'")[0]
        today = date.today()
        co = create(COMPANY, {"name": f"Busy Day Co {tag}", "code": f"BD{tag}", "currency": {"id": egp["id"]}})
        location = create(STOCK_LOCATION, {"name": f"Busy day {tag}", "company": {"id": co["id"]}, "typeSelect": 1})
        create(STOCK_CONFIG, {"company": {"id": co["id"]}, "pickupDefaultStockLocation": {"id": location["id"]}})
        create(ACCOUNT_CONFIG, {"company": {"id": co["id"]}})
        create(SEQUENCE, {"name": f"Quotations {tag}", "codeSelect": "saleOrder", "company": {"id": co["id"]}, "prefixe": f"Q{tag}-", "padding": 4, "toBeAdded": 1})
        ledger = create(ACCOUNT, {"name": f"TEST ONLY sales {tag}", "code": f"B{tag}", "company": {"id": co["id"]}, "commonPosition": 0})
        product = create(PRODUCT, {"name": f"Audit day {tag}", "code": f"BD-{tag}", "sellable": True, "salePrice": "10000",
                                   "saleCurrency": {"id": egp["id"]}, "productTypeSelect": "service"})
        create(ACCOUNT_MANAGEMENT, {"company": {"id": co["id"]}, "product": {"id": product["id"]}, "typeSelect": 1, "saleAccount": {"id": ledger["id"]}})
        account = create(PARTNER, {"name": f"عميل اليوم المزدحم {tag}", "isProspect": True, "partnerTypeSelect": 1})
        line = create(LINE, {"code": f"BDL{tag}", "nameEn": f"Busy day line {tag}", "nameAr": "خط اليوم المزدحم", "statusSelect": 2})

        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"bd.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})
        rwc = dict(canRead=True, canWrite=True, canCreate=True)
        marketing = [perm("m.lead", LEAD, **rwc), perm("m.line", LINE, canRead=True), perm("m.source", SOURCE, canRead=True)]
        rep = [perm("lead", LEAD, "self.user = ?", **rwc), perm("event", EVENT, "self.user = ?", **rwc), perm("opp", OPP, "self.user = ?", **rwc),
               perm("so", SALE_ORDER, "self.salespersonUser = ?", **rwc),
               perm("sol", SALE_ORDER_LINE, "self.saleOrder.salespersonUser = ?", canRead=True, canWrite=True, canCreate=True, canRemove=True),
               perm("review", REVIEW, **rwc), perm("product", PRODUCT, canRead=True), perm("partner", PARTNER, canRead=True),
               perm("line", LINE, canRead=True)]
        manager = [perm("g.opp", OPP, canRead=True), perm("g.so", SALE_ORDER, **rwc), perm("g.sol", SALE_ORDER_LINE, **rwc),
                   perm("g.partner", PARTNER, canRead=True), perm("g.line", LINE, canRead=True), perm("g.review", REVIEW, **rwc)]
        none = [perm("n.partner", PARTNER, canRead=True)]
        groups = {k: create(GROUP, {"code": f"bd-{k}-{tag}", "name": f"Busy day {k} {tag}", "permissions": [{"id": p["id"]} for p in v]})
                  for k, v in (("marketing", marketing), ("rep", rep), ("manager", manager), ("none", none))}
        found = search(ROLE, f"self.name = '{MANAGER_ROLE}'")
        manager_role = found[0]["id"] if found else create(ROLE, {"name": MANAGER_ROLE})["id"]
        sessions = {}
        plan = [("M1", "marketing", [], [line]), ("M2", "marketing", [], [line]), ("M3", "marketing", [], [line]),
                ("R1", "rep", [], [line]), ("R2", "rep", [], [line]), ("R3", "rep", [], [line]), ("R4", "rep", [], [line]),
                ("Mgr1", "manager", [manager_role], [line]), ("Mgr2", "manager", [manager_role], [line]), ("Owner", "none", [], [])]
        for label, group, roles, lines in plan:
            password = "Bd!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"bd.{label.lower()}.{tag}", "name": f"Busy {label} {tag}", "blocked": False, "language": "ar",
                                         "group": {"id": groups[group]["id"]}, "activeCompany": {"id": co["id"]},
                                         "roles": [{"id": r} for r in roles], "password": axelor_password_hash(password),
                                         "ioetiBusinessLines": [{"id": x["id"]} for x in lines]})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        uid = {k: u["id"] for k, u in users.items()}
        team = create(TEAM, {"name": f"Busy team {tag}", "code": f"BDT{tag}", "members": [{"id": uid[r]} for r in ("R1", "R2", "R3", "R4")]})
        update(LINE, line["id"], {"manager": {"id": uid["Mgr1"]}})
        update(USER, uid["R4"], {"ioetiAwayFrom": (today - timedelta(days=1)).isoformat(), "ioetiAwayUntil": (today + timedelta(days=3)).isoformat()})
        s, _ = admin.call("POST", P + "/owners", {"userId": uid["Owner"]})
        assert s == 200, f"appointing the policy owner: {s}"
        owner = sessions["Owner"]

        def set_policy(key, value, scope=None, effective=None):
            body = {"value": value, "reason": f"busy day {tag}", **({"scope": scope} if scope else {}), **({"effectiveFrom": effective} if effective else {})}
            s_, b_ = owner.call("POST", f"{P}/{key}", body)
            assert s_ == 201, f"setting {key}: {s_} {b_}"
        set_policy("leads.routing", {"rules": [{"teamId": team["id"]}], "workloadCap": 3}, scope=line["code"])
        s, _ = owner.call("POST", P + "/recommended/apply", {"ids": ["finance.tax|", "sales.quote-approval|", "sales.quote-validity|"]})
        assert s == 200, f"recommended values: {s}"

        # --- routing rush ------------------------------------------------------------------------------------------------
        def intake(client, n):
            return lambda: client.call("POST", MK + "/leads", {"name": f"Busy Person {tag} {n}", "businessLineCode": line["code"], "confirmNotDuplicate": True})
        marketers = [sessions[m] for m in ("M1", "M2", "M3")]
        results = together([intake(marketers[i % 3], i) for i in range(12)])
        lead_ids = [obj(b).get("id") for _, b in results if obj(b).get("id")]
        created.extend((LEAD, i) for i in lead_ids)
        owners = [(fetch(LEAD, i, ["user"]).get("user") or {}).get("id") for i in lead_ids]
        per = {r: owners.count(uid[r]) for r in ("R1", "R2", "R3", "R4")}
        unassigned = owners.count(None)
        log = search(ROUTING, f"self.lead.id IN ({','.join(map(str, lead_ids)) or 0})", ("outcome",))
        manager_told = len(search(NOTICE, f"self.recipient.id = {uid['Mgr1']} AND self.kind = 'LEAD_UNROUTED'"))
        check("routing rush: 12 enquiries recorded at once → 3 each to the three people in (never above the cap of 3), none to the person on "
              "leave, 3 unassigned with one notice each to the line's manager, one log row per lead; never a 500",
              [s_ for s_, _ in results] == [201] * 12 and per == {"R1": 3, "R2": 3, "R3": 3, "R4": 0} and unassigned == 3
              and len(log) == 12 and sorted(r["outcome"] for r in log).count("ASSIGNED") == 9 and manager_told == 3,
              ([s_ for s_, _ in results], per, unassigned, len(log), manager_told))

        # --- approval race (several rounds) -------------------------------------------------------------------------------
        rep_c, m1, m2 = sessions["R1"], sessions["Mgr1"], sessions["Mgr2"]
        wins = []
        for r in range(ROUNDS):
            opp = create(OPP, {"name": f"Busy approval {r} {tag}", "user": {"id": uid["R1"]}, "partner": {"id": account["id"]},
                               "ioetiBusinessLine": {"id": line["id"]}})
            _, b = rep_c.call("POST", QUOTES, {"opportunityId": opp["id"], "opportunityVersion": version(OPP, opp["id"])})
            qid = obj(b).get("id")
            _, b = rep_c.call("POST", f"{QUOTES}/{qid}/lines", {"version": version(SALE_ORDER, qid), "productId": product["id"], "quantity": 2})
            rep_c.call("POST", f"{QUOTES}/{qid}/lines/{obj(b)['lines'][0]['id']}/discount", {"version": version(SALE_ORDER, qid), "percent": 8})
            _, b = rep_c.call("POST", f"{WS}/reviews", {"quoteId": qid, "version": version(SALE_ORDER, qid)})
            rid = obj(b).get("id")
            v = version(REVIEW, rid)
            race = together([lambda c=c: c.call("POST", f"{WS}/reviews/{rid}/approve", {"version": v}) for c in (m1, m2)])
            native = fetch(SALE_ORDER, qid, ["statusSelect", "saleOrderSeq"])
            wins.append((sorted(s_ for s_, _ in race), native.get("statusSelect"), bool(native.get("saleOrderSeq"))))
        check(f"approval race ({ROUNDS} rounds): two managers approve the same quotation at once → exactly one approval, finalized once with one "
              "number; the other refused (409/422), never a 500",
              all(st[0] == 200 and st[1] in (409, 422) and status == 2 and numbered for st, status, numbered in wins), wins)

        # --- calendar race -------------------------------------------------------------------------------------------------
        cal_ok = []
        for r in range(ROUNDS):
            at = f"{(today + timedelta(days=2)).isoformat()}T10:00"
            _, b = rep_c.call("POST", WS + "/activities", {"record": "SELF", "kind": "MEETING", "subject": f"Busy meeting {r} {tag}", "at": at, "planned": True})
            aid = obj(b).get("id")
            if aid:
                created.append((EVENT, aid))
            v = version(EVENT, aid)
            race = together([lambda h=h: rep_c.call("POST", f"{WS}/activities/{aid}/move", {"version": v, "at": f"{(today + timedelta(days=3)).isoformat()}T{h}:00"})
                             for h in ("11", "15")])
            v = version(EVENT, aid)
            race2 = together([lambda: rep_c.call("POST", f"{WS}/activities/{aid}/done", {"version": v}),
                              lambda: rep_c.call("POST", f"{WS}/activities/{aid}/cancel", {"version": v})])
            cal_ok.append((sorted(s_ for s_, _ in race), sorted(s_ for s_, _ in race2), fetch(EVENT, aid, ["statusSelect"]).get("statusSelect")))
        check(f"calendar race ({ROUNDS} rounds): two tabs move the same item at once → one move, the other 409; done and cancel at once → one wins",
              all(m == [200, 409] and d[0] == 200 and d[1] in (409, 422) and st in (2, 3) for m, d, st in cal_ok), cal_ok)

        # --- rules change mid-flight ----------------------------------------------------------------------------------------
        tomorrow = (today + timedelta(days=1)).isoformat()
        set_policy("sales.quote-approval", {"tiers": [{"maxDiscountPercent": 10, "approver": "NONE"}]}, effective=tomorrow)
        opp = create(OPP, {"name": f"Busy midflight {tag}", "user": {"id": uid["R1"]}, "partner": {"id": account["id"]}, "ioetiBusinessLine": {"id": line["id"]}})
        _, b = rep_c.call("POST", QUOTES, {"opportunityId": opp["id"], "opportunityVersion": version(OPP, opp["id"])})
        qid = obj(b).get("id")
        _, b = rep_c.call("POST", f"{QUOTES}/{qid}/lines", {"version": version(SALE_ORDER, qid), "productId": product["id"], "quantity": 1})
        _, b = rep_c.call("POST", f"{QUOTES}/{qid}/lines/{obj(b)['lines'][0]['id']}/discount", {"version": version(SALE_ORDER, qid), "percent": 8})
        approval_today = obj(b).get("approval") or {}
        detail = obj(owner.call("GET", f"{P}/sales.quote-approval")[1])
        default = next((v for v in detail.get("values") or [] if v.get("scope") is None), {})
        check("rules change mid-flight: a tier scheduled from tomorrow leaves today's decision alone (8% still needs the manager) and shows as the next value",
              approval_today.get("approver") == "SALES_MANAGER" and default.get("nextFrom") == tomorrow
              and (default.get("nextValue") or {}).get("tiers") == [{"maxDiscountPercent": 10, "approver": "NONE"}], (approval_today, default))
        finalized = wins and qid  # a quotation finalized earlier keeps its tax when the tax is unset
        first_q = search(SALE_ORDER, f"self.company.id = {co['id']} AND self.statusSelect = 2", ("taxTotal",), limit=1)
        s_rt, _ = owner.call("POST", f"{P}/finance.tax/retire", {"reason": f"busy day {tag}"})
        opp2 = create(OPP, {"name": f"Busy untaxed {tag}", "user": {"id": uid["R1"]}, "partner": {"id": account["id"]}, "ioetiBusinessLine": {"id": line["id"]}})
        _, b = rep_c.call("POST", QUOTES, {"opportunityId": opp2["id"], "opportunityVersion": version(OPP, opp2["id"])})
        q2 = obj(b).get("id")
        _, b = rep_c.call("POST", f"{QUOTES}/{q2}/lines", {"version": version(SALE_ORDER, q2), "productId": product["id"], "quantity": 1})
        new_line = obj(b)
        kept = fetch(SALE_ORDER, first_q[0]["id"], ["taxTotal"]) if first_q else {}
        check("unsetting the tax today: a new quotation line carries no tax (POLICY_NOT_SET); a finalized quotation keeps the tax it was issued with",
              finalized and s_rt == 200 and new_line.get("taxStatus") == "POLICY_NOT_SET" and Decimal(str(kept.get("taxTotal") or 0)) > 0,
              (s_rt, new_line.get("taxStatus"), kept))

        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
        print(f"\n{sum(r['result'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} checks passed")
    finally:
        if co:
            quotes = [r["id"] for r in search(SALE_ORDER, f"self.company.id = {co['id']}")]
            if quotes:
                qids = ",".join(map(str, quotes))
                for model, domain in ((REVIEW_EVENT, f"self.review.quote.id in ({qids})"), (REVIEW, f"self.quote.id in ({qids})"),
                                      (SALE_ORDER_LINE_TAX, f"self.saleOrder.id in ({qids})"),
                                      (SALE_ORDER_LINE, f"self.saleOrder.id in ({qids}) OR self.oldVersionSaleOrder.id in ({qids})"),
                                      (SALE_ORDER, f"self.id in ({qids})")):
                    created.extend((model, r["id"]) for r in search(model, domain) if (model, r["id"]) not in created)
            for seq in search(SEQUENCE, f"self.company.id = {co['id']}"):
                _delete_where(admin, RESERVED_SEQUENCE, f"self.sequence.id = {seq['id']}")
                created.extend((SEQUENCE_VERSION, r["id"]) for r in search(SEQUENCE_VERSION, f"self.sequence.id = {seq['id']}"))
                if (SEQUENCE, seq["id"]) not in created:
                    created.append((SEQUENCE, seq["id"]))
            created.extend((ACCOUNT_MANAGEMENT, r["id"]) for r in search(ACCOUNT_MANAGEMENT, f"self.company.id = {co['id']}") if (ACCOUNT_MANAGEMENT, r["id"]) not in created)
        lead_ids = [rid for m, rid in created if m == LEAD]
        if lead_ids:
            ids = ",".join(map(str, lead_ids))
            for model, domain in ((ROUTING, f"self.lead.id IN ({ids})"), (NOTICE, f"self.subject = 'LEAD' AND self.subjectId IN ({ids})"),
                                  (MESSAGE, f"self.relatedModel = '{LEAD}' AND self.relatedId IN ({ids})")):
                created.extend((model, r["id"]) for r in search(model, domain) if (model, r["id"]) not in created)
        opp_ids = [rid for m, rid in created if m == OPP]
        if opp_ids:
            created.extend((NOTICE, r["id"]) for r in search(NOTICE, f"self.subject = 'OPPORTUNITY' AND self.subjectId IN ({','.join(map(str, opp_ids))})")
                           if (NOTICE, r["id"]) not in created)
        created.extend((POLICY_TAX, r["id"]) for r in search(POLICY_TAX, "self.id > 0"))
        new_taxes = [r["id"] for r in search(TAX, "self.code LIKE 'IOETI-%'") if r["id"] not in taxes_before]
        if new_taxes:
            created.extend((TAX_LINE, r["id"]) for r in search(TAX_LINE, f"self.tax.id in ({','.join(map(str, new_taxes))})"))
            for tid in new_taxes:
                admin.call("POST", f"/ws/rest/{TAX}/{tid}", {"data": {"id": tid, "version": version(TAX, tid), "activeTaxLine": None}})
            created.extend((TAX, t) for t in new_taxes)
        created.extend((TAX_TYPE, r["id"]) for r in search(TAX_TYPE, "self.code LIKE 'IOETI-%'") if r["id"] not in tax_types_before)
        if line:
            update(LINE, line["id"], {"manager": None})
        ids = [x["id"] for x in users.values()]
        if ids:
            joined = ",".join(map(str, ids))
            created.extend((VERSION, v["id"]) for v in search(VERSION, f"self.author.id in ({joined})"))
            created.extend((AUDIT, a["id"]) for a in search(AUDIT, f"self.actor.id in ({joined}) OR (self.subject = 'USER' AND self.subjectId in ({joined}))"))
            created.extend((NOTICE, n["id"]) for n in search(NOTICE, f"self.recipient.id in ({joined})") if (NOTICE, n["id"]) not in created)
            created.extend((EVENT, e["id"]) for e in search(EVENT, f"self.user.id in ({joined})") if (EVENT, e["id"]) not in created)
            for user in users.values():
                current = fetch(USER, user["id"], ["version"])
                if current:
                    admin.call("POST", f"/ws/rest/{USER}/{user['id']}", {"data": {"id": user["id"], "version": current.get("version"), "roles": [], "blocked": True}})
        for name in (OWNER_ROLE, MANAGER_ROLE):
            if name not in roles_before:
                created.extend((ROLE, r["id"]) for r in search(ROLE, f"self.name = '{name}'"))
        order = {NOTICE: 0, ROUTING: 0, MESSAGE: 0, REVIEW_EVENT: 0, EVENT: 0, REVIEW: 1, SALE_ORDER_LINE_TAX: 1, SALE_ORDER_LINE: 2, SALE_ORDER: 3,
                 POLICY_TAX: 4, ACCOUNT_MANAGEMENT: 4, TAX_LINE: 5, TAX: 6, TAX_TYPE: 7, VERSION: 6, AUDIT: 6, OPP: 4, LEAD: 5, PRODUCT: 6, PARTNER: 6,
                 LINE: 12, TEAM: 6, ACCOUNT: 8, ACCOUNT_CONFIG: 8, STOCK_CONFIG: 8, STOCK_LOCATION: 9, SEQUENCE_VERSION: 9, SEQUENCE: 10, ROLE: 10,
                 USER: 11, GROUP: 12, PERM: 13, COMPANY: 14}
        complete, left = cleanup(admin, list(dict.fromkeys(created)), order)
        for m in search(MESSAGE, f"self.relatedName LIKE '%{tag}%'"):
            admin.call("DELETE", f"/ws/rest/{MESSAGE}/{m['id']}")
        if not complete:
            print(f"FAIL cleanup left {left}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "scenario-busy-day.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
