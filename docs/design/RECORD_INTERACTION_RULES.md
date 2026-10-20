# IOETI Interaction Architecture — record workspaces, actions and layers

**Decision:** Keep the existing top-level navigation and original module switching exactly as it is. Redesign **what happens after taking an action inside a module**. This explicitly corrects the mistaken proposal for a new journey-based global navigation.

Version: 2026-10-19 · Applies to every new custom UI surface.

## The rule: interaction follows the task's complexity and user context

| Surface | Use when | Examples | Avoid |
|---|---|---|---|
| **Full record page / workspace** | Identity, relationships, multiple sections, links to other workflows, persistent URLs, return/resume context | Account profile/360, Lead profile, Opportunity detail, Contract, Certification cycle, Cohort, Placement, Donor | Do **not** use a sidebar drawer for "View details" |
| **Full task page / guided wizard** | High-stakes multi-step creation or decision, dependencies, large attachments, audit trail, validation/approval | ISO certification decision, complex quote builder, contract review, training registration batch, recruitment placements, financial reconciliation | Long multipage wizard inside a small popup |
| **Centered modal / dialog** | Focused, bounded, reversible action with a small number of fields | Rename opportunity, confirm abandon, attach a single label, choose an assignee | Displaying whole Account 360, tables, finance and history |
| **Popover / anchored menu** | Short selection in the immediate context; no sustained workflow | Sort, compact filters, view presets, quick actions | Critical multi-step workflows and heavy content |
| **Inline editing** | Safe single-value change with immediate context and validation | Internal description, low-risk alias, simple note | Legal decisions, pricing approvals, irreversible operations |
| **Side panel / drawer** | Optional *transient* comparison or preview without losing a working list, with no full-record complexity | Quick note, related entity peek, background filter builder | **Record Details** of Accounts, Leads, Opportunities and domain aggregates |
| **Toast / snackbar** | Status feedback only, with optional Undo where safe | Saved, copied, synchronized | Confirmation of a legal/financial action |
| **Persistent inline alert** | Error/warning that must remain while the user corrects data | Validation issues, auth denied, stale-version conflict, required document absent | Brief ornamental feedback |

## Design principle: context → decision → action → result

1. List pages optimize *finding* the right work item with search, sorting, filters and scans.
2. "View details" always navigates to **a full page**, not a drawer. Header answers: Who/what? Current state? Why this matters? What next?
3. A record workspace has a shareable/deep link and breadcrumbs back to source list; respect browser Back/Forward and preserve search state.
4. The profile body surfaces **verified native data** first. Related data must be separately authorized and independently loaded; don't invent "360" data or counts when endpoints are missing.
5. Primary actions are contextual to record status/role/permissions. Large or consequential edits navigate to workflows. Small forms can use a centered modal.
6. Field rules and authorization live on Axelor/IOETI API server, never in UI conditions alone. Always distinguish unauthorized vs offline vs not implemented.
7. Desktop may use multi-column reading, mobile stacks the same semantic hierarchy. A record never becomes a slide-over merely because viewport is smaller.
8. Use semantic focus heading on arrival, keyboard navigation, Enter/Escape where valid, and respect reduced-motion preferences. Dialogs must trap focus when built for production.
9. Keep Light, Dark and Luxury styling through semantic tokens; behavior stays consistent across skins.
10. Persist view-state across navigation. A direct record URL should re-fetch the authorized record rather than trusting previous in-memory list contents.

## Source-driven record template

```text
Existing global App Shell (unchanged)
┌──────────────────────────────────────────────────────────────────┐
│ Back to [source list] / [record]                    record scope │
│                                                                  │
│ [Identity] Account or Lead       [Status]  [Reference]           │
│                                                                  │
│ OVERVIEW   record fields that the IOETI API really returns      │
│   ├─ Entity identity / profile fields                           │
│   ├─ Contextual related work (authorized APIs only)             │
│   └─ Operation timeline and planned flows where real            │
│                                                                  │
│ Contextual actions displayed only when implemented + permitted  │
└──────────────────────────────────────────────────────────────────┘
```

No generic CRUD drawer. No fabricated opportunities, documents, audit visits, invoices, notifications or staff contact data.

## Per-domain UX contract (source-mapping and gap alignment)

| Domain | Record page | Long workflow page / wizard | Small modal / popover |
|---|---|---|---|
| Lead | Lead profile, source, assigned owner, real event history | Qualify / merge duplicates / convert to Opportunity | Assign owner, add small reminder |
| Account / Contact | Account 360, contact role history, group hierarchy | Merge accounts, company onboarding, bulk data corrections | Label, quick note, simple contact link |
| Opportunity | Opportunity workspace, pipeline state, value, documents, next activity | Stage approval, commercial proposal preparation, complex price options | Rename, short follow-up, lightweight owner selection |
| Service / Price book | Product/service profile, pricing/segment scope | Pricing rules, bulk line changes and versioning | Simple category/label change |
| Quote | Quote versions, totals, approvals, customer context | Compose quote, discount approvals, generate bilingual PDF | Copy reference, choose draft template |
| Contract/MOU | Contract record, versions, signatures, renewal, evidence | Legal review, amendment, signature routing | Simple metadata and notification |
| Invoices / Collections | Invoice record, terms, allocations, aging, audit trail | Payment allocation, reconciliation, milestone approvals | Short tag/note only |
| Handover / Project | Engagement workspace, accepted requirements, accountable teams | Handover acceptance checklist / work-plan builder | Simple task assignment |
| ISO Certification | Certification cycle workspace with audit program, independent decision, issued certificates | Stage 1/2 audit, NC verification, impartiality and certification decision | Schedule brief note or filter audit list |
| Field Intervention | Visit record, signed checklist, evidence and assignments | Field-audit checklist and photo/signature evidence | Reschedule short visit only if authorized |
| CAPA / Findings | Finding record, root cause, dates, review/closure history | CAPA investigation and auditor verification | Assign reviewer, due-date choice |
| External Training | Cohort workspace, trainer, participant roster, exam and certificates | Bulk registrations, attendance, assessment, certificate issuance | Mark a simple attendance exception if authorized |
| Recruitment Agency | Client job order, candidate pipeline, placement and guarantee record | Job-order intake, candidate submission, placement verification, replacement case | Stage note or schedule interview |
| Fundraising | Donor/grant/pledge record and contributions history | Grant proposal, commitment approval, receipt issuance | Short follow-up task |
| Marketing | Campaign performance, targeting and attribution profile | Campaign setup, imports, automations | Filter target list, pause with confirmation |
| Document/Knowledge | Document preview/full document page, history, ACL | Create/edit large knowledge article, template builder | Move/link label with safe permission checks |
| Reports | Full-screen analytical workspace with drilldowns | Report designer / export config | Date-range, grouping, metric filters |
| Administration | Business Line, Role, Team, Pipeline and Policy detail pages | Permissions, stage gates, workflow designer, version migration | Small rename, safe toggle, quick choice |

These are UX contracts, NOT claims that their APIs and implementations are already present. See `docs/UX_REVERSE_MAPPING.md` for source-confirmed vs implemented vs integrated-verification statuses.

## Implemented in this revision

- Account and Lead "View details" now render full-width records inside original App Shell.
- Record profiles include explicit field provenance, status, permitted existing source fields, and clearly labeled disconnected sections.
- Browser history deep links of shape `#/accounts/{id}` and `#/leads/{id}`, Back/Forward support, filters retained for return to list.
- BusinessLine record detail also a full page; original sidebar/global module navigation untouched.
- Opportunity create and rename use *centered modal*, not a right-side record drawer.
- Browser Playwright tests assert absence of detail dialog/drawer, direct URLs, Back and mobile record layout.

## Known limits / next work

- Account 360 linked domains are unimplemented in API (contacts, historical opportunities, contracts, invoices, ISO certificates, engagements); do NOT display made-up linked data.
- Real user session/logout/authorization hardening, field scopes, live read-only DTO negative tests and optimistic-concurrency tests remain release gates.
- Complex Opportunity details, Quote, Contract and the remaining business modules need full workspace implementations and secured APIs.
- Server-led search/filter/pagination, scroll position restoration across reload, universal focus-trap modal component, error boundaries and complete keyboard audit remain backlog.
