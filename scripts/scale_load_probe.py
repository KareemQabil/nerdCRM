#!/usr/bin/env python3
"""Scenario S6 (live): realistic data volume and a busy hour of concurrent users.

Run against a RUNNING local/CI Axelor; never against production. Fictional data only.
  seed      PROBE_SCALE_LEADS leads (default 5000) through the real intake API (each runs the Arabic duplicate
            check against everything the owner already has), from 8 sessions at once; and
            PROBE_SCALE_OPPS opportunities (default 1000) on one account (administrator fixtures)
  load      PROBE_SCALE_USERS sessions (default 20) each run PROBE_SCALE_REQUESTS requests (default 50) of a
            mix: Arabic search, paging deep into the list, the duplicate check, the sales report,
            Account 360 of the 1000-opportunity account, the opportunity list
  checks    no server error under load; every answer correct for its caller (RepB never sees RepA's
            leads); p95 per endpoint within PROBE_SCALE_P95_MS (default 2000 ms on a developer machine);
            the query plan of the search is recorded so an index decision rests on evidence
Report: logs/scale-load.json (latencies per endpoint, intake latency as the table grows, query plan).
The seeded rows are removed with SQL in the disposable database (TEST FIXTURE clean-up; local/CI only).
"""
import json
import os
import secrets
import statistics
import sys
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402
from db_migrate import DATABASE, psql  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PARTNER, SOURCE = "com.axelor.apps.base.db.Partner", "com.axelor.apps.base.db.Source"
LEAD, EVENT, OPP = "com.axelor.apps.crm.db.Lead", "com.axelor.apps.crm.db.Event", "com.axelor.apps.crm.db.Opportunity"
LINE = "com.ioeti.businessline.db.BusinessLine"
MK = "/ws/ioeti/marketing"
N_LEADS = int(os.environ.get("PROBE_SCALE_LEADS", "5000"))
N_OPPS = int(os.environ.get("PROBE_SCALE_OPPS", "1000"))
N_USERS = int(os.environ.get("PROBE_SCALE_USERS", "20"))
N_REQUESTS = int(os.environ.get("PROBE_SCALE_REQUESTS", "50"))
P95_MS = float(os.environ.get("PROBE_SCALE_P95_MS", "2000"))
FIRST = ["أحمد", "محمد", "مريم", "فاطمة", "يوسف", "نور", "سارة", "عمر", "هدى", "كريم"]
LAST = ["عبد الله", "حسن", "السيد", "إبراهيم", "مصطفى", "علي", "شريف", "منصور"]
ORGS = ["مصنع", "شركة", "مؤسسة", "مجموعة", "مستشفى", "مدرسة"]
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:400]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def admin_client():
    client = Client()
    assert client.login(os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin")),
                        os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
    return client


def obj(body):
    value = body.get("object") if isinstance(body, dict) else None
    return value if value is not None else {}


def pct(values, p):
    ordered = sorted(values)
    return round(ordered[min(len(ordered) - 1, int(round(p / 100 * (len(ordered) - 1))))], 1) if ordered else None


def timed(client, method, path, body=None):
    start = time.perf_counter()
    status, answer = client.call(method, path, body)
    return status, answer, (time.perf_counter() - start) * 1000


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

    report = {"leads": N_LEADS, "opportunities": N_OPPS, "users": N_USERS, "requestsPerUser": N_REQUESTS}
    line_id = None
    exit_code = 1
    try:
        line = create(LINE, {"code": f"S6L{tag}", "nameEn": f"S6 ISO {tag}", "nameAr": "خط تجريبي", "statusSelect": 2})
        line_id = line["id"]
        source = create(SOURCE, {"name": f"S6 web form {tag}"})
        account = create(PARTNER, {"name": f"S6 Big Account {tag}", "isCustomer": True, "partnerTypeSelect": 1})

        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"s6.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})

        rwc = dict(canRead=True, canWrite=True, canCreate=True)
        rep = [perm("lead", LEAD, "self.user = ?", **rwc), perm("event", EVENT, "self.user = ?", **rwc),
               perm("opp", OPP, "self.user = ?", **rwc), perm("partner", PARTNER, canRead=True),
               perm("line", LINE, canRead=True), perm("source", SOURCE, canRead=True)]
        group = create(GROUP, {"code": f"s6-rep-{tag}", "name": f"S6 rep {tag}", "permissions": [{"id": p["id"]} for p in rep]})
        users, passwords = {}, {}
        for label in ("RepA", "RepB"):
            passwords[label] = "S6!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"s6.{label.lower()}.{tag}", "name": f"S6 {label} {tag}", "blocked": False,
                                         "language": "en", "group": {"id": group["id"]}, "ioetiBusinessLines": [{"id": line_id}],
                                         "password": axelor_password_hash(passwords[label])})

        def session(label):
            c = Client()
            assert c.login(users[label]["code"], passwords[label]) == 200, label
            return c

        # --- seed: leads through the intake API --------------------------------------------------------------
        seeders = [session("RepA") for _ in range(8)]
        intake_ms, intake_status = [], []
        lock = threading.Lock()

        def seed(i):
            values = {"firstName": FIRST[i % len(FIRST)], "name": f"{LAST[(i // 10) % len(LAST)]} {i}",
                      "organization": f"{ORGS[i % len(ORGS)]} {i} {tag}", "email": f"lead{i}.{tag.lower()}@example.test",
                      "phone": f"+20 11{i:08d}", "businessLineCode": line["code"], "sourceId": source["id"]}
            status, _, ms = timed(seeders[i % len(seeders)], "POST", f"{MK}/leads", values)
            with lock:
                intake_status.append(status)
                intake_ms.append((i, ms))

        started = time.perf_counter()
        with ThreadPoolExecutor(max_workers=len(seeders)) as pool:
            list(pool.map(seed, range(N_LEADS)))
        seed_seconds = round(time.perf_counter() - started, 1)
        ordered = [ms for _, ms in sorted(intake_ms)]
        tenth = max(1, len(ordered) // 10)
        report["intake"] = {"seconds": seed_seconds, "first10pctP95": pct(ordered[:tenth], 95), "last10pctP95": pct(ordered[-tenth:], 95),
                            "p50": pct(ordered, 50), "p95": pct(ordered, 95), "max": pct(ordered, 100)}
        stored = int(psql(DATABASE, f"SELECT count(*) FROM crm_lead WHERE ioeti_business_line = {int(line_id)}").strip())
        check(f"seed: {N_LEADS} leads recorded through the intake API from 8 sessions (all 201, none lost); the duplicate check "
              f"stays fast as the owner's list grows (p95 first tenth vs last tenth recorded)",
              intake_status.count(201) == N_LEADS and stored == N_LEADS, f"{dict((s, intake_status.count(s)) for s in set(intake_status))} "
              f"stored={stored} {report['intake']}")
        b_lead = obj(session("RepB").call("POST", f"{MK}/leads", {"firstName": "سارة", "name": f"منصور B {tag}", "organization": f"مصنع B {tag}",
                                                                  "businessLineCode": line["code"]})[1])

        # --- seed: opportunities on one account (administrator fixtures) ----------------------------------------
        def opp(i):
            _, body = rest_create(admin, OPP, {"name": f"S6 deal {i} {tag}", "user": {"id": users["RepA"]["id"]},
                                               "partner": {"id": account["id"]}, "ioetiBusinessLine": {"id": line_id}})
            return ok(body)

        with ThreadPoolExecutor(max_workers=8) as pool:
            made = sum(pool.map(opp, range(N_OPPS)))
        check(f"seed: {N_OPPS} opportunities on one account", made == N_OPPS, made)

        # --- load: a busy hour ---------------------------------------------------------------------------------
        mix = [
            ("search", lambda i: f"{MK}/leads?" + urllib.parse.urlencode({"q": f"{FIRST[i % len(FIRST)]} {tag}"})),
            ("search-digits", lambda i: f"{MK}/leads?" + urllib.parse.urlencode({"q": f"{i * 37 % N_LEADS} {tag}"})),
            ("page-deep", lambda i: f"{MK}/leads?limit=100&offset={(i * 997) % max(1, N_LEADS - 100)}"),
            ("duplicates", None),
            ("sales-report", lambda i: f"/ws/ioeti/reports/sales?businessLine={line['code']}"),
            ("account360", lambda i: f"/ws/ioeti/workspace/account360/{account['id']}"),
            ("opportunities", lambda i: f"/ws/ioeti/opportunities?limit=50&offset={(i * 31) % max(1, N_OPPS - 50)}"),
        ]
        timings = {name: [] for name, _ in mix}
        statuses = {name: [] for name, _ in mix}
        wrong = []
        workers = [session("RepA") for _ in range(N_USERS - 1)] + [session("RepB")]

        def work(w):
            client = workers[w]
            for r in range(N_REQUESTS):
                i = w * N_REQUESTS + r
                name, path = mix[i % len(mix)]
                if name == "duplicates":
                    k = i % N_LEADS
                    status, body, ms = timed(client, "POST", f"{MK}/leads/duplicates",
                                             {"firstName": FIRST[k % len(FIRST)], "name": f"{LAST[(k // 10) % len(LAST)]} {k}",
                                              "organization": f"{ORGS[k % len(ORGS)]} {k} {tag}", "businessLineCode": line["code"]})
                else:
                    status, body, ms = timed(client, "GET", path(i))
                with lock:
                    timings[name].append(ms)
                    statuses[name].append(status)
                    rows = obj(body) if isinstance(obj(body), list) else []
                    if w == len(workers) - 1 and name in ("search", "search-digits", "page-deep", "duplicates") \
                            and any(row.get("id") != b_lead.get("id") for row in rows):
                        wrong.append((name, len(rows)))  # RepB must only ever see its own lead
                    if w == len(workers) - 1 and name in ("opportunities", "account360") and status == 200:
                        count = len(rows) if name == "opportunities" else \
                            {s["key"]: s["count"] for s in obj(body).get("sections", [])}.get("OPPORTUNITIES")
                        if count:
                            wrong.append((name, count))

        started = time.perf_counter()
        threads = [threading.Thread(target=work, args=(w,)) for w in range(len(workers))]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        load_seconds = round(time.perf_counter() - started, 1)
        report["load"] = {"seconds": load_seconds, "requests": sum(len(v) for v in timings.values()),
                          "endpoints": {n: {"p50": pct(v, 50), "p95": pct(v, 95), "max": pct(v, 100), "n": len(v),
                                            "statuses": sorted(set(statuses[n]))} for n, v in timings.items()}}
        print(json.dumps(report["load"], indent=1))
        errors = {n: [s for s in v if s >= 500] for n, v in statuses.items()}
        check(f"load: {N_USERS} sessions × {N_REQUESTS} requests at once → no server error, every request answered 200",
              all(set(v) == {200} for v in statuses.values()), {n: sorted(set(v)) for n, v in statuses.items()})
        check("load: scope holds under load (RepB sees only its own lead and none of RepA's 1000 opportunities)", not wrong, wrong[:10])
        slow = {n: pct(v, 95) for n, v in timings.items() if pct(v, 95) is None or pct(v, 95) > P95_MS}
        check(f"load: p95 of every endpoint within {P95_MS:.0f} ms", not slow and not any(errors.values()), slow)

        # --- evidence for the index decision -----------------------------------------------------------------
        plan = psql(DATABASE, "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT id FROM crm_lead WHERE ioeti_search_key LIKE "
                              f"'%{FIRST[1]}%' AND ioeti_search_key LIKE '%{tag.lower()}%' ORDER BY id DESC LIMIT 25")
        report["searchPlan"] = plan.splitlines()
        report["leadRows"] = int(psql(DATABASE, "SELECT count(*) FROM crm_lead").strip())
        print("\n".join(plan.splitlines()[:12]))

        failed = [r for r in RESULTS if r["result"] != "PASS"]
        print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
        exit_code = 0 if not failed else 1
    finally:
        complete, leftovers = False, []
        try:
            if line_id:
                # TEST FIXTURE clean-up in the disposable database: thousands of seeded rows, removed in one statement each
                psql(DATABASE, f"""
                    CREATE TEMP TABLE s6_leads ON COMMIT DROP AS SELECT id, email_address FROM crm_lead WHERE ioeti_business_line = {int(line_id)};
                    DELETE FROM crm_lead WHERE id IN (SELECT id FROM s6_leads);
                    DELETE FROM message_email_address WHERE id IN (SELECT email_address FROM s6_leads);
                    DELETE FROM crm_opportunity WHERE ioeti_business_line = {int(line_id)};
                """, single_transaction=True)
            complete, leftovers = cleanup(admin, created, {PARTNER: 1, SOURCE: 1, USER: 2, GROUP: 3, PERM: 4, LINE: 5})
        finally:
            if not complete:
                print(f"FAIL cleanup left {leftovers}")
                exit_code = 1
            os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
            with open(os.path.join(ROOT, "logs", "scale-load.json"), "w", encoding="utf-8") as f:
                json.dump({"results": RESULTS, "report": report, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
