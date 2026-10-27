# A12: field visits and quality on the shared surfaces

Status: implemented and checked against the real backend:
- `scripts/cross_domain_probe.py` 6/6 (in backend CI);
- the full local regression;
- a mocked browser test in `tests/daily.spec.ts` (7/7 in that file).

A7–A11 built field visits, checklists, quality issues, corrective actions and root-cause analysis as their own screens. Before this slice, only planned visits showed up anywhere else (the agenda). A12 wires them into the surfaces people already use every day. Nothing new is decided here; each surface shows only what the caller may read.

## What changed

| Surface | Before | Now |
|---|---|---|
| **My agenda** (`GET /ws/ioeti/workspace/agenda`) | activities, sessions, audits, interviews, my visits | also **open corrective actions I own falling due in the range**, as all-day items linked to their quality issue (overdue ones flagged in the UI) |
| **Search / Ctrl+K** (`GET /ws/ioeti/workspace/search`) | leads, accounts, opportunities | also **field visits**, by reference or by the client's name, and **quality issues**, by reference or title |
| **Account 360** (`GET /ws/ioeti/workspace/account360/{id}`) | opportunities … donor profile | also the client's **field visits** and **quality issues** (client or supplier), with links |
| **Report areas** (`GET /ws/ioeti/reports/areas`) | training … funding | also **field visits** and **quality issues** created in the period |

## Rules

- **Native permissions decide.**
  - A surface shows visits only to callers with read access to the native intervention, and quality issues or actions only to callers who may read them.
  - Without that access, the section or area is **left out, never shown as zero**, as for the other domains.
- **A corrective action is seen through its issue.** An action appears on the owner's agenda only if they may read the quality issue it belongs to.
- **Search does not leak through names a caller cannot read.** A visit matches its client's name only if the caller may read that client. Otherwise only its reference matches, and the hit shows the reference.
- **Agenda contents.**
  - The agenda lists only open actions due within the chosen range (at most 62 days).
  - A done or cancelled action leaves it.
  - Overdue work stays on the quality page's "mine" list.
- **Only product (system) quality issues are counted.** Product-quality records stay in the native screens.

## Checked live (`scripts/cross_domain_probe.py`)

1. My agenda has my visit and the corrective action falling due in the range, linked to its issue, and not the one due later.
2. A done action leaves the agenda. A reader without visit or quality rights has neither in theirs.
3. Search finds the client, its visit (by the client's name) and the quality issue (by its title). A visit is also found by its reference.
4. A reader without visit or quality rights finds the client account only.
5. Account 360 counts the client's visits and quality issues. For a reader without those rights the sections are left out, not zero.
6. Report areas count visits and quality issues in the caller's scope, and leave them out for a reader without rights.
