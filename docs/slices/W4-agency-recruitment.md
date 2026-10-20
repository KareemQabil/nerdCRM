# Wave 4D: agency recruitment for clients (`ioeti-recruitment`)

Status: LIVE_INTEGRATION_PASS and NEGATIVE_SECURITY_PASS on Axelor 9.1.10 + PostgreSQL 16 (`scripts/recruitment_probe.py`, also in backend CI), with mocked browser contracts for the UI (`apps/ioeti-web/tests/app.spec.ts`). Every role used in tests is a fixture; production roles and scopes are D-07.

Everything that commits IOETI or exposes restricted candidate data waits for **D-04**: sharing the CV or contact details with a client, offer terms (salary), fee amounts and invoices (with D-06), guarantee periods and replacement claims, and retention of CVs and pay expectations.

## 1. Why a new module

AOS `axelor-talent` (`JobPosition`, `JobApplication`, `HiringStage`) models the company's **own** hiring: a job position belongs to one of the company's departments, and the applicant becomes an employee. IOETI's recruitment line recruits **for client organizations**: a client places a job order, IOETI sources candidates, submits them to that client with their consent, and earns a fee when a candidate is placed. Reusing `JobApplication` would mix client candidates with IOETI's own applicants and HR data, and would expose them to whoever administers internal hiring (gap G-052, `docs/DOMAIN_GAP_ANALYSIS.md` #3). This is a new bounded context.

Native objects are reused where they fit: `Partner` is the client (the job order links to the Account 360 record), and `User` is the recruiter.

## 2. Model (`ioeti_rec_*` tables, migration V008)

| Entity | Purpose | Key rules |
|---|---|---|
| `ClientJobOrder` | a client's request for N positions | unique reference; client required and readable by the caller; headcount 1–500; `OPEN ⇄ ON_HOLD → CLOSED`, `FILLED` set by the server when placements reach the headcount; the creator is the recruiter |
| `RecruitmentCandidate` | the non-restricted profile | name, current role, years of experience; the creator owns it |
| `CandidatePrivateProfile` | **restricted** data, one row per candidate | e-mail, phone, expected salary, CV reference; written through the API, never returned (read → D-04/D-07) |
| `CandidateConsent` | the candidate's consent **for one job order** | method (written / e-mail / recorded call), date (not in the future), evidence reference; revocable, never deleted |
| `CandidateApplication` | a candidate in one job order's pipeline | unique per order and candidate; `SOURCED → SCREENED → SHORTLISTED → SUBMITTED → INTERVIEWING → OFFERED → PLACED`, plus `REJECTED`/`WITHDRAWN` from any open stage |
| `ClientInterview` | a client interview round | only after submission; outcome recorded once |
| `Placement` | a confirmed hire | one per application; only after an accepted offer; guarantee status `TERMS_PENDING` (D-04) |
| `RecruitmentFeeMilestone` | a billable **event** (offer accepted, candidate started) | unique per placement and kind, so recording it again changes nothing; no amount and no invoice (D-04, D-06) |

The consent is per job order on purpose: a candidate who agreed to be presented to one client has not agreed to be presented to another, so submission never "inherits" consent from another order.

## 3. Submission: what is and is not shared

`POST /applications/{id}/submit` records that the recruiter presented the candidate to the job order's client. It requires:

1. the caller may change this application (recruiter scope; read-only users get 403, others 404);
2. the candidate is `SHORTLISTED` (screening happened);
3. an **unrevoked consent for this job order** exists (otherwise 422 `CONSENT_REQUIRED`; a consent revoked before submission blocks it).

The system does not send anything to the client. What a client may see is limited to the non-restricted profile. Sharing the CV or contact details (`POST /applications/{id}/share-cv`) is **422 `BLOCKED_BY_POLICY` (D-04)**. If the owners decide in D-04 that consent wording must be approved before any presentation, `submit` is the single command to close.

## 4. Concurrency

Every pipeline command locks its application row, and attaching, consent and placement lock the job order or candidate row (`PESSIMISTIC_FORCE_INCREMENT`). Concurrent writers run one after the other, and a second writer with the same version gets 409. The probe sends simultaneous submissions of one application each round: exactly one succeeds and the rest get 409. Placement locks the job order, so two recruiters cannot both fill the last position (422 `HEADCOUNT_FILLED`).

## 5. API (`/ws/ioeti/recruitment`)

| Endpoint | Notes |
|---|---|
| `GET/POST /job-orders`, `GET /job-orders/{id}`, `POST /job-orders/{id}/status` | `{reference, clientId, title, headcount, location?, requirements?}`; status `OPEN`/`ON_HOLD`/`CLOSED`; filled or closed → 422 `ORDER_STATE` |
| `GET/POST /candidates`, `GET /candidates/{id}` | non-restricted profile; `privateProfileOnFile` says whether restricted data exists |
| `PUT /candidates/{id}/private` | write-only `{version, email?, phone?, expectedSalary?, cvReference?}`; the answer is the non-restricted view |
| `GET /candidates/{id}/private` | **422 `BLOCKED_BY_POLICY` (D-04, D-07)** after the normal access check |
| `GET/POST /candidates/{id}/consents`, `POST /consents/{id}/revoke` | `{version, jobOrderId, method, givenOn, evidenceReference?}`; revoke twice → 422 `CONSENT_REVOKED` |
| `GET/POST /job-orders/{id}/applications` | attach `{version, candidateId}`; twice → 409 `ALREADY_IN_PIPELINE`; order not open → 422 `ORDER_NOT_OPEN` |
| `POST /applications/{id}/stage` | `SCREENED`, `SHORTLISTED`, `REJECTED`, `WITHDRAWN`; anything else → 422 `STAGE_TRANSITION` |
| `POST /applications/{id}/submit` | see §3 |
| `POST /applications/{id}/share-cv` | **422 `BLOCKED_BY_POLICY` (D-04)** |
| `GET/POST /applications/{id}/interviews`, `POST /interviews/{id}/outcome` | `PASSED`/`FAILED`/`NO_SHOW`; second outcome → 422 `OUTCOME_RECORDED` |
| `POST /applications/{id}/offer`, `/offer-answer` | offer date only (terms are D-04); needs a passed interview |
| `POST /applications/{id}/placement`, `GET /job-orders/{id}/placements` | `{version, startDate}`; duplicate → 409 `ALREADY_PLACED`; headcount reached → 422 `HEADCOUNT_FILLED`; records the `OFFER_ACCEPTED` event |
| `POST /placements/{id}/started` | records `CANDIDATE_STARTED` once (idempotent) |
| `POST /placements/{id}/invoice` | **422 `BLOCKED_BY_POLICY` (D-04, D-06)** |
| `POST /placements/{id}/replacement` | **422 `BLOCKED_BY_POLICY` (D-04)** |

Records outside the caller's scope answer the same 404 as a missing id. In the G-007 registry, candidate names, roles, consent details and pipeline stages are `PERSONAL`; e-mail, phone, expected salary and CV reference are `RESTRICTED` and only appear in the write command `SavePrivate`.

## 6. UI (`#/recruitment`)

- **Job orders register**: search by reference or title, status, placed/headcount, loading, empty and retry states.
- **Job order record**: client link to Account 360, status actions, a pipeline board by stage with the consent state on every card, and an application panel with the next allowed action only (screen, shortlist, submit, interviews, offer, placement). Disabled policy actions (share CV, invoice fee, claim replacement) state the decision they wait for.
- **Candidates register** and **candidate record**: the non-restricted profile, a restricted section that records but never shows the data, and the consents per job order with revoke.
- Server errors are mapped to plain messages (`CONSENT_REQUIRED`, `HEADCOUNT_FILLED`, 409 refresh, …). Buttons only reflect the server's rules; every rule is enforced by the API.

## 7. Not done

| Item | Why |
|---|---|
| Sharing CV/contact details with a client; reading restricted data | D-04 (sharing terms, retention) and D-07 (who may read) |
| Offer terms, fee structure and amounts, fee invoices | D-04 and D-06 |
| Guarantee period, replacement claims and refunds | D-04 |
| Candidate self-service, client portal | D-10 |
| Business-line and team scopes for recruiters | D-07; fixtures use "own records" |
| CV file storage | needs D-04 retention; only a reference is recorded |
