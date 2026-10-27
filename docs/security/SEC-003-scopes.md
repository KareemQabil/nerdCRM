# SEC-003 (part 1): Own / Team / Business Line / All record scopes

Gap: **G-004**. Issue #12.

Status: the **mechanism** is LIVE_INTEGRATION_PASS and NEGATIVE_SECURITY_PASS for the opportunity endpoints. The **production role matrix is not defined**: it is policy D-07, and every role used in tests is a test fixture.

## 1. Design: native permissions, plus one IOETI membership field

AOP 8.2.5 `AuthSecurity` evaluates a permission's `conditionParams` as Groovy expressions on `__user__`, and ORs the conditions of all of a user's permissions. Scopes are therefore **native permission configuration**, not a second authorization engine:

| Scope | Condition (read/write permission on `Opportunity`) | Parameter | Source of the data |
|---|---|---|---|
| Own | `self.user = ?` | `__user__` | native `Opportunity.user` |
| Team | `self.team in (?)` | `__user__.teamSet` | native `Opportunity.team`, `User.teamSet` (AOS base) |
| Business Line | `self.ioetiBusinessLine in (?)` | `__user__.ioetiBusinessLines` | IOETI `Opportunity.ioetiBusinessLine`, **new** `User.ioetiBusinessLines` |
| All | none | – | – |

- **New schema.** `User.ioetiBusinessLines` (join table `ioeti_user_business_line`), added as a domain extension in `ioeti-business-lines`. No upstream file is modified.
- **How IOETI endpoints enforce scope.** They apply `JpaSecurity` filters (lists) and `RecordAccess` (single records), so every scope applies to the custom API without extra code. An out-of-scope record answers exactly like a missing id (SEC-002). Generic `/ws/rest` is closed to these users (SEC-002).

## 2. Create eligibility (reading a line ≠ selling in it)

`BusinessLineEligibility`: the administrator, or a member of the line, may create opportunities in it. This is **PROPOSED, fail-closed, pending D-07**.
- An unknown, unreadable, inactive or non-member line gives one identical 422.
- `GET /ws/ioeti/business-lines?creatable=true` lists the lines the user may create in. The UI's create form uses only that list; with no assignment, it explains why and disables saving.
- `ioeti.security.opportunity.create.scope=readable` relaxes the rule for isolated development only.

## 3. Evidence: `scripts/scope_matrix_probe.py` (also in backend CI)

**65/65** on Axelor 9.1.10 + PostgreSQL 16 (evidence in `docs/evidence/sec-003/`).

Principals:
- RepA, RepB: Own;
- Manager: Team;
- LineIso: Line, member of ISO9001;
- LineNone: Line, member of nothing, so the condition gets an empty collection;
- All;
- ReadOnly.

Fixtures:

| Opportunity | Owner | Team | Line |
|---|---|---|---|
| O1 | RepA | T | ISO9001 |
| O2 | RepB | — | TRAINING |
| O3 | admin | T | TRAINING |

What the 65 checks cover:
- each list shows exactly the principal's scope;
- GET answers 200 in scope, otherwise the same 404 as a missing id;
- PUT with the real version answers 200 in scope, otherwise 404, and **no record changed through a refused write**;
- the empty-membership user sees nothing, with no server error;
- generic `/ws/rest` is refused for every principal;
- create is accepted only in a member line;
- `creatable` lines equal the memberships;
- **revoking a membership takes effect on the next request**, for both read and create.

Regression on this branch:

| Check | Result |
|---|---|
| Pilot | PASS |
| Two-writer | 13/13 |
| Contract | 31/31 |
| Smoke | 16/16 |
| Identity | 0 leaks / 333,281 checks |
| Session | 20/20 |
| JUnit | 50/50 (+3 `BusinessLineEligibilityTest` on persisted users and lines) |
| Web mocked | 22/22 (+1: creatable lines and no-assignment state) |
| Web demo | 14/14 |

**Test hygiene.** The probes share `scripts/probe_fixtures.py`. It deletes what Axelor generates for a test user (tracking messages written by the asynchronous audit queue, follower rows including archived ones, personal team menus) and verifies by search that nothing is left. A test user that still cannot be deleted is blocked and de-grouped, and the run fails.

**Native `/ws/rest` returns full stack traces** in its error bodies (seen while debugging cleanup). After SEC-002 only maintenance users reach that API; it remains a reason not to expose it more widely.

## 4. Not done here

| Item | Tracked as / why |
|---|---|
| Production roles: Admin, GM, Marketing, Sales, Sales Manager, Ops, Auditor/Trainer, Finance, Fundraising, Reviewer, Read-only | D-07 |
| Nested teams | AOP teams are flat |
| Delegation with expiry, offboarding workflow | needs an admin UI and D-07 |
| Lead and Partner line scope | `Lead.ioetiBusinessLine` added in Wave 2 (`docs/slices/W2-lead-conversion-account360.md`); production lead rules are D-07; Partner has no line (an account can span lines) |
| Field-level scope, export/print/attachment parity | — |
| Versioned production migration for the new join table | G-008: dev uses `ddl=update`; a migration tool is not in place yet |
