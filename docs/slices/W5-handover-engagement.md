# Wave 5: handover and engagement (`ioeti-operations`)

Status: LIVE_INTEGRATION_PASS and NEGATIVE_SECURITY_PASS on Axelor 9.1.10 + PostgreSQL 16 (`scripts/operations_probe.py`, also in backend CI), with mocked browser contracts for the UI. Every role used in tests is a fixture; production roles are D-07.

## 1. Where it sits in the chain

Client → Lead → Opportunity → Quote → Contract → **Handover → Engagement** → Delivery → Renewal.

A handover moves a **signed (active) contract** from sales to operations. Operations reviews it against the business line's checklist and then sends it back, rejects it, or accepts it. Acceptance creates the engagement, which is a native AOS `Project` with native `ProjectTask`s.

**Policy gate (D-11):** activating (signing) a contract is still `BLOCKED_BY_POLICY` in the IOETI API, so in production no contract becomes active through this product and no handover can be requested until D-11 is signed. Tests make a contract active with SQL in the disposable database. This is a test fixture standing in for the signature, never a product path. The older `POST /ws/ioeti/contracts/{id}/handover` still answers `CONTRACT_NOT_ACTIVE` or `BLOCKED_BY_POLICY`; the handover workflow lives in `/ws/ioeti/operations`. Financial prerequisites (for example a first payment before handover) are part of D-06/D-11 and are not invented: a business line can add them to its checklist once the owners decide.

## 2. Native reuse

| Need | Reused | New |
|---|---|---|
| Engagement | `Project` (client, company, lead `assignedTo`, `team`, start date, first `ProjectStatus`) | `Project.ioetiHandover`: an extension field, unique, linking the project to the handover that created it |
| Operational tasks | `ProjectTask` (name, due date, assignee, `TaskStatus`, progress) | — |
| Team | `Team` | — |
| Checklist | native `ProjectCheckListTemplate`/`Item` belong to an existing project and cannot hold a pre-acceptance checklist | `HandoverRequirement` per business line, `HandoverItem` per handover |
| Decisions | — | `HandoverRequest`, append-only `HandoverEvent` |

## 3. Rules

- A handover needs an **active contract** whose opportunity has a business line (else 422 `CONTRACT_NOT_ACTIVE` / `BUSINESS_LINE_REQUIRED`).
- The business line must have a configured checklist (else 422 `CHECKLIST_NOT_CONFIGURED`). This fails closed: engineering does not invent checklist content.
- A contract can have one open or accepted handover at a time (409 `HANDOVER_EXISTS`); after a rejection, a new request is allowed.
- The checklist is **copied** at submission: retiring a requirement later does not rewrite submitted handovers.
- States: `SUBMITTED → REWORK_REQUESTED → SUBMITTED` (resubmit), `SUBMITTED → REJECTED`, `SUBMITTED → ACCEPTED`. Rework and rejection need a reason code (`MISSING_SCOPE`, `MISSING_DOCUMENTS`, `NO_CAPACITY`, `CLIENT_NOT_READY`, `OTHER`).
- Acceptance needs every **required** item done (422 `CHECKLIST_INCOMPLETE`), an active operations lead and **project-creation rights**. A salesperson who may edit the handover still gets 403.
- Acceptance creates **exactly one** project in the same transaction. No orphan project can exist, and the unique link plus the row lock prevent a second one. The probe sends simultaneous acceptances: one 201 and one 409, one project.
- A decided handover's checklist is frozen (422 `HANDOVER_STATE`).
- Tasks are added with the engagement's version, so a double submission creates one task (409 for the second). A task is completed once (422 `TASK_DONE`). Progress is done/total; a task is overdue when it is not done and its due date has passed.
- Ownership transfer changes the project lead and records `OWNER_CHANGED` with from/to (same person → 422).
- The trail `HandoverEvent` records submission, item completion, rework, resubmission, acceptance, engagement creation, rejection and ownership changes, with actor and time. No endpoint changes or deletes an event.

## 4. API (`/ws/ioeti/operations`)

| Endpoint | Notes |
|---|---|
| `GET/POST /requirements`, `POST /requirements/{id}/retire` | per business line; creating needs create access on `HandoverRequirement` (administrators) |
| `GET /ready-contracts` | active contracts the caller may read without an open or accepted handover |
| `GET/POST /handovers`, `GET /handovers/{id}` | `{contractId}`; the view includes the checklist and `missingRequired` |
| `POST /items/{id}/complete` | `{version, evidenceReference?}` |
| `POST /handovers/{id}/rework`, `/reject` | `{version, reason}`; need project-creation rights |
| `POST /handovers/{id}/resubmit` | `{version}` |
| `POST /handovers/{id}/accept` | `{version, operationsLeadId, teamId?, startDate?}` → 201 engagement |
| `GET /handovers/{id}/events` | the trail, oldest first |
| `GET /people` | active users who can lead an engagement; only for callers who may create projects |
| `GET /engagements?mine=`, `GET /engagements/{id}` | projects created from handovers; progress, overdue count |
| `GET/POST /engagements/{id}/tasks`, `POST /tasks/{id}/complete` | `{version, name, dueDate?, assigneeId?}` |
| `POST /engagements/{id}/owner` | `{version, userId}` |

Records outside the caller's scope answer 404, like a missing id. Projects that were not created from a handover are not part of this API (404).

## 5. UI (`#/operations`)

- **Handovers**:
  - a request form listing contracts ready for handover; when there are none, it says that activation waits for D-11;
  - a register with a status filter and the count of missing required items.
- **Handover record**:
  - contract, client and engagement links;
  - the checklist, with evidence references and per-item completion;
  - for operations: an accept form (lead, start date) and rework/reject with a reason;
  - for the requester: resubmit;
  - the read-only decision trail.
- **Engagements**: a register with progress bars and overdue counts, and a "mine" filter.
- **Engagement record**: progress, tasks (add, complete, overdue), ownership transfer, and a link back to the handover.
- **Checklists**: the requirements per business line (add, retire), with the note that the content is the administrators' decision.

## 6. Not done

| Item | Why |
|---|---|
| Contract activation/signature and when a deal is handed over | D-11 |
| Financial prerequisites (deposit, first payment) as handover conditions | D-06/D-11 |
| Quote versions, approval requests, contract review history, document templates, invoice requests, payment read models, renewals | next package (Wave 5b) |
| Separation of duties between requester and reviewer beyond permissions | D-07 |
