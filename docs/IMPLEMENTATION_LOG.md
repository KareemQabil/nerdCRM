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

## 2026-10-19 · SEC-001 · Request authentication-context isolation

Branch `claude/ioeti-sec-001-identity-isolation` (stacked on PR #6). Status: **OPEN**.
- HTTP surfaces: **LIVE_INTEGRATION_PASS** and **NEGATIVE_SECURITY_PASS**.
- WebSocket handlers and background jobs: **SOURCE_REVIEWED** only.
- Session expiry: not tested.

Full report: `docs/security/SEC-001-identity-isolation.md`.

### Root cause (AOP 8.2.5 sources, checksums in the report)
`ContextState.capture()` stores the resolved session user. `restore()` re-applies it with `AuthUtils.setCurrentUser`, so an inline context-aware task (for example *restore all views*) leaves the request thread pinned to that user. `AuthUtils.getUser()` prefers the pinned user over the session. That includes pac4j's `AxelorUserAuthorizer`, which runs before any JAX-RS filter.

### Change
`ioeti-core` adds `RequestIdentityBoundaryFilter`:
- it is registered as the **first** filter, before `GuiceFilter` (Shiro, pac4j, RESTEasy, servlets);
- it clears the identity at entry and in `finally` at exit;
- startup fails closed if the filter cannot be installed.

The previous JAX-RS filter stays as a second layer. A new admin-only counters endpoint reports what the boundary did. The live probe `scripts/identity_isolation_probe.py` is wired into CI.

### Evidence (`docs/evidence/sec-001/`)
| Build | Checks | Leaks |
|---|---|---|
| No mitigation (control) | 313,962 | 50,731, including anonymous identity, foreign records and accepted unauthorised writes |
| JAX-RS filter only | 281,298 | 0 |
| Boundary + JAX-RS (shipped) | 317,623 | 0 (`staleAtEntry` 0) |
| Boundary only | 320,752 | 0 (`clearedAtExit` 4 = every reload pinned a user, and each was removed) |

JUnit: 34/34, including the deterministic reproduction on the real 8.2.5 classes.

### Not done / limitations
- No live WebSocket or background-job identity test.
- Session expiry not exercised.
- The pac4j authorizer path is covered by filter ordering, with no failing-before live case.
- The result is a finite sample, not a proof.
- Adjacent work proposed as SEC-002 to SEC-004 (see the PR).

## 2026-10-19 · SEC-002 part 1 · Error contract, existence oracle, generic API exposure

Branch `claude/ioeti-sec-002-api-contract` (stacked on the integration base, PR #14). Status: **LIVE_INTEGRATION_PASS** and **NEGATIVE_SECURITY_PASS** for the existing endpoints.

Full report: `docs/security/SEC-002-api-contract.md`. Executed-test matrix: `docs/SECURITY_TEST_MATRIX.md`.

### Change
- `@IoetiEndpoint` with a typed `ApiException` and one JSON error contract, including a correlation id. It replaces the AOS `@HttpExceptionHandler`, which maps other 4xx to 409 and echoes 500 messages.
- `RecordAccess`: a hidden record and a missing record give the same 404.
- `GenericApiExposureFilter`: non-maintenance users get 403 from the generic Axelor APIs.
- Account list filters client accounts in the query, so pages are full.
- UI: `ApiError.code` and `ApiError.fields`, plus localized 422 messages.

### Evidence
| Check | Result |
|---|---|
| Contract probe | 31/31 |
| API smoke | 16/16 |
| Identity probe | 0/310,904 leaks |
| Two-writer | 20/20 |
| Pilot | PASS |
| JUnit | 41/41 |
| Web mocked | 18/18 |
| Web demo | 14/14 |

### Not done
- Rate limiting.
- Role-scope matrix (SEC-003).
- Session/CSRF (SEC-004).
- Export, attachment and PDF parity.
- Structural PII isolation.
