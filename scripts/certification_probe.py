#!/usr/bin/env python3
"""Wave 4b live probe: client certification (auditor competence, cycles, Stage 1/2 audits, nonconformities).

Run against a RUNNING local/CI Axelor; never against production, and on a disposable database (the D-02 part appoints
a policy owner, which only works while there is none). Roles are TEST FIXTURES built from native permissions (policy D-07
defines the real ones): MgrA and MgrB manage their own cycles, ReadOnly reads everything, AudQ and AudU are auditors (AudU
has no qualification), Dec1-3 hold the certification decision role (AudQ holds it too, but audited the client), Owner is
the policy owner. The client and the two schemes (business lines CB…, CC…) are fictional.
Checks, through /ws/ioeti/certification:
  qualification, cycle, audit and nonconformity validation refuse with field errors
  the lead auditor must be qualified for the standard on the planned date
  one active audit per stage; Stage 2 completes only after Stage 1; surveillance without the policy → POLICY_NOT_SET
  nonconformities open → responded → closed; an open major keeps the cycle from "ready for decision"
  another manager's cycle → the same 404 as a missing id; read-only → 403
  N concurrent Stage 1 plans on one cycle version → one 201 and one 409, exactly one audit
D-02 (signed 2026-10-25), on fixture schemes:
  fail closed: without cert.decision / cert.cycle for the scheme every decision → 422 POLICY_NOT_SET
  who decides: no decision role → 403; an auditor of the client (any cycle) → 403 AUDITED_CLIENT; another manager's cycle →
  404; stale cycle version → 409; GRANT with an open major → 422 NOT_READY
  independent reviewer: one GRANT issues the certificate (number per scheme and year, expiry = issue + validityMonths,
  surveillance every surveillanceMonths); a second decision → 409 ALREADY_CERTIFIED
  committee of 3: votes hidden until the round is decided, one vote per person (409), majority decides and issues; a
  committee of 2 that splits refuses (tie) and a new round can start
  certificate: suspend / restore / withdraw (final) by eligible people only, with reasons, in its history
  surveillance and recertification planning follow a certificate in force
  public check /ws/public/ioeti/certificates/{number}: 404 while CERTIFICATE_CHECK is off (same as unknown), then only
  number, standard, client, status and expiry; no listing
  two decision makers granting one cycle at once → one 200, one 409, exactly one certificate
Env: PROBE_CERT_ROUNDS (default 5). Report: logs/certification-probe.json.
"""
import json
import os
import secrets
import sys
import threading
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import BL, ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
PARTNER = "com.axelor.apps.base.db.Partner"
QUAL, CYCLE = "com.ioeti.certification.db.AuditorQualification", "com.ioeti.certification.db.CertificationCycle"
AUDIT, NC = "com.ioeti.certification.db.CertificationAudit", "com.ioeti.certification.db.Nonconformity"
DECISION, VOTE = "com.ioeti.certification.db.CertificationDecision", "com.ioeti.certification.db.CertificationVote"
CERT, CEVENT = "com.ioeti.certification.db.ClientCertificate", "com.ioeti.certification.db.CertificateEvent"
ROLE, VERSION = "com.axelor.auth.db.Role", "com.ioeti.core.db.PolicyVersion"
ADMIN_AUDIT, NOTICE = "com.ioeti.admin.db.AdminAuditEvent", "com.ioeti.automation.db.InboxNotice"
DECISION_ROLE, OWNER_ROLE = "ioeti-cert-decision-maker", "ioeti-policy-owner"
POLICIES, PUBLIC = "/ws/ioeti/policies", "/ws/public/ioeti/certificates"
BASE = "/ws/ioeti/certification"
MISSING = 987654324
ROUNDS = int(os.environ.get("PROBE_CERT_ROUNDS", "5"))
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


def field(body):
    return (error(body).get("fields") or [{}])[0].get("field")


def add_months(day, months):
    """Calendar months, clamped to the end of a shorter month (as java.time plusMonths)."""
    import calendar
    y, m = divmod(day.month - 1 + months, 12)
    y, m = day.year + y, m + 1
    return date(y, m, min(day.day, calendar.monthrange(y, m)[1]))


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
                             {"fields": list(fields), "limit": 500, "data": {"_domain": domain}})
        return body.get("data") or []

    def version(model, rid):
        _, body = admin.call("POST", f"/ws/rest/{model}/{rid}/fetch", {"fields": ["version"]})
        return (body.get("data") or [{}])[0].get("version")

    if search(USER, f"EXISTS (SELECT r FROM Role r WHERE r.name = '{OWNER_ROLE}' AND r MEMBER OF self.roles)"):
        raise SystemExit("this database already has policy owners; run the probe on a disposable database")
    role_existed = bool(search(ROLE, f"self.name = '{DECISION_ROLE}'"))
    owner_role_existed = bool(search(ROLE, f"self.name = '{OWNER_ROLE}'"))
    exit_code = 1
    users = {}
    try:
        decision_role = (search(ROLE, f"self.name = '{DECISION_ROLE}'") or [None])[0] or create(ROLE, {"name": DECISION_ROLE})

        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"wave4b.{name}.{tag}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})

        mgr = [perm("qual", QUAL, canRead=True, canCreate=True),
               perm("cycle", CYCLE, "self.manager = ?", canRead=True, canWrite=True, canCreate=True),
               perm("audit", AUDIT, "self.cycle.manager = ?", canRead=True, canWrite=True, canCreate=True),
               perm("nc", NC, "self.audit.cycle.manager = ?", canRead=True, canWrite=True, canCreate=True),
               perm("partner", PARTNER, canRead=True), perm("line", BL, canRead=True)]
        ro = [perm(f"ro.{m.split('.')[-1].lower()}", m, canRead=True) for m in (QUAL, CYCLE, AUDIT, NC, PARTNER, BL)]
        groups = {"mgr": create(GROUP, {"code": f"wave4b-mgr-{tag}", "name": f"Wave4b manager {tag}",
                                        "permissions": [{"id": p["id"]} for p in mgr]}),
                  "ro": create(GROUP, {"code": f"wave4b-ro-{tag}", "name": f"Wave4b read-only {tag}",
                                       "permissions": [{"id": p["id"]} for p in ro]})}
        sessions = {}
        for label, group in (("MgrA", "mgr"), ("MgrA2", None), ("MgrB", "mgr"), ("ReadOnly", "ro"),
                             ("AudQ", "ro"), ("AudU", "ro"), ("Dec1", "ro"), ("Dec2", "ro"), ("Dec3", "ro"), ("Owner", "ro")):
            if group is None:
                sessions[label] = Client()
                assert sessions[label].login(users["MgrA"]["code"], users["MgrA"]["_pw"]) == 200
                continue
            password = "W4b!" + secrets.token_urlsafe(14)
            roles = [{"id": decision_role["id"]}] if label in ("AudQ", "Dec1", "Dec2", "Dec3") else []
            users[label] = create(USER, {"code": f"wave4b.{label.lower()}.{tag}", "name": f"Wave4b {label}",
                                         "blocked": False, "language": "en", "group": {"id": groups[group]["id"]},
                                         "roles": roles, "password": axelor_password_hash(password)})
            users[label]["_pw"] = password
            if label in ("MgrA", "MgrB", "ReadOnly", "AudQ", "Dec1", "Dec2", "Dec3", "Owner"):
                sessions[label] = Client()
                assert sessions[label].login(users[label]["code"], password) == 200, label
        a, a2, b, ro_c = (sessions[k] for k in ("MgrA", "MgrA2", "MgrB", "ReadOnly"))
        client_org = create(PARTNER, {"name": f"Wave4b Nile Foods {tag}", "isCustomer": True, "partnerTypeSelect": 1})

        def call(client, method, path, body=None):
            return client.call(method, BASE + path, body if body is not None else ({} if method == "POST" else None))

        def track(model, body):
            rid = (body.get("object") or {}).get("id") if isinstance(body, dict) else None
            if rid and (model, rid) not in created:
                created.append((model, rid))
            return body.get("object") or {}

        # --- 1. auditor competence ----------------------------------------------------------------------
        s, body = call(a, "POST", "/qualifications", {"auditorId": users["AudQ"]["id"], "standardCode": "ISO9001",
                                                      "validFrom": "2026-01-01", "validUntil": "2026-12-31",
                                                      "evidenceReference": f"IRCA-{tag}"})
        qual = track(QUAL, body)
        check("auditor qualification recorded (201)", s == 201 and qual.get("standardCode") == "ISO9001", f"{s} {body}")
        bad = {}
        for label, cmd in {"validity reversed": {"validFrom": "2026-12-31", "validUntil": "2026-01-01"},
                           "unknown standard": {"standardCode": "NOPE"}, "unknown auditor": {"auditorId": MISSING},
                           "bad date": {"validFrom": "01/01/2026"}}.items():
            base = {"auditorId": users["AudU"]["id"], "standardCode": "ISO9001", "validFrom": "2026-01-01",
                    "validUntil": "2026-12-31"}
            s, body = call(a, "POST", "/qualifications", {**base, **cmd})
            bad[label] = (s, field(body))
        check("qualification validation → 422 with the right field",
              bad == {"validity reversed": (422, "validUntil"), "unknown standard": (422, "standardCode"),
                      "unknown auditor": (422, "auditorId"), "bad date": (422, "validFrom")}, bad)

        # --- 2. cycles ----------------------------------------------------------------------------------
        def new_cycle(client, ref, **extra):
            s, body = call(client, "POST", "/cycles", {"reference": ref, "clientId": client_org["id"], "standardCode": "ISO9001",
                                                       "scope": "Design and manufacture of packaged foods", "siteCount": 2, **extra})
            return s, body, track(CYCLE, body)

        s, body, cyc = new_cycle(a, f"cyc-{tag}")
        check("cycle opened (201): manager, not ready for decision, decision blocked by policy",
              s == 201 and cyc.get("reference") == f"CYC-{tag}" and cyc.get("managedByMe") is True
              and cyc.get("readyForDecision") is False and cyc.get("decisionStatus") == "BLOCKED_BY_POLICY"
              and cyc.get("phase") == "STAGE1_PENDING"
              and cyc.get("decisionBlockers") == ["STAGE1_NOT_COMPLETED", "STAGE2_NOT_COMPLETED", "POLICY_D02"], f"{s} {body}")
        bad = {}
        for label, (ref, extra) in {"duplicate reference": (f"CYC-{tag}", {}), "bad reference": ("a b", {}),
                                    "unknown client": (f"X1-{tag}", {"clientId": MISSING}),
                                    "empty scope": (f"X2-{tag}", {"scope": " "}), "sites 0": (f"X3-{tag}", {"siteCount": 0}),
                                    "unknown standard": (f"X4-{tag}", {"standardCode": "NOPE"})}.items():
            s, body, _ = new_cycle(a, ref, **extra)
            bad[label] = (s, field(body))
        check("cycle validation → 422 with the right field, nothing created",
              [f for _, f in bad.values()] == ["reference", "reference", "clientId", "scope", "siteCount", "standardCode"]
              and all(s == 422 for s, _ in bad.values()) and not search(CYCLE, f"self.reference like 'X%-{tag}'"), bad)

        # --- 3. audit programme -------------------------------------------------------------------------
        def plan(client, cycle_row, type_, auditor, date="2026-11-10"):
            s, body = call(client, "POST", f"/cycles/{cycle_row['id']}/audits",
                           {"version": version(CYCLE, cycle_row["id"]), "type": type_, "plannedDate": date, "auditorId": auditor})
            return s, body, track(AUDIT, body)

        def eligible(client, cycle_row, date):
            s, body = call(client, "GET", f"/cycles/{cycle_row['id']}/eligible-auditors?date={date}")
            return s, [p["id"] for p in body.get("object") or []]

        s_e1, in_range = eligible(a, cyc, "2026-11-10")
        s_e2, expired = eligible(a, cyc, "2027-02-01")
        s_e3, _ = eligible(a, cyc, "11/10/2026")
        check("eligible auditors come from the server rule: qualified on the date only (unqualified and expired excluded)",
              s_e1 == s_e2 == 200 and users["AudQ"]["id"] in in_range and users["AudU"]["id"] not in in_range
              and users["AudQ"]["id"] not in expired and s_e3 == 422, f"{s_e1} {in_range} {s_e2} {expired} {s_e3}")
        s_unq, b_unq, _ = plan(a, cyc, "STAGE1", users["AudU"]["id"])
        s_exp, b_exp, _ = plan(a, cyc, "STAGE1", users["AudQ"]["id"], date="2027-02-01")
        check("unqualified auditor and a date outside the qualification → 422 NOT_QUALIFIED",
              (s_unq, field(b_unq), s_exp, field(b_exp)) == (422, "auditorId", 422, "auditorId")
              and (error(b_unq).get("fields") or [{}])[0].get("code") == "NOT_QUALIFIED", f"{s_unq} {s_exp}")
        s, body, stage1 = plan(a, cyc, "STAGE1", users["AudQ"]["id"])
        check("Stage 1 planned with a qualified lead auditor (201)", s == 201 and stage1.get("status") == "PLANNED"
              and stage1.get("auditorName") == "Wave4b AudQ", f"{s} {body}")
        s_dup, b_dup, _ = plan(a, cyc, "STAGE1", users["AudQ"]["id"])
        s_sur, b_sur, _ = plan(a, cyc, "SURVEILLANCE", users["AudQ"]["id"])
        s_bad, b_bad, _ = plan(a, cyc, "STAGE3", users["AudQ"]["id"])
        check("second Stage 1 → 409 STAGE_EXISTS; surveillance without the scheme's cert.cycle policy → 422 POLICY_NOT_SET; bad type → 422",
              s_dup == 409 and error(b_dup).get("code") == "STAGE_EXISTS" and s_sur == 422
              and error(b_sur).get("code") == "POLICY_NOT_SET" and "cert.cycle" in error(b_sur).get("message", "")
              and s_bad == 422 and field(b_bad) == "type", f"{s_dup} {s_sur} {error(b_sur)} {s_bad}")
        s, body, stage2 = plan(a, cyc, "STAGE2", users["AudQ"]["id"], date="2026-12-01")
        s_early, b_early = call(a, "POST", f"/audits/{stage2['id']}/complete",
                                {"version": version(AUDIT, stage2["id"]), "completedOn": "2026-12-01"})
        check("Stage 2 planned; completing it before Stage 1 → 422 STAGE1_REQUIRED",
              s == 201 and s_early == 422 and error(b_early).get("code") == "STAGE1_REQUIRED", f"{s} {s_early}")
        s_stale, _ = call(a, "POST", f"/audits/{stage1['id']}/complete",
                          {"version": version(AUDIT, stage1["id"]) - 1, "completedOn": "2026-11-10"})
        s, body = call(a, "POST", f"/audits/{stage1['id']}/complete",
                       {"version": version(AUDIT, stage1["id"]), "completedOn": "2026-11-10"})
        check("complete Stage 1: stale version → 409, then 200 COMPLETED",
              s_stale == 409 and s == 200 and (body.get("object") or {}).get("status") == "COMPLETED", f"{s_stale} {s}")

        # --- 4. nonconformities ---------------------------------------------------------------------------
        def raise_nc(client, audit_row, grade, statement="Calibration records missing for two scales", clause="7.1.5"):
            s, body = call(client, "POST", f"/audits/{audit_row['id']}/nonconformities",
                           {"version": version(AUDIT, audit_row["id"]), "grade": grade, "clause": clause, "statement": statement})
            return s, body, track(NC, body)

        s, body, major = raise_nc(a, stage1, "MAJOR")
        s2, _, minor = raise_nc(a, stage1, "MINOR", clause="9.2")
        s_bad, b_bad, _ = raise_nc(a, stage1, "CRITICAL")
        s_empty, b_empty, _ = raise_nc(a, stage1, "MINOR", statement=" ")
        check("nonconformities raised (MAJOR, MINOR); bad grade and empty statement → 422",
              s == s2 == 201 and major.get("status") == "OPEN" and (s_bad, field(b_bad)) == (422, "grade")
              and (s_empty, field(b_empty)) == (422, "statement"), f"{s} {s2} {s_bad} {s_empty}")
        call(a, "POST", f"/audits/{stage2['id']}/complete", {"version": version(AUDIT, stage2["id"]), "completedOn": "2026-12-01"})
        _, body = call(a, "GET", f"/cycles/{cyc['id']}")
        v = body.get("object") or {}
        check("Stage 2 completed but an open major → not ready for decision (openMajors 1)",
              v.get("readyForDecision") is False and v.get("openMajors") == 1, v)
        s_close, b_close = call(a, "POST", f"/nonconformities/{major['id']}/close", {"version": version(NC, major["id"])})
        s_resp, _ = call(a, "POST", f"/nonconformities/{major['id']}/respond",
                         {"version": version(NC, major["id"]), "response": "Scales calibrated; procedure updated"})
        s_close2, b_close2 = call(a, "POST", f"/nonconformities/{major['id']}/close", {"version": version(NC, major["id"])})
        check("close without a response → 422 RESPONSE_REQUIRED; respond → close (200 CLOSED)",
              s_close == 422 and error(b_close).get("code") == "RESPONSE_REQUIRED" and s_resp == 200 and s_close2 == 200
              and (b_close2.get("object") or {}).get("status") == "CLOSED", f"{s_close} {s_resp} {s_close2}")
        _, body = call(a, "GET", f"/cycles/{cyc['id']}")
        v = body.get("object") or {}
        check("major closed → ready for decision (a minor may stay open)",
              v.get("readyForDecision") is True and v.get("openMajors") == 0, v)

        check("ready cycle: phase READY_FOR_DECISION, only the D-02 blocker left",
              v.get("phase") == "READY_FOR_DECISION" and v.get("decisionBlockers") == ["POLICY_D02"], v)
        _, body = call(a, "GET", f"/cycles/{cyc['id']}/timeline")
        kinds = [e["kind"] for e in body.get("object") or []]
        check("timeline: opened, planned, completed, findings raised, responded and closed, newest first",
              {"CYCLE_OPENED", "AUDIT_PLANNED", "AUDIT_COMPLETED", "NC_RAISED", "NC_RESPONDED", "NC_CLOSED"} <= set(kinds)
              and kinds[-1] == "CYCLE_OPENED", kinds)

        def listed(client, query):
            s, body = call(client, "GET", "/cycles?" + query)
            return s, [c["reference"] for c in body.get("object") or []]

        new_cycle(a, f"F2-{tag}", scope="Second site scope")
        s1, refs1 = listed(a, f"q=cyc-{tag.lower()}")
        s2, refs2 = listed(a, f"q={tag}&phase=READY_FOR_DECISION&mine=true")
        s3, refs3 = listed(a, f"q={tag}&standardCode=ISO22000")
        s4, refs4 = listed(a, f"q={tag}&limit=1&offset=0")
        s5, refs5 = listed(b, f"q={tag}")
        s6, _ = listed(a, "phase=NOPE")
        s7, _ = listed(a, "limit=500")
        check("register: search, phase, mine, standard and paging combine with record permissions; bad filters → 400/422",
              (s1, s2, s3, s4, s5) == (200,) * 5 and refs1 == [f"CYC-{tag}"] and refs2 == [f"CYC-{tag}"] and refs3 == []
              and len(refs4) == 1 and refs5 == [] and s6 == 422 and s7 == 400, f"{refs1} {refs2} {refs3} {refs4} {refs5} {s6} {s7}")
        s_dir_ro, _ = call(ro_c, "GET", "/qualifications/candidates")
        s_dir_a, b_dir_a = call(a, "GET", "/qualifications/candidates")
        check("internal auditor directory: id and name only, for those who may record qualifications (read-only → 403)",
              s_dir_ro == 403 and s_dir_a == 200
              and all(set(p) == {"id", "name"} for p in b_dir_a.get("object") or []), f"{s_dir_ro} {s_dir_a}")

        # --- 5. policy, scope and states --------------------------------------------------------------
        s_dec, b_dec = call(a, "POST", f"/cycles/{cyc['id']}/decision",
                            {"version": version(CYCLE, cyc["id"]), "vote": "GRANT", "reason": "probe"})
        s_cert, _ = call(a, "POST", f"/cycles/{cyc['id']}/certificate")
        check("the programme manager without the decision right → 403 NO_DECISION_RIGHT; no certificate is issued on request (POST /certificate → 404/405)",
              s_dec == 403 and error(b_dec).get("code") == "NO_DECISION_RIGHT" and s_cert in (404, 405), f"{s_dec} {error(b_dec)} {s_cert}")
        s_other, b_other = call(b, "GET", f"/cycles/{cyc['id']}")
        s_missing, b_missing = call(b, "GET", f"/cycles/{MISSING}")
        s_aud_b, _ = call(b, "GET", f"/cycles/{cyc['id']}/audits")
        s_tl_b, _ = call(b, "GET", f"/cycles/{cyc['id']}/timeline")
        s_el_b, _ = call(b, "GET", f"/cycles/{cyc['id']}/eligible-auditors?date=2026-11-10")
        s_nc_b, _ = call(b, "POST", f"/audits/{stage1['id']}/nonconformities",
                         {"version": version(AUDIT, stage1["id"]), "grade": "MINOR", "statement": "x"})
        check("another manager: cycle, audits and findings answer like missing ids (404)",
              s_other == s_missing == s_aud_b == s_nc_b == s_tl_b == s_el_b == 404
              and error(b_other).get("code") == error(b_missing).get("code"), f"{s_other} {s_missing} {s_aud_b} {s_nc_b}")
        s_ro_get, _ = call(ro_c, "GET", f"/audits/{stage1['id']}/nonconformities")
        s_ro_post, _ = call(ro_c, "POST", f"/nonconformities/{minor['id']}/respond",
                            {"version": version(NC, minor["id"]), "response": "x"})
        check("read-only: reads (200), cannot change (403)", s_ro_get == 200 and s_ro_post == 403, f"{s_ro_get} {s_ro_post}")
        s, body, c2 = new_cycle(a, f"C2-{tag}")
        _, _, planned = plan(a, c2, "STAGE1", users["AudQ"]["id"])
        s_cancel, _ = call(a, "POST", f"/audits/{planned['id']}/cancel", {"version": version(AUDIT, planned["id"])})
        s_nc_cancelled, b_nc_cancelled, _ = raise_nc(a, planned, "MINOR")
        s_cancel_done, b_cancel_done = call(a, "POST", f"/audits/{stage1['id']}/cancel", {"version": version(AUDIT, stage1["id"])})
        check("cancel a planned audit (200); findings on it → 422 AUDIT_CANCELLED; completed audit → 422 AUDIT_STATE",
              s_cancel == 200 and s_nc_cancelled == 422 and error(b_nc_cancelled).get("code") == "AUDIT_CANCELLED"
              and s_cancel_done == 422 and error(b_cancel_done).get("code") == "AUDIT_STATE",
              f"{s_cancel} {s_nc_cancelled} {s_cancel_done}")

        # --- 6. concurrency ---------------------------------------------------------------------------
        outcomes = []
        for i in range(ROUNDS):
            _, _, row = new_cycle(a, f"R{i}-{tag}")
            v0 = version(CYCLE, row["id"])
            gate, answers = threading.Barrier(2), []

            def run(client):
                gate.wait()
                answers.append(client.call("POST", f"{BASE}/cycles/{row['id']}/audits",
                                           {"version": v0, "type": "STAGE1", "plannedDate": "2026-11-10",
                                            "auditorId": users["AudQ"]["id"]}))

            threads = [threading.Thread(target=run, args=(c,)) for c in (a, a2)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            for _, body in answers:
                track(AUDIT, body)
            outcomes.append((sorted(s for s, _ in answers), len(search(AUDIT, f"self.cycle.id = {row['id']}"))))
        check(f"concurrent Stage 1 plans on one version: one 201 and one 409, exactly one audit ({ROUNDS} cycles)",
              all(s == [201, 409] and n == 1 for s, n in outcomes), outcomes)

        # --- 7. D-02: decision, certificate, public check ---------------------------------------------------
        dec1, dec2, dec3, audq, owner = (sessions[k] for k in ("Dec1", "Dec2", "Dec3", "AudQ", "Owner"))
        anon = Client()
        s, _ = admin.call("POST", POLICIES + "/owners", {"userId": users["Owner"]["id"]})
        assert s == 200, f"appointing the policy owner: {s}"
        today = date.today()
        schemes = {k: create(BL, {"code": f"{k}{tag}", "nameEn": f"Cert probe scheme {k} {tag}", "nameAr": "معيار تجريبي",
                                  "statusSelect": 2}) for k in ("CB", "CC")}
        cb, cc = schemes["CB"]["code"], schemes["CC"]["code"]

        def set_policy(key, value, scope=None):
            body = {"value": value, "reason": f"probe {tag}"}
            if scope:
                body["scope"] = scope
            s_, b_ = owner.call("POST", f"{POLICIES}/{key}", body)
            assert s_ == 201, f"setting {key}: {s_} {b_}"

        values = {"cert.decision": {"mode": "INDEPENDENT_REVIEWER"}, "cert.cycle": {"validityMonths": 36, "surveillanceMonths": 12}}
        if search(VERSION, "self.policyKey IN ('cert.decision', 'cert.cycle') AND self.scopeKey IS NULL"):
            # a company-wide default would apply to the fixture schemes: set and retire a scoped value so they are not set
            for key, value in values.items():
                for scope in (cb, cc):
                    set_policy(key, value, scope)
                    s_, b_ = owner.call("POST", f"{POLICIES}/{key}/retire", {"scope": scope, "reason": f"probe {tag}"})
                    assert s_ == 200, f"retiring {key}: {s_} {b_}"
        set_policy("channels.enabled", {"channels": []})
        for code in (cb, cc):
            s_, b_ = call(a, "POST", "/qualifications", {"auditorId": users["AudQ"]["id"], "standardCode": code,
                                                         "validFrom": str(today - timedelta(days=30)),
                                                         "validUntil": str(today + timedelta(days=6 * 366))})
            track(QUAL, b_)
            assert s_ == 201, f"qualification for {code}: {s_} {b_}"

        def ready_cycle(ref, code):
            s_, b_ = call(a, "POST", "/cycles", {"reference": ref, "clientId": client_org["id"], "standardCode": code,
                                                  "scope": "Design and manufacture of packaged foods", "siteCount": 1})
            row = track(CYCLE, b_)
            assert s_ == 201, f"cycle {ref}: {s_} {b_}"
            for stage in ("STAGE1", "STAGE2"):
                s_, _, au = plan(a, row, stage, users["AudQ"]["id"], date=str(today))
                assert s_ == 201, f"{stage} for {ref}: {s_}"
                s_, b_ = call(a, "POST", f"/audits/{au['id']}/complete", {"version": version(AUDIT, au["id"]), "completedOn": str(today)})
                assert s_ == 200, f"completing {stage} for {ref}: {s_} {b_}"
            return row, au

        def decide(client, row, vote="GRANT", reason="Stage 2 completed and every major closed", **extra):
            body = {"version": version(CYCLE, row["id"]), "vote": vote, "reason": reason, **extra}
            s_, b_ = call(client, "POST", f"/cycles/{row['id']}/decision", body)
            return s_, b_, b_.get("object") or {}

        def panel(client, row):
            s_, b_ = call(client, "GET", f"/cycles/{row['id']}/decision")
            return s_, b_.get("object") or {}

        d1, d1_stage2 = ready_cycle(f"D1-{tag}", cb)
        s, p1 = panel(dec1, d1)
        s_v, b_v, _ = decide(dec1, d1)
        _, b_c = call(a, "GET", f"/cycles/{d1['id']}")
        cv = b_c.get("object") or {}
        check("fail closed: without the scheme's cert.decision and cert.cycle the panel says so and a decision → 422 POLICY_NOT_SET",
              s == 200 and p1.get("status") == "BLOCKED_BY_POLICY" and p1.get("missingPolicies") == ["cert.decision", "cert.cycle"]
              and p1.get("canVote") is False and s_v == 422 and error(b_v).get("code") == "POLICY_NOT_SET"
              and cv.get("readyForDecision") is True and cv.get("decisionBlockers") == ["POLICY_D02"]
              and cv.get("decisionStatus") == "BLOCKED_BY_POLICY", f"{s} {p1.get('status')} {p1.get('missingPolicies')} {s_v} {error(b_v)} {cv}")
        set_policy("cert.decision", values["cert.decision"], cb)
        s_v, b_v, _ = decide(dec1, d1)
        check("only the decision mode set: still 422 POLICY_NOT_SET, naming cert.cycle",
              s_v == 422 and error(b_v).get("code") == "POLICY_NOT_SET" and "cert.cycle" in error(b_v).get("message", ""), f"{s_v} {error(b_v)}")
        set_policy("cert.cycle", values["cert.cycle"], cb)
        s, p1 = panel(dec1, d1)
        _, pq = panel(audq, d1)
        _, pa = panel(a, d1)
        eligible_ids = {x["id"] for x in p1.get("eligibleDeciders") or []}
        check("panel: independent reviewer, 36/12 months; eligible = decision role holders who never audited the client",
              s == 200 and p1.get("status") == "AWAITING_DECISION" and p1.get("mode") == "INDEPENDENT_REVIEWER" and p1.get("requiredVotes") == 1
              and (p1.get("validityMonths"), p1.get("surveillanceMonths")) == (36, 12) and p1.get("canVote") is True and p1.get("canGrant") is True
              and {users[k]["id"] for k in ("Dec1", "Dec2", "Dec3")} <= eligible_ids and users["AudQ"]["id"] not in eligible_ids
              and pq.get("cannotDecideReason") == "AUDITED_CLIENT" and pq.get("canVote") is False
              and pa.get("cannotDecideReason") == "NO_DECISION_RIGHT", f"{p1} {pq.get('cannotDecideReason')} {pa.get('cannotDecideReason')}")
        s_m, b_m, _ = decide(a, d1)
        s_q, b_q, _ = decide(audq, d1)
        s_b, b_b, _ = decide(b, d1)
        s_st, _ = call(dec1, "POST", f"/cycles/{d1['id']}/decision",
                       {"version": version(CYCLE, d1["id"]) - 1, "vote": "GRANT", "reason": "x"})
        s_bv, b_bv, _ = decide(dec1, d1, vote="MAYBE")
        s_br, b_br, _ = decide(dec1, d1, reason=" ")
        check("who decides: no role → 403 NO_DECISION_RIGHT; auditor of the client → 403 AUDITED_CLIENT; another manager → 404;"
              " stale version → 409; bad vote or empty reason → 422 field",
              (s_m, error(b_m).get("code"), s_q, error(b_q).get("code"), s_b, s_st) == (403, "NO_DECISION_RIGHT", 403, "AUDITED_CLIENT", 404, 409)
              and (s_bv, field(b_bv), s_br, field(b_br)) == (422, "vote", 422, "reason"),
              f"{s_m} {error(b_m)} {s_q} {error(b_q)} {s_b} {s_st} {s_bv} {field(b_bv)} {s_br} {field(b_br)}")
        s_nc, _, major = raise_nc(a, d1_stage2, "MAJOR", statement="Traceability records missing for one line")
        s_g, b_g, _ = decide(dec1, d1)
        call(a, "POST", f"/nonconformities/{major['id']}/respond", {"version": version(NC, major["id"]), "response": "Records restored"})
        call(a, "POST", f"/nonconformities/{major['id']}/close", {"version": version(NC, major["id"])})
        check("an open major blocks a GRANT (422 NOT_READY), nothing is recorded",
              s_nc == 201 and s_g == 422 and error(b_g).get("code") == "NOT_READY" and not search(VOTE, f"self.decision.cycle.id = {d1['id']}"),
              f"{s_nc} {s_g} {error(b_g)}")
        s_g, b_g, pg = decide(dec1, d1)
        cert = pg.get("certificate") or {}
        issued = date.fromisoformat(cert.get("issuedOn") or "1970-01-01")
        _, b_c = call(ro_c, "GET", f"/cycles/{d1['id']}")
        cv = b_c.get("object") or {}
        check("independent reviewer GRANT issues the certificate: <scheme>-<year>-0001, ACTIVE, expiry = issue + 36 months,"
              " surveillance at +12 and +24 months; the cycle reads CERTIFIED",
              s_g == 200 and pg.get("status") == "GRANTED" and cert.get("number") == f"{cb}-{issued.year}-0001" and cert.get("status") == "ACTIVE"
              and cert.get("expiresOn") == str(add_months(issued, 36))
              and [x["dueOn"] for x in cert.get("surveillance") or []] == [str(add_months(issued, 12)), str(add_months(issued, 24))]
              and [e["action"] for e in cert.get("events") or []] == ["ISSUED"] and cv.get("phase") == "CERTIFIED"
              and cv.get("certificateNumber") == cert.get("number") and cv.get("decisionStatus") == "GRANTED"
              and (pg.get("pastRounds") or [{}])[0].get("votes", [{}])[0].get("reason") == "Stage 2 completed and every major closed",
              f"{s_g} {error(b_g)} {pg.get('status')} {cert} {cv.get('phase')}")
        s_again, b_again, _ = decide(dec2, d1)
        notified = search(NOTICE, f"self.recipient.id = {users['MgrA']['id']} AND self.kind = 'CERT_GRANTED' AND self.subjectId = {d1['id']}")
        check("a second decision on a certified cycle → 409 ALREADY_CERTIFIED; the programme manager is told in-app",
              s_again == 409 and error(b_again).get("code") == "ALREADY_CERTIFIED" and len(notified) == 1, f"{s_again} {error(b_again)} {len(notified)}")

        # public check (D-10 channel)
        number = cert.get("number") or "NONE"
        s_off, b_off = anon.call("GET", f"{PUBLIC}/{number}")
        s_unk_off, b_unk_off = anon.call("GET", f"{PUBLIC}/{cb}-1999-9999")
        set_policy("channels.enabled", {"channels": ["CERTIFICATE_CHECK"]})
        s_on, b_on = anon.call("GET", f"{PUBLIC}/{number.lower()}")
        s_unk, b_unk = anon.call("GET", f"{PUBLIC}/{cb}-1999-9999")
        s_list, _ = anon.call("GET", PUBLIC)
        s_like, _ = anon.call("GET", f"{PUBLIC}/{cb}%25")
        shown = b_on.get("object") if isinstance(b_on, dict) else None
        check("public check: channel off → 404 exactly like an unknown number; on → only number, standard, client, status and expiry;"
              " unknown → 404; no listing or wildcard",
              (s_off, s_unk_off) == (404, 404) and error(b_off).get("code") == error(b_unk_off).get("code") == "NOT_FOUND"
              and s_on == 200 and shown == {"number": number, "standardCode": cb, "clientName": client_org["name"], "status": "ACTIVE",
                                            "expiresOn": cert.get("expiresOn")}
              and s_unk == 404 and s_list in (404, 405) and s_like == 404, f"{s_off} {s_unk_off} {s_on} {shown} {s_unk} {s_list} {s_like}")

        # certificate life
        def act(client, row, action, reason="Client misused the certification mark", stale=False):
            current = ((panel(dec1, row)[1].get("certificate")) or {}).get("version")
            return call(client, "POST", f"/cycles/{row['id']}/certificate/{action}",
                        {"version": (current or 0) - (1 if stale else 0), "reason": reason})

        s_m, b_m = act(a, d1, "suspend")
        s_q, b_q = act(audq, d1, "suspend")
        s_st, _ = act(dec2, d1, "suspend", stale=True)
        s_bad, _ = act(dec2, d1, "reissue")
        s_rs, b_rs = act(dec2, d1, "restore")
        s_sp, b_sp = act(dec2, d1, "suspend")
        _, b_pub = anon.call("GET", f"{PUBLIC}/{number}")
        check("suspend: no role → 403, auditor of the client → 403, stale → 409, unknown action → 404, restore an active one → 422;"
              " eligible person → SUSPENDED, and the public check says so",
              (s_m, s_q, s_st, s_bad, s_rs) == (403, 403, 409, 404, 422) and error(b_rs).get("code") == "CERTIFICATE_STATE"
              and s_sp == 200 and ((b_sp.get("object") or {}).get("certificate") or {}).get("status") == "SUSPENDED"
              and (b_pub.get("object") or {}).get("status") == "SUSPENDED", f"{s_m} {s_q} {s_st} {s_bad} {s_rs} {s_sp} {b_pub}")
        s_rs, b_rs = act(dec3, d1, "restore", reason="Corrective action verified")
        due = ((b_rs.get("object") or {}).get("certificate") or {}).get("surveillance") or [{}]
        s_s1, _, surv = plan(a, d1, "SURVEILLANCE", users["AudQ"]["id"], date=due[0].get("dueOn", str(today)))
        s_s2, b_s2, _ = plan(a, d1, "SURVEILLANCE", users["AudQ"]["id"], date=due[0].get("dueOn", str(today)))
        s_rc, _, _ = plan(a, d1, "RECERTIFICATION", users["AudQ"]["id"], date=str(today + timedelta(days=60)))
        check("restore → ACTIVE; surveillance is planned on its due date (201), one planned at a time (409 STAGE_EXISTS); recertification (201)",
              s_rs == 200 and ((b_rs.get("object") or {}).get("certificate") or {}).get("status") == "ACTIVE"
              and s_s1 == 201 and surv.get("type") == "SURVEILLANCE" and s_s2 == 409 and error(b_s2).get("code") == "STAGE_EXISTS"
              and s_rc == 201, f"{s_rs} {s_s1} {s_s2} {s_rc}")
        s_w, b_w = act(dec1, d1, "withdraw", reason="Certification mark misuse continued")
        s_after, b_after = act(dec1, d1, "restore")
        s_s3, b_s3, _ = plan(a, d1, "SURVEILLANCE", users["AudQ"]["id"], date=str(today + timedelta(days=400)))
        _, b_pub = anon.call("GET", f"{PUBLIC}/{number}")
        events = ((b_w.get("object") or {}).get("certificate") or {}).get("events") or []
        check("withdraw is final (restore → 422); the history keeps who and why; the public check says WITHDRAWN;"
              " no surveillance on a withdrawn certificate (422 CERTIFICATE_REQUIRED)",
              s_w == 200 and s_after == 422 and error(b_after).get("code") == "CERTIFICATE_STATE"
              and [e["action"] for e in events] == ["ISSUED", "SUSPENDED", "RESTORED", "WITHDRAWN"]
              and events[-1].get("reason") == "Certification mark misuse continued" and events[-1].get("actorName") == "Wave4b Dec1"
              and (b_pub.get("object") or {}).get("status") == "WITHDRAWN"
              and s_s3 == 422 and error(b_s3).get("code") == "CERTIFICATE_REQUIRED",
              f"{s_w} {s_after} {[e.get('action') for e in events]} {b_pub.get('object')} {s_s3} {error(b_s3)}")

        # committee of 3, then a committee of 2 that splits
        set_policy("cert.decision", {"mode": "COMMITTEE", "committeeSize": 3}, cc)
        set_policy("cert.cycle", {"validityMonths": 24, "surveillanceMonths": 6}, cc)
        d2, _ = ready_cycle(f"D2-{tag}", cc)
        s1, _, p_a = decide(dec1, d2, reason="Grant: system effective")
        s1b, b1b, _ = decide(dec1, d2, reason="again")
        open_round = p_a.get("openRound") or {}
        asked = search(NOTICE, f"self.kind = 'CERT_VOTE_NEEDED' AND self.subjectId = {d2['id']} AND self.recipient.id IN ({users['Dec2']['id']},{users['Dec3']['id']})")
        check("committee of 3: the first vote opens the round (1 of 3, how it voted hidden), the others are told in-app; voting twice → 409",
              s1 == 200 and p_a.get("status") == "AWAITING_DECISION" and open_round.get("votesCast") == 1 and open_round.get("requiredVotes") == 3
              and [v.get("vote") for v in open_round.get("votes") or []] == [None] and not p_a.get("certificate")
              and s1b == 409 and error(b1b).get("code") == "ALREADY_VOTED" and len(asked) == 2,
              f"{s1} {p_a.get('status')} {open_round} {s1b} {error(b1b)} {len(asked)}")
        s2, _, p_b = decide(dec2, d2, vote="REFUSE", reason="Refuse: internal audit weak")
        s3, _, p_c = decide(dec3, d2, reason="Grant: evidence sufficient")
        decided = (p_c.get("pastRounds") or [{}])[0]
        cert2 = p_c.get("certificate") or {}
        issued2 = date.fromisoformat(cert2.get("issuedOn") or "1970-01-01")
        check("committee: the third vote decides by majority (2 grant, 1 refuse), votes and reasons are shown, the certificate follows"
              " the scheme's own cycle policy (24/6 months)",
              s2 == s3 == 200 and (p_b.get("openRound") or {}).get("votesCast") == 2 and p_c.get("status") == "GRANTED"
              and (decided.get("outcome"), decided.get("grantVotes"), decided.get("refuseVotes")) == ("GRANT", 2, 1)
              and sorted(v.get("vote") for v in decided.get("votes") or []) == ["GRANT", "GRANT", "REFUSE"]
              and cert2.get("number") == f"{cc}-{issued2.year}-0001" and cert2.get("expiresOn") == str(add_months(issued2, 24))
              and len(cert2.get("surveillance") or []) == 3, f"{s2} {s3} {p_c.get('status')} {decided} {cert2}")
        set_policy("cert.decision", {"mode": "COMMITTEE", "committeeSize": 2}, cc)
        d3, _ = ready_cycle(f"D3-{tag}", cc)
        decide(dec1, d3, reason="Grant")
        s_t, _, p_t = decide(dec2, d3, vote="REFUSE", reason="Refuse")
        s_n, _, p_n = decide(dec3, d3, reason="Grant after more evidence")
        check("a committee of 2 that splits refuses (tie), no certificate; a new round can then start",
              s_t == 200 and p_t.get("status") == "REFUSED" and not p_t.get("certificate")
              and (p_t.get("pastRounds") or [{}])[0].get("outcome") == "REFUSE"
              and s_n == 200 and (p_n.get("openRound") or {}).get("votesCast") == 1, f"{s_t} {p_t.get('status')} {s_n} {p_n.get('openRound')}")

        # two decision makers granting one cycle at once
        races = []
        for i in range(max(1, ROUNDS // 2)):
            row, _ = ready_cycle(f"G{i}-{tag}", cb)
            v0 = version(CYCLE, row["id"])
            gate, answers = threading.Barrier(2), []

            def grant(client):
                gate.wait()
                answers.append(client.call("POST", f"{BASE}/cycles/{row['id']}/decision",
                                           {"version": v0, "vote": "GRANT", "reason": "concurrent probe"})[0])

            threads = [threading.Thread(target=grant, args=(c,)) for c in (dec2, dec3)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            races.append((sorted(answers), len(search(CERT, f"self.cycle.id = {row['id']}"))))
        check(f"two decision makers granting one cycle at once: one 200, one 409, exactly one certificate ({len(races)} cycles)",
              all(r == ([200, 409], 1) for r in races), races)

        failed = [r for r in RESULTS if r["result"] != "PASS"]
        print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
        exit_code = 0 if not failed else 1
    finally:
        cycle_ids = [r["id"] for r in search(CYCLE, f"self.reference like '%{tag}'")]
        if cycle_ids:
            ids = ",".join(map(str, cycle_ids))
            for model, domain in ((CEVENT, f"self.certificate.cycle.id in ({ids})"), (CERT, f"self.cycle.id in ({ids})"),
                                  (VOTE, f"self.decision.cycle.id in ({ids})"), (DECISION, f"self.cycle.id in ({ids})"),
                                  (NOTICE, f"self.subject = 'CERT_CYCLE' AND self.subjectId in ({ids})"),
                                  (NC, f"self.audit.cycle.id in ({ids})"), (AUDIT, f"self.cycle.id in ({ids})"),
                                  (CYCLE, f"self.id in ({ids})")):
                for row in search(model, domain):
                    if (model, row["id"]) not in created:
                        created.append((model, row["id"]))
        auditor_ids = [u["id"] for k, u in users.items() if k in ("AudQ", "AudU")]
        if auditor_ids:
            for row in search(QUAL, f"self.auditor.id in ({','.join(map(str, auditor_ids))})"):
                if (QUAL, row["id"]) not in created:
                    created.append((QUAL, row["id"]))
        user_ids = ",".join(str(u["id"]) for u in users.values()) or "0"
        for model, domain in ((VERSION, f"self.author.id in ({user_ids})"),
                              (ADMIN_AUDIT, f"self.actor.id in ({user_ids}) OR (self.subject = 'USER' AND self.subjectId in ({user_ids}))"),
                              (NOTICE, f"self.recipient.id in ({user_ids})")):
            for row in search(model, domain):
                if (model, row["id"]) not in created:
                    created.append((model, row["id"]))
        for u in users.values():
            # roles first (the policy-owner role and the decision role), so the users can be deleted
            cur = (search(USER, f"self.id = {u['id']}", ("version",)) or [{}])[0]
            if cur.get("id"):
                admin.call("POST", f"/ws/rest/{USER}/{u['id']}", {"data": {"id": u["id"], "version": cur.get("version"), "roles": []}})
        if role_existed:
            created = [(m, r) for m, r in created if m != ROLE]
        if not owner_role_existed:
            created.extend((ROLE, r["id"]) for r in search(ROLE, f"self.name = '{OWNER_ROLE}'"))
        complete, leftovers = cleanup(admin, created, {CEVENT: 0, VOTE: 0, NOTICE: 0, NC: 0, CERT: 1, AUDIT: 1, DECISION: 2,
                                                       CYCLE: 3, QUAL: 3, VERSION: 3, ADMIN_AUDIT: 3, PARTNER: 4, BL: 4,
                                                       USER: 5, GROUP: 6, ROLE: 6, PERM: 7})
        if not complete:
            print(f"FAIL cleanup left {leftovers}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "certification-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete}, f, indent=2)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
