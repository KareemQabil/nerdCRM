#!/usr/bin/env python3
"""Quality issues and corrective actions: live probe against a RUNNING local/CI Axelor; never against
production. Roles are TEST FIXTURES from native permissions: two quality people who may raise and work issues and a
viewer who only reads them, all in a test company of the probe's own; the administrator works in that
company for the run (its active company is restored afterwards). Every record is removed afterwards, including the quality set-up values and
the company numbering the probe creates.
Checks:
  set-up: administrators only; status kinds and detection origins validated; duplicates refused; changes
  versioned and logged; a status in use cannot be deleted
  fail closed: before the company has issue types nothing can be raised; without company numbering a
  raise answers 422 NUMBERING_REQUIRED; once set, issues are numbered with it
  raising: required fields, a client source needs the client, anonymous 401, a viewer 403; starts in
  the first open status with the raiser owning the plan; a client name is hidden from a reader who may
  not read the client
  plan: owner and window (latest not before earliest), the version moves, stale → 409
  actions: owners and due dates, overdue counted, done / cancel / reopen with their own version,
  progress follows the share done, impossible moves → 422; "mine" for the plan owner and action owners
  effectiveness and status: a check needs what was checked; closing moves the issue to the closed list
Report: logs/quality-probe.json.
"""
import json
import os
import secrets
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

BASE = "com.axelor.apps.base.db."
USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PARTNER, COMPANY, CURRENCY = BASE + "Partner", BASE + "Company", BASE + "Currency"
SEQUENCE, SEQUENCE_VERSION, RESERVED = BASE + "Sequence", BASE + "SequenceVersion", BASE + "ReservedSequence"
QI = "com.axelor.apps.quality.db.QualityImprovement"
QI_STATUS, QI_DETECTION = "com.axelor.apps.quality.db.QIStatus", "com.axelor.apps.quality.db.QIDetection"
QI_DEFAULT, QI_ACTION = "com.axelor.apps.quality.db.QIDefault", "com.axelor.apps.quality.db.QIAction"
ACTION = "com.ioeti.operations.db.CorrectiveAction"
Q, ADM = "/ws/ioeti/quality", "/ws/ioeti/admin/quality"
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:240]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def obj(body):
    return (body.get("object") if isinstance(body, dict) else None) or {}


def rows(body):
    value = body.get("object") if isinstance(body, dict) else None
    return value if isinstance(value, list) else []


def err(body):
    e = (body.get("error") or {}) if isinstance(body, dict) else {}
    return e.get("code"), ((e.get("fields") or [{}])[0]).get("code")


def main():
    admin = Client()
    assert admin.login(os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin")),
                       os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
    tag = secrets.token_hex(3).upper()
    created = []

    def create(model, values):
        _, body = rest_create(admin, model, values)
        if not ok(body):
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}: {json.dumps(body)[:200]}")
        created.append((model, body["data"][0]["id"]))
        return body["data"][0]

    def search(model, domain, limit=500):
        _, body = admin.call("POST", f"/ws/rest/{model}/search", {"fields": ["id"], "limit": limit, "data": {"_domain": domain}})
        return [r["id"] for r in body.get("data") or []]

    exit_code = 1
    company_id = None
    restore = {}
    try:
        egp = search(CURRENCY, "self.codeISO = 'EGP'", 1)[0]
        company = create(COMPANY, {"name": f"Quality Probe Co {tag}", "code": f"QP{tag}", "currency": {"id": egp}})
        company_id = company["id"]
        account = create(PARTNER, {"name": f"عميل الجودة {tag}", "partnerTypeSelect": 1, "isCustomer": True})
        rwc = dict(canRead=True, canWrite=True, canCreate=True)

        def perm(name, model, **rights):
            return create(PERM, {"name": f"quality.{name}.{tag}", "object": model, **rights})
        workers = [perm("qi", QI, **rwc), perm("p", PARTNER, canRead=True), perm("pr", "com.axelor.apps.project.db.Project", canRead=True)]
        readers = [perm("vqi", QI, canRead=True)]
        groups = {"w": create(GROUP, {"code": f"quality-w-{tag}", "name": f"Quality work {tag}", "permissions": [{"id": p["id"]} for p in workers]}),
                  "v": create(GROUP, {"code": f"quality-v-{tag}", "name": f"Quality read {tag}", "permissions": [{"id": p["id"]} for p in readers]})}
        # the administrator works in the probe's company for the run; restored in the finally block
        login = os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin"))
        _, me = admin.call("POST", f"/ws/rest/{USER}/search", {"fields": ["id", "version", "activeCompany"], "limit": 1, "data": {"_domain": f"self.code = '{login}'"}})
        admin_row = (me.get("data") or [{}])[0]
        restore["admin"] = admin_row
        admin.call("POST", f"/ws/rest/{USER}/{admin_row['id']}", {"data": {"id": admin_row["id"], "version": admin_row["version"], "activeCompany": {"id": company_id}}})
        sessions, users = {}, {}
        qadm = Client()
        assert qadm.login(login, os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
        for label, group in (("A", groups["w"]["id"]), ("B", groups["w"]["id"]), ("V", groups["v"]["id"])):
            password = "Qp!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"quality.{label.lower()}.{tag}", "name": f"Quality {label} {tag}", "blocked": False, "language": "ar",
                                         "group": {"id": group}, "password": axelor_password_hash(password),
                                         "activeCompany": {"id": company_id}, "companySet": [{"id": company_id}]})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        a, b, v, anon = sessions["A"], sessions["B"], sessions["V"], Client()

        # --- fail closed before the set-up --------------------------------------------------------------
        s1, b1 = a.call("GET", Q + "/options")
        s2, b2 = a.call("POST", Q, {"title": "x", "detectionId": 0, "issueTypeId": 0, "gravity": "MAJOR"})
        check("before the company has issue types, the options say so and nothing can be raised",
              s1 == 200 and obj(b1).get("ready") is False and "ISSUE_TYPES" in obj(b1).get("missing", []) and s2 == 422, (s1, obj(b1).get("missing"), s2, err(b2)))

        # --- quality set-up (administrators) ----------------------------------------------------------
        s1, _ = a.call("GET", ADM + "/statuses")
        s2, _ = anon.call("GET", ADM + "/statuses")
        bad = [qadm.call("POST", ADM + "/statuses", {"name": f"x{tag}", "kind": "MAYBE"}), qadm.call("POST", ADM + "/detections", {"name": f"y{tag}", "kind": "ALIENS"}),
               qadm.call("POST", ADM + "/statuses", {"name": " ", "kind": "OPEN"})]
        check("the quality set-up is for administrators (403/401 otherwise); an unknown kind or origin and an empty name → 422",
              (s1, s2) == (403, 401) and [(x[0], err(x[1])[1]) for x in bad] == [(422, "UNAVAILABLE"), (422, "UNAVAILABLE"), (422, "REQUIRED")], (s1, s2, [(x[0], err(x[1])) for x in bad]))
        setup = {}
        for key, path, name, kind, model in (
                ("open", "statuses", f"قيد المعالجة {tag}", "OPEN", QI_STATUS), ("closed", "statuses", f"مقفولة {tag}", "CLOSED", QI_STATUS),
                ("internal", "detections", f"تدقيق داخلي {tag}", "INTERNAL", QI_DETECTION), ("client", "detections", f"شكوى عميل {tag}", "CUSTOMER", QI_DETECTION),
                ("issue", "issue-types", f"تأخير تقرير {tag}", None, QI_DEFAULT), ("action", "action-types", f"تعديل إجراء {tag}", None, QI_ACTION)):
            s, body = qadm.call("POST", f"{ADM}/{path}", {"name": name, "kind": kind})
            setup[key] = obj(body)
            if setup[key].get("id"):
                created.append((model, setup[key]["id"]))
        check("an administrator adds statuses with their kind, detections with their origin, issue and action types (codes generated)",
              all(x.get("id") for x in setup.values()) and setup["closed"]["kind"] == "CLOSED" and setup["client"]["kind"] == "CUSTOMER"
              and (setup["issue"].get("code") or "").startswith("ISS-"), {k: (x.get("kind"), x.get("code")) for k, x in setup.items()})
        s, body = qadm.call("POST", ADM + "/statuses", {"name": f"مقفولة {tag}".upper(), "kind": "OPEN"})
        s2, body2 = qadm.call("POST", f"{ADM}/detections/{setup['client']['id']}", {"version": setup["client"]["version"], "name": f"شكوى عميل مكتوبة {tag}", "kind": "CUSTOMER"})
        s3, _ = qadm.call("POST", f"{ADM}/detections/{setup['client']['id']}", {"version": setup["client"]["version"], "name": "z", "kind": "CUSTOMER"})
        if s2 == 200:
            setup["client"] = obj(body2)
        check("a duplicate name is refused; a value is renamed with its version, a stale version → 409",
              (s, err(body)[1], s2, s3) == (422, "DUPLICATE", 200, 409), (s, err(body), s2, s3))
        s, body = a.call("GET", Q + "/options")
        o = obj(body)
        check("for the company's people the options now list the company's issue and action types",
              any(t["id"] == setup["issue"]["id"] for t in o.get("issueTypes", [])) and any(t["id"] == setup["action"]["id"] for t in o.get("actionTypes", []))
              and o.get("ready") is True, o)

        # --- numbering for the company -----------------------------------------------------------------
        raise_body = {"title": f"تأخير تسليم تقرير التدقيق {tag}", "details": "التقرير اتسلم بعد 12 يوم من التدقيق", "detectionId": setup["internal"]["id"],
                      "issueTypeId": setup["issue"]["id"], "gravity": "MAJOR", "zone": "Africa/Cairo"}
        s, body = a.call("POST", Q, raise_body)
        check("without numbering for the company a raise answers 422 NUMBERING_REQUIRED and nothing is kept", (s, err(body)[0]) == (422, "NUMBERING_REQUIRED"), (s, err(body)))
        s, body = qadm.call("POST", "/ws/ioeti/admin/numbering/qualityImprovement", {"prefix": f"Q{tag[:3]}-", "digits": 3})
        check("the administrator sets up quality numbering for the company", s == 200 and obj(body).get("example") == f"Q{tag[:3]}-001", (s, obj(body)))

        # --- raising -------------------------------------------------------------------------------------
        answers = [a.call("POST", Q, {**raise_body, "title": " "}), a.call("POST", Q, {**raise_body, "detectionId": 999999999}),
                   a.call("POST", Q, {**raise_body, "detectionId": setup["client"]["id"]}), a.call("POST", Q, {**raise_body, "gravity": "BAD"})]
        codes = [(x[0], err(x[1])[1]) for x in answers]
        s1, _ = anon.call("POST", Q, raise_body)
        s2, _ = v.call("POST", Q, raise_body)
        check("raising is validated (title, known source, a client source needs the client, gravity); anonymous 401; a reader 403",
              codes == [(422, "REQUIRED"), (422, "UNAVAILABLE"), (422, "REQUIRED"), (422, "REQUIRED")] and (s1, s2) == (401, 403), (codes, s1, s2))
        s, body = a.call("POST", Q, raise_body)
        d = obj(body)
        i1 = d.get("issue") or {}
        if i1.get("id"):
            created.append((QI, i1["id"]))
        check("a quality person raises an issue: numbered, in the first open status, they own the plan, nothing done or judged yet",
              s == 201 and (i1.get("reference") or "").startswith(f"Q{tag[:3]}-") and i1.get("statusKind") == "OPEN" and i1.get("mine") is True
              and i1.get("progress") == 0 and i1.get("effectiveness") == "NOT_CHECKED" and d.get("details") == raise_body["details"], (s, i1))
        s, body = a.call("POST", Q, {**raise_body, "title": f"شكوى من العميل {tag}", "detectionId": setup["client"]["id"], "accountId": account["id"], "gravity": "CRITICAL"})
        i2 = (obj(body).get("issue") or {})
        if i2.get("id"):
            created.append((QI, i2["id"]))
        seen_by_v = obj(v.call("GET", f"{Q}/{i2.get('id')}")[1]).get("issue") or {}
        check("a client complaint names the client for those who may read it, and hides it from a reader who may not",
              s == 201 and i2.get("accountName") == f"عميل الجودة {tag}" and i2.get("gravity") == "CRITICAL"
              and seen_by_v.get("id") == i2.get("id") and seen_by_v.get("accountName") is None, (s, i2.get("accountName"), seen_by_v.get("accountName")))

        # --- plan -----------------------------------------------------------------------------------------
        today = date.today()
        s, body = a.call("POST", f"{Q}/{i1['id']}/plan", {"version": i1["version"], "ownerId": users["B"]["id"], "objective": "كل تقرير يتسلم خلال 5 أيام عمل",
                                                         "criteria": "3 شهور متتالية من غير تأخير", "earliest": today.isoformat(), "latest": (today + timedelta(days=60)).isoformat()})
        p = obj(body)
        s_stale, _ = a.call("POST", f"{Q}/{i1['id']}/plan", {"version": i1["version"], "ownerId": users["A"]["id"]})
        s_bad, b_bad = a.call("POST", f"{Q}/{i1['id']}/plan", {"version": (p.get("issue") or {}).get("version"), "ownerId": users["B"]["id"],
                                                             "earliest": today.isoformat(), "latest": (today - timedelta(days=1)).isoformat()})
        check("the plan names its owner, objective, criterion and window; the version moves (stale → 409); latest before earliest → 422",
              s == 200 and (p.get("issue") or {}).get("ownerName") == f"Quality B {tag}" and (p.get("issue") or {}).get("version", 0) > i1["version"]
              and p.get("criteria") == "3 شهور متتالية من غير تأخير" and s_stale == 409 and (s_bad, err(b_bad)[1]) == (422, "BEFORE_START"), (s, s_stale, s_bad, err(b_bad)))
        cur = p.get("issue") or {}

        # --- actions ----------------------------------------------------------------------------------------
        s1, body = a.call("POST", f"{Q}/{i1['id']}/actions", {"version": cur.get("version"), "title": "قالب تقرير موحد", "ownerId": users["A"]["id"],
                                                             "due": (today - timedelta(days=1)).isoformat(), "typeId": setup["action"]["id"]})
        cur = (obj(body).get("issue") or {})
        s2, body = a.call("POST", f"{Q}/{i1['id']}/actions", {"version": cur.get("version"), "title": "مراجعة أسبوعية للتقارير المتأخرة", "ownerId": users["B"]["id"],
                                                             "due": (today + timedelta(days=14)).isoformat()})
        d = obj(body)
        cur = d.get("issue") or {}
        acts = {x["title"]: x for x in d.get("actions", [])}
        check("actions get owners and due dates; one past its date counts as overdue",
              (s1, s2) == (201, 201) and cur.get("openActions") == 2 and cur.get("overdueActions") == 1 and acts["قالب تقرير موحد"]["overdue"] is True
              and acts["قالب تقرير موحد"]["type"] == f"تعديل إجراء {tag}", (s1, s2, cur.get("openActions"), cur.get("overdueActions")))
        mine_a = [r["id"] for r in rows(a.call("GET", Q + "?mine=true")[1])]
        mine_b = [r["id"] for r in rows(b.call("GET", Q + "?mine=true")[1])]
        check("'mine' lists the issue for the plan owner and for an action owner, not the other issue",
              i1["id"] in mine_a and i1["id"] in mine_b and i2.get("id") not in mine_b, (mine_a, mine_b))
        first, second = acts["قالب تقرير موحد"], acts["مراجعة أسبوعية للتقارير المتأخرة"]
        s, body = b.call("POST", f"{Q}/{i1['id']}/actions/{first['id']}/done", {"version": first["version"], "outcome": "القالب اتعمل واتوزع", "zone": "Africa/Cairo"})
        d = obj(body)
        p1 = (d.get("issue") or {}).get("progress")
        s_stale, _ = b.call("POST", f"{Q}/{i1['id']}/actions/{first['id']}/done", {"version": first["version"]})
        s_c, body = b.call("POST", f"{Q}/{i1['id']}/actions/{second['id']}/cancel", {"version": second["version"]})
        d = obj(body)
        p2 = (d.get("issue") or {}).get("progress")
        cancelled = next(x for x in d.get("actions", []) if x["id"] == second["id"])
        s_bad, b_bad = b.call("POST", f"{Q}/{i1['id']}/actions/{second['id']}/done", {"version": cancelled["version"]})
        s_r, body = b.call("POST", f"{Q}/{i1['id']}/actions/{second['id']}/reopen", {"version": cancelled["version"]})
        p3 = ((obj(body).get("issue") or {}).get("progress"))
        done_view = next(x for x in obj(body).get("actions", []) if x["id"] == first["id"])
        check("done → progress 50%, a stale action → 409; cancelling leaves 100%; a cancelled action cannot be done (422); reopening → 50%",
              (s, p1, s_stale, s_c, p2, s_bad, err(b_bad)[0], s_r, p3) == (200, 50, 409, 200, 100, 422, "STATUS_NOT_ALLOWED", 200, 50)
              and done_view["outcome"] == "القالب اتعمل واتوزع" and done_view["doneAt"], (s, p1, s_stale, s_c, p2, s_bad, s_r, p3))
        cur = obj(body).get("issue") or {}

        # --- a reader -------------------------------------------------------------------------------------
        s1, _ = v.call("GET", f"{Q}/{i1['id']}")
        s2, _ = v.call("POST", f"{Q}/{i1['id']}/actions", {"version": cur.get("version"), "title": "x", "ownerId": users["V"]["id"]})
        s3, _ = v.call("GET", Q + "/people")
        check("a reader opens the issue but cannot add actions or list who to assign (403)", (s1, s2, s3) == (200, 403, 403), (s1, s2, s3))

        # --- effectiveness and closing ------------------------------------------------------------------
        s_bad, b_bad = b.call("POST", f"{Q}/{i1['id']}/effectiveness", {"version": cur.get("version"), "effective": True, "check": " "})
        s, body = b.call("POST", f"{Q}/{i1['id']}/effectiveness", {"version": cur.get("version"), "effective": True,
                                                                   "check": "راجعنا تقارير 3 شهور: كلها اتسلمت في المعاد", "zone": "Africa/Cairo"})
        d = obj(body)
        cur = d.get("issue") or {}
        check("an effectiveness check needs what was checked (422); recorded as effective with who and when, and the version moves",
              (s_bad, err(b_bad)[1]) == (422, "REQUIRED") and s == 200 and cur.get("effectiveness") == "EFFECTIVE" and d.get("checkedByName") == f"Quality B {tag}"
              and d.get("checkedAt"), (s_bad, s, cur.get("effectiveness")))
        s, body = b.call("POST", f"{Q}/{i1['id']}/status", {"version": cur.get("version"), "statusId": setup["closed"]["id"]})
        open_ids = [r["id"] for r in rows(a.call("GET", Q)[1])]
        closed_ids = [r["id"] for r in rows(a.call("GET", Q + "?state=closed")[1])]
        check("closing moves the issue from the open register to the closed one", s == 200 and i1["id"] not in open_ids and i1["id"] in closed_ids
              and i2.get("id") in open_ids, (s, open_ids, closed_ids))
        s, body = qadm.call("POST", f"{ADM}/statuses/{setup['closed']['id']}/delete", {"version": setup["closed"]["version"]})
        s2, body2 = qadm.call("GET", "/ws/ioeti/admin/audit?subject=QI_STATUS&limit=10")
        check("a status in use cannot be deleted (409 IN_USE); the set-up changes are in the change log",
              (s, err(body)[0]) == (409, "IN_USE") and any(r["action"] == "QI_STATUS_ADDED" for r in rows(body2)), (s, err(body), [r["action"] for r in rows(body2)]))

        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
        print(f"\n{sum(r['result'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} checks passed")
    finally:
        row = restore.get("admin")
        if row:
            _, now_row = admin.call("POST", f"/ws/rest/{USER}/search", {"fields": ["id", "version"], "limit": 1, "data": {"_domain": f"self.id = {row['id']}"}})
            current = (now_row.get("data") or [{}])[0]
            admin.call("POST", f"/ws/rest/{USER}/{row['id']}", {"data": {"id": row["id"], "version": current.get("version"),
                                                                       "activeCompany": row.get("activeCompany") and {"id": row["activeCompany"]["id"]}}})
        issue_ids = [rid for m, rid in created if m == QI]
        if issue_ids:
            created.extend((ACTION, x) for x in search(ACTION, f"self.improvement.id in ({','.join(map(str, issue_ids))})"))
        if company_id:
            for seq in search(SEQUENCE, f"self.codeSelect = 'qualityImprovement' AND self.company.id = {company_id}"):
                created.extend((RESERVED, x) for x in search(RESERVED, f"self.sequence.id = {seq}"))
                created.extend((SEQUENCE_VERSION, x) for x in search(SEQUENCE_VERSION, f"self.sequence.id = {seq}"))
                created.append((SEQUENCE, seq))
        order = {ACTION: 0, QI: 1, QI_STATUS: 2, QI_DETECTION: 2, QI_DEFAULT: 2, QI_ACTION: 2, RESERVED: 3, SEQUENCE_VERSION: 4, SEQUENCE: 5,
                 PARTNER: 6, USER: 10, GROUP: 11, PERM: 12, COMPANY: 13}
        complete, left = cleanup(admin, created, order)
        if not complete:
            print(f"FAIL cleanup left {left}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "quality-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
