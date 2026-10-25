# P1: business-rule policy engine

Status: implemented and checked against the real backend:
- `scripts/policy_probe.py` 9/9 (backend CI);
- `PolicyValidatorTest` 6/6 (unit);
- mocked browser tests in `tests/policies.spec.ts` 3/3, desktop and 390 px with no horizontal overflow;
- migration `V019` verified (8/8 checks, rollback `U019`).

## Why

On 2026-10-25 the owner signed principle P (`docs/decisions/OPEN_IOETI_POLICY_DECISIONS.md`): every business rule
behind decisions D-01..D-12 is a **setting the owners control**, not code. P1 is the engine those rules are read
from. It ships **no values**. Each workflow that needs a rule refuses with `422 POLICY_NOT_SET` until a policy owner
sets it. P2..P8 make the workflows read these policies.

## Model

`ioeti_policy_version` (`PolicyVersion`), append-only:

| Field | Meaning |
|---|---|
| `policyKey` | A key from `PolicyCatalog`, e.g. `finance.tax`. An unknown key returns 404. |
| `scopeKey` | `null` = company-wide or the default. Otherwise a business line, scheme, course, client agreement or data type, depending on the definition. |
| `valueJson` | The value, checked against the definition's fields. |
| `retired` | From this date the scope has no value. If the definition allows a default, the default applies. |
| `effectiveFrom` | Today or later. A date in the past returns `422 PAST`. |
| `reason`, `author`, `createdAt` | Why, who and when. Required. |

- Rows are never updated or deleted.
- The value in force for a scope on a date is the latest row with `effectiveFrom <= date`.
- Records that use a policy keep the `versionId` they used (P2+), so a later change never rewrites history.

## Catalogue (17 policies)

| Decision | Policies |
|---|---|
| D-06 finance | tax per business line, with an optional default; FX source, currencies and maximum age; payment terms |
| D-11 sales | quotation approval tiers; quotation validity; what counts as Won, per line, with no default |
| D-07 privacy | retention months per data type (review queue, never automatic deletion) |
| D-12 leads | routing rules and workload cap; first-contact and qualification targets; working calendar |
| D-02 certification | decision mode per scheme (independent reviewer or committee); validity and surveillance |
| D-03 training | attendance and pass mark per course; national ID collection; cancellation and refund steps |
| D-04 recruitment | fee, invoicing trigger, guarantee and replacement per client agreement |
| D-10 channels | which inbound and outbound channels are enabled (all off until set) |

Field kinds: percent, decimal, integer, yes/no, choice, multi-choice, text, time, date list, and lists of rows.
Rules between fields:
- approval tiers ascend by discount;
- a committee needs a size;
- the working day ends after it starts;
- a partial refund needs a percentage;
- currencies are ISO codes.

## Who may do what

| Who | Read | Change values | Appoint or remove owners |
|---|---|---|---|
| Policy owner (Axelor role `ioeti-policy-owner`) | yes | yes | yes. The last owner cannot be removed (`409 LAST_OWNER`). |
| Administrator who is not an owner | yes | **no (403)** | only the first owner, when there is none |
| Anyone else | no (403) | no | no |

- Checks run on the server on every call. The navigation item is only a convenience.
- Every change is written to the admin change log (`POLICY_SET`, `POLICY_RETIRED`, `POLICY_OWNER_APPOINTED`,
  `POLICY_OWNER_DISMISSED`) in the same transaction.
- The session exposes `policyOwner` so the UI can show the page.

## API (`/ws/ioeti/policies`)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/` | Overview: `canEdit`, `noOwners`, each policy with how many values are in force today. |
| `GET` | `/{key}` | Fields, value in force and next scheduled change per scope, full history. |
| `POST` | `/{key}` | `{scope?, value, effectiveFrom?, reason}` |
| `POST` | `/{key}/retire` | `{scope?, effectiveFrom?, reason}`. Retiring what is not in force returns 422. |
| `GET` | `/owners`, `/people` | |
| `POST` | `/owners` | `{userId}` |
| `POST` | `/owners/{userId}/dismiss` | |

## UI

Administration → Policies (`#/policies`):
- rules grouped by area, each marked set or not set;
- the chosen rule shows its value per scope, the next scheduled change, and the history (who, when, why);
- an edit dialog built from the definition, with rows for lists, check boxes for multi-choice, a business-line
  picker for per-line rules, and a required reason;
- the owners panel. With no owner, an administrator sees why nothing can change and appoints the first owner.

## Not in P1

The workflows that read the policies (P2..P8). Until then nothing uses these values, and nothing that needs them
is enabled.
