# Domain gap analysis — IOETI vs Axelor Open Suite 9.1.10

Inputs: requirements spec sections 1–9 (`docs/reference/IOETI_CRM_Requirements_Spec_sections_1-9.md`),
handoff (`docs/reference/IOETI_CRM_MEGA_HANDOFF.md`), source audit (`MODULE_REUSE_MATRIX.md`),
running verification. **Missing input:** spec sections for ISO operations, recruitment,
fundraising, knowledge base, automation, reporting and admin were not provided; those rows rely on
the handoff only.

Effort: S ≤ 2 days · M 3–7 days · L 2–4 weeks (one developer with AI assistance, excluding UAT).

## Highest-risk differences (investigated first)

| # | Domain difference | Why it is risky | What Axelor gives | Gap | Effort |
|---|---|---|---|---|---|
| 1 | **ISO certification of clients ≠ internal quality management** | AOS `quality` models the company's own QMS (Product/System quality improvements); IOETI certifies *other* organisations: audit programme, Stage 1/2, certificate issue, surveillance, renewal, auditor impartiality | `Intervention` (visit lifecycle, assigned auditor, client, contract, offline mobile), `InterventionQuestion` checklists with photo/signature, `QualityImprovement` (type **System**, origin **Customer**) for findings/CAPA, `Contract` renewals | certification cycle entity, client certificate register, surveillance scheduling, NC classification (major/minor) with closure deadlines, auditor competence/assignment rules, certificate verification page | L |
| 2 | **Training for paying external participants ≠ internal HR training** | AOS `TrainingRegister` links to `Employee` only | course category/skill models, `Event` calendar, invoicing, Pricing | trainee entity (non-employee), cohort capacity/min seats/waitlist, registration + payment state, attendance, assessments, certificates with serial + QR, trainer pay | L |
| 3 | **Recruitment for clients ≠ hiring employees** | AOS `JobPosition` belongs to the company's departments | `JobApplication`, `HiringStage` pipeline, CV/skills | client recruitment request (account, positions), placement, fee % / fixed, split payment at start date, replacement guarantee | M |
| 4 | **Per-business-line pipelines** | `OpportunityStatus` is one global list | statuses, probability, kanban | pipeline/stage model keyed by business line, stage gates, rotting | M |
| 5 | **Sensitive-field protection** | field rules not enforced on API reads (SECURITY_MODEL.md) | model/record permissions work | structural isolation of cost/salary/donor/ID data, API hardening | M |
| 6 | **Arabic documents** | AOS HTML printing ignores RTL; AOS has no Arabic strings | shaping OK, RTL UI OK | Chromium renderer service, Arabic templates, translation of used screens | M |

## Full gap list by domain

| Domain (spec §) | Reuse | Gap to build | Phase | Effort |
|---|---|---|---|---|
| Roles, groups, record scopes (§2) | AOP permissions, conditions, roles, MFA | Team hierarchy helper, business-line scope (`User.ioetiBusinessLines`), delegation with auto-expiry, onboarding tour | V1 (delegation later) | M |
| Business lines (§3) | **done**: registry, Opportunity link, seeds, API | per-line fields (Studio json fields or Properties), handover templates, pipelines (#4) | V1 | M |
| Service catalog (§3) | Product, Pricing, PriceList, Pack | business line + delivery mode + deliverables fields; hidden cost (#5) | V1 | S |
| Lead capture (§4) | Lead, Source, Campaign, import | webhook endpoint `/ws/ioeti/leads` (+n8n for ads/WhatsApp), UTM fields | V1 (ads/WhatsApp later) | M |
| Lead lifecycle, SLA, assignment (§4) | LeadStatus, LostReason | MQL/SAL gates with reasons, round-robin/workload assignment, SLA timer + escalation | V1 | M |
| Dedup + Arabic normalisation (§4) | LeadDuplicateService, DuplicateObjects merge | IOETI matcher (normaliser **done**, `pg_trgm` ready), phone +20 normalisation, warning on entry | V1 | M |
| Scoring, nurturing (§4) | manual scoring select, campaigns | rule-based scoring (DMN candidate), sequences | Phase 2 | M |
| Opportunities & pipelines (§5) | Opportunity, events, kanban, forecasting reports | #4, line items before quote (or create draft quote early), competitor field, next-step rule | V1 | M |
| Accounts / contacts (§6) | Partner, contacts, PartnerLink, dashlets | IOETI fields (stars, governorate, branches), certificates held, decision roles, renewal opportunities (120/90/60) | V1 | M |
| Quotes & price books (§7) | SaleOrder versions/templates, PriceList, Pricing formulas, Pack | discount approval matrix, A/B/C options, numbering per line/year, Arabic PDF (#6), send/track | V1 (tracking later) | M |
| Contracts & MOUs (§8) | Contract, ContractVersion, ContractTemplate, generateContractFromOpportunity | IOETI statuses (Legal Review/Sent/Signed), "no Won without signed contract", recruitment terms | V1 | M |
| Payment milestones, invoices, collections (§8) | Timetable → invoice, Invoice, InvoiceTerm, payments, DebtRecovery | event-triggered invoice requests, accounting depth decision, ETA e-invoice | V1 / ETA open question | M |
| Handover & engagement (handoff) | Project, ProjectTemplate, TaskTemplate | handover object + checklist per business line | V1 | M |
| ISO operations (handoff) | see #1 | see #1 | V1 basic, full later | L |
| Training (§9) | see #2 | see #2 | V1 basic (catalog, cohorts, registrations) | L |
| Recruitment (handoff) | see #3 | see #3 | V1 basic | M |
| Fundraising (handoff) | Opportunity pipeline with FUNDRAISING line | donor/grant/commitment/receipt | V1 pipeline only | S→M |
| Documents & knowledge base | DMS, project Wiki | folder conventions, templates library | V1 | S |
| Notifications & automation | mail templates, Quartz, BPM | IOETI rules (SLA, rotting, renewals, collections) | V1 core | M |
| Dashboards & reports | Studio dashboards, AOS reports | role dashboards (rep, manager, GM, finance) | V1 | M |
| Client portal | — (Goovee backend is not public) | custom portal on IOETI APIs | Later | L |
| Commissions | — | rules on collected revenue | Later | M |
