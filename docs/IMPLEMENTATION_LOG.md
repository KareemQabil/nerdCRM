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

## 2026-10-19 · SEC-004 part 1 · Sessions, CSRF, logout, expiry, login throttling

Branch `claude/ioeti-sec-004-session-hardening` (stacked on SEC-002, PR #15). Status: **LIVE_INTEGRATION_PASS** and **NEGATIVE_SECURITY_PASS**.

Full report: `docs/security/SEC-004-sessions.md`.

### Verified native controls
Tested live:
- session id rotation at login;
- `HttpOnly` / `SameSite=Lax` session cookie;
- pac4j CSRF (applied to requests that carry `Origin`);
- logout invalidates the session;
- `session.timeout` expiry.

### Fixed or added
- **Real-mode UI bug:** create and rename sent no `X-CSRF-Token` and would get 403 in a real browser. Fixed in `api.ts`.
- **Sign-out in the custom UI.**
- **`LoginThrottleFilter`:** per address and per username + address, 429 before credentials are checked. Neither AOP nor AOS has brute-force protection.
- **Explicit security settings** in the config template; production must set `session.cookie.secure = true`.

### Evidence
| Check | Result |
|---|---|
| Session probe | 20/20 |
| Expiry job | 6/6 |
| Contract | 31/31 |
| Smoke | 16/16 |
| Identity | 0/325,817 |
| Two-writer | 13/13 |
| Pilot | PASS |
| JUnit | 47/47 |
| Web mocked | 21/21 |
| Web demo | 14/14 |

### Not done
- MFA (D-07).
- HTTPS `Secure`-cookie verification (needs a staging environment).
- Multi-node throttle store.
- Secret vault (D-08).

## 2026-10-19 · SEC-003 part 1 · Own / Team / Business Line / All scopes

Branch `claude/ioeti-sec-003-scopes` (stacked on SEC-004, PR #16).
- **Mechanism:** LIVE_INTEGRATION_PASS and NEGATIVE_SECURITY_PASS.
- **Production roles:** BLOCKED_POLICY (D-07).

Full report: `docs/security/SEC-003-scopes.md`.

### Change
- New `User.ioetiBusinessLines` membership.
- Scopes are native permission conditions on `__user__`, `__user__.teamSet` and `__user__.ioetiBusinessLines`.
- Create eligibility: admin or line member (PROPOSED, fail-closed).
- `?creatable=true` line list; the UI create form uses it and explains the case with no assignment.
- `scripts/probe_fixtures.py` gives verified clean-up of Axelor-generated per-user records.

### Evidence
| Check | Result |
|---|---|
| Scope matrix | 65/65 |
| Pilot | PASS |
| Two-writer | 13/13 |
| Contract | 31/31 |
| Smoke | 16/16 |
| Identity | 0/333,281 |
| Session | 20/20 |
| JUnit | 50/50 |
| Web mocked | 22/22 |
| Web demo | 14/14 |

### Not done
- Production roles (D-07).
- Nested teams.
- Delegation.
- Lead and Partner line scope.
- A versioned migration for the new join table (G-008).

## 2026-10-19 · Wave 2 part 1 · Lead → Account (+ Contact) + Opportunity, Account 360

Full report: `docs/slices/W2-lead-conversion-account360.md`.

### Change
- `POST /ws/ioeti/leads/{id}/convert` converts in one transaction through the native `ConvertLeadWizardService`, via `PersistingConvertLeadWizardService`, an unbound subclass that saves the account and contact it builds. The opportunity is then created through `OpportunityService`.
- New fields: `Lead.ioetiBusinessLine` and `Opportunity.ioetiOriginLead` (lineage).
- Shared line rule `LineSelection`, used by opportunity create and by conversion.
- The Lead DTO gains version, converted state and readable links.
- Account 360 endpoints for contacts and opportunities.
- UI: lead page action, full-page wizard `#/leads/{id}/convert`, Account 360 tabs. The fictional demo is unchanged.
- `probe_fixtures` also removes a test user's sequence reservations and logged errors.

### Evidence (local; CI on the PR)
| Check | Result |
|---|---|
| Lead conversion probe (20 concurrent rounds) | 28/28 |
| Pilot | PASS |
| Two-writer | 13/13 |
| Contract | 31/31 |
| Smoke | 16/16 |
| Identity | 0/324,655 |
| Scopes | 65/65 |
| Session | 20/20 |
| JUnit | 50/50 |
| Web mocked | 24/24 |
| Web demo | 14/14 |
| Build | pass |

No JUnit test covers conversion: the HSQLDB test context has no AppCrm or sequence configuration, so the live probe on PostgreSQL is the test of record.

### Not done
- Lead capture, qualification and activities UI.
- Duplicate-account matching (policy).
- PII on contacts (G-007).
- Versioned migration (G-008).
- `crmProcessOnPartner` mode, which answers 422 `CONVERSION_UNSUPPORTED`.

## 2026-10-19 · Wave 3 part 1 · Catalog and draft quotations

Full report: `docs/slices/W3-catalog-and-draft-quotes.md`.

### Change
- New module `ioeti-commercial`, depending on `ioeti-core` and `axelor-sale` only, and registered in `scripts/ioeti.sh` and `scripts/ioeti.ps1`.
- Catalog endpoint.
- Quotations created through the native `OpportunitySaleOrderService` and lines through the native `SaleOrderLineGeneratorService`, with version checks and concurrent-write 409s.
- Totals before tax only, with `taxStatus=BLOCKED_BY_POLICY` (D-06). Finalize answers 422 `BLOCKED_BY_POLICY` (D-06, D-11).
- Native AOS refusals are logged with the correlation id and answered with `SETUP_REQUIRED` or `QUOTE_REJECTED`. This includes `ObserverBaseException`, which previously produced a 500.
- New open decision D-11 (commercial approvals and quotation terms).
- UI: quotations section on the opportunity page.

### Finding for the owner
With the installed apps (`contract` brings in `supplychain`, `stock` and `account`), quoting needs per-company stock and account configuration and a sales ledger account per product. This is real IOETI setup under D-06 and is not invented.

### Evidence (local; CI on the PR)
| Check | Result |
|---|---|
| Quote probe (10 concurrent rounds) | 24/24 |
| Lead conversion | 28/28 |
| Pilot | PASS |
| Two-writer | 13/13 |
| Contract | 31/31 |
| Smoke | 16/16 |
| Identity | 0/321,448 |
| Scopes | 65/65 |
| Session | 20/20 |
| JUnit | 53/53 (+3 `QuoteRulesTest`) |
| Web mocked | 26/26 |
| Web demo | 14/14 |
| Build | pass |

## 2026-10-19 · Platform part 1 · Versioned migrations (G-008) and encrypted backup/restore (G-009)

Runbook: `docs/runbooks/DATABASE_MIGRATIONS_AND_RECOVERY.md`.

### Change
- `db/migrations/V001–V003` with rollbacks, covering every IOETI-owned object.
- `scripts/db_migrate.py`:
  - `apply` with an immutable checksum ledger;
  - `verify` on a schema-only scratch copy, with a built-in negative control.
- `scripts/backup_restore_drill.py`: `pg_dump` piped into `age`, restore into a new database, identity checks, tamper and wrong-key checks.
- Both run in backend CI.
- AGENTS.md rule: a new IOETI schema object needs a migration.

### Evidence (local)
| Check | Result |
|---|---|
| Migration verify | 8/8 |
| Drift, live (column added on the dev DB) | detected |
| Tampered applied migration | `verify` and `apply` refuse it |
| Backup drill | 10/10: 1,184 tables, identical counts, 8.5 MB backup in about 2 s, restore 24–30 s |
| Restore boot test | Axelor on the restored DB (all 7 connections there); pilot PASS, contract 31/31; about 4 min end-to-end |

### Not done
- Production schedule, off-site copies, retention, key custody, PITR, encryption at rest (D-08).
- Upstream AOS schema stays on Axelor `ddl=update`, which runs only on a restored staging copy, per the runbook.

## 2026-10-19 · Wave 3 part 2a · Payment milestones (booked / invoiced / collected kept apart)

Full report: `docs/slices/W3-payment-milestones.md`.

### Change
- `/ws/ioeti/quotes/{id}/milestones` (list, add, remove) on the native supplychain `Timetable`, with amounts from the native `TimetableService.computeAmount`.
- The total ≤ 100 % invariant is held by a `PESSIMISTIC_FORCE_INCREMENT` lock on the quotation, plus the version check.
- The add-line command now calls the native `updateTimetableAmounts`, so milestone amounts follow line changes.
- Invoicing a milestone answers 422 `BLOCKED_BY_POLICY` (D-06).
- Separate `booked`, `invoiced` and `collected` figures.
- UI: payment-plan section in the quotations panel.
- No new IOETI schema (native tables only), so `db_migrate verify` still passes unchanged.

### Evidence (local; CI on the PR)
| Check | Result |
|---|---|
| Quote probe (24 quotation + 11 milestone checks, 10 rounds) | 35/35 |
| Lead conversion | 28/28 |
| Pilot | PASS |
| Two-writer | 13/13 |
| Contract | 31/31 |
| Smoke | 16/16 |
| Identity | 0/349,241 |
| Scopes | 65/65 |
| Session | 20/20 |
| Migration verify | 8/8 |
| Backup drill | 10/10 |
| JUnit | 56/56 (+3 `MilestoneRulesTest`) |
| Web mocked | 27/27 |
| Web demo | 14/14 |
| Build | pass |

## 2026-10-19 · Wave 3 part 2b · Draft customer contracts (signature and handover fail closed)

Full report: `docs/slices/W3-draft-contracts.md`.

### Change
- `/ws/ioeti/contracts` (list, get, create draft) through the native `ContractService.generateContractFromOpportunity`; the user chooses the contract type.
- One contract per opportunity, held under concurrency by a `PESSIMISTIC_FORCE_INCREMENT` lock on the opportunity.
- `activate` answers 422 `BLOCKED_BY_POLICY` (D-11). `handover` answers 422 `CONTRACT_NOT_ACTIVE` for a contract that isn't active, otherwise `BLOCKED_BY_POLICY`.
- Shared `NativeCommands` error mapping: an `AxelorException` anywhere in the cause chain becomes `SETUP_REQUIRED` or the command's own code.
- UI: contract section on the opportunity page.
- D-11 widened to cover contract signature and handover.

### Evidence (local; CI on the PR)
| Check | Result |
|---|---|
| Quote probe (quotations, milestones and 9 contract checks; 10 rounds) | 44/44 |
| Lead conversion | 28/28 |
| Pilot | PASS |
| Two-writer | 13/13 |
| Contract | 31/31 |
| Smoke | 16/16 |
| Identity | 0/291,590 |
| Scopes | 65/65 |
| Session | 20/20 |
| Migration verify | 8/8 |
| Backup drill | 10/10 |
| JUnit | 59/59 (+2 `ContractRulesTest`, +1 wrapped-refusal case) |
| Web mocked | 28/28 |
| Web demo | 14/14 |
| Build | pass |

## 2026-10-20 · Wave 3 part 2c · Contract lines from the quotation (Opportunity → Quote → Contract)

Full report: `docs/slices/W3-draft-contracts.md` §5.

### Change
- `POST /ws/ioeti/contracts/{id}/lines-from-quote` builds native `ContractLine`s (`fillDefault`, `fillAndCompute`, `computeTotal`) from the quoted lines.
- New field `Contract.ioetiSourceQuote` with migration **V004** and rollback U004. The CI migration gate first failed on the uncovered column (6/8) and passes with V004 (8/8).
- Lines are copied once, also under concurrency: a `PESSIMISTIC_FORCE_INCREMENT` lock on the contract, 409 `LINES_EXIST`.
- Oracle-free refusal of quotations from other opportunities; `QUOTE_EMPTY`; `CONTRACT_NOT_DRAFT`.
- UI: copy button, lines table, total before tax, lineage.

### Evidence (local; CI on the PR)
| Check | Result |
|---|---|
| Quote probe (6 new checks) | 50/50 |
| Lead conversion | 28/28 |
| Pilot | PASS |
| Two-writer | 13/13 |
| Contract | 31/31 |
| Smoke | 16/16 |
| Identity | 0/308,756 |
| Scopes | 65/65 |
| Session | 20/20 |
| Migration verify | 8/8 |
| Backup drill | 10/10 |
| JUnit | 59/59 |
| Web mocked | 29/29 |
| Web demo | 14/14 |
| Build | pass |

## 2026-10-20 · SEC-001 residual (issue #10) · WebSocket, scheduled jobs, expiry

Full report: `docs/security/SEC-001-identity-isolation.md` §8.

### Change
- `scripts/websocket_identity_probe.py` with a dependency-free RFC 6455 client (`scripts/ws_client.py`): per-user fingerprints over the native `tags` channel, under load.
- **Finding, fixed.** An already-open WebSocket kept answering after the user logged out over HTTP. `WebSocketSessionGuard` (a Guice interceptor on `WebSocketEndpoint` `@OnMessage`, in `ioeti-core`) closes the socket when the server-side Shiro session has ended. No upstream file is modified.
- `JobIdentityProbe`, a diagnostic Quartz job, admin-readable through the identity-boundary endpoint.
- CI changes:
  - the main job runs Axelor with the scheduler enabled and the probe in strict job mode;
  - the expiry job adds `--expiry`.
- `ioeti-core` adds compile-only `jakarta.websocket` API 2.1.1 (provided by Tomcat 10.1 at runtime).

### Evidence (local; CI on the PR)
| Check | Result |
|---|---|
| WebSocket / job probe | 7/7: 0 mismatches in 5,516 WebSocket messages with 18,541 concurrent HTTP requests and a metadata reload; 28 job runs, 0 with a user; logout closes the open socket |
| Expiry mode | 2/2 |
| JUnit | +2 `WebSocketSessionGuardTest` |

## 2026-10-20 · Wave 2 part 2 · lead qualification and assignment

Slice: `docs/slices/W2-lead-qualification.md`.

### Change
- `LeadLifecycleService` (`ioeti-business-lines`) on the native `LeadService`: stage moves (`kanbanLeadOnMove`), lose, reopen (`resetLead`), assign to me.
- `LeadRestController`: `GET stages`, `GET lost-reasons`, `POST {id}/stage|lose|reopen|assign`. Lead views add `stageId`, `stageKind`, `lostReason`, `assignedToMe`, `receivedAt`; the lost note is never returned.
- `NativeCommands` moved from `ioeti-commercial` to `ioeti-core` so every IOETI module maps native refusals the same way (no behaviour change for quotes and contracts).
- **Finding, fixed:** `RecordAccess.writable` answered 403 when a concurrent commit moved a record out of the caller's scope between its read and write checks. It now answers 404 (see SEC-002 §3).
- Policy D-12 (lead response targets, escalation, routing) added as OPEN. Assigning to another user fails closed.
- UI: `LeadQualificationPanel` on the lead page (real mode); lost leads hide "convert".
- CI: `PROBE_LIFECYCLE_ROUNDS=10 scripts/lead_lifecycle_probe.py`, report `logs/lead-lifecycle-probe.json`.

### Evidence
See `docs/evidence/wave2-lead-qualification/`.

## 2026-10-20 · G-007 · personal-data classification, gate and log masking

Full description: `docs/security/PII_CLASSIFICATION.md`.

### Change
- `docs/security/pii-classification.json`: every field of every IOETI REST record has a class (`REFERENCE` 92, `BUSINESS` 44, `PERSONAL` 8, `RESTRICTED` 1).
- `scripts/pii_dto_audit.py` (backend CI, first step, no server): fails on an unclassified field, restricted data in a response, a contact/identity-named field classified below `RESTRICTED`, or a stale registry entry. It runs its own negative controls every time.
- `PiiMasker` (`ioeti-core`): masks e-mail, phone-like numbers and Egyptian national IDs, Latin and Arabic-Indic digits, keeps ISO dates; `NativeCommands` logs native refusal messages through it.
- `AGENTS.md`: new rule, classify every new REST field.

### Evidence
| Check | Result |
|---|---|
| `pii_dto_audit.py` | 145 fields, 0 problems; 5/5 negative controls |
| Live control | adding `ContactView.email` fails the gate; reverted |
| JUnit | `PiiMaskerTest` 4/4, full suite green |

### Not closed
Production log-pipeline masking and retention (D-08), field-level role matrix (D-07), domain data for recruitment and training (D-03/D-04).

## 2026-10-20 · G-010 · pilot readiness

### Change
- `docs/runbooks/PILOT_UAT_SCRIPT.md`: 13 reviewer steps (outsider, two reps, viewer; Arabic, English, phone width) with a record table and sign-off.
- `scripts/pilot_readiness.py`:
  - `setup` creates 4 users with test-only roles, 3 fictional leads, a catalog product and the company setup; every name starts with `PILOT-TEST`. Passwords go to `.local/pilot-users.txt` (git-ignored, mode 600) and are never printed.
  - `check` is read-only: each user sees and is refused what the script expects.
  - `teardown` removes the dataset and what reviewers created with it (opportunities, accounts, quotations, contracts).
  - It refuses `IOETI_ENV=production`.
- Backend CI runs setup → check → teardown.
- `docs/PILOT_PLAN.md`: gate evidence table; G6 ready for the reviewer.

### Evidence (local)
| Check | Result |
|---|---|
| setup | PASS, 36 records, 4 users |
| check | 11/11 |
| reviewer simulation through the API | assign → convert → quotation 3000.00 → milestone → contract → lines 3000.00 |
| teardown | leftovers: none; database count of pilot leads, users, partners, opportunities and companies = 0 |
