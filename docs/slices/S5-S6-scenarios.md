# S5–S6: complex scenarios on the real backend

Status: implemented and run against a real Axelor and PostgreSQL. Both scenarios are in backend CI.

The earlier scenarios (S1–S4, S7) were written before the owners' rules were decided, so they stop where a policy was
missing. These two run with the rules in force. They start the way a new company would: a policy owner applies the
recommended starting values (R1).

| Scenario | Script | Result |
|---|---|---|
| S5 quote to cash | `scripts/scenario_quote_to_cash_probe.py` | 10/10, cleanup complete |
| S6 busy day | `scripts/scenario_busy_day_probe.py` | 5/5 (3 race rounds), cleanup complete |

## S5: one client from the first enquiry to cash

Roles: a marketer, two salespeople in the line's team, a sales manager who manages the line, finance, and a policy owner.

1. **The owners' rules.** The policy owner applies the recommended values in one step:
   - tax 14% and payment terms of 30 days;
   - approval tiers 5/10/20 and quotation validity of 30 days;
   - won on an accepted quotation;
   - response targets and working hours;
   - routing to the line's responsible team.
2. **Routing.** Three enquiries are routed round robin inside the team (RepA, RepB, RepA). Each owner is told, and the
   response target is DUE.
3. **First contact and conversion.** RepA calls within the target (MET) and converts the lead into an account and an
   opportunity.
4. **Quotation and approval.**
   - 3 audit days at 10,000 with an 8% discount is 27,600. That falls in the sales manager's tier, so finalizing directly
     is refused.
   - RepA asks for the review; the manager is told and approves.
   - The quotation is finalized with VAT 14% (31,464) and is valid for 30 days.
5. **Acceptance and won.** The client's purchase order is filed and recorded as the acceptance, which confirms the order.
   The opportunity is won on it.
6. **Deposit.** The 30% deposit (8,280 + VAT = 9,439.20) is invoiced, due in 30 days. It is paid in two transfers, and a
   third payment is refused.
7. **Balance.** The 70% balance (19,320) is invoiced, then half of it is credited with a reason (9,660).
8. **Figures.**
   - Collected grows by exactly the money received.
   - Invoiced grows by both invoices less the credit note.
   - Nothing is sent outside the CRM.

### A real bug S5 found, and its fix

**What was wrong:** the finance summary counted a credit note as money collected. In Axelor, a credit note is recorded
against its invoice as a "payment" (a refund imputation), which raises the invoice's amount paid. The summary added up
amount paid, so after the 50% credit note above it showed 20,451.60 collected instead of 9,439.20.

**What changed:**
- Collected now counts only validated payments (a payment, or an advance payment applied).
- Invoiced is now net of the credit notes issued.

## S6: a busy morning

- **Routing rush.** Three marketers record 12 enquiries at the same moment. The team has four people; one is on leave;
  the workload cap is 3.
  - Three people get exactly 3 leads each. The person on leave gets none.
  - The 3 leads nobody can take stay unassigned. The line's manager is told once for each.
  - There is one routing log row per lead, and never a 500.
- **Approval race,** run 3 times. Two managers approve the same quotation at the same moment.
  - Exactly one approval goes through, and the quotation is finalized once with one number.
  - The other is refused, never with a 500.
- **Calendar race,** run 3 times.
  - Two tabs move the same planned item at once: one move, and the other gets `409`.
  - Done and cancel race: one wins.
- **Rules changed mid-flight.**
  - A new approval tier scheduled from tomorrow leaves today's decision alone and shows as the next value.
  - Unsetting the tax today means a new quotation line carries no tax (POLICY_NOT_SET). A finalized quotation keeps the
    tax it was issued with.

`PROBE_SCENARIO_ROUNDS` sets how many times the races repeat (default 3).

Regression after the fix: `invoicing_probe.py` 12/12, `finance_probe.py` 7/7.
