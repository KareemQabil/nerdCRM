# A7: field visits and record numbering

Status: implemented and checked against the real backend:
- `scripts/visit_probe.py` (in backend CI); the daily-work, lists, catalogue and campaign probes still pass;
- mocked browser tests `tests/visits.spec.ts` 4/4, with the live system-map test updated because visits are now live;
- a real-browser walk in light at desktop and dark at 390 px. It set up numbering, planned, started and logged visits, and checked the agenda, with no page errors and no horizontal overflow. Its data was removed afterwards.

On the capability map, field visits were the last domain still marked as being built.

## What people can do

| Action | API (`/ws/ioeti/visits`) |
|---|---|
| See visits you may read; "mine" = assigned to you; by status | `GET ?mine=true&status=` |
| Open a visit with its log | `GET /{id}` |
| Plan a visit for a client account: purpose, optional type, opportunity or contract, who goes and when | `POST` |
| Plan or reschedule, with the version | `POST /{id}/plan` |
| Start, pause, resume, finish or cancel on site | `POST /{id}/start\|suspend\|finish\|cancel` |
| Add a note to the visit log | `POST /{id}/notes` |
| Visit types; people a visit can be assigned to | `GET /types`, `GET /people` |

Built on the native `Intervention` (axelor-intervention):
- **Status, start, pause and finish** go through the native `InterventionService`, so the native rules and timings apply.
- **The visit log** is a small IOETI entity (`VisitNote`, migration V017).

| Action | API (`/ws/ioeti/admin/numbering`) |
|---|---|
| How each record type the platform creates is numbered (administrators) | `GET` |
| Set up numbering for a type that has none, or change its prefix and digits | `POST /{code}` |

## Rules

- **Access.** Native intervention permissions decide on every call:
  - anonymous 401;
  - a reader sees visits but cannot plan, list assignees, act or write notes (403);
  - a visit you cannot read answers 404.
- **Numbering is not invented.**
  - The visit sequence ships only in the native demo data, so a fresh database has none.
  - Saving a visit then answers 422 `NUMBERING_REQUIRED`, and the screen says who can fix it.
  - An administrator sets the prefix and digits in the admin console's Numbering tab. The platform does not choose a company format.
  - Prefixes are 1–12 letters, digits or `- _ /`, and `%YY` for the year. Anything else answers 422 `FORMAT`.
  - Changes are versioned (stale → 409) and written to the change log (`NUMBERING_SET`).
- **Planning.**
  - The purpose is required.
  - The account must be a client account you may read; a contact person answers 404.
  - The start cannot be in the past (422 `PAST`), and the end must be after it (422 `BEFORE_START`). The end defaults to two hours after the start.
  - Past and future are judged in the browser's time zone; without one, the company's time is used.
  - Without a person and a time, the visit waits as "to plan".
- **On site.**
  - Planned → started ⇄ paused → finished, and cancel from to-plan, planned or paused.
  - Anything else answers 422 `STATUS_NOT_ALLOWED`.
  - Finishing with required checklist questions unanswered answers 422 `CHECKLIST_INCOMPLETE` (native rule).
  - Cancelling clears the time and the assignee.
  - Every change carries the version; stale → 409.
- **The visit log is append-only.** Each note moves the visit's version, so two people cannot silently overwrite each other's view. Notes are personal data in the G-007 registry.
- **Nothing is sent to the client.** A visit confirmation or report to the client is external exposure (D-10), and the screens say so.

## Screens

- **Field visits** (`#/visits`, under Delivery):
  - **Groups:** under way, today, coming up, to plan, done or cancelled.
  - **Filter:** "mine" or "all".
  - **Cards** show the time, the account, the purpose, the status and who goes.
- **Visit page:**
  - **The essentials:** status, reference, account, purpose, time and who goes.
  - **Actions:** large on-site buttons for only the moves the status allows. Cancelling asks first.
  - **The visit log**, with a note box.
- **New visit:**
  - **Opened from** the visits page, or from an account's page with the account already chosen.
  - **The form:** an account search, the purpose, an optional type, and who goes and when (default tomorrow at 10:00), or "set the time later".
- **Agenda:** planned and running visits assigned to you appear in "My agenda" on their day.
- **Admin console → Numbering:**
  - each record type with how its next number looks;
  - field visits flagged until set up;
  - a dialog with a live preview of the next number.
- **System map:** field visits are live; D-10 holds sending to the client.

## Not yet

- **Checklists:** answering the native checklist questions from the visit page.
- **Photos and signature** on site.
- **Maps and routes** for the day's visits.

None of these needs a company decision, except sending anything to the client (D-10).
