# IOETI — priority gap register and hard dependencies

**Scope:** all 377 capabilities in the accompanying CSV ledgers, regrouped here into blocking acceptance packages. P0 is a release blocker, P1 is full-business-operating-system scope, P2 requires owner approval or later roadmap. Evidence is in source index and docs/reference; a native model's existence does NOT close a GAP.

## P0 — release blockers, before shared users/real data

| GAP | Source-backed current state | Missing implementation + explicit acceptance test | Dependent work |
|---|---|---|---|
| G-001 Optimistic stale write semantics | **FIXED in Claude PR #6, not merged into mapping branch base.** Version pre-check uses native `ConflictChecker`; real Axelor/PG CI proves stale rename HTTP 409 and unchanged stored data. Local committed race evidence: 40/40 rounds single winner 200 + loser 409, 20/20 post-restore; 23/23 JUnit. | Merge/rebase consciously and confirm latest head in live environment. Wire two-writer probe into CI, add Rep A vs Rep B (Own/Team scope), test other mutation endpoints and transaction boundaries. | All state-changing commands |
| G-002 Request authentication context isolation | **PR #9 locally evidenced; NOT MERGED; CI pending as reviewed.** Claude inspected exact AOP 8.2.5 sources, introduced an outer servlet filter registered before auth/authorization plus retained JAX-RS defense in depth. Reported zero identity/authorization leakage in multiple >300k mixed-request local runs, 34/34 JUnit and live PG regressions. This is a **bounded test result**, not complete security proof. | Review PR #9, verify GitHub CI and production filter order independently. Test outstanding websocket/background and session-expiry paths; coordinate private Axelor disclosure; do not publicly add exploit recipes. | EVERY API |
| G-003 Field read redaction | Native `MetaPermission` GET leakage reported in existing security probes | Separate protected entities; explicit DTO allowlists; block generic REST for normal users without breaking admin; read/list/export/report negative tests | Finance, HR/candidate, donor, IDs |
| G-004 Complete scoped permissions | Generic model/record rules partial; no verified Own/Team/Line/All custom policy | Effective action matrix per role, cross-team and line tests; deny cross-owner GET/list/update/export and related association leaks | All records |
| G-005 Session, CSRF, logout, cookie policy | Custom UI session controller exists; full authentication protocol not verified | Secure cookie/CSRF strategy, session expiration, logout/revocation, anti brute force, response tests; no secrets in browser storage | Pilot |
| G-006 Error body and API security | Axelor sometimes uses HTTP 200 embedded error; handler may leak internal message | Standard mapped HTTP status, typed stable body, no stacktraces/SQL details to client, correlation ID, unauthorized export tests | Entire UI |
| G-007 Data/financial privacy | Lead/Partner DTO minimal; backend relationships not entirely audited | Explicit sensitivity model including costs, margins, trainee ID, expected salaries, CV, donor/pledge and audit decisions; structural separation + tests | Domain modules |
| G-008 Production DB migration path | Dev schema update and PostgreSQL scripts but no verified production migration chain | Explicit migrations on scratch copy, forward/backward/recovery, no prod `ddl=update`, constraints indexes idempotence | Deployment |
| G-009 Recovery and backups | PostgreSQL compose dev only | Automated encrypted snapshots, restore drill, target RPO/RTO, offsite retention and disaster runbook | Staging/production |
| G-010 Controlled first pilot | UI demo uses fake memory data; partial integration | End-to-end actual Axelor/PostgreSQL with 2+ users (allowed/denied), create/read/change/reload, AR/EN/mobile, negative checks, reviewer signoff | Public/product access |
| G-011 Security-sensitive issue handling | Detailed suspected upstream findings currently in repository docs | Coordinate security disclosure privately, sanitize public repro assets; do not publish exploitable details | Release and collaboration |
| G-012 Real ISO decision impartiality | Internal QMS/field visits exist; no external certificate decision | Formal separation auditor/reviewer/issuer, conflict of interest check, role-based denial, approved scheme rules | ISO release |
| G-013 Real recipient separation | Internal employee training/recruitment model exists | External trainee/candidate entities separate from employee HR data, tested privacy boundaries | Training/recruitment |
| G-014 Data provisioning / secrets | Scripts create dev admin, public demo separate | Remove default credentials on shared deployment, rotate secrets, environment boundaries, TLS and access policy | Staging |

## P1 — shared platform engine

| GAP | Concrete deliverables | Acceptance |
|---|---|---|
| G-020 Business Line Engine | Versioned line, membership, service catalog, pipeline stage definitions, dependent policies | Add new ISO scheme *within existing ISO engine* via validated config without Java change |
| G-021 Pipelines and stage gates | Distinct ISO/corporate training/public training/recruitment/fundraising stages, required fields, probabilities, reason, stage versions | Invalid transition rejected at API even if UI bypassed |
| G-022 Assignment and SLA | Team hierarchy, round robin workload, holiday calendar, timers/rotting, escalations, reassign/delegate | Concurrent distribution no double assignment; reminders idempotent |
| G-023 Activities, tasks and timeline | Lead, Account, Deal and Engagement related activity/event links, notes, reminders | Read each linked event only under its own ACL |
| G-024 Handover/Engagement | Typed Handover and Engagement record linking won quote/contract/payment/operations | Sales→Ops signed handover with accept/reject/rework, no orphan jobs |
| G-025 Approvals | Discount, legal, finance, stage gates; delegated and expiry policy | No unauthorized approve or cross-team approve, audit reason/version |
| G-026 Templates and documents | Quote/contract/audit/training/ISO templates with bilingual RTL PDFs; DMS access, versioning | Golden PDF renders Arabic RTL and en/LTR, stores approved revision |
| G-027 Notification + automation | Persisted events/outbox, retries, scheduled jobs, delivery status | At-least-once safe and idempotent processing; no duplicate invoice |
| G-028 Admin operations | Fully custom permissions, business lines, stages, catalogs, templates, audit and job monitors | Business admin performs all daily configuration without opening Axelor UI |
| G-029 Account 360 | Partner hierarchy contacts leads deals quotes invoices project ISO training recruiting fundraiser links | Permission-filtered tabs, role-specific redaction, browser full page not drawer |
| G-030 App DX and CI | Deterministic build Java 21, node frontend; PostgreSQL tests; code quality dependency scan | Green CI on isolated branch and reproducible dev reset, no manual prod secret |
| G-031 Performance/UX/accessibility | Search pagination N+1 load metrics, keyboard focus/mobile tests/theme contrast | Verified live data and no 200/error mismatch, full record routes |
| G-032 Auditing/reports | Event provenance, manager/finance/sales/operations reports, export ACL | Reconcile booked/invoiced/collected; no unauthorized export fields |

## P1 — commercial chain and cross-module lifecycle

| GAP | Source reuse | What has to be built and tested |
|---|---|---|
| G-040 Lead lifecycle | `Lead`, `LeadStatus`, `ConvertLeadWizardService` | New→Working→MQL→Sales Accepted→SQL→Opportunity, side exits/reasons, dedup +20 and Arabic, consent, campaign attribution |
| G-041 Opportunity pipeline | `Opportunity`, `OpportunityStatus`, `Event` | Per-line stages, line items, owner's next step, version consistency, lost reason, activity and cross-line scopes |
| G-042 Pricing and quotes | `Product`, `PriceList`, `PricingRule`, `SaleOrder` | Bilingual services, ISO audit-day tiers, alternatives A/B/C, versions, discount approval, tax/currency, sent/accepted gates |
| G-043 Contracts and MOUs | `Contract`, `ContractVersion` | Legal review, signed doc, amendment, renewal, configurable won requirements; 409 and version tests |
| G-044 Milestones invoices payment | `Timetable`, `Invoice`, `InvoicePayment` | Event-based stages, invoice request decision, installment/payments/overdue/credit notes, finance scopes |
| G-045 Marketing | `Campaign`, `TargetList`, `Lead` | Segments, spend/ROI, inbound forms/refs, events, consent suppression |
| G-046 Ops project scheduling | `Project`, `ProjectTask`, `ResourceBooking` | Handovers, capacity, acceptance tasks, calendars, evidence |
| G-047 Support optional | `helpdesk:Ticket` | Decide if client issue management needed vs customer requests; do not add generic helpdesk just because module exists |

## P1 — specialized IOETI bounded contexts

| GAP | Reuse | New domain and no-go condition |
|---|---|---|
| G-050 Client ISO certification | `Intervention`, `InterventionQuestion`, `QualityImprovement` | New ISO cycle, schemes, multi-site audits, Stage1/2, findings/CAPA, independent technical review, certificate statuses, annual surveillance & renewals. No grant without approval |
| G-051 External training | `Training`, `TrainingSession` only as reference, `Project`, `Invoice` | New Course/Cohort/Trainee/Registration/Attendance/Assessment/TrainingCertificate; no Employee-only foreign key |
| G-052 Recruitment agency | `JobApplication`, `HiringStage`, `Partner`, `Timetable` | ClientJobOrder, CandidateConsent, Submission, Interview, Placement, Fee, GuaranteeClaim, replacement workflow; never infer client from internal department |
| G-053 Fundraising | `Partner`, `Opportunity`, `Campaign`, `Contract` | Donor, Grant, Pledge, RestrictedFunds policy, receipts and donor privacy; pledge not cash received |

## P2 — deferred or owner-dependent (not silently shipped as V1)

Advanced scoring and fuzzy dedup, automated WhatsApp/Meta/LinkedIn, Google/Microsoft calendar and SSO, digital signatures, complex cash forecasts, BI, health scoring, cross-sell, public verification/portals, QR attendance, applicant-trainee cross-sharing, sales commissions, e-invoicing and payment gateways. These are requested/described in SPEC or HANDOFF at varying release priorities; obtain owner sign-off before scope commit.

## Open policy decisions — blockers to unambiguous completion

| Decision ID | Requires confirmation |
|---|---|
| D-01 | Missing requirements chapters ISO, Recruitment, Fundraising, Admin, KB, Automation, Reporting and reference JSON workflow map |
| D-02 | Certification authority, accreditation, impartiality and technical decision rules |
| D-03 | Training threshold, enrollment/payment cancellation terms, certificate revocation and trainee retention |
| D-04 | Recruitment fee, invoice milestone and guarantee policy per contract; candidate consent |
| D-05 | Fundraising donor privacy, receipt/tax treatment, restricted grant accounting |
| D-06 | Accounting depth: invoice request-only vs Axelor ledger posting; ETA e-invoice |
| D-07 | Security scheme: scopes and field policies sign-off by IOETI; retention/MFA |
| D-08 | Production hosting, SSL/domain, timezone, resource budgets, RPO/RTO, backup owner |
| D-09 | Exact V1 acceptance vs P2 deferrals, support/Helpdesk/procurement need |
| D-10 | Legal/scheme requirements for public certificate verification and externally shared data |

## Explicit non-goals

General ERP ledger replacement, payroll, internal HR full suite, video LMS streaming, manufacturing, warehouse, fleet, vehicle maintenance and generic supplier portal are outside the initial SPEC §1 scope. Their files remain indexed in Source Ledger for coverage but are **not automatic features** of this CRM.

## Handoff sequence (no parallel file conflicts)

1. Documentation branch merges/cherry-picks **mapping-only** files and no app code.
2. Claude fixes stale version/HTTP 409 and authorization P0 on its own backend branch.
3. Frontend owner retains native global sidebar and custom full-record UX; tests API contracts against stabilized DTOs.
4. Each domain implementation creates independently reviewed migration, tests, API, UI and evidence; update capability row per proof.
5. Phase acceptance is determined by source + runtime + UAT, not by number of code files written.

Do not treat the P0→P1 migration as a calendar promise. Security must pass before real customer data is introduced.

## P0 engineering status from the stacked Claude PRs (2026-10-19)

This section is appended; the rows above are unchanged. Status reflects live Axelor 9.1.10 + PostgreSQL 16 evidence. PRs are drafts awaiting owner review.

| GAP | Status | Evidence / PR | Remaining |
|---|---|---|---|
| G-001 | Engineering done | #6: 409 on stale and concurrent writes, data unchanged. Also applied to conversion (#18) and quotations (#19). | — |
| G-002 | Engineering done (HTTP, WebSocket, scheduled jobs, expiry) | #9: 0 HTTP leaks under load; #10 branch: 0 WebSocket mismatches, open sockets closed on logout and expiry, Quartz jobs never see a user | Multi-node test at deployment (D-08) |
| G-003 | Partial | DTO allowlists on every IOETI endpoint; contacts expose no e-mail or phone | Field-level policy (D-07) |
| G-004 | Mechanism done | #17: Own/Team/Line/All, 65/65 | Production role matrix (D-07) |
| G-005 | Done except HTTPS | #16: 20/20 plus expiry job | `Secure` cookie test needs HTTPS staging |
| G-006 | Done for `/ws/ioeti` | #15: error contract, oracle removal, generic `/ws/rest` closed | — |
| G-007 | Engineering controls done | Field registry for all 145 REST record fields, CI gate with negative controls (`scripts/pii_dto_audit.py`), log masking of native messages (`PiiMasker`), write-only lost-lead note; `docs/security/PII_CLASSIFICATION.md` | Production log pipeline masking and retention (D-08); field-level role matrix and retention periods (D-07); recruitment/training data (D-03, D-04) |
| G-008 | Engineering done | Platform PR: versioned migrations, verified chain, CI gate | Production run per runbook (D-08) |
| G-009 | Engineering done | Platform PR: encrypted drill 10/10 plus restore boot test | Schedule, off-site copies, custody, RPO/RTO (D-08) |
| G-010 | Ready for reviewer | Multi-user live probes for the whole lead → contract chain; UAT script `docs/runbooks/PILOT_UAT_SCRIPT.md`; fictional dataset `scripts/pilot_readiness.py` setup/check/teardown in backend CI | Reviewer UAT sign-off (D-09) |
| G-011 | In progress | Private disclosure draft held outside the repository | Owner action (see the decisions file) |
| G-012 | Policy-blocked; engineering gate in place | `ioeti-certification` (Wave 4b): decision and certificate fail closed; auditor competence enforced on assignment | D-02 (impartiality: separation of auditor, reviewer and decision maker; certificate rules) |
| G-013 | Training started | `ioeti-training` (Wave 4a): courses, cohorts, capacity and waitlist, enrolment, sessions, attendance; certificates and cohort cancellation fail closed (D-03); `scripts/training_probe.py` | Recruitment bounded context (D-04 for gated parts); training UI; invoicing of enrolments (D-06) |
| G-014 | Partial | `.env` secrets outside git; template documents production settings | Production secret store (D-08) |

P1 progress (appended 2026-10-20):

| GAP | Status | Evidence / PR | Remaining |
|---|---|---|---|
| G-040 Lead lifecycle | Conversion (#18) and qualification done on native `LeadService`: open-stage moves, lose with reason and note, reopen, assign to me; `receivedAt` exposed | `scripts/lead_lifecycle_probe.py` 24/24, `docs/slices/W2-lead-qualification.md` | Response targets, escalation and routing (D-12); duplicate check, consent, campaign attribution |
| G-029 Account 360 | Contacts and opportunities tabs (#18); quotations and contracts on the opportunity page (#19, #21–#23) | lead-conversion and quote probes | Invoices, projects and specialized domains as they are built |
| G-050 Client ISO certification | Policy-independent part built | `ioeti-certification` (Wave 4b): cycles per client and standard, Stage 1/2 programme with qualified lead auditors, nonconformities with response and closure, "ready for decision"; `scripts/certification_probe.py` 18/18 | Decision, certificates, surveillance and recertification (D-02); multi-site sampling; link audits to native `Intervention` for field execution; UI |
| G-052 Recruitment agency | Policy-independent part built | `ioeti-recruitment` (Wave 4D): client job orders, candidates with a write-only restricted profile, consent per job order, pipeline with consent-gated submission, client interviews, offers, placements (one per application, headcount enforced), idempotent fee events; UI `#/recruitment`; `scripts/recruitment_probe.py`; `docs/slices/W4-agency-recruitment.md` | CV/contact sharing, offer terms, fees and invoices, guarantee and replacement (D-04, D-06); reading restricted data (D-07) |
| G-053 Fundraising | Policy-independent part built | `ioeti-fundraising` (Wave 4E): donor profiles on native accounts, write-only sensitive profile, anonymity, grants/donations/sponsorships with stages and native campaigns, commitments with restricted metadata, payment schedules within the commitment, collections against unique bank references (void, never delete), deliverables, stewardship timeline, renewals; proposed/committed/scheduled/collected kept apart per currency; UI `#/fundraising`; `scripts/fundraising_probe.py`; `docs/slices/W4-fundraising.md` | Receipts, restricted-fund accounting, posting and invoicing (D-05, D-06); donor privacy rules beyond anonymity (D-05, D-07) |
| G-054 Handover and engagement | Mechanism built; start gated by D-11 | `ioeti-operations` (Wave 5): per-line handover checklist (configuration), handover of an active contract with snapshot items, rework/reject with reasons, acceptance creating exactly one native `Project` (unique link), native `ProjectTask`s with progress and overdue, ownership transfer, append-only trail; UI `#/operations`; `scripts/operations_probe.py`; `docs/slices/W5-handover-engagement.md` | Contract activation/signature and the handover trigger (D-11); financial prerequisites (D-06/D-11); quote versions, approvals, invoice requests, renewals (Wave 5b) |
