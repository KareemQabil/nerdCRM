# A9: finance's invoicing queue (within D-06)

Status: implemented and checked against the real backend:
- `scripts/finance_probe.py` 7/7 (in backend CI);
- the full local regression;
- mocked browser tests `tests/finance.spec.ts` 2/2;
- a real-browser look in light at desktop and dark at 390 px with the showcase data. It led to two fixes: padded panels, and a quieter style for the held "issue" action.

On the capability map, invoices and collection were partly live. Salespeople could ask finance to invoice a milestone of a confirmed order (Wave 5), but finance had no place to see those requests.

## What D-06 allows, and what stays held

The decision register lists:
- **Allowed while D-06 is open:** payment milestones, invoice *requests*, and the booked / invoiced / collected reporting vocabulary.
- **Held:** issuing invoices, computing tax, tax amounts on quotations, e-invoice submission, and finalizing quotations.

This slice builds only the allowed part:
- **Issuing** still answers `422 BLOCKED_BY_POLICY` (D-06), and no invoice is created.
- **Payments:** nothing marks a payment as received.
- **Collected** is read from what finance records in the accounting module, if finance uses it.

## What people can do

| Action | API (`/ws/ioeti/finance`) |
|---|---|
| The queue of invoice requests: open (default), cancelled or all, oldest first | `GET /queue?state=` |
| Milestones of confirmed orders coming due within 7–366 days (or overdue) that are neither invoiced nor requested | `GET /milestones?within=` |
| Booked, requested, invoiced and collected per currency | `GET /summary` |

These existing endpoints are used from the finance page:
- **Request invoicing** for a milestone: `POST /ws/ioeti/workspace/invoice-requests` (with the order's version).
- **Cancel** a request: `POST /ws/ioeti/workspace/invoice-requests/{id}/cancel`.
- **Issue:** `POST /ws/ioeti/workspace/invoice-requests/{id}/issue` answers `BLOCKED_BY_POLICY`.

## Rules

- **Access.** Native permissions decide on every call:
  - anonymous 401;
  - the queue needs read access to invoice requests, and the milestones need read access to orders (403 otherwise);
  - each row is within the caller's read scope, and a client name is shown only to those who may read the client;
  - cancelling needs write access to that request: a finance person with read-only rights cannot cancel a salesperson's request (403).
- **Figures come from real records only.**
  - **Booked:** confirmed orders before tax.
  - **Requested:** open invoice requests before tax.
  - **Invoiced and collected:** validated customer invoices and what was paid on them, as recorded in accounting.
  - A stage the caller may not read is shown as "not in your access", never as zero.
  - Currencies are kept apart, and nothing is converted.
- **Milestones coming due** are those of confirmed orders that are not invoiced and have no open request. Overdue ones are flagged with the days late. A request moves a milestone into the queue, and a cancel puts it back.
- **Nothing is sent outside.** Sending an invoice or a reminder to a client is D-10 as well as D-06.

## Screens

- **Invoices & collection** (`#/finance`, under Delivery):
  - **The held-policy note:** D-06 stated plainly.
  - **The figures per currency.**
  - **The queue:**
    - Filter by open, cancelled or all.
    - Each request shows its order, client, due date (overdue in red), amount before tax, who asked and how long ago.
    - "Issue invoice" explains D-06 and creates nothing; cancel is available to the requester.
  - **Milestones coming due:** within 7, 30 or 90 days, with "request invoicing".
- **System map:** invoices and collection stay partly live; D-06 holds issuing, taxes, e-invoicing and recording collections.

## After D-06

D-06 has to say where invoices are issued: Axelor invoicing only, Axelor accounting, or an external system. Then the "issue" action and the collection records are built on that choice. Until then the queue shows what is waiting.
