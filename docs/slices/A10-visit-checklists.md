# A10: visit checklists, photos and signature

Status: implemented and checked against the real backend:
- `scripts/visit_checklist_probe.py` 10/10 (in backend CI);
- the full local regression;
- mocked browser tests `tests/visit-checklist.spec.ts` 2/2. They answer by type, check that a conditional question appears, draw a signature with real pointer strokes, and check that finishing is refused, then allowed;
- a browser look at desktop (1366 px) and phone (390 px), with no horizontal overflow.

The capability map listed checklists, photos and signature as the next step for field visits (A7). They are built on the **native intervention survey**, not a parallel model.

## Where the questions come from

Checklists are set up by an administrator in the native Axelor screens. The platform does not invent questions, answer types or pass/fail rules.

| Native set-up | Meaning |
|---|---|
| Answer type (`AnswerType` + values) | list / text / date / measure / checkbox / picture / signature / indication; list values can be marked *non-conforming* |
| Question (`Question`) | the question, its answer type, and whether it is required; a question can depend on another question's answer |
| Range (`Range`, with a range type) | an ordered group of questions |
| Visit type (`InterventionType`) | header / equipment / footer ranges |

A visit of a type with ranges gets its checklist from the **native survey generator** when it is created or planned. The generator runs outside the request's transaction, as the native planning does. If generation fails, the visit is still saved and the problem is logged; "prepare checklist" can run it again. A type without ranges has no checklist, and the visit page says so instead of showing an empty list.

## What people can do

| Action | API (`/ws/ioeti/visits/{id}`) |
|---|---|
| Read the checklist: sections, items, answers, required items still open, whether the caller may answer | `GET /checklist` |
| Prepare (or bring up to date) the checklist from the visit type | `POST /checklist/prepare` {version} |
| Answer an item: list choice, text, date, measure, checkbox, or clear | `POST /checklist/{questionId}` {version, …} |
| Attach a photo or signature (PNG/JPEG) | `POST /checklist/{questionId}/file` {version, fileName, contentBase64} |
| Read a stored photo or signature back | `GET /checklist/{questionId}/file` |
| File documents on the visit (subject `VISIT`) | the existing `/ws/ioeti/content/documents` |

## Rules

- **Answers are given on site.** Answers are allowed only while the visit is under way or paused. Before the start, or after the finish or a cancellation, the checklist is read-only (422 `STATUS_NOT_ALLOWED`).
- **Access.** Native permissions decide on every call:
  - Reading the checklist needs read access to the visit.
  - Answering, attaching and filing documents need write access to the visit. A viewer can read but gets 403.
  - Hiding a button is never the only control.
- **Concurrency.** Every answer carries the item's version, and a stale version answers 409.
- **Only active, answerable items take answers.**
  - "Indication" items are instructions to read.
  - Advanced monitoring stays in the native screens (422 `NOT_ANSWERABLE`).
  - A question that depends on another answer becomes active only once that answer is given. Until then it answers 422 `NOT_ACTIVE`. This uses the native rule (`InterventionQuestionHelper.isActive`).
- **Non-conforming answers are flagged.** Choosing a list value marked non-conforming highlights the item. Any follow-up question set up for it then appears.
- **Required items gate the finish.** The native finish refuses a visit with unanswered required questions. The platform reports that as 422 `CHECKLIST_INCOMPLETE`, and the visit page says how many items are still open before anyone presses "finish".
- **Photos and signatures are checked as images.**
  - The content check (size, extension and sniffed type) runs first: a text file named `.png` is refused.
  - Only PNG or JPEG is accepted for these items.
  - A file sent to an item that is not a photo or signature answers 422 `NOT_A_FILE_ITEM`.
  - Served images carry `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` and a sandboxing CSP.
- **Nothing is sent outside.** No visit report or confirmation goes to the customer (D-10).

## Screens

- **Visit page, checklist section:**
  - Items are grouped by section, with a "required" mark and a progress line ("2 required questions left").
  - Each answer type has its own control:
    - list choices as chips, with non-conforming choices marked;
    - text with save;
    - date;
    - a measure with its unit;
    - a checkbox;
    - a photo from the camera or a file;
    - a signature pad (pointer or touch drawing; clear, then save as PNG).
  - Each answer is saved when given, and the server's answer is shown, never an optimistic guess.
- **Finish button:** while required items are open, a note under the actions explains why the visit cannot finish yet.
- **Visit documents:** the shared documents panel, on the visit.
- **System map:** checklists, photos and signature are live. Maps and route planning, and sending anything to the customer, stay held by D-10.

## Not built here

- **Maps, routes and travel time:** these need an external provider (D-10).
- **A visit report sent to the customer:** D-10.
- **Pass/fail scoring or audit-day formulas:** these are certification rules owned by D-02. They are not invented here.
