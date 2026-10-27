#!/usr/bin/env python3
"""Wave 5 live probe: handover from sales to operations and the resulting engagement.

Run against a RUNNING local/CI Axelor; never against production. Roles are TEST FIXTURES built from
native permissions (policy D-07 defines the real ones): RepA and RepB sell and request handovers for
their own contracts, Ops reviews every handover and runs engagements, Config maintains the per-line
checklist. Contract activation (signature) is D-11 and blocked in the API, so a contract is made
ACTIVE with SQL in the disposable database as a stand-in for the signature: TEST FIXTURE ONLY.
Checks, through /ws/ioeti/operations:
  checklist configuration per business line (admin only); requests only for active contracts; a line
  without a checklist cannot hand over; one open or accepted handover per contract (409)
  rework with a reason, resubmission, rejection, and a new request after a rejection
  acceptance needs every required item and project-creation rights; it creates exactly one native
  project linked to the handover; decided checklists are frozen; stale versions → 409
  N concurrent acceptances → one engagement; double task submission with one version → one task
  tasks, progress and overdue; ownership transfer; append-only trail with every step and actor
  isolation: another salesperson → 404; sales cannot accept or read engagements; D-11 still blocks activation
Env: PROBE_OPS_ROUNDS (default 5). Report: logs/operations-probe.json.
"""
import json
import os
import secrets
import sys
import threading
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import CONTRACT, RESERVED_SEQUENCE, _delete_where, cleanup, delete_contract  # noqa: E402
from db_migrate import DATABASE, psql  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PARTNER, COMPANY, CURRENCY = "com.axelor.apps.base.db.Partner", "com.axelor.apps.base.db.Company", "com.axelor.apps.base.db.Currency"
SEQUENCE, SEQUENCE_VERSION = "com.axelor.apps.base.db.Sequence", "com.axelor.apps.base.db.SequenceVersion"
OPP, LINE = "com.axelor.apps.crm.db.Opportunity", "com.ioeti.businessline.db.BusinessLine"
PROJECT, TASK, TEAM = "com.axelor.apps.project.db.Project", "com.axelor.apps.project.db.ProjectTask", "com.axelor.team.db.Team"
P = "com.ioeti.operations.db."
REQ, HANDOVER, ITEM, EVENT = P + "HandoverRequirement", P + "HandoverRequest", P + "HandoverItem", P + "HandoverEvent"
BASE = "/ws/ioeti/operations"
MISSING = 987654327
ROUNDS = int(os.environ.get("PROBE_OPS_ROUNDS", "5"))
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:200]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def admin_client():
    client = Client()
    assert client.login(os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin")),
                        os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
    return client


def error(body):
    return (body.get("error") or {}) if isinstance(body, dict) else {}


def field(body):
    return (error(body).get("fields") or [{}])[0].get("field")


def obj(body):
    return (body.get("object") or {}) if isinstance(body, dict) else {}


def main():
    admin = admin_client()
    tag = secrets.token_hex(3).upper()
    created = []

    def create(model, values):
        _, body = rest_create(admin, model, values)
        if not ok(body):
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}: {json.dumps(body)[:200]}")
        created.append((model, body["data"][0]["id"]))
        return body["data"][0]

    def search(model, domain, fields=("id",)):
        _, body = admin.call("POST", f"/ws/rest/{model}/search",
                             {"fields": list(fields), "limit": 500, "data": {"_domain": domain, "_archived": True}})
        return body.get("data") or []

    def version(model, rid):
        _, body = admin.call("POST", f"/ws/rest/{model}/{rid}/fetch", {"fields": ["version"]})
        return (body.get("data") or [{}])[0].get("version")

    exit_code = 1
    try:
        egp = search(CURRENCY, "self.codeISO = 'EGP'")[0]
        co = create(COMPANY, {"name": f"Wave5 Probe Co {tag}", "code": f"W5{tag}", "currency": {"id": egp["id"]}})
        create(SEQUENCE, {"company": {"id": co["id"]}, "name": f"TEST ONLY contracts {tag}", "codeSelect": "customerContract",
                          "padding": 4, "toBeAdded": 1, "prefixe": f"V{tag[:3]}",
                          "sequenceVersionList": [{"startDate": "2026-01-01", "nextNum": 1}]})
        line = create(LINE, {"code": f"W5{tag}", "nameEn": f"Wave5 ISO {tag}", "nameAr": "خط تجريبي", "statusSelect": 2})
        bare = create(LINE, {"code": f"W5B{tag}", "nameEn": f"Wave5 bare {tag}", "nameAr": "خط بلا قائمة", "statusSelect": 2})
        client_org = create(PARTNER, {"name": f"Wave5 Nile Foods {tag}", "isProspect": True, "partnerTypeSelect": 1})
        team = create(TEAM, {"name": f"Wave5 delivery {tag}"})

        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"wave5.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})

        rwc = dict(canRead=True, canWrite=True, canCreate=True)
        sales = [perm("opp", OPP, "self.user = ?", **rwc), perm("contract", CONTRACT, "self.opportunity.user = ?", **rwc),
                 perm("cline", "com.axelor.apps.contract.db.ContractLine", canRead=True, canCreate=True),
                 perm("handover", HANDOVER, "self.requestedBy = ?", **rwc), perm("item", ITEM, "self.handover.requestedBy = ?", canRead=True, canWrite=True),
                 perm("event", EVENT, "self.handover.requestedBy = ?", canRead=True), perm("req", REQ, canRead=True),
                 perm("partner", PARTNER, canRead=True), perm("line", LINE, canRead=True)]
        ops = [perm("o.handover", HANDOVER, canRead=True, canWrite=True), perm("o.item", ITEM, canRead=True, canWrite=True),
               perm("o.event", EVENT, canRead=True), perm("o.project", PROJECT, **rwc), perm("o.task", TASK, **rwc),
               perm("o.contract", CONTRACT, canRead=True), perm("o.partner", PARTNER, canRead=True), perm("o.req", REQ, canRead=True),
               perm("o.line", LINE, canRead=True), perm("o.team", TEAM, canRead=True)]
        config = [perm("c.req", REQ, **rwc), perm("c.line", LINE, canRead=True)]
        groups = {}
        for key, perms in (("sales", sales), ("ops", ops), ("config", config)):
            groups[key] = create(GROUP, {"code": f"wave5-{key}-{tag}", "name": f"Wave5 {key} {tag}",
                                         "permissions": [{"id": p["id"]} for p in perms]})
        users, sessions = {}, {}
        for label, group in (("RepA", "sales"), ("RepB", "sales"), ("Ops", "ops"), ("Ops2", "ops"), ("Lead2", "ops"), ("Config", "config")):
            password = "W5!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"wave5.{label.lower()}.{tag}", "name": f"Wave5 {label}", "blocked": False,
                                         "language": "en", "group": {"id": groups[group]["id"]}, "activeCompany": {"id": co["id"]},
                                         "password": axelor_password_hash(password)})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        a, b, op, op2, cfg = (sessions[k] for k in ("RepA", "RepB", "Ops", "Ops2", "Config"))

        def call(client, method, path, body=None):
            return client.call(method, BASE + path, body if body is not None else ({} if method in ("POST", "PUT") else None))

        def contract(label, line_row, active=True, owner="RepA"):
            opp = create(OPP, {"name": f"Wave5 {label} {tag}", "user": {"id": users[owner]["id"]}, "partner": {"id": client_org["id"]},
                               "ioetiBusinessLine": {"id": line_row["id"]}})
            s_, body_ = sessions[owner].call("POST", "/ws/ioeti/contracts", {"opportunityId": opp["id"], "opportunityVersion": version(OPP, opp["id"]),
                                                                             "contractType": "BILLING"})
            cid = obj(body_).get("id")
            assert s_ == 201 and cid, f"contract fixture {s_} {body_}"
            if active:
                # TEST FIXTURE: stands in for the signature that D-11 governs; never done by the product API
                psql(DATABASE, f"UPDATE contract_contract SET status_select = 2 WHERE id = {int(cid)};")
            return cid

        # --- 1. checklist configuration --------------------------------------------------------------
        def requirement(client, title, mandatory=True, seq=10, code=line["code"]):
            return call(client, "POST", "/requirements", {"businessLineCode": code, "title": title, "mandatory": mandatory, "sequence": seq})

        r1 = requirement(cfg, "Signed scope of work on file", seq=10)
        r2 = requirement(cfg, "Kick-off meeting with the client planned", seq=20)
        r3 = requirement(cfg, "Client logo for the report", mandatory=False, seq=30)
        r_dup = requirement(cfg, "signed scope of work on file")
        r_ops = requirement(op, "Anything")
        r_bad = requirement(cfg, "X", code="NO-SUCH-LINE")
        check("checklist per business line: admin adds items (201); duplicate → 422; operations → 403; unknown line → 422",
              [r[0] for r in (r1, r2, r3)] == [201] * 3 and (r_dup[0], field(r_dup[1])) == (422, "title")
              and r_ops[0] == 403 and (r_bad[0], field(r_bad[1])) == (422, "businessLineCode"), [r[0] for r in (r1, r2, r3, r_dup, r_ops, r_bad)])

        # --- 2. requests ---------------------------------------------------------------------------------
        c_draft = contract("draft", line, active=False)
        c_bare = contract("bare", bare)
        c1 = contract("main", line)
        s_d, b_d = call(a, "POST", "/handovers", {"contractId": c_draft})
        s_b, b_b = call(a, "POST", "/handovers", {"contractId": c_bare})
        s_h, b_h = call(a, "POST", "/handovers", {"contractId": c1})
        h = obj(b_h)
        s_h2, b_h2 = call(a, "POST", "/handovers", {"contractId": c1})
        check("request: draft contract → 422 CONTRACT_NOT_ACTIVE; line without checklist → 422 CHECKLIST_NOT_CONFIGURED; "
              "active → 201 with the checklist copied; again → 409 HANDOVER_EXISTS",
              (s_d, error(b_d).get("code"), s_b, error(b_b).get("code"), s_h, s_h2, error(b_h2).get("code"))
              == (422, "CONTRACT_NOT_ACTIVE", 422, "CHECKLIST_NOT_CONFIGURED", 201, 409, "HANDOVER_EXISTS")
              and h.get("status") == "SUBMITTED" and len(h.get("items") or []) == 3 and h.get("missingRequired") == 2,
              f"{s_d} {s_b} {s_h} {s_h2} {h}")
        call(cfg, "POST", f"/requirements/{obj(r3[1])['id']}/retire", {"version": version(REQ, obj(r3[1])["id"])})
        _, again = call(a, "GET", f"/handovers/{h['id']}")
        check("retiring a requirement does not rewrite a submitted handover (snapshot)", len(obj(again).get("items") or []) == 3, obj(again))

        # --- 3. review ----------------------------------------------------------------------------------
        def accept(client, hid, lead=None, v=None):
            return call(client, "POST", f"/handovers/{hid}/accept", {"version": v if v is not None else version(HANDOVER, hid),
                                                                    "operationsLeadId": (lead or users["Ops"])["id"], "teamId": team["id"],
                                                                    "startDate": date.today().isoformat()})

        def item_ids(hid):
            return [i["id"] for i in obj(call(op, "GET", f"/handovers/{hid}")[1]).get("items") or []]

        def complete(client, iid, evidence=None):
            return call(client, "POST", f"/items/{iid}/complete", {"version": version(ITEM, iid), **({"evidenceReference": evidence} if evidence else {})})

        s_inc, b_inc = accept(op, h["id"])
        s_rep_acc, _ = accept(a, h["id"])
        s_rw, b_rw = call(op, "POST", f"/handovers/{h['id']}/rework", {"version": version(HANDOVER, h["id"]), "reason": "MISSING_DOCUMENTS"})
        s_rw_acc, b_rw_acc = accept(op, h["id"])
        items = item_ids(h["id"])
        s_c1, _ = complete(a, items[0], "DOC-SOW-17")
        s_stale, _ = call(a, "POST", f"/handovers/{h['id']}/resubmit", {"version": version(HANDOVER, h["id"]) - 1})
        s_rs, b_rs = call(a, "POST", f"/handovers/{h['id']}/resubmit", {"version": version(HANDOVER, h["id"])})
        s_c2, _ = complete(op, items[1])
        check("accept with required items open → 422 CHECKLIST_INCOMPLETE; sales cannot accept (403); rework → REWORK_REQUESTED; "
              "accept during rework → 422; items done; stale → 409; resubmitted",
              (s_inc, error(b_inc).get("code"), s_rep_acc, s_rw, obj(b_rw).get("status"), s_rw_acc, error(b_rw_acc).get("code"),
               s_c1, s_stale, s_rs, obj(b_rs).get("status"), s_c2)
              == (422, "CHECKLIST_INCOMPLETE", 403, 200, "REWORK_REQUESTED", 422, "HANDOVER_STATE", 200, 409, 200, "SUBMITTED", 200),
              (s_inc, s_rep_acc, s_rw, s_rw_acc, s_c1, s_stale, s_rs, s_c2))

        # --- 4. acceptance creates exactly one engagement --------------------------------------------------
        s_ac, b_ac = accept(op, h["id"])
        eng = obj(b_ac)
        if eng.get("id"):
            created.append((PROJECT, eng["id"]))
        s_ac2, b_ac2 = accept(op, h["id"])
        s_late, b_late = complete(a, items[2])
        projects = search(PROJECT, f"self.ioetiHandover.id = {h['id']}")
        _, hv = call(op, "GET", f"/handovers/{h['id']}")
        check("acceptance creates one native project linked to the handover (code ENG-H…, client, lead, team); "
              "again → 422; the decided checklist is frozen",
              s_ac == 201 and eng.get("code") == f"ENG-H{h['id']}" and eng.get("clientName") == client_org["name"]
              and eng.get("leadName") == users["Ops"]["name"] and eng.get("teamName") == team["name"] and len(projects) == 1
              and obj(hv).get("status") == "ACCEPTED" and obj(hv).get("engagementId") == eng.get("id")
              and (s_ac2, error(b_ac2).get("code"), s_late, error(b_late).get("code")) == (422, "HANDOVER_STATE", 422, "HANDOVER_STATE"),
              f"{s_ac} {eng} {len(projects)} {s_ac2} {s_late}")

        # Wave 7b: the requester is told in the app about rework and acceptance; the actor gets nothing
        _, inbox_a = a.call("GET", "/ws/ioeti/automation/inbox")
        _, inbox_op = op.call("GET", "/ws/ioeti/automation/inbox")
        notes_a = [(n["kind"], n["subject"], n["subjectId"]) for n in (inbox_a.get("object") or [])]
        check("notices: the requester gets HANDOVER_REWORK and HANDOVER_ACCEPTED in the app; the reviewer, who acted, gets none",
              ("HANDOVER_REWORK", "HANDOVER", h["id"]) in notes_a and ("HANDOVER_ACCEPTED", "HANDOVER", h["id"]) in notes_a
              and not any(n["kind"].startswith("HANDOVER") for n in (inbox_op.get("object") or [])), f"{notes_a} {inbox_op}")

        # --- 5. tasks, progress, ownership --------------------------------------------------------------------
        v_eng = version(PROJECT, eng["id"])
        s_t1, b_t1 = call(op, "POST", f"/engagements/{eng['id']}/tasks", {"version": v_eng, "name": "Stage 1 audit plan",
                                                                          "dueDate": (date.today() + timedelta(days=7)).isoformat()})
        s_t1b, _ = call(op, "POST", f"/engagements/{eng['id']}/tasks", {"version": v_eng, "name": "Stage 1 audit plan",
                                                                        "dueDate": (date.today() + timedelta(days=7)).isoformat()})
        s_t2, b_t2 = call(op, "POST", f"/engagements/{eng['id']}/tasks", {"version": version(PROJECT, eng["id"]), "name": "Collect documents",
                                                                          "dueDate": (date.today() - timedelta(days=2)).isoformat(),
                                                                          "assigneeId": users["Lead2"]["id"]})
        for t in (obj(b_t1), obj(b_t2)):
            if t.get("id"):
                created.append((TASK, t["id"]))
        s_done, b_done = call(op, "POST", f"/tasks/{obj(b_t1)['id']}/complete", {"version": version(TASK, obj(b_t1)["id"])})
        s_done2, b_done2 = call(op, "POST", f"/tasks/{obj(b_t1)['id']}/complete", {"version": version(TASK, obj(b_t1)["id"])})
        _, ev = call(op, "GET", f"/engagements/{eng['id']}")
        check("tasks: added (201); the same version twice → 409, one task; done; progress 50% with one overdue task",
              (s_t1, s_t1b, s_t2, s_done, s_done2, error(b_done2).get("code")) == (201, 409, 201, 200, 422, "TASK_DONE")
              and obj(b_done).get("done") is True and obj(b_t2).get("overdue") is True
              and len(search(TASK, f"self.project.id = {eng['id']}")) == 2
              and (obj(ev).get("tasks"), obj(ev).get("tasksDone"), obj(ev).get("tasksOverdue"), obj(ev).get("progress")) == (2, 1, 1, 50),
              f"{s_t1} {s_t1b} {s_t2} {s_done} {s_done2} {obj(ev)}")
        s_own, b_own = call(op, "POST", f"/engagements/{eng['id']}/owner", {"version": version(PROJECT, eng["id"]), "userId": users["Lead2"]["id"]})
        s_own2, b_own2 = call(op, "POST", f"/engagements/{eng['id']}/owner", {"version": version(PROJECT, eng["id"]), "userId": users["Lead2"]["id"]})
        _, trail = call(op, "GET", f"/handovers/{h['id']}/events")
        kinds = [e["kind"] for e in obj(trail)] if isinstance(obj(trail), list) else []
        owner_event = next((e for e in obj(trail) if e["kind"] == "OWNER_CHANGED"), {}) if kinds else {}
        rework_event = next((e for e in obj(trail) if e["kind"] == "REWORK_REQUESTED"), {}) if kinds else {}
        check("ownership transfer recorded (from → to); same owner → 422; trail lists every step with its actor and reason",
              s_own == 200 and obj(b_own).get("leadName") == users["Lead2"]["name"] and (s_own2, error(b_own2).get("code")) == (422, "SAME_OWNER")
              and kinds == ["SUBMITTED", "REWORK_REQUESTED", "ITEM_DONE", "RESUBMITTED", "ITEM_DONE", "ACCEPTED", "ENGAGEMENT_CREATED", "OWNER_CHANGED"]
              and owner_event.get("fromUser") == users["Ops"]["name"] and owner_event.get("toUser") == users["Lead2"]["name"]
              and rework_event.get("reason") == "MISSING_DOCUMENTS" and rework_event.get("actorName") == users["Ops"]["name"],
              f"{s_own} {s_own2} {kinds}")
        s_put = a.call("PUT", f"{BASE}/handovers/{h['id']}/events", {})[0]
        s_del = op.call("DELETE", f"{BASE}/handovers/{h['id']}/events")[0]
        check("the trail has no write path (PUT/DELETE → 404/405)", s_put in (404, 405) and s_del in (404, 405), f"{s_put} {s_del}")

        # --- 6. rejection, then a new request -----------------------------------------------------------------
        c2 = contract("reject", line)
        _, b_r = call(a, "POST", "/handovers", {"contractId": c2})
        hr = obj(b_r)
        s_rj, b_rj = call(op, "POST", f"/handovers/{hr['id']}/reject", {"version": version(HANDOVER, hr["id"]), "reason": "CLIENT_NOT_READY"})
        s_rj_bad, b_rj_bad = call(op, "POST", f"/handovers/{hr['id']}/reject", {"version": version(HANDOVER, hr["id"]), "reason": "BORED"})
        s_new, b_new = call(a, "POST", "/handovers", {"contractId": c2})
        check("rejected with a reason; a decided handover cannot be rejected again; a new request after rejection → 201",
              s_rj == 200 and obj(b_rj).get("status") == "REJECTED" and s_rj_bad == 422 and s_new == 201
              and search(PROJECT, f"self.ioetiHandover.id = {hr['id']}") == [], f"{s_rj} {s_rj_bad} {s_new}")

        # --- 7. isolation and policy ---------------------------------------------------------------------------
        sb = [call(b, "GET", p)[0] for p in (f"/handovers/{h['id']}", f"/handovers/{h['id']}/events", f"/handovers/{MISSING}")]
        sb_item, _ = complete(b, items[2])
        _, b_list = call(b, "GET", "/handovers")
        s_a_eng, _ = call(a, "GET", "/engagements")
        s_a_task, _ = call(a, "POST", f"/engagements/{eng['id']}/tasks", {"version": version(PROJECT, eng["id"]), "name": "x"})
        _, o_list = call(op, "GET", "/engagements")
        s_act, b_act = a.call("POST", f"/ws/ioeti/workspace/contracts/{c_draft}/activate", {"version": version(CONTRACT, c_draft), "signedOn": "2026-01-01"})
        check("another salesperson: handover and trail answer 404 like missing ids, cannot touch items; sales cannot read engagements "
              "or add tasks (403/404); operations lists the engagement; activating a contract needs its signature evidence (D-11)",
              sb == [404, 404, 404] and sb_item == 404 and h["id"] not in [x["id"] for x in obj(b_list)]
              and s_a_eng == 403 and s_a_task in (403, 404) and eng["id"] in [x["id"] for x in obj(o_list)]
              and s_act == 422 and ((error(b_act).get("fields") or [{}])[0]).get("field") == "documentId", f"{sb} {sb_item} {s_a_eng} {s_a_task} {s_act} {error(b_act)}")

        # --- 8. concurrency: simultaneous acceptances create one engagement ----------------------------------
        outcomes = []
        for i in range(ROUNDS):
            ci = contract(f"race{i}", line)
            _, bi = call(a, "POST", "/handovers", {"contractId": ci})
            hi = obj(bi)
            for iid in item_ids(hi["id"]):
                complete(a, iid)
            v0 = version(HANDOVER, hi["id"])
            gate, answers = threading.Barrier(2), []

            def run(client):
                gate.wait()
                answers.append(accept(client, hi["id"], v=v0))

            threads = [threading.Thread(target=run, args=(cl,)) for cl in (op, op2)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            for _, resp in answers:
                if obj(resp).get("id"):
                    created.append((PROJECT, obj(resp)["id"]))
            outcomes.append((sorted(s_ for s_, _ in answers), len(search(PROJECT, f"self.ioetiHandover.id = {hi['id']}"))))
        check(f"concurrent acceptances of one handover: one 201 and one 409, exactly one engagement ({ROUNDS} rounds)",
              all(o == ([201, 409], 1) for o in outcomes), outcomes)

        failed = [r for r in RESULTS if r["result"] != "PASS"]
        print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
        exit_code = 0 if not failed else 1
    finally:
        opp_ids = [rid for model, rid in created if model == OPP]
        handovers = []
        if opp_ids:
            contracts = search(CONTRACT, f"self.opportunity.id in ({','.join(map(str, opp_ids))})")
            if contracts:
                handovers = [r["id"] for r in search(HANDOVER, f"self.contract.id in ({','.join(str(c['id']) for c in contracts)})")]
            if handovers:
                ids = ",".join(map(str, handovers))
                for row in search(TASK, f"self.project.ioetiHandover.id in ({ids})"):
                    if (TASK, row["id"]) not in created:
                        created.append((TASK, row["id"]))
                for row in search(PROJECT, f"self.ioetiHandover.id in ({ids})"):
                    if (PROJECT, row["id"]) not in created:
                        created.append((PROJECT, row["id"]))
                # the handover points back to its engagement: clear that link before deleting projects
                psql(DATABASE, f"UPDATE ioeti_ops_handover SET engagement = NULL WHERE id IN ({ids});")
                for model in (EVENT, ITEM):
                    for row in search(model, f"self.handover.id in ({ids})"):
                        created.append((model, row["id"]))
                created.extend((HANDOVER, hid) for hid in handovers)
        for row in search(REQ, f"self.businessLine.code like 'W5%{tag}'"):
            if (REQ, row["id"]) not in created:
                created.append((REQ, row["id"]))
        order = {TASK: 0, PROJECT: 1, EVENT: 2, ITEM: 2, HANDOVER: 3, REQ: 4, OPP: 6, TEAM: 6, PARTNER: 7, LINE: 7,
                 SEQUENCE_VERSION: 8, SEQUENCE: 8, USER: 9, GROUP: 10, PERM: 11, COMPANY: 12}
        complete_ = False
        leftovers = []
        try:
            first = [(m, r) for m, r in created if order.get(m, 99) <= 3]
            cleanup(admin, first, order)
            if opp_ids:
                for row in search(CONTRACT, f"self.opportunity.id in ({','.join(map(str, opp_ids))})"):
                    delete_contract(admin, row["id"])
            for model, rid in list(created):
                if model == SEQUENCE:
                    _delete_where(admin, RESERVED_SEQUENCE, f"self.sequenceVersion.sequence.id = {rid}")
                    for row in search(SEQUENCE_VERSION, f"self.sequence.id = {rid}"):
                        created.append((SEQUENCE_VERSION, row["id"]))
            complete_, leftovers = cleanup(admin, created, order)
        finally:
            if not complete_:
                print(f"FAIL cleanup left {leftovers}")
                exit_code = 1
            os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
            with open(os.path.join(ROOT, "logs", "operations-probe.json"), "w", encoding="utf-8") as f:
                json.dump({"results": RESULTS, "cleanup_complete": complete_}, f, indent=2)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
