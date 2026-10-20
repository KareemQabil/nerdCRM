# IOETI — next source-driven UI slices (separate from security/backend)

Snapshot: feature base `82fe3e4`; 52 API/UI traces in `UI_API_SURFACE_CONTRACTS.json`. UX owner maintains the existing global Sidebar. Record details belong to full pages, while small bounded actions use centered modal.

## Gate dependency at each slice

1. Confirm native entity/service declarations in pinned source and current API fields.
2. Confirm the backend's effective model, row and field permissions (do not infer from theme/UI).
3. Define a minimal versioned DTO contract in docs, then generate/consume typed frontend client.
4. Implement a complete contextual page or task workflow (not generic drawer).
5. Handle loading/empty/error/403/404/409/retry/keyboard/mobile/RTL and real APIs.
6. Add Playwright contract + negative API tests; do not mark integrated if test is a mock.
7. Update the linked 377-capability entry and UI surface state only with evidence.

## UI execution queue (with concrete source/acceptance)

| Order | Slice | Current source/API evidence | Frontend scope | Blocker / acceptance |
|---|---|---|---|---|
| UI-001 | Opportunity full record workspace | `crm:Opportunity`, `GET /ws/ioeti/opportunities/{id}` and `PUT` rename. PR #6 fixes optimistic 409 | **PR #8 implemented**; full record with reference line stage version, contextual rename modal, Back/Forward/deep link and designed but disconnected timeline/quotes/contracts | Existing UI CI passed. Not merged and no live cross-role acceptance. No fabricated customer/amount/owner |
| UI-002 | Leads Profile qualification | `crm:Lead` read-only minimal DTO; `ConvertLeadWizardService` in pinned AOS | Preserve full Lead profile; show real history and server state transition when available; MQL→SAL→SQL/denied/reject | SEC-001/002/003, authorized Lead activities, owner-defined qualification status and conversion API, negative tests |
| UI-003 | Account 360 | `base:Partner` read-only limited identity DTO; `PartnerLink` source | Expand existing full Account page with independently requested Contacts, Opportunities, Quotes, Contracts, Deliveries and Payments | Each linked section needs separate API permission; never client-fabricate linked amounts/certificate counts |
| UI-004 | Opportunity pipeline and stage task flow | `crm:OpportunityStatus` is native but **not** a versioned per-Line stage system | Kanban/list/saved views, stage gate review wizard for consequential transition | BusinessLine engine / stage schema versions and server transition command; ACL on every Kanban/filter/export |
| UI-005 | Catalog & price preview | `base:Product`, `PriceList`, `PricingRule` | Service record/full pricebook and quote price breakdown wizard | Sensitive margin restricted; effective dates, role discount controls and financial rounding test |
| UI-006 | Quotes | `sale:SaleOrder` and `SaleOrderVersionService` exist | Full quote workspace, pricing + version A/B/C + approval workflow and Arabic/English PDF preview | Quote DTO, discount thresholds, versioned approvals, document renderer, no invented acceptance |
| UI-007 | Contracts | `contract:Contract`, `ContractVersion`, `ContractService` | Full contract record/version/signer workspace, legal approval + renewal | Signed evidence, legal state transitions, attachments ACL, review workflow |
| UI-008 | Finance and milestones | `account:Invoice`, `InvoicePayment`, `supplychain:Timetable` | Scoped invoice list and full invoice record; time-based milestone details, payment reconciliation task | Accountant decides ledger depth; protect financial fields; no duplicated milestone invoice |
| UI-009 | Ops engagement handover | `project:Project`, `ProjectTask` | Full Engagement record, handover approval checklist, assigned-task timeline | Canonical Handover entity and accepted contract/quote/advance gates |
| UI-010 | ISO certification operations | `intervention:Intervention`, `quality:QualityImprovement` only primitives | Full Certification Cycle, Stage 1/2 Audit Wizard, CAPA reviewer, certificate issuance screen | New independent certification domain + impartiality/competence business policies signed off |
| UI-011 | External training | Talent employee-only data isn't valid external learner source | Course, Cohort, enrollment wizard, attendance matrix, assessment, certification | New trainee model, registration capacity concurrency, finance and eligibility policies |
| UI-012 | Client recruitment | Talent internal `JobApplication` is not customer placement | Job order full record, candidate submission privacy flow, placement and guarantee | Separate client order/candidate consent/placement domain and fee policy |
| UI-013 | Fundraising | `Partner` and `Opportunity` are generic foundation only | Donor/Grant/Pledge full records, restricted finance ledger and stewardship | Signed grant policy, donation receipt/accounting treatment and strict PII/finance scopes |
| UI-014 | Admin, automation, reporting | Studio/Utils source catalog exists; no custom operational admin | Original navigation + custom BusinessLine stages, role simulator, workflow/alert admin, reports | Role/line authorization; no arbitrary scripting; metrics must be backed by real data |

## Explicit interaction decisions

- **List → View Details:** full record workspace (Account/Lead/Opportunity/Contract/ISO/Cohort/Placement/Grant).
- **Single bounded edit:** centered modal (rename/tag/follow-up brief).
- **Short contextual choice:** popover (sort/filter/assignee chooser).
- **High-stakes multi-step:** full workspace/wizard (Quote Approval, ISO Decision, Candidate Submission, Donation Receipt).
- **Informational result:** toast, not a substitute for validation.
- **Permission failure or stale conflict:** persistent localized inline alert with safe recovery.

## Continuous verification and no-go states

- `BASE_READONLY` does not mean complete Account/Lead management.
- `DRAFT_PR8` denotes implemented UI pending review, not deployment to authorized real users.
- A source file name's existence doesn't prove compliance with IOETI requirements.
- Public Vercel preview uses fictional memory-only examples.
- All real-client pages must be blocked until Claude's SEC-001+SEC-002+SEC-003 gates pass, with explicit field scopes and cross-user negative tests.
- User requirements for standards/accreditation/financial/legal policy missing after SPEC §9 remain owner decisions, not developer invention.
