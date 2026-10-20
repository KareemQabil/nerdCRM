#!/usr/bin/env python3
"""SEC-001 live probe: request identity isolation under mixed sessions and admin metadata reloads.

Run against a RUNNING local/CI Axelor with the CRM app installed. Never against production or any
environment holding real data. Creates throw-away groups, permissions, users and opportunities
and deletes them at the end (cleanup result is reported and fails the run if incomplete).

Principals (each worker has its own HTTP session):
  A   sales user A: own opportunities only (native condition self.user = __user__), line ISO9001
  B   sales user B: own opportunities only, line TRAINING
  RO  read-only:    group ioeti-bl-viewer (active business lines, no opportunities)
  ANON              no session
  BLK user whose live session is blocked by the admin before the load starts
  OUT user who logged out before the load starts and keeps sending the old cookie
While these run concurrently, the admin keeps working (reads, failing requests) and reloads all
metadata (restoreAll) PROBE_RESTORES times, plus one reload whose client times out early.

Every response is checked against the principal's expected identity and record scope. Any
mismatch is a leak and the script exits non-zero. A clean run is evidence for this sample only,
not a proof that no interleaving can leak.
Report: logs/identity-isolation-probe.json (no credentials, cookies or response bodies).
"""
import json
import os
import secrets
import sys
import threading
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import (  # noqa: E402
    BASE, BL, ENV, OPP, ROOT, Client, axelor_password_hash, ok, rest_create)

RESTORES = int(os.environ.get("PROBE_RESTORES", "2"))
WORKERS_PER_PRINCIPAL = int(os.environ.get("PROBE_WORKERS", "2"))
MIN_SECONDS = int(os.environ.get("PROBE_MIN_SECONDS", "30"))
USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
RESTORE_ACTION = {"action": "com.axelor.meta.web.MetaController:restoreAll",
                  "model": "com.axelor.meta.db.MetaView", "data": {"context": {}}}
BOUNDARY = "/ws/ioeti/security/identity-boundary"


class Tally:
    def __init__(self):
        self.lock = threading.Lock()
        self.checks = {}
        self.leaks = {}
        self.examples = []

    def record(self, principal, check, leaked, detail=""):
        key = f"{principal}:{check}"
        with self.lock:
            self.checks[key] = self.checks.get(key, 0) + 1
            if leaked:
                self.leaks[key] = self.leaks.get(key, 0) + 1
                if len(self.examples) < 20:
                    self.examples.append({"check": key, "detail": detail[:160]})


def admin_client():
    client = Client()
    user = os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin"))
    password = os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))
    if client.login(user, password) != 200:
        raise SystemExit("admin login failed")
    return client


def restore_all(client, timeout):
    """restoreAll can take minutes under load; Client.call has a fixed 60 s timeout."""
    req = urllib.request.Request(BASE + "/ws/action", data=json.dumps(RESTORE_ACTION).encode(),
                                 method="POST", headers={"Content-Type": "application/json",
                                                         "Accept": "application/json"})
    try:
        with client.opener.open(req, timeout=timeout) as resp:
            return resp.status == 200 and json.loads(resp.read().decode() or "{}").get("status") == 0
    except urllib.error.HTTPError:
        return False
    except Exception:
        return "client-aborted"


def data(body):
    return body.get("data") if isinstance(body, dict) and body.get("status") == 0 else None


def ids_of(body, key="object"):
    items = body.get(key) if isinstance(body, dict) else None
    return {i.get("id") for i in items} if isinstance(items, list) else None


class Fixtures:
    """Creates and deletes everything the probe needs; remembers what it created."""

    def __init__(self, admin):
        self.admin = admin
        self.created = []  # (model, id) in creation order
        self.tag = secrets.token_hex(3)
        self.passwords = {}

    def create(self, model, values):
        _, body = rest_create(self.admin, model, values)
        rows = data(body)
        if not rows:
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}")
        self.created.append((model, rows[0]["id"]))
        return rows[0]

    def user(self, label, group_id):
        login = f"sec001.{label.lower()}.{self.tag}"
        password = "S1!" + secrets.token_urlsafe(14)
        row = self.create(USER, {"code": login, "name": f"SEC-001 {label}", "blocked": False,
                                 "password": axelor_password_hash(password),
                                 "group": {"id": group_id}, "language": "en"})
        self.passwords[label] = (login, password)
        return row

    def cleanup(self):
        results = []
        order = {OPP: 0, USER: 1, GROUP: 2, PERM: 3, BL: 4}  # opportunities reference users
        for model, rid in sorted(reversed(self.created), key=lambda c: order.get(c[0], 9)):
            status, body = self.admin.call("DELETE", f"/ws/rest/{model}/{rid}")
            results.append(ok(body))
        return all(results), len(results)


def main():
    admin = admin_client()
    tally = Tally()
    fx = Fixtures(admin)
    report = {"base": BASE, "restores": RESTORES, "workers_per_principal": WORKERS_PER_PRINCIPAL}
    exit_code = 1
    try:
        # --- reference data (admin view) -------------------------------------------------------
        _, lines = admin.call("GET", "/ws/ioeti/business-lines")
        active = {l["code"] for l in lines.get("object") or [] if l.get("status") == 2}
        by_code = {l["code"]: l for l in lines.get("object") or []}
        if not {"ISO9001", "TRAINING"} <= active:
            raise SystemExit("seeded business lines ISO9001/TRAINING must be active")
        _, grp = admin.call("POST", f"/ws/rest/{GROUP}/search",
                            {"data": {"_domain": "self.code = 'ioeti-bl-viewer'"}, "fields": ["code"]})
        viewer_group = data(grp)[0]["id"]

        # --- fixtures: two sales scopes, read-only, blocked, logged-out ------------------------
        own_opp = fx.create(PERM, {"name": f"sec001.own-opp.{fx.tag}", "object": OPP, "canRead": True,
                                   "condition": "self.user = ?", "conditionParams": "__user__"})
        line_a = fx.create(PERM, {"name": f"sec001.line-a.{fx.tag}", "object": BL, "canRead": True,
                                  "condition": "self.code = 'ISO9001'"})
        line_b = fx.create(PERM, {"name": f"sec001.line-b.{fx.tag}", "object": BL, "canRead": True,
                                  "condition": "self.code = 'TRAINING'"})
        group_a = fx.create(GROUP, {"code": f"sec001-a-{fx.tag}", "name": "SEC-001 sales A",
                                    "permissions": [{"id": own_opp["id"]}, {"id": line_a["id"]}]})
        group_b = fx.create(GROUP, {"code": f"sec001-b-{fx.tag}", "name": "SEC-001 sales B",
                                    "permissions": [{"id": own_opp["id"]}, {"id": line_b["id"]}]})
        users = {"A": fx.user("A", group_a["id"]), "B": fx.user("B", group_b["id"]),
                 "RO": fx.user("RO", viewer_group), "BLK": fx.user("BLK", group_b["id"]),
                 "OUT": fx.user("OUT", group_a["id"])}
        opps = {}
        for label, line in (("A", "ISO9001"), ("B", "TRAINING")):
            opps[label] = fx.create(OPP, {"name": f"SEC-001 {label} {fx.tag}",
                                          "user": {"id": users[label]["id"]},
                                          "ioetiBusinessLine": {"id": by_code[line]["id"]}})
        # write targets: the other user's opportunity (IOETI API) and a fixture line in "setup"
        # status that no test principal may read or write (native REST). Real versions are sent,
        # so a write evaluated with someone else's privileges would actually succeed.
        target_line = fx.create(BL, {"code": f"SEC001_{fx.tag.upper()}", "nameEn": "SEC-001 target",
                                     "nameAr": "هدف اختبار", "statusSelect": 1})
        expected = {
            "A": {"code": fx.passwords["A"][0], "lines": {"ISO9001"}, "opps": {opps["A"]["id"]}},
            "B": {"code": fx.passwords["B"][0], "lines": {"TRAINING"}, "opps": {opps["B"]["id"]}},
            "RO": {"code": fx.passwords["RO"][0], "lines": active, "opps": None},
        }
        all_opps = {o["id"] for o in opps.values()}

        def session(label):
            client = Client()
            if client.login(*fx.passwords[label]) != 200:
                raise SystemExit(f"login failed for test principal {label}")
            return client

        # --- checks per principal ------------------------------------------------------------------
        def check_user(label, client):
            exp = expected[label]
            status, body = client.call("GET", "/ws/ioeti/session")
            tally.record(label, "effective_identity", status != 200 or body.get("code") != exp["code"],
                         f"http={status} identity_matches={body.get('code') == exp['code']}")
            status, body = client.call("GET", "/ws/ioeti/business-lines")
            seen = {l["code"] for l in body.get("object") or []} if status == 200 else None
            tally.record(label, "ioeti_lines_scope", seen != exp["lines"],
                         f"http={status} extra={sorted((seen or set()) - exp['lines'])}"
                         f" missing={sorted(exp['lines'] - (seen or set()))}")
            # SEC-002: generic Axelor APIs are closed to non-maintenance users. Returned data means
            # the gate evaluated someone else's identity (or was bypassed).
            status, body = client.call("POST", f"/ws/rest/{BL}/search", {"fields": ["code"], "limit": 100})
            tally.record(label, "native_rest_refused", status != 403 or data(body) is not None,
                         f"http={status}")
            status, body = client.call("GET", "/ws/ioeti/opportunities?limit=50")
            if exp["opps"] is None:
                denied = status in (401, 403) or body.get("codeStatus") in (401, 403)
                tally.record(label, "opportunities_denied", not denied, f"http={status}")
            else:
                seen = ids_of(body) if status == 200 else None
                visible_tests = (seen or set()) & all_opps
                tally.record(label, "ioeti_opportunity_scope", visible_tests != exp["opps"],
                             f"http={status} foreign={len(visible_tests - exp['opps'])}")
            status, body = client.call("POST", f"/ws/rest/{OPP}/search",
                                       {"fields": ["name"], "limit": 100,
                                        "data": {"_domain": f"self.id in ({','.join(map(str, all_opps))})"}})
            tally.record(label, "native_rest_opportunity_refused",
                         status != 403 or data(body) is not None, f"http={status}")
            # denied writes, sent with the record's real version
            target = opps["B" if label == "A" else "A"]
            status, body = client.call("PUT", f"/ws/ioeti/opportunities/{target['id']}",
                                       {"name": "SEC-001 must not be saved", "version": target["version"]})
            tally.record(label, "denied_ioeti_write_refused",
                         status == 200 or body.get("codeStatus") == 200, f"http={status}")
            status, body = client.call("POST", f"/ws/rest/{BL}/{target_line['id']}",
                                       {"data": {"id": target_line["id"], "version": target_line["version"],
                                                 "nameEn": "SEC-001 must not be saved"}})
            tally.record(label, "denied_native_write_refused", ok(body), f"http={status}")

        def check_anonymous(client):
            status, body = client.call("GET", "/ws/public/app/info")
            tally.record("ANON", "public_info_has_no_identity",
                         "user" in body or "data" in body, f"http={status} keys={sorted(body)[:6]}")
            for path in ("/ws/ioeti/session", "/ws/ioeti/opportunities", "/ws/ioeti/business-lines"):
                status, body = client.call("GET", path)
                tally.record("ANON", "protected_refused", status not in (401, 403), f"{path} http={status}")

        def check_refused_session(label, client):
            status, body = client.call("GET", "/ws/ioeti/session")
            tally.record(label, "session_refused", status == 200, f"http={status}")
            status, body = client.call("GET", "/ws/ioeti/business-lines")
            tally.record(label, "data_refused", status == 200, f"http={status}")

        def provoke_errors(client):
            # malformed body, unknown action, invalid pagination: exceptional request paths
            client.call("POST", f"/ws/rest/{OPP}/search", {"fields": "not-a-list", "limit": "x"})
            client.call("POST", "/ws/action", {"action": "com.ioeti.does.not:exist", "data": {"context": {}}})
            client.call("GET", "/ws/ioeti/opportunities?limit=100000")

        # --- baseline (sequential) -----------------------------------------------------------------
        sessions = {label: session(label) for label in ("A", "B", "RO", "BLK", "OUT")}
        for label in ("A", "B", "RO"):
            check_user(label, sessions[label])
        check_anonymous(Client())
        baseline_leaks = dict(tally.leaks)
        report["baseline_leaks"] = baseline_leaks

        # block BLK while its session is live; log OUT out but keep its cookie
        status, body = admin.call("POST", f"/ws/rest/{USER}/{users['BLK']['id']}",
                                  {"data": {"id": users["BLK"]["id"], "version": users["BLK"]["version"],
                                            "blocked": True}})
        if not ok(body):
            raise SystemExit("could not block the BLK test user")
        sessions["OUT"].call("GET", "/logout")

        boundary_before = admin.call("GET", BOUNDARY)

        # --- concurrent phase ----------------------------------------------------------------------
        stop = threading.Event()
        errors = []

        def worker(label):
            try:
                client = session(label) if label in expected else (
                    Client() if label == "ANON" else sessions[label])
                n = 0
                while not stop.is_set():
                    if label in expected:
                        check_user(label, client)
                        if n % 5 == 0:
                            provoke_errors(client)
                    elif label == "ANON":
                        check_anonymous(client)
                    else:
                        check_refused_session(label, client)
                    n += 1
            except Exception as e:  # a crashed worker must fail the run, not hide leaks
                errors.append(f"{label}: {type(e).__name__}")

        threads = [threading.Thread(target=worker, args=(label,), daemon=True)
                   for label in ("A", "B", "RO", "ANON") for _ in range(WORKERS_PER_PRINCIPAL)]
        threads += [threading.Thread(target=worker, args=(label,), daemon=True) for label in ("BLK", "OUT")]
        started = time.monotonic()
        for t in threads:
            t.start()

        restore_results = []
        for i in range(RESTORES):
            admin.call("GET", "/ws/ioeti/business-lines")
            admin.call("POST", f"/ws/rest/{OPP}/search", {"fields": ["name"], "limit": 5})
            admin.call("POST", f"/ws/rest/{BL}/{by_code['ISO9001']['id']}",
                       {"data": {"id": by_code["ISO9001"]["id"], "code": "x"}})  # failing admin write
            restore_results.append(restore_all(admin, 900))
        # a reload whose client gives up after 2 s keeps running on its server thread; Axelor
        # refuses a concurrent reload, so retrying one until it succeeds proves it has finished
        restore_results.append(restore_all(admin, 2))
        deadline = time.monotonic() + 900
        while restore_all(admin, 900) is not True:
            if time.monotonic() > deadline:
                raise SystemExit("abandoned reload did not finish in time")
            time.sleep(1)
        reloads_done = time.monotonic()
        # keep traffic flowing on the (possibly polluted) pool after the last reload
        while time.monotonic() - reloads_done < MIN_SECONDS:
            admin.call("GET", "/ws/ioeti/business-lines")
        stop.set()
        for t in threads:
            t.join(timeout=120)
        report["restores_ok"] = restore_results
        report["concurrent_seconds"] = round(time.monotonic() - started, 1)
        report["worker_errors"] = errors

        # --- after: sequential pass and persisted state -----------------------------------------
        for label in ("A", "B", "RO"):
            check_user(label, session(label))
        _, after = admin.call("POST", f"/ws/rest/{OPP}/search",
                              {"fields": ["name", "version"],
                               "data": {"_domain": f"self.id in ({','.join(map(str, all_opps))})"}})
        names = {r["id"]: r["name"] for r in data(after) or []}
        unchanged = all(names.get(o["id"]) == o["name"] for o in opps.values())
        tally.record("ADMIN", "denied_writes_left_records_unchanged", not unchanged)
        _, line_now = admin.call("POST", f"/ws/rest/{BL}/{target_line['id']}/fetch",
                                 {"fields": ["nameEn", "version"]})
        row = (data(line_now) or [{}])[0]
        tally.record("ADMIN", "denied_native_write_left_line_unchanged",
                     row.get("nameEn") != "SEC-001 target" or row.get("version") != target_line["version"])

        boundary_after = admin.call("GET", BOUNDARY)
        # non-JAX-RS routes must pass through the boundary too (counter delta)
        probe_paths = ["/js/messages.js", "/login", "/index.html", "/callback"]
        before_routes = admin.call("GET", BOUNDARY)
        for path in probe_paths:
            try:
                urllib.request.urlopen(BASE + path, timeout=30).read()
            except Exception:
                pass
        after_routes = admin.call("GET", BOUNDARY)
        report["boundary"] = {
            "present": boundary_before[0] == 200,
            "before_load": boundary_before[1].get("object") if boundary_before[0] == 200 else None,
            "after_load": boundary_after[1].get("object") if boundary_after[0] == 200 else None,
        }
        if boundary_before[0] == 200:
            b0, b1 = before_routes[1]["object"], after_routes[1]["object"]
            report["boundary"]["non_jaxrs_requests_seen"] = b1["requests"] - b0["requests"] - 1
            tally.record("BOUNDARY", "covers_non_jaxrs_routes",
                         b1["requests"] - b0["requests"] - 1 < len(probe_paths))
            tally.record("BOUNDARY", "no_request_started_with_stale_identity",
                         boundary_after[1]["object"]["staleAtEntry"] != 0)

        report["checks"] = tally.checks
        report["leaks"] = tally.leaks
        report["leak_examples"] = tally.examples
        total = sum(tally.checks.values())
        leaked = sum(tally.leaks.values())
        report["summary"] = {"checks": total, "leaks": leaked}
        print("IDENTITY_PROBE", json.dumps(report["summary"]), "boundary", json.dumps(report["boundary"]))
        for key in sorted(tally.checks):
            print(f"{'LEAK' if tally.leaks.get(key) else 'PASS'} {key}: "
                  f"{tally.leaks.get(key, 0)}/{tally.checks[key]}")
        exit_code = 0 if leaked == 0 and not errors and all(r is True for r in restore_results[:-1]) else 1
    finally:
        done, count = fx.cleanup()
        report["cleanup"] = {"complete": done, "records": count}
        print("CLEANUP", "complete" if done else "INCOMPLETE", count)
        if not done:
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "identity-isolation-probe.json"), "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, default=str)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
