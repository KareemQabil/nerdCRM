#!/usr/bin/env python3
"""Wave 2 live probe: Lead → Account (+ Contact) + Opportunity conversion and Account 360.

Run against a RUNNING local/CI Axelor with the CRM app installed; never against production.
Roles are TEST FIXTURES built from native permissions (policy D-07 defines the real ones).

Principals: RepA, RepB (own leads and opportunities; may create accounts; members of ISO9001),
ReadOnly (reads every lead, writes none).
Checks, through POST /ws/ioeti/leads/{id}/convert and the Account 360 endpoints:
  company lead  → account + contact + opportunity, linked, lineage recorded, lead marked converted
  person lead   → individual account, no contact
  existing account, and a non-client partner refused with the same 422 as an unknown id
  retry → 409 ALREADY_CONVERTED, stale version → 409, both creating nothing
  N concurrent double conversions (two sessions, same version) → exactly one 201 per lead, no duplicates
  another user's lead → the same 404 as a missing id; read-only → 403; non-member line → 422;
  lost lead → 422 CONVERSION_REJECTED; all of them create nothing
  Account 360 contacts/opportunities follow the caller's scope
Env: PROBE_CONVERT_ROUNDS (default 5). Report: logs/lead-conversion-probe.json.
"""
import json
import os
import secrets
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import BL, ENV, OPP, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PARTNER, LEAD = "com.axelor.apps.base.db.Partner", "com.axelor.apps.crm.db.Lead"
LEAD_STATUS, APP_CRM = "com.axelor.apps.crm.db.LeadStatus", "com.axelor.studio.db.AppCrm"
MISSING = 987654321
ROUNDS = int(os.environ.get("PROBE_CONVERT_ROUNDS", "5"))
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:200]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def admin_client():
    client = Client()
    assert client.login(os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin")),
                        os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
    return client


def detach_contacts(admin, partner_ids):
    """A converted account and its contact reference each other (contactPartnerSet ↔ mainPartner)."""
    for rid in partner_ids:
        _, body = admin.call("POST", f"/ws/rest/{PARTNER}/{rid}/fetch", {"fields": ["contactPartnerSet"]})
        row = (body.get("data") or [{}])[0] if ok(body) else {}
        if row.get("contactPartnerSet"):
            admin.call("POST", f"/ws/rest/{PARTNER}/{rid}",
                       {"data": {"id": rid, "version": row.get("version"), "contactPartnerSet": []}})


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
                             {"fields": list(fields), "limit": 100, "data": {"_domain": domain}})
        return body.get("data") or []

    def ref_id(value):
        return value.get("id") if isinstance(value, dict) else None

    def footprint(lead_id, partner_name):
        """What a conversion of this lead would have created: opportunities and partners."""
        return (len(search(OPP, f"self.ioetiOriginLead.id = {lead_id}")),
                len(search(PARTNER, f"self.name = '{partner_name}'")))

    def track_conversion(body):
        result = body.get("object") or {}
        # clean-up deletes in reverse order of tracking: opportunity, then contact, then account
        for model, key in ((PARTNER, "accountId"), (PARTNER, "contactId"), (OPP, "opportunityId")):
            if result.get(key) and (model, result[key]) not in created:
                created.append((model, result[key]))

    exit_code = 1
    try:
        _, lines = admin.call("GET", "/ws/ioeti/business-lines")
        line = {l["code"]: l for l in lines["object"]}
        iso, training = line["ISO9001"], line["TRAINING"]
        app_crm = search(APP_CRM, "self.id > 0", ("lostLeadStatus", "convertedLeadStatus"))[0]
        lost_id, converted_id = ref_id(app_crm.get("lostLeadStatus")), ref_id(app_crm.get("convertedLeadStatus"))
        open_status = [s for s in search(LEAD_STATUS, "self.id > 0", ("name",))
                       if s["id"] not in (lost_id, converted_id)][0]

        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"wave2.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})

        rep_perms = [perm("lead", LEAD, "self.user = ?", canRead=True, canWrite=True),
                     perm("opp", OPP, "self.user = ?", canRead=True, canWrite=True, canCreate=True),
                     perm("partner", PARTNER, canRead=True, canWrite=True, canCreate=True),
                     perm("line", BL, canRead=True)]
        rep_group = create(GROUP, {"code": f"wave2-rep-{tag}", "name": f"Wave2 rep {tag}",
                                   "permissions": [{"id": p["id"]} for p in rep_perms]})
        ro_perms = [perm("ro.lead", LEAD, canRead=True), perm("ro.opp", OPP, canRead=True),
                    perm("ro.partner", PARTNER, canRead=True), perm("ro.line", BL, canRead=True)]
        ro_group = create(GROUP, {"code": f"wave2-ro-{tag}", "name": f"Wave2 read-only {tag}",
                                  "permissions": [{"id": p["id"]} for p in ro_perms]})
        sessions, users, passwords = {}, {}, {}
        for label, group in (("RepA", rep_group), ("RepB", rep_group), ("ReadOnly", ro_group)):
            password = "W2!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"wave2.{label.lower()}.{tag}", "name": f"Wave2 {label}",
                                         "blocked": False, "language": "en", "group": {"id": group["id"]},
                                         "password": axelor_password_hash(password),
                                         "ioetiBusinessLines": [{"id": iso["id"]}] if label != "ReadOnly" else []})
            passwords[label] = password
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        a, b, ro = sessions["RepA"], sessions["RepB"], sessions["ReadOnly"]

        def lead(label, owner="RepA", company=True, bl=iso, status=None):
            values = {"firstName": "Probe", "name": f"Wave2 {label} {tag}",
                      "user": {"id": users[owner]["id"]},
                      "leadStatus": {"id": status or open_status["id"]},
                      "ioetiBusinessLine": {"id": bl["id"]} if bl else None}
            if company:
                values["enterpriseName"] = f"Wave2 {label} Co {tag}"
            return create(LEAD, values)

        def convert(client, row, **extra):
            version = fetch(LEAD, row["id"], ["version"]).get("version")
            return client.call("POST", f"/ws/ioeti/leads/{row['id']}/convert", {"version": version, **extra})

        # --- 1. company lead: account + contact + opportunity -------------------------------------------
        l1 = lead("L1")
        status, body = convert(a, l1)
        track_conversion(body)
        res = body.get("object") or {}
        check("company lead converts (201)", status == 201 and all(res.get(k) for k in
              ("accountId", "contactId", "opportunityId")), f"{status} {body}")
        account = fetch(PARTNER, res.get("accountId"), ["name", "isProspect", "partnerTypeSelect", "isContact"])
        contact = fetch(PARTNER, res.get("contactId"), ["name", "isContact", "mainPartner"])
        opp = fetch(OPP, res.get("opportunityId"), ["name", "partner", "contact", "user", "ioetiBusinessLine",
                                                    "ioetiOriginLead"])
        check("account built from the lead (company, prospect)",
              account.get("name") == f"Wave2 L1 Co {tag}" and account.get("isProspect") is True
              and account.get("partnerTypeSelect") == 1 and not account.get("isContact"), account)
        check("contact built and attached to the account",
              contact.get("isContact") is True and ref_id(contact.get("mainPartner")) == res.get("accountId"), contact)
        check("opportunity linked: account, contact, owner, line, origin lead",
              ref_id(opp.get("partner")) == res.get("accountId") and ref_id(opp.get("contact")) == res.get("contactId")
              and ref_id(opp.get("user")) == users["RepA"]["id"] and ref_id(opp.get("ioetiBusinessLine")) == iso["id"]
              and ref_id(opp.get("ioetiOriginLead")) == l1["id"] and opp.get("name") == f"Wave2 L1 Co {tag}", opp)
        status, view = a.call("GET", f"/ws/ioeti/leads/{l1['id']}")
        v = view.get("object") or {}
        check("lead shows converted, its account and opportunity",
              status == 200 and v.get("converted") is True and v.get("accountId") == res.get("accountId")
              and v.get("opportunityId") == res.get("opportunityId") and v.get("businessLineCode") == "ISO9001", v)
        stored = fetch(LEAD, l1["id"], ["isConverted", "leadStatus", "partner"])
        check("lead persisted as converted with the native status",
              stored.get("isConverted") is True and ref_id(stored.get("leadStatus")) == converted_id
              and ref_id(stored.get("partner")) == res.get("accountId"), stored)
        status, body = convert(a, l1)
        check("retry → 409 ALREADY_CONVERTED", status == 409 and body.get("error", {}).get("code") == "ALREADY_CONVERTED",
              f"{status} {body.get('error')}")
        check("retry created nothing", footprint(l1["id"], f"Wave2 L1 Co {tag}") == (1, 1),
              footprint(l1["id"], f"Wave2 L1 Co {tag}"))

        # --- 2. person lead: individual account, no contact -------------------------------------------
        l2 = lead("L2", company=False)
        status, body = convert(a, l2, opportunityName=f"Wave2 L2 deal {tag}")
        track_conversion(body)
        res2 = body.get("object") or {}
        acc2 = fetch(PARTNER, res2.get("accountId"), ["partnerTypeSelect", "firstName", "name"])
        check("person lead → individual account, no contact, chosen opportunity name",
              status == 201 and res2.get("contactId") is None and acc2.get("partnerTypeSelect") == 2
              and fetch(OPP, res2.get("opportunityId"), ["name"]).get("name") == f"Wave2 L2 deal {tag}",
              f"{status} {res2} {acc2}")

        # --- 3. into an existing account -----------------------------------------------------------------
        existing = create(PARTNER, {"name": f"Wave2 Existing {tag}", "isProspect": True, "partnerTypeSelect": 1})
        not_client = create(PARTNER, {"name": f"Wave2 NotClient {tag}", "isContact": True, "partnerTypeSelect": 2})
        l3 = lead("L3")
        refused = {}
        for label, account_id in (("non-client partner", not_client["id"]), ("unknown partner", MISSING)):
            status, body = convert(a, l3, accountId=account_id)
            refused[label] = (status, body.get("error", {}).get("fields"))
        check("non-client and unknown account refused identically (422 accountId)",
              refused["non-client partner"] == refused["unknown partner"] and refused["unknown partner"][0] == 422
              and refused["unknown partner"][1][0]["field"] == "accountId", refused)
        check("refused account choice created nothing", footprint(l3["id"], f"Wave2 L3 Co {tag}") == (0, 0),
              footprint(l3["id"], f"Wave2 L3 Co {tag}"))
        status, body = convert(a, l3, accountId=existing["id"])
        track_conversion(body)
        res3 = body.get("object") or {}
        check("convert into existing account: no new account, opportunity on it",
              status == 201 and res3.get("accountId") == existing["id"]
              and ref_id(fetch(OPP, res3.get("opportunityId"), ["partner"]).get("partner")) == existing["id"]
              and footprint(l3["id"], f"Wave2 L3 Co {tag}") == (1, 0), f"{status} {res3}")

        # --- 4. refusals create nothing ----------------------------------------------------------------
        l4 = lead("L4", owner="RepB")
        s_other, b_other = convert(a, l4)
        s_missing, b_missing = a.call("POST", f"/ws/ioeti/leads/{MISSING}/convert", {"version": 0})
        check("another user's lead → same 404 as a missing id",
              s_other == s_missing == 404 and b_other.get("error", {}).get("code") == b_missing.get("error", {}).get("code"),
              f"{s_other} {s_missing}")
        s_ro, b_ro = convert(ro, l4)
        check("read-only user → 403", s_ro == 403, f"{s_ro} {b_ro.get('error')}")
        l5 = lead("L5", bl=training)
        s5, b5 = convert(a, l5)
        check("non-member business line → 422 businessLineCode",
              s5 == 422 and (b5.get("error", {}).get("fields") or [{}])[0].get("field") == "businessLineCode", f"{s5} {b5}")
        l6 = lead("L6", status=lost_id)
        s6, b6 = convert(a, l6)
        check("lost lead → 422 CONVERSION_REJECTED (native rule, safe message)",
              s6 == 422 and b6.get("error", {}).get("code") == "CONVERSION_REJECTED"
              and "Exception" not in json.dumps(b6), f"{s6} {b6}")
        l7 = lead("L7")
        s7, b7 = a.call("POST", f"/ws/ioeti/leads/{l7['id']}/convert",
                        {"version": fetch(LEAD, l7["id"], ["version"])["version"] - 1})
        check("stale version → 409", s7 == 409, f"{s7} {b7.get('error')}")
        s8, b8 = a.call("POST", f"/ws/ioeti/leads/{l7['id']}/convert", {})
        check("missing version → 400", s8 == 400, s8)
        for row, label in ((l4, "L4"), (l5, "L5"), (l6, "L6"), (l7, "L7")):
            check(f"refused {label} created nothing and stayed unconverted",
                  footprint(row["id"], f"Wave2 {label} Co {tag}") == (0, 0)
                  and not fetch(LEAD, row["id"], ["isConverted"]).get("isConverted"),
                  footprint(row["id"], f"Wave2 {label} Co {tag}"))

        # --- 5. concurrent double conversion -----------------------------------------------------------
        a2 = Client()  # a second session of the same user
        assert a2.login(users["RepA"]["code"], passwords["RepA"]) == 200
        outcomes = []
        for i in range(ROUNDS):
            row = lead(f"C{i}")
            version = fetch(LEAD, row["id"], ["version"])["version"]
            gate, answers = threading.Barrier(2), []

            def run(client):
                gate.wait()
                answers.append(client.call("POST", f"/ws/ioeti/leads/{row['id']}/convert", {"version": version}))

            threads = [threading.Thread(target=run, args=(c,)) for c in (a, a2)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            for _, body in answers:
                track_conversion(body)
            statuses = sorted(s for s, _ in answers)
            outcomes.append((statuses, footprint(row["id"], f"Wave2 C{i} Co {tag}")))
        check(f"concurrent double conversion: exactly one 201 and one 409 ({ROUNDS} leads)",
              all(s == [201, 409] for s, _ in outcomes), outcomes)
        check("concurrent double conversion: one opportunity and one account per lead",
              all(f == (1, 1) for _, f in outcomes), outcomes)

        # --- 6. Account 360 -----------------------------------------------------------------------------
        acc = res.get("accountId")
        s, body = a.call("GET", f"/ws/ioeti/accounts/{acc}/contacts")
        check("Account 360 contacts: the converted contact, safe fields only",
              s == 200 and [c["id"] for c in body.get("object") or []] == [res.get("contactId")]
              and all(set(c) <= {"id", "name", "jobTitle"} for c in body.get("object") or []), f"{s} {body}")
        s, body = a.call("GET", f"/ws/ioeti/accounts/{acc}/opportunities")
        check("Account 360 opportunities: owner sees the converted opportunity",
              s == 200 and [o["id"] for o in body.get("object") or []] == [res.get("opportunityId")], f"{s} {body}")
        s, body = b.call("GET", f"/ws/ioeti/accounts/{acc}/opportunities")
        check("Account 360 opportunities: another rep sees none (own scope)",
              s == 200 and body.get("object") == [], f"{s} {body}")
        s_nc, _ = a.call("GET", f"/ws/ioeti/accounts/{not_client['id']}/contacts")
        s_mi, _ = a.call("GET", f"/ws/ioeti/accounts/{MISSING}/opportunities")
        check("Account 360 on a non-client or missing partner → 404", s_nc == s_mi == 404, f"{s_nc} {s_mi}")

        # anything a failed run might have created under this tag is cleaned up too
        for model in (OPP, PARTNER):
            for row in search(model, f"self.name like '%{tag}%'"):
                if (model, row["id"]) not in created:
                    created.append((model, row["id"]))
        failed = [r for r in RESULTS if r["result"] != "PASS"]
        print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
        exit_code = 0 if not failed else 1
    finally:
        detach_contacts(admin, [rid for model, rid in created if model == PARTNER])
        complete, leftovers = cleanup(admin, created, {OPP: 0, LEAD: 1, PARTNER: 2, USER: 3, GROUP: 4, PERM: 5})
        if not complete:
            print(f"FAIL cleanup left {leftovers}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "lead-conversion-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
