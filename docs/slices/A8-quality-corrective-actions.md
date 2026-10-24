# A8: quality issues and corrective actions

Status: implemented and checked against the real backend:
- `scripts/quality_probe.py` 18/18 (in backend CI);
- the full local regression;
- mocked browser tests `tests/quality.spec.ts` 4/4;
- a real-browser walk in light at desktop and dark at 390 px. It covered the set-up, numbering, raising, the plan, actions, done and the register. It led to two fixes: the action form's controls now match the rest of the app, and the set-up form no longer overflows a phone. Its data was removed afterwards.

On the capability map, quality was partly live: only audit nonconformities inside a certification cycle existed. There was no register of the company's own quality issues and their corrective actions.

## What people can do

| Action | API (`/ws/ioeti/quality`) |
|---|---|
| The register: open (default), closed or all; "mine" = I own the plan or an open action | `GET ?state=&mine=` |
| One issue with its plan, effectiveness check and actions | `GET /{id}` |
| What an issue can be raised with, and what the set-up still lacks | `GET /options` |
| Raise an issue: title, what happened, where it was found, issue type, gravity, client or supplier, engagement | `POST` |
| Plan it: owner, objective, how effectiveness will be judged, earliest and latest dates | `POST /{id}/plan` |
| Move it to another of the company's statuses | `POST /{id}/status` |
| Judge effectiveness, with what was checked | `POST /{id}/effectiveness` |
| Add a corrective action with its owner, due date and type | `POST /{id}/actions` |
| Mark an action done (with what was done), cancel or reopen it | `POST /{id}/actions/{actionId}/done\|cancel\|reopen` |
| People who can own a plan or an action | `GET /people` |

| Action (administrators) | API (`/ws/ioeti/admin/quality`) |
|---|---|
| The quality set-up lists, with how often each value is used | `GET /statuses\|detections\|issue-types\|action-types` |
| Add a value: a status with its kind, a detection source with its origin, an issue or action type | `POST /{list}` |
| Rename a value, or change a status kind or a detection origin, with the version | `POST /{list}/{id}` |
| Delete an unused value | `POST /{list}/{id}/delete` |

## How it maps to the native model

An issue is the native system-type `QualityImprovement` (axelor-quality):
- **Where it was found:** its native detection.
- **Gravity:** its native gravity (critical, major or minor).
- **What happened:** its first native defect line, with the issue type.
- **Client, supplier and engagement:** its native identification.
- **The plan and the effectiveness check:** its native analysis (owner, objective, efficiency criteria, dates, efficiency).
- **Statuses:** the native statuses with their closed and cancelled flags.

Raising follows the native creation steps:
- the native default status (the first open one in order);
- the native consistency checks: a client source needs the client, a supplier source the supplier;
- the native numbering.

Corrective actions are kept in a small IOETI entity (`CorrectiveAction`, migration V018). The native `QITask` requires a contact card as the responsible and a set of defects. IOETI assigns an action to a person on the platform with a due date. The native analysis progress is kept as the share of actions done.

## Rules

- **Access.** Native quality-improvement permissions decide on every call:
  - anonymous 401;
  - a reader sees issues but cannot raise, plan, act or list assignees (403);
  - an issue you cannot read answers 404.
  - Only system (service) quality issues are handled here; product quality stays in the native screens.
  - A client or engagement name is shown only to people who may read that record.
- **Nothing is invented; it fails closed.**
  - The statuses, detection sources, issue types and action types are the company's own quality-system choices. None are shipped.
  - Until an open status, a detection source and an issue type exist for the company, the register says what is missing and raising is refused (422 `SETUP_REQUIRED`). An administrator adds them in the admin console's "Quality set-up" tab.
  - Codes are generated; the name is what people see.
- **Numbering belongs to the company.**
  - The native lookup uses the issue's company only, so the Numbering tab sets quality numbering up for the company the administrator works in.
  - Without it, raising answers 422 `NUMBERING_REQUIRED`.
  - Field visits stay on shared numbering, as their native lookup is not by company.
- **Versions.** Every change carries the issue's version: the plan, the effectiveness check, the status and adding an action all move it, and a stale version answers 409. Done, cancel and reopen carry the action's own version and move the issue's.
- **Progress** is the share of actions done; cancelled actions do not count. An action past its due date and still open counts as overdue.
- **Closing is the person's decision.**
  - Closing with open actions or without an effectiveness check is not blocked, because no such rule is approved. The screen reminds the person before it moves.
  - The register counts closed issues without an effectiveness check.
- **Set-up values in use** cannot be deleted (409 `IN_USE`); rename them instead. Every set-up change goes to the change log.
- **Nothing is sent to a client or supplier.** Telling them about an issue or an action is D-10.

## Screens

- **Quality** (`#/quality`, under Delivery):
  - **Filter:** open, closed or all, and "mine to do".
  - **Counts from the real records:** open, critical open, overdue actions, and closed without an effectiveness check.
  - **Cards** show the gravity (colour), status, reference, source, client, owner, latest date, progress and overdue actions.
  - **When the set-up is missing:** a note lists what is missing, with a link for administrators, and raising is off.
- **Raise an issue:**
  - the title and what happened;
  - gravity as large choices;
  - where it was found (with its origin) and the issue type;
  - the client search, required when the source is a client or supplier.
- **Issue page:**
  - **Header:** gravity, status, reference and what happened, with buttons to move it to each other status. Closing reminds about open actions and an unjudged effectiveness first.
  - **Plan** card, with an edit dialog.
  - **Effectiveness** card: effective or not, and what was checked.
  - **Corrective actions:** done (with what was done), cancel and reopen, with overdue in red, and an inline form to add one.
- **Admin console → Quality set-up:**
  - **Lists:** statuses (kind), detection sources (origin), issue types and action types.
  - **Changes:** add, rename, and change the kind inline.
  - **Delete** is disabled while a value is in use.
- **System map:** quality is live; D-10 holds telling a client or supplier.

## Not yet

- **Root-cause analysis** with the company's chosen method: native causes need an analysis-method tree the company has not defined.
- **Attachments** (evidence) on an issue or action.
