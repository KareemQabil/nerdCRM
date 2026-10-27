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

## 2026-10-20 · Wave 4a · external training (`ioeti-training`)

Slice: `docs/slices/W4-external-training.md`.

### Change
- New module `ioeti-training` (`ioeti_training_*` tables, migration V005 with rollback U005): courses, cohorts, enrolments, cohort sessions, attendance.
- `TrainingService`: cohort row lock on every enrolment change; capacity and waitlist invariants; a freed seat promotes the first waitlisted trainee.
- `/ws/ioeti/training` REST; certificates and cohort cancellation fail closed (D-03).
- Fix during the build: Axelor entity names are global, so `TrainingSession` clashed with AOS talent and became `CohortSession` (same table name).
- G-007 registry: 58 fields added; the gate passes (203 fields).
- CI: `PROBE_TRAINING_ROUNDS=10 scripts/training_probe.py`.

### Evidence
See `docs/evidence/wave4-training/`.

## 2026-10-20 · Wave 4a · training UI

- `TrainingPage.tsx` (real mode, `#/training`): cohorts, course and cohort forms, seat counts, open/close, enrolment through sponsor account → contact, waitlist positions, cancel, sessions and attendance. "Cancel cohort" and "certificate" disabled with the D-03 note.
- `api.ts` training client; the sidebar "Training" item is enabled in real mode (demo unchanged).
- Mocked Playwright test (stateful mock: waitlist, promotion on cancel, attendance body); web suites 31 mocked + 14 demo, typecheck and build pass.

## 2026-10-20 · Wave 4b · client ISO certification (`ioeti-certification`)

Slice: `docs/slices/W4-iso-certification.md`.

- New module `ioeti-certification` (`ioeti_cert_*`, migration V006 with rollback U006): cycles, auditor qualifications, Stage 1/2 audits, nonconformities.
- Rules: the lead auditor must be qualified for the standard on the planned date; one active audit per stage; Stage 2 after Stage 1; close needs a response; "ready for decision" = Stage 2 done and no open major. Cycle and audit rows are locked for concurrent writers.
- D-02 fail closed: the decision, certificates, and surveillance/recertification audits.
- G-007 registry +56 fields (259). CI: `PROBE_CERT_ROUNDS=10 scripts/certification_probe.py`.
- Evidence: `docs/evidence/wave4-certification/`.

## 2026-10-20 · Integration baseline and Wave 4C (certification workspace)

### Integration baseline
- `claude/ioeti-integration-next` (draft PR #31 to `main`, do not merge as-is): the cumulative head of every open PR. The status table, dependency graph and merge-order checklist are in `docs/INTEGRATION_STATUS.md`.
- Baseline regression on `86264ad` after a sandbox restart: 15/17 steps passed live. The other two (certification probe, PII gate) failed because the working tree held in-progress Wave 4C files. Re-run on a clean `86264ad` worktree: PII gate 0 problems; certification probe still 16/18.
- Root cause of the 16/18: a `NoSuchMethodError` from a module rebuilt while the server was running, which loaded a mix of old and new classes. CI on `86264ad` is green, the probe passed 18/18 earlier, and after a clean restart it passes. Rule kept from now on: never rebuild while the dev server runs.

### Wave 4C
See `docs/slices/W4-iso-certification.md` §6. Server: register filters and paging, phase/decisionBlockers, eligible auditors, timeline, auditor directory, V007. UI: register, cycle record workspace, auditor competence. Tests: certification probe 23/23 live; web 34 mocked + 14 demo.

## 2026-10-20 · Wave 4D · agency recruitment (`ioeti-recruitment`)

Slice: `docs/slices/W4-agency-recruitment.md`.

- New module `ioeti-recruitment` (`ioeti_rec_*`, migration V008 with rollback U008): client job orders, candidates, a separate restricted profile, consents per job order, applications, client interviews, placements and fee events. Native Talent (`JobApplication`) is not reused: it is the company's own hiring.
- Rules: consent for the job order before submission; stage moves only forward one step (submission, offer and placement have their own commands); one placement per application; placements stop at the headcount; fee events recorded once per kind. Application, order and candidate rows are locked for concurrent writers.
- Restricted data (e-mail, phone, expected salary, CV reference) is write-only: it never appears in a response, and reading it is `BLOCKED_BY_POLICY` (D-04, D-07). CV sharing, fee invoices and replacement claims fail closed (D-04, D-06). Submission scope note for the owners in `docs/decisions/OPEN_IOETI_POLICY_DECISIONS.md`.
- G-007 registry +91 fields (the request record was renamed `MoveApplication` so it does not collide with the lead `MoveStage` record in the registry).
- UI `#/recruitment`: job order and candidate registers, job order record with a stage board and application panel, candidate record with the restricted section and consents. The real-mode nav item is enabled; fundraising stays disabled.
- CI: `PROBE_REC_ROUNDS=5 scripts/recruitment_probe.py`.

## 2026-10-20 · Wave 4E · fundraising and partnerships (`ioeti-fundraising`)

Slice: `docs/slices/W4-fundraising.md`.

- New module `ioeti-fundraising` (`ioeti_fund_*`, migration V009 with rollback U009): donor profiles, sensitive profiles, funding opportunities, commitments, installments, collections, deliverables, stewardship. Reuses native `Partner`, marketing `Campaign` and `Currency`.
- Money stays apart: proposed, committed (a pledge), scheduled and collected are separate figures per currency; only a collection recorded against a bank reference counts as collected. The schedule never exceeds the commitment; a collection never exceeds what is due; the same bank reference twice is refused (409); voids keep the row.
- Fail closed: receipts (D-05), posting and invoicing (D-06), restricted allocation (D-05, D-06), reading the sensitive profile (D-05, D-07).
- G-007 registry +143 fields (505 total). Fundraising records got their own names (`CreateFundingOpportunity`, `FundingOpportunityView`, `DonorTimelineEvent`) so they do not share classifications with the sales and certification records.
- UI `#/fundraising`: overview, donors and Donor 360, grants board, grant record with schedule and collections, collection status. Real-mode money uses Latin digits and the ISO code. The sidebar's last disabled real-mode item is now Settings.
- CI: `PROBE_FUND_ROUNDS=5 scripts/fundraising_probe.py`.

## 2026-10-20 · Wave 5 · handover and engagement (`ioeti-operations`)

Slice: `docs/slices/W5-handover-engagement.md`.

- New module `ioeti-operations` (`ioeti_ops_*`, migration V010 with rollback U010) and an extension of the native `Project` (`ioeti_handover`, unique): handover requirements per business line, handovers of active contracts with a copied checklist, rework/reject with reason codes, acceptance that creates exactly one native project in the same transaction, native tasks with progress and overdue, ownership transfer, append-only trail.
- Authorization is enforced on the server: reviewing needs project-creation rights, configuring checklists needs create rights on requirements; projects not created from a handover are outside the API (404).
- D-11 note for the owners in `docs/decisions/OPEN_IOETI_POLICY_DECISIONS.md`: activation stays blocked, so handovers cannot start in production before D-11.
- G-007 registry +90 fields (595 total). UI `#/operations` (real mode; the demo keeps its projects area).
- CI: `PROBE_OPS_ROUNDS=5 scripts/operations_probe.py`.

## 2026-10-20 · Wave 5b · commercial workflows and Account 360 (`ioeti-workspace`)

Slice: `docs/slices/W5b-commercial-workflows.md`.

- Quotation versions on the native `SaleOrderVersionService` (save, list, restore); the quotation view has `versionNumber`.
- New module `ioeti-workspace` (`ioeti_ws_*`, migration V011 with rollback U011) and an extension `Opportunity.ioetiRenewalOf` (unique): review requests with an append-only history (approve/reject D-11 blocked), invoice requests for milestones of confirmed orders (issue D-06 blocked), renewals as native opportunities, and the Account 360 summary across every domain with unreadable areas left out and money stages kept apart.
- G-007 registry +55 fields (650 total). UI panels on the quotation, milestones, contract and Account 360.
- Also on the Wave 5 branch: the UI suite showed the sidebar could not reach its last items at 720 px height after the Operations entry; the side panel scrolls.
- CI: `PROBE_WS_ROUNDS=5 scripts/workspace_probe.py`.

## 2026-10-20 · Wave 6 · lead intake and marketing completeness (`ioeti-marketing`)

Slice: `docs/slices/W6-leads-marketing.md`.

- `ArabicNormalizer` in `ioeti-core` (alef/teh marbuta/alef maksura/hamza seats, diacritics, tatweel, Arabic-Indic digits; phone and e-mail keys).
- New module `ioeti-marketing` (`ioeti_mkt_*`, migration V012 with rollback U012): `Lead.ioetiSearchKey` kept by an entity listener and backfilled in SQL (the probe compares both). It adds:
  - intake with a scope-limited duplicate review;
  - server-side lead search and filters, and saved views per owner;
  - consent and opt-out history on the native flags;
  - campaign attribution on native campaigns, serialized with a row lock;
  - follow-ups on native CRM events, an overdue queue and the activity timeline.

  Routing, response targets and escalation stay D-12 blocked; nothing is sent.
- Found by the probe: concurrent attributions to one campaign were refused with 409, because Hibernate's follow-on lock re-checked a version read before waiting. Fixed by taking the row lock first and then reloading the campaign.
- G-007 registry: 64 new fields (714 in total, 0 problems).
- UI: the live lead list moved from filtering the loaded page in the browser to server-side search. One UI test was updated to assert the server request.
- CI: `PROBE_MKT_ROUNDS=5 scripts/marketing_probe.py`.

## 2026-10-20 · Wave 7a · documents and knowledge base (`ioeti-content`)

Slice: `docs/slices/W7a-documents-knowledge.md`.

- New module `ioeti-content` (`ioeti_doc_*` in V013/U013 and `ioeti_kb_*` in V014/U014). The knowledge rollback drops articles and their published revisions in one statement, because they reference each other.
- Documents on leads, opportunities, accounts (customers and prospects), quotations, contracts and engagements:
  - access is taken from the record;
  - files are stored as native `MetaFile`s after checks on size, extension and **detected content type**;
  - revisions are immutable, numbered without gaps, and the document row is locked while one is added;
  - downloads are attachments with `nosniff` and `no-store`.
- Knowledge base: working copy versus immutable published revisions, line-scoped visibility, Arabic-normalized search, categories.
- G-007 registry: 78 new fields (792 in total, 0 problems). File content is RESTRICTED (request only).
- UI:
  - a Documents panel on lead, account and opportunity pages;
  - a Knowledge base page (live mode only).

  Fixed in review of the UI tests: after a refused publish, refreshing the article replaced the specific error with a generic one.
- CI: `PROBE_CONTENT_ROUNDS=5 scripts/content_probe.py`.

## 2026-10-20 · Wave 7b · notifications, outbox, reports, settings (`ioeti-automation`, `ioeti-reports`)

Slice: `docs/slices/W7b-notifications-reports-settings.md`.

- `ioeti-core`: the `Notifier` interface, with a do-nothing default bound through a Guice `OptionalBinder`.
- `ioeti-automation` (migration V015/U015; entity `InboxNotice`, because `Notification` is already taken by axelor-account):
  - stored in-app notices raised by the workspace review and operations handover decisions;
  - mentions;
  - the held outbox, with the opt-out checked at draft and again at send, and sending blocked by D-10.
- `ioeti-reports`: aggregates in JPQL that always include the native read filter of the caller (`ScopedAggregates`); the administrators' system page; `policy-decisions.json`, kept equal to the decision document by `scripts/policy_registry_check.py` (in CI).
- `ioeti-marketing`: `POST /sources`.
- UI:
  - Notifications, with an unread badge;
  - outbox and mention panels;
  - a Reports page with CSV export that neutralizes formulas;
  - the Settings page is now real in live mode. Two tests that asserted it was disabled now assert that it opens the real page and never the fictional admin workspace.
- Probes: `scripts/insights_probe.py`; inbox checks added to the operations and workspace probes. The shared fixture clean-up removes a test user's notices and drafts.
- G-007 registry: 75 new fields (867 in total, 0 problems).


## 2026-10-23 · A1 · administration from the platform (`ioeti-admin`)

Slice: `docs/slices/A1-admin-console.md`.

- `ioeti-admin` (migration V016/U016, entity `AdminAuditEvent`):
  - people with temporary passwords and a forced change at the next sign-in;
  - deactivation and activation;
  - profiles, listed and assigned (D-07 keeps authoring blocked);
  - teams;
  - business lines and their members;
  - the change log.

  Administrators only, on every call.
- `ioeti-core`: `SessionIdentity.administrator`.
- UI:
  - the Admin console (five tabs, the person page, dialogs);
  - the sign-in screen handles Axelor's change-password route;
  - a shared `Dialog`/`ChipPicker`.
- Probes: `scripts/admin_probe.py` 43/43 (backend CI). JUnit `AdminRulesTest` 6/6. Mocked UI tests `tests/admin.spec.ts` 4/4; full mocked suite 68, demo 24.
- G-007 registry: 97 new fields (964 in total, 0 problems).

## 2026-10-23 · A2 · daily work from the platform

Slice: `docs/slices/A2-daily-work.md`.

- `ioeti-marketing`: edit a lead (the search key follows; duplicates confirmed; a converted lead is kept as it was).
- `ioeti-business-lines`:
  - add and edit client accounts, with a similar-name check, and add contacts (`AccountCommands`);
  - opportunity stages with won blocked by D-11, lost only with a reason, reopen, and the estimate (`OpportunityStages`);
  - the opportunity's lost reasons.
- `ioeti-workspace`: activities on leads, accounts and opportunities (`ActivityService`, native `Event`), the personal agenda across domains, and one search box (`DayRestController`).
- UI:
  - the activity timeline and composer;
  - lead, account and contact dialogs;
  - the opportunity stage path and estimate card;
  - My agenda;
  - the Ctrl/⌘ + K search palette.
- Probes: `scripts/daily_work_probe.py` 44/44 (backend CI), including the time-zone rule. The DTO allowlists in `api_contract_probe.py` and `opportunity_pilot_smoke.py` now include the account version and the opportunity's stage and estimate fields. Mocked UI tests: `tests/daily.spec.ts` 6/6. Real-browser walk-through: the whole journey, three themes, desktop and phone.
- Found on the real backend: a fresh install has no lost reasons, so the dialog says so (reference lists are phase 5); date-times are wall-clock times and "already happened" is judged in the caller's time zone.
- G-007 registry: 1033 fields, 0 problems.

## 2026-10-24 · A3 · reference lists from the admin console

Slice: `docs/slices/A3-reference-lists.md`.

- `ioeti-admin`: `ReferenceLists` and `/ws/ioeti/admin/lists`.
  - Covers lost reasons, lead sources and opportunity stages.
  - Values in use are renamed, never deleted.
  - Core stages are protected.
  - Stages can be reordered, with won and lost last.
  - Every change goes to the admin change log.
- UI: the admin console's Lists tab, with inline add and rename, guarded delete, and drag reordering (`@dnd-kit` 6.3.1 / sortable 10.0.0, keyboard and touch, localized announcements).
- Probe `scripts/reference_lists_probe.py` 15/15 (backend CI). The neighbouring probes still pass: daily work 44/44, admin 43/43, contract 31/31. Mocked UI tests `tests/lists.spec.ts` 2/2.
- G-007 registry: 1042 fields, 0 problems.

## 2026-10-24 · A4 · the service catalogue · A5 · the live system map

Slices: `docs/slices/A4-service-catalogue.md`, `docs/slices/A5-live-system-map.md`.

- `ioeti-commercial`: `CatalogService` and the catalogue endpoints.
  - Add and change services with their version, under the native product permissions.
  - Units and categories.
  - Accounting readiness from finance's set-up; no tax is set or guessed (D-06).
- UI:
  - the Service catalogue page (price-tag cards, filters, add/edit dialogs);
  - in live mode, the system map replaces the schematic capability map: real status, decisions, live access check and links;
  - the top bar no longer overflows on phones in English.
- Probes: `scripts/catalog_probe.py` 7/7 (backend CI); `quote_probe.py` 50/50. `probe_fixtures` clean-up also removes files a test user generated.
- Tests: `tests/catalog.spec.ts` 3/3 and 2 system-map tests (mocked suite 78); the 3 schematic journey tests moved to the demo suite (27).
- G-007 registry: 1072 fields, 0 problems.

## 2026-10-24 · A6 · campaigns from the platform

Slice: `docs/slices/A6-campaigns.md`.

- `ioeti-marketing`: `CampaignService` and `/ws/ioeti/campaigns`.
  - The board, the record, add and change, and stage moves with the allowed transitions only.
  - Results within the caller's read scope; no cost, revenue or ROI is invented.
  - Sending stays D-10.
- `ioeti-admin`: campaign types as a fifth reference list (needs `axelor-marketing`).
- UI: the Campaigns board (drag between stages with mouse or touch, a "move to" picker for keyboard and phones, localized announcements) and the campaign page with its results funnel. The system map now shows marketing as live.
- Probe `scripts/campaign_probe.py` 11/11 (backend CI); mocked UI tests `tests/campaigns.spec.ts` 2/2 (mocked suite 80, demo 27).
- G-007 registry: 1099 fields, 0 problems. The view record is named `MarketingCampaignView`, because fundraising already has a `CampaignView`.

## 2026-10-24 · A7 · field visits · record numbering

Slice: `docs/slices/A7-field-visits.md`.

- `ioeti-operations` (now on `axelor-intervention`): `VisitService` and `/ws/ioeti/visits`, on the native `Intervention`.
  - Plan and reschedule in the caller's time zone.
  - Start, pause, finish and cancel through the native service (checklist rule kept).
  - An append-only visit log (`VisitNote`, migration V017/U017).
  - The person's agenda now shows their planned and running visits.
- `ioeti-admin`: `Numbering` and `/ws/ioeti/admin/numbering`, how the records the platform creates are numbered.
  - Visits have no sequence on a fresh database, so saving answers 422 `NUMBERING_REQUIRED` until an administrator sets a prefix.
  - No format is chosen for the company.
- UI:
  - the Field visits page (grouped list, mine/all, the visit page with on-site actions and the log, plan and new-visit dialogs);
  - "Plan a visit" from an account;
  - visit items in the agenda;
  - the admin console's Numbering tab;
  - the system map shows field visits as live (D-10 holds sending to the client).
- Probe `scripts/visit_probe.py` (backend CI); mocked UI tests `tests/visits.spec.ts` 4/4. The live system-map test now expects field visits to be live.
- G-007 registry: 1156 fields, 0 problems. Visit notes and the account name are personal data.
