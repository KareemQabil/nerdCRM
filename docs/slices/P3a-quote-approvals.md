# P3a: quotation approval tiers, finalizing, validity and sending (D-11)

Status: implemented and checked against the real backend.
- `scripts/quote_approval_probe.py` runs in backend CI.
- Mocked browser tests in `tests/app.spec.ts` cover the approval box, line discounts, approving, rejecting and recording sending, with no horizontal overflow at 390 px.

D-11 (signed 2026-10-25) says a quotation's approval depends on its discount and value, per business line, and that a finalized quotation is valid for a period the owners set. **No tier, value or period is shipped**: the policy owners set them under Policies. Until they do, nothing is finalized (`422 POLICY_NOT_SET`).

## Policies used

| Policy | Scope | What it holds |
|---|---|---|
| `sales.quote-approval` | business line or default | Up to five tiers, smallest first. Each tier has: up to a discount %, optionally up to a value in the company currency, and who approves (`NONE`, `SALES_MANAGER`, `GM`). |
| `sales.quote-validity` | business line or default | How many days a finalized quotation stays valid. |
| `finance.tax` (P2a) | business line or default | The quotation must carry the tax in force, not an outdated one. |

## How the tier is chosen

- **Discount:** the quotation's overall discount against its lines' unit prices, `1 − Σ(qty × discounted price) / Σ(qty × price)`, from the native line discount.
- **Value:** the quotation's total before tax in the company currency (`companyExTaxTotal`).
- **Tier:** the first tier (smallest first) whose discount and optional value cap both cover the quotation.
- **Above every tier:** refused with `422 OUTSIDE_APPROVAL_TIERS`. The rep lowers the discount, or the owners add a tier.
- **Approvers are Axelor roles** given by the administrator: `SALES_MANAGER` → `ioeti-sales-manager`, `GM` → `ioeti-gm`. A role counts when held directly or through the person's group.
- **No hierarchy is assumed:** a general manager does not approve a sales-manager tier unless they also hold that role. The policy names exactly who approves.

## Line discounts

`POST /ws/ioeti/quotes/{id}/lines/{lineId}/discount` takes `{version, percent}`.

- **Who:** someone with native rights to change the quotation's lines. The quotation must be a draft.
- **Checks:** 0 to 100, with up to 2 decimals. The line must belong to the quotation.
- **Native:** the line's discount type becomes "percent", replacing a price-list discount. The line, the tax and the payment milestones are computed again with the native services.

## Finalizing

`POST /ws/ioeti/quotes/{id}/finalize` takes `{version}`.

- **Checks, in order:**
  - The quotation is a draft with lines.
  - The tax in force is applied (`POLICY_NOT_SET` if there is none, `TAX_OUTDATED` if it changed).
  - The validity policy is set.
  - The company has a quotation number sequence (`SALES_SEQUENCE_MISSING`).
  - The approval tier.
- **Tier `NONE`:** the rep finalizes. The native `SaleOrderFinalizeService.finalizeQuotation` numbers the quotation, and the end of validity is set from the validity policy.
- **Any other tier:** `422 APPROVAL_REQUIRED`. The rep asks for a review.
- **Recorded on the quotation:** the approval policy version, the tier, the discount it was judged on, who approved, when, the validity policy version and the end of validity (native `endOfValidityDate`).

## Approving and rejecting

The existing review request carries the approval.

- **Asking for a review** records the quotation's record version and the tier's approver. The holders of the tier's role get an in-app notice, `REVIEW_APPROVAL_NEEDED`.
- **`POST /workspace/reviews/{id}/approve`** takes `{version, rationale}`.
  - It needs native write access to the quotation.
  - The requester cannot approve (`403 OWN_REQUEST`).
  - The caller must hold the tier's role, computed again at decision time (`403 NOT_APPROVER`).
  - The quotation must be unchanged since the request (`409 QUOTE_CHANGED`).
  - It then runs the same checks and native finalize as above. The requester is told (`REVIEW_APPROVED`).
- **`POST /workspace/reviews/{id}/reject`** takes `{version, reason, rationale}`. It has the same authority rules, and the quotation stays a draft. The requester is told (`REVIEW_REJECTED`).
- **Sending back for changes** stays open to any reviewer, as before.
- **Contracts:** approving or rejecting a contract still answers `BLOCKED_BY_POLICY`. Contract activation on signature evidence is P3b.
- **The review view** gains `approver`, `canDecide`, `decidedAt` and `rationale`. The statuses are now `PENDING`, `CHANGES_REQUESTED`, `WITHDRAWN`, `APPROVED` and `REJECTED`. The screen shows approve and reject only when `canDecide`, and the server checks again.

## Recording sending

`POST /ws/ioeti/quotes/{id}/sent` takes `{version, via}`.

- **Allowed:** for a finalized quotation that has not expired (`QUOTE_NOT_FINALIZED`, `QUOTE_EXPIRED`), by someone with native write rights.
- **What it records:** who, when, and how it was sent (up to 300 characters).
- **Nothing is e-mailed** (D-10).

## Screens

The quotation card on the opportunity page gains:

- a discount column, and a "discount on a line" form for drafts;
- an "Approval and sending" box. For a draft it shows the tier its discount and value fall in today, or why none applies. Once finalized it shows who approved, when, the tier, the end of validity, an expiry warning, and the record of sending (or the form to record it);
- in the review box, the approver of a pending quotation review. A holder of the tier's role gets approve (with an optional rationale) and reject (with the chosen reason).
- The inbox names the three new notices.

## Data

Migration `V022` (rollback `U022`):

- `sale_sale_order` gains `ioeti_approval_policy`, `ioeti_approval_tier`, `ioeti_discount_percent`, `ioeti_approved_by`, `ioeti_approved_at`, `ioeti_validity_policy`, `ioeti_sent_by`, `ioeti_sent_at` and `ioeti_sent_note`.
- `ioeti_ws_review` gains `subject_record_version`, `approver_code`, `decided_at` and `decision_note`.

## Changed expectations

- `workspace_probe.py`, `scenario_iso_lifecycle_probe.py` and `quote_probe.py` expected `BLOCKED_BY_POLICY` for approving and finalizing quotations. They now expect `POLICY_NOT_SET` on a database without the owners' policies: the decision is signed, and it still fails closed until its values are set.
- `workspace_probe.py` also checks that approving a contract stays `BLOCKED_BY_POLICY`.

## Next (P3b)

- Client acceptance with evidence: the native order confirmation.
- Contract activation on signature evidence.
- The won rule per business line (`sales.won-evidence`).
