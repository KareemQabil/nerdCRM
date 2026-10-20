# Wave 4a: external training (`ioeti-training`)

Status: LIVE_INTEGRATION_PASS and NEGATIVE_SECURITY_PASS on Axelor 9.1.10 + PostgreSQL 16 (`scripts/training_probe.py`, also in backend CI). Every role used in tests is a fixture; production roles are D-07. Certificates, refunds, cohort cancellation and identity documents wait for **D-03**.

## 1. Why a new module

AOS `axelor-talent` training (`Training`, `TrainingSession`, `TrainingRegister`) is for **employees**: a register links to an `Employee`. IOETI trains **external paying participants** from client organizations, with seat limits and a waitlist. That is a new bounded context (`docs/MODULE_REUSE_MATRIX.md`, `docs/DOMAIN_GAP_ANALYSIS.md` #2). Trainees and sponsoring clients are native `Partner` records; courses belong to the native-extended `BusinessLine` (`TRAINING`).

## 2. Model (`ioeti_training_*` tables, migration V005)

| Entity | Purpose | Key rules |
|---|---|---|
| `TrainingCourse` | catalog entry | unique code (`A-Z0-9-`, 2–30), name, Arabic name, hours 1–2000 |
| `TrainingCohort` | one run of a course | unique code; capacity 1–500; minimum seats ≤ capacity; end ≥ start; `PLANNED → OPEN → CLOSED`; the creator is its coordinator |
| `TrainingEnrollment` | a trainee in a cohort | `CONFIRMED` up to capacity, then `WAITLISTED` with position 1..n; `CANCELLED` |
| `CohortSession` | one dated session | named so because AOS talent already defines `TrainingSession` (Axelor entity names are global) |
| `TrainingAttendance` | one trainee at one session | `PRESENT`/`ABSENT`/`EXCUSED`; unique per session and enrolment; confirmed trainees only |

## 3. Concurrency

Every enrolment change locks the cohort row (`PESSIMISTIC_FORCE_INCREMENT`), as quotation milestones do. Concurrent enrolments therefore run one after the other, and the cohort version moves each time, so the second request with the same version gets 409. This keeps two invariants:
- confirmed enrolments never exceed capacity;
- waitlist positions stay 1..n with no gaps.

Cancelling a confirmed enrolment promotes the first waitlisted trainee in the same transaction.

## 4. API (`/ws/ioeti/training`)

| Endpoint | Notes |
|---|---|
| `GET/POST /courses` | create needs course create permission |
| `GET /cohorts[?courseId]`, `GET /cohorts/{id}` | seat counts: confirmed, waitlisted, seats left |
| `POST /cohorts` | the caller becomes coordinator |
| `POST /cohorts/{id}/open`, `/close` | `{version}`; wrong state → 422 `COHORT_STATE` |
| `POST /cohorts/{id}/cancel` | **422 `BLOCKED_BY_POLICY` (D-03)** |
| `GET/POST /cohorts/{id}/enrollments` | `{version, traineeId, clientId?}`: not open → 422 `COHORT_NOT_OPEN`; duplicate → 409 `ALREADY_ENROLLED`; unknown or unreadable partner → 422 (no oracle) |
| `POST /enrollments/{id}/cancel` | `{version}`; twice → 422 `ALREADY_CANCELLED` |
| `POST /enrollments/{id}/certificate` | **422 `BLOCKED_BY_POLICY` (D-03)** |
| `GET/POST /cohorts/{id}/sessions` | `{version, title, startsAt, durationMinutes 15–720}` |
| `GET/POST /sessions/{id}/attendance` | `{version, enrollmentId, status}`; records or corrects |

Every record goes through native permissions and record filters. A cohort outside the caller's scope answers the same 404 as a missing id, and read-only callers get 403. Trainee and client names and attendance are `PERSONAL` in the G-007 registry; national IDs are not modelled.

## 5. UI (`apps/ioeti-web/src/TrainingPage.tsx`, real mode)

`#/training` (sidebar "Training") shows the cohorts the caller may see, with confirmed/capacity and waitlist counts. Creating a course and planning a cohort are inline forms.

A cohort shows:
- its seat counts, and open/close actions for its coordinator;
- trainees: confirmed first, then the waitlist with positions; each can be cancelled;
- an enrolment form: choose a sponsoring account, then one of its contacts (Account 360 APIs);
- sessions, an add-session form, and attendance per confirmed trainee (present, absent, excused).

"Cancel cohort" and "Issue certificate" are visible but disabled, with the D-03 note. Non-coordinators see a read-only view. The fictional demo keeps its own training workspace (`DEMO_MODE`). Mocked test: `training: open a cohort, enrol into seats then the waitlist…`.

## 6. Not done

| Item | Why |
|---|---|
| Certificates (wording, serials, QR, pass rules, attendance threshold) | D-03 |
| Refunds, cohort cancellation, transfers between cohorts | D-03 |
| National ID, date of birth or other identity documents | D-03 (and G-007: would be `RESTRICTED`) |
| Invoicing enrolments, seat prices | D-06 |
| Trainer pay | D-03, D-06 |
