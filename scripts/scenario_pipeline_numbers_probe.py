#!/usr/bin/env python3
"""Scenario S8 (live): the pipeline numbers agree everywhere, for every caller, with a real company's history.

Run against a RUNNING local/CI Axelor; never against production. Roles are TEST FIXTURES built from native permissions
(D-07 defines the real ones). Every person and record is fictional and removed afterwards.
A company that has sold for a while has hundreds of closed opportunities. This scenario gives two business lines that
history and checks that the board, the sales report and the list say the same thing as the records, per caller:
  RepA, RepB  own scope on line L1 (RepA also has two opportunities on L2); RepC own scope on L2
  LineMgr     line scope (member of L1); Head  all scope
  data        L1: 48 open (four stages, EGP and USD, some without a close date), 4 won and 3 lost recently, and 1,000 lost
              four months ago (their dates set by SQL: TEST FIXTURE standing in for history); L2: 12 open + RepA's 2
Checks:
  1 the board shows every open opportunity the caller may read, the recent won and lost, and none of the old history;
    the line and "mine" filters hold
  2 every board column total (per currency) is exactly the sum of its cards, and equals the sales report's open stages
  3 the sales report counts every stage per caller, history included
  4 drag race: the owner and the line manager move the same card to different stages at the same moment → one move,
    the other 409; the totals follow the winner exactly
  5 a card marked lost leaves its column and joins "lost" in both the board and the report, amount for amount
  6 the line manager is moved from L1 to L2 mid-session; the next request shows L2 only and an L1 card answers 404
  7 a card handed from RepA to RepB moves between their boards on the next request
  8 the list pages through every readable opportunity once, without gaps or repeats
  9 search finds the oldest of 1,050 accounts (another spelling, Arabic-Indic digits) and the oldest opportunity
Report: logs/scenario-pipeline-numbers.json.
"""
import json
import os
import secrets
import sys
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from decimal import Decimal
from urllib.parse import quote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402
from db_migrate import DATABASE, psql  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PARTNER, CURRENCY = "com.axelor.apps.base.db.Partner", "com.axelor.apps.base.db.Currency"
OPP, LOST_REASON = "com.axelor.apps.crm.db.Opportunity", "com.axelor.apps.crm.db.LostReason"
LINE, MESSAGE = "com.ioeti.businessline.db.BusinessLine", "com.axelor.mail.db.MailMessage"
OPPS, REPORT, SEARCH = "/ws/ioeti/opportunities", "/ws/ioeti/reports/sales", "/ws/ioeti/workspace/search"
HISTORY = int(os.environ.get("PROBE_PIPELINE_HISTORY", "1000"))
ACCOUNTS = int(os.environ.get("PROBE_SEARCH_ACCOUNTS", "1050"))
ROUNDS = int(os.environ.get("PROBE_SCENARIO_ROUNDS", "3"))
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:400]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def obj(body):
    return (body.get("object") if isinstance(body, dict) else None) or {}


def rows(body):
    value = body.get("object") if isinstance(body, dict) else None
    return value if isinstance(value, list) else []


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


def totals(cards):
    """(stageId, currency) → (count, sum) over the given opportunity views."""
    out = defaultdict(lambda: [0, Decimal(0)])
    for o in cards:
        key = (o["stageId"], o.get("currencyCode"))
        out[key][0] += 1
        out[key][1] += Decimal(str(o["amount"])) if o.get("amount") is not None else Decimal(0)
    return {k: (v[0], v[1]) for k, v in out.items()}


def main():
    credentials = (os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin")),
                   os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin")))
    admin = Client()
    assert admin.login(*credentials) == 200
    tag = secrets.token_hex(3).upper()
    created = []
    lock = threading.Lock()

    def create(model, values, client=None):
        _, body = rest_create(client or admin, model, values)
        if not ok(body):
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}: {json.dumps(body)[:300]}")
        with lock:
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

    exit_code = 1
    users, opp_ids = {}, []
    try:
        cur = {c["codeISO"]: c["id"] for c in search(CURRENCY, "self.codeISO IN ('EGP', 'USD')", ("codeISO",))}
        _, b = admin.call("GET", OPPS + "/stages")
        stages = rows(b)
        open_stages = [s["id"] for s in stages if s["kind"] == "OPEN"]
        won = next(s["id"] for s in stages if s["kind"] == "WON")
        lost = next(s["id"] for s in stages if s["kind"] == "LOST")
        today = date.today()
        l1 = create(LINE, {"code": f"PN1{tag}", "nameEn": f"Numbers line one {tag}", "nameAr": "خط الأرقام الأول", "statusSelect": 2})
        l2 = create(LINE, {"code": f"PN2{tag}", "nameEn": f"Numbers line two {tag}", "nameAr": "خط الأرقام الثاني", "statusSelect": 2})
        account = create(PARTNER, {"name": f"عميل الأرقام {tag}", "isProspect": True, "partnerTypeSelect": 1})
        reason = create(LOST_REASON, {"name": f"Price {tag}"})

        def perm(name, model, condition=None, params=None, **rights):
            return create(PERM, {"name": f"pn.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": params} if condition else {})})
        common = [perm(f"{k}.line", LINE, canRead=True) for k in ("own", "line", "all")]
        common_partner = [perm(f"{k}.partner", PARTNER, canRead=True) for k in ("own", "line", "all")]
        common_reason = [perm(f"{k}.reason", LOST_REASON, canRead=True) for k in ("own", "line", "all")]
        scope = {"own": perm("own.opp", OPP, "self.user = ?", "__user__", canRead=True, canWrite=True),
                 "line": perm("line.opp", OPP, "self.ioetiBusinessLine in (?)", "__user__.ioetiBusinessLines", canRead=True, canWrite=True),
                 "all": perm("all.opp", OPP, canRead=True, canWrite=True)}
        groups = {k: create(GROUP, {"code": f"pn-{k}-{tag}", "name": f"Pipeline numbers {k} {tag}",
                                    "permissions": [{"id": p["id"]} for p in (scope[k], common[i], common_partner[i], common_reason[i])]})
                  for i, k in enumerate(("own", "line", "all"))}
        sessions = {}
        for label, group, lines in (("RepA", "own", [l1]), ("RepB", "own", [l1]), ("RepC", "own", [l2]),
                                    ("LineMgr", "line", [l1]), ("Head", "all", [l1, l2])):
            password = "Pn!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"pn.{label.lower()}.{tag}", "name": f"Numbers {label} {tag}", "blocked": False,
                                         "language": "ar", "group": {"id": groups[group]["id"]}, "password": axelor_password_hash(password),
                                         "ioetiBusinessLines": [{"id": x["id"]} for x in lines]})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        uid = {k: u["id"] for k, u in users.items()}

        # --- the records: a spec the checks compare against, independent of the server ------------------------------
        spec = []
        for i in range(48):
            spec.append({"name": f"PN open {i} {tag}", "line": l1, "owner": "RepB" if i % 3 == 0 else "RepA",
                         "stage": open_stages[i % len(open_stages)], "currency": "USD" if i % 4 == 0 else "EGP",
                         "amount": Decimal(1000 * (i + 1)) + Decimal(i % 7) / 4,
                         "close": None if i % 6 == 0 else (today + timedelta(days=i * 5)).isoformat(), "kind": "OPEN"})
        for i in range(12):
            spec.append({"name": f"PN two {i} {tag}", "line": l2, "owner": "RepC", "stage": open_stages[i % len(open_stages)],
                         "currency": "EGP", "amount": Decimal(500 * (i + 1)), "close": (today + timedelta(days=i)).isoformat(), "kind": "OPEN"})
        for i in range(2):
            spec.append({"name": f"PN two RepA {i} {tag}", "line": l2, "owner": "RepA", "stage": open_stages[0], "currency": "EGP",
                         "amount": Decimal(777), "close": None, "kind": "OPEN"})
        for i in range(4):
            spec.append({"name": f"PN won {i} {tag}", "line": l1, "owner": "RepA", "stage": won, "currency": "EGP",
                         "amount": Decimal(20000 + i), "close": (today - timedelta(days=i)).isoformat(), "kind": "WON"})
        for i in range(3):
            spec.append({"name": f"PN lost {i} {tag}", "line": l1, "owner": "RepB", "stage": lost, "currency": "EGP",
                         "amount": Decimal(3000 + i), "close": (today - timedelta(days=i)).isoformat(), "kind": "LOST"})
        for i in range(HISTORY):
            spec.append({"name": f"PN history {i} {tag}", "line": l1, "owner": "RepA", "stage": lost, "currency": "EGP",
                         "amount": Decimal(100 + i), "close": (today - timedelta(days=150 + i % 30)).isoformat(), "kind": "OLD"})

        local = threading.local()

        def make(s):
            if not hasattr(local, "client"):
                local.client = Client()
                assert local.client.login(*credentials) == 200
            row = create(OPP, {"name": s["name"], "user": {"id": uid[s["owner"]]}, "ioetiBusinessLine": {"id": s["line"]["id"]},
                               "partner": {"id": account["id"]}, "opportunityStatus": {"id": s["stage"]}, "amount": str(s["amount"]),
                               "currency": {"id": cur[s["currency"]]}, **({"expectedCloseDate": s["close"]} if s["close"] else {})},
                         client=local.client)
            s["id"] = row["id"]
        with ThreadPoolExecutor(8) as pool:
            list(pool.map(make, spec))
        opp_ids = [s["id"] for s in spec]
        old = [s["id"] for s in spec if s["kind"] == "OLD"]
        # TEST FIXTURE: history from four months ago (the API cannot backdate a record)
        psql(DATABASE, "UPDATE crm_opportunity SET created_on = now() - interval '120 days', updated_on = now() - interval '120 days' "
                       f"WHERE id IN ({','.join(map(str, old))});")
        by_id = {s["id"]: s for s in spec}

        def readable(label, s):
            if label == "Head":
                return True
            if label == "LineMgr":
                return s["line"]["id"] == current_line["LineMgr"]
            return s["owner"] == label

        current_line = {"LineMgr": l1["id"]}

        def expected_board(label, line=None, mine=False):
            return {s["id"] for s in spec if s["kind"] != "OLD" and readable(label, s)
                    and (line is None or s["line"]["id"] == line["id"]) and (not mine or s["owner"] == label)}

        def board(label, line=None, mine=False):
            q = "&".join(x for x in ((f"line={line['code']}" if line else ""), ("mine=true" if mine else "")) if x)
            s_, b_ = sessions[label].call("GET", OPPS + "/board" + (f"?{q}" if q else ""))
            return s_, rows(b_)

        def spec_view(ids):
            return [{"stageId": by_id[i]["stage"], "currencyCode": by_id[i]["currency"], "amount": by_id[i]["amount"]} for i in ids]

        # --- 1 board completeness ----------------------------------------------------------------------------------------
        cases = [("RepA", None, False), ("RepB", None, False), ("RepC", None, False), ("LineMgr", None, False),
                 ("Head", l1, False), ("Head", l2, False), ("RepA", l2, False), ("RepA", None, True), ("LineMgr", None, True)]
        outcome = []
        for label, line, mine in cases:
            s_, cards = board(label, line, mine)
            got = {c["opportunity"]["id"] for c in cards}
            want = expected_board(label, line, mine)
            outcome.append((label, line and line["code"][:3], mine, s_, len(got), len(want), len(want - got), len(got - want)))
        check(f"board: every caller sees every open opportunity they may read plus the recent won and lost, none of the {HISTORY} "
              "closed four months ago; the line and mine filters hold",
              all(o[3] == 200 and o[6] == 0 and o[7] == 0 for o in outcome), [o for o in outcome if o[3] != 200 or o[6] or o[7]] or outcome)

        # --- 2 + 3 board totals, report, records agree --------------------------------------------------------------------
        def report(label, line):
            s_, b_ = sessions[label].call("GET", f"{REPORT}?businessLine={line['code']}")
            out = {}
            for r in (obj(b_).get("pipeline") or []):
                for a in r["amounts"] or [{"currency": None, "amount": 0}]:
                    out[(r["stage"], a["currency"])] = Decimal(str(a["amount"]))
                out[(r["stage"], "#")] = r["count"]
            return s_, out
        names = {s["id"]: s["name"] for s in stages}

        def report_expected(label, line):
            out = defaultdict(Decimal)
            for s in spec:
                if readable(label, s) and s["line"]["id"] == line["id"]:
                    out[(names[s["stage"]], s["currency"])] += s["amount"]
                    out[(names[s["stage"]], "#")] += 1
            return dict(out)

        def agree(label, line):
            _, cards = board(label, line)
            ids = {c["opportunity"]["id"] for c in cards}
            board_totals = totals([c["opportunity"] for c in cards])
            want_totals = totals(spec_view(expected_board(label, line)))
            s_, rep = report(label, line)
            rep_want = report_expected(label, line)
            open_names = {names[i] for i in open_stages}
            board_open = {(names[k[0]], k[1]): v[1] for k, v in board_totals.items() if k[0] in open_stages}
            rep_open = {k: v for k, v in rep.items() if k[0] in open_names and k[1] != "#"}
            return {"board_ok": board_totals == want_totals and ids == expected_board(label, line), "report_ok": s_ == 200 and rep == rep_want,
                    "board_eq_report": board_open == rep_open, "lost_count": rep.get((names[lost], "#"))}
        agreement = {f"{label}:{line['code'][:3]}": agree(label, line)
                     for label, line in (("RepA", l1), ("RepB", l1), ("LineMgr", l1), ("Head", l1), ("Head", l2), ("RepC", l2))}
        check("board column totals per currency are exactly the sum of the records, and the board's open stages equal the sales report's",
              all(a["board_ok"] and a["board_eq_report"] for a in agreement.values()), agreement)
        check(f"sales report: every stage per caller and currency is exact, history included (lost on L1: RepA {HISTORY}, RepB 3, "
              f"line manager {HISTORY + 3})",
              all(a["report_ok"] for a in agreement.values()) and agreement[f"RepA:{l1['code'][:3]}"]["lost_count"] == HISTORY
              and agreement[f"RepB:{l1['code'][:3]}"]["lost_count"] == 3 and agreement[f"LineMgr:{l1['code'][:3]}"]["lost_count"] == HISTORY + 3,
              agreement)

        # --- 4 drag race --------------------------------------------------------------------------------------------------
        race = []
        candidates = [s for s in spec if s["kind"] == "OPEN" and s["owner"] == "RepA" and s["line"] is l1]
        for r in range(ROUNDS):
            s = candidates[r]
            _, b = sessions["RepA"].call("GET", f"{OPPS}/{s['id']}")
            v = obj(b).get("version")
            a_target, m_target = [x for x in open_stages if x != s["stage"]][:2]
            res = together([lambda: sessions["RepA"].call("POST", f"{OPPS}/{s['id']}/stage", {"version": v, "stageId": a_target}),
                            lambda: sessions["LineMgr"].call("POST", f"{OPPS}/{s['id']}/stage", {"version": v, "stageId": m_target})])
            codes = [x[0] for x in res]
            winner = a_target if codes[0] == 200 else m_target if codes[1] == 200 else None
            _, b = admin.call("GET", f"{OPPS}/{s['id']}")
            if winner:
                s["stage"] = winner
            race.append((sorted(codes), obj(b).get("stageId") == winner))
        after = agree("LineMgr", l1)
        check(f"drag race ({ROUNDS} rounds): the owner and the line manager move the same card at once → one move, the other 409; "
              "board and report follow the winner exactly",
              all(c == [200, 409] and same for c, same in race) and after["board_ok"] and after["report_ok"] and after["board_eq_report"],
              (race, after))

        # --- 5 lost moves between columns ---------------------------------------------------------------------------------
        s = candidates[ROUNDS]
        _, b = sessions["RepA"].call("GET", f"{OPPS}/{s['id']}")
        st, _ = sessions["RepA"].call("POST", f"{OPPS}/{s['id']}/lose", {"version": obj(b).get("version"), "lostReasonId": reason["id"], "note": "price"})
        s["stage"], s["kind"] = lost, "LOST"
        after = {k: agree(k, l1) for k in ("RepA", "LineMgr")}
        check("marking a card lost moves it from its column to lost in the board and the report, amount for amount",
              st == 200 and all(a["board_ok"] and a["report_ok"] and a["board_eq_report"] for a in after.values())
              and after["LineMgr"]["lost_count"] == HISTORY + 4, (st, after))

        # --- 6 line manager moved mid-session -----------------------------------------------------------------------------
        update(USER, uid["LineMgr"], {"ioetiBusinessLines": [{"id": l2["id"]}]})
        current_line["LineMgr"] = l2["id"]
        s_, cards = board("LineMgr")
        got = {c["opportunity"]["id"] for c in cards}
        gone, _ = sessions["LineMgr"].call("GET", f"{OPPS}/{candidates[0]['id']}")
        check("the line manager moved from L1 to L2 mid-session: the next board shows L2 exactly, and an L1 card answers 404",
              s_ == 200 and got == expected_board("LineMgr") and gone == 404, (s_, len(got), len(expected_board("LineMgr")), gone))

        # --- 7 card handed to another owner -------------------------------------------------------------------------------
        s = candidates[ROUNDS + 1]
        update(OPP, s["id"], {"user": {"id": uid["RepB"]}})
        s["owner"] = "RepB"
        a_cards = {c["opportunity"]["id"] for c in board("RepA")[1]}
        b_cards = {c["opportunity"]["id"] for c in board("RepB")[1]}
        check("a card handed from RepA to RepB leaves RepA's board and appears on RepB's on the next request",
              s["id"] not in a_cards and s["id"] in b_cards and a_cards == expected_board("RepA") and b_cards == expected_board("RepB"),
              (s["id"] in a_cards, s["id"] in b_cards))

        # --- 9 search finds the oldest record as surely as the newest ----------------------------------------------------
        names_made = []

        def make_account(i):
            if not hasattr(local, "client"):
                local.client = Client()
                assert local.client.login(*credentials) == 200
            row = create(PARTNER, {"name": f"شركة الأمل {tag} رقم {i}", "isProspect": True, "partnerTypeSelect": 1}, client=local.client)
            names_made.append((i, row["id"]))
        with ThreadPoolExecutor(8) as pool:
            list(pool.map(make_account, range(ACCOUNTS)))
        oldest_account = min(names_made)[1]
        oldest = min((s for s in spec if s["kind"] == "OLD"), key=lambda s: s["id"])
        oldest_opp, oldest_number = oldest["id"], oldest["name"].split()[2]

        def hits(label, q):
            s_, b_ = sessions[label].call("GET", f"{SEARCH}?q={quote(q)}")
            return s_, {(h["type"], h["id"]) for h in rows(b_)}
        # another spelling (taa marbuta, hamza) and Arabic-Indic digits, as a person would type it
        s1, h1 = hits("RepA", f"شركه الامل {tag.lower()} رقم ٠")
        s2, h2 = hits("RepA", f"history {oldest_number} {tag}")
        s3, h3 = hits("RepB", f"history {oldest_number} {tag}")
        check(f"search finds the oldest of {ACCOUNTS} accounts (typed with another spelling and Arabic-Indic digits) and the oldest of "
              f"{HISTORY} opportunities; a person who may not read the opportunity does not find it",
              s1 == s2 == s3 == 200 and ("ACCOUNT", oldest_account) in h1 and ("OPPORTUNITY", oldest_opp) in h2 and ("OPPORTUNITY", oldest_opp) not in h3,
              (s1, len(h1), ("ACCOUNT", oldest_account) in h1, s2, ("OPPORTUNITY", oldest_opp) in h2, ("OPPORTUNITY", oldest_opp) in h3))

        # --- 8 the list pages through everything once ---------------------------------------------------------------------
        seen, offset = [], 0
        while True:
            s_, b = sessions["RepA"].call("GET", f"{OPPS}?limit=50&offset={offset}")
            page = rows(b)
            seen.extend(o["id"] for o in page)
            if s_ != 200 or len(page) < 50:
                break
            offset += 50
        want = {s["id"] for s in spec if s["owner"] == "RepA"}
        check(f"RepA's list pages through all {len(want)} of their opportunities (history included) once, without gaps or repeats",
              s_ == 200 and len(seen) == len(set(seen)) and set(seen) == want, (s_, len(seen), len(set(seen)), len(want)))

        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
    finally:
        if opp_ids:
            psql(DATABASE, f"DELETE FROM mail_message WHERE related_model = '{OPP}' AND related_id IN ({','.join(map(str, opp_ids))});")
        order = {OPP: 1, PARTNER: 5, LOST_REASON: 5, USER: 6, GROUP: 7, PERM: 8, LINE: 12}
        complete, left = cleanup(admin, list(dict.fromkeys(created)), order)
        if not complete:
            print(f"FAIL cleanup left {left[:10]}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "scenario-pipeline-numbers.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
