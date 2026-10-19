# IOETI — reverse-mapped lifecycle / journey contracts

Every chain below describes expected IOETI product behavior based on SPEC §§1–9 and HANDOFF §§6–14; source reuse is identified but **any absent execution logic must be implemented**, not assumed.

## 0. Cross-cutting record/action invariants

- Every record must have stable ID, creation/update actor and timestamp, responsibility, business-line relationships, record-scope access and audit events.
- Every state transition MUST be a server command with `expectedVersion` or equivalent concurrency guarantee; JPA rollback must preserve integrity. Do not treat status field editing as a workflow.
- Every operation must check business line, role, own/team/line/all, sensitive field scope and linked-entity permission independently.
- Every outbox/batch job is idempotent and replay-safe; scheduled jobs cannot create duplicate invoices/certificates/notifications.
- Every dependent record has canonical parent(s), versioned commercial origin, linkage and deletion/archive policy.
- UX top-level global sidebar remains unchanged; full record details get full pages; small bounded action modal; complicated decisions wizard/task page.

## 1. Marketing → Lead → Sales acceptance → Conversion

```text
Campaign / referral / form / inbound event
   └─ intake validate + consent + source dedup
       └─ Lead New → Working → MQL
           ├─ Nurturing / Unqualified / Duplicate / Lost (reason mandatory)
           └─ Handed to Sales [SLA clock]
               ├─ Rejected [reason + return to queue]
               └─ Accepted (SAL) → Qualified (SQL)
                   └─ Convert once → Partner(Account) + Contact + Opportunity
```

Existing: `Lead`, `LeadStatus`, `LostReason`, `Source`, `Campaign`, `Event`, `ConvertLeadWizardService.generateDataAndConvertLead`, `DuplicateObjectsService`. IOETI missing: per-line enrichment, provenance, +20/Arabic fuzzy matching policy, MQL/SAL hard gates, business-hours SLA, capacity-aware assignment, consent logging, multi-line conversion, idempotency. UX: Lead Inbox → **full Lead profile** → contextual qualification/full conversion wizard. Tests: duplicate conversion requests, forbidden team, target-account duplicate, activity/attachment preservation and SLA clock behavior.

## 2. Opportunity → Quote → Contract → Payment → Operations

```text
Opportunity (account + contact + business line)
   ├─ stage: configured per line with probabilities and gates
   ├─ products/services (with pricing policy)
   ├─ next step, owner, linked activities
   └─ Draft Quote(s) A/B/C → Approval → Sent → Accepted
       └─ Contract/MOU → Legal review → Signed
           ├─ Milestone: signature / stage completion / cohort / placement
           └─ Invoice request → Invoice / payment → receipt/reconciliation
               └─ Accepted Handover → Engagement → Operations task plan
```

Native: `Opportunity`, `SaleOrder`/`SaleOrderLine`/`SaleOrderVersionService`, `Product`/`Pricing`/`PriceList`, `Contract`/`ContractService`, `Timetable`/`TimetableService`, `Invoice`/`InvoicePayment`, `Project`/`ProjectTask`. Gaps: configurable stage machine, discount approval, quote alternatives, bilingual RTL docs, idempotent stage-triggered milestone, scope-specific finance visibility, explicit Sales→Ops acknowledgement. UX: full Opportunity profile; full Quote Builder and Legal Review; centered Modal ONLY for tiny rename/tag; Contract and Engagement each full records. Tests: stage-gate bypass via direct API rejected, stale update 409+no DB change, duplicate invoice jobs, finance-only costs, account-link permissions.

## 3. ISO initial certification / surveillance / renewal

```text
Won commercial agreement
   → Certification Cycle (client + scheme + scope + sites)
   → Auditor competence + impartiality validation
   → Audit program & estimated audit days
   → Stage 1 visit/review → Stage 2 authorized
   → Stage 2 visit/checklists/evidence
   → Findings / major-minor NC → client CAPA
   → Independent technical review
   → Certification decision (grant/refuse/suspend/withdraw)
   → Registered certificate/serial/revision/validity
   → Surveillance visits → Recertification → Renewal commercial opportunity
```

Native field primitives: `Intervention` (start/plan/suspend/finish), `InterventionQuestion`, `InterventionRange`, `QualityImprovement`, `QIAction`, `QIResolution`, `Contract`. **Not native:** client CertificationCycle, audit scheme/scope, independent reviewer, impartiality gate, public certificate lifecycle/registry and surveillance programme. Source quality module is company-internal QMS; don't simply flip a field called "certified". UX: full Certificate Cycle workspace with section timeline; full Audit Plan/Checklist/Decision Wizard; assignment modal only if brief/low risk. Tests: same auditor cannot self-certify if policy disallows; invalid/expired competence and conflict; no certificate before approved review; suspension status; cancelled audit not invoiced twice. **Owner decision:** authoritative scheme and accreditation procedures must be supplied; no invention.

## 4. External training delivery

```text
Course catalog / client TNA
   → Training proposal or public registration
   → Cohort (dates / capacity / trainer / venue / mode)
   → External Trainee registration / waiting list
   → Payment/confirmation + capacity reservation
   → Sessions and attendance / assessment
   → Eligibility rules and validated issue request
   → Training Certificate serial/PDF/reissue/revoke
   → Feedback/NPS → Alumni follow-up
```

Native: `Training`/`TrainingSession` and `TrainingRegister` for employees **not valid as direct external attendee model**; use `Event`, `Project`, `Invoice`, `PriceList`, `PrintingTemplate`, resources selectively. New: `Trainee`, `Course`/catalog or controlled map, `Cohort`, `Enrollment`, `Attendance`, `Assessment`, `TrainingCertificate`, cancellation/refund actions. UX: full Course and Cohort workspaces; multi-step Registration (batch wizard); attendance matrix; certificate approval issuance workflow. Tests: two concurrent registrations cannot exceed capacity; absent/outstanding attendance cannot issue certificate; identity data redacted from ordinary sales; refund and cancellation balances reconcile.

## 5. Agency recruitment for external client

```text
Client + signed recruitment terms
   → Client Job Order → positions and requirements
   → Candidate pool + explicit sharing consent
   → Screening/rubric → Client submissions → Interview
   → Offer / acceptance → Placement verified start
   → Placement-fee invoice request/milestone
   → Guarantee window → replacement claim or closed
```

Native `JobPosition` and `JobApplication` are for internal hiring; `JobApplicationService.createEmployeeFromJobApplication` demonstrates the mismatch. Reuse candidate/stage abstractions selectively, **not** internal employment/payroll logic. New: client job order, candidate privacy record, submission per client, placement, guarantee claim. UX: full client Job Order and Candidate profiles with isolation; full placement and guarantee workflow; quick interview scheduling popover only for small choice. Tests: candidate CV and salary visible only to authorized recruiters/client contacts; sharing requires consent; duplicate placement fee requests denied; guarantee period computed from actual accepted date per signed terms.

## 6. Fundraising / partnerships

```text
Donor / sponsor account → researched prospect
   → contact and proposal → commitment/pledge agreement
   → installment or donation receipt → restricted use if applicable
   → grant deliverables / stewardship reporting → renewal
```

Native `Partner`, `Opportunity`, `Campaign`, `Contract`, `Event`, `Timetable`, `InvoicePayment` may provide primitives. No confirmed dedicated grant/pledge/restricted-fund ledger exists in pinned AOS. New donor segmentation/profiles, grant, pledge, restricted fund accountability, thank-you evidence. UX: donor full record (not a drawer), proposal workflow, sensitive pledge ledger; quick contact follow-up modal. Tests: pledge not counted as cash, gift reversals handled, donor data denied to sales users, finance role aggregation without hidden personal data. **Owner/accountant decision:** legal donation receipt and financial posting semantics.

## 7. Quality/CAPA within external certification

```text
Stage 2 evidence → Finding → Major/Minor NC
   → client root-cause analysis → corrective action + evidence
   → independent verification/reopen
   → closure gate → technical review / certificate decision
```

Native `QualityImprovement`, `QIAnalysis`, `QICause`, `QIAction`, `QIResolution`. New client cycle foreign key, NC classification, client submission role, traceable independent verification and deadline. UX: full Finding profile and CAPA Wizard. Tests: no self-approval, expired deadlines report accurate, read scopes for client evidence and auditor.

## 8. Workflow engine and admin changes

```text
Draft business configuration → Validate schema/policies
   → Preview impact on existing records
   → Authorized approval → Published version
   → Runtime transition gates / job execution
   → Audit / potential rollback-or-migration
```

Studio `MetaJsonModel`, `MetaJsonField`, `WkfModel`, `WkfProcess`, `WkfDmnModel`, `WkfMigration` are **available code**, but IOETI's custom safe admin UX/runtime integration are not complete. Never silently run arbitrary user-supplied formulas/JS. Tests: config publish only authorized, previously created records not corrupted, invalid stage transition rejected, long-running workflow can be migrated or pinned to old version.

## 9. Reporting and trusted metrics

```text
Source facts (Lead / Opp / Quote / Contract / Invoice / Receipt / Engagement)
   → ACL-filtered metric projection and consistent event dates
   → saved report views / dashboard
   → authorized exports / traceable reconciliations
```

No mock numbers in connected UI. Ensure `booked` (contract value), `invoiced` (issued invoice), `collected` (cleared receipt), `pledged` (donor commitment) are **not synonyms**. Tests: sum of line items reconciles to report scope, no cross-line row leaks, revoked roles lose export permissions, closed-won not auto-counted collected.

## 10. Data model and API rules for every flow

- Upstream entity extension belongs in `modules/ioeti-*`; do not fork unmodified AOS.
- New bounded context gets its own `ioeti_*` tables with unique keys, optimistic concurrency and explicit migrations.
- Use explicit IOETI APIs (query DTOs and mutation Commands); no direct unrestricted `/ws/rest` from custom frontend.
- Validate at command boundary and again at persistence; no reliance on UI field hiding.
- Every entity and UI design item maps back to a `CAPABILITY_*.csv` ID; unresolved decisions are blocked, not guessed.
- Owner must approve full schema/data retention and release rules in specialized modules.
