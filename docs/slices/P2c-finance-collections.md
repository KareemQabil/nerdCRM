# P2c: recording collections and credit notes (D-06)

Status: implemented and checked against the real backend.
- `scripts/invoicing_probe.py` passes 12/12 (five checks are new). It runs in backend CI.
- Mocked browser tests in `tests/finance.spec.ts` pass, with no horizontal overflow at 390 px.

P2b issued invoices in Axelor accounting. P2c lets finance record what the client actually paid, and issue credit notes. Both go through the native services, so they are posted and reconciled in the ledger.

**Nothing is ever marked as received unless finance records it, with its reference.** This is the D-06 rule "a payment is not received until finance records it".

## Recording a payment

`POST /ws/ioeti/finance/invoices/{id}/payments` takes `{version, amount, paymentDate, reference}`.

- **Who:** someone with native rights to create invoice payments and to change invoices.
- **Checks:**
  - The invoice must be an issued customer invoice.
  - The amount must be above 0 and at most what is still due.
  - The payment date must fall between the invoice date and today.
  - The bank or receipt reference is required.
  - A fully paid invoice answers `ALREADY_PAID`.
- **Set-up (`ACCOUNTING_NOT_READY` until complete):**
  - The payment mode's bank journal (with numbering) and bank account.
  - An open period.
  - The reconciliation sequences: reconcile, plus the draft and final reconcile groups.
  - The journal allows the accounts, and the accounts are active.
- **Native:** the payment is created as the native form does it (the amount finance typed is spread over the unpaid invoice terms), then validated. That posts the payment journal entry, reconciles it with the invoice, and updates the amounts paid and remaining.

## Issuing a credit note

`POST /ws/ioeti/finance/invoices/{id}/credit-notes` takes `{version, percent, reason}`.

- **Who:** someone with native rights to create and change invoices.
- **Checks:**
  - The share must be above 0 and at most 100%.
  - The reason is required.
  - All credit notes together cannot exceed the invoice.
- **Set-up:**
  - The credit-note journal (with numbering) and credit-note numbering.
  - The refund payment mode (the client's, or the company's outgoing one).
  - An open period and the reconciliation sequences.
  - The journal allows the accounts, and the accounts are active.
- **Native:** the refund is generated from the invoice. For a share, each line is scaled and the invoice terms are computed again. It is then validated and ventilated, which numbers it and offsets it against the invoice. The reason is kept on the credit note.
- **Note:** the native reconciliation reads the invoice's payment list. That list is only initialised when the invoice is opened in the native form, so the service initialises it first.

The training refunds (D-03) and donation receipts (D-05) build on this slice.

## Screens

The finance page gains **Issued invoices & collection**.

- **Filters:** with money due, paid, or all.
- **Each invoice shows:** total, paid, remaining, overdue flag and status, plus its payments (amount, date, reference, who recorded it) and its credit notes.
- **Record a payment:** the amount defaults to what is still due; the date and the reference are required.
- **Credit note:** share and reason.
- When the set-up is missing, finance is told exactly what is missing, and nothing is recorded.
- The panel is hidden from people without native read rights on invoices.

## Checked live (new checks)

8. Recording a payment:
   - A payment needs native payment rights (403 for the salesperson).
   - The amount, reference and date are checked.
   - Without the payment mode's journal and account, or the reconciliation sequences, it is refused and names them.
   - Nothing is recorded.
9. With the bank set-up, a partial payment of 1000 is recorded natively and the invoice becomes partly paid:
   - the payment is validated, with a journal entry;
   - it carries its reference.
10. Paying the rest:
    - The invoice becomes paid.
    - Another payment is refused (`ALREADY_PAID`).
    - "Collected" grows by exactly the two payments.
11. Issuing a credit note:
    - A credit note needs native invoice rights (403 for the salesperson).
    - The share and reason are checked.
    - Without the credit-note journal, numbering and refund payment mode, it is refused and names them.
12. With the credit-note set-up, a 50% credit note is issued natively, numbered from the credit-note sequence, with half the invoice before tax and its reason. Crediting beyond the invoice is refused.

All the accounting records are removed afterwards with SQL, in disposable databases only (`probe_fixtures.purge_company_accounting`, extended to payments and reconciliations).
