# P5a: lead response targets in working hours (D-12)

Status: implemented and checked against the real backend.
- `scripts/lead_response_probe.py` passes 13/13 (backend CI) with complete cleanup.
- `WorkCalendarTest`: 8/8.
- Mocked browser suite `tests/lead-response.spec.ts`: 4/4, including axe (WCAG 2.1 A/AA, light and dark) on the status chips.
- Full mocked + demo suites: 130 + 27; typecheck OK.
- Still passing: the lead lifecycle probe (24/24) and the pilot smoke test. Both allow-lists of lead view fields now
  include `response`, and the lifecycle probe also pins that object's own keys.
- Migration chain: `scripts/db_migrate.py verify` 8/8 with `V025__ioeti_lead_response.sql`. PII DTO audit: 0 problems.

D-12 (signed 2026-10-25) says:
- **Response-time targets are settings per line and source, counted in working hours.**
- When a target is missed, **the line's manager gets an in-app notice and the lead is flagged overdue**.
- **Nothing is reassigned automatically.**

Routing (rules, round robin, leave and workload cap) is the next slice, P5b.

## The settings (nothing shipped)

| Policy | What it holds | Scope |
|---|---|---|
| `work.calendar` | Working days, the hours of a working day, public holidays | Company |
| `leads.response-target` | First contact within N working hours; optionally, qualification within M | A line *and* a lead source (`LINE/sourceId`), a line, or the default |

**Which target applies to a lead.** The most specific value applies, and it applies whole:
1. the value for the lead's line and source;
2. otherwise, the line's value;
3. otherwise, the default.

A line-and-source value without a qualification target means that lead has none.

**The policy editor** offers the source as an optional second choice once a line is chosen. A per-source value reads as
"ISO9001 · Website".

**Effective dates.** Targets are read **as they were when the lead arrived** (owner principle P.3).
- A lead that arrived before the policies took effect has no timer. Setting the policies does not flood managers with
  misses on old leads.
- Without working hours, or without a target for the lead, its status is **`NOT_SET`**, with the missing policy named. A
  missing setting never reads as "on time".

## How a lead is measured

- **Received:** when the lead was created.
- **First contact:** the first *completed* activity on the lead: a logged call, meeting or note, or a follow-up marked done.
- **Qualification:** the lead's conversion into an opportunity.
- **Deadline:** received + N **working hours**.
  - Time outside working hours, non-working days and holidays does not count.
  - A lead arriving an hour before closing is due the next working morning.

| Status | Meaning |
|---|---|
| `DUE` | Open, not contacted yet, deadline ahead |
| `OVERDUE` | Open, not contacted, deadline passed |
| `MET` | Contacted by the deadline |
| `LATE` | Contacted after the deadline |
| `CLOSED` | Converted or lost without a recorded first contact: the clock stops, never overdue |
| `NOT_SET` | No working hours, or no target for this lead |

Every lead view (list, record, search) carries this as `response`. It holds statuses and times only, no contact details.

## Missed targets

A native schedule runs **every 15 minutes** (`LeadResponseJob`, registered by V025). An administrator can also run it on
demand: `POST /ws/ioeti/leads/response/check`.

For each open lead whose deadline has passed without contact (or without conversion, for qualification), it:
- records the miss **once** per lead and target in `ioeti_lead_response_miss`, together with:
  - the due time;
  - both policy versions;
  - the manager notified;
- sends the line's manager **one in-app notice**: `LEAD_FIRST_CONTACT_OVERDUE` or `LEAD_QUALIFICATION_OVERDUE`. The notice
  names only the lead's number and line, never the person.

What it never does:
- **send anything outbound;**
- **change the lead's owner.**

A lead contacted later becomes `LATE`: it leaves the overdue list, and its recorded miss stays.

The check costs nothing until the owners set working hours: it starts from the first working-hours version's date.

**`GET /ws/ioeti/leads/overdue`** lists the overdue leads **the caller may read**:
- a rep sees their own;
- a manager with the line's read rights sees the line's.

## Screens

- **Lead list:** a "Response" column with the status chip. Sorting by it puts overdue leads first.
- **Lead record:** the status, the first-contact deadline, when contact happened, and the qualification deadline when there
  is one. A note says misses notify the line's manager and nothing is reassigned.
- **Inbox:** the two new notice kinds, in Arabic and English.
- **Notes updated** where they still said response targets were waiting: the leads page, the follow-ups queue and the system
  map. Routing to others stays marked as waiting.

## Open points for the owners

1. **What counts as first contact:** the first completed activity on the lead. A different rule (only calls, or only
   outbound contact) is a change in `LeadResponse.firstContact`.
2. **What counts as qualified:** conversion into an opportunity. If a stage should count instead, the owners name the stage.
3. **The line's manager** (Business line › Manager) is who is notified. A line without a manager has its misses recorded
   with nobody notified.
4. **The check runs every 15 minutes**, so a miss is noticed up to 15 minutes after its deadline.
