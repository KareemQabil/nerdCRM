# A11: root-cause analysis and evidence on quality issues

Status: implemented and checked against the real backend:
- `scripts/quality_rca_probe.py` 14/14 (in backend CI);
- `scripts/quality_probe.py` 18/18 and `scripts/content_probe.py` 15/15 still pass;
- the full local regression;
- mocked browser tests `tests/quality.spec.ts` 7/7 (three of them new);
- a browser look at desktop (1366 px) and phone (390 px), with no horizontal overflow.

A8 delivered quality issues, the plan, corrective actions and the effectiveness check. A11 adds two things the capability map listed next: a **root-cause analysis** that follows the company's own method, and **evidence documents** on the issue.

## The native model, and what is the company's to set up

Root-cause analysis uses the native axelor-quality records. Nothing is invented and nothing is shipped:

| Native record | Meaning | Set up by |
|---|---|---|
| `QIAnalysisMethod` (system) | the company's analysis method, e.g. a cause-and-effect ("fishbone") diagram | administrator |
| `QIAnalysisMethodItem` | a **branch** of the method: a cause category (people, method, equipment…) | administrator |
| `QICause` | a known cause, always under one branch (native: `branch` is required) | administrator |
| `QIProcess` | a company process where a cause can arise, with its **owner** (native: `manager` is required) | administrator |
| `QIAnalysisCause` | a cause recorded on an issue's analysis: cause, process, who it is attributed to, what was found | quality people |

The issue's `analysisMethod` and its native analysis (`QIAnalysis`) carry the method, the recorded causes, and who recorded them and when.

### Attribution: the organisation, never a named person

The native cause row requires a responsible party. The platform offers three choices:
- **The organisation:** recorded with the company's own party record. An internal cause is never attributed to a named employee, so the analysis stays about the process.
- **The client:** the issue's client.
- **The supplier:** the issue's supplier.

Naming individuals as responsible for a nonconformity would be a people-policy decision, and it is not made here. If the company has no party record, an internal cause answers 422 `SETUP_REQUIRED`, and the options list `COMPANY_PARTY` as missing.

## What people can do

| Action | API |
|---|---|
| Choose (or clear) the issue's analysis method, before any cause is recorded | `POST /ws/ioeti/quality/{id}/analysis/method` {version, methodId} |
| Record a cause: cause (from the method's branches), process, attributed to INTERNAL / CUSTOMER / SUPPLIER, what was found | `POST /ws/ioeti/quality/{id}/causes` {version, …} |
| Remove a recorded cause | `POST /ws/ioeti/quality/{id}/causes/{causeId}/remove` {version} |
| The analysis on the issue: method, its branches with their causes, recorded causes, written by/on | `GET /ws/ioeti/quality/{id}` → `rootCause` |
| Whether analysis can be done, and what is missing | `GET /ws/ioeti/quality/options` → `analysisReady`, `analysisMissing`, `methods`, `processes` |
| File evidence on the issue (subject `QUALITY_ISSUE`) | the existing `/ws/ioeti/content/documents` |

| Action (administrators) | API (`/ws/ioeti/admin/quality`) |
|---|---|
| Methods, causes and processes, with how often each is used | `GET /methods\|causes\|processes` |
| Add a method; a cause with its `branchId`; a process with its `ownerId` | `POST /{list}` |
| Rename; move a cause to another branch; change a process's owner | `POST /{list}/{id}` |
| Add a branch to a method, or remove an empty one (the method's version) | `POST /methods/{id}/branches`, `POST /methods/{id}/branches/{branchId}/delete` |

## Rules

- **Fail closed.**
  - With no method that has causes under its branches, no process, or no company party record, the options say what is missing.
  - Recording a cause then answers 422 `SETUP_REQUIRED`.
- **Method first.**
  - Causes need the issue's method (422 `METHOD_REQUIRED`).
  - Only causes under that method's branches are accepted (422 `UNAVAILABLE`).
  - The method cannot change once causes are recorded (422 `HAS_CAUSES`).
- **Validation.**
  - Every cause needs a process and what was found.
  - A client or supplier attribution needs that party on the issue (422 `NO_CUSTOMER` / `NO_SUPPLIER`).
- **Access.** Native quality-improvement permissions decide on every call:
  - A reader sees the analysis but cannot record a cause (403).
  - A client's or supplier's name is shown only to those who may read it.
  - Evidence is filed by people who may change the issue; a viewer lists it but gets 403 when filing.
- **Concurrency.**
  - Choosing the method, and recording or removing a cause, move the issue's version; a stale version answers 409.
  - Branch changes move the method's version.
- **In use.**
  - A cause, process or method in use cannot be deleted (409 `IN_USE`).
  - A branch with causes cannot be removed.
- **Audit.** Every set-up change goes to the admin change log: `QI_METHOD_*`, `QI_METHOD_BRANCH_ADDED/DELETED`, `QI_CAUSE_*` and `QI_PROCESS_*`.
- **Nothing is scored.** There is no risk number, cause weighting or pass/fail rule. Those would be the company's quality-system decisions.
- **Nothing is sent outside** (D-10).

## Screens

- **Quality issue page:**
  - **Root-cause analysis section:**
    - the method as choice chips, locked once causes exist;
    - the method's branches side by side, each with the causes recorded under it: cause, process, who it is attributed to, and what was found;
    - "add a cause" per branch, opening a dialog with the cause, the process (pre-chosen when there is only one), the attribution (the organisation, or the issue's client or supplier) and what was found;
    - when set-up is missing, a note listing what is missing.
  - **Evidence & documents:** the shared documents panel.
- **Admin → Quality set-up:** two groups of lists.
  - **Raising issues:** statuses, detection sources, issue types and action types.
  - **Root-cause analysis:** methods with their branches managed inline, causes added under a branch, and processes added with their owner.
- **System map:** root-cause analysis and evidence are listed as working.
