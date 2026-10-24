# A3: reference lists from the admin console

Status: implemented and checked against the real backend:
- `scripts/reference_lists_probe.py` 15/15 (in backend CI);
- mocked browser tests `tests/lists.spec.ts` 2/2;
- a real-browser look in light at desktop and dark at 390 px.

Brought forward from phase 5 of the journeys plan. Checking phase 2 against the real backend showed that a fresh install has **no lost reasons**, so nobody could mark a lead or an opportunity lost. The lists people pick from every day could only be changed in the native Axelor screens, which ADR-001 rules out.

## What an administrator can do

The admin console gains a **Lists** tab with three lists:

| List | Actions | API (`/ws/ioeti/admin/lists`) |
|---|---|---|
| Lost reasons | add, rename, delete an unused one | `GET/POST /lost-reasons` · `POST /lost-reasons/{id}` · `/{id}/delete` |
| Lead sources | add, rename, delete an unused one | `GET/POST /sources` · `POST /sources/{id}` · `/{id}/delete` |
| Opportunity stages | add, rename, reorder by drag, delete an unused one | `GET/POST /opportunity-stages` · `POST /opportunity-stages/{id}` · `/{id}/delete` · `POST /opportunity-stages/order` |

Each value shows how often it is used.

## Rules

- **Administrators only**, on every call: 401 without a session, 403 for anyone else.
- **Names.** Required and unique in the list, ignoring letter case (422 `DUPLICATE`).
- **A value in use is never deleted** (409 `IN_USE`). It is renamed instead, so history keeps its meaning.
  - Usage is counted on leads, opportunities and accounts.
  - Any other reference found by the database also keeps the value.
- **Core stages.** The configured won, lost, default and proposal stages can be renamed but never deleted (422 `PROTECTED`).
- **Stage order.**
  - New stages land after the open stages, before won and lost.
  - Reordering takes every open stage once (422 `INCOMPLETE` otherwise), and won and lost stay last.
  - Sellers see the new order on the opportunity path at once.
- **Conflicts.** Every rename and delete carries the version; a stale one answers 409.
- **Change log.** Every change is written there (`LOST_REASON_ADDED`, `SOURCE_RENAMED`, `OPPORTUNITY_STAGE_ORDERED`…).
- **No values are shipped.** The reasons, sources and stages are the company's own.

## Screens

- **Add a value.** An inline field: Enter adds the value and keeps the focus, ready for the next one.
- **Rename.** In place: Enter saves, Escape cancels.
- **Delete.** Only for unused values, after a confirmation. For a value in use, the button explains why it is disabled.
- **Reorder stages** with a drag handle (`@dnd-kit`):
  - works with mouse, touch (a short press) and keyboard (Space, the arrows, Space);
  - screen-reader announcements are in Arabic or English;
  - the move shows at once and is undone if the server refuses it;
  - won and lost are shown locked under the open stages.
