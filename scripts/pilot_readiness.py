#!/usr/bin/env python3
"""G-010: prepare (and remove) an isolated, fictional dataset for the manual pilot UAT.

  python3 scripts/pilot_readiness.py setup      create users, test-only roles and fictional records
  python3 scripts/pilot_readiness.py check      sign in as each pilot user and verify (read-only) what the
                                                UAT script expects them to see and be refused
  python3 scripts/pilot_readiness.py teardown   delete exactly what setup created (from the manifest)

Run only against a local or disposable test database; it refuses when IOETI_ENV is "production".
Every record name starts with "PILOT-TEST". Passwords are generated and written to
.local/pilot-users.txt (git-ignored, mode 600), never printed. The manifest of created ids is
.local/pilot-fixture.json. The UAT steps are in docs/runbooks/PILOT_UAT_SCRIPT.md.
"""
import json
import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import BL, ENV, OPP, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import CONTRACT, RESERVED_SEQUENCE, _delete_where, cleanup, delete_contract  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PARTNER, PRODUCT, COMPANY = "com.axelor.apps.base.db.Partner", "com.axelor.apps.base.db.Product", "com.axelor.apps.base.db.Company"
LEAD, CURRENCY = "com.axelor.apps.crm.db.Lead", "com.axelor.apps.base.db.Currency"
LOST_REASON, APP_CRM = "com.axelor.apps.crm.db.LostReason", "com.axelor.studio.db.AppCrm"
STOCK_LOCATION, STOCK_CONFIG = "com.axelor.apps.stock.db.StockLocation", "com.axelor.apps.stock.db.StockConfig"
ACCOUNT, ACCOUNT_CONFIG = "com.axelor.apps.account.db.Account", "com.axelor.apps.account.db.AccountConfig"
ACCOUNT_MANAGEMENT = "com.axelor.apps.account.db.AccountManagement"
SALE_ORDER, SALE_ORDER_LINE = "com.axelor.apps.sale.db.SaleOrder", "com.axelor.apps.sale.db.SaleOrderLine"
TIMETABLE = "com.axelor.apps.supplychain.db.Timetable"
SEQUENCE, SEQUENCE_VERSION = "com.axelor.apps.base.db.Sequence", "com.axelor.apps.base.db.SequenceVersion"
CONTRACT_LINE = "com.axelor.apps.contract.db.ContractLine"
ORDER = {TIMETABLE: 0, SALE_ORDER_LINE: 0, SALE_ORDER: 1, OPP: 2, LEAD: 2, ACCOUNT_MANAGEMENT: 3, PRODUCT: 4,
         PARTNER: 5, LOST_REASON: 5, ACCOUNT: 6, ACCOUNT_CONFIG: 7, STOCK_CONFIG: 7, STOCK_LOCATION: 8,
         SEQUENCE_VERSION: 8, SEQUENCE: 8, USER: 9, GROUP: 10, PERM: 11, COMPANY: 12}
LOCAL = os.path.join(ROOT, ".local")
MANIFEST = os.path.join(LOCAL, "pilot-fixture.json")
CREDENTIALS = os.path.join(LOCAL, "pilot-users.txt")
PREFIX = "PILOT-TEST"


def admin_client():
    client = Client()
    status = client.login(os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin")),
                          os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin")))
    if status != 200:
        raise SystemExit("admin sign-in failed")
    return client


def search(admin, model, domain, fields=("id",)):
    _, body = admin.call("POST", f"/ws/rest/{model}/search",
                         {"fields": list(fields), "limit": 200, "data": {"_domain": domain}})
    return body.get("data") or []


def setup(admin):
    if os.path.exists(MANIFEST):
        raise SystemExit(f"a pilot dataset already exists ({MANIFEST}); run teardown first")
    created = []

    def create(model, values):
        _, body = rest_create(admin, model, values)
        if not ok(body):
            raise RuntimeError(f"creating {model.split('.')[-1]} failed: {json.dumps(body)[:200]}")
        created.append((model, body["data"][0]["id"]))
        return body["data"][0]

    try:
        _, lines = admin.call("GET", "/ws/ioeti/business-lines")
        iso = {l["code"]: l for l in lines["object"]}["ISO9001"]
        egp = search(admin, CURRENCY, "self.code = 'EGP'")[0]
        default_status = (search(admin, APP_CRM, "self.id > 0", ("leadDefaultStatus",))[0].get("leadDefaultStatus") or {})
        tag = secrets.token_hex(2).upper()
        # fictional company setup the quotation and contract chain needs (owner data: D-06)
        co = create(COMPANY, {"name": f"{PREFIX} Company", "code": f"PT{tag}", "currency": {"id": egp["id"]}})
        location = create(STOCK_LOCATION, {"name": f"{PREFIX} location", "company": {"id": co["id"]}, "typeSelect": 1})
        create(STOCK_CONFIG, {"company": {"id": co["id"]}, "pickupDefaultStockLocation": {"id": location["id"]}})
        create(ACCOUNT_CONFIG, {"company": {"id": co["id"]}})
        create(SEQUENCE, {"company": {"id": co["id"]}, "name": f"{PREFIX} contracts", "codeSelect": "customerContract",
                          "padding": 4, "toBeAdded": 1, "prefixe": f"PT{tag}-",
                          "sequenceVersionList": [{"startDate": "2026-01-01", "nextNum": 1}]})
        ledger = create(ACCOUNT, {"name": f"{PREFIX} sales", "code": f"PT{tag}", "company": {"id": co["id"]},
                                  "commonPosition": 0})
        product = create(PRODUCT, {"name": f"{PREFIX} audit day", "code": f"PT-{tag}", "sellable": True,
                                   "salePrice": "1500", "saleCurrency": {"id": egp["id"]}, "productTypeSelect": "service"})
        create(ACCOUNT_MANAGEMENT, {"company": {"id": co["id"]}, "product": {"id": product["id"]}, "typeSelect": 1,
                                    "saleAccount": {"id": ledger["id"]}})
        create(LOST_REASON, {"name": f"{PREFIX} budget"})

        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"pilot.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})

        rep = [perm("lead", LEAD, "self.user = ? OR self.user IS NULL", canRead=True, canWrite=True),
               perm("opp", OPP, "self.user = ?", canRead=True, canWrite=True, canCreate=True),
               perm("partner", PARTNER, canRead=True, canWrite=True, canCreate=True),
               perm("so", SALE_ORDER, "self.salespersonUser = ?", canRead=True, canWrite=True, canCreate=True),
               perm("sol", SALE_ORDER_LINE, "self.saleOrder.salespersonUser = ?", canRead=True, canWrite=True,
                    canCreate=True),
               perm("tt", TIMETABLE, "self.saleOrder.salespersonUser = ?", canRead=True, canWrite=True,
                    canCreate=True, canRemove=True),
               perm("contract", CONTRACT, "self.opportunity.user = ?", canRead=True, canWrite=True, canCreate=True),
               perm("contract.line", CONTRACT_LINE, canRead=True, canCreate=True),
               perm("product", PRODUCT, canRead=True), perm("line", BL, canRead=True)]
        viewer = [perm(f"ro.{m.split('.')[-1].lower()}", m, canRead=True)
                  for m in (LEAD, OPP, PARTNER, SALE_ORDER, CONTRACT, PRODUCT, BL)]
        groups = {
            "rep": create(GROUP, {"code": f"pilot-rep-{tag}", "name": f"{PREFIX} rep",
                                  "permissions": [{"id": p["id"]} for p in rep]}),
            "viewer": create(GROUP, {"code": f"pilot-viewer-{tag}", "name": f"{PREFIX} viewer",
                                     "permissions": [{"id": p["id"]} for p in viewer]}),
            "outsider": create(GROUP, {"code": f"pilot-outsider-{tag}", "name": f"{PREFIX} outsider",
                                       "permissions": []}),
        }
        credentials, users = [], {}
        for code, group, lang in (("repa", "rep", "ar"), ("repb", "rep", "ar"), ("viewer", "viewer", "ar"),
                                  ("outsider", "outsider", "en")):
            password = secrets.token_urlsafe(15)
            users[code] = create(USER, {"code": f"pilot.{code}", "name": f"{PREFIX} {code}", "blocked": False,
                                        "language": lang, "group": {"id": groups[group]["id"]},
                                        "password": axelor_password_hash(password), "activeCompany": {"id": co["id"]},
                                        "ioetiBusinessLines": [{"id": iso["id"]}] if group == "rep" else []})
            credentials.append(f"pilot.{code}\t{password}")
        status = {"id": default_status["id"]} if default_status.get("id") else None
        for label, owner in (("Lead A", None), ("Lead B", "repa"), ("Lead C", "repb")):
            create(LEAD, {"firstName": PREFIX, "name": label, "enterpriseName": f"{PREFIX} {label} Hotel",
                          "user": {"id": users[owner]["id"]} if owner else None, "leadStatus": status,
                          "ioetiBusinessLine": {"id": iso["id"]}})
    except BaseException:
        _remove(admin, created)
        raise
    os.makedirs(LOCAL, exist_ok=True)
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump({"created": created}, f, indent=2)
    fd = os.open(CREDENTIALS, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("# Pilot UAT test users (fictional, local only). Delete with: pilot_readiness.py teardown\n")
        f.write("\n".join(credentials) + "\n")
    print(f"PILOT_SETUP=PASS records={len(created)} users={len(users)} credentials={os.path.relpath(CREDENTIALS, ROOT)}")
    return 0


def _remove(admin, created):
    created = [tuple(c) for c in created]
    opp_ids = [rid for model, rid in created if model == OPP]
    owners = [rid for model, rid in created if model == USER]
    # records the reviewers created through the UI during the UAT
    if owners:
        who = ",".join(map(str, owners))
        for model, domain in ((OPP, f"self.user.id in ({who})"), (PARTNER, f"self.createdBy.id in ({who})")):
            for row in search(admin, model, domain):
                if (model, row["id"]) not in created:
                    created.append((model, row["id"]))
        opp_ids = [rid for model, rid in created if model == OPP]
    if opp_ids:
        ids = ",".join(map(str, opp_ids))
        for row in search(admin, CONTRACT, f"self.opportunity.id in ({ids})"):
            delete_contract(admin, row["id"])
        for row in search(admin, SALE_ORDER, f"self.opportunity.id in ({ids})"):
            created.append((SALE_ORDER, row["id"]))
            for model in (TIMETABLE, SALE_ORDER_LINE):
                created += [(model, r["id"]) for r in search(admin, model, f"self.saleOrder.id = {row['id']}")]
    for model, rid in list(created):
        if model == SEQUENCE:
            _delete_where(admin, RESERVED_SEQUENCE, f"self.sequenceVersion.sequence.id = {rid}")
            created += [(SEQUENCE_VERSION, r["id"]) for r in search(admin, SEQUENCE_VERSION, f"self.sequence.id = {rid}")]
    for rid in [rid for model, rid in created if model == PARTNER]:
        _, body = admin.call("POST", f"/ws/rest/{PARTNER}/{rid}/fetch", {"fields": ["contactPartnerSet"]})
        row = (body.get("data") or [{}])[0] if ok(body) else {}
        if row.get("contactPartnerSet"):
            admin.call("POST", f"/ws/rest/{PARTNER}/{rid}",
                       {"data": {"id": rid, "version": row.get("version"), "contactPartnerSet": []}})
    return cleanup(admin, created, ORDER)


def teardown(admin):
    if not os.path.exists(MANIFEST):
        print("PILOT_TEARDOWN=PASS nothing to remove")
        return 0
    created = json.load(open(MANIFEST, encoding="utf-8"))["created"]
    complete, leftovers = _remove(admin, created)
    if not complete:
        print(f"PILOT_TEARDOWN=FAIL leftovers: {leftovers}")
        return 1
    os.remove(MANIFEST)
    if os.path.exists(CREDENTIALS):
        os.remove(CREDENTIALS)
    print("PILOT_TEARDOWN=PASS leftovers: none")
    return 0


def check(_admin):
    """Read-only: every pilot user sees and is refused what docs/runbooks/PILOT_UAT_SCRIPT.md expects."""
    if not os.path.exists(CREDENTIALS):
        raise SystemExit("no pilot dataset; run setup first")
    passwords = dict(line.split("\t") for line in open(CREDENTIALS, encoding="utf-8").read().splitlines()
                     if line and not line.startswith("#"))
    sessions, results = {}, []

    def expect(name, condition, detail=""):
        results.append(condition)
        print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))

    for code, password in passwords.items():
        sessions[code] = Client()
        expect(f"{code} signs in", sessions[code].login(code, password) == 200)

    def leads(code):
        status, body = sessions[code].call("GET", "/ws/ioeti/leads?limit=50")
        return status, [l for l in (body.get("object") or []) if (l.get("organization") or "").startswith(PREFIX)]

    s, a_leads = leads("pilot.repa")
    names = sorted(l["organization"] for l in a_leads)
    expect("repa sees the unassigned Lead A and own Lead B, not repb's Lead C",
           s == 200 and names == [f"{PREFIX} Lead A Hotel", f"{PREFIX} Lead B Hotel"], names)
    s, b_leads = leads("pilot.repb")
    expect("repb sees Lead A (queue) and own Lead C",
           s == 200 and sorted(l["organization"] for l in b_leads) == [f"{PREFIX} Lead A Hotel", f"{PREFIX} Lead C Hotel"],
           [l["organization"] for l in b_leads])
    s, v_leads = leads("pilot.viewer")
    expect("viewer reads all three pilot leads", s == 200 and len(v_leads) == 3, len(v_leads))
    s, _ = sessions["pilot.outsider"].call("GET", "/ws/ioeti/leads")
    expect("outsider is refused leads (403)", s == 403, s)
    lead_b = next(l for l in a_leads if l["organization"].endswith("Lead B Hotel"))
    s, _ = sessions["pilot.viewer"].call("POST", f"/ws/ioeti/leads/{lead_b['id']}/stage",
                                         {"version": lead_b["version"], "stageId": lead_b.get("stageId")})
    expect("viewer cannot change a lead (403)", s == 403, s)
    s, body = sessions["pilot.repa"].call("GET", "/ws/ioeti/catalog/products?q=" + PREFIX.replace(" ", "%20"))
    expect("repa finds the pilot catalog product", s == 200 and any(
        p.get("name") == f"{PREFIX} audit day" for p in body.get("object") or []), s)
    s, body = sessions["pilot.repa"].call("GET", "/ws/ioeti/leads/lost-reasons")
    expect("lost reason available", s == 200 and any(r["name"] == f"{PREFIX} budget" for r in body.get("object") or []), s)
    for code, client in sessions.items():
        client.call("GET", "/logout")  # pac4j logout, as the web app does
    passed = sum(results)
    print(f"\nPILOT_CHECK={'PASS' if passed == len(results) else 'FAIL'} {passed}/{len(results)}")
    return 0 if passed == len(results) else 1


def main(argv):
    if len(argv) != 2 or argv[1] not in ("setup", "check", "teardown"):
        raise SystemExit(__doc__)
    if os.environ.get("IOETI_ENV", ENV.get("IOETI_ENV", "")).lower() == "production":
        raise SystemExit("refusing to run against a production environment")
    admin = admin_client()
    return {"setup": setup, "check": check, "teardown": teardown}[argv[1]](admin)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
