# X1c: phone lists, a first-day readiness card, quicker follow-ups

Status: implemented, with mocked UI tests (`tests/x1c.spec.ts`, plus the activity test in `tests/daily.spec.ts`). It was
checked against the local live server with the fictional showcase.

## What changed

- **Phone lists read as cards.**
  - Below 760 px every `DataTable` row becomes a card. Each value carries its column label (`data-label`).
  - The header row is kept for screen readers only, and the table tools stay at the top.
  - Desktop is unchanged.
- **Filters fold on a phone.**
  - The lead filters, saved views included, sit behind one "فلترة" button that shows how many filters are on
    (`PhoneFilters`).
  - The records come first, not 800 px of selects.
  - On a phone the page description is hidden, and the search and refresh share one row.
- **First-day readiness on Home** (`SetupReadiness`). It is shown only to administrators and policy owners:
  - With no policy owner, administrators are told why the steps that need a rule are closed, and to appoint an owner.
  - A policy owner sees "X of Y rules set", the first missing ones, and a button to the rules page, where the
    recommended values (R1) can be applied.
  - It disappears once every rule is set.
  - Everyone else never sees it, and no request is made for them.
- **One-tap follow-up times.**
  - Buttons next to the date field: in an hour, tomorrow morning, in two days, next week. "Tomorrow morning" and "in
    two days" skip Friday and Saturday; "next week" is the coming Sunday.
  - The lead's plan form now defaults to the next working morning instead of an empty field.
  - The buttons sit outside the field's label, so they never become part of its accessible name.
- **No internal numbers in record headers.** The opportunity, lead and account headers no longer show the database id
  ("#26636") or the record version ("v2"). Home's review list names a draft quotation as "عرض سعر (مسودة)" instead of
  "#431".

## Tests

- `tests/x1c.spec.ts`:
  1. an administrator without a policy owner;
  2. a policy owner's progress, and the card leaving once all rules are set;
  3. a salesperson never sees the card;
  4. phone cards and the folded filter count.
- `tests/daily.spec.ts`: "tomorrow morning" sets 10:00 on a working day.
- Regression (mocked):
  - `app`, `daily`, `shell`, `pipeline`, `lead-response`, `lead-routing`, `agenda` and `policies`: 113 passed.
  - Two tests failed only while the machine was under heavy build load. Each passed twice when re-run on its own.
