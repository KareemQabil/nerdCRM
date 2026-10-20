# API-001 independent reconciliation — Claude PR #6 vs reverse mapping

**Verified GitHub state as of 2026-10-19:**
- PR: https://github.com/KareemQabil/nerdCRM/pull/6
- Code branch: `claude/ioeti-production-hardening-and-domain-slices`
- Base: `feat/ioeti-custom-ui-nerdpos-design-foundation` at `82fe3e4...`
- Latest PR head: `a919cfaff3e8fbe2df84eee2ae7a92cda6453c6f`
- PR status: **DRAFT, OPEN, NOT MERGED**.
- CI on code fix `6ed013f...`: https://github.com/KareemQabil/nerdCRM/actions/runs/39277631132 **SUCCESS**.
- CI on follow-up evidence `a919cfa...`: https://github.com/KareemQabil/nerdCRM/actions/runs/39277948672 **SUCCESS**.
- The mapping branch `docs/exhaustive-source-reverse-mapping` has not cherry-picked any Claude business code. **No changes to `main`.**

## Audit of actual code (read from latest PR head)

**`OpportunityRestController.java`**
- `rename` validates supplied `version`, checks `SecurityCheck.writeAccess`, loads `Opportunity`, then invokes pinned Utils `ConflictChecker.checkVersion(opportunity, command.version())`.
- It changes `name` and wraps `OpportunityService.saveOpportunity(opportunity)` with `OptimisticLockConflicts.translate`.
- `GET /ws/ioeti/opportunities/{id}` currently calls repository `.find(id)` before `readAccess`; 404 for unknown ID, 403 for forbidden existing ID reveals **record existence**.
- `create` ensures model-level Opportunity create access and Business Line **read** access. This does **not yet prove business-line membership authorizes the creation or owner/team scope**; it needs tests when those policies exist.
- The entire controller has explicit response DTO records, avoiding generic entity serialization on this endpoint; that does not secure the AOS generic REST API.

**`OptimisticLockConflicts.java`**
- Walks exception cause chain and maps only `jakarta.persistence.OptimisticLockException` and `org.hibernate.StaleObjectStateException` to `ClientErrorException(409)` with static safe text.
- Other exception types propagate unchanged, as deliberately scoped. As a consequence generic unexpected HTTP 500 text can still leak raw exceptions through Axelor's interceptor; treat it as a separate P0 error-translation contract.
- This handler assumes the transactional service call's failure is surfaced *inside* the lambda. Confirm every future mutation's transaction/flush boundary; don't make a global claim based on this endpoint.

**`OpportunityConflictTest.java`**
- 3 JPA/Guice tests with in-memory HSQLDB validate status mapping and persistence integrity. Another 4 Utils conflict unit tests support it.
- `opportunity_pilot_smoke.py` tightened assertion so both HTTP status AND response code must equal 409, plus name/version unchanged.
- `opportunity_concurrency_probe.py` starts two independent admin sessions/threads per round. Committed evidence file reports **40/40 exactly one successful 200, losing 409, winner persisted and version +1; zero 500/double success/lost update**. After Axelor metadata restore: **20/20**.
- **Important boundary:** The 40/40 and 20/20 probes are *committed local evidence* and **not run in GitHub CI**. CI independently runs JUnit and the real Axelor/PostgreSQL single-writer pilot. Do not mislabel the race rounds as CI-tested.
- Tests of two *different* sales roles and business-line/team policies are not present because those roles/scope rules aren't defined yet.

## Traceability updates

| Capability / blocker | New finding | Status |
|---|---|---|
| `OP-016` Opportunity stale write/version guard | Real stale HTTP 409 and no persisted changes; two-writer race locally verified | **PR6 VERIFIED FIX; NOT IN BASE** |
| `DEP-008` Backend concurrent transaction correctness | Scoped transaction path fixed and CI stale pilot green, race CI missing | **PARTIALLY VERIFIED** |
| `G-001` API-001 version conflict | Fixed for current Opportunity rename; outstanding generalized test coverage | **PR6 DONE AS SCOPED** |
| `G-002` Concurrent identity/context leak | Only 0/100 record-filter probes after restore; broader session isolation not proven | **P0 OPEN** |
| `G-003` Field-level generic REST read leak | Explicitly unchanged by PR6 | **P0 OPEN** |
| `G-004` Multi-role Own/Team/Line scope | No Rep A vs Rep B test or full role fixtures | **P0 OPEN** |
| `G-006` Unexpected 500 sanitization | Only optimistic locks sanitized; other raw exception messages can leak | **P0 OPEN** |

## Evidence vs claims discipline

The PR says 23/23 JUnit, and committed `docs/evidence/api-001/junit-summary.json` lists all 23 without skips/failures; CI success independently supports the suite. The local concurrency result is supported by committed JSON logs, but not reproduced by us or Actions in this mapping branch. Likewise the 0/100 metadata identity leak probe is a narrower sanity check, not comprehensive proof of no cross-user leakage.

## Cross-branch handoff / integration order

1. Keep PR #6 Draft until review; it is eligible for *scoped API-001 code review*, not for a full project launch.
2. Incorporate #6 via controlled merge into the feature baseline once user/maintainer approves; do not copy source code into this documentation-only branch.
3. Refresh the `IOETI_REPO_FILE_LEDGER.csv` local code index and `implementation_state` statuses **against the merged commit** (the ledger is pinned to the original feature branch as of 2026-10-19).
4. Wire concurrency probe to opt-in CI job with timeouts; include two role-specific writers plus Cross-Line/Team ACL negatives; add unknown vs forbidden id non-disclosure.
5. Reconcile PR #7 mapping docs and #6 backend changes in a controlled combined integration branch after both pass. Both currently target the same base but neither is in the other's ancestry.

**No production approval is implied by API-001 fix.**
