# P2a: tax on quotations and exchange rates from the owners' policies (D-06)

Status: implemented and checked against the real backend:
- `scripts/finance_policy_probe.py` 11/11 (backend CI; the public source is a local stub);
- `scripts/quote_probe.py` updated for the signed decision;
- mocked browser tests: `tests/finance.spec.ts` (two new tests, with no horizontal overflow at 390 px) and `tests/app.spec.ts` (tax on a quotation, applied again);
- migration `V020` verified (8/8 checks, rollback `U020`).

D-06, as signed on 2026-10-25:
- full Axelor accounting;
- tax rates are policy settings, not code;
- multi-currency, converted to EGP with rates from a public source and a manual override by finance;
- ETA e-invoicing is not in V1.

This slice covers the tax on quotations and the exchange rates. Issuing invoices in accounting, payments and credit notes come in P2b.

## Tax on quotations (`finance.tax`)

- The policy value is `{ratePercent, name, type: VAT | OTHER}`. It is set per business line or as the default (P1).
- After every change to a draft quotation (create, add a line, restore a version), the value in force today for the quotation's business line is applied to its lines with the **native AOS services**:
  - every applied policy version becomes one native tax version (`TaxLine`) with the same rate and dates;
  - each scope has one native `Tax`: `IOETI-<line>` or `IOETI-DEFAULT`;
  - the link is kept in `ioeti_policy_tax_line`.

  Native totals, tax lines and, later, invoices and journal entries therefore all use the policy's rate.
- The quotation records the policy version it was computed with (`SaleOrder.ioetiTaxPolicy`).
- **No policy → no tax.** The quotation shows `taxStatus: POLICY_NOT_SET` with no tax amounts, and finalizing stays blocked. Nothing is guessed.
- **A line's own value wins over the default.** If the owners retire that value, the line has no tax: there is no silent fall back to the default (P1 rule).
- **When the owners change the policy**, a draft shows `taxOutdated` and the rep applies the current tax (`POST /ws/ioeti/quotes/{id}/tax`). Finalized documents are not touched.

## Exchange rates (`finance.fx`)

- The policy value is `{source: PUBLIC_API | MANUAL_ONLY, currencies: "USD,EUR", maxAgeHours}`.
- **Public source:** `open.er-api.com` (free, no key, includes EGP).
  - The URL can be pointed elsewhere with `ioeti.fx.url` (`AXELOR_CONFIG_IOETI_FX_URL`). CI points it at the probe's stub.
  - Finance fetches on demand, and a native Quartz schedule (registered by `V020`, every 6 hours) fetches when the policy names the public source and the newest fetched rate is 12 hours old.
  - A source that does not answer records nothing (`502 FX_SOURCE_UNAVAILABLE`); finance enters the rate by hand.
- **Manual override:** finance enters a rate with a reason.
  - The currency must be listed in the policy, the rate must be above 0, and the date must be within the last year and not in the future.
  - On its date, a manual rate wins over a fetched one. The newest date in force wins overall.
- **Too old is not used:** a rate older than `maxAgeHours` is reported stale and nothing is converted with it (`FX_STALE`).
- **Rows are appended** (`ioeti_fx_rate`: source, provider, who, why, when). The rate in use is mirrored as native conversion lines, one per date with no overlap, so the native currency service (and later accounting) converts with exactly the same rate.
- **Who:** reading needs native read rights on conversion lines; fetching and entering need create and write rights. Without them the panel is not shown (403).

## Finance summary

Each currency's figures are also given in EGP at the rate in use, with the rate and its date, or with the reason they cannot be: no policy, no rate, or the rate is too old. The EGP total is shown only when every currency can be converted, so no partial total is presented as complete.

## API

| Method | Path | Notes |
|---|---|---|
| `POST` | `/ws/ioeti/quotes/{id}/tax` | `{version}`; draft quotations only |
| `GET` | `/ws/ioeti/finance/fx` | |
| `POST` | `/ws/ioeti/finance/fx/refresh` | |
| `POST` | `/ws/ioeti/finance/fx/rates` | `{currency, rate, rateDate, reason}` |
| `GET` | `/ws/ioeti/finance/summary` | gains `fxStatus`, `rate`, `rateDate`, `*InBase`, `baseCurrency`, `totalInBase` |

## Checked live (`scripts/finance_policy_probe.py`)

1. Without a policy: no tax, no amounts, nothing taxed natively.
2. The default is set → the draft is out of date → applied: the native tax total equals the rate × total, the native tax version has the policy's rate and date, and the version used is recorded.
3. A line's own value wins over the default.
4. Retiring the line's value leaves no tax (no fall back). Another user cannot apply tax.
5. FX read needs native rights. Without the policy nothing converts and nothing is entered.
6. Manual only refuses a fetch. Hand-entered rates are checked.
7. A manual rate is in use and mirrored natively. A rate older than allowed is stale.
8. A back-dated rate gets its own native line ending the day before the next one.
9. The public source's rates are recorded. Manual wins on its date. Fetching again records nothing new.
10. An unreachable source answers 502 and records nothing.
11. The summary gives EGP figures with the rate's status.

The probe removes everything it created, including native taxes, tax versions and conversion lines.

## Not in P2a

Issuing invoices from requests in Axelor accounting (journals, accounts, fiscal year readiness), recording payments and credit notes: these are P2b.
