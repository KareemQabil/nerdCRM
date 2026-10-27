# R1: recommended starting values for every policy

Status: implemented.

**Owner instruction (2026-10-27):** "even the decisions use a recommended decision and we can modify it later".

| Check | Result |
|---|---|
| `scripts/policy_probe.py` (backend CI), with three R1 checks | 12/12, complete cleanup |
| Regression: retention, response targets, routing, admin, quote approval probes | 21, 13, 17, 43, 11 — all pass |
| Full mocked + demo suites | 144 + 27; typecheck OK |
| `PolicyRecommendationsTest` | 5/5: every value passes its policy's checks; every policy is covered; holidays; VAT |
| `PolicyValidatorTest` | 6/6 |
| Mocked browser suite `tests/policies.spec.ts` | 5/5 (2 new) |
| PII DTO audit / policy registry check | 0 problems / 12 decisions match |

## How it works

Principle P still holds: a workflow that needs a policy is refused (`422 POLICY_NOT_SET`) until the policy has a value.
R1 only shortens the way to that value.

**Under Policies**, a panel says how many rules still have no value.
- **Review the recommendations** opens a list grouped by area. For each rule it shows:
  - the recommended value;
  - why it is recommended, and whether that rests on a **law or standard** or on **common practice**;
  - what the rule unlocks.
- **A policy owner** picks the ones they accept and an effective date, then applies them in one step.
  - Each applied value becomes an **ordinary policy version in their name**, with the reason "Recommended starting value
    (R1)…".
  - Like any version it can be changed or unset later.
  - The admin change log records each version and the step itself (`POLICY_RECOMMENDED_APPLIED`).
- **A value already set is never replaced,** whether it was set by hand or applied before.
- **Others:** administrators can read the list but cannot apply it (`403`); other users cannot see it.

**API:** `GET /ws/ioeti/policies/recommended`, `POST /ws/ioeti/policies/recommended/apply {ids, effectiveFrom?}`.

**Certification policies (`cert.decision`, `cert.cycle`)** now accept a company-wide default, with an override per scheme.
Before this change, each scheme had to be set separately.

## The recommended values

| Policy | Recommended value | Basis | Why |
|---|---|---|---|
| Tax (`finance.tax`) | VAT 14% | Law | Egypt's standard VAT rate (Law 67/2016). Give an exempt line its own value once the tax adviser confirms. |
| Exchange rates | Public daily source; USD, EUR, GBP, SAR, AED; rates older than 24 h count as stale | Practice | Finance can still override any rate. |
| Payment terms | 30 days | Practice | The usual business-to-business term. |
| Quotation approval | ≤5% no approval; ≤10% sales manager; ≤20% GM; above that refused | Practice | |
| Quotation validity | 30 days | Practice | |
| Contract activation | General manager | Practice | |
| Won evidence (per line) | Accepted quotation with uploaded evidence | Practice | Switch a line to "active contract" if it always signs one. |
| Retention (Law 151/2020 sets no fixed period) | Leads 24, candidates 24, trainees 60, donors 60, contacts 36 months | Practice | Trainees: certificate checks. Donors: tax-record keeping. |
| Response targets | First contact 4 working hours; qualified within 40 | Practice | |
| Working hours | Sun–Thu, 09:00–17:00, fixed public holidays of the coming year | Practice | The moving holidays (Islamic, Sham El-Nessim) are added when they are announced. |
| Routing (per line with a responsible team) | Every lead to that team, round robin, at most 40 open per person | Practice | Lines without a responsible team get no routing recommendation. |
| Certification decision | Independent reviewer | Standard | ISO/IEC 17021-1: the person who decides was not on the audit. |
| Certification cycle | 36 months; surveillance every 12 | Standard | ISO/IEC 17021-1. |
| Training certificate | 80% attendance; 70% pass mark | Practice | |
| National ID | Optional | Practice | Stored as restricted data. |
| Training cancellation | 100% refund ≥14 days before the start; 50% ≥7 days; 0 after | Practice | |
| Recruitment agreement | 15% of annual salary, invoiced on the start date, 90-day replacement guarantee | Practice | Can be set per client. |
| External channels | None switched on | Practice | Each channel is switched on when its credentials are set and tested. |

**What R1 does not do:** it does not approve legal or business policies on the owners' behalf. A person with the
policy-owner role applies each value, and the history shows who did and when.
