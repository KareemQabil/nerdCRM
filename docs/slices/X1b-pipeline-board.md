# X1b: the pipeline board and a complete new opportunity

Status: implemented.

| Check | Result |
|---|---|
| `scripts/daily_work_probe.py` (+3 checks: create with account and estimate, client-account and range checks, board by read access) | 48/48 |
| Lead conversion / opportunity concurrency probes | 28/28, 13/13 |
| `tests/pipeline.spec.ts` (new) | 4/4 |
| Full mocked + demo suites | 153 + 27; typecheck OK |
| PII DTO audit | 0 problems |

## The board

Opportunities now open as a **list** or a **board**; the choice is remembered in the browser.

**Columns:** one per open stage, then **Won** and **Lost** for the last 30 days. Each column shows how many opportunities
it holds and their total per currency.

**Each card shows:**
- the name;
- the client account;
- the expected value;
- the expected close date, in red when it has passed;
- the owner, when it is someone else.

**Filters:** business line, "mine only", and a search.

**Moving a card:**
- Drag it to another open stage, or choose the stage from the card's own list (for the keyboard and phones).
- The move is sent with the card's version and checked by the server as usual.
- Dropping on **Won** or **Lost** opens the opportunity instead. Won needs the line's evidence (D-11) and Lost needs a
  reason, and both steps are on the opportunity's page.

**API:** `GET /ws/ioeti/opportunities/board`.
- It lists every readable open opportunity, plus those won or lost in the last 30 days, 500 at most.
- The account name is included only when the caller may read the account.

## A complete new opportunity

The form still needs only a name and a business line. Optionally it also takes:
- the **client account** (found by typing two letters; only client accounts are offered);
- the **expected value and currency**;
- the **expected close date**;
- the **probability**.

The new opportunity opens at once, ready for its next step. The buttons are labelled **Create opportunity** and
**Cancel**.

**From an account:** an account page has **New opportunity for this account**, which opens the form with the account
already filled in. "+ New" from the top bar also offers it.

**API:** `POST /ws/ioeti/opportunities` takes `accountId`, `amount`, `currencyCode`, `expectedCloseDate` and `probability`.
These go through the same checks as the estimate:
- a contact person or an unreadable account → `422` / `404`;
- an out-of-range value → `422 RANGE`.
