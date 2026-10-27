# M1: donation receipts and restricted funds (D-05)

Status: built. Checked locally with unit tests (8/8) and mocked browser tests (`tests/fundraising.spec.ts` 6/6; the
fundraising tests in `tests/app.spec.ts` 5/5). `scripts/fundraising_probe.py` has new live checks that have **not yet run
against a server with this code**. Migration `V030__ioeti_fundraising_receipts.sql` was applied, re-applied and rolled back
on a scratch copy of the dev schema. `db_migrate.py verify` still has to run once Hibernate has created the new objects.

## What D-05 says (signed 2026-10-25)

- Finance issues donation receipts, and only after the money is recorded as collected.
- Restricted funds are posted to separate analytic accounts, one per restriction, in accounting.

## Receipts

| Rule | How |
|---|---|
| Finance only | Issuing needs native create rights on `DonationReceipt` (the finance role's), plus read access to the collection. A fundraiser without them gets 403 and sees no issue button. |
| Collected money only | A receipt belongs to one `DonationCollection` and never to a pledge or an installment. A voided collection gets none (422 `COLLECTION_VOIDED`). |
| One per collection | Only one receipt is in force per collection; a second one answers 409 `RECEIPT_EXISTS`. Concurrent issuers are serialized by a transaction lock on the collection id. A collection with a receipt in force cannot be voided (422 `RECEIPT_ISSUED`): finance voids the receipt first. |
| Unique number | `DR-<year>-<6 digits>`, numbered per year of issue under a transaction lock, unique in the database, never reused. |
| Content | The collection's amount and currency, the donor's name (the account name, copied), the day the money was received, the issue date and who issued it, and the restricted purpose when there is one. |
| Void and reissue | `POST /receipts/{id}/void {version, reason}`. Reasons: WRONG_DONOR_DETAILS, WRONG_AMOUNT, COLLECTION_CORRECTED, DUPLICATE. A stale version → 409; twice → 422 `RECEIPT_VOIDED`. The voided receipt keeps its number. Issuing again creates a new number that records which receipt it replaces. |
| Printable | `#/fundraising/receipts/{id}` is a receipt sheet with a print button. A print stylesheet prints the sheet only. |

**Engineering choice: anonymous donors.** An anonymous donor stays unnamed in fundraising lists. Their receipt is still
addressed to them: it carries the account name, and only people with read rights on receipts (finance) see it. Owners may
revisit this under D-05 donor privacy.

## Restricted funds: what is posted and what is only recorded

**How collections reach accounting today: they do not.** `POST /collections/{id}/post` still answers 422
`BLOCKED_BY_POLICY`. No journal entry is written for a donation, so no analytic move line exists either. What this slice
does is the following:

1. **Mapping (finance).** A `FundRestriction` maps a donor restriction (a code and a name) to one **native Axelor
   `AnalyticAccount`**, which must be readable and active. Changing the account affects later allocations only.
2. **Allocation (finance, once).** `POST /commitments/{id}/allocate {version, restrictionId}` links a restricted commitment
   to its restriction. Refusals: unrestricted 422 `NOT_RESTRICTED`, twice 409 `ALREADY_ALLOCATED`, stale 409, without write
   rights on restrictions 403.
3. **Recorded on each collection.** Every recorded collection of that commitment, and every later one, stores the
   restriction and its analytic account at that moment. Voided collections are not allocated.
4. **Balance report.** `GET /restricted-funds` gives, per restriction and currency: the analytic account, the committed
   amount and the collected amount (voided collections excluded). Restricted funding not yet allocated is shown apart.
   Spending from a restriction is not tracked here.

When the posting of collections is built (an accounting move per collection), it reads `analyticAccount` from the
collection to create the analytic distribution. Until then the analytic allocation is **recorded, not posted**.

## API (`/ws/ioeti/fundraising`)

| Endpoint | Notes |
|---|---|
| `POST /collections/{id}/receipt` | **was BLOCKED_BY_POLICY**; 201 with the receipt |
| `GET /receipts?status=&collectionId=`, `GET /receipts/{id}`, `POST /receipts/{id}/void` | new |
| `POST /commitments/{id}/allocate` | **was BLOCKED_BY_POLICY**; `{version, restrictionId}` |
| `GET/POST /fund-restrictions`, `POST /fund-restrictions/{id}` | new: map, rename, remap or deactivate |
| `GET /analytic-accounts?q=` | new: the active native analytic accounts the caller may read |
| `GET /restricted-funds` | new: the balance report |
| `POST /collections/{id}/post`, `POST /installments/{id}/invoice` | unchanged: 422 `BLOCKED_BY_POLICY` (D-06 side not built) |

`CommitmentView` lost `receiptStatus` and gained:
- the allocation status, restriction and analytic account;
- `canAllocate` and `canIssueReceipts`.

`CollectionView` gained:
- the receipt status, id and number (the number only for those who may read receipts);
- the voided-receipt count and `canIssueReceipt`;
- the allocation status and analytic account.

All new records are classified in `docs/security/pii-classification.json`.

## Model (migration V030 / U030)

- `ioeti_fund_receipt` (`DonationReceipt`, unique number, `replaces` link).
- `ioeti_fund_restriction` (`FundRestriction` → `account_analytic_account`).
- `ioeti_fund_commitment` gains `fund_restriction`, `allocated_at` and `allocated_by`.
- `ioeti_fund_collection` gains `fund_restriction`, `analytic_account` and `allocated_at`.
- The module now depends on `axelor-account`.

## UI (`#/fundraising`)

- **Grant record**:
  - the commitment shows the restriction and its analytic account, or "waiting for finance to allocate";
  - finance gets the allocation form;
  - each collection shows its receipt chip (linking to the receipt sheet), "issue donation receipt" for finance, voided
    receipts and the analytic account;
  - invoicing and posting stay disabled with a plain note.
- **Restricted funds tab**:
  - the balance per restriction and currency, with the unallocated part apart;
  - the mapping list (remap, deactivate) and a "new restriction" form, shown only when the caller may read analytic
    accounts.
- **Receipt sheet**: print, void with a reason, and reissue.

## Tests

- `ReceiptRulesTest`: number format, per-year sequence, no reuse across years, and when a receipt may be issued. Plus a
  reasons/codes test in `FundraisingRulesTest`.
- `tests/fundraising.spec.ts`:
  - allocate, then issue, void and reissue (a new number naming the old one);
  - a fundraiser without finance rights;
  - a duplicate receipt refused;
  - the balance report and the mapping form;
  - the mapping hidden without analytic access;
  - phone width and an axe scan.
- `scripts/fundraising_probe.py`, new checks:
  - receipts: 403 for a fundraiser, 422 on a voided collection, 201 with number, amount, donor and date, and 409 on a
    duplicate;
  - the receipt is visible on the collection (number for finance only), the collection cannot be voided while the receipt
    is in force, and receipts are 403 for others;
  - void: stale 409, bad reason 422, fundraiser 403, then voided, then 422 on a second void, and the reissue gets a new
    number;
  - mapping: 403, inactive 422, code 422, 201, duplicate 422, and only active accounts listed;
  - allocation: 403, unrestricted 422, stale 409, 200, and 409 on a second allocation; recorded and later collections carry
    the account, voided ones do not;
  - the report: committed 400000 and collected 170000; 403 for a fundraiser.

## Still open

- **Posting to the ledger**: posting donations as accounting moves with their analytic distribution, and invoicing
  sponsors.
- **Role templates** (`RoleAdmin.TYPES`) do not yet list `DonationReceipt` and `FundRestriction`, so finance's production
  role cannot be granted them from the admin console.
- **Donor privacy and the approval chain** (D-05/D-07): who sees individual donors' amounts, and the anonymous-receipt
  choice above.
- **Tax treatment of gifts** on receipts (D-06).
