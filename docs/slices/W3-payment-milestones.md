# Wave 3 (part 2a): payment milestones, with booked, invoiced and collected kept apart

Status: LIVE_INTEGRATION_PASS and NEGATIVE_SECURITY_PASS on Axelor 9.1.10 + PostgreSQL 16 (`scripts/quote_probe.py`, section 6, also in backend CI).

Invoicing a milestone is **policy-blocked, fail-closed** (D-06). Roles and master data are test fixtures.

## 1. What the slice does

The native model is the AOS supplychain `Timetable` on `SaleOrder`: title, percentage, amount, estimated date, `invoiced` and `invoice`. The `ioeti-commercial` module now also depends on the upstream `axelor-supplychain`.

| Endpoint | What it does |
|---|---|
| `GET /ws/ioeti/quotes/{id}/milestones` | The plan, plus separate figures for booked, invoiced and collected |
| `POST /ws/ioeti/quotes/{id}/milestones` `{version, title, percentage, dueDate}` | Adds a milestone to a draft quotation |
| `DELETE /ws/ioeti/quotes/{id}/milestones/{milestoneId}?version=` | Removes a milestone that has not been invoiced |
| `POST /ws/ioeti/quotes/{id}/milestones/{milestoneId}/invoice` | **422 `BLOCKED_BY_POLICY` (D-06)** |

**Booked, invoiced and collected are never mixed:**

| Figure | Meaning |
|---|---|
| `bookedBeforeTax` | The order total, but only once the quotation is a confirmed or completed order (`bookingStatus`). It is zero for every draft. |
| `invoiced` | Total of validated (ventilated) invoices issued for milestones |
| `collected` | What has been paid on those invoices (invoice total minus the remaining amount) |

Each milestone has a state: `PLANNED`, `INVOICED`, `PARTIALLY_COLLECTED` or `COLLECTED`.

**Invariants:**
- **Native amount.** The amount comes from the native `TimetableService.computeAmount`: percentage × total before tax, and the last milestone takes the rounding remainder when the plan reaches 100 %.
- **Never above 100 %, also under concurrency.** The quotation row is locked with `PESSIMISTIC_FORCE_INCREMENT`, so concurrent changes run one after the other and the second fails its version check (409). The quotation version also moves on every milestone change, so a stale client gets 409.
- **Amounts follow the lines.** The native form recalculates milestone amounts on line change; the line generator does not. The add-line command therefore now calls the native `updateTimetableAmounts` and `updateAmountToBeSpreadOverTheTimetable` in the same transaction.
- **Changes only in draft.** Milestones change only while the quotation is a draft. A milestone of another quotation answers like a missing one.

**UI.** The quotations section shows the payment plan:
- four figures: planned, booked, invoiced, collected;
- a table with states, plus add and remove;
- the D-06 invoicing notice;
- amounts in Latin digits, as on the quotation lines.

## 2. Evidence

`scripts/quote_probe.py` grows from 24 to **35/35**. The 11 milestone checks:
1. Add 30 %: 201, amount = 30 % of the total, state `PLANNED`.
2. Booked, invoiced and collected are all zero for a draft, with `NOT_BOOKED`, and invoicing shows `BLOCKED_BY_POLICY`.
3. Going above 100 % gives 422 `TOTAL_EXCEEDED`, and nothing is added.
4. Percentage 0, 33.333 or 100.01, a malformed date, or a 2-character title gives 422, and nothing is added.
5. A stale version gives 409, and nothing is added.
6. Another rep gets 404 on list and add.
7. **Two sessions add 40 % at the same time**: one 201 and one 409, and the total stays at 70 %.
8. Adding a line recalculates every milestone amount.
9. Invoicing gives 422 `BLOCKED_BY_POLICY`, and no invoice exists.
10. Remove: stale gives 409, another rep 404, an unknown milestone 404; nothing is removed.
11. The owner removes an uninvoiced milestone.

JUnit `MilestoneRulesTest` (3 tests): percentage, date and title rules.

Mocked UI test: the add sends the quotation version; the four figures show "not booked"; going above 100 % is localized, with no correlation id shown; the D-06 notice is visible.

## 3. Not done here

| Item | Why / where |
|---|---|
| Issuing invoices from milestones, taxes, e-invoicing | D-06 |
| Confirming a quotation into an order (makes it "booked") | D-11 approval matrix, plus D-06 |
| Collections and payment reconciliation views | the read side exists (`collected`); invoices cannot exist until D-06 |
| Contract (native `axelor-contract`) and operations handover | next Wave 3 slice |
| Milestone templates (native `TimetableTemplate`) | small follow-up; terms are business data |
