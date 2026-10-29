# M1: recruitment fees, guarantee and early exits (D-04)

Status: built. Checked locally with unit tests (12/12) and mocked browser tests (`tests/recruitment.spec.ts` 6/6; the
recruitment tests in `tests/app.spec.ts` 4/4). `scripts/recruitment_probe.py` has new live checks that have **not yet run
against a server with this code**. Migration `V029__ioeti_recruitment_fees.sql` was applied, re-applied and rolled back on a
scratch copy of the dev schema. `db_migrate.py verify` still has to run once Hibernate has created the new objects.

## What D-04 says (signed 2026-10-25)

- A candidate's CV and contact details go to a client only with the candidate's consent for that job order, and only
  through the client portal.
- When the placement fee is invoiced (start date or offer accepted), the fee %, the guarantee period and the replacement
  rules are policy settings per client agreement.

## What was built

| Rule | How |
|---|---|
| Sharing the CV or contact details | still closed: `POST /applications/{id}/share-cv` answers 422 `BLOCKED_BY_POLICY` and says the client portal (D-10) is not built yet. No portal was built. |
| The client agreement | policy `recruitment.agreement`, scoped by the client account id, with a default allowed. Its fields are `feePercent`, `invoiceOn` (START_DATE or OFFER_ACCEPTED), `guaranteeDays`, `replacement` (REPLACE, PARTIAL_REFUND or NONE) and `refundPercent`. The version in force is copied onto the placement **once**: when the placement is confirmed, or the first time it is settled after a policy owner sets it. Later policy changes do not rewrite it. |
| The offered salary | restricted. It is recorded with the offer (`annualSalary`, `currencyCode`) or with `PUT /applications/{id}/offer-terms`, and stored in its own entity `OfferPrivateTerms` with its own permission object. It is read on the server only and never returned. After the fee is requested it no longer changes (422 `FEE_REQUESTED`). |
| The fee | When the agreement's trigger happens (the placement for OFFER_ACCEPTED, the recorded start for START_DATE), the fee is `feePercent × annual salary`, rounded half up to 2 decimals. It becomes **one** `RecruitmentFeeRequest` per placement (unique on placement and kind). Holders of the `ioeti-finance` role get an in-app notice. |
| Who sees the fee amount | Only people who may read the fee request: the fee and the percentage together reveal the salary. Everyone else sees the status only. |
| The guarantee | Its last day is the recorded start date plus `guaranteeDays`, and that day counts. It shows TERMS_PENDING, NOT_STARTED, ACTIVE (with the days left), CLOSED, EARLY_EXIT or EXITED_AFTER. |
| Early exit | `POST /placements/{id}/early-exit` takes `{version, exitedOn, reason: RESIGNED|DISMISSED|OTHER}`, once. Within the guarantee, the agreement's rule applies. **REPLACE**: the job order reopens, the departed placement no longer counts towards the headcount, and the next placement on the order is linked to it as a free replacement (`feeWaived`, no fee request). **PARTIAL_REFUND**: a credit request for `refundPercent` of the fee goes to finance, which is notified; if no fee was ever requested, nothing is refunded. **NONE**: only the departure is recorded. After the guarantee, only the departure is recorded. |
| Fail closed | No agreement for the client and no default: the fee request and an exit both answer 422 `POLICY_NOT_SET` and name the policy. The placement page says the same in plain words. Other refusals: `OFFER_TERMS_MISSING`, `FEE_NOT_DUE` (START_DATE agreement before the start), `FEE_WAIVED`, `NOT_STARTED`, `ALREADY_EXITED` (409), and a stale version (409). |

### Finance and the invoice-request flow (decision taken here)

The brief asked to reuse the workspace `InvoiceRequest`. That entity is tied to a confirmed sales order and one of its
payment milestones (`quote` and `milestone` are NOT NULL), and finance issues it through `TimetableService.generateInvoice`.
A placement has no sales order. Also, `ioeti-workspace` depends on `ioeti-recruitment`, so recruitment cannot reference
workspace classes without creating a cycle. Recruitment therefore records its own request, `RecruitmentFeeRequest`. It
copies InvoiceRequest's vocabulary: status REQUESTED / CANCELLED / ISSUED, amount before tax, requested by and requested at.
It also carries the client, the currency, the rate and the agreement version.

Finance sees these requests at `GET /ws/ioeti/recruitment/fee-requests` and gets an in-app notice. **Nothing is posted to
accounting from recruitment, and nothing yet marks a request ISSUED.** Issuing the invoice or credit note in Axelor is a
follow-up in the workspace finance queue. That module already depends on recruitment, so it can list these rows and issue
them.

## API changes (`/ws/ioeti/recruitment`)

| Endpoint | Change |
|---|---|
| `POST /applications/{id}/offer` | also takes `annualSalary` and `currencyCode`. The salary is write-only and needs rights on `OfferPrivateTerms`. |
| `PUT /applications/{id}/offer-terms` | new: `{version, annualSalary, currencyCode}`. Write-only. |
| `GET /placements/{id}` | new: the placement page record. It holds the fee status, amount (finance only) and percentage, the trigger, the guarantee dates and days left, the rule, and the exit and its outcome. |
| `POST /placements/{id}/started` | a future date is refused. Recording the start also dates the guarantee and settles the fee. |
| `POST /placements/{id}/invoice` | **was BLOCKED_BY_POLICY**. It now asks for the fee idempotently and returns the placement. |
| `POST /placements/{id}/early-exit` | new. It **replaces** `POST /placements/{id}/replacement`, which used to answer BLOCKED_BY_POLICY and is removed. |
| `GET /fee-requests?state=OPEN|ALL` | new, for finance. Fee and credit requests within the caller's read scope. |
| `GET /job-orders/{id}`, `/placements` | `placed` counts the placements that hold a position. One whose candidate left with a free replacement opened no longer counts. |

New records are classified in `docs/security/pii-classification.json`. `RecordOffer.annualSalary` and
`SaveOfferTerms.annualSalary` are RESTRICTED (input only). Fee amounts are BUSINESS, and exit dates and reasons are PERSONAL.

## Model (migration V029 / U029)

- `ioeti_rec_offer_private` (`OfferPrivateTerms`): application (unique), annual salary, currency.
- `ioeti_rec_fee_request` (`RecruitmentFeeRequest`): unique (placement, kind), plus `refund_of` linking a credit to its fee.
- `ioeti_rec_placement` gains: agreement version, fee %, trigger, guarantee days and end date, rule, refund %, exit date,
  reason and outcome, `replacement_of`, `fee_waived`.

## UI (`#/recruitment`)

- **Placement page** (`#/recruitment/placements/{id}`, a full page):
  - the fee card: status, the plain reason when something is missing, with a link to Policies, the amount for finance only,
    and the salary form when the salary is missing;
  - the guarantee card: a countdown with a meter, the last day and the rule;
  - "record the start";
  - "the candidate left" in a dialog that says what will happen for the chosen date before anything is recorded.
- **Job order**: the placements table shows the guarantee and fee status and links to the placement page. The disabled
  invoice and replacement buttons are gone.
- **Application panel**: the offer form takes the annual salary (optional). An offer without a salary shows that it is
  missing and gives a write-only form. The salary is never displayed.

## Tests

- `PlacementTermsTest`: fee rounding, refund, guarantee end (including the last day and a leap year), days left, the
  trigger, the exit outcome per rule, the guarantee status, and reading the policy value.
- `tests/recruitment.spec.ts`:
  - the fee requested, the countdown, and a REPLACE exit with the dialog's preview before and after the guarantee;
  - POLICY_NOT_SET explained and refused;
  - PARTIAL_REFUND with the amount hidden;
  - the salary recorded write-only, and the start recorded;
  - the job-order link, and read-only;
  - phone width and an axe scan.
- `scripts/recruitment_probe.py`, new checks:
  - fail-closed POLICY_NOT_SET and NOT_STARTED;
  - start idempotence, and a future start refused;
  - the salary is write-only and never echoed;
  - one fee request (36000 = 15% of 240000), and the finance notice;
  - salary locked, isolation (404/403), and the amount hidden from read-only;
  - stale / 403 / range / 409 on exits;
  - REPLACE reopens the order, and the free replacement gets FEE_WAIVED;
  - OFFER_ACCEPTED requests the fee at placement;
  - PARTIAL_REFUND 40% credit (14400) with the notice;
  - an exit after the guarantee changes nothing;
  - CV sharing stays closed.

## Still open

- **Issuing the fee invoice or credit note** from `RecruitmentFeeRequest` in Axelor accounting needs workspace/finance code;
  cancelling a request too.
- **Role templates** (`ioeti-admin` `RoleAdmin.TYPES`) do not yet list `OfferPrivateTerms` (restricted) and
  `RecruitmentFeeRequest`, so production roles cannot grant them from the admin console.
- **Retention** (`RetentionService`) does not yet clear `ioeti_rec_offer_private`.
- **Inbox labels and links** for `RECRUITMENT_FEE_REQUESTED`, `RECRUITMENT_REFUND_REQUESTED` and
  `RECRUITMENT_REPLACEMENT_OPENED` (subject `PLACEMENT` → `#/recruitment/placements/{id}`) belong to `InboxPage.tsx`.
- **The client portal (D-10)**: until it exists, the CV and contact details are not shared.
