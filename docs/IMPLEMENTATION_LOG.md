# IOETI implementation log

Each entry follows the status vocabulary of the master execution prompt. "Live" means a real
Axelor 9.1.10 + PostgreSQL 16 instance, not intercepted browser calls.

## 2026-10-19 · API-001 · Opportunity rename conflict contract

Branch `claude/ioeti-production-hardening-and-domain-slices` (stacked on
`feat/ioeti-custom-ui-nerdpos-design-foundation`). Status: **LIVE_INTEGRATION_PASS**,
**NEGATIVE_SECURITY_PASS** for this endpoint. UAT not done.

### Root cause (source-verified, axelor-utils 4.0.2 bytecode)
- `com.axelor.utils.api.HttpExceptionHandlerImpl` maps `BadRequestException` → 400,
  `ForbiddenException` → 403, `NotFoundException` → 404, any other `ClientErrorException` → 409,
  and **every other exception → 500 with `e.getMessage()`**.
- `OpportunityRestController.rename` threw `new WebApplicationException(msg, CONFLICT)`.
  `WebApplicationException` is the parent of `ClientErrorException`, so it fell into the 500
  branch. That is the CI symptom: `500/codeStatus=500` with the right message.
- Second, unreported path: two writers that both pass the version check. The loser's versioned
  `UPDATE … WHERE version = ?` fails at flush. The real chain, observed through
  `OpportunityService.saveOpportunity` (`@Transactional`), is `PersistenceException` (wrapped by
  `OpportunityManagementRepository.save`) → `jakarta.persistence.OptimisticLockException` →
  `org.hibernate.StaleObjectStateException`. That was also answered with 500, and the response
  **echoed the raw Hibernate message**, including the internal entity class name.
  The record itself was not corrupted: JPA versioning already rejected the second write.

### Change
- Pre-check uses the native `ConflictChecker.checkVersion` (409, `ClientErrorException`) instead
  of a hand-written comparison.
- `ioeti-core` `OptimisticLockConflicts.translate` wraps the committing service call. It maps
  **only** a cause chain containing `jakarta.persistence.OptimisticLockException` or
  `org.hibernate.StaleObjectStateException` to 409, with a fixed message. Every other exception
  (constraint violations, validation, `RollbackException` from other causes) propagates unchanged.
- No new write endpoint. The regression target is the existing Opportunity rename.

### Evidence (`docs/evidence/api-001/`)
| Check | Before fix | After fix |
|---|---|---|
| Pilot stale rename (`opportunity_pilot_smoke.py`) | 500 / codeStatus 500 | 409 / 409, name + version unchanged |
| Live 2-writer race, simultaneous PUT with same version (`opportunity_concurrency_probe.py`) | 20/20 rounds: loser got 500 with raw Hibernate text | 40/40 rounds: one 200 + one 409 (commit-time path), stored state = winner, version +1, 0 lost updates |
| Same race after admin `restoreAll` | – | 20/20 pass |
| Negative: missing version / anonymous / user without Opportunity permission / stale single write | stale single write → 500 | 400 / 401 / 403 / 409, record unchanged |
| JUnit (HSQLDB, real Guice + `@Transactional` boundary) | 16/16 | 23/23 incl. `OpportunityConflictTest` (3) and `OptimisticLockConflictsTest` (4) |
| API smoke (16, 6 negative) and record-filter leak probe after `restoreAll` | – | 16/16, 0/100 leaks |

### Not done / limitations
- The 2-writer probe runs both writers as the admin in separate sessions. Multi-role ownership
  (Rep A vs Rep B, Own/Team scopes) is still SEC work; no such role configuration exists yet.
- The Axelor interceptor still returns `e.getMessage()` for any *other* unexpected 500 on IOETI
  endpoints. A sanitizing wrapper for all IOETI endpoints is a separate hardening task.
- `GET /ws/ioeti/opportunities/{id}` loads the record before the permission check, so it answers
  404 for unknown ids and 403 for forbidden ones. That is an existence oracle, to be fixed with the
  SEC tasks.
- The field-level read restriction on `/ws/rest` is still the known upstream limitation
  (`field-permission-probe`, unchanged by this work).
