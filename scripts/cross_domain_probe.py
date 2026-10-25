#!/usr/bin/env python3
"""Field visits and quality across the shared surfaces: live probe against a RUNNING local/CI Axelor; never
against production. Roles are TEST FIXTURES from native permissions: a field-and-quality person who may plan
visits and work quality issues, and a reader who may only read client accounts, in a test company of the
probe's own; the administrator works in that company for the run (its active company is restored afterwards).
Every record is removed afterwards, including the numbering and quality set-up the probe creates.
Checks:
  agenda: my visits and the open corrective actions I own falling due in the range (an action done leaves
  it; one due later is not in the range); a reader without quality rights gets none
  search: a visit by its reference or its client's name, a quality issue by its reference or title; a reader
  without those rights finds the client account only
  Account 360: the client's field visits and quality issues are counted for those who may read them and
  left out (not zero) for those who may not
  report areas: field visits and quality issues are counted in the caller's scope, left out otherwise
  in-app notices (never outbound): a colleague is told when a visit is assigned to them, rescheduled, moved to
  someone else or cancelled, and when a corrective action or a quality plan is assigned to them; the title
  carries only the reference; nothing is noted for what people assign to themselves
Report: logs/cross-domain-probe.json.
"""
import json
import os
import secrets
import sys
from datetime import date, datetime, timedelta
from urllib.parse import quote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

BASE, QDB = "com.axelor.apps.base.db.", "com.axelor.apps.quality.db."
USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PARTNER, COMPANY, CURRENCY = BASE + "Partner", BASE + "Company", BASE + "Currency"
SEQUENCE, SEQUENCE_VERSION, RESERVED = BASE + "Sequence", BASE + "SequenceVersion", BASE + "ReservedSequence"
VISIT, NOTE = "com.axelor.apps.intervention.db.Intervention", "com.ioeti.operations.db.VisitNote"
QI, QI_STATUS, QI_DETECTION, QI_DEFAULT = QDB + "QualityImprovement", QDB + "QIStatus", QDB + "QIDetection", QDB + "QIDefault"
ACTION = "com.ioeti.operations.db.CorrectiveAction"
NOTICE = "com.ioeti.automation.db.InboxNotice"
W, V, Q, ADM, N = "/ws/ioeti/workspace", "/ws/ioeti/visits", "/ws/ioeti/quality", "/ws/ioeti/admin/quality", "/ws/ioeti/admin/numbering"
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:240]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def obj(body):
    return (body.get("object") if isinstance(body, dict) else None) or {}


def rows(body):
    value = body.get("object") if isinstance(body, dict) else None
    return value if isinstance(value, list) else []


def at(days, hour):
    d = datetime.now() + timedelta(days=days)
    return d.replace(hour=hour, minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M")


def main():
    admin = Client()
    login = os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin"))
    admin_password = os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))
    assert admin.login(login, admin_password) == 200
    tag = secrets.token_hex(3).upper()
    token = f"عبور{tag}"
    created = []
    visit_numbering_before = next((r for r in rows(admin.call("GET", N)[1]) if r["code"] == "intervention"), {}).get("configured")

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
        company = create(COMPANY, {"name": f"Cross Probe Co {tag}", "code": f"XD{tag}", "currency": {"id": egp}})
        company_id = company["id"]
        account = create(PARTNER, {"name": f"مصنع {token}", "partnerTypeSelect": 1, "isCustomer": True})
        rwc = dict(canRead=True, canWrite=True, canCreate=True)

        def perm(name, model, **rights):
            return create(PERM, {"name": f"cross.{name}.{tag}", "object": model, **rights})
        worker = [perm("v", VISIT, **rwc), perm("q", QI, **rwc), perm("p", PARTNER, canRead=True)]
        reader = [perm("rp", PARTNER, canRead=True)]
        groups = {"w": create(GROUP, {"code": f"cross-w-{tag}", "name": f"Cross work {tag}", "permissions": [{"id": p["id"]} for p in worker]}),
                  "r": create(GROUP, {"code": f"cross-r-{tag}", "name": f"Cross read {tag}", "permissions": [{"id": p["id"]} for p in reader]})}
        _, me = admin.call("POST", f"/ws/rest/{USER}/search", {"fields": ["id", "version", "activeCompany"], "limit": 1, "data": {"_domain": f"self.code = '{login}'"}})
        admin_row = (me.get("data") or [{}])[0]
        restore["admin"] = admin_row
        admin.call("POST", f"/ws/rest/{USER}/{admin_row['id']}", {"data": {"id": admin_row["id"], "version": admin_row["version"], "activeCompany": {"id": company_id}}})
        qadm = Client()
        assert qadm.login(login, admin_password) == 200
        sessions, users = {}, {}
        for label, group in (("A", "w"), ("B", "w"), ("R", "r")):
            password = "Xd!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"cross.{label.lower()}.{tag}", "name": f"Cross {label} {tag}", "blocked": False, "language": "ar",
                                         "group": {"id": groups[group]["id"]}, "password": axelor_password_hash(password),
                                         "activeCompany": {"id": company_id}, "companySet": [{"id": company_id}]})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        a, b, r = sessions["A"], sessions["B"], sessions["R"]

        # --- a planned visit, and a client quality issue with two actions --------------------------------
        if not visit_numbering_before:
            qadm.call("POST", N + "/intervention", {"prefix": f"X{tag[:3]}-", "digits": 4})
        s, body = a.call("POST", V, {"accountId": account["id"], "purpose": "زيارة متابعة", "assignedToId": users["A"]["id"], "start": at(1, 10)})
        visit = obj(body)
        if visit.get("id"):
            created.append((VISIT, visit["id"]))
        assert s == 201, (s, body)
        for key, path, name, kind, model in (("open", "statuses", f"مفتوحة {tag}", "OPEN", QI_STATUS),
                                             ("client", "detections", f"شكوى {tag}", "CUSTOMER", QI_DETECTION),
                                             ("issue", "issue-types", f"تأخير {tag}", None, QI_DEFAULT)):
            s, body = qadm.call("POST", f"{ADM}/{path}", {"name": name, "kind": kind})
            restore[key] = obj(body)
            if obj(body).get("id"):
                created.append((model, obj(body)["id"]))
        qadm.call("POST", N + "/qualityImprovement", {"prefix": f"Q{tag[:3]}-", "digits": 3})
        s, body = a.call("POST", Q, {"title": f"شكوى {token} من تأخير التقرير", "detectionId": restore["client"]["id"], "issueTypeId": restore["issue"]["id"],
                                    "gravity": "MAJOR", "accountId": account["id"], "zone": "Africa/Cairo"})
        issue = obj(body).get("issue") or {}
        if issue.get("id"):
            created.append((QI, issue["id"]))
        assert s == 201, (s, body)
        today = date.today()
        s, body = a.call("POST", f"{Q}/{issue['id']}/actions", {"version": issue["version"], "title": f"قالب تقرير {tag}", "ownerId": users["A"]["id"],
                                                               "due": (today + timedelta(days=2)).isoformat()})
        issue = obj(body).get("issue") or {}
        s, body = a.call("POST", f"{Q}/{issue['id']}/actions", {"version": issue["version"], "title": f"مراجعة سنوية {tag}", "ownerId": users["A"]["id"],
                                                               "due": (today + timedelta(days=40)).isoformat()})
        actions = {x["title"]: x for x in obj(body).get("actions", [])}

        # --- agenda ---------------------------------------------------------------------------------------
        span = f"?from={today.isoformat()}&to={(today + timedelta(days=7)).isoformat()}"
        agenda = rows(a.call("GET", W + "/agenda" + span)[1])
        mine = [x for x in agenda if x["type"] == "ACTION"]
        check("my agenda has my visit and the corrective action falling due in the range (linked to its issue), not the one due later",
              any(x["type"] == "VISIT" and x["id"] == visit["id"] for x in agenda)
              and [(x["title"], x["recordType"], x["recordId"], x["status"]) for x in mine] == [(f"قالب تقرير {tag}", "QUALITY", issue["id"], "OPEN")],
              [(x["type"], x.get("title")) for x in agenda])
        first = actions[f"قالب تقرير {tag}"]
        a.call("POST", f"{Q}/{issue['id']}/actions/{first['id']}/done", {"version": first["version"], "zone": "Africa/Cairo"})
        after = [x for x in rows(a.call("GET", W + "/agenda" + span)[1]) if x["type"] == "ACTION"]
        reader_agenda = rows(r.call("GET", W + "/agenda" + span)[1])
        check("an action done leaves the agenda; a reader without visit or quality rights has neither in theirs",
              after == [] and not any(x["type"] in ("ACTION", "VISIT") for x in reader_agenda), (after, reader_agenda))

        # --- search ---------------------------------------------------------------------------------------
        hits = rows(a.call("GET", W + "/search?q=" + quote(token))[1])
        types = sorted({h["type"] for h in hits})
        by_ref = rows(a.call("GET", W + "/search?q=" + quote(visit.get("reference") or "-"))[1])
        quality_hit = next((h for h in hits if h["type"] == "QUALITY"), {})
        check("search finds the client, its visit (by the client's name) and the quality issue (by its title); a visit is found by its reference",
              types == ["ACCOUNT", "QUALITY", "VISIT"] and quality_hit.get("id") == issue["id"] and quality_hit.get("subtitle") == issue.get("reference")
              and any(h["type"] == "VISIT" and h["id"] == visit["id"] for h in by_ref), (hits, by_ref))
        reader_hits = rows(r.call("GET", W + "/search?q=" + quote(token))[1])
        check("a reader without visit or quality rights finds the client account only", [h["type"] for h in reader_hits] == ["ACCOUNT"], reader_hits)

        # --- Account 360 ------------------------------------------------------------------------------------
        sections = {x["key"]: x["count"] for x in obj(a.call("GET", f"{W}/account360/{account['id']}")[1]).get("sections", [])}
        reader_sections = {x["key"] for x in obj(r.call("GET", f"{W}/account360/{account['id']}")[1]).get("sections", [])}
        check("Account 360 counts the client's field visits and quality issues; for a reader without those rights they are left out, not zero",
              sections.get("FIELD_VISITS") == 1 and sections.get("QUALITY_ISSUES") == 1
              and "FIELD_VISITS" not in reader_sections and "QUALITY_ISSUES" not in reader_sections, (sections, reader_sections))

        # --- report areas -----------------------------------------------------------------------------------
        areas = {x["key"]: x["count"] for x in obj(a.call("GET", "/ws/ioeti/reports/areas")[1]).get("areas", [])}
        reader_areas = {x["key"] for x in obj(r.call("GET", "/ws/ioeti/reports/areas")[1]).get("areas", [])}
        check("report areas count field visits and quality issues in the caller's scope, and leave them out for a reader without rights",
              areas.get("FIELD_VISITS", 0) >= 1 and areas.get("QUALITY_ISSUES", 0) >= 1
              and "FIELD_VISITS" not in reader_areas and "QUALITY_ISSUES" not in reader_areas, (areas, reader_areas))

        # --- in-app notices for assignments -------------------------------------------------------------------
        def inbox(client):
            return [n for n in rows(client.call("GET", "/ws/ioeti/automation/inbox?limit=100")[1]) if n["subject"] in ("VISIT", "QUALITY")]
        s, body = a.call("POST", V, {"accountId": account["id"], "purpose": "زيارة للزميل", "assignedToId": users["B"]["id"], "start": at(2, 10)})
        v2 = obj(body)
        if v2.get("id"):
            created.append((VISIT, v2["id"]))
        plan = lambda version, who, start: a.call("POST", f"{V}/{v2['id']}/plan", {"version": version, "assignedToId": users[who]["id"], "start": start})
        s1, body = plan(v2["version"], "B", at(3, 11))
        s2, body = plan(obj(body).get("version"), "A", at(3, 11))
        s3, body = plan(obj(body).get("version"), "B", at(3, 11))
        s4, body = a.call("POST", f"{V}/{v2['id']}/cancel", {"version": obj(body).get("version")})
        visit_notes = [(n["kind"], n["subjectId"]) for n in inbox(b) if n["subject"] == "VISIT"]
        check("a colleague is told when a visit is assigned to them, rescheduled, moved to someone else, given back and cancelled",
              (s1, s2, s3, s4) == (200, 200, 200, 200)
              and visit_notes == [("VISIT_CANCELLED", v2["id"]), ("VISIT_ASSIGNED", v2["id"]), ("VISIT_UNASSIGNED", v2["id"]),
                                  ("VISIT_RESCHEDULED", v2["id"]), ("VISIT_ASSIGNED", v2["id"])], (s1, s2, s3, s4, visit_notes))
        current = obj(a.call("GET", f"{Q}/{issue['id']}")[1]).get("issue") or {}
        _, body = a.call("POST", f"{Q}/{issue['id']}/actions", {"version": current.get("version"), "title": f"تدريب الفريق {tag}", "ownerId": users["B"]["id"]})
        current = obj(body).get("issue") or {}
        a.call("POST", f"{Q}/{issue['id']}/plan", {"version": current.get("version"), "ownerId": users["B"]["id"]})
        quality_notes = [(n["kind"], n["subjectId"], n["title"]) for n in inbox(b) if n["subject"] == "QUALITY"]
        expected_title = f"Quality issue {issue.get('reference')}"
        check("a colleague is told when a corrective action or the issue's plan is assigned to them; the title is the reference only",
              quality_notes == [("QUALITY_PLAN_ASSIGNED", issue["id"], expected_title), ("QUALITY_ACTION_ASSIGNED", issue["id"], expected_title)],
              quality_notes)
        check("nothing is noted for what people assign to themselves (my own visit, my own actions and plan)", inbox(a) == [], inbox(a))

        exit_code = 0 if all(x["result"] == "PASS" for x in RESULTS) else 1
        print(f"\n{sum(x['result'] == 'PASS' for x in RESULTS)}/{len(RESULTS)} checks passed")
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
        visit_ids = [rid for m, rid in created if m == VISIT]
        if visit_ids:
            created.extend((NOTE, x) for x in search(NOTE, f"self.visit.id in ({','.join(map(str, visit_ids))})"))
        user_ids = [rid for m, rid in created if m == USER]
        if user_ids:
            ids = ",".join(map(str, user_ids))
            created.extend((NOTICE, x) for x in search(NOTICE, f"self.recipient.id in ({ids}) OR self.actor.id in ({ids})"))
        domains = []
        if company_id:
            domains.append(f"self.codeSelect = 'qualityImprovement' AND self.company.id = {company_id}")
        if not visit_numbering_before:
            domains.append("self.codeSelect = 'intervention' AND self.company IS NULL")
        for domain in domains:
            for seq in search(SEQUENCE, domain):
                created.extend((RESERVED, x) for x in search(RESERVED, f"self.sequence.id = {seq}"))
                created.extend((SEQUENCE_VERSION, x) for x in search(SEQUENCE_VERSION, f"self.sequence.id = {seq}"))
                created.append((SEQUENCE, seq))
        order = {ACTION: 0, NOTE: 0, QI: 1, VISIT: 1, QI_STATUS: 2, QI_DETECTION: 2, QI_DEFAULT: 2, RESERVED: 3, SEQUENCE_VERSION: 4, SEQUENCE: 5,
                 PARTNER: 6, NOTICE: 9, USER: 10, GROUP: 11, PERM: 12, COMPANY: 13}
        complete, left = cleanup(admin, created, order)
        if not complete:
            print(f"FAIL cleanup left {left}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "cross-domain-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
