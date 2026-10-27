# Wave 2 (part 2): lead qualification and assignment

Status: LIVE_INTEGRATION_PASS and NEGATIVE_SECURITY_PASS on Axelor 9.1.10 + PostgreSQL 16 (`scripts/lead_lifecycle_probe.py`, 24 checks, also in backend CI). Every role used in tests is a fixture; the production role matrix is policy D-07, lead response targets and routing are policy D-12.

## 1. What the slice does

A rep working a lead they may edit can, from the lead page:
- **move it between open stages** (the native lead statuses that are neither *converted* nor *lost*);
- **mark it lost**, with an optional native lost reason and an internal note of at most 500 characters;
- **reopen** a lost lead: it returns to the CRM's default stage and the reason and note are cleared;
- **assign it to themselves**, for example from an unassigned queue.

Every lead view now also carries its stage id and kind (`OPEN`, `CONVERTED`, `LOST`), the lost reason's name, whether it is assigned to the caller, and when it was received (`receivedAt`, the native creation time). The lost note is stored natively (`Lead.lostReasonStr`) and is **never returned** by the API.

A converted lead is final: every command answers 409 `ALREADY_CONVERTED`.

## 2. Native first

| Need | Reused from AOS 9.1.10 | IOETI addition |
|---|---|---|
| Stage move rules: never to converted or lost, never out of converted | `LeadService.kanbanLeadOnMove` | Called with an unmanaged stand-in that carries the target stage. The native method compares it with the stored lead (`leadRepo.find`), so the managed lead still holds the old stage at that moment. |
| Lose: not twice | `LeadService.loseLead` | Reason must exist (422 `lostReasonId`); note length 500 |
| Reopen: default stage, reason cleared | `LeadService.resetLead` | Only a lost lead (422 `NOT_LOST`) |
| Assign to me: not a lost lead | `LeadService.assignToMeLead` | Assigning to anyone else fails closed (D-07, D-12) |
| Stage kinds | `AppCrmService.getConvertedLeadStatus/getLostLeadStatus/getLeadDefaultStatus` | — |
| Stale version / simultaneous commands | `ConflictChecker.checkVersion`; versioned UPDATE | `OptimisticLockConflicts` (409) |
| Native refusals | `AxelorException` | `NativeCommands` (moved to `ioeti-core`): 422 `LEAD_REJECTED`, configuration errors 422 `SETUP_REQUIRED`; the native message is logged with the correlation id, never sent |

One IOETI rule tightens the native one: natively a lost lead can be dragged to another kanban column and keep its lost reason. The API answers 422 `LEAD_LOST` and requires the explicit reopen.

## 3. API

| Endpoint | Body | Success | Refusals |
|---|---|---|---|
| `GET /ws/ioeti/leads/stages` | — | `[{id, name, kind}]` in pipeline order | 403 without lead read access |
| `GET /ws/ioeti/leads/lost-reasons` | — | `[{id, name}]` | 403 without lead read access |
| `POST /ws/ioeti/leads/{id}/stage` | `{version, stageId}` | 200 lead view | 400 no version · 404 missing or outside scope · 403 read-only · 409 stale/concurrent/converted · 422 `stageId` (converted, lost and unknown stages answer identically) · 422 `LEAD_LOST` |
| `POST /ws/ioeti/leads/{id}/lose` | `{version, lostReasonId?, note?}` | 200 | 422 `LEAD_REJECTED` (already lost) · 422 `lostReasonId`, `note` |
| `POST /ws/ioeti/leads/{id}/reopen` | `{version}` | 200 | 422 `NOT_LOST` |
| `POST /ws/ioeti/leads/{id}/assign` | `{version, userId?}` | 200 | 422 `LEAD_REJECTED` (lost) · 422 `BLOCKED_BY_POLICY` for another user |

Stage and lost-reason lists are the lead's own vocabulary (the stage name was already in every lead view), so they follow lead read access rather than separate `LeadStatus`/`LostReason` permissions.

## 4. Security finding fixed on the way (SEC-002 refinement)

In the concurrent queue-pickup test, the losing rep sometimes got **403** instead of 409. `RecordAccess.writable` checks read and then write access with two separate queries. When the winner's commit moved the lead out of the loser's scope between the two, the write check failed on a lead the loser could no longer read. The answer is now **404** in that case (403 stays for a record the caller can still read). The probe accepts 409 or 404 for the loser and fails on 403 or on two owners.

## 5. UI

`apps/ioeti-web/src/LeadQualificationPanel.tsx` replaces the placeholder in the lead page's related section, in real mode, for unconverted leads. It shows stage, received time, ownership and lost reason, plus the move, assign-to-me, lose (reason and note) and reopen actions. A lost lead hides the convert button and says it must be reopened first. Refusals are localized; correlation ids and native messages are never shown. Mocked test: `lead qualification: stage, lose, reopen and assign-to-me…`.

## 6. Not done (policy)

- Response-time targets, timers, escalation, reminders: **D-12**, nothing is computed. `receivedAt` is exposed so a signed rule can be applied without schema changes.
- Routing or reassigning to other people, round robin, territories: **D-12** and **D-07**.
- Production lead permissions: the probe's "own leads plus unassigned queue" rule is a test fixture.
