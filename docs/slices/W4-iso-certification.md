# Wave 4b: client ISO certification (`ioeti-certification`)

Status: LIVE_INTEGRATION_PASS and NEGATIVE_SECURITY_PASS on Axelor 9.1.10 + PostgreSQL 16 (`scripts/certification_probe.py`, 18 checks, also in backend CI). Every role used in tests is a fixture; production roles are D-07.

Everything that grants or withdraws certification waits for **D-02**: the decision, certificates and their numbering, surveillance and recertification timing, and impartiality rules beyond the competence check.

## 1. Why a new module

AOS `axelor-quality` models the company's **own** quality management system. IOETI **certifies other organizations**: a certification cycle per client and standard, a Stage 1 and Stage 2 audit programme run by qualified auditors, nonconformities the client must answer, and then a decision taken by someone independent. That is a new bounded context (`docs/DOMAIN_GAP_ANALYSIS.md` #1, gap G-050).

Native objects are reused where they fit: `Partner` is the client, `User` the auditor and programme manager, and `BusinessLine` the standard (ISO9001, ISO22000, …). AOS `Intervention` stays the candidate for executing field visits and is not linked yet.

## 2. Model (`ioeti_cert_*` tables, migration V006)

| Entity | Purpose | Key rules |
|---|---|---|
| `CertificationCycle` | one client, one standard | unique reference; scope required; sites 1–1000; the creator is the programme manager |
| `AuditorQualification` | an auditor's competence for a standard | validity from–until; evidence reference (e.g. a course certificate number) |
| `CertificationAudit` | Stage 1 or Stage 2 | lead auditor qualified for the standard **on the planned date**; one active audit per stage; Stage 2 completes only after Stage 1; `PLANNED → COMPLETED` or `CANCELLED` |
| `Nonconformity` | a finding at an audit | grade MAJOR/MINOR/OBSERVATION, clause, statement; `OPEN → RESPONDED` (client correction and corrective action) `→ CLOSED`; none on a cancelled audit |

A cycle is **ready for decision** when Stage 2 is completed and no major nonconformity is open. The decision itself is D-02.

## 3. Concurrency

Planning, completing and cancelling audits lock the cycle row, and raising nonconformities locks the audit row (`PESSIMISTIC_FORCE_INCREMENT`). Concurrent writers run one after the other, and the second one with the same version gets 409. This keeps "one active audit per stage" true; the probe checks it with 10 simultaneous Stage 1 plans in CI.

## 4. API (`/ws/ioeti/certification`)

| Endpoint | Notes |
|---|---|
| `GET/POST /qualifications` | `{auditorId, standardCode, validFrom, validUntil, evidenceReference?}` |
| `GET/POST /cycles`, `GET /cycles/{id}` | `{reference, clientId, standardCode, scope, siteCount?}`; the view has `openMajors`, `readyForDecision` and `decisionStatus: BLOCKED_BY_POLICY` |
| `POST /cycles/{id}/decision`, `/certificate` | **422 `BLOCKED_BY_POLICY` (D-02)** |
| `GET/POST /cycles/{id}/audits` | `{version, type STAGE1/STAGE2, plannedDate, auditorId}`; unqualified → 422 `NOT_QUALIFIED`; duplicate stage → 409 `STAGE_EXISTS`; SURVEILLANCE/RECERTIFICATION → **422 `BLOCKED_BY_POLICY` (D-02)** |
| `POST /audits/{id}/complete`, `/cancel` | Stage 2 before Stage 1 → 422 `STAGE1_REQUIRED`; not planned → 422 `AUDIT_STATE` |
| `GET/POST /audits/{id}/nonconformities` | `{version, grade, clause?, statement}`; cancelled audit → 422 `AUDIT_CANCELLED` |
| `POST /nonconformities/{id}/respond`, `/close` | close before a response → 422 `RESPONSE_REQUIRED` |

A cycle outside the caller's scope answers the same 404 as a missing id, and read-only callers get 403. In the G-007 registry, auditor names and competence records are `PERSONAL`, client names are `PERSONAL` (a client can be an individual), and findings are `BUSINESS`.

## 5. Not done

| Item | Why |
|---|---|
| Certification decision, certificate issue, numbering, validity, public verification | D-02 (and D-10 for public verification) |
| Surveillance and recertification audits and their intervals; suspension and withdrawal | D-02 |
| Impartiality: separating auditor, technical reviewer and decision maker; conflict-of-interest declarations | D-02 |
| Audit duration (man-days) and multi-site sampling | scheme rules (D-02) |
| Link to `Intervention` for field execution and checklists | next slice |
| Evidence documents attached to findings | documents platform (Wave 7) |

## 6. Wave 4C: the certification workspace (UI) and its server support

`#/certification` (sidebar "Certification", real mode only; the fictional demo is unchanged).

**Register.** Search by reference or client, filter by standard, phase or "my cycles", 25 per page with "load more", and open a cycle. The filters are sent to the server (`GET /cycles?q&standardCode&phase&mine&limit&offset`) and combined there with the caller's record permissions. Search terms are positional parameters; `%` and `_` are stripped.

**Cycle record** (full-page workspace):
- **hero:** client, reference, standard, phase badge, and a link to the client account;
- **readiness checklist:** built from the server's `decisionBlockers` (`STAGE1_NOT_COMPLETED`, `STAGE2_NOT_COMPLETED`, `OPEN_MAJOR_NONCONFORMITIES`, `POLICY_D02`). "Certification decision" and "Issue certificate" are disabled, with the D-02 explanation; no audit-day or validity rules are invented;
- **Stage 1 and Stage 2 cards:** choosing a date asks the server for the auditors qualified on that day (`GET /cycles/{id}/eligible-auditors?date=`). The UI repeats no eligibility rule. The server's answers (`NOT_QUALIFIED`, `STAGE1_REQUIRED`, `STAGE_EXISTS`, 409) are shown as localized messages;
- **findings per audit:** grade, clause, statement; record the client response, then close (`RESPONSE_REQUIRED` explained);
- **audit history:** `GET /cycles/{id}/timeline` builds it from the records: cycle opened, audits planned/completed/cancelled, findings raised/responded/closed. `Nonconformity.respondedAt` and `closedAt` were added for this (migration V007).

**Auditor competence.** The qualification register shows expired qualifications. Recording a qualification uses `GET /qualifications/candidates`, an internal directory (id and name only) restricted to callers who may create qualifications.

**Read-only behaviour.** A cycle managed by someone else is read only, and the actions are not shown. The server enforces the same rule (403/404); hiding buttons is not the control.

**Tests:**
- live `certification_probe.py`, 23 checks;
- mocked Playwright tests:
  - filters and paging sent to the server, plus retry and empty states;
  - the full Stage 1 → Stage 2 → findings flow, including NOT_QUALIFIED, RESPONSE_REQUIRED and 409;
  - read-only view at phone width with no horizontal scroll.
