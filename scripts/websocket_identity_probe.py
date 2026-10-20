#!/usr/bin/env python3
"""SEC-001 residual (issue #10): identity isolation on the WebSocket surface.

AOP 8.2.5 runs WebSocket messages on Tomcat threads outside the servlet filters. The handshake
captures the HTTP session's Shiro subject, and `WebSocketSecurityInterceptor` binds that subject
for each message. The native `tags` channel answers with per-user counts (`TaskController.countTasks`
reads `AuthUtils.getUser()`), so each answer shows exactly which identity the server used.

Fixtures: users A, B and C have 3, 5 and 2 open team tasks due today; the counts are their identity
fingerprints. Under load (A and B WebSocket loops in parallel with HTTP traffic of the same users on
the same Tomcat threads, and admin metadata reloads, the trigger of the original SEC-001 leak), every
answer must carry the asking user's own count.

Also checked: anonymous handshake refused; C's already-open WebSocket is closed once C logs out over HTTP
(IOETI WebSocketSessionGuard; AOP alone kept answering); a new handshake with the old cookie is refused;
the HTTP identity boundary still sees no stale identity at request entry.
Scheduled jobs: the diagnostic job com.ioeti.core.security.JobIdentityProbe runs every 2 s during the load
on Quartz pool threads; every run must see no user (AOP sets none for scheduled jobs). Needs
quartz.enable=true (AXELOR_CONFIG_QUARTZ_ENABLE=true); otherwise reported as SKIPPED, or failed when
PROBE_REQUIRE_JOBS=1.
--expiry (instance started with session.timeout=1): an idle open WebSocket is closed after the session
expires. Env: PROBE_WS_SECONDS (default 30), PROBE_RESTORES (default 1), PROBE_REQUIRE_JOBS,
PROBE_WS_EXPIRY_WAIT (default 80). Report: logs/websocket-identity-probe.json.
"""
import datetime
import json
import os
import secrets
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import BASE, ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from identity_isolation_probe import restore_all  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402
from ws_client import WebSocket, cookie_header  # noqa: E402

USER, GROUP, TASK = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.team.db.TeamTask"
SCHEDULE = "com.axelor.meta.db.MetaSchedule"
JOB_CLASS = "com.ioeti.core.security.JobIdentityProbe"
REQUIRE_JOBS = os.environ.get("PROBE_REQUIRE_JOBS") == "1"  # CI starts Axelor with quartz.enable=true
WS_URL = BASE.replace("http://", "ws://").replace("https://", "wss://") + "/websocket"
BOUNDARY = "/ws/ioeti/security/identity-boundary"
SECONDS = int(os.environ.get("PROBE_WS_SECONDS", "30"))
RESTORES = int(os.environ.get("PROBE_RESTORES", "1"))
FINGERPRINT = {"A": 3, "B": 5, "C": 2}
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:300]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def tasks_count(ws):
    ws.send_json({"type": "MSG", "channel": "tags", "data": []})
    reply = ws.recv_json()
    if reply is None:
        return None
    return (((reply.get("data") or {}).get("values") or {}).get("tasks") or {}).get("current")


def expiry_mode(admin):
    """Disposable instance started with session.timeout=1 (minute): an idle WebSocket must be closed once
    its HTTP session has expired, instead of answering for an expired login."""
    tag = secrets.token_hex(3)
    created = []
    exit_code = 1
    try:
        _, body = rest_create(admin, GROUP, {"code": f"wsexp-{tag}", "name": f"WS expiry {tag}"})
        created.append((GROUP, body["data"][0]["id"]))
        password = "Ws!" + secrets.token_urlsafe(14)
        _, body = rest_create(admin, USER, {"code": f"wsexp.{tag}", "name": "WS expiry", "blocked": False,
                                            "language": "en", "group": {"id": created[0][1]},
                                            "password": axelor_password_hash(password)})
        created.append((USER, body["data"][0]["id"]))
        user = Client()
        assert user.login(f"wsexp.{tag}", password) == 200
        ws = WebSocket(WS_URL, cookie_header(user))
        ws.send_json({"type": "SUB", "channel": "tags"})
        check("before expiry: the WebSocket answers", tasks_count(ws) == 0)
        wait = int(os.environ.get("PROBE_WS_EXPIRY_WAIT", "80"))
        print(f"waiting {wait} s for the 1-minute session to expire (no HTTP traffic for this user)")
        time.sleep(wait)
        try:
            answer = tasks_count(ws)
        except (ConnectionError, OSError) as e:
            answer = f"closed: {e}"
        check("after session expiry, the open WebSocket is closed and returns no data",
              answer is None or str(answer).startswith("closed"), answer)
        ws.close()
        exit_code = 0 if all(r["result"] != "FAIL" for r in RESULTS) else 1
    finally:
        # the admin session expired during the wait too: clean up with a fresh one
        admin = admin_login()
        complete, leftovers = cleanup(admin, created, {USER: 1, GROUP: 2})
        if not complete:
            print(f"FAIL cleanup left {leftovers}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "websocket-expiry-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2)
    return exit_code


def admin_login():
    admin = Client()
    assert admin.login(os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin")),
                       os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
    return admin


def main():
    admin = admin_login()
    if "--expiry" in sys.argv:
        return expiry_mode(admin)
    tag = secrets.token_hex(3)
    created = []

    def create(model, values):
        _, body = rest_create(admin, model, values)
        if not ok(body):
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}: {json.dumps(body)[:200]}")
        created.append((model, body["data"][0]["id"]))
        return body["data"][0]

    exit_code = 1
    sockets = []
    try:
        group = create(GROUP, {"code": f"wsprobe-{tag}", "name": f"WS probe {tag}"})
        today = datetime.date.today().isoformat()
        sessions, users = {}, {}
        for label, count in FINGERPRINT.items():
            password = "Ws!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"wsprobe.{label.lower()}.{tag}", "name": f"WS probe {label}",
                                         "blocked": False, "language": "en", "group": {"id": group["id"]},
                                         "password": axelor_password_hash(password)})
            for i in range(count):
                create(TASK, {"name": f"WS probe {label} task {i} {tag}", "assignedTo": {"id": users[label]["id"]},
                              "status": "new", "taskDate": today})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label

        # --- handshake ---------------------------------------------------------------------------------
        try:
            WebSocket(WS_URL, "")
            anonymous = "accepted"
        except ConnectionError as e:
            anonymous = str(e)
        check("anonymous WebSocket handshake refused", anonymous != "accepted", anonymous)

        sockets_by_user = {label: WebSocket(WS_URL, cookie_header(sessions[label])) for label in FINGERPRINT}
        sockets.extend(sockets_by_user.values())
        for ws in sockets_by_user.values():
            ws.send_json({"type": "SUB", "channel": "tags"})
        baseline = {label: tasks_count(ws) for label, ws in sockets_by_user.items()}
        check("baseline: each WebSocket answers with its own user's fingerprint",
              baseline == FINGERPRINT, baseline)

        # --- scheduled job: started before the load, read after it -------------------------------------------
        schedule = create(SCHEDULE, {"name": f"ioeti-job-identity-probe-{tag}", "job": JOB_CLASS,
                                     "cron": "0/2 * * * * ?", "active": True})
        _, scheduled = admin.call("POST", "/ws/action", {"action": "com.axelor.meta.web.JobController:update",
                                                        "data": {"context": {"_model": SCHEDULE, **schedule}}})
        scheduler_on = ok(scheduled) and not any("error" in (r or {}) for r in (scheduled.get("data") or [])
                                                 if isinstance(r, dict))

        # --- load: WebSocket loops + same users' HTTP traffic + admin metadata reloads ----------------------
        _, before = admin.call("GET", BOUNDARY)
        stop = time.monotonic() + SECONDS
        counts = {"A": 0, "B": 0}
        leaks = []
        http_requests = [0]
        lock = threading.Lock()

        def ws_loop(label):
            ws = sockets_by_user[label]
            while time.monotonic() < stop:
                seen = tasks_count(ws)
                with lock:
                    counts[label] += 1
                    if seen != FINGERPRINT[label]:
                        leaks.append((label, seen))

        def http_loop(label):
            while time.monotonic() < stop:
                sessions[label].call("GET", "/ws/ioeti/session")
                with lock:
                    http_requests[0] += 1

        def reload_loop():
            for _ in range(RESTORES):
                if time.monotonic() >= stop:
                    break
                restore_all(admin, timeout=max(30, int(stop - time.monotonic()) + 60))

        threads = ([threading.Thread(target=ws_loop, args=(label,)) for label in ("A", "B")]
                   + [threading.Thread(target=http_loop, args=(label,)) for label in ("A", "B") for _ in range(2)]
                   + [threading.Thread(target=reload_loop)])
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        _, after = admin.call("GET", BOUNDARY)
        total = counts["A"] + counts["B"]
        check(f"under load: every WebSocket answer used the asking user's identity "
              f"({total} messages, {http_requests[0]} concurrent HTTP requests, {RESTORES} metadata reload(s))",
              total > 0 and not leaks, leaks[:10])
        stale = ((after.get("object") or after).get("staleAtEntry") if isinstance(after, dict) else None)
        check("HTTP identity boundary: no request started with a stale identity during the run",
              stale == 0, {"before": before.get("object") if isinstance(before, dict) else before,
                           "after": after.get("object") if isinstance(after, dict) else after})

        jobs = ((after.get("object") or {}).get("scheduledJobProbe") or {}) if isinstance(after, dict) else {}
        if scheduler_on or REQUIRE_JOBS:
            check(f"scheduled job ran on Quartz threads during the load and never saw a user "
                  f"({jobs.get('runs')} runs)",
                  (jobs.get("runs") or 0) > 0 and jobs.get("runsWithUser") == 0, jobs)
        else:
            RESULTS.append({"check": "scheduled-job identity", "result": "SKIPPED",
                            "detail": "scheduler disabled (quartz.enable=false)"})
            print("SKIPPED scheduled-job identity: scheduler disabled (quartz.enable=false)")
        schedule_now = admin.call("POST", f"/ws/rest/{SCHEDULE}/{schedule['id']}/fetch", {"fields": ["version"]})[1]
        version = ((schedule_now.get("data") or [{}])[0]).get("version")
        admin.call("POST", f"/ws/rest/{SCHEDULE}/{schedule['id']}", {"data": {"id": schedule["id"], "version": version,
                                                                         "active": False}})
        admin.call("POST", "/ws/action", {"action": "com.axelor.meta.web.JobController:update",
                                          "data": {"context": {"_model": SCHEDULE, **schedule, "active": False,
                                                               "version": (version or 0) + 1}}})

        # --- logout --------------------------------------------------------------------------------------
        sessions["C"].call("GET", "/logout")
        try:
            after_logout = tasks_count(sockets_by_user["C"])
        except (ConnectionError, OSError) as e:
            after_logout = f"closed: {e}"
        # AOP alone kept answering here (seen before WebSocketSessionGuard); IOETI closes the socket
        check("after logout, C's already-open WebSocket is closed and returns no data",
              after_logout is None or str(after_logout).startswith("closed"), after_logout)
        try:
            WebSocket(WS_URL, cookie_header(sessions["C"]))
            new_after_logout = "accepted"
        except ConnectionError as e:
            new_after_logout = str(e)
        check("after logout, a new WebSocket handshake with the old cookie is refused",
              new_after_logout != "accepted", new_after_logout)

        failed = [r for r in RESULTS if r["result"] == "FAIL"]
        passed = [r for r in RESULTS if r["result"] == "PASS"]
        print(f"\n{len(passed)}/{len(passed) + len(failed)} checks passed")
        exit_code = 0 if not failed else 1
    finally:
        for ws in sockets:
            ws.close()
        complete, leftovers = cleanup(admin, created, {SCHEDULE: 0, TASK: 0, USER: 1, GROUP: 2})
        if not complete:
            print(f"FAIL cleanup left {leftovers}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "websocket-identity-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
