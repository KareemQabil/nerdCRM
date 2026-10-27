#!/usr/bin/env python3
"""Wave 2 live probe: lead qualification and assignment on the native AOS LeadService.

Run against a RUNNING local/CI Axelor with the CRM app installed; never against production.
Roles are TEST FIXTURES built from native permissions (policy D-07 defines the real ones).

Principals: RepA, RepB (read/write their own leads and the unassigned queue), ReadOnly (reads every
lead, writes none), NoLead (no lead permission at all).
Checks, through /ws/ioeti/leads:
  stages (native order, OPEN/CONVERTED/LOST kinds) and lost reasons, by lead read access only
  stage moves: open stages only; converted, lost and unknown stages refused identically
  stale version → 409, missing version → 400, another rep's lead → the same 404 as a missing id,
  read-only → 403; refusals leave the lead unchanged
  lose with reason and note (the note is stored, never returned); lose twice → 422;
  a lost lead cannot move or be assigned until reopened; reopen → default stage, reason cleared;
  reopen of an open lead → 422 NOT_LOST
  assign to me from the unassigned queue; the lead leaves the other rep's view; assigning to
  someone else → 422 BLOCKED_BY_POLICY (D-07, D-12)
  converted leads refuse every command with 409 ALREADY_CONVERTED
  N concurrent stage moves → exactly one 200 and one 409; N concurrent queue pickups → one 200 and,
  for the other rep, 409 or 404 (the lead left its scope), never 403 and never two owners
Env: PROBE_LIFECYCLE_ROUNDS (default 5). Report: logs/lead-lifecycle-probe.json.
"""
import json
import os
import secrets
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import BL, ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
LEAD, LEAD_STATUS = "com.axelor.apps.crm.db.Lead", "com.axelor.apps.crm.db.LeadStatus"
LOST_REASON, APP_CRM = "com.axelor.apps.crm.db.LostReason", "com.axelor.studio.db.AppCrm"
MISSING = 987654321
ROUNDS = int(os.environ.get("PROBE_LIFECYCLE_ROUNDS", "5"))
RESULTS = []
SAFE_FIELDS = {"id", "version", "name", "organization", "stage", "converted", "businessLineCode", "accountId",
               "opportunityId", "stageId", "stageKind", "lostReason", "assignedToMe", "receivedAt"}


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

    def state(row):
        stored = fetch(LEAD, row["id"], ["version", "leadStatus", "lostReason", "lostReasonStr", "user"])
        return (stored.get("version"), ref_id(stored.get("leadStatus")), ref_id(stored.get("lostReason")),
                stored.get("lostReasonStr"), ref_id(stored.get("user")))

    exit_code = 1
    try:
        _, lines = admin.call("GET", "/ws/ioeti/business-lines")
        iso = {l["code"]: l for l in lines["object"]}["ISO9001"]
        app_crm = search(APP_CRM, "self.id > 0", ("leadDefaultStatus", "lostLeadStatus", "convertedLeadStatus"))[0]
        default_id = ref_id(app_crm.get("leadDefaultStatus"))
        lost_id, converted_id = ref_id(app_crm.get("lostLeadStatus")), ref_id(app_crm.get("convertedLeadStatus"))
        statuses = search(LEAD_STATUS, "self.id > 0", ("name", "sequence"))
        open_ids = [s["id"] for s in sorted(statuses, key=lambda s: (s.get("sequence") or 0, s["id"]))
                    if s["id"] not in (lost_id, converted_id)]
        assert len(open_ids) >= 2 and default_id in open_ids, "needs two open lead stages incl. the default"
        second = next(i for i in open_ids if i != default_id)
        reason = create(LOST_REASON, {"name": f"Wave2 budget {tag}"})

        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"wave2lc.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})

        # own leads plus the unassigned queue (test fixture; the real routing rules are D-07)
        rep_perms = [perm("lead", LEAD, "self.user = ? OR self.user IS NULL", canRead=True, canWrite=True),
                     perm("line", BL, canRead=True)]
        groups = {
            "rep": create(GROUP, {"code": f"wave2lc-rep-{tag}", "name": f"Wave2 lifecycle rep {tag}",
                                  "permissions": [{"id": p["id"]} for p in rep_perms]}),
            "ro": create(GROUP, {"code": f"wave2lc-ro-{tag}", "name": f"Wave2 lifecycle read-only {tag}",
                                 "permissions": [{"id": perm("ro.lead", LEAD, canRead=True)["id"]}]}),
            "none": create(GROUP, {"code": f"wave2lc-none-{tag}", "name": f"Wave2 lifecycle no lead {tag}",
                                   "permissions": [{"id": perm("none.line", BL, canRead=True)["id"]}]}),
        }
        sessions, users = {}, {}
        for label, group in (("RepA", "rep"), ("RepA2", None), ("RepB", "rep"), ("ReadOnly", "ro"),
                             ("NoLead", "none")):
            if group is None:  # a second session of RepA
                sessions[label] = Client()
                assert sessions[label].login(users["RepA"]["code"], users["RepA"]["_password"]) == 200
                continue
            password = "W2!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"wave2lc.{label.lower()}.{tag}", "name": f"Wave2 {label}",
                                         "blocked": False, "language": "en", "group": {"id": groups[group]["id"]},
                                         "password": axelor_password_hash(password),
                                         "ioetiBusinessLines": [{"id": iso["id"]}]})
            users[label]["_password"] = password
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        a, a2, b, ro, nolead = (sessions[k] for k in ("RepA", "RepA2", "RepB", "ReadOnly", "NoLead"))

        def lead(label, owner="RepA", status=None, **extra):
            values = {"firstName": "Probe", "name": f"Wave2LC {label} {tag}", "enterpriseName": f"LC {label} {tag}",
                      "user": {"id": users[owner]["id"]} if owner else None,
                      "leadStatus": {"id": status or default_id}, "ioetiBusinessLine": {"id": iso["id"]}, **extra}
            return create(LEAD, values)

        def command(client, row, action, version=None, **body):
            if version is None:
                version = fetch(LEAD, row["id"], ["version"]).get("version")
            return client.call("POST", f"/ws/ioeti/leads/{row['id']}/{action}", {"version": version, **body})

        # --- 1. vocabulary ------------------------------------------------------------------------------
        s, body = a.call("GET", "/ws/ioeti/leads/stages")
        stages = body.get("object") or []
        kinds = {st["id"]: st["kind"] for st in stages}
        check("stages: every native status, in pipeline order, with its kind",
              s == 200 and [st["id"] for st in stages] == [x["id"] for x in sorted(
                  statuses, key=lambda x: (x.get("sequence") or 0, x["id"]))]
              and kinds.get(lost_id) == "LOST" and kinds.get(converted_id) == "CONVERTED"
              and all(kinds.get(i) == "OPEN" for i in open_ids)
              and all(set(st) == {"id", "name", "kind"} for st in stages), f"{s} {stages}")
        s_ro, _ = ro.call("GET", "/ws/ioeti/leads/stages")
        s_no, _ = nolead.call("GET", "/ws/ioeti/leads/stages")
        s_no2, _ = nolead.call("GET", "/ws/ioeti/leads/lost-reasons")
        check("stages follow lead read access (read-only 200, no lead permission 403)",
              s_ro == 200 and s_no == s_no2 == 403, f"{s_ro} {s_no} {s_no2}")
        s, body = a.call("GET", "/ws/ioeti/leads/lost-reasons")
        check("lost reasons listed", s == 200 and {"id": reason["id"], "name": reason["name"]} in (body.get("object") or []),
              f"{s} {body}")

        # --- 2. stage moves -----------------------------------------------------------------------------
        l1 = lead("L1")
        s, body = command(a, l1, "stage", stageId=second)
        v = body.get("object") or {}
        check("move to an open stage (200, new version, stage in view)",
              s == 200 and v.get("stageId") == second and v.get("version") == state(l1)[0]
              and state(l1)[1] == second, f"{s} {v}")
        check("lead view: safe fields only, received time and assignment shown",
              set(v) <= SAFE_FIELDS and v.get("receivedAt") and v.get("assignedToMe") is True, v)
        before = state(l1)
        refused = {}
        for label, target in (("converted", converted_id), ("lost", lost_id), ("unknown", MISSING)):
            s, body = command(a, l1, "stage", stageId=target)
            refused[label] = (s, error(body).get("fields"))
        check("converted, lost and unknown stages refused identically (422 stageId)",
              refused["converted"] == refused["lost"] == refused["unknown"] and refused["unknown"][0] == 422
              and refused["unknown"][1][0]["field"] == "stageId", refused)
        s_stale, _ = command(a, l1, "stage", version=before[0] - 1, stageId=default_id)
        s_none, _ = a.call("POST", f"/ws/ioeti/leads/{l1['id']}/stage", {"stageId": default_id})
        check("stale version → 409, missing version → 400", s_stale == 409 and s_none == 400, f"{s_stale} {s_none}")
        l2 = lead("L2", owner="RepB")
        s_other, b_other = command(a, l2, "stage", stageId=second)
        s_missing, b_missing = a.call("POST", f"/ws/ioeti/leads/{MISSING}/stage", {"version": 0, "stageId": second})
        check("another rep's lead → the same 404 as a missing id",
              s_other == s_missing == 404 and error(b_other).get("code") == error(b_missing).get("code"),
              f"{s_other} {s_missing}")
        s_ro, _ = command(ro, l1, "stage", stageId=default_id)
        check("read-only user → 403", s_ro == 403, s_ro)
        check("refused moves left the leads unchanged", state(l1) == before and state(l2)[1] == default_id,
              (before, state(l1)))

        # --- 3. lose and reopen -------------------------------------------------------------------------
        note = f"Budget frozen until next year {tag}"
        s, body = command(a, l1, "lose", lostReasonId=reason["id"], note=note)
        v = body.get("object") or {}
        stored = state(l1)
        check("lose: LOST stage, reason shown, note stored", s == 200 and v.get("stageId") == lost_id
              and v.get("stageKind") == "LOST"
              and v.get("lostReason") == reason["name"] and stored[1:4] == (lost_id, reason["id"], note), f"{s} {v} {stored}")
        check("lose: the free-text note is never returned", note not in json.dumps(body), body)
        s, body = command(a, l1, "lose")
        check("lose twice → 422 LEAD_REJECTED (native rule, safe message)",
              s == 422 and error(body).get("code") == "LEAD_REJECTED" and "Exception" not in json.dumps(body),
              f"{s} {body}")
        s_move, b_move = command(a, l1, "stage", stageId=second)
        s_assign, b_assign = command(a, l1, "assign")
        check("a lost lead cannot move (LEAD_LOST) or be assigned (LEAD_REJECTED)",
              s_move == s_assign == 422 and error(b_move).get("code") == "LEAD_LOST"
              and error(b_assign).get("code") == "LEAD_REJECTED", f"{s_move} {s_assign}")
        l3 = lead("L3")
        bad = {}
        for label, extra in (("unknown reason", {"lostReasonId": MISSING}), ("long note", {"note": "x" * 501})):
            s, body = command(a, l3, "lose", **extra)
            bad[label] = (s, (error(body).get("fields") or [{}])[0].get("field"))
        check("unknown reason and over-long note refused (422 field errors), lead unchanged",
              bad == {"unknown reason": (422, "lostReasonId"), "long note": (422, "note")}
              and state(l3)[1] == default_id, bad)
        s, body = command(a, l1, "reopen")
        stored = state(l1)
        check("reopen: default stage, reason and note cleared",
              s == 200 and (body.get("object") or {}).get("stageId") == default_id
              and stored[1:4] == (default_id, None, None), f"{s} {stored}")
        s, body = command(a, l1, "reopen")
        check("reopen an open lead → 422 NOT_LOST", s == 422 and error(body).get("code") == "NOT_LOST", f"{s} {body}")

        # --- 4. assignment ------------------------------------------------------------------------------
        u1 = lead("U1", owner=None)
        s_seen_b, _ = b.call("GET", f"/ws/ioeti/leads/{u1['id']}")
        s, body = command(a, u1, "assign")
        check("assign to me from the unassigned queue",
              s_seen_b == 200 and s == 200 and (body.get("object") or {}).get("assignedToMe") is True
              and state(u1)[4] == users["RepA"]["id"], f"{s_seen_b} {s} {body}")
        s_after_b, _ = b.call("GET", f"/ws/ioeti/leads/{u1['id']}")
        check("an assigned lead leaves the other rep's view (404)", s_after_b == 404, s_after_b)
        s, body = command(a, u1, "assign", userId=users["RepB"]["id"])
        check("assign to someone else → 422 BLOCKED_BY_POLICY (D-07, D-12), owner unchanged",
              s == 422 and error(body).get("code") == "BLOCKED_BY_POLICY"
              and all(d in error(body).get("message", "") for d in ("D-07", "D-12"))
              and state(u1)[4] == users["RepA"]["id"], f"{s} {body}")
        s, _ = command(a, u1, "assign", userId=users["RepA"]["id"])
        check("assign with my own user id → 200", s == 200, s)

        # --- 5. converted leads are final --------------------------------------------------------------
        c1 = lead("CV", status=converted_id, isConverted=True)
        answers = {action: command(a, c1, action, **extra) for action, extra in
                   (("stage", {"stageId": second}), ("lose", {}), ("reopen", {}), ("assign", {}))}
        check("converted lead: stage/lose/reopen/assign → 409 ALREADY_CONVERTED",
              all(s == 409 and error(body).get("code") == "ALREADY_CONVERTED" for s, body in answers.values()),
              {k: v[0] for k, v in answers.items()})

        # --- 6. concurrency -----------------------------------------------------------------------------
        def race(row, calls):
            gate, out = threading.Barrier(len(calls)), []

            def run(client, action, body):
                gate.wait()
                out.append((client, *client.call("POST", f"/ws/ioeti/leads/{row['id']}/{action}", body)))

            threads = [threading.Thread(target=run, args=c) for c in calls]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            return out

        moves, pickups = [], []
        for i in range(ROUNDS):
            row = lead(f"M{i}")
            version = state(row)[0]
            out = race(row, [(a, "stage", {"version": version, "stageId": second}),
                             (a2, "stage", {"version": version, "stageId": open_ids[-1] if open_ids[-1] != second
                                                                    else default_id})])
            winner = [body.get("object", {}).get("stageId") for _, s, body in out if s == 200]
            moves.append((sorted(s for _, s, _ in out), winner == [state(row)[1]]))
            queue = lead(f"Q{i}", owner=None)
            version = state(queue)[0]
            out = race(queue, [(a, "assign", {"version": version}), (b, "assign", {"version": version})])
            owners = {users["RepA"]["id"] if c is a else users["RepB"]["id"] for c, s, _ in out if s == 200}
            pickups.append((sorted(s for _, s, _ in out), state(queue)[4] in owners and len(owners) == 1))
        check(f"concurrent stage moves: one 200 and one 409, stored stage is the winner's ({ROUNDS} leads)",
              all(s == [200, 409] and w for s, w in moves), moves)
        # the loser gets 409 if it passed the access checks before the winner committed, else 404:
        # the lead has left its scope (never 403, which would describe a lead it can still read)
        check(f"concurrent queue pickups: one 200, the other 409 or 404, one owner ({ROUNDS} leads)",
              all(s in ([200, 409], [200, 404]) and w for s, w in pickups), pickups)

        failed = [r for r in RESULTS if r["result"] != "PASS"]
        print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
        exit_code = 0 if not failed else 1
    finally:
        complete, leftovers = cleanup(admin, created, {LEAD: 0, LOST_REASON: 1, USER: 2, GROUP: 3, PERM: 4})
        if not complete:
            print(f"FAIL cleanup left {leftovers}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "lead-lifecycle-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
