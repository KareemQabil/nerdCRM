# A2: daily work from the platform

Status: implemented and checked against the real backend:
- `scripts/daily_work_probe.py` 44/44 (in backend CI);
- mocked browser tests `tests/daily.spec.ts` 6/6;
- a real-browser walk-through of the whole journey, then the agenda, account, opportunity and search in the three themes at desktop and 390 px.

Part of phase 2 of the journeys plan (journeys 1–3: a lead arrives and is worked, an existing client calls, a deal moves).

## Why

The day-to-day sales work still had gaps that sent people to the native Axelor screens or left them stuck:
- a lead could not be corrected after intake;
- an existing client or a walk-in could only be added by inventing a lead and converting it;
- contacts could not be added to an account;
- an opportunity's stage could not be moved, and it could not be lost or reopened;
- an opportunity had no amount, close date or probability;
- calls and meetings on accounts and opportunities had nowhere to go;
- there was no personal agenda and no search across records.

## What people can do

| Area | Actions | API |
|---|---|---|
| Leads | Edit name, organisation, phone, e-mail and line; the search follows the change; a converted lead stays as it was | `POST /ws/ioeti/marketing/leads/{id}` |
| Accounts | Add an account directly, warned live about similar names; edit it; add contact people | `POST /ws/ioeti/accounts` · `POST /accounts/similar` · `POST /accounts/{id}` · `POST /accounts/{id}/contacts` |
| Opportunities | See the stage path; move between open stages; mark lost with a reason; reopen; set the estimate (amount, currency, expected close date, probability) | `GET /ws/ioeti/opportunities/stages` · `GET /lost-reasons` · `POST /{id}/stage` · `/lose` · `/reopen` · `/plan` |
| Activities | Log a call, meeting, task or note that happened, or plan one, on a lead, account or opportunity; see the timeline | `GET/POST /ws/ioeti/workspace/activities` |
| Agenda | One's own week or two: planned activities, training sessions one coordinates, audits one leads or manages, interviews for one's job orders | `GET /ws/ioeti/workspace/agenda?from&to` |
| Search | Ctrl/⌘ + K from anywhere: leads, client accounts and opportunities one may read, Arabic-normalised | `GET /ws/ioeti/workspace/search?q` |

Everything is built on native records:
- accounts and contacts are `Partner`, numbered by the native repository;
- stages are `OpportunityStatus`, with won and lost taken from the CRM app configuration;
- reasons are `LostReason`;
- activities are `Event`.

## Rules

- **Access.** Every command checks write access and the record version on the server.
  - A record the caller may not read answers 404, so its existence is not revealed.
  - A read-only person gets 403, and an anonymous caller gets 401.
  - A stale version answers 409.
- **Duplicates.**
  - Adding an account whose normalised name matches an existing one (أ/ا, ة/ه, ى/ي) answers 409 `POSSIBLE_DUPLICATE`.
  - Editing a lead to look like another lead answers the same.
  - In both cases, the person must confirm that it is a different record.
- **Private details.** Phone numbers, e-mail addresses and activity outcomes are written but never returned. The edit dialogs never prefill them. G-007 classifies them RESTRICTED.
- **Won is policy D-11.**
  - When a deal counts as won is tied to the signed contract, so moving to the won stage answers 422 `BLOCKED_BY_POLICY`.
  - The screen shows the won stage locked, with the reason.
- **Lost needs a reason.**
  - Moving to the lost stage directly answers 422 `USE_LOSE`; the lose command requires a reason.
  - A lost opportunity cannot be moved until it is reopened (`STAGE_CLOSED`).
  - Reopening returns it to the configured default stage and clears the reason.
- **The estimate is not revenue.** The amount and probability are the salesperson's estimate.
  - The amount is at least 0, with two decimals at most.
  - The currency must exist.
  - The probability runs from 0 to 100.
  - The weighted value on the screen is labelled "estimate only".
- **Activities.**
  - Something that happened cannot be in the future, and something planned cannot be in the past (10 minutes of tolerance).
  - Times are wall-clock times. "Already happened" is judged on the person's own clock: the browser sends its time zone (IANA).
    - Without a zone, Axelor's native "today" for the company's time zone is used, never the raw server clock.
    - Otherwise a person in Cairo using a server on UTC would see a call made "now" refused as being in the future.
    - An unknown zone answers 422.
  - Logging moves the record's version, so two people logging on the same record never lose each other's view of it.
  - Nothing is sent to anyone.
- **Agenda and search.**
  - Only the caller's own items, and only records they may read. Another rep's activities and leads do not appear.
  - The agenda range is limited to 62 days.
  - Search needs two characters.

## Found while checking against the real backend

- **No lost reasons are set up** on a fresh install (the native list is empty), so nothing can be marked lost. That affects leads as well as opportunities.
  - The lose dialog now says so and cannot be saved.
  - The reasons themselves are the company's to choose, so none are invented.
  - Managing reference lists from the admin console is phase 5.
- **Date-times come back with a trailing `Z`** (Axelor's serialiser), although they are local wall-clock values. The screens read the digits as local time, as the other screens already did.

## Policy

Not offered, as before:
- reassigning records to other people (D-12 / D-07);
- automatic reminders or messages from planned activities (D-10).

## Screens

- **Lead page:** an "Edit details" dialog and the activity timeline with a quick composer.
- **Accounts:**
  - a "New account" dialog that lists similar accounts as you type;
  - the account page gains "Edit account", "Add contact" and the activity timeline.
- **Opportunity page:** the stage path (one tap per open stage; won locked; mark lost with reason chips; reopen), the estimate card with a probability meter, and the activity timeline.
- **My agenda (`#/agenda`):** a day strip with counts, days grouped with today highlighted, overdue items marked, and links to each record.
- **Quick search:** a top-bar button and Ctrl/⌘ + K, operated from the keyboard (arrows, Enter, Esc).

A failed background read is shown quietly in place. Only a refused change is announced as an alert.
