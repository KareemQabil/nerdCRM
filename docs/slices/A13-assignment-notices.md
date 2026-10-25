# A13: in-app notices for visit and quality assignments

Status: implemented and checked against the real backend:
- `scripts/cross_domain_probe.py` 9/9, three of them new (in backend CI);
- the full local regression;
- a mocked browser test in `tests/app.spec.ts`.

Field visits and corrective actions are assigned to people (A7, A8). Until now, those people only found out by looking. The platform already had an internal notice channel (Wave 7b), used for handovers, engagement leads and requested changes. A13 uses the same channel for visits and quality.

## What is noted, and for whom

| When | Who is told | Notice kind | Links to |
|---|---|---|---|
| A visit is created or planned for someone | the assignee | `VISIT_ASSIGNED` | the visit |
| A planned visit is moved to someone else | the new assignee / the previous one | `VISIT_ASSIGNED` / `VISIT_UNASSIGNED` | the visit |
| A planned visit's time changes, same assignee | the assignee | `VISIT_RESCHEDULED` | the visit |
| A visit is cancelled | the person it was assigned to | `VISIT_CANCELLED` | the visit |
| A corrective action is added with an owner | the owner | `QUALITY_ACTION_ASSIGNED` | the quality issue |
| A quality issue's plan gets a new owner | the new owner | `QUALITY_PLAN_ASSIGNED` | the quality issue |

The inbox also gains a label for the existing `ENGAGEMENT_ASSIGNED` notice, which had shown its raw code until now.

## Rules

- **In-app only.**
  - Nothing is sent by e-mail, SMS or chat (D-10).
  - Nothing escalates on a timer (D-12).
  - Notices are written inside the same transaction as the change, so a refused or rolled-back change leaves no notice.
- **Nothing is noted for oneself.** A visit or an action you assign to yourself creates no notice. Neither does a notice to a blocked user. This is the existing notifier rule.
- **Titles carry only the reference** ("Visit VIS-0007", "Quality issue QI-009"). They never include client names or issue text.
- **Opening a notice applies the recipient's own permissions.** The notice only links to the record.

## Checked live (`scripts/cross_domain_probe.py`, new checks)

1. A colleague is told, in order, when a visit is assigned to them, rescheduled, moved to someone else, given back and cancelled.
2. A colleague is told when a corrective action or the issue's plan is assigned to them. The title is the reference only.
3. Nothing is noted for what people assign to themselves.
