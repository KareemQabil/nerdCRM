# M1: external training under D-03 (`ioeti-training`)

D-03 was signed on 2026-10-25. Under it:
- the training coordinator issues certificates after reviewing who meets the course's criteria;
- the national ID is asked per course and stored as restricted data;
- refunds are computed from the cancellation policy, approved by finance and issued as a credit note.

This slice replaces the two `422 BLOCKED_BY_POLICY` gates of Wave 4a (`W4-external-training.md`) with that behaviour. Every rule is read from a policy, and each one fails closed with `422 POLICY_NOT_SET` until it is set.

## Policies used

| Key | Scope | Used for |
|---|---|---|
| `training.certificate` | course id | `minAttendancePercent`, optional `passMark`: eligibility, assessment, issuing |
| `training.national-id` | course id | `NOT_ASKED` / `OPTIONAL` / `REQUIRED` at enrolment |
| `training.cancellation` | business line (course's line, `TRAINING`), default allowed | `steps` (`daysBeforeStart` → `refundPercent`); **new optional field `cohortCancelledRefundPercent`** for a cohort we cancel |

`cohortCancelledRefundPercent` is a small addition to `PolicyCatalog`. Without it, refunds for a cohort we cancel would have been hard-coded. The R1 recommendation adds `100`. `docs/slices/R1-recommended-values.md` still shows the old row and should say "100% when we cancel the cohort".

A record keeps the policy version it was decided under. A certificate keeps its criteria version, and a refund keeps its cancellation version.

## Rules

**Attendance and eligibility**
- Attendance = sessions marked `PRESENT` ÷ all scheduled sessions of the cohort.
  - Absent, excused and not-yet-recorded sessions do not count.
  - The result is rounded down, so 79.99% never shows as 80%.
- Eligible means all of these:
  - the trainee is confirmed;
  - the cohort has sessions;
  - attendance ≥ the minimum;
  - where `passMark` is set, a score ≥ `passMark`.
- When a trainee is not eligible, the first unmet criterion is named: `NOT_CONFIRMED`, `NO_SESSIONS`, `ATTENDANCE_BELOW`, `SCORE_MISSING` or `SCORE_BELOW`.

**Assessment**
- A score of 0–100 with two decimals.
- Only for a course with a pass mark (otherwise `NOT_ASSESSED`).
- Only for a confirmed trainee who holds no certificate.

**Certificates**
- Issued only for an `OPEN` or `CLOSED` cohort.
- The serial comes from the **native Axelor sequence `ioetiTrainingCertificate`**, the repo's numbering pattern. Without it the answer is `422 NUMBERING_NOT_SET`.
- The certificate keeps the wording facts as issued: trainee name, course name (both languages), attendance, score and policy version.
- One issued certificate per enrolment, under the cohort's row lock, so a bulk issue and a single issue never collide.
- Revoking needs a reason. The reason is stored and never returned (RESTRICTED). After a revoke, a new certificate gets a new serial.

**National ID**
- Stored in its own entity `TrainingNationalId` (`ioeti_training_national_id`), with its own model permissions (AGENTS.md invariant 3).
- Input only: `Enroll.nationalId`, `RecordNationalId.nationalId`. Responses carry only `identityProvided`.
- Validation: 14 digits, a 2/3 century digit and a real birth date. Arabic-Indic digits are accepted and stored as ASCII.
- `REQUIRED` refuses an enrolment without it, and `NOT_ASKED` refuses one with it.
- While the policy is not set nothing is collected. A number offered anyway answers `POLICY_NOT_SET`; it is never stored.
- **How long it is kept (owner decision, 2026-10-29):**
  - The `NATIONAL_IDS` retention type of `privacy.retention` counts from the certificate's issue date, or from the cohort's
    end when no certificate was issued. The recommended value is 12 months.
  - When the period runs out, the record is listed in the retention queue. The policy owner erases the number in one step
    ("امسح الرقم"); the enrolment and the certificate stay. Nothing is erased automatically.
  - `retention_probe.py` checks it.

**Money (the honest minimum path)**
- Training fees are not invoiced by this module. Finance invoices through its own D-06 flow and then **links the enrolment to the issued customer invoice** (`TrainingFee`) with the enrolment's share including tax.
  - The invoice must be the trainee's or the sponsoring account's.
  - The shares linked to one invoice never exceed it, so one invoice can cover a sponsor's group.
- **What was paid** for an enrolment is the money received on the invoice, shared in proportion to the enrolment's part and never above it.
  - Received money means validated payments and advance payments. Credit notes, which Axelor counts in `amountPaid`, are excluded.
- **Refund** = the policy's share × paid, to the piaster.
  - For a cancellation by the trainee, the share is the step with the largest `daysBeforeStart` still met, counting days from the cancellation date to the cohort start.
  - When none is met (too late, or after the start), nothing is refunded.
  - For a cohort we cancel, the share is `cohortCancelledRefundPercent`.
- The **credit share** of the invoice is refund ÷ invoice total in hundredths of a percent, rounded down. D-06 credit notes are a share of the invoice, and rounding down means the credit never exceeds the refund. A share below 0.01% means no refund is due.
- **Cancelling an enrolment** depends on what was paid:
  - **No invoice linked, or nothing paid:** the enrolment is cancelled as before, with no refund.
  - **Paid:** the policy is required. Without it the answer is `POLICY_NOT_SET` and nothing changes. Otherwise the refund is requested in the same transaction, and the person who linked the invoice gets an in-app notice (`TRAINING_REFUND_REQUESTED`).
  - An enrolment cancelled before its invoice was linked can request its refund later. The refund is computed as on the day it was cancelled, under the policy in force then.
  - Without a link the request answers `INVOICE_REQUIRED`.
- **Cancelling a cohort** cancels every active enrolment and requests each paid one's refund. It is refused while certificates are issued (`CERTIFICATES_ISSUED`).
- **Finance decides each refund.**
  - **Approve:** finance issues the credit note with the **existing D-06 service** (`POST /ws/ioeti/finance/invoices/{id}/credit-notes`, percent = the credit share, reason `Training refund #<id> · <cohort>`). The refund then records it.
    - The server checks that it is a ventilated client credit note of the same invoice, for that share (within native line rounding), and not used by another refund.
    - The refund becomes `CREDITED` with the credit note number and amount.
  - **Reject:** needs a reason, and nothing is credited.
  - Both need native invoice create and write rights. The requester gets an in-app notice.
  - **A refund is never marked refunded without its credit note.**
- **Why two calls?** `ioeti-workspace` (which holds `CollectionService`) already depends on `ioeti-training`, so training cannot call it without a module cycle.
  - The web app makes both calls in one action. If the second call fails, the refund shows `pendingCreditId`, which is the credit note issued for it but not yet recorded. Approving again records that credit note instead of issuing a second one.
- A D-06 credit note first reduces what the client still owes. When the invoice was fully paid, the client has a credit balance that finance pays back through the native refund payment.

## Endpoints (`/ws/ioeti/training`)

| Endpoint | Notes |
|---|---|
| `GET /cohorts/{id}/rules` | the three policies in force today (null = not set) |
| `GET /cohorts/{id}/eligibility` | per trainee: present/sessions, attendance %, score, eligible, reason, certificate |
| `POST /enrollments/{id}/assessment` | `{version, score}` |
| `POST /enrollments/{id}/certificate` | `{version}`, **replaces the D-03 gate**; 422 `NOT_ELIGIBLE` (field code = reason), `ALREADY_CERTIFIED`, `NUMBERING_NOT_SET`, `POLICY_NOT_SET` |
| `POST /cohorts/{id}/certificates` | `{version}` (cohort): issues to all eligible, lists the others with the reason |
| `GET /certificates/{id}`, `GET /cohorts/{id}/certificates` | certificate as issued (print view) |
| `POST /certificates/{id}/revoke` | `{version, reason}` |
| `POST /cohorts/{id}/enrollments` | gains `nationalId` (input only) |
| `POST /enrollments/{id}/national-id` | `{version, nationalId}`: record or correct |
| `GET /enrollments/{id}/invoices` | issued invoices of trainee/sponsor that can be linked (invoice read rights) |
| `POST /enrollments/{id}/fee`, `POST /fees/{id}/unlink` | finance links (`{invoiceId, amount?}`) or removes a wrong link (not once a refund exists) |
| `GET /enrollments/{id}/cancellation` | preview: outcome, paid, days before start, %, refund; link and refund |
| `POST /enrollments/{id}/cancel` | as before, plus the refund (see Rules) |
| `GET /cohorts/{id}/cancellation`, `POST /cohorts/{id}/cancel` | preview and `{version}`, **replaces the D-03 gate** |
| `POST /enrollments/{id}/refund` | `{version}`: request later for a cancelled enrolment |
| `GET /refunds?status=REQUESTED\|CREDITED\|REJECTED\|ALL`, `GET /cohorts/{id}/refunds` | record-filtered |
| `POST /refunds/{id}/approve` `{version, creditInvoiceId}`, `POST /refunds/{id}/reject` `{version, reason}` | finance |

All endpoints use `SecurityCheck` and `JpaSecurity` record filters. An unreadable record answers the same 404 as a missing one, a read-only caller gets 403, and a stale version gets 409. Responses are DTO records, classified in `docs/security/pii-classification.json`.

## Model (migration V028, rollback U028)

The enrolment gains `assessmentScore`, `assessedBy`, `assessedOn` and `cancelledOn`, and cohorts gain the status `CANCELLED` (4).

New tables:
- `ioeti_training_certificate`;
- `ioeti_training_national_id` (unique per enrolment);
- `ioeti_training_fee` (unique per enrolment, references `account_invoice`);
- `ioeti_training_refund` (unique per enrolment and per credit note).

`ioeti-training` now depends on the upstream `axelor-account` module.

## UI (`TrainingPage.tsx`, `trainingApi.ts`, `training.css`)

**Course rules card.** It lists criteria, national-ID collection and refund steps, and names each missing policy.

**Trainees table**
- A national-ID column with on file / not on file, and a record action. Shown only when the course asks for the ID.
- An "Invoice and refund" dialog: finance links an invoice and its share, and the coordinator requests a late refund.
- Cancelling an enrolment opens a dialog with the computed refund before confirming. Confirming is disabled, with the reason, when the policy is missing.

**Enrolment form.** It shows a national-ID field when the course asks for it, required when the course requires it.

**Certificates and assessment card**
- Score entry, eligibility with the reason, and issuing one or all.
- A printable certificate (print dialog; on paper only the certificate prints), and revoking with a reason.

**Cancel cohort dialog.** It shows how many trainees are cancelled and the total refund, or why cancelling is blocked.

**Refund requests**
- Per cohort, and as a top-level "Refund requests" view for anyone who may read refunds.
- Finance approves (credit note through finance, then recorded) or rejects with a reason.

## Tests

- **Unit:** `TrainingD03RulesTest` (13), covering the refund steps (boundaries, after the start, unordered steps), whole days, paid share, refund and credit share rounding, credit-note match tolerance, attendance rounding, eligibility reasons, scores and national IDs. Together with `TrainingRulesTest` (4), all pass.
- **Playwright** (`tests/training.spec.ts`, 10 tests, mocked), covering:
  - rules, score, issue, print and revoke;
  - national ID sent once and never shown;
  - missing policies explained;
  - the cancellation preview, and the policy block;
  - finance links an invoice;
  - the cohort cancel block;
  - finance approve (finance credit note, then approve) and reject;
  - axe WCAG 2.1 A/AA in light and dark, and a 390 px phone;
  - the Wave 4a flow, moved from `app.spec.ts`.
- **Live:** `scripts/training_probe.py` gains a D-03 section, with positive and negative checks listed in its docstring. The issued invoice, its payment and the credit note are SQL fixtures in the disposable database. The D-06 credit-note service itself is covered by `invoicing_probe.py`.

## Open

- **Coordinator follow-ups outside this module:**
  - `RoleAdmin` record types for the four new entities, so role templates can grant them;
  - a Numbering row for `ioetiTrainingCertificate`;
  - inbox labels and links for `TRAINING_REFUND_*` notices;
  - the R1 doc row for `cohortCancelledRefundPercent`.
- Not decided:
  - certificate wording and layout beyond the facts printed;
  - a QR or public verification (D-10 `CERTIFICATE_CHECK`);
  - transfers between cohorts;
  - what happens to an unpaid remainder when a partly paid enrolment is cancelled;
  - national-ID retention (D-07).
