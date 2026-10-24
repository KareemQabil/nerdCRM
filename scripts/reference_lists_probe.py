#!/usr/bin/env python3
"""Reference lists (lost reasons, lead sources, opportunity stages) managed by administrators: live probe
against a RUNNING local/CI Axelor; never against production. A sales rep built from native permissions is a
TEST FIXTURE. Every value added here is removed and the original stage order is restored afterwards.
Checks:
  access: anonymous 401, a non-administrator 403 on every list call, an unknown list 404
  lost reasons: add (201), the same name in other letter case → 422 DUPLICATE, rename, stale version → 409,
  offered to sellers at once, a reason in use cannot be deleted (409 IN_USE) and shows its use count, an
  unused one is deleted; the change log records each change
  sources: add, offered at lead intake, rename, delete when unused
  stages: won, lost and default are marked; a new stage lands before won and lost; reorder (incomplete
  order → 422); the sellers' stage path follows; a core stage cannot be deleted (422 PROTECTED)
Report: logs/reference-lists-probe.json.
"""
import json
import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import cleanup  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
OPP, LINE, LEAD = "com.axelor.apps.crm.db.Opportunity", "com.ioeti.businessline.db.BusinessLine", "com.axelor.apps.crm.db.Lead"
REASON, SOURCE, STAGE = "com.axelor.apps.crm.db.LostReason", "com.axelor.apps.base.db.Source", "com.axelor.apps.crm.db.OpportunityStatus"
AL = "/ws/ioeti/admin/lists"
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
    created, added = [], []  # fixtures; list values added through the API
    original_order = [r["id"] for r in rows(admin.call("GET", AL + "/opportunity-stages")[1]) if r.get("role") not in ("WON", "LOST")]

    def create(model, values):
        _, body = rest_create(admin, model, values)
        if not ok(body):
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}: {json.dumps(body)[:200]}")
        created.append((model, body["data"][0]["id"]))
        return body["data"][0]

    exit_code = 1
    try:
        line = create(LINE, {"code": f"RL{tag}", "nameEn": f"Lists line {tag}", "nameAr": "خط القوائم", "statusSelect": 2})
        perms = [create(PERM, {"name": f"lists.{n}.{tag}", "object": m, "canRead": True, "canWrite": w, "canCreate": w,
                               **({"condition": "self.user = ?", "conditionParams": "__user__"} if c else {})})
                 for n, m, w, c in (("opp", OPP, True, True), ("lead", LEAD, True, True), ("line", LINE, False, False))]
        group = create(GROUP, {"code": f"lists-rep-{tag}", "name": f"Lists rep {tag}", "permissions": [{"id": p["id"]} for p in perms]})
        password = "Rl!" + secrets.token_urlsafe(14)
        rep_user = create(USER, {"code": f"lists.rep.{tag}", "name": f"Lists Rep {tag}", "blocked": False, "language": "ar",
                                 "group": {"id": group["id"]}, "password": axelor_password_hash(password), "ioetiBusinessLines": [{"id": line["id"]}]})
        rep, anon = Client(), Client()
        assert rep.login(rep_user["code"], password) == 200

        # --- access --------------------------------------------------------------------------------------
        s1, _ = anon.call("GET", AL + "/lost-reasons")
        s2, _ = rep.call("GET", AL + "/lost-reasons")
        s3, _ = rep.call("POST", AL + "/lost-reasons", {"name": "تسلل"})
        s4, _ = rep.call("POST", AL + "/opportunity-stages/order", {"ids": original_order})
        s5, _ = admin.call("GET", AL + "/colours")
        check("anonymous 401; a non-administrator 403 on read, add and reorder; an unknown list 404", (s1, s2, s3, s4, s5) == (401, 403, 403, 403, 404), (s1, s2, s3, s4, s5))

        # --- lost reasons --------------------------------------------------------------------------------
        s, body = admin.call("POST", AL + "/lost-reasons", {"name": f"السعر أعلى من الميزانية {tag}"})
        reason = obj(body)
        if reason.get("id"):
            added.append((REASON, reason["id"]))
        check("an administrator adds a lost reason (201, unused)", s == 201 and reason.get("uses") == 0, (s, reason))
        s, body = admin.call("POST", AL + "/lost-reasons", {"name": f"السعر أعلى من الميزانية {tag}".upper()})
        s_blank, b_blank = admin.call("POST", AL + "/lost-reasons", {"name": "  "})
        check("the same name again → 422 DUPLICATE; an empty name → 422 REQUIRED", (s, err(body)[1], s_blank, err(b_blank)[1]) == (422, "DUPLICATE", 422, "REQUIRED"),
              (s, err(body), s_blank, err(b_blank)))
        s, body = admin.call("POST", f"{AL}/lost-reasons/{reason.get('id')}", {"version": reason.get("version"), "name": f"السعر {tag}"})
        renamed = obj(body)
        s_stale, _ = admin.call("POST", f"{AL}/lost-reasons/{reason.get('id')}", {"version": reason.get("version"), "name": f"قديم {tag}"})
        check("rename (200), then the old version → 409", s == 200 and renamed.get("name") == f"السعر {tag}" and s_stale == 409, (s, renamed, s_stale))
        s, body = rep.call("GET", "/ws/ioeti/opportunities/lost-reasons")
        check("sellers are offered the new reason at once", any(r["id"] == reason.get("id") and r["name"] == f"السعر {tag}" for r in rows(body)), rows(body))
        s, body = rep.call("POST", "/ws/ioeti/opportunities", {"name": f"فرصة القوائم {tag}", "businessLineCode": line["code"]})
        opp = obj(body)
        if opp.get("id"):
            created.append((OPP, opp["id"]))
        s, body = rep.call("POST", f"/ws/ioeti/opportunities/{opp.get('id')}/lose", {"version": opp.get("version"), "lostReasonId": reason.get("id")})
        check("a seller marks an opportunity lost with it", s == 200 and obj(body).get("stageKind") == "LOST", (s, err(body)))
        listed = {r["id"]: r for r in rows(admin.call("GET", AL + "/lost-reasons")[1])}
        s, body = admin.call("POST", f"{AL}/lost-reasons/{reason.get('id')}/delete", {"version": renamed.get("version")})
        check("the reason now shows one use and cannot be deleted (409 IN_USE)",
              listed.get(reason.get("id"), {}).get("uses") == 1 and (s, err(body)[0]) == (409, "IN_USE"), (listed.get(reason.get("id")), s, err(body)))
        s, body = admin.call("POST", AL + "/lost-reasons", {"name": f"سبب مؤقت {tag}"})
        spare = obj(body)
        s, body = admin.call("POST", f"{AL}/lost-reasons/{spare.get('id')}/delete", {"version": spare.get("version")})
        check("an unused reason is deleted and leaves the list", s == 200 and not any(r["id"] == spare.get("id") for r in rows(body)), (s, err(body)))
        if s != 200 and spare.get("id"):
            added.append((REASON, spare["id"]))
        s, body = admin.call("GET", "/ws/ioeti/admin/audit?subject=LOST_REASON&limit=20")
        actions = {r["action"] for r in rows(body) if r.get("subjectId") in (reason.get("id"), spare.get("id"))}
        check("the change log has the add, rename and delete", {"LOST_REASON_ADDED", "LOST_REASON_RENAMED", "LOST_REASON_DELETED"} <= actions, actions)

        # --- sources -------------------------------------------------------------------------------------
        s, body = admin.call("POST", AL + "/sources", {"name": f"معرض القاهرة {tag}"})
        source = obj(body)
        if source.get("id"):
            added.append((SOURCE, source["id"]))
        s2, b2 = rep.call("GET", "/ws/ioeti/marketing/sources")
        s3, b3 = admin.call("POST", f"{AL}/sources/{source.get('id')}", {"version": source.get("version"), "name": f"معرض القاهرة الدولي {tag}"})
        s4, b4 = admin.call("POST", f"{AL}/sources/{source.get('id')}/delete", {"version": obj(b3).get("version")})
        check("sources: add, offered at intake, rename, delete when unused",
              s == 201 and any(r["id"] == source.get("id") for r in rows(b2)) and s3 == 200 and s4 == 200, (s, s2, s3, s4))
        if s4 == 200:
            added[:] = [a for a in added if a != (SOURCE, source.get("id"))]

        # --- stages --------------------------------------------------------------------------------------
        stages = rows(admin.call("GET", AL + "/opportunity-stages")[1])
        roles = {r["role"] for r in stages if r.get("role")}
        check("the won, lost and default stages are marked", {"WON", "LOST", "DEFAULT"} <= roles, [(r["name"], r["role"]) for r in stages])
        s, body = admin.call("POST", AL + "/opportunity-stages", {"name": f"زيارة تقييم {tag}"})
        stage = obj(body)
        if stage.get("id"):
            added.append((STAGE, stage["id"]))
        path = rows(rep.call("GET", "/ws/ioeti/opportunities/stages")[1])
        kinds = [p["kind"] for p in path]
        position = next((i for i, p in enumerate(path) if p["id"] == stage.get("id")), -1)
        check("a new stage lands after the open stages and before won and lost, and sellers see it as open",
              s == 201 and position >= 0 and path[position]["kind"] == "OPEN" and all(k != "OPEN" for k in kinds[position + 1:]), [(p["name"], p["kind"]) for p in path])
        open_ids = [r["id"] for r in rows(admin.call("GET", AL + "/opportunity-stages")[1]) if r.get("role") not in ("WON", "LOST")]
        reordered = [open_ids[-1]] + open_ids[:-1]
        s, body = admin.call("POST", AL + "/opportunity-stages/order", {"ids": reordered})
        s_bad, b_bad = admin.call("POST", AL + "/opportunity-stages/order", {"ids": reordered[:-1]})
        path = rows(rep.call("GET", "/ws/ioeti/opportunities/stages")[1])
        check("reorder: the new stage moves first for sellers too; an incomplete order → 422",
              s == 200 and path and path[0]["id"] == stage.get("id") and (s_bad, err(b_bad)[1]) == (422, "INCOMPLETE"), ([p["name"] for p in path], s, s_bad))
        won = next(r for r in rows(admin.call("GET", AL + "/opportunity-stages")[1]) if r.get("role") == "WON")
        s, body = admin.call("POST", f"{AL}/opportunity-stages/{won['id']}/delete", {"version": won["version"]})
        check("a core stage cannot be deleted (422 PROTECTED)", (s, err(body)[0]) == (422, "PROTECTED"), (s, err(body)))
        current = next(r for r in rows(admin.call("GET", AL + "/opportunity-stages")[1]) if r["id"] == stage.get("id"))
        s, body = admin.call("POST", f"{AL}/opportunity-stages/{stage.get('id')}/delete", {"version": current["version"]})
        check("the unused new stage is deleted", s == 200 and not any(r["id"] == stage.get("id") for r in rows(body)), (s, err(body)))
        if s == 200:
            added[:] = [a for a in added if a != (STAGE, stage.get("id"))]

        exit_code = 0 if all(r["result"] == "PASS" for r in RESULTS) else 1
        print(f"\n{sum(r['result'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} checks passed")
    finally:
        # the original order of the open stages comes back
        current = [r["id"] for r in rows(admin.call("GET", AL + "/opportunity-stages")[1]) if r.get("role") not in ("WON", "LOST")]
        if sorted(current) == sorted(original_order):
            admin.call("POST", AL + "/opportunity-stages/order", {"ids": original_order})
        restored = [r["id"] for r in rows(admin.call("GET", AL + "/opportunity-stages")[1]) if r.get("role") not in ("WON", "LOST")] == original_order
        order = {OPP: 0, REASON: 1, SOURCE: 1, STAGE: 1, USER: 10, GROUP: 11, PERM: 12, LINE: 13}
        complete, left = cleanup(admin, added + created, order)
        if not (complete and restored):
            print(f"FAIL cleanup left {left}; stage order restored: {restored}")
            exit_code = 1
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        with open(os.path.join(ROOT, "logs", "reference-lists-probe.json"), "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "cleanup_complete": complete, "stage_order_restored": restored}, f, indent=2, ensure_ascii=False)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
