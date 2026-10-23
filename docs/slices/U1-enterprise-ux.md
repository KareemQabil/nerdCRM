# Enterprise UX polish of every live screen

Status: implemented and checked against the real backend:
- the fictional showcase dataset, screenshots in all three themes, desktop and 390 px;
- the mocked browser suites (64 + demo 24);
- the live browser scenario S7;
- S1 with the new reviewer-queue check.

## 1. Screen inventory (live mode)

| Section | Screens |
|---|---|
| Workspace | Overview (cockpit) · Inbox · Reports · Knowledge base |
| Sales | Leads (list, follow-ups, intake, lead record with qualification, consent, attribution, timeline, documents, outbox, mentions, conversion wizard) · Accounts (list, account record with Account 360, contacts, opportunities, money by stage) · Opportunities (list, create/rename, opportunity record with quotations, versions, review, milestones, invoice requests, contract, contract review, renewal, documents) |
| Delivery & services | Operations (handover requests, checklist review, engagements and tasks, checklists) · Certification (cycles, audits, findings, auditor competence) · Training (courses, cohorts, enrolment and waitlist, sessions, attendance) · Recruitment (job orders, candidates, consent, pipeline, interviews, offers, placements) · Fundraising (overview, donors, grants and commitments, installments, collections, deliverables, stewardship) |
| Administration | Business lines · System map · Design system · Settings (preferences, lead sources, system page for administrators) |

## 2. What changed

**Shell**
- Navigation is grouped by how people work: their day, selling, delivering, administration.
- Each section has its own accent in all three themes (light, dark, luxury), used on the active item, page headers, icons and tables.
- The top bar shows the signed-in person's name.

**Colour and surfaces**
- Solid surfaces with soft elevation instead of glass.
- Stronger text contrast.
- Readable sizes: 13.5–14 px body text and tables.
- Calmer primary buttons, segmented tabs, and empty states that point to the next step.

**Page headers**
- Each header says which section the page belongs to and what it is for.
- Module ids, engine names ("Axelor", "SaleOrder", "Timetable", "Partner") and decorative icon tiles are gone from every live screen.
- Native stage names are shown in Arabic.

**Home cockpit**
- **The person's own day:** unread notices, overdue and planned follow-ups, reviews waiting for them, and handovers awaiting review.
- **The rest of the page:**
  - the open pipeline per stage, with money per currency, never added together;
  - the lead funnel;
  - service activity.
- Every figure comes from the server. A section the person may not read is left out, never shown as zero.

**Reviewer journey (new)**
- New endpoint: `GET /ws/ioeti/workspace/reviews?pending=true` returns the pending reviews the caller may see and did not request.
- The cockpit lists them, linked to the opportunity.
- On the quotation, the reviewer sends it back with a reason; the owner is notified in the app.
- Approve and reject stay blocked by D-11.

**Other fixes**
- **Training:** Arabic course names; an explanatory panel until a cohort is chosen.
- **Reports:** business line names instead of codes.

## 3. Backend coverage (audit of 210 endpoints)

- **182** are used by the UI.
- **22** are policy-blocked on the server (D-02, D-03, D-04, D-05, D-06, D-07, D-10, D-11, D-12). Each one shows a disabled action or a note naming the decision.
- **The 6 working ones without a screen:**
  - "send back for changes": done in this slice;
  - single quote, contract and document detail reads: the record pages already show this data;
  - the business-line detail endpoint;
  - the administrators' identity-boundary diagnostics.

## 4. Follow-ups (not in this slice)

- **System map (Administration):** it is an early design artefact whose ~56 stage descriptions print endpoint paths, about 30 of which do not exist. Rewrite it from the coverage audit, or retire it.
- **Small UX gaps:**
  - a course filter on the cohort list (the server supports `courseId`);
  - catalogue paging beyond 50 products;
  - an administrators' security-diagnostics card in Settings.
- **Showcase data:** `scripts/showcase_seed.py` creates it and removes it completely. Policy-blocked states appear only with `--demo-states`, and only on demonstration databases.
