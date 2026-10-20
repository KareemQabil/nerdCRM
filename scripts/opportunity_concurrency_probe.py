#!/usr/bin/env python3
"""Live two-writer concurrency and negative-permission probe for PUT /ws/ioeti/opportunities/{id}.

Requires a RUNNING local Axelor with the CRM app installed (same prerequisites as
opportunity_pilot_smoke.py). Never run against production.

Each round, two independent sessions read the same version and send a rename simultaneously.
Integrity contract checked against a fresh read after every round:
  - exactly one writer gets 200 and the other gets 409 (never 500, never two successes);
  - the stored name is the winner's and the version advanced by exactly one (no lost update).
The 409 message tells which guard fired: the native pre-check (ConflictChecker) or the
commit-time optimistic lock (OptimisticLockConflicts). Both are counted and reported.

Also checks: missing version -> 400, anonymous and no-permission users cannot rename, and a
denied or stale request leaves the record unchanged. Writes logs/opportunity-concurrency-probe.json.
Usage: python3 scripts/opportunity_concurrency_probe.py [rounds]
"""
import json
import os
import secrets
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import (  # noqa: E402
    ENV, OPP, ROOT, Client, axelor_password_hash, ok, rest_create)

PRECHECK_MESSAGE = "Object provided has been updated by another user"
COMMIT_MESSAGE = "Record has changed; refresh and retry."
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": detail})
    print(("PASS " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""))
    return condition


def admin_client():
    client = Client()
    user = os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin"))
    password = os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))
    if client.login(user, password) != 200:
        raise SystemExit("admin login failed")
    return client


def read(client, opp_id):
    status, body = client.call("GET", f"/ws/ioeti/opportunities/{opp_id}")
    return status, body.get("object") or {}


def race(writers, opp_id, version, names):
    """Sends one PUT per writer at the same instant; returns [(http, codeStatus, message)]."""
    barrier = threading.Barrier(len(writers))
    out = [None] * len(writers)

    def run(i):
        barrier.wait()
        status, body = writers[i].call("PUT", f"/ws/ioeti/opportunities/{opp_id}",
                                       {"name": names[i], "version": version})
        out[i] = (status, body.get("codeStatus"), str(body.get("messageStatus"))[:100])

    threads = [threading.Thread(target=run, args=(i,)) for i in range(len(writers))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return out


def main():
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    admin = admin_client()
    writers = [admin_client(), admin_client()]  # independent sessions
    suffix = secrets.token_hex(4)
    opp_id = user_id = None
    try:
        status, lines = admin.call("GET", "/ws/ioeti/business-lines?activeOnly=true")
        line = ((lines.get("object") or [{}])[0]).get("code")
        status, body = admin.call("POST", "/ws/ioeti/opportunities",
                                  {"name": "IOETI concurrency probe " + suffix, "businessLineCode": line})
        opp_id = (body.get("object") or {}).get("id")
        if not check("probe opportunity created through IOETI API", status == 201 and opp_id, f"http={status}"):
            return 1

        # --- two simultaneous writers -------------------------------------------------------
        stats = {"rounds": rounds, "one_winner": 0, "precheck_409": 0, "commit_409": 0,
                 "double_success": 0, "double_conflict": 0, "server_error": 0, "lost_update": 0}
        for r in range(rounds):
            _, before = read(admin, opp_id)
            version = before.get("version")
            names = [f"Writer A round {r} {suffix}", f"Writer B round {r} {suffix}"]
            outcome = race(writers, opp_id, version, names)
            statuses = sorted(o[0] for o in outcome)
            _, after = read(admin, opp_id)
            if any(o[0] >= 500 or (o[1] or 0) >= 500 for o in outcome):
                stats["server_error"] += 1
            if statuses == [200, 200]:
                stats["double_success"] += 1
            elif statuses == [409, 409]:
                stats["double_conflict"] += 1
            elif statuses == [200, 409] and all(o[0] == o[1] for o in outcome):
                winner = names[[o[0] for o in outcome].index(200)]
                loser = [o for o in outcome if o[0] == 409][0]
                if after.get("name") == winner and after.get("version") == version + 1:
                    stats["one_winner"] += 1
                else:
                    stats["lost_update"] += 1
                if loser[2].startswith(PRECHECK_MESSAGE):
                    stats["precheck_409"] += 1
                elif loser[2] == COMMIT_MESSAGE:
                    stats["commit_409"] += 1
        print("CONCURRENCY_STATS", json.dumps(stats))
        check("every round: exactly one writer wins, the other gets 409, stored state is the winner's",
              stats["one_winner"] == rounds, json.dumps(stats))
        check("no round produced a server error (500)", stats["server_error"] == 0, json.dumps(stats))
        check("no lost update or double success", stats["double_success"] == 0 and stats["lost_update"] == 0,
              json.dumps(stats))
        check("both 409 paths reported with their fixed messages (no internal exception text)",
              stats["precheck_409"] + stats["commit_409"] == stats["one_winner"], json.dumps(stats))

        # --- negative cases ---------------------------------------------------------------------
        _, baseline = read(admin, opp_id)
        status, body = admin.call("PUT", f"/ws/ioeti/opportunities/{opp_id}", {"name": "No version given"})
        check("NEG missing version is a 400", status == 400 and body.get("codeStatus") == 400, f"http={status}")
        status, body = Client().call("PUT", f"/ws/ioeti/opportunities/{opp_id}",
                                     {"name": "Anonymous write", "version": baseline.get("version")})
        check("NEG anonymous rename refused", status in (401, 403) or body.get("codeStatus") in (401, 403),
              f"http={status}")

        status, body = admin.call("POST", "/ws/rest/com.axelor.auth.db.Group/search",
                                  {"data": {"_domain": "self.code = 'ioeti-bl-viewer'"}, "fields": ["code"]})
        group_id = body["data"][0]["id"] if ok(body) and body.get("data") else None
        login = f"ioeti.probe.{suffix}"
        password = "Ip!" + secrets.token_urlsafe(12)
        status, body = rest_create(admin, "com.axelor.auth.db.User",
                                   {"code": login, "name": "IOETI concurrency probe viewer",
                                    "password": axelor_password_hash(password), "blocked": False,
                                    "group": {"id": group_id}, "language": "en"})
        user_id = body["data"][0]["id"] if ok(body) else None
        viewer = Client()
        check("viewer (no Opportunity permission) created and logged in",
              user_id is not None and viewer.login(login, password) == 200)
        status, body = viewer.call("PUT", f"/ws/ioeti/opportunities/{opp_id}",
                                   {"name": "Viewer write", "version": baseline.get("version")})
        check("NEG viewer without write permission cannot rename",
              status == 403 or body.get("codeStatus") == 403, f"http={status} code={body.get('codeStatus')}")
        status, body = viewer.call("GET", f"/ws/ioeti/opportunities/{opp_id}")
        check("NEG viewer cannot read the opportunity",
              status in (403, 404) or body.get("codeStatus") in (403, 404), f"http={status}")
        status, body = admin.call("PUT", f"/ws/ioeti/opportunities/{opp_id}",
                                  {"name": "Stale single write", "version": baseline.get("version") - 1})
        check("NEG stale single write is a 409", status == 409 and body.get("codeStatus") == 409, f"http={status}")

        _, final = read(admin, opp_id)
        check("denied and stale requests left the record unchanged",
              final.get("name") == baseline.get("name") and final.get("version") == baseline.get("version"),
              f"before={baseline.get('version')} after={final.get('version')}")
    finally:
        cleanup = []
        for model, rid in ((OPP, opp_id), ("com.axelor.auth.db.User", user_id)):
            if rid:
                s, b = admin.call("DELETE", f"/ws/rest/{model}/{rid}")
                cleanup.append(f"{model.split('.')[-1]}:{'ok' if ok(b) else s}")
        check("cleanup of probe records", all(c.endswith(":ok") for c in cleanup), ", ".join(cleanup))
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "opportunity-concurrency-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS}, f, indent=2)
    failed = [r for r in RESULTS if r["result"] != "PASS"]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
