#!/usr/bin/env python3
"""Quality root-cause analysis and evidence: live probe against a RUNNING local/CI Axelor; never against
production. Roles are TEST FIXTURES from native permissions: a quality person who may work issues and file
documents, and a viewer who only reads them, in a test company of the probe's own; the administrator works in
that company for the run (its active company is restored afterwards). Every record is removed afterwards.
Checks:
  fail closed: until the company has a method with causes, processes and a party record, the options say what
  is missing and no cause can be recorded (422 SETUP_REQUIRED)
  set-up: methods, causes and processes are administrators' (403 otherwise), codes generated; a method's
  branches (cause categories) are added in order, a duplicate is refused, the method's version moves (stale →
  409); a cause belongs to a branch of one of the company's methods; a branch with causes cannot be removed
  method: chosen before causes (422 METHOD_REQUIRED), only the company's methods (422 otherwise); the issue
  shows its branches with their causes; it cannot change once causes are recorded (422 HAS_CAUSES)
  causes: validated (a cause of the method, process, who it is attributed to, what was found); a client cause names the client
  for those who may read it and hides it from a reader who may not; a supplier cause on an issue without a
  supplier → 422; an internal cause is attributed to the organisation, never a named person; the version
  moves; a reader cannot record (403); a cause is removed with the issue's version
  in use: a cause, process or method in use cannot be deleted (409 IN_USE); changes are in the change log
  evidence: documents are filed on the issue (subject QUALITY_ISSUE) by people who may change it; a viewer
  lists them but cannot file (403)
Report: logs/quality-rca-probe.json.
"""
import json
import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

BASE = "com.axelor.apps.base.db."
QDB = "com.axelor.apps.quality.db."
USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PARTNER, COMPANY, CURRENCY = BASE + "Partner", BASE + "Company", BASE + "Currency"
SEQUENCE, SEQUENCE_VERSION, RESERVED = BASE + "Sequence", BASE + "SequenceVersion", BASE + "ReservedSequence"
QI, QI_STATUS, QI_DETECTION, QI_DEFAULT = QDB + "QualityImprovement", QDB + "QIStatus", QDB + "QIDetection", QDB + "QIDefault"
QI_CAUSE, QI_PROCESS, QI_METHOD, QI_METHOD_ITEM = QDB + "QICause", QDB + "QIProcess", QDB + "QIAnalysisMethod", QDB + "QIAnalysisMethodItem"
QI_ANALYSIS_CAUSE = QDB + "QIAnalysisCause"
DOC, REV = "com.ioeti.content.db.RecordDocument", "com.ioeti.content.db.DocumentRevision"
QUALITY_ISSUE_SUBJECT = 8  # ContentService.SUBJECTS position + 1
Q, ADM = "/ws/ioeti/quality", "/ws/ioeti/admin/quality"
PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
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
    login = os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin"))
    admin_password = os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))
    assert admin.login(login, admin_password) == 200
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

    def setup_value(path, name, kind, model, **extra):
        s, body = admin.call("POST", f"{ADM}/{path}", {"name": name, "kind": kind, **extra})
        value = obj(body)
        if value.get("id"):
            created.append((model, value["id"]))
        return s, value

    exit_code = 1
    company_id = None
    restore = {}
    try:
        egp = search(CURRENCY, "self.codeISO = 'EGP'", 1)[0]
        company = create(COMPANY, {"name": f"RCA Probe Co {tag}", "code": f"RC{tag}", "currency": {"id": egp}})
        company_id = company["id"]
        account = create(PARTNER, {"name": f"عميل التحليل {tag}", "partnerTypeSelect": 1, "isCustomer": True})
        rwc = dict(canRead=True, canWrite=True, canCreate=True)

        def perm(name, model, **rights):
            return create(PERM, {"name": f"rca.{name}.{tag}", "object": model, **rights})
        workers = [perm("qi", QI, **rwc), perm("p", PARTNER, canRead=True), perm("d", DOC, **rwc), perm("r", REV, **rwc)]
        readers = [perm("vqi", QI, canRead=True), perm("vd", DOC, canRead=True), perm("vr", REV, canRead=True)]
        groups = {"w": create(GROUP, {"code": f"rca-w-{tag}", "name": f"RCA work {tag}", "permissions": [{"id": p["id"]} for p in workers]}),
                  "v": create(GROUP, {"code": f"rca-v-{tag}", "name": f"RCA read {tag}", "permissions": [{"id": p["id"]} for p in readers]})}
        _, me = admin.call("POST", f"/ws/rest/{USER}/search", {"fields": ["id", "version", "activeCompany"], "limit": 1, "data": {"_domain": f"self.code = '{login}'"}})
        admin_row = (me.get("data") or [{}])[0]
        restore["admin"] = admin_row
        admin.call("POST", f"/ws/rest/{USER}/{admin_row['id']}", {"data": {"id": admin_row["id"], "version": admin_row["version"], "activeCompany": {"id": company_id}}})
        qadm = Client()
        assert qadm.login(login, admin_password) == 200
        sessions, users = {}, {}
        for label, group in (("A", groups["w"]["id"]), ("V", groups["v"]["id"])):
            password = "Rc!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"rca.{label.lower()}.{tag}", "name": f"RCA {label} {tag}", "blocked": False, "language": "ar",
                                         "group": {"id": group}, "password": axelor_password_hash(password),
                                         "activeCompany": {"id": company_id}, "companySet": [{"id": company_id}]})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        a, v = sessions["A"], sessions["V"]

        # an issue to analyse: the minimum set-up to raise one, and company numbering
        setup = {}
        for key, path, name, kind, model in (("open", "statuses", f"مفتوحة {tag}", "OPEN", QI_STATUS),
                                             ("client", "detections", f"شكوى عميل {tag}", "CUSTOMER", QI_DETECTION),
                                             ("issue", "issue-types", f"تأخير {tag}", None, QI_DEFAULT)):
            setup[key] = setup_value(path, name, kind, model)[1]
        qadm.call("POST", "/ws/ioeti/admin/numbering/qualityImprovement", {"prefix": f"R{tag[:3]}-", "digits": 3})
        s, body = a.call("POST", Q, {"title": f"تقرير التدقيق اتأخر {tag}", "details": "العميل اشتكى من تأخير التقرير", "detectionId": setup["client"]["id"],
                                    "issueTypeId": setup["issue"]["id"], "gravity": "MAJOR", "accountId": account["id"], "zone": "Africa/Cairo"})
        issue = obj(body).get("issue") or {}
        if issue.get("id"):
            created.append((QI, issue["id"]))
        assert s == 201, (s, body)

        # --- fail closed before the analysis set-up ------------------------------------------------------
        s1, b1 = a.call("GET", Q + "/options")
        s2, b2 = a.call("POST", f"{Q}/{issue['id']}/causes", {"version": issue["version"], "causeId": 1, "processId": 1, "responsible": "CUSTOMER", "finding": "x"})
        o = obj(b1)
        check("before a method with causes, processes and the company's party record exist, the options say so and no cause can be recorded (422 SETUP_REQUIRED)",
              s1 == 200 and o.get("analysisReady") is False and {"METHODS", "PROCESSES", "COMPANY_PARTY"} <= set(o.get("analysisMissing", []))
              and (s2, err(b2)[0]) == (422, "SETUP_REQUIRED"), (o.get("analysisMissing"), s2, err(b2)))

        # --- set-up (administrators) -------------------------------------------------------------------------
        s_forbidden, _ = a.call("POST", ADM + "/methods", {"name": "x"})
        values = {}
        for key, path, name, model in (("fishbone", "methods", f"عظمة السمكة {tag}", QI_METHOD), ("other", "methods", f"طريقة تانية {tag}", QI_METHOD)):
            values[key] = setup_value(path, name, None, model)[1]
        s_noowner, b_noowner = admin.call("POST", ADM + "/processes", {"name": f"عملية {tag}"})
        values["reporting"] = setup_value("processes", f"إعداد التقارير {tag}", None, QI_PROCESS, ownerId=users["A"]["id"])[1]
        check("methods and processes are administrators' (403 otherwise) and get generated codes; a process needs its owner (422 without one)",
              s_forbidden == 403 and (s_noowner, err(b_noowner)[1]) == (422, "REQUIRED") and values["reporting"].get("ownerName") == f"RCA A {tag}"
              and all(x.get("id") for x in values.values()) and values["reporting"]["code"].startswith("PRC-")
              and values["fishbone"]["code"].startswith("MTH-") and values["fishbone"]["branches"] == [],
              (s_forbidden, {k: x.get("code") for k, x in values.items()}))
        method = values["fishbone"]
        for branch in ("الأفراد", "الطريقة", "المعدات"):
            s, body = qadm.call("POST", f"{ADM}/methods/{method['id']}/branches", {"version": method["version"], "name": branch})
            if s == 201:
                method = obj(body)
        created.extend((QI_METHOD_ITEM, b["id"]) for b in method.get("branches", []))
        s_dup, b_dup = qadm.call("POST", f"{ADM}/methods/{method['id']}/branches", {"version": method["version"], "name": "الأفراد"})
        s_stale, _ = qadm.call("POST", f"{ADM}/methods/{method['id']}/branches", {"version": values["fishbone"]["version"], "name": "البيئة"})
        s_user, _ = a.call("POST", f"{ADM}/methods/{method['id']}/branches", {"version": method["version"], "name": "البيئة"})
        check("a method's branches are added in order; a duplicate → 422, a stale method version → 409, a non-administrator → 403",
              [b["name"] for b in method.get("branches", [])] == ["الأفراد", "الطريقة", "المعدات"]
              and (s_dup, err(b_dup)[1], s_stale, s_user) == (422, "DUPLICATE", 409, 403), (method.get("branches"), s_dup, err(b_dup), s_stale, s_user))
        people, way, tools = method["branches"]
        s_nob, b_nob = qadm.call("POST", ADM + "/causes", {"name": f"x {tag}"})
        for key, name, branch in (("load", f"ضغط جدول المدققين {tag}", people), ("templates", f"غياب قالب موحد {tag}", way)):
            s, body = qadm.call("POST", ADM + "/causes", {"name": name, "branchId": branch["id"]})
            values[key] = obj(body)
            if values[key].get("id"):
                created.append((QI_CAUSE, values[key]["id"]))
        s_rm, body = qadm.call("POST", f"{ADM}/methods/{method['id']}/branches/{tools['id']}/delete", {"version": method["version"]})
        if s_rm == 200:
            method = obj(body)
        s_used, b_used = qadm.call("POST", f"{ADM}/methods/{method['id']}/branches/{people['id']}/delete", {"version": method["version"]})
        check("a cause belongs to a branch (422 without one) and gets a code; an empty branch is removed, one with causes is not (409 IN_USE)",
              (s_nob, err(b_nob)[1]) == (422, "REQUIRED") and values["templates"].get("branchName") == "الطريقة" and values["load"].get("code", "").startswith("CAU-")
              and s_rm == 200 and [b["name"] for b in method.get("branches", [])] == ["الأفراد", "الطريقة"] and (s_used, err(b_used)[0]) == (409, "IN_USE"),
              (s_nob, err(b_nob), values["templates"].get("branchName"), s_rm, method.get("branches"), s_used, err(b_used)))

        # --- the issue follows a method -----------------------------------------------------------------------
        s_first, b_first = a.call("POST", f"{Q}/{issue['id']}/causes", {"version": issue["version"], "causeId": values["templates"]["id"],
                                                                      "processId": values["reporting"]["id"], "responsible": "CUSTOMER", "finding": "x"})
        s_bad, b_bad = a.call("POST", f"{Q}/{issue['id']}/analysis/method", {"version": issue["version"], "methodId": 999999999})
        s, body = a.call("POST", f"{Q}/{issue['id']}/analysis/method", {"version": issue["version"], "methodId": method["id"]})
        d = obj(body)
        rc = d.get("rootCause") or {}
        check("causes need a method first (422 METHOD_REQUIRED); only the company's methods can be chosen; the issue shows the branches with their causes",
              (s_first, err(b_first)[0]) == (422, "METHOD_REQUIRED") and (s_bad, err(b_bad)[1]) == (422, "UNAVAILABLE") and s == 200
              and rc.get("methodName") == f"عظمة السمكة {tag}"
              and [(b["name"], [c["name"] for c in b["causes"]]) for b in rc.get("branches", [])] == [("الأفراد", [f"ضغط جدول المدققين {tag}"]), ("الطريقة", [f"غياب قالب موحد {tag}"])],
              (s_first, err(b_first), s_bad, err(b_bad), s, rc))
        cur = d.get("issue") or {}

        # --- causes -------------------------------------------------------------------------------------------
        cause_body = {"causeId": values["templates"]["id"], "processId": values["reporting"]["id"], "responsible": "CUSTOMER",
                      "finding": "العميل بعت المستندات الناقصة بعد التدقيق بأسبوع", "zone": "Africa/Cairo"}
        answers = [a.call("POST", f"{Q}/{issue['id']}/causes", {**cause_body, "version": cur.get("version"), "finding": " "}),
                   a.call("POST", f"{Q}/{issue['id']}/causes", {**cause_body, "version": cur.get("version"), "causeId": 999999999}),
                   a.call("POST", f"{Q}/{issue['id']}/causes", {**cause_body, "version": cur.get("version"), "processId": None}),
                   a.call("POST", f"{Q}/{issue['id']}/causes", {**cause_body, "version": cur.get("version"), "responsible": "SOMEONE"}),
                   a.call("POST", f"{Q}/{issue['id']}/causes", {**cause_body, "version": cur.get("version"), "responsible": "SUPPLIER"})]
        codes = [(x[0], err(x[1])[1]) for x in answers]
        check("a cause is validated: what was found, the company's cause and process, who it is attributed to; a supplier cause on a client issue → 422",
              codes == [(422, "REQUIRED"), (422, "UNAVAILABLE"), (422, "REQUIRED"), (422, "UNAVAILABLE"), (422, "NO_SUPPLIER")], codes)
        s, body = a.call("POST", f"{Q}/{issue['id']}/causes", {**cause_body, "version": cur.get("version")})
        d = obj(body)
        rc = d.get("rootCause") or {}
        s_stale, _ = a.call("POST", f"{Q}/{issue['id']}/causes", {**cause_body, "version": cur.get("version")})
        client_cause = (rc.get("causes") or [{}])[0]
        check("a client cause is recorded with its branch, process and finding, names the client, notes who wrote it; the version moves (stale → 409)",
              s == 201 and client_cause.get("cause") == f"غياب قالب موحد {tag}" and client_cause.get("branch") == "الطريقة" and client_cause.get("process") == f"إعداد التقارير {tag}"
              and client_cause.get("responsible") == "CUSTOMER" and client_cause.get("responsibleName") == f"عميل التحليل {tag}"
              and client_cause.get("finding") == cause_body["finding"] and rc.get("writtenByName") == f"RCA A {tag}" and rc.get("writtenAt")
              and (d.get("issue") or {}).get("version", 0) > cur.get("version", 0) and s_stale == 409, (s, client_cause, rc.get("writtenByName"), s_stale))
        cur = d.get("issue") or {}
        s_change, b_change = a.call("POST", f"{Q}/{issue['id']}/analysis/method", {"version": cur.get("version"), "methodId": values["other"]["id"]})
        check("the method cannot change once causes are recorded (422 HAS_CAUSES)", (s_change, err(b_change)[0]) == (422, "HAS_CAUSES"), (s_change, err(b_change)))
        seen = (obj(v.call("GET", f"{Q}/{issue['id']}")[1]).get("rootCause") or {}).get("causes") or [{}]
        s_v, _ = v.call("POST", f"{Q}/{issue['id']}/causes", {**cause_body, "version": cur.get("version")})
        check("a reader sees the cause without the client's name (no read access to clients) and cannot record one (403)",
              seen[0].get("cause") == f"غياب قالب موحد {tag}" and seen[0].get("responsibleName") is None and s_v == 403, (seen, s_v))

        s_int, b_int = a.call("POST", f"{Q}/{issue['id']}/causes", {**cause_body, "version": cur.get("version"), "causeId": values["load"]["id"], "responsible": "INTERNAL",
                                                                    "finding": "المدقق كان عنده 4 تدقيقات في نفس الأسبوع"})
        company_party = create(PARTNER, {"name": f"IOETI Probe {tag}", "partnerTypeSelect": 1})
        _, crow = admin.call("POST", f"/ws/rest/{COMPANY}/search", {"fields": ["id", "version"], "limit": 1, "data": {"_domain": f"self.id = {company_id}"}})
        crow = (crow.get("data") or [{}])[0]
        admin.call("POST", f"/ws/rest/{COMPANY}/{company_id}", {"data": {"id": company_id, "version": crow.get("version"), "partner": {"id": company_party["id"]}}})
        s, body = a.call("POST", f"{Q}/{issue['id']}/causes", {**cause_body, "version": cur.get("version"), "causeId": values["load"]["id"], "responsible": "INTERNAL",
                                                               "finding": "المدقق كان عنده 4 تدقيقات في نفس الأسبوع"})
        d = obj(body)
        internal = next((c for c in (d.get("rootCause") or {}).get("causes", []) if c.get("responsible") == "INTERNAL"), {})
        check("an internal cause needs the company's party record (422 SETUP_REQUIRED before); it is attributed to the organisation, never a named person",
              (s_int, err(b_int)[0]) == (422, "SETUP_REQUIRED") and s == 201 and internal.get("cause") == f"ضغط جدول المدققين {tag}"
              and internal.get("responsibleName") is None, (s_int, err(b_int), s, internal))
        cur = d.get("issue") or {}
        o = obj(a.call("GET", Q + "/options")[1])
        check("with causes, processes and the party record set up, the options are ready for analysis",
              o.get("analysisReady") is True and o.get("analysisMissing") == [] and any(c["id"] == method["id"] for c in o.get("methods", [])), o.get("analysisMissing"))

        # --- removing and values in use -------------------------------------------------------------------------
        s_404, _ = a.call("POST", f"{Q}/{issue['id']}/causes/999999999/remove", {"version": cur.get("version")})
        s, body = a.call("POST", f"{Q}/{issue['id']}/causes/{internal.get('id')}/remove", {"version": cur.get("version")})
        left = [c["id"] for c in (obj(body).get("rootCause") or {}).get("causes", [])]
        check("a cause is removed with the issue's version; an unknown cause → 404", (s_404, s) == (404, 200) and left == [client_cause.get("id")], (s_404, s, left))
        cur = obj(body).get("issue") or {}
        listed = {k: {x["id"]: x for x in rows(qadm.call("GET", f"{ADM}/{k}")[1])} for k in ("causes", "processes", "methods")}
        tmpl, proc, mth = listed["causes"].get(values["templates"]["id"], {}), listed["processes"].get(values["reporting"]["id"], {}), listed["methods"].get(method["id"], {})
        refusals = [qadm.call("POST", f"{ADM}/causes/{tmpl.get('id')}/delete", {"version": tmpl.get("version")}),
                    qadm.call("POST", f"{ADM}/processes/{proc.get('id')}/delete", {"version": proc.get("version")}),
                    qadm.call("POST", f"{ADM}/methods/{mth.get('id')}/delete", {"version": mth.get("version")})]
        s_log, b_log = qadm.call("GET", "/ws/ioeti/admin/audit?subject=QI_METHOD&limit=20")
        actions = {r["action"] for r in rows(b_log)}
        check("a cause, process or method in use cannot be deleted (409 IN_USE); method changes are in the change log",
              (tmpl.get("uses"), proc.get("uses"), mth.get("uses")) == (1, 1, 1) and [(x[0], err(x[1])[0]) for x in refusals] == [(409, "IN_USE")] * 3
              and {"QI_METHOD_ADDED", "QI_METHOD_BRANCH_ADDED", "QI_METHOD_BRANCH_DELETED"} <= actions,
              ((tmpl.get("uses"), proc.get("uses"), mth.get("uses")), [(x[0], err(x[1])) for x in refusals], actions))

        # --- evidence on the issue ---------------------------------------------------------------------------------
        doc = {"subject": "QUALITY_ISSUE", "subjectId": issue["id"], "title": "صورة رسالة العميل", "kind": "REPORT", "fileName": "complaint.png", "contentBase64": PNG}
        s_d, b_d = a.call("POST", "/ws/ioeti/content/documents", doc)
        s_dv, _ = v.call("POST", "/ws/ioeti/content/documents", doc)
        listed_docs = v.call("GET", f"/ws/ioeti/content/documents?subject=QUALITY_ISSUE&subjectId={issue['id']}")[1].get("object") or []
        check("evidence is filed on the issue (subject QUALITY_ISSUE) by people who may change it; a viewer lists it but cannot file (403)",
              s_d == 201 and s_dv == 403 and [x["id"] for x in listed_docs] == [obj(b_d).get("id")], (s_d, s_dv, listed_docs))

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
            ids = ",".join(map(str, issue_ids))
            for d in search(DOC, f"self.subjectSelect = {QUALITY_ISSUE_SUBJECT} AND self.subjectId in ({ids})"):
                created.extend((REV, r) for r in search(REV, f"self.document.id = {d}"))
                created.append((DOC, d))
            created.extend((QI_ANALYSIS_CAUSE, x) for x in search(QI_ANALYSIS_CAUSE, f"self.qiAnalysis.qi.id in ({ids})"))
        if company_id:
            known = {rid for m, rid in created if m == QI_METHOD_ITEM}
            created.extend((QI_METHOD_ITEM, x) for x in search(QI_METHOD_ITEM, f"self.company.id = {company_id}") if x not in known)
            for seq in search(SEQUENCE, f"self.codeSelect = 'qualityImprovement' AND self.company.id = {company_id}"):
                created.extend((RESERVED, x) for x in search(RESERVED, f"self.sequence.id = {seq}"))
                created.extend((SEQUENCE_VERSION, x) for x in search(SEQUENCE_VERSION, f"self.sequence.id = {seq}"))
                created.append((SEQUENCE, seq))
        order = {REV: 0, DOC: 1, QI_ANALYSIS_CAUSE: 2, QI: 3, QI_CAUSE: 3, QI_METHOD_ITEM: 4, QI_METHOD: 5, QI_PROCESS: 5, QI_STATUS: 5,
                 QI_DETECTION: 5, QI_DEFAULT: 5, RESERVED: 6, SEQUENCE_VERSION: 7, SEQUENCE: 8, USER: 10, GROUP: 11, PERM: 12, COMPANY: 13, PARTNER: 14}
        complete, left = cleanup(admin, created, order)
        if not complete:
            print(f"FAIL cleanup left {left}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "quality-rca-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
