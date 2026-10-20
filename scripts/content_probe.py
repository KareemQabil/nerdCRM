#!/usr/bin/env python3
"""Wave 7a live probe: document register with revisions, and the knowledge base.

Run against a RUNNING local/CI Axelor; never against production. Roles are TEST FIXTURES built from
native permissions (policy D-07 defines the real ones): RepA owns a lead, RepB owns nothing of it,
Viewer may read every lead but change none, Editor writes knowledge articles, Reader only reads them
and sees one business line. Every file is generated here and fictional.
Checks:
  documents: access follows the record (owner files and downloads; a reader of the record downloads
  but cannot file; others get 404 everywhere); the content decides the type, not the extension (spoofed
  PDF, HTML as text, SVG, oversized, bad base64 → 422); file names lose their path; revisions are
  numbered without gaps, never change (revision 1 downloads the original bytes), identical content →
  422, stale → 409, concurrent uploads on one version → one 201 and the rest 409; archive hides
  without deleting; downloads are attachments with nosniff; accounts must be customers or prospects
  knowledge base: drafts are invisible to readers; publishing makes revision n; later edits stay
  private until published again; unchanged → 422; Arabic-normalized search; an article of a business
  line the reader cannot see is hidden; archived → hidden; readers cannot create or edit
Env: PROBE_CONTENT_ROUNDS (default 5). Report: logs/content-probe.json.
"""
import base64
import io
import json
import os
import secrets
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import BASE, ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402
from db_migrate import DATABASE, psql  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
LEAD, PARTNER, LINE = "com.axelor.apps.crm.db.Lead", "com.axelor.apps.base.db.Partner", "com.ioeti.businessline.db.BusinessLine"
META_FILE = "com.axelor.meta.db.MetaFile"
P = "com.ioeti.content.db."
DOC, REV, CATEGORY, ARTICLE, KB_REV = P + "RecordDocument", P + "DocumentRevision", P + "KnowledgeCategory", P + "KnowledgeArticle", P + "KnowledgeRevision"
CT = "/ws/ioeti/content"
ROUNDS = int(os.environ.get("PROBE_CONTENT_ROUNDS", "5"))
RESULTS = []


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


def field_code(body):
    return ((error(body).get("fields") or [{}])[0]).get("code")


def obj(body):
    return (body.get("object") if isinstance(body, dict) else None) or {}


def rows(body):
    value = body.get("object") if isinstance(body, dict) else None
    return value if isinstance(value, list) else []


def raw_get(client, path):
    """(status, headers, bytes) without JSON parsing."""
    try:
        with client.opener.open(urllib.request.Request(BASE + path, method="GET"), timeout=60) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as err:
        return err.code, dict(err.headers), err.read()


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def anonymous_get(path):
    """(status, location, bytes) for a request without a session, redirects not followed."""
    try:
        with urllib.request.build_opener(_NoRedirect).open(urllib.request.Request(BASE + path), timeout=60) as resp:
            return resp.status, resp.headers.get("Location"), resp.read()
    except urllib.error.HTTPError as err:
        return err.code, err.headers.get("Location"), err.read()


def pdf(text):
    return f"%PDF-1.4\n% {text}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n".encode()


def docx(text):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        z.writestr("word/document.xml", f'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">{text}</w:document>')
    return out.getvalue()


b64 = lambda data: base64.b64encode(data).decode()


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

    def search(model, domain, fields=("id",)):
        _, body = admin.call("POST", f"/ws/rest/{model}/search",
                             {"fields": list(fields), "limit": 500, "data": {"_domain": domain, "_archived": True}})
        return body.get("data") or []

    exit_code = 1
    users = {}
    try:
        # --- fictional fixtures (test only) -----------------------------------------------------------
        line = create(LINE, {"code": f"W7L{tag}", "nameEn": f"Wave7 ISO {tag}", "nameAr": "خط تجريبي", "statusSelect": 2})
        hidden_line = create(LINE, {"code": f"W7H{tag}", "nameEn": f"Wave7 hidden {tag}", "nameAr": "خط مخفي", "statusSelect": 2})
        supplier = create(PARTNER, {"name": f"Wave7 supplier {tag}", "partnerTypeSelect": 1})
        customer = create(PARTNER, {"name": f"Wave7 customer {tag}", "partnerTypeSelect": 1, "isProspect": True})

        def perm(name, model, condition=None, params="__user__", **rights):
            return create(PERM, {"name": f"wave7.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": params} if condition else {})})

        rwc = dict(canRead=True, canWrite=True, canCreate=True)
        perms = {
            "rep": [perm("lead", LEAD, "self.user = ?", **rwc), perm("partner", PARTNER, canRead=True, canWrite=True)],
            "viewer": [perm("v.lead", LEAD, canRead=True)],
            "editor": [perm("e.article", ARTICLE, **rwc), perm("e.category", CATEGORY, **rwc), perm("e.line", LINE, canRead=True)],
            "reader": [perm("r.article", ARTICLE, canRead=True),
                       perm("r.line", LINE, "self.code = ?", params=f"'{line['code']}'", canRead=True)],
        }
        groups = {k: create(GROUP, {"code": f"wave7-{k}-{tag}", "name": f"Wave7 {k} {tag}", "permissions": [{"id": p["id"]} for p in v]})
                  for k, v in perms.items()}
        sessions = {}
        for label, group in (("RepA", "rep"), ("RepB", "rep"), ("Viewer", "viewer"), ("Editor", "editor"), ("Reader", "reader")):
            password = "W7!" + secrets.token_urlsafe(14)
            users[label] = create(USER, {"code": f"wave7.{label.lower()}.{tag}", "name": f"Wave7 {label}", "blocked": False,
                                         "language": "en", "group": {"id": groups[group]["id"]}, "password": axelor_password_hash(password)})
            users[label]["_pw"] = password
            sessions[label] = Client()
            assert sessions[label].login(users[label]["code"], password) == 200, label
        a, b, viewer, editor, reader = (sessions[k] for k in ("RepA", "RepB", "Viewer", "Editor", "Reader"))
        racers = []
        for _ in range(max(2, ROUNDS)):
            racers.append(Client())
            assert racers[-1].login(users["RepA"]["code"], users["RepA"]["_pw"]) == 200
        lead = create(LEAD, {"name": f"Wave7 lead {tag}", "user": {"id": users["RepA"]["id"]}})

        # --- 1. filing and access that follows the record -------------------------------------------------
        original = pdf(f"proposal {tag}")
        doc_body = {"subject": "LEAD", "subjectId": lead["id"], "title": "Technical proposal", "kind": "PROPOSAL", "language": "BILINGUAL",
                    "fileName": "../../secret/Proposal v1.pdf", "contentBase64": b64(original), "changeSummary": "First issue"}
        s_file, b_file = a.call("POST", f"{CT}/documents", doc_body)
        doc = obj(b_file)
        if doc.get("id"):
            created.append((DOC, doc["id"]))
        rev1 = (doc.get("revisions") or [{}])[0]
        check("documents: filed on the owner's lead as revision 1; the file name loses its path; checksum kept",
              s_file == 201 and doc.get("currentRevision") == 1 and rev1.get("fileName") == "Proposal v1.pdf"
              and rev1.get("contentType") == "application/pdf" and len(rev1.get("sha256") or "") == 64, f"{s_file} {b_file}")
        did = doc.get("id")
        s_dl, h_dl, data = raw_get(a, f"{CT}/documents/{did}/revisions/1/content")
        headers = {k.lower(): v for k, v in h_dl.items()}
        check("documents: download is the exact bytes, as an attachment with nosniff and no caching",
              s_dl == 200 and data == original and headers.get("content-disposition", "").startswith("attachment")
              and headers.get("x-content-type-options") == "nosniff" and "no-store" in headers.get("cache-control", "")
              and headers.get("content-type", "").startswith("application/pdf"), f"{s_dl} {headers}")
        s_v_list, b_v_list = viewer.call("GET", f"{CT}/documents?subject=LEAD&subjectId={lead['id']}")
        s_v_dl, _, v_data = raw_get(viewer, f"{CT}/documents/{did}/revisions/1/content")
        s_v_file, _ = viewer.call("POST", f"{CT}/documents", doc_body)
        s_v_rev, _ = viewer.call("POST", f"{CT}/documents/{did}/revisions", {"version": doc.get("version"), "fileName": "x.pdf",
                                                                            "contentBase64": b64(pdf("viewer"))})
        check("documents: a reader of the record lists and downloads, but cannot file or revise (403)",
              (s_v_list, [d["id"] for d in rows(b_v_list)], s_v_dl, v_data == original, s_v_file, s_v_rev) == (200, [did], 200, True, 403, 403),
              f"{s_v_list} {s_v_dl} {s_v_file} {s_v_rev}")
        s_b_list, _ = b.call("GET", f"{CT}/documents?subject=LEAD&subjectId={lead['id']}")
        s_b_get, _ = b.call("GET", f"{CT}/documents/{did}")
        s_b_dl, _, b_data = raw_get(b, f"{CT}/documents/{did}/revisions/1/content")
        s_b_file, _ = b.call("POST", f"{CT}/documents", doc_body)
        s_anon, where, anon_data = anonymous_get(f"{CT}/documents/{did}/revisions/1/content")
        s_anon_json, _ = Client().call("GET", f"{CT}/documents/{did}")
        check("documents: someone who cannot read the record gets 404 everywhere; anonymous → login redirect (302) or 401, never the file",
              (s_b_list, s_b_get, s_b_dl, s_b_file, s_anon_json) == (404, 404, 404, 404, 401) and original not in b_data
              and (s_anon == 401 or (s_anon == 302 and (where or "").rstrip("/").endswith("/axelor-erp"))) and original not in anon_data,
              f"{s_b_list} {s_b_get} {s_b_dl} {s_b_file} {s_anon} {where} {s_anon_json}")

        # --- 2. the content decides the type ----------------------------------------------------------
        def refused(**override):
            s_, b_ = a.call("POST", f"{CT}/documents", {**doc_body, **override})
            if obj(b_).get("id"):
                created.append((DOC, obj(b_)["id"]))
            return s_, field_code(b_)
        attempts = {
            "exe as pdf": refused(fileName="invoice.pdf", contentBase64=b64(b"MZ\x90\x00\x03\x00\x00\x00 program")),
            "html as txt": refused(fileName="notes.txt", contentBase64=b64(b"<html><script>alert(1)</script></html>")),
            "svg": refused(fileName="logo.svg", contentBase64=b64(b'<svg xmlns="http://www.w3.org/2000/svg"/>')),
            "oversized": refused(contentBase64=b64(pdf("x") + b"0" * (10 * 1024 * 1024))),
            "bad base64": refused(contentBase64="%%% not base64 %%%"),
            "unknown subject": refused(subject="INVOICE"),
        }
        check("documents: spoofed PDF, HTML as text, SVG, over 10 MiB, bad base64 and unknown subjects → 422",
              attempts == {"exe as pdf": (422, "TYPE_MISMATCH"), "html as txt": (422, "TYPE_MISMATCH"), "svg": (422, "TYPE_NOT_ALLOWED"),
                           "oversized": (422, "TOO_LARGE"), "bad base64": (422, "FORMAT"), "unknown subject": (422, "UNAVAILABLE")}, attempts)
        s_sup, _ = a.call("GET", f"{CT}/documents?subject=ACCOUNT&subjectId={supplier['id']}")
        s_cus, _ = a.call("GET", f"{CT}/documents?subject=ACCOUNT&subjectId={customer['id']}")
        check("documents: accounts must be customers or prospects (a supplier answers 404)", (s_sup, s_cus) == (404, 200), f"{s_sup} {s_cus}")

        # --- 3. revisions ---------------------------------------------------------------------------------
        def version():
            return obj(a.call("GET", f"{CT}/documents/{did}")[1]).get("version")
        second = docx(f"revised {tag}")
        s_r2, b_r2 = a.call("POST", f"{CT}/documents/{did}/revisions", {"version": version(), "fileName": "Proposal v2.docx",
                                                                     "contentBase64": b64(second), "changeSummary": "Scope updated"})
        s_same, b_same = a.call("POST", f"{CT}/documents/{did}/revisions", {"version": version(), "fileName": "again.docx", "contentBase64": b64(second)})
        s_stale, _ = a.call("POST", f"{CT}/documents/{did}/revisions", {"version": version() - 1, "fileName": "x.pdf", "contentBase64": b64(pdf("stale"))})
        _, _, still = raw_get(a, f"{CT}/documents/{did}/revisions/1/content")
        _, _, now = raw_get(a, f"{CT}/documents/{did}/revisions/2/content")
        check("revisions: revision 2 added; identical content → 422 UNCHANGED; stale → 409; revision 1 still downloads the original",
              (s_r2, obj(b_r2).get("currentRevision"), s_same, error(b_same).get("code"), s_stale) == (201, 2, 422, "UNCHANGED", 409)
              and still == original and now == second, f"{s_r2} {s_same} {b_same} {s_stale}")
        race_ok = True
        for i in range(ROUNDS):
            start, codes, gate = version(), [], threading.Barrier(2)

            def upload(client, n):
                gate.wait()
                codes.append(client.call("POST", f"{CT}/documents/{did}/revisions",
                                         {"version": start, "fileName": f"r{i}-{n}.pdf", "contentBase64": b64(pdf(f"race {i} {n} {tag}"))})[0])
            threads = [threading.Thread(target=upload, args=(racers[n], n)) for n in range(2)]
            [t.start() for t in threads]
            [t.join() for t in threads]
            race_ok &= sorted(codes) == [201, 409]
        numbers = [r["number"] for r in obj(a.call("GET", f"{CT}/documents/{did}")[1]).get("revisions") or []]
        check(f"revisions concurrency ({ROUNDS} rounds of 2 uploads on one version): one 201 + one 409; numbers without gaps",
              race_ok and numbers == list(range(2 + ROUNDS, 0, -1)), f"{race_ok} {numbers}")

        # --- 4. archive -------------------------------------------------------------------------------
        s_arch, _ = a.call("POST", f"{CT}/documents/{did}/archive", {"version": version()})
        _, listed = a.call("GET", f"{CT}/documents?subject=LEAD&subjectId={lead['id']}")
        _, archived = a.call("GET", f"{CT}/documents?subject=LEAD&subjectId={lead['id']}&archived=true")
        s_rev_arch, b_rev_arch = a.call("POST", f"{CT}/documents/{did}/revisions", {"version": version(), "fileName": "late.pdf",
                                                                                 "contentBase64": b64(pdf("late"))})
        s_dl_arch, _, _ = raw_get(a, f"{CT}/documents/{did}/revisions/1/content")
        check("archive: hidden from the default list, listed with archived=true, no new revisions (422), history still downloadable",
              (s_arch, rows(listed), [d["id"] for d in rows(archived)], s_rev_arch, error(b_rev_arch).get("code"), s_dl_arch)
              == (200, [], [did], 422, "DOCUMENT_ARCHIVED", 200), f"{s_arch} {rows(listed)} {s_rev_arch} {s_dl_arch}")

        # --- 5. knowledge base -------------------------------------------------------------------------
        s_cat_r, _ = reader.call("POST", f"{CT}/kb/categories", {"code": f"R{tag}", "nameEn": "x", "nameAr": "س"})
        s_cat, b_cat = editor.call("POST", f"{CT}/kb/categories", {"code": f"proc-{tag}", "nameEn": "Procedures", "nameAr": "إجراءات"})
        cat = obj(b_cat)
        if cat.get("id"):
            created.append((CATEGORY, cat["id"]))
        s_cat2, b_cat2 = editor.call("POST", f"{CT}/kb/categories", {"code": f"PROC-{tag}", "nameEn": "Again", "nameAr": "مرة"})
        check("knowledge: categories by editors only (reader 403); codes upper-cased and unique (422)",
              (s_cat_r, s_cat, cat.get("code"), s_cat2, field_code(b_cat2)) == (403, 201, f"PROC-{tag}", 422, "DUPLICATE"), f"{s_cat_r} {s_cat} {s_cat2}")

        def article(client, **values):
            s_, b_ = client.call("POST", f"{CT}/kb/articles", values)
            if obj(b_).get("id"):
                created.append((ARTICLE, obj(b_)["id"]))
            return s_, obj(b_)
        s_new, art = article(editor, titleEn=f"Audit day preparation {tag}", titleAr=f"التحضير ليوم المراجعة {tag}",
                             bodyEn="Bring the quality manual.", bodyAr="إحضار دليل الجودة المعتمد.", categoryId=cat.get("id"),
                             businessLineCode=line["code"])
        s_new_r, _ = article(reader, titleEn="Reader draft")
        aid = art.get("id")

        def find(client, q):
            _, body = client.call("GET", f"{CT}/kb/articles?q={urllib.parse.quote(q)}")
            return [r["id"] for r in rows(body)]
        before = find(reader, tag)
        s_r_get, _ = reader.call("GET", f"{CT}/kb/articles/{aid}")
        check("knowledge: a draft is invisible to readers (not listed, 404); readers cannot create (403)",
              (s_new, s_new_r, before, s_r_get) == (201, 403, [], 404), f"{s_new} {s_new_r} {before} {s_r_get}")

        def art_version():
            return obj(editor.call("GET", f"{CT}/kb/articles/{aid}")[1]).get("version")
        s_pub, b_pub = editor.call("POST", f"{CT}/kb/articles/{aid}/publish", {"version": art_version()})
        found_variant = find(reader, f"تحضير يوم المراجعه {tag}")
        _, r_view = reader.call("GET", f"{CT}/kb/articles/{aid}")
        rv = obj(r_view)
        check("knowledge: published as revision 1; readers find it with Arabic spelling variants and see no working copy",
              (s_pub, (obj(b_pub).get("published") or {}).get("revision"), found_variant) == (200, 1, [aid])
              and rv.get("canEdit") is False and rv.get("working") is None and rv.get("revisions") == []
              and (rv.get("published") or {}).get("bodyAr") == "إحضار دليل الجودة المعتمد.", f"{s_pub} {found_variant} {rv}")
        s_edit, b_edit = editor.call("POST", f"{CT}/kb/articles/{aid}", {"version": art_version(), "titleEn": f"Audit day preparation {tag}",
                                                                        "titleAr": f"التحضير ليوم المراجعة {tag}", "bodyEn": "Bring the quality manual and records.",
                                                                        "bodyAr": "إحضار دليل الجودة والسجلات.", "categoryId": cat.get("id"),
                                                                        "businessLineCode": line["code"]})
        _, r_mid = reader.call("GET", f"{CT}/kb/articles/{aid}")
        s_pub2, b_pub2 = editor.call("POST", f"{CT}/kb/articles/{aid}/publish", {"version": art_version()})
        s_pub3, b_pub3 = editor.call("POST", f"{CT}/kb/articles/{aid}/publish", {"version": art_version()})
        _, r_after = reader.call("GET", f"{CT}/kb/articles/{aid}")
        s_r_edit, _ = reader.call("POST", f"{CT}/kb/articles/{aid}", {"version": art_version(), "titleEn": "Hijack"})
        check("knowledge: edits stay private until published (reader keeps revision 1); revision 2 then visible; unchanged → 422; reader cannot edit",
              (s_edit, (obj(b_edit).get("working") or {}).get("unpublishedChanges"), (obj(r_mid).get("published") or {}).get("bodyEn"),
               s_pub2, (obj(b_pub2).get("published") or {}).get("revision"), s_pub3, error(b_pub3).get("code"),
               (obj(r_after).get("published") or {}).get("bodyEn"), s_r_edit)
              == (200, True, "Bring the quality manual.", 200, 2, 422, "UNCHANGED", "Bring the quality manual and records.", 403),
              f"{s_edit} {s_pub2} {s_pub3} {s_r_edit} {obj(r_mid).get('published')}")
        s_hid, hid = article(editor, titleEn=f"Hidden line note {tag}", bodyEn="Internal.", businessLineCode=hidden_line["code"])
        editor.call("POST", f"{CT}/kb/articles/{hid.get('id')}/publish", {"version": hid.get("version")})
        s_r_hid, _ = reader.call("GET", f"{CT}/kb/articles/{hid.get('id')}")
        check("knowledge: an article for a business line the reader cannot see is neither listed nor readable (404)",
              hid.get("id") not in find(reader, tag) and hid.get("id") in find(editor, tag) and s_r_hid == 404, f"{find(reader, tag)} {s_r_hid}")
        s_ka, _ = editor.call("POST", f"{CT}/kb/articles/{aid}/archive", {"version": art_version()})
        s_r_arch, _ = reader.call("GET", f"{CT}/kb/articles/{aid}")
        _, drafts = editor.call("GET", f"{CT}/kb/drafts")
        s_r_drafts, _ = reader.call("GET", f"{CT}/kb/drafts")
        check("knowledge: archived → hidden from readers (404); editors keep it in their list; readers have no drafts list (403)",
              (s_ka, s_r_arch, s_r_drafts) == (200, 404, 403) and aid in [r["id"] for r in rows(drafts)] and aid not in find(reader, tag),
              f"{s_ka} {s_r_arch} {s_r_drafts}")

        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
        print(f"\n{sum(r['result'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} checks passed")
    finally:
        doc_ids = [rid for model, rid in created if model == DOC]
        files = []
        if doc_ids:
            ids = ",".join(map(str, doc_ids))
            for row in search(REV, f"self.document.id in ({ids})", ("file",)):
                created.append((REV, row["id"]))
                if row.get("file"):
                    files.append(row["file"]["id"])
        article_ids = [rid for model, rid in created if model == ARTICLE]
        if article_ids:
            ids = ",".join(map(str, article_ids))
            # articles and published revisions reference each other: unlink in the disposable database
            psql(DATABASE, f"UPDATE ioeti_kb_article SET published_revision = NULL WHERE id IN ({ids})")
            for row in search(KB_REV, f"self.article.id in ({ids})"):
                created.append((KB_REV, row["id"]))
        created.extend((META_FILE, f) for f in files)
        order = {REV: 0, KB_REV: 0, DOC: 1, ARTICLE: 1, META_FILE: 2, CATEGORY: 2, LEAD: 3, PARTNER: 4, LINE: 4, USER: 10, GROUP: 11, PERM: 12}
        complete_, leftovers = cleanup(admin, created, order)
        if not complete_:
            print(f"FAIL cleanup left {leftovers}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "content-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete_}, f, indent=2)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
