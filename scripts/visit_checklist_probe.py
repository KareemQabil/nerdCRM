#!/usr/bin/env python3
"""Visit checklists and on-site evidence: live probe against a RUNNING local/CI Axelor; never against
production. The checklist is TEST FIXTURE configuration of native records (answer types and values,
questions, a range with a required, a conditional and a non-conforming answer, a visit type using it);
roles are TEST FIXTURES from native permissions: a field person and a viewer. Every record is removed
afterwards, and visit numbering set up here is removed again if it did not exist before.
Checks:
  a visit without a checklist type has none; a planned visit with one gets it generated (native generator)
  answers are given on site only (planned → 422), by people who may change the visit (viewer → 403)
  list, text, measure, checkbox answers; a non-conforming answer is flagged; a conditional question
  appears only after the answer it depends on (before: 422 NOT_ACTIVE); stale item version → 409
  photo and signature: PNG/JPEG only, content checked (a text file named .png → 422), served back as an
  image with nosniff; clearing an answer reopens a required item
  finish: refused while a required item is open (422 CHECKLIST_INCOMPLETE), accepted once answered
  documents can be filed on the visit (subject VISIT) by people who may change it
Report: logs/visit-checklist-probe.json.
"""
import base64
import json
import os
import secrets
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import BASE, ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PARTNER = "com.axelor.apps.base.db.Partner"
SEQUENCE, SEQUENCE_VERSION, RESERVED = "com.axelor.apps.base.db.Sequence", "com.axelor.apps.base.db.SequenceVersion", "com.axelor.apps.base.db.ReservedSequence"
I = "com.axelor.apps.intervention.db."
VISIT, ITYPE, RANGE, RANGE_Q, QUESTION = I + "Intervention", I + "InterventionType", I + "Range", I + "RangeQuestion", I + "Question"
ANSWER_TYPE, ANSWER_VALUE, ORDERED = I + "AnswerType", I + "AnswerValue", I + "OrderedRange"
RANGE_TYPE, CATEGORY = I + "RangeType", I + "InterventionCategory"
I_RANGE, I_QUESTION = I + "InterventionRange", I + "InterventionQuestion"
DOC, REV = "com.ioeti.content.db.RecordDocument", "com.ioeti.content.db.DocumentRevision"
V = "/ws/ioeti/visits"
PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append({"check": name, "result": "PASS" if condition else "FAIL", "detail": str(detail)[:240]})
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else f"  [{detail}]"))


def obj(body):
    return (body.get("object") if isinstance(body, dict) else None) or {}


def err(body):
    e = (body.get("error") or {}) if isinstance(body, dict) else {}
    return e.get("code"), ((e.get("fields") or [{}])[0]).get("code")


def at(days, hour):
    d = datetime.now() + timedelta(days=days)
    return d.replace(hour=hour, minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M")


def raw_get(client, path):
    """GET a binary response with the client's session: (status, headers, bytes)."""
    req = urllib.request.Request(BASE + path, method="GET")
    req.add_header("Accept", "image/png, image/jpeg")
    try:
        with client.opener.open(req, timeout=60) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def items(checklist):
    return {i["title"]: i for s in checklist.get("sections", []) for i in s["items"]}


def main():
    admin = Client()
    assert admin.login(os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin")),
                       os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
    tag = secrets.token_hex(3).upper()
    created = []
    numbering_created = False

    def create(model, values):
        _, body = rest_create(admin, model, values)
        if not ok(body):
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}: {json.dumps(body)[:300]}")
        created.append((model, body["data"][0]["id"]))
        return body["data"][0]

    def search(model, domain):
        _, body = admin.call("POST", f"/ws/rest/{model}/search", {"fields": ["id"], "limit": 500, "data": {"_domain": domain}})
        return [r["id"] for r in body.get("data") or []]

    exit_code = 1
    try:
        # --- visit numbering (shared), as in the visit probe ------------------------------------------
        rows = admin.call("GET", "/ws/ioeti/admin/numbering")[1].get("object") or []
        before = next((r for r in rows if r["code"] == "intervention"), {})
        if not before.get("configured"):
            s, _ = admin.call("POST", "/ws/ioeti/admin/numbering/intervention", {"prefix": f"C{tag[:3]}-", "digits": 4})
            assert s == 200, "numbering fixture"
            numbering_created = True

        # --- the checklist (native configuration, test fixture) ----------------------------------------
        conform = create(ANSWER_TYPE, {"name": f"Conformity {tag}", "answerTypeSelect": "list",
                                       "answerValueList": [{"name": "مطابق", "sequence": 1}, {"name": "غير مطابق", "sequence": 2, "nonConforming": True}]})
        values = {v["name"]: v["id"] for v in admin.call("POST", f"/ws/rest/{ANSWER_VALUE}/search",
                                                         {"fields": ["id", "name"], "data": {"_domain": f"self.answerType.id = {conform['id']}"}})[1]["data"]}
        types = {k: create(ANSWER_TYPE, {"name": f"{k} {tag}", "answerTypeSelect": k}) for k in ("text", "measure", "checkbox", "picture", "signature")}
        q = {}
        for key, title, atype in (("site", f"حالة خط الإنتاج {tag}", conform), ("why", f"سبب عدم المطابقة {tag}", types["text"]),
                                  ("temp", f"درجة حرارة المخزن {tag}", types["measure"]), ("ppe", f"معدات الوقاية متاحة {tag}", types["checkbox"]),
                                  ("photo", f"صورة المكان {tag}", types["picture"]), ("sign", f"توقيع ممثل العميل {tag}", types["signature"])):
            q[key] = create(QUESTION, {"title": title, "answerType": {"id": atype["id"]}})
        rtype = create(RANGE_TYPE, {"name": f"Standard {tag}", "rangeTypeSelect": "standard"})
        category = create(CATEGORY, {"code": f"CAT{tag}", "name": f"زيارات {tag}"})
        rng = create(RANGE, {"title": f"زيارة تقييم {tag}", "rangeType": {"id": rtype["id"]}})
        rq = {}
        for key, required in (("site", True), ("temp", False), ("ppe", False), ("photo", True), ("sign", True)):
            rq[key] = create(RANGE_Q, {"rangeVal": {"id": rng["id"]}, "question": {"id": q[key]["id"]}, "title": q[key]["title"], "isRequired": required})
        rq["why"] = create(RANGE_Q, {"rangeVal": {"id": rng["id"]}, "question": {"id": q["why"]["id"]}, "title": q["why"]["title"], "isRequired": True,
                                     "isConditional": True, "conditionalRangeQuestion": {"id": rq["site"]["id"]},
                                     "conditionalAnswerValueSet": [{"id": values["غير مطابق"]}]})
        vtype = create(ITYPE, {"code": f"CHK{tag}", "name": f"زيارة تقييم {tag}", "interventionCategory": {"id": category["id"]},
                               "headerRangeList": [{"rangeVal": {"id": rng["id"]}, "sequence": 1}]})
        plain = create(ITYPE, {"code": f"PLN{tag}", "name": f"زيارة بدون قائمة {tag}", "interventionCategory": {"id": category["id"]}})

        # --- people ------------------------------------------------------------------------------------
        account = create(PARTNER, {"name": f"مصنع القوائم {tag}", "partnerTypeSelect": 1, "isProspect": True})
        rwc = dict(canRead=True, canWrite=True, canCreate=True)

        def perm(name, model, **rights):
            return create(PERM, {"name": f"checklist.{name}.{tag}", "object": model, **rights})
        field = [perm("v", VISIT, **rwc), perm("p", PARTNER, canRead=True), perm("d", DOC, **rwc), perm("r", REV, **rwc)]
        viewer = [perm("vv", VISIT, canRead=True), perm("vp", PARTNER, canRead=True), perm("vd", DOC, canRead=True), perm("vr", REV, canRead=True)]
        groups = {k: create(GROUP, {"code": f"checklist-{k}-{tag}", "name": f"Checklist {k} {tag}", "permissions": [{"id": p["id"]} for p in v]})
                  for k, v in (("f", field), ("v", viewer))}
        sessions, users = {}, {}
        for label, group in (("A", "f"), ("V", "v")):
            password = "Ck!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"checklist.{label.lower()}.{tag}", "name": f"Checklist {label} {tag}", "blocked": False, "language": "ar",
                                         "group": {"id": groups[group]["id"]}, "password": axelor_password_hash(password)})
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        a, v = sessions["A"], sessions["V"]

        # --- no checklist / generated on planning ----------------------------------------------------------
        s, body = a.call("POST", V, {"accountId": account["id"], "purpose": "زيارة عادية", "typeId": plain["id"], "assignedToId": users["A"]["id"], "start": at(1, 9)})
        v0 = obj(body)
        if v0.get("id"):
            created.append((VISIT, v0["id"]))
        c0 = obj(a.call("GET", f"{V}/{v0.get('id')}/checklist")[1])
        s, body = a.call("POST", V, {"accountId": account["id"], "purpose": "زيارة تقييم", "typeId": vtype["id"], "assignedToId": users["A"]["id"], "start": at(1, 10)})
        v1 = obj(body)
        if v1.get("id"):
            created.append((VISIT, v1["id"]))
        c1 = obj(a.call("GET", f"{V}/{v1.get('id')}/checklist")[1])
        it = items(c1)
        check("a visit type without a checklist has none; planning a visit of a type with one generates it (native generator)",
              c0.get("available") is False and s == 201 and c1.get("available") is True and c1.get("generated") is True
              and set(it) >= {q[k]["title"] for k in q} and it[q["why"]["title"]]["active"] is False and c1.get("requiredOpen") == 4
              and c1.get("canAnswer") is False, (c0, c1.get("generated"), c1.get("requiredOpen"), sorted(it)))
        site = it[q["site"]["title"]]
        s_planned, b_planned = a.call("POST", f"{V}/{v1['id']}/checklist/{site['id']}", {"version": site["version"], "choiceId": site["choices"][0]["id"]})
        check("answers are given on site only: a planned visit's checklist answers → 422", (s_planned, err(b_planned)[0]) == (422, "STATUS_NOT_ALLOWED"), (s_planned, err(b_planned)))

        # --- on site ------------------------------------------------------------------------------------------
        cur = obj(a.call("POST", f"{V}/{v1['id']}/start", {"version": v1["version"]})[1])
        c = obj(a.call("GET", f"{V}/{v1['id']}/checklist")[1])
        it = items(c)
        why = it[q["why"]["title"]]
        s_na, b_na = a.call("POST", f"{V}/{v1['id']}/checklist/{why['id']}", {"version": why["version"], "text": "x"})
        s_v, _ = v.call("POST", f"{V}/{v1['id']}/checklist/{it[q['site']['title']]['id']}", {"version": it[q["site"]["title"]]["version"], "choiceId": 1})
        s_vr, _ = v.call("GET", f"{V}/{v1['id']}/checklist")
        check("under way the checklist can be answered; a conditional question is not active yet (422 NOT_ACTIVE); a viewer reads but cannot answer (403)",
              c.get("canAnswer") is True and (s_na, err(b_na)[0]) == (422, "NOT_ACTIVE") and (s_v, s_vr) == (403, 200), (c.get("canAnswer"), s_na, s_v, s_vr))
        site = it[q["site"]["title"]]
        nc = next(x for x in site["choices"] if x["nonConforming"])
        c = obj(a.call("POST", f"{V}/{v1['id']}/checklist/{site['id']}", {"version": site["version"], "choiceId": nc["id"]})[1])
        it = items(c)
        s_stale, _ = a.call("POST", f"{V}/{v1['id']}/checklist/{site['id']}", {"version": site["version"], "choiceId": site["choices"][0]["id"]})
        check("a non-conforming answer is flagged and brings up the question that depends on it; a stale item version → 409",
              it[q["site"]["title"]]["nonConforming"] is True and it[q["site"]["title"]]["answered"] is True and it[q["why"]["title"]]["active"] is True
              and c.get("requiredOpen") == 3 and s_stale == 409, (it[q["site"]["title"]], it[q["why"]["title"]]["active"], c.get("requiredOpen"), s_stale))
        why, temp, ppe = it[q["why"]["title"]], it[q["temp"]["title"]], it[q["ppe"]["title"]]
        answers = [a.call("POST", f"{V}/{v1['id']}/checklist/{why['id']}", {"version": why["version"], "text": "  "}),
                   a.call("POST", f"{V}/{v1['id']}/checklist/{why['id']}", {"version": why["version"], "text": "الخط متوقف للصيانة من أسبوع"}),
                   a.call("POST", f"{V}/{v1['id']}/checklist/{temp['id']}", {"version": temp["version"], "measure": 23.5}),
                   a.call("POST", f"{V}/{v1['id']}/checklist/{ppe['id']}", {"version": ppe["version"], "checked": True})]
        c = obj(answers[-1][1])
        it = items(c)
        check("text (empty → 422), measure and checkbox answers are stored as given",
              (answers[0][0], err(answers[0][1])[1]) == (422, "REQUIRED") and [x[0] for x in answers[1:]] == [200, 200, 200]
              and it[q["why"]["title"]]["text"] == "الخط متوقف للصيانة من أسبوع" and float(it[q["temp"]["title"]]["measure"]) == 23.5
              and it[q["ppe"]["title"]]["checked"] is True and c.get("requiredOpen") == 2, ([x[0] for x in answers], c.get("requiredOpen")))

        # --- photo and signature ---------------------------------------------------------------------------
        photo, sign = it[q["photo"]["title"]], it[q["sign"]["title"]]
        fake = base64.b64encode("not an image at all".encode()).decode()
        bad1 = a.call("POST", f"{V}/{v1['id']}/checklist/{photo['id']}/file", {"version": photo["version"], "fileName": "site.png", "contentBase64": fake})
        # a real text file passes the general upload check but is not an image
        bad2 = a.call("POST", f"{V}/{v1['id']}/checklist/{photo['id']}/file", {"version": photo["version"], "fileName": "notes.txt", "contentBase64": fake})
        bad3 = a.call("POST", f"{V}/{v1['id']}/checklist/{ppe['id']}/file", {"version": it[q["ppe"]["title"]]["version"], "fileName": "x.png", "contentBase64": PNG})
        s_p, body = a.call("POST", f"{V}/{v1['id']}/checklist/{photo['id']}/file", {"version": photo["version"], "fileName": "site.png", "contentBase64": PNG})
        s_s, body = a.call("POST", f"{V}/{v1['id']}/checklist/{sign['id']}/file", {"version": sign["version"], "fileName": "signature.png", "contentBase64": PNG})
        c = obj(body)
        it = items(c)
        check("photos and signatures: a text file named .png and a real text file are refused (422), an item that is not a photo refuses files; PNG answers are stored",
              (bad1[0], err(bad1[1])[1]) == (422, "TYPE_MISMATCH") and (bad2[0], err(bad2[1])[1]) == (422, "TYPE_NOT_ALLOWED")
              and (bad3[0], err(bad3[1])[0]) == (422, "NOT_A_FILE_ITEM") and (s_p, s_s) == (200, 200)
              and it[q["photo"]["title"]]["hasFile"] is True and it[q["sign"]["title"]]["hasFile"] is True and c.get("requiredOpen") == 0,
              (bad1[0], err(bad1[1]), bad2[0], err(bad2[1]), bad3[0], s_p, s_s, c.get("requiredOpen")))
        status, headers, content = raw_get(a, f"{V}/{v1['id']}/checklist/{photo['id']}/file")
        check("the photo is served back as an image with nosniff and no caching", status == 200 and headers.get("Content-Type", "").startswith("image/png")
              and headers.get("X-Content-Type-Options") == "nosniff" and "no-store" in headers.get("Cache-Control", "") and content[:4] == b"\x89PNG",
              (status, headers.get("Content-Type"), headers.get("X-Content-Type-Options")))

        # --- finish ----------------------------------------------------------------------------------------------
        sign = it[q["sign"]["title"]]
        c = obj(a.call("POST", f"{V}/{v1['id']}/checklist/{sign['id']}", {"version": sign["version"], "clear": True})[1])
        cur = obj(a.call("GET", f"{V}/{v1['id']}")[1]).get("visit") or {}
        s_f1, b_f1 = a.call("POST", f"{V}/{v1['id']}/finish", {"version": cur.get("version")})
        sign = items(c)[q["sign"]["title"]]
        a.call("POST", f"{V}/{v1['id']}/checklist/{sign['id']}/file", {"version": sign["version"], "fileName": "signature.png", "contentBase64": PNG})
        cur = obj(a.call("GET", f"{V}/{v1['id']}")[1]).get("visit") or {}
        s_f2, b_f2 = a.call("POST", f"{V}/{v1['id']}/finish", {"version": cur.get("version")})
        check("clearing the signature reopens a required item and finishing is refused (422 CHECKLIST_INCOMPLETE); signed again, the visit finishes",
              c.get("requiredOpen") == 1 and (s_f1, err(b_f1)[0]) == (422, "CHECKLIST_INCOMPLETE") and s_f2 == 200 and obj(b_f2).get("status") == "FINISHED",
              (c.get("requiredOpen"), s_f1, err(b_f1), s_f2))
        c = obj(a.call("GET", f"{V}/{v1['id']}/checklist")[1])
        check("after the visit has finished the checklist is read-only", c.get("canAnswer") is False, c.get("canAnswer"))

        # --- documents on the visit ----------------------------------------------------------------------------
        doc = {"subject": "VISIT", "subjectId": v1["id"], "title": "تقرير الزيارة الداخلي", "kind": "REPORT", "fileName": "visit.png", "contentBase64": PNG}
        s_d, b_d = a.call("POST", "/ws/ioeti/content/documents", doc)
        s_dv, _ = v.call("POST", "/ws/ioeti/content/documents", doc)
        listed = v.call("GET", f"/ws/ioeti/content/documents?subject=VISIT&subjectId={v1['id']}")[1].get("object") or []
        check("documents are filed on the visit (subject VISIT) by people who may change it; a viewer lists them but cannot file (403)",
              s_d == 201 and s_dv == 403 and [d["id"] for d in listed] == [obj(b_d).get("id")], (s_d, s_dv, listed))

        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
        print(f"\n{sum(r['result'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} checks passed")
    finally:
        visit_ids = [rid for m, rid in created if m == VISIT]
        if visit_ids:
            ids = ",".join(map(str, visit_ids))
            for d in search(DOC, f"self.subjectSelect = 7 AND self.subjectId in ({ids})"):
                created.extend((REV, r) for r in search(REV, f"self.document.id = {d}"))
                created.append((DOC, d))
            created.extend((ANSWER_VALUE, x) for x in search(ANSWER_VALUE, f"self.interventionQuestion.interventionRange.intervention.id in ({ids})"))
            created.extend((I_QUESTION, x) for x in search(I_QUESTION, f"self.interventionRange.intervention.id in ({ids})"))
            created.extend((I_RANGE, x) for x in search(I_RANGE, f"self.intervention.id in ({ids})"))
        types_ids = [rid for m, rid in created if m == ITYPE]
        if types_ids:
            created.extend((ORDERED, x) for x in search(ORDERED, f"self.interventionTypeHeader.id in ({','.join(map(str, types_ids))})"))
        answer_types = [rid for m, rid in created if m == ANSWER_TYPE]
        if answer_types:
            created.extend((ANSWER_VALUE, x) for x in search(ANSWER_VALUE, f"self.answerType.id in ({','.join(map(str, answer_types))})"))
        if numbering_created:
            for seq in search(SEQUENCE, "self.codeSelect = 'intervention' AND self.company IS NULL"):
                created.extend((RESERVED, x) for x in search(RESERVED, f"self.sequence.id = {seq}"))
                created.extend((SEQUENCE_VERSION, x) for x in search(SEQUENCE_VERSION, f"self.sequence.id = {seq}"))
                created.append((SEQUENCE, seq))
        order = {REV: 0, DOC: 1, I_QUESTION: 2, I_RANGE: 3, VISIT: 4, ORDERED: 5, RANGE_Q: 5, ITYPE: 6, RANGE: 6, QUESTION: 7, ANSWER_VALUE: 8,
                 ANSWER_TYPE: 9, RANGE_TYPE: 9, CATEGORY: 9, RESERVED: 9, SEQUENCE_VERSION: 10, SEQUENCE: 11, PARTNER: 12, USER: 13, GROUP: 14, PERM: 15}
        # generated answer values hang off generated questions: delete them before the questions
        order[ANSWER_VALUE] = 1
        complete, left = cleanup(admin, created, order)
        if not complete:
            print(f"FAIL cleanup left {left}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "visit-checklist-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
