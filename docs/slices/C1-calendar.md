# C1: the calendar, complete

Status: implemented and checked against the real backend.

| Check | Result |
|---|---|
| `scripts/calendar_probe.py` (backend CI) | 22/22, complete cleanup |
| Daily work probe (activities, agenda, search) | 44/44 |
| Mocked browser suite `tests/agenda.spec.ts` (incl. axe WCAG 2.1 AA in light and dark, phone width) | 7/7 |
| Full mocked + demo suites | 141 + 27; typecheck OK |
| PII DTO audit | 0 problems |

The owner's report: "the calendar is not complete" and "the pipeline numbers are not aligned".

## Pipeline numbers (home)

The open pipeline card wrote its numbers inside `dir="ltr"` cells. In the right-to-left layout those cells aligned
to the left, while the labels aligned to the right.

**Fix:**
- In right-to-left pages, left-to-right figures align right, like their labels. This covers `dd`, `td`, `th`, `p` and
  `small` cells: the home pipeline, quotations, contracts, milestones, fundraising, reports and the palette.
- Figures use tabular digits, so they line up in a column.

## What the calendar does now

**Views:** month, week, day and list. The chosen view is remembered in the browser.
- **Week and day** are a time grid:
  - an hour scale, with one column per day;
  - a line for "now";
  - items placed by their time and length;
  - overlapping items side by side in lanes;
  - audits and corrective actions due in an all-day row.
- **Month** is a 6 × 7 grid starting on Saturday. It shows three items per day, then "+N more", which opens that day.
- **List** is the fortnight grouped by day. Each row links straight to its record.

**One colour per kind of item:** activity, training session, audit, interview, field visit, corrective action.
- Each kind also has its own icon and label, so colour is never the only cue.
- A chip per kind hides or shows that kind and shows how many there are.

**Adding an item**
- Click a free time in the week or day view, double-click a day in the month view, or use **New item**.
- Enter a title, a kind (call, meeting, task, note), a day and time (15-minute steps) and a length (15 minutes to 4 hours).
- Optionally link it to a lead, account or opportunity, found by typing two letters. The record's version is sent, as
  for any activity.
- **An item without a record is personal**: it lives only on its owner's calendar.
- A time that has passed is recorded as having happened (done).

**Changing your own planned items**
- **Drag** to another time or day. The new time snaps to 15 minutes and the item keeps its length.
- Open the item to **mark it done** (optionally with what came of it), **reschedule** it, or **cancel** it. A cancelled
  item stays in the history.
- Only the owner's own **planned** activities can be changed this way. Done, cancelled and other people's items are
  read only, and the server checks again:
  - another person's item → `404`;
  - an item that is not planned → `422 NOT_PLANNED`;
  - a stale version → `409`;
  - a time in the past → `422 PAST`.

**Overdue items stay in view**
- Your own planned activities whose time has passed are listed in a strip above the calendar, whatever week you look at
  (`GET /ws/ioeti/workspace/agenda/overdue`, oldest first, at most 100).
- Each one opens with: done, reschedule, **tomorrow 10:00** or **next week**, in one click.
- Overdue items are also marked in the grid, the month and the list.

**A teammate's calendar**
- The person picker lists the caller and the people who share a team with them (either side of the team membership).
- The server shows a teammate's activities only as far as the caller's own native rights let them read; nothing there
  can be moved.
- Someone outside the caller's teams → `404`. An administrator may open anyone's.

**Keyboard:** `T` today, `←`/`→` previous/next, `M`/`W`/`D`/`L` for the views.

**Phone:** the grid narrows to fit and the month shows icons per item. The page never scrolls sideways.

## API

| Endpoint | What it does |
|---|---|
| `POST /ws/ioeti/workspace/activities` | `record` may be `SELF` (or omitted) for a personal item; `minutes` 5–720, 30 by default |
| `POST /ws/ioeti/workspace/activities/{id}/move` | `{version, at, minutes?, zone?}` |
| `POST /ws/ioeti/workspace/activities/{id}/done` | `{version, outcome?}`; the outcome is never returned |
| `POST /ws/ioeti/workspace/activities/{id}/cancel` | `{version}` |
| `GET /ws/ioeti/workspace/agenda/people` | the caller first, then their teammates |
| `GET /ws/ioeti/workspace/agenda?from&to&userId?` | `userId` for a teammate's activities |

Agenda items now carry `version` and `movable`. `movable` is true only for the caller's own planned activity.

## Open points

- **Training sessions** open on the training page, which has no per-cohort address yet.
- **Recurring items** and **invitations to other people** are not offered. Native Axelor events support both;
  they need a decision on who may invite whom.
