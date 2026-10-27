# P5b: lead routing by rules and round robin (D-12)

Status: implemented and checked against the real backend.

| Check | Result |
|---|---|
| `scripts/lead_routing_probe.py` (backend CI) | 17/17, complete cleanup |
| `LeadRouterRulesTest` | 4/4 |
| `WorkCalendarTest` | 8/8 |
| Mocked browser suites: `tests/lead-routing.spec.ts` + the admin leave test | 4 + 1 |
| Full mocked + demo suites | 135 + 27; typecheck OK |
| Response targets probe | 13/13 |
| Lead lifecycle probe | 24/24 |
| Pilot smoke | PASS |
| Policy probe | 9/9 |
| Daily work probe | 44/44 |
| Admin probe | 43/43 |
| Marketing probe | 22/22 |
| Migration chain (`scripts/db_migrate.py verify`, with `V026__ioeti_lead_routing.sql`) | 8/8 |
| PII DTO audit | 0 problems |

Changes to existing checks:
- **Marketing probe:** the check on the route endpoint now asserts the new rule. Routing a lead that already has an owner is
  refused with `409 ALREADY_ASSIGNED`; it used to answer "blocked until D-12".
- **Lead-view allow-lists:** the lifecycle probe and the pilot smoke now include `governorate`, a coarse region rather than a
  contact detail.

D-12 (signed 2026-10-25) says:
- Leads are **routed by rules** (business line, governorate, source → team).
- Then **round-robin inside the team, skipping people on leave or at their workload cap**.
- **Nothing is reassigned automatically.**

## The setting (nothing shipped)

`leads.routing`, per business line:
- **rules:** an ordered list. Each rule has an optional governorate, an optional lead source, and a team.
- **workloadCap:** the most open leads one person may hold.

**Validation:**
- When an owner saves the rules, every team and source a rule names must exist (`UNAVAILABLE` otherwise).
- The governorate is one of Egypt's 27, a fixed list of facts (`PolicyCatalog.GOVERNORATES`).

**Editor:** teams and sources are picked from lists and shown by name. Governorates show in Arabic or English.

**A line without rules:** a new lead stays with whoever recorded it, exactly as before. Routing an unassigned lead there is
refused with `422 POLICY_NOT_SET`.

## How a lead is routed

1. **The first matching rule names the team.** A rule matches when its governorate and source match the lead; an empty
   condition matches anything.
2. **Who can receive it.** The team's members who:
   - are active;
   - **belong to the lead's business line** (SEC-003);
   - are **not away today**;
   - hold **fewer open leads than the cap**.
3. **Round robin.** Among them, whoever received a lead from this team **least recently**:
   - people who have never received one come first;
   - ties go by id, so the order is stable;
   - the routing log is the memory.
4. **Concurrency.** Two routings to one team at once are serialized on the team, so they go to two people. Two people routing
   the same lead at once give it one owner; the other gets `409`.
5. **Outcome.**
   - The lead gets its owner and team, and **the person who receives it gets an in-app notice** (`LEAD_ROUTED`).
   - When **no rule matches** (`NO_RULE`) or **nobody can take it** (`NO_ONE_AVAILABLE`), the lead **stays unassigned** and
     **the line's manager is told** in-app (`LEAD_UNROUTED`).
   - Notices name only the lead's number and line.
6. **The routing log.** Every routing is logged (`ioeti_lead_routing`) with:
   - the outcome;
   - the rule's position;
   - the team and the assignee;
   - the policy version;
   - who routed it and when.

**When routing happens:**
- **On intake** (`POST /ws/ioeti/marketing/leads`), when the line has rules. The person recording the lead may tick **"I will
  follow it up myself"** (`keepMine`) to keep it instead.
- **On demand,** for an unassigned lead: `POST /ws/ioeti/marketing/leads/{id}/route`, or the **Route by the rules** button
  on the lead's record.
  - It needs write access to the lead.
  - It answers with the outcome. The lead itself comes back only if the caller may still read it.

**Never reassigned.**
- Routing a lead that has an owner is refused with `409 ALREADY_ASSIGNED`.
- Giving an owned lead to someone else by hand stays closed (`BLOCKED_BY_POLICY`): D-12 says nothing about manual
  reassignment, and who may do it is a role question (D-07).

## Governorate and leave

- **A lead's governorate:** recorded on intake and in the edit dialog (`Lead.ioetiGovernorate`), and shown on the record.
- **A person's leave:** set by an **administrator** on the person's page. The dates are inclusive, and an open end runs on.
  - `POST /ws/ioeti/admin/users/{id}/away`.
  - Each change is in the admin change log (`USER_AWAY`).
  - The end cannot be before the start.
  - Clearing the leave is one click.

## Open points for the owners

1. **Rule order:** the first match wins. Put specific rules (a governorate and a source) before catch-all ones. A line
   without a catch-all rule can leave leads unmatched; they then wait unassigned and the manager is told.
2. **Who sets leave:** administrators only for now. If people should set their own leave, or it should come from an HR
   system, that is a change.
3. **Line membership is required** to receive a line's leads. A team member outside the line is skipped.
4. **Manual reassignment** of a lead that has an owner stays closed until the owners say who may do it.
