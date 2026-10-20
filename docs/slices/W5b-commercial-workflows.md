# Wave 5b: commercial workflows and Account 360 (`ioeti-workspace`, quotation versions)

Status: LIVE_INTEGRATION_PASS on Axelor 9.1.10 + PostgreSQL 16 (`scripts/workspace_probe.py`, also in backend CI), with mocked browser contracts for the UI. Roles are fixtures; production roles are D-07.

These are the policy-independent parts of the brief's §6.2. Everything that approves, signs, invoices or posts stays fail-closed: approval and rejection (**D-11**), invoice issue and tax (**D-06**).

## 1. Quotation versions (native)

AOS already versions quotations. `SaleOrderVersionService.createNewVersion` copies the current lines as archived lines of version *n* and continues on *n+1*; `recoverVersion` brings a saved version back and saves the current lines first. The API exposes this rather than inventing a parallel model:

| Endpoint | Notes |
|---|---|
| `GET /ws/ioeti/quotes/{id}/versions` | saved versions: number, saved at, number of lines, total before tax |
| `POST /ws/ioeti/quotes/{id}/versions` | `{version}`; draft quotation with at least one line (422 `NO_LINES`) |
| `POST /ws/ioeti/quotes/{id}/versions/{n}/restore` | `{version}`; unknown version → 422 `VERSION_UNKNOWN` |

The quotation view has `versionNumber`. A stale quotation version is answered with 409.

## 2. Review requests (quotations and contracts)

`ReviewRequest` asks for a review of a **draft** quotation (the review records which quotation version it covers) or a **draft** contract. There is one pending request per record (409 `REVIEW_PENDING`). A reviewer may send it back with a reason (`PRICING`, `SCOPE`, `TERMS`, `DOCUMENTS`, `OTHER`); the requester may withdraw it. Each step is appended to `ReviewEvent` with its actor; this serves as both the quotation and the contract review history.

**Approve and reject return `422 BLOCKED_BY_POLICY` (D-11).** Who approves which value or discount is the owners' decision, so nothing here can mark a quotation or contract approved.

## 3. Invoice requests

An `InvoiceRequest` tells finance that one payment milestone of a **confirmed order** should be invoiced. It copies the milestone amount before tax.
- One open request per milestone (409 `INVOICE_REQUEST_EXISTS`, also under concurrency: the milestone row is locked).
- A request can be cancelled and asked again.
- **Issuing the invoice is `422 BLOCKED_BY_POLICY` (D-06).** No tax rate is assumed, and no payment is marked received.

Confirming an order is itself blocked (finalize is D-06/D-11), so in production no invoice request is possible yet. The probe confirms an order with SQL in the disposable database as a stand-in (test fixture only).

## 4. Renewals

`POST /ws/ioeti/workspace/contracts/{id}/renewal` opens one native `Opportunity` for an **active or closed** contract through the native opportunity service. The new opportunity copies the account and business line and is linked by `Opportunity.ioetiRenewalOf` (an extension; unique, so a second renewal → 409 `RENEWAL_EXISTS`). A draft contract → 422 `CONTRACT_NOT_ACTIVE`.

## 5. Account 360 summary

`GET /ws/ioeti/workspace/account360/{id}` (customer or prospect accounts only; others 404).

**Sections** count only records the caller may read: opportunities, quotations, contracts, handovers, engagements, certification cycles, training enrolments, job orders and the donor profile. A domain the caller has no read right on is **left out**, not shown as zero, so a salesperson never learns that an account is a donor.

**Money** per currency is kept in separate stages that are never added together:

| Stage | Source |
|---|---|
| draft quoted | draft quotations, before tax |
| booked | lines of active contracts, before tax |
| invoice requested | open invoice requests |
| invoiced | native ventilated customer invoices, before tax |
| collected | amount paid on those invoices |

A stage the caller may not read is `null` ("—" in the UI), never 0.

## 6. UI

- **Quotation:** versions (save, restore), review (request, withdraw, history), and disabled approve/reject buttons with the D-11 note.
- **Milestones of a confirmed order:** request an invoice per milestone, cancel, and a disabled "issue invoice" with the D-06 note.
- **Contract:** review requests and history; renewal for active or closed contracts, with a link to the new opportunity.
- **Account 360:** summary cards linking to each area, and the money table.

## 7. Not done

| Item | Why |
|---|---|
| Approving or rejecting quotations and contracts; sending to the customer | D-11 |
| Issuing invoices, tax, e-invoicing, payment posting and reconciliation | D-06 |
| Document templates and revisions (bilingual, PDF) | Wave 7 (documents) |
| Separation of duties between requester and reviewer | D-07 |
