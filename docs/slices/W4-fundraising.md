# Wave 4E: fundraising and partnerships (`ioeti-fundraising`)

Status: LIVE_INTEGRATION_PASS and NEGATIVE_SECURITY_PASS on Axelor 9.1.10 + PostgreSQL 16 (`scripts/fundraising_probe.py`, 20 checks, also in backend CI), with mocked browser contracts for the UI (`apps/ioeti-web/tests/app.spec.ts`). Every role used in tests is a fixture; production roles are D-07.

Everything that turns a gift into accounting or a legal document waits for **D-05** (receipts, restricted-fund accounting, donor privacy, approval chain) and **D-06** (invoicing, posting, tax). Nothing here computes tax or marks money as received unless a person records it against a bank reference.

## 1. Why a new module

A native CRM `Opportunity` tracks a sale: one amount, a probability, won or lost. A grant or pledge goes through a proposal, a donor approval with conditions (restricted purpose, grant period, deliverables), a payment schedule and collections that may arrive late, partly or not at all. Treating a sales opportunity as a grants system would mix pledged money with collected money (gap G-053). This is a new bounded context.

Native objects are reused where they fit: `Partner` is the donor organisation or person (the donor profile is linked to it), the native marketing `Campaign` is used for attribution, `Currency` is the reference for amounts, and `User` is the relationship manager.

## 2. Model (`ioeti_fund_*` tables, migration V009)

| Entity | Purpose | Key rules |
|---|---|---|
| `DonorProfile` | a donor on a native account | one per account; type; "asked to stay anonymous"; the creator manages the relationship |
| `DonorSensitiveProfile` | **restricted** donor data | giving capacity, contact preference, relationship note; written through the API, never returned (read → D-05/D-07) |
| `FundingOpportunity` | a grant, donation or sponsorship being pursued | `IDENTIFIED → PROPOSAL → SUBMITTED`; `DECLINED`/`WITHDRAWN` end an open one; `APPROVED` only through approval; proposed amount and currency; campaign; renewal link; archived, never deleted |
| `FundingCommitment` | the donor's approval | one per opportunity; committed amount, approval date, grant period, restricted flag and purpose (required when restricted), agreement reference |
| `PledgeInstallment` | the payment schedule | numbered per commitment; the active installments never add up to more than the commitment; cancelled only without collections |
| `DonationCollection` | money actually received | per installment; never more than is still due; **unique bank reference** (the same transfer twice → 409); voided with a reason, never deleted |
| `GrantDeliverable` | an obligation to the donor (report, milestone) | `PENDING → SUBMITTED → ACCEPTED` |
| `StewardshipActivity` | thank-you, impact report, meeting, visit, call | dated (not in the future), short subject |

### Money is kept apart

| Figure | Source | Meaning |
|---|---|---|
| Proposed | open opportunities | what IOETI asked for; not money |
| Committed | commitments | what the donor approved; **a pledge, not revenue and not cash** |
| Scheduled | active installments | when the committed money is expected |
| Collected | recorded, non-voided collections | money a person confirmed against a bank reference |
| Outstanding | committed − collected | still to collect |
| Restricted committed | commitments with a restricted purpose | metadata only: allocation and fund accounting are D-05/D-06 |
| Invoiced | — | not applicable until D-06 (`invoice` is blocked) |

Totals are per currency and are never added across currencies. Each installment has a status computed on the server: `DUE`, `PARTIAL`, `OVERDUE` (past due and not fully collected, even when partly paid), `COLLECTED` or `CANCELLED`.

## 3. Concurrency and history

Approval locks the opportunity row. Scheduling, collections, voids and deliverables lock the commitment row (`PESSIMISTIC_FORCE_INCREMENT`). Concurrent writers run one after the other, and a second writer with the same version gets 409. Each probe round sends two simultaneous installments for the full commitment: exactly one is created, and the schedule never exceeds the commitment.

Nothing is deleted:
- archived opportunities disappear from lists but remain readable and appear on the donor timeline;
- voided collections stay listed;
- cancelled installments stay in the schedule.

The donor timeline combines stewardship activities, openings, approvals, collections, voids, deliverable submissions and archivings, with the user who did each.

## 4. Privacy

- The sensitive profile is write-only. Bank references are accepted but never returned (G-007 `RESTRICTED`); duplicate detection happens on the server.
- An anonymous donor's name is shown only to the relationship manager; everyone else, including managers reading the overview, sees "anonymous donor".
- Records outside the caller's scope answer the same 404 as a missing id.
- Sales users without fundraising rights get 403 on every fundraising endpoint. The Account 360 of a donor account shows no grant, amount or restriction.
- Fundraisers without sales rights get 403 on quotations and sales opportunities.
- Amounts are classified `BUSINESS`. Whether individual donors' amounts need narrower visibility is part of D-05 (donor privacy) and D-07 (roles).

## 5. API (`/ws/ioeti/fundraising`)

| Endpoint | Notes |
|---|---|
| `GET /overview` | totals per currency, stage counts, installments needing attention (overdue or due within 30 days) |
| `GET /collections?status=` | installments with their collection status |
| `GET /campaigns` | native campaigns the caller may read |
| `GET/POST /donors`, `GET /donors/{id}` | `{partnerId, donorType, anonymous?}`; same account twice → 409 `ALREADY_DONOR`; the record includes totals |
| `PUT /donors/{id}/sensitive` | write-only `{version, givingCapacity?, contactPreference?, relationshipNote?}` |
| `GET /donors/{id}/sensitive` | **422 `BLOCKED_BY_POLICY` (D-05, D-07)** |
| `GET /donors/{id}/timeline`, `POST /donors/{id}/stewardship` | `{version, kind, occurredOn, subject}` |
| `GET/POST /opportunities`, `GET /opportunities/{id}` | filters `stage`, `donorId`, `campaignId`, `q`; `{reference, donorId, title, purpose?, kind, proposedAmount?, currencyCode, deadline?, campaignId?}` |
| `POST /opportunities/{id}/stage` | `PROPOSAL`, `SUBMITTED`, `DECLINED`, `WITHDRAWN`; otherwise 422 `STAGE_TRANSITION` |
| `POST /opportunities/{id}/approve` | `{version, committedAmount, approvedOn, periodEnd?, restricted, restrictionPurpose?, agreementReference?}`; only when `SUBMITTED`; twice → 409 `ALREADY_COMMITTED` |
| `POST /opportunities/{id}/archive`, `/renewal` | archive without a commitment (else 422 `HAS_COMMITMENT`); renewal only of an approved one |
| `GET /commitments/{id}`, `GET/POST /commitments/{id}/installments` | over the commitment → 422 `SCHEDULE_EXCEEDS_COMMITMENT` |
| `POST /installments/{id}/cancel` | with collections → 422 `HAS_COLLECTIONS` |
| `GET/POST /installments/{id}/collections` | `{version, amount, receivedOn, bankReference}`; duplicate reference → 409 `DUPLICATE_COLLECTION`; more than due → 422 `OVER_COLLECTION` |
| `POST /collections/{id}/void` | `{version, reason}` (`DUPLICATE_ENTRY`, `WRONG_AMOUNT`, `PAYMENT_RETURNED`) |
| `POST /collections/{id}/receipt` | **422 `BLOCKED_BY_POLICY` (D-05)** |
| `POST /collections/{id}/post`, `/installments/{id}/invoice` | **422 `BLOCKED_BY_POLICY` (D-06)** |
| `POST /commitments/{id}/allocate` | **422 `BLOCKED_BY_POLICY` (D-05, D-06)** |
| `GET/POST /commitments/{id}/deliverables`, `POST /deliverables/{id}/status` | `SUBMITTED`, then `ACCEPTED` |

## 6. UI (`#/fundraising`)

- **Overview**:
  - money per currency in separate cells, with the note that a pledge is not collected money;
  - opportunities per stage;
  - installments needing attention.
  - With no data it says so; no figure is invented.
- **Donors** register, and **Donor 360**:
  - money, the donor's opportunities and a new-opportunity form;
  - the sensitive section, which records but never shows;
  - stewardship and timeline.
- **Grants and pledges**: a board by stage, with search and campaign filter.
- **Grant record**:
  - stage actions;
  - approval form, with a restricted purpose required when restricted;
  - the commitment's figures kept apart;
  - the payment schedule, where each installment expands to its collections (record, void);
  - deliverables and renewal;
  - disabled receipt, posting, invoice and allocation buttons, each stating the decision it waits for.
- **Collection status**, filtered by status.
- Amounts use Latin digits and the ISO currency code in both languages, like the other real-mode money fields.

## 7. Not done

| Item | Why |
|---|---|
| Donation receipts and their numbering; tax treatment of gifts | D-05 (and D-06 for tax) |
| Restricted-fund allocation and accounting; posting collections; invoicing sponsors | D-05, D-06 |
| Donor privacy rules beyond anonymity (who sees individual donors' amounts, retention) | D-05, D-07 |
| Approval chain for accepting a grant with conditions | D-05 |
| Bank feed reconciliation | D-06 and D-10 (external integration) |
| Public donation pages and online payment | D-10 |
