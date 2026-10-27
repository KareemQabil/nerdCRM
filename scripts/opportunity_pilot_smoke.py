#!/usr/bin/env python3
"""Real Axelor pilot contract smoke test (no mocked data).

Requires local app, CRM app installed, IOETI modules and a development admin account.
Creates a temporary real Opportunity, renames it and verifies stale writes are rejected.
Do not use on production. Cleanup is best effort and its result is reported.
"""
import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import Client, ENV, OPP  # noqa: E402

def require(condition, what):
    print(("PASS " if condition else "FAIL ") + what)
    if not condition:
        raise AssertionError(what)

def main():
    client = Client()
    user = os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin"))
    password = os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))
    require(client.login(user, password) == 200, "pilot account authenticated")
    status, identity = client.call("GET", "/ws/ioeti/session")
    require(status == 200 and identity.get("code") == user, "identity endpoint authenticates independently")
    status, lines = client.call("GET", "/ws/ioeti/business-lines")
    eligible = [r["code"] for r in lines.get("object") or [] if r.get("status") == 2]
    require(status == 200 and len(eligible) > 0, "active business line available")
    anonymous = Client()
    status, _ = anonymous.call("GET", "/ws/ioeti/opportunities")
    require(status in (401, 403), "anonymous opportunities rejected")
    # Reverse-mapped read-only domain endpoints must preserve the safe DTO allowlist.
    for path, allowed in (
        ("/ws/ioeti/leads", {"id", "version", "name", "organization", "stage", "converted",
                             "businessLineCode", "accountId", "opportunityId", "stageId", "stageKind",
                             "lostReason", "assignedToMe", "receivedAt", "response"}),
        ("/ws/ioeti/accounts", {"id", "version", "name", "reference", "customer", "prospect"}),
    ):
        status, payload = client.call("GET", path)
        records = payload.get("object")
        require(status == 200 and isinstance(records, list), path + " authorized list")
        require(all(isinstance(item, dict) and set(item.keys()).issubset(allowed) for item in records),
                path + " response field allowlist")
        anon_status, anon_body = anonymous.call("GET", path)
        require(anon_status in (401, 403) or anon_body.get("codeStatus") in (401, 403),
                path + " anonymous denied")
    suffix = secrets.token_hex(4)
    created_id = None
    try:
        name = "IOETI pilot test " + suffix
        status, body = client.call("POST", "/ws/ioeti/opportunities",
            {"name": name, "businessLineCode": eligible[0]})
        obj = body.get("object") or {}
        created_id = obj.get("id")
        require(status == 201 and obj.get("name") == name and created_id is not None, "created opportunity through service API")
        status, record = client.call("GET", f"/ws/ioeti/opportunities/{created_id}")
        current = record.get("object") or {}
        require(status == 200 and current.get("name") == name, "created opportunity persisted")
        version = current.get("version")
        require(isinstance(version, int), "JPA record version returned")
        newname = name + " updated"
        status, changed = client.call("PUT", f"/ws/ioeti/opportunities/{created_id}",
            {"name": newname, "version": version})
        require(status == 200 and (changed.get("object") or {}).get("name") == newname, "renamed opportunity through service API")
        status, reloaded = client.call("GET", f"/ws/ioeti/opportunities/{created_id}")
        require(status == 200 and (reloaded.get("object") or {}).get("name") == newname, "rename persisted across fresh query")
        status, old = client.call("PUT", f"/ws/ioeti/opportunities/{created_id}",
            {"name": "This should never be saved", "version": version})
        # Diagnostic log only bounded status and non-sensitive version numbers.
        print("PILOT_VERSION_PROBE",
              "initial", version,
              "after_update", (reloaded.get("object") or {}).get("version"),
              "stale_http", status,
              "stale_code", old.get("codeStatus"),
              "stale_state", old.get("status"),
              "stale_message", str(old.get("messageStatus"))[:100])
        require(status == 409 and old.get("codeStatus") == 409, "stale version refused with HTTP 409")
        status, after = client.call("GET", f"/ws/ioeti/opportunities/{created_id}")
        after = after.get("object") or {}
        require(status == 200 and after.get("name") == newname
                and after.get("version") == (reloaded.get("object") or {}).get("version"),
                "stale write not persisted (name and version unchanged)")
        print("PILOT_CONTRACT=PASS")
    finally:
        if created_id is not None:
            code, body = client.call("DELETE", f"/ws/rest/{OPP}/{created_id}")
            print("PILOT_CLEANUP", code, "status", body.get("status"))
            if body.get("status") not in (0, None) or code not in (200, 204):
                print("WARNING: cleanup failed; delete the temporary pilot opportunity manually", file=sys.stderr)
                return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
