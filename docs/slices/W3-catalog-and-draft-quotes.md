# Wave 3 (part 1): catalog and draft quotations from opportunities

Status: LIVE_INTEGRATION_PASS and NEGATIVE_SECURITY_PASS on Axelor 9.1.10 + PostgreSQL 16 (`scripts/quote_probe.py`, also in backend CI).

Two parts are **policy-blocked, fail-closed**:
- tax amounts (D-06);
- finalizing or sending a quotation (D-06, D-11).

Every master-data record in tests is a fictional fixture, and every role is a fixture (D-07).

## 1. What the slice does

New module `modules/ioeti-commercial`. It depends only on `ioeti-core` and the upstream `axelor-sale`, as AGENTS.md requires.

| Endpoint | What it does |
|---|---|
| `GET /ws/ioeti/catalog/products?q=` | Sellable, non-template `Product` records the caller may read. Returns `{id, code, name, unit, salePrice, currency}`: no cost price, supplier or stock data. Search is at most 80 characters. |
| `GET /ws/ioeti/quotes?opportunityId=` | Quotations of an opportunity the caller may read, in the caller's `SaleOrder` scope |
| `GET /ws/ioeti/quotes/{id}` | One quotation (`RecordAccess`: hidden = missing) |
| `POST /ws/ioeti/quotes` `{opportunityId, opportunityVersion}` | Draft quotation through the native `OpportunitySaleOrderService.createSaleOrderFromOpportunity` |
| `POST /ws/ioeti/quotes/{id}/lines` `{version, productId, quantity}` | Line through the native `SaleOrderLineGeneratorService.createSaleOrderLine` (the AOS mobile API path). It computes price × quantity and the order totals. |
| `POST /ws/ioeti/quotes/{id}/finalize` | **422 `BLOCKED_BY_POLICY`** (D-06, D-11) |

The quotation DTO shows `totalBeforeTax` and line amounts before tax, with `taxStatus: "BLOCKED_BY_POLICY"`. It has **no tax fields**.

UI: a *Quotations* section on the opportunity page (real mode only). It covers:
- creating a draft;
- adding catalog lines;
- totals before tax;
- the tax notice;
- a disabled "Approve & send" button that explains the policy block.

The fictional demo is unchanged.

## 2. Native first, and what AOS requires

The company of a new quotation follows the **native opportunity-form default**: the opportunity's company, else the user's active company, else the only company if exactly one exists. If none applies, the answer is 422 `SETUP_REQUIRED`.

With the apps IOETI installs (`contract` pulls in `supplychain`, `stock`, `account` and `invoice`), the native services need company configuration before any quotation exists. This was found live, from the AOS messages:

| Native requirement | AOS message (server log only) | IOETI answer |
|---|---|---|
| Stock configuration with a pickup location for the company | "You must configure a Stock module for the company …" | 422 `SETUP_REQUIRED` |
| Account configuration for the company | "You must configure account's information for the company …" | 422 `SETUP_REQUIRED` |
| A sales ledger account on the product (`AccountManagement.saleAccount`) | "Accounting configuration is missing for Product …", raised through a CDI observer (`ObserverBaseException`) | 422 `SETUP_REQUIRED` (previously an unhandled 500) |

How AOS refusals are handled:
- Each native refusal is **logged server-side with the correlation id** and never returned to the client.
- Configuration errors (`CATEGORY_CONFIGURATION_ERROR`) answer `SETUP_REQUIRED`. Other native rules answer `QUOTE_REJECTED`.

**For the owner.** Quoting in production needs IOETI's real company setup: legal entity, stock config, account config, and a sales ledger account per product or product family. That setup is part of D-06 and is **not** invented here. The probe builds a fictional, clearly labelled ("TEST ONLY") set and deletes it afterwards.

## 3. Evidence

`scripts/quote_probe.py`: **24/24**, with 10 concurrent rounds in CI and locally. Evidence is in `docs/evidence/wave3/`.

What the checks cover:
- **Catalog:**
  - sellable products only;
  - safe fields only;
  - an overlong search answers 422.
- **Create refusals**, each creating nothing:
  - no company resolvable (two companies exist and the user has no active company): 422 `SETUP_REQUIRED`;
  - opportunity without an account: 422 `ACCOUNT_REQUIRED`;
  - stale opportunity version: 409;
  - another rep's opportunity: 404, identical to a missing id;
  - read-only user: 403.
- **Create:**
  - 201 draft, in EGP, linked to the opportunity and account, with no tax fields;
  - persisted natively with salesperson = the rep, client = the account, the opportunity, company = the user's company, status draft;
  - the owner lists it; another rep gets 404 for the quotation and for the opportunity's list.
- **Lines:**
  - native computation 2 × 1,500.00 = 3,000.00 before tax;
  - stale version: 409;
  - unknown and non-sellable products get the identical 422;
  - quantity 0, 5 decimals, or above 100,000: 422;
  - product without accounting setup: 422 `SETUP_REQUIRED`, with no raw message;
  - another rep: 404;
  - refused commands add no line.
- **Concurrency:** two sessions add a line with the same version. Every round gets exactly one 201 and one 409 and adds exactly one line. The order total matches the lines afterwards.
- **Finalize:** 422 `BLOCKED_BY_POLICY` and the quotation stays a draft. Another rep gets 404.

UI, mocked:
- create a draft, add a catalog line, see the total before tax, the tax notice and the disabled finalize button;
- `ACCOUNT_REQUIRED` and `SETUP_REQUIRED` are localized, and no correlation id or raw text is shown.

JUnit (`QuoteRulesTest`, 3 tests):
- quantity rules;
- stable status values;
- native refusals mapped to safe codes, with other failures still propagating.

## 4. Not done here (tracked)

| Item | Why / where |
|---|---|
| Tax amounts, invoices, e-invoicing | D-06 |
| Finalize/send, approval workflow, discounts, validity, terms | D-11, and D-06 for the tax part |
| Removing or editing lines, discounts | next slice; uses native `SaleOrderLine` services |
| Contract, payment milestones, handover to delivery | Wave 3 part 2 (native `axelor-contract` and `axelor-project`); milestones may proceed under D-06's "proceeds without it" column |
| Account 360 quotations tab | next slice |
| Product catalog administration | native Axelor screens for maintenance users; IOETI's real catalog and prices are owner data |
