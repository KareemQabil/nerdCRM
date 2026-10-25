# P2b: finance issues invoices in Axelor accounting (D-06)

Status: implemented and checked against the real backend:
- `scripts/invoicing_probe.py` 7/7 (backend CI). It enters a complete, test-only accounting set-up and issues a real, ventilated invoice;
- `finance_probe.py`, `workspace_probe.py` and `scenario_iso_lifecycle_probe.py` updated for the signed decision;
- mocked browser tests in `tests/finance.spec.ts`, with no horizontal overflow at 390 px.

D-06 (signed 2026-10-25) chose **full Axelor accounting**. P2a put the owners' tax and exchange rates on quotations and figures. With P2b, finance issues the invoice for a requested milestone in the ledger. Payments and credit notes follow in P2c.

## What happens when finance issues an invoice

`POST /ws/ioeti/workspace/invoice-requests/{id}/issue` `{version}`:

1. **Who.** Native rights to create and change invoices (finance's role), on a request the person may read. Salespeople ask for invoicing; they cannot issue (403).
2. **The owners' rules.**
   - The order must carry the tax computed from `finance.tax` (P2a). Otherwise the answer is `POLICY_NOT_SET`.
   - The **payment terms** (`finance.payment-terms`, days per business line or a default) must be set. Otherwise the answer is `POLICY_NOT_SET`.
3. **The company's accounting set-up.** It is checked with the same native services the ventilation uses. Nothing is invented: the chart of accounts, journals, numbering and fiscal periods are finance's set-up in Axelor. Until it is complete the answer is `422 ACCOUNTING_NOT_READY`, with each missing item:

| Code | What finance (or the accountant) sets in Axelor |
|---|---|
| `ACCOUNT_CONFIG` | the company's accounting configuration |
| `CUSTOMER_ACCOUNT` | the customers (receivable) account |
| `SALES_JOURNAL`, `JOURNAL_SEQUENCE` | the sales journal and its numbering |
| `INVOICE_SEQUENCE` | invoice numbering |
| `INVOICE_PRINT_TEMPLATE` | the invoice print template, when the invoicing app prints on ventilation |
| `OPEN_PERIOD` | an open fiscal period for today |
| `SUPPLYCHAIN_CONFIG` | the company's supply-chain configuration (invoicing from orders) |
| `PAYMENT_MODE` | how the client pays, on the order |
| `CLIENT_ADDRESS` | the client's invoicing address, on the order |
| `PRODUCT_SALE_ACCOUNT` | a revenue account for each service sold |
| `SALE_ACCOUNT_TAX`, `SALE_ACCOUNT_VAT_SYSTEM` | the revenue account takes tax, with its VAT system |
| `TAX_ACCOUNT` | the collected-tax account for the owners' tax (`IOETI-…`) |
| `JOURNAL_ACCOUNT` | the sales journal allows each account it posts to |
| `ACCOUNT_INACTIVE` | the accounts are active |

`GET /ws/ioeti/finance/requests/{id}/readiness` lists the same items, plus `TAX_POLICY` and `PAYMENT_TERMS_POLICY`, for those who may issue.

4. **Issuing.** With everything in place, the native services do the work:
   - the invoice is created from the order's payment milestone (`TimetableService.generateInvoice`);
   - it gets a **native payment condition built from the payment-terms policy version** (`IOETI-PT-<version>`: net N days);
   - it is **validated and ventilated** (`InvoiceService.validateAndVentilate`), which numbers it and posts the journal entry.

   The request becomes `ISSUED` and records the invoice, who issued it, when, and the payment-terms version used.

Nothing marks a payment as received; that is P2c. ETA e-invoicing is not in V1 (D-06).

## Screens

On the finance page:
- the issue action is shown only to those with native invoice rights;
- if something is missing, the page lists exactly what (in Arabic or English), and nothing is created;
- an issued request shows its invoice number, total including tax and due date under "Invoiced";
- global notices name the new refusals (`POLICY_NOT_SET`, `ACCOUNTING_NOT_READY`) instead of "check the fields".

## Checked live (`scripts/invoicing_probe.py`)

1. A salesperson without native invoice rights cannot issue (403), and nothing is created.
2. Without the owners' payment terms, issuing is refused (`POLICY_NOT_SET`) and the readiness view says so.
3. With an incomplete set-up, issuing is refused (`ACCOUNTING_NOT_READY`) naming every missing item, and nothing is created.
4. A taxed revenue account needs its VAT system; the journal must allow every account it posts to, and they must be active. Once the set-up is complete, the readiness view says the invoice can be issued.
5. The invoice is created, validated and ventilated natively:
   - the milestone's amount;
   - the owners' 14% tax;
   - due in 30 days through the policy's payment condition;
   - numbered from the company's sequence;
   - with a journal entry.
6. The request is `ISSUED` with the invoice number and leaves the open queue, and the milestone is invoiced.
7. Issuing again is refused. The figures count the invoice including tax, and nothing as collected.

The probe's accounting set-up is a test fixture standing in for finance's own. Ventilated invoices and their journal entries are removed with SQL afterwards, in disposable databases only (`probe_fixtures.purge_company_accounting`).

## Not in P2b

- Recording collections (payments) and credit notes: P2c.
- The Arabic invoice print layout: the print template is reported as missing until finance chooses one.
