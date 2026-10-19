# IOETI Full Operating UI Demo — backend integration handoff

**Branch:** `feat/ioeti-opportunity-record-workspace` (Draft PR #8)
**Audience:** Claude/API implementation, IOETI product owner, QA and frontend engineers
**Scope:** custom frontend product preview while backend security and specialized domains are developed independently.

## Explicit architectural boundary

Production (normal Vite build without `VITE_IOETI_DEMO=true`):
- Existing BusinessLine, Lead, Account and Opportunity pages call only the current allowlisted IOETI application DTO endpoints.
- Four specialized Sidebar entries and Settings remain disabled until the backend is authorized.
- `DemoBusinessWorkspace` is lazy loaded only in demo mode, and never invoked in the authenticated real flow.
- No generic `/ws/rest` business data fetching was introduced.

Public demo (Vite build with `VITE_IOETI_DEMO=true`):
- Everything is fictional. The shared app Sidebar/theme/navigation shell is **unchanged** in structure.
- Leads, Accounts, Opportunities and Business Lines use existing `demo.ts` memory fixtures.
- Sixteen operating workspaces use `demoBusiness.ts` (48 cross-linked fictional records), `DemoBusinessWorkspace.tsx` (list/detail/history), and `DemoDomainWorkbench.tsx` (domain-specific interactive simulations).
- `DemoExecutiveOverview.tsx` derives the dashboard from actual in-memory demo state, not random KPI values.
- Changes are local to a browser tab, discarded on refresh; no cookies, credentials, payments, invoices, candidate CVs, real certificates, imports, exports or external API calls.
- Code marks fake outputs and gates explicitly in both Arabic and English.

### Actual preview route map

| Product area | Demo route | Existing secure IOETI API? | Next backend scope |
|---|---|---|---|
| Leads | `#/leads` | Read-only minimal Lead DTO | Qualification, activities, assignment, convert |
| Accounts | `#/accounts` | Read-only minimal Partner DTO | Account 360 / contacts and independently scoped relations |
| Opportunities | `#/opportunities` | GET/list/create/rename DTO; 409 fixed in unmerged Claude PR #6 | Stage gates, authorized contacts, quotes/events |
| Business lines | `#/businessLines` | Read-only DTO | Config versions, team assignments and pipeline designer |
| Quotes | `#/demo/quotes` | NO | SaleOrder / SaleOrderLine / versions, pricing, approvals, bilingual PDF |
| Services & pricing | `#/demo/catalog` | NO | Product/PriceList/Price rules, contract-approved rate schemes |
| Contracts | `#/demo/contracts` | NO | Contract/ContractVersion, legal/signature gate |
| Finance | `#/demo/finance` | NO | Timetable/Invoice/InvoicePayment scoped read/write + accounting decision |
| Projects and handover | `#/demo/projects` | NO | Project/ProjectTask + IOETI Handover bounded context |
| Field visits | `#/demo/visits` | NO | Intervention, checklist, evidence ACL and scheduling |
| Quality/CAPA | `#/demo/quality` | NO | Client findings linked to certification, independent verification |
| Marketing | `#/demo/marketing` | NO | Campaign, TargetList, activity attribution and consent |
| External training | `#/training` | NO | External Course/Cohort/Trainee/Attendance/Assessment/Certificate |
| Client recruitment | `#/recruitment` | NO | ClientJobOrder/CandidateConsent/Submission/Placement/Guarantee |
| ISO certification | `#/certification` | NO | CertificationCycle/Audit/NC/Decision/Certificate, impartiality |
| Fundraising | `#/fundraising` | NO | Donor/Grant/Pledge/Receipt, donor privacy, restrictions |
| Documents | `#/demo/documents` | NO | Record-scoped MetaFile/PrintingTemplate with attachment ACL |
| Automations | `#/demo/automations` | NO | Studio BPM/DMN configured IOETI versioned policy and secure outbox |
| Reporting | `#/demo/reports` | NO | Role-scope reporting DTO and export ACL |
| Administration | `#/settings` (demo only) | NO | Fully custom admin for roles, teams, Lines, workflow, templates, audit |

All deep records have `/<id>` suffix. Some routes use `demo` specifically to prevent accidentally treating unbuilt APIs as real.

## Recommended integration method (NO UI reimplementation)

Build a genuine **application contract layer** before replacing the mock:

1. Define typed request/response DTOs per domain. Source them from the 377-capability and 52 UI/API contract ledgers in PR #7; do not expose whole Axelor entities. Record scope and fields are not optional.
2. Add a domain service/adapter interface with query, list, stage command, related references and activity contracts. `demoBusinessStore` is a UX fixture **not a backend implementation**. Existing custom React components must continue to accept the stable view models; do not move business rules into browser code.
3. Domain command adapters call **only** authenticated `/ws/ioeti/*` endpoints after SEC-001/002/003, with 400/401/403/404/409/5xx and per-field privacy coverage.
4. Stage commands must be server versioned and idempotent where side effects exist. Browser `record.stage++` is strictly a demo simulation and must NEVER be copied to production.
5. Explicitly model external IOETI ISO certification, paid external trainees, agency recruitment and donation/grant management. Do not map those one-to-one onto Axelor internal QMS/Employee training/Internal Hiring/native Opportunity.
6. Replace each mock surface only after real PG integration/role-negative tests and signed owner rules. Mark independently UI-contract accepted, API-ready and UAT-ready; do not flip everything at once.
7. Keep matching UX journeys: full record pages and high-stakes workflows; modal for quick bounded edits, popover for quick selection, no side-drawer record details.

## Visual and behavior QA gate

- Arabic first with complete RTL; English switching; Dark/Light/Luxury token themes and compact/comfortable modes.
- Mobile navigation and no horizontal overflow at 390px viewport; keyboard focus, closing modal focus return and reduced motion.
- Browser deep links, back/forward across modules, list filters and record context.
- Loading, no-results, forbidden, offline, validation, optimistic conflict and retry states.
- Contract-shaped frontend Playwright tests (without demo mode) + separate `npm run test:demo` for fictional operating flows.
- Real Axelor/PostgreSQL role tests must be tracked separately and cannot be passed by mocked web tests.

## Domain-specific mock workbench scope (not real workflows)

- Quotes/catalog: units/discount and price preview without legal tax treatment or approval rules.
- ISO/field visits/CAPA: review checklist; fake completion never grants a certificate.
- Training: fictional cohort, seats and attendance; no real enrollment, grading or certificate.
- Recruitment: fictional candidate selection gated by fake consent; no CVs or actual sharing.
- Fundraising/finance: commitment vs collected demonstration, not banking or tax receipts.
- Automations: safe dry run with zero actual scheduled or outbound work.
- Reporting: stage distribution counts over fake local data only, never true revenue.
- Administration: role-preview text only; does not enforce/modify native permissions.
- Documents: non-downloadable paper preview without client attachments.
- Remaining modules use generic record stage/history/relationship workflow UI.

## Production no-go

- Do not use demo data to assert any backend capability or customer transaction.
- Do not deploy the current real-mode frontend to production until G-001 to G-014 P0 gates are closed and IOETI business policies are signed.
- Do not publish security-sensitive upstream reproduction details.
- Do not merge Claude PR #6 automatically; it remains independently reviewable.
- Do not alter upstream Axelor or push to main from this UI branch.

### Ownership parallelization

Claude: SEC-001 through SEC-004, secure account relationship DTOs, real domain slices and PostgreSQL CI.
UI branch: full interactive preview, responsive quality, non-fake production contracts, alignment with schema as it arrives.
Mapping PR #7: immutable source evidence, 377 business capabilities, 52 API/UX scopes, negative authorization matrix, production GAP.
Product owners: policies for certification/accreditation, external training eligibility and fees, recruitment replacement guarantees, grants/donations, finance and tax.

**The demo is a UX/acceptance reference, not an implementation declaration.**

## Pipeline board + accessible record navigation (UI-only extension)

- Operating registers offer **List / Pipeline board** views from the same filtered in-memory records. Pipeline columns group cards by the configured stages; cards navigate to full record workspaces.
- **No drag/drop, bulk stage updates, database mutations or live approval actions.** Stage change still requires opening the fictional record, supplying a review note and confirming the simulated transition. Never wire a card movement directly to an Axelor mutation.
- A real backend pipeline must first return role-scoped lists, authorized stage labels, opaque permitted commands and safe aggregates from dedicated `/ws/ioeti/*` DTOs. Use server-validated versions and a 409 conflict contract. The board must not infer rights from fixture states or generic `/ws/rest` entities.
- Search and selected stage are shared by List and Board but reset when changing business domain. Arabic RTL reverses horizontal presentation without changing workflow order. The board scrolls within its own container on narrow screens.
- In a full record, the tab strip supports RTL-aware arrow keys, Home and End with programmatic `aria-controls` relationships. The **Back to register** action returns to the current domain; browser Back still traverses linked record history.
- Test gate: `npm run test:demo` covers board grouping/filtering/deep navigation, shortcut search, tab accessibility, cross-domain filter resets and mobile English view. It remains **demo-only**, never evidence for production roles or API security.
