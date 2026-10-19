# IOETI CRM / Business Operating System
## Mega Handoff for the Next Planning / Architecture Agent

> **Purpose of this document**
>
> This is not a final implementation plan and not a frozen architecture.
> It is a complete handoff of where the thinking currently stands so the next agent can continue research, challenge assumptions, compare platforms, and help converge on the cheapest reliable implementation path.
>
> **Primary objective:** deliver a serious, usable, production-ready V1 for an Egyptian non-profit client with a limited budget, while exploiting open-source business platforms and AI-assisted development rather than building a CRM/ERP from scratch.

---

# 0. Executive Snapshot

The client is **IOETI Egypt**, a non-profit working across multiple business/service lines including:

- ISO 9001 certification
- ISO 22000 certification
- Training
- Recruitment
- Fundraising / partnerships
- Potential future certification / consultancy lines

The original requirements document is much larger than a traditional CRM. It describes something closer to:

**CRM + Sales Ops + Quoting + Contracts + Payment Tracking + Operations + ISO/Quality workflows + Training Management + Recruitment + Fundraising + Knowledge Base + Automations + Reporting + Admin Platform**

The strategic realization reached so far is:

> **Do NOT build this from scratch.**
>
> Use an open-source business suite as the business/domain engine, preserve its mature workflows/data model/security/financial objects, expose it through a clean API layer, and build a 100% custom IOETI UI.

The strongest candidates currently are:

1. **Axelor Open Suite**
2. **Odoo Community + OCA**
3. **Frappe CRM + ERPNext + custom Frappe app**
4. **Tryton**
5. **Dolibarr**
6. Secondary / benchmark candidates: SuiteCRM, EspoCRM, CiviCRM, Corteza, Twenty, Apache OFBiz, iDempiere, OroCRM, ERP5, metasfresh.

The current hypothesis is:

- **Odoo + OCA** probably has the largest theoretical domain coverage and ecosystem.
- **Axelor** may be the “dark horse” because many relevant domains appear unified inside the same suite and it is more naturally headless/API-friendly.
- **Frappe** may be the easiest for fast custom domain construction when the prebuilt module coverage is insufficient.
- **Tryton** is a strong clean-core alternative worth benchmarking.
- Final selection must come from a **requirements-to-platform coverage matrix**, not reputation.

Commercial direction currently considered:

- Sell a **V1**, not the entire 451-line vision.
- Target offer around **USD 3,000**, with expected close around **USD 2,500–2,750**.
- Avoid going below roughly **USD 2,000** unless scope is explicitly reduced.
- Internal target: roughly **20–25 focused development days**, with **5–6 calendar weeks** communicated to the client to allow UAT, feedback, deployment, and fixes.

The developer intends to use:

- **Codex** primarily as builder / implementation agent.
- **Claude** primarily as reviewer / architecture / QA / audit agent.
- A structured **JSON source of truth** already exists containing the system map, workflows, scenarios, and possibly domain behavior. The next agent should exploit this heavily.

---

# 1. Original Project Context

The original requirements describe one unified system that IOETI employees use from marketing lead capture through sales, contracting, execution, finance tracking, and follow-up.

The desired system should become the single source of truth for:

- Leads
- Accounts / organizations
- Contacts
- Opportunities / deals
- Quotations
- Contracts / MOUs
- Invoices
- Payments
- Operations handovers
- Engagements
- Training
- ISO certification execution
- Recruitment
- Fundraising
- Documents
- Knowledge
- Activities / tasks
- Reporting

## Core design principles from the requirements

- Arabic-first.
- Full RTL.
- English supported.
- Mobile-friendly because sales/field users move frequently.
- Records should have owner, activity timeline, and audit history.
- Business lines, stages, fields, lists, pricing, and templates should be configurable where practical.
- Data should be self-hostable / owned by IOETI.
- System should be extensible for new business lines later.

---

# 2. The Important Mental Model

Do **not** think of this project as:

> “Build a CRM.”

Think of it as:

> **Build the IOETI Operating System using an existing open-source business engine.**

The custom value should go into:

- IOETI-specific UX
- Arabic/RTL
- role-specific workspaces
- business workflow
- ISO lifecycle
- training lifecycle
- recruitment-for-clients
- fundraising
- dashboards
- mobile experience
- integrations
- automation

Avoid spending the budget rebuilding generic capabilities such as:

- authentication
- user management
- database ORM
- generic contacts
- generic opportunities
- products
- price lists
- quotations
- invoice objects
- payments
- activities
- file attachments
- generic permissions
- generic project/task engine
- generic audit infrastructure
- PDF generation
- basic reporting

---

# 3. Target High-Level Architecture

The favored architecture pattern is:

```text
┌──────────────────────────────────────────┐
│            IOETI Custom Frontend         │
│                                          │
│ Next.js / React                          │
│ Arabic-first / RTL                       │
│ Desktop + Mobile                         │
│ IOETI branding + custom UX               │
└───────────────────┬──────────────────────┘
                    │
                    │ Stable domain API
                    ▼
┌──────────────────────────────────────────┐
│            IOETI API / BFF Layer         │
│                                          │
│ Semantic endpoints                       │
│ Auth/session mediation                   │
│ DTO normalization                        │
│ Workflow actions                         │
│ Frontend/backend decoupling              │
└───────────────────┬──────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────┐
│      Selected Open-Source Engine         │
│                                          │
│ Axelor / Odoo / Frappe / Tryton etc.     │
│                                          │
│ CRM + Sales + Pricing + Contracts        │
│ Projects + Finance + RBAC + Documents    │
│ Native workflows and business logic      │
└───────────────────┬──────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────┐
│           IOETI Domain Extensions        │
│                                          │
│ Business Lines                           │
│ Handover / Engagement                    │
│ ISO Certification Lifecycle              │
│ Training Extensions                      │
│ Recruitment-for-Clients                  │
│ Fundraising                              │
│ IOETI-specific automation                │
└──────────────────────────────────────────┘
```

## Important architecture rule

The custom frontend should **not** bypass backend security.

For example:

Bad:

```text
Frontend fetches all opportunities
→ frontend hides unauthorized rows
```

Correct:

```text
Frontend requests allowed opportunities
→ backend applies ACL/record rules
→ only authorized records are returned
```

The source of truth remains the backend business platform.

---

# 4. Why Build a Custom UI?

The developer is fully comfortable building UI and does **not** need to preserve the original platform interface.

This changes the platform selection criteria.

The selection should prioritize:

1. Domain coverage
2. Reliable business engine
3. API/headless friendliness
4. Security / record permissions
5. Extensibility
6. License
7. Ease of maintaining upgrades
8. Ease of mapping custom workflows

UI attractiveness of the original platform is largely irrelevant.

A valid model is:

```text
Staff:
app.ioeti.org
→ custom IOETI frontend

Admins / emergency backoffice:
admin.ioeti.org
→ native ERP/CRM admin UI
```

Keeping the native backend interface available for administrators is desirable during V1 because not every configuration screen has to be reimplemented immediately.

---

# 5. User Experience Vision

Employees should feel that they are using an IOETI product, not a customized ERP.

Example dashboard:

```text
صباح الخير يا أحمد

12 Lead جديدة
5 محتاجين متابعة اليوم
3 عروض أسعار بانتظار الاعتماد
2 عقد ينتظر التوقيع
1 Audit هذا الأسبوع
```

Possible navigation:

```text
الرئيسية

المبيعات
 ├ العملاء المحتملون
 ├ الفرص
 ├ العملاء
 ├ عروض الأسعار

التنفيذ
 ├ المشاريع / Engagements
 ├ ISO
 ├ التدريب
 └ التوظيف

المالية
 ├ الفواتير
 └ المدفوعات

Fundraising

التقارير

الإعدادات
```

Mobile sales record example:

```text
Marriott Cairo
ISO 22000

آخر تواصل
أمس 2:35 م

Next Step
اتصال اليوم

[ اتصال ]
[ WhatsApp ]
[ إضافة ملاحظة ]

Deal Value
EGP 120,000

Proposal Sent

Timeline
● عرض سعر
● Meeting
● WhatsApp
● Lead converted
```

---

# 6. Core Domain Map

The following domains exist in the requirements.

## 6.1 Identity / Organization / Security

- Departments
- Teams
- Users
- Roles
- Business-line membership
- Record scope:
  - Own
  - Team
  - Business Line
  - All
- Field-level security
- Action permissions:
  - View
  - Create
  - Edit
  - Delete / soft delete
  - Import / Export
  - Reassign
  - Merge
  - Approve
- Delegation
- Audit trail
- optional 2FA
- possible future SSO

This is a critical platform selection dimension.

---

## 6.2 Business Lines

Current:

- ISO 9001
- ISO 22000
- Training
- Recruitment
- Fundraising / Partnerships

Future lines should ideally be configurable without major code changes.

A Business Line may need:

- pipeline
- opportunity fields
- engagement fields
- templates
- pricing behavior
- handover tasks
- status rules
- permissions

---

## 6.3 Product / Service Catalog

Service fields include concepts such as:

- code
- Arabic / English name
- business line
- category
- description
- deliverables
- client requirements
- duration
- delivery mode
- pricing model
- currency
- taxes
- internal cost
- default pipeline
- handover template
- active/inactive status
- bundles

Pricing models may include:

- fixed
- per person
- per day
- quantity tiers
- percentage
- custom
- bundles

---

## 6.4 Lead Management

Sources:

- website forms
- landing pages
- APIs / webhooks
- Meta lead ads
- LinkedIn
- WhatsApp
- email
- calls
- site visits
- events
- Excel/CSV imports
- referrals
- universities / government / partners

Lead lifecycle:

```text
New
→ Working
→ MQL
→ Handed to Sales
→ SAL
→ SQL
→ Opportunity
```

Side exits include:

- Nurturing
- Unqualified
- Duplicate
- Lost

Desired supporting behavior:

- deduplication
- Arabic normalization
- approximate company-name matching
- lead scoring
- round robin
- workload-aware assignment
- SLA
- lead pool
- nurturing sequences
- reactivation
- one-click conversion to:
  - Account
  - Contact
  - Opportunity

---

# 7. Sales Domain

Each business line may have its own pipeline.

Examples:

## ISO pipeline

```text
Qualified
→ Discovery / readiness assessment
→ Proposal
→ Negotiation
→ Contract & Advance
→ Won
```

## Corporate Training

```text
Inquiry
→ Needs Assessment
→ Program & Quotation
→ Negotiation
→ PO / Contract
→ Won
```

## Public Training

```text
Interested
→ Registered
→ Payment Pending
→ Confirmed
```

## Recruitment

```text
Inquiry
→ Requirements Brief
→ Proposal / Fee Terms
→ MOU Signed
```

## Fundraising

```text
Prospect
→ Research
→ First Contact
→ Proposal
→ Commitment
→ Received
```

Pipeline requirements may include:

- probability
- stage gates
- required fields
- max duration / rotting
- auto-created tasks
- playbooks
- next-step requirement
- forecast
- targets
- win/loss analysis

---

# 8. Account / Contact Domain

Account may represent:

- hotel
- resort
- restaurant
- restaurant chain
- tourism company
- transport company
- university
- government body
- donor
- sponsor
- association
- individual trainee

Important concepts:

- parent / child organization hierarchy
- multiple contacts per account
- a contact can relate to multiple accounts
- stakeholder roles
- decision maker / influencer / user / finance
- account owner
- multiple business lines
- certificates currently held
- financial/payment terms
- customer health
- complete account 360

---

# 9. Quotations / Pricing / Commercial Domain

This is a major reason to use a prebuilt business platform.

Desired functionality:

- price books
- customer segments
- versioned pricing
- currencies
- exchange rates
- tax configuration
- quantity discounts
- early bird
- non-profit/university discount
- bundles
- multiple quote options A/B/C
- optional line items
- Arabic / English / bilingual quote templates
- reusable clauses
- dynamic variables
- PDF export
- Word export if possible
- send via email / WhatsApp
- view tracking eventually
- optional electronic acceptance
- numbering/versioning
- approval based on discount limits
- quote statuses
- quote library
- standard quotes
- automatic follow-up

Short-term V1 does **not** need every advanced feature if the commercial engine is stable.

---

# 10. Contracts / MOUs / Payments

Contract types include:

- ISO service contract
- training contract
- recruitment MOU
- sponsorship/donation agreement
- university partnership MOU
- NDA

Desired:

- templates
- merge variables
- start date
- duration
- automatic renewal
- fee model
- guarantee period
- SLA
- signing parties
- draft/review/sent/signed/active/expired/terminated lifecycle
- uploaded signed copy
- renewal alerts
- opportunity gating

Payment schedules may be event-based:

- on signature
- at start
- after audit stage
- before training
- upon candidate start date

Finance tracking:

- invoice request
- invoice metadata
- taxes
- partial payments
- overdue
- receipt upload
- aging
- booked / invoiced / collected revenue

This is tracking, not necessarily a full accounting replacement.

---

# 11. Training Domain

The training section is large enough to be considered its own product.

Types:

- public courses
- in-house
- custom corporate programs
- workshops
- university workshops
- training of trainers
- ISO-related awareness/auditor courses
- online / hybrid
- on-the-job
- assessments

Desired concepts:

## Course Catalog

- Arabic/English title
- category
- level
- hours
- objectives
- content
- prerequisites
- target audience
- delivery modes
- min/max trainees
- prices
- certificate template
- assessment scheme
- learning materials

## TNA

Training Needs Assessment → quotation → annual plan.

## Cohorts / Sessions

- course
- dates
- time
- location / online link
- trainer(s)
- capacity
- min capacity
- status
- schedule conflict
- profitability

## Trainers

- skills
- certifications
- languages
- CV
- ratings
- internal/external
- cost/pay method
- availability

## Trainees

- identity data
- employer
- contact data
- registration states
- waiting list
- payment
- longitudinal trainee profile

## Attendance / Assessment

- attendance
- QR eventually
- minimum attendance threshold
- exams
- grades
- pass/fail

## Certificates

- Arabic / English
- PDF
- serial number
- QR verification eventually
- bulk issue
- issue rules
- reissue / revoke

## Satisfaction

- surveys
- trainer rating
- content rating
- NPS
- quality reporting

---

# 12. Recruitment Domain

Important distinction:

The company recruits **for its clients**, not just internally.

Desired model:

```text
Client
→ Recruitment Request
→ Position
→ Candidate Pool
→ Screening
→ Client Shortlist
→ Interview
→ Offer
→ Placement
→ Guarantee Period
```

Commercial logic may include:

- fee percentage
- fixed fee
- initial payment
- payment at candidate start
- replacement guarantee

A generic internal HR recruitment module can be adapted, but the client/account relationship must be added.

---

# 13. ISO / Quality / Certification Domain

This is one of the most strategically important modules.

Potential lifecycle:

```text
Opportunity Won
→ Signed Contract
→ Advance Paid
→ Handover
→ ISO Engagement
→ Readiness / Stage 1
→ Stage 2
→ Findings
→ Nonconformities
→ Corrective Actions
→ Certification Decision
→ Certificate
→ Surveillance
→ Renewal
```

Potential objects:

- ISO Engagement
- Certification Cycle
- Audit Plan
- Audit Visit
- Auditor Assignment
- Checklist
- Finding
- Nonconformity
- Corrective Action
- Evidence
- Review
- Certificate
- Surveillance
- Renewal Opportunity

Platforms with quality/audit/intervention capabilities receive a major advantage.

---

# 14. Fundraising Domain

Desired pipeline:

```text
Prospect
→ Research
→ First Contact
→ Proposal
→ Commitment
→ Received
```

Objects may include:

- donor
- sponsor
- grant
- fundraising opportunity
- proposal
- commitment
- donation/sponsorship payment
- agreement
- campaign
- reporting

This domain is weaker in many ERP systems except through community modules or dedicated non-profit platforms.

---

# 15. Platform Research Completed So Far

---

# 15.1 Axelor Open Suite

## Why it became a major candidate

Axelor emerged as a strong dark horse because it appears to include a surprising number of relevant domains inside one business suite rather than relying on many unrelated addons.

Observed relevant areas include:

- CRM
- leads
- opportunities
- lead scoring
- duplicate detection
- sales
- quotations
- price lists
- pricing engine
- contracts
- contract versions
- projects
- tasks
- accounting
- payment schedules
- partial payments
- marketing
- campaigns
- recruitment
- training foundation
- quality audits
- interventions / field operations
- surveys
- non-compliance concepts
- documents
- runtime custom fields
- security/roles
- REST-like services

## Particularly interesting for IOETI

### Quality + Intervention

This may map well to ISO auditor work:

```text
ISO Engagement
→ Audit
→ Site Visit / Intervention
→ Checklist / Survey
→ Findings
→ Non-compliance
→ Follow-up
```

### Pricing

The pricing engine may reduce the effort for ISO calculations such as:

```text
base price
+ employee count tier
+ branch count
+ audit days
+ client type
+ discount rule
```

### Contracts

Native contract capabilities may fit quotations → agreement → project → invoice.

### Training / Recruitment

These exist as foundations, though they may be internally-oriented and require adaptation for external clients and external trainees.

## Architectural advantage

Axelor appears attractive for a headless design because of generic REST-like access and runtime model customization.

## Major unresolved concern

**Licensing / edition availability must be verified by actually installing the current open-source/community build.**

Marketing/pricing pages differentiate Community / Pro / Enterprise, while the public codebase exposes many modules.

Do not assume every needed feature is usable free in the exact way we need.

### Required experiment

Install the target Axelor version.

Verify without commercial license:

- CRM
- Sales
- Contracts
- Marketing
- Project
- Quality
- Intervention
- Recruitment
- Training
- Accounting/payment objects
- REST API
- dynamic fields

This is a high-priority PoC.

---

# 15.2 Odoo Community + OCA

## Why it remains a top candidate

Odoo has the largest ecosystem and probably the highest theoretical domain coverage.

Core/community + OCA can potentially cover:

- CRM
- contacts
- sales
- products
- quotations
- invoicing
- payments
- projects
- events
- recruitment
- training/eLearning-related patterns
- surveys
- contracts
- agreements
- donations
- quality / ISO management
- audits
- nonconformities
- documents
- many supporting utilities

## Major jackpot: OCA Management System

OCA has quality / management-system modules related to concepts such as:

- management system
- quality
- audit
- nonconformity
- corrective action
- review
- objectives
- manuals
- procedures

This makes Odoo especially relevant to an ISO-oriented organization.

## OCA donation / association ecosystem

Could support fundraising or nonprofit behavior.

## OCA contract / agreement

Potentially saves significant custom contract work.

## Strengths

- massive ecosystem
- Egyptian / Arabic ecosystem likely easier
- many available developers
- mature sales/commercial behavior
- lots of add-ons
- self-hosted Community

## Risks

- dependency sprawl
- Odoo core + multiple OCA repositories + custom modules
- version compatibility
- mixed addon licenses
- upgrade complexity
- custom API adapters may be required when behavior lives in wizards/views/transient models

## Headless strategy

Do not expose generic Odoo RPC directly to the frontend as the main product API.

Preferred:

```text
Custom UI
→ ioeti_api custom controller layer
→ Odoo ORM/business methods
```

Keep native Odoo UI for admin/backoffice.

---

# 15.3 Frappe CRM + ERPNext

## Why it remains top-tier

Frappe is extremely attractive when we need to create custom business domains quickly.

Potential arrangement:

```text
Frappe CRM
→ Leads / Deals / Contacts / Organizations / Activities

ERPNext
→ Products / Pricing / Quotes / Invoices / Payments

ioeti_core
→ ISO / Training / Handover / Recruitment / Fundraising
```

## Main advantage

DocType-driven development can make custom domain creation very fast:

- data model
- forms
- permissions
- CRUD
- API
- hooks
- admin interface

## Strengths

- Python
- very extensible
- fast custom module development
- strong built-in admin experience
- easy to preserve native admin interface
- good candidate for AI-assisted code generation

## Weakness

Compared with Odoo/Axelor, more IOETI-specific domains may need to be constructed.

---

# 15.4 Tryton

Tryton emerged as another under-the-radar candidate.

Interesting existing areas include:

- opportunities
- sales
- quotations
- price lists
- subscriptions
- projects
- accounting
- quality inspection
- marketing automation
- commissions
- role/security architecture
- API/client ecosystem

## Strengths

- clean modular architecture
- Python
- active project
- less “ecosystem chaos” than Odoo

## Weaknesses

Likely fewer ready-made modules for:

- external training
- recruitment
- fundraising
- ISO certification lifecycle

So the custom-code percentage may rise.

---

# 15.5 Dolibarr

Very interesting if the priority becomes:

> get a usable system deployed with the least complexity possible.

Existing business areas include:

- prospects
- customers
- opportunities
- proposals
- orders
- contracts/subscriptions
- invoices
- projects
- knowledge
- REST APIs

## Strengths

- simpler than larger enterprise suites
- relatively easy hosting
- broad practical SMB coverage

## Weakness

May become less elegant as the system evolves into a highly configurable multi-domain operating platform.

---

# 15.6 SuiteCRM

Useful benchmark because it includes more than pure CRM:

- leads
- contacts
- opportunities
- products
- quotes
- invoices
- contracts

But IOETI-specific domains such as training, ISO, recruitment, and fundraising would require more custom work.

---

# 15.7 EspoCRM

Excellent candidate if the primary requirement were:

> modern CRM backend + custom frontend.

Strengths:

- REST-oriented
- custom entities
- custom fields
- ACL
- developer-friendly

Weakness:

Some advanced workflows and commercial functions may rely on paid packs/extensions, reducing the attractiveness of the “cheap open-source shortcut”.

---

# 15.8 Twenty

Interesting modern developer-first CRM.

Strengths:

- clean product
- custom objects
- API
- modern architecture
- developer experience
- custom UI friendly

Weakness:

Too many of IOETI's core business domains would still need building:

- quotations
- contracts
- payment schedules
- training
- ISO
- recruitment
- fundraising

Therefore it is currently not considered the best shortcut.

---

# 15.9 CiviCRM

Very strong nonprofit domain platform.

Excellent in:

- donors
- donations
- fundraising
- campaigns
- contacts
- memberships
- events
- event registration
- mailings

But weak relative to IOETI needs in:

- sales quotations
- pricing
- commercial contracts
- ISO operations
- recruitment

May be useful as inspiration for the Fundraising module, but probably not as the primary backend.

---

# 15.10 Corteza

Strong open-source low-code platform.

Good:

- flexible data models
- workflows
- RBAC
- API
- rapid custom applications

Weakness:

It gives us a framework more than ready-made IOETI business domains.

We would still model many domains ourselves.

---

# 15.11 Apache OFBiz

Technically powerful.

Relevant areas can include:

- CRM
- product catalog
- pricing
- orders
- contracts
- accounting
- payments
- billing
- inventory
- enterprise services

## Problem

The development stack/complexity is heavier.

For a low-budget Egyptian client, the engineering cost may eliminate the advantage.

---

# 15.12 iDempiere

Enterprise-grade ERP/CRM/SCM.

Strong workflow/accounting foundation.

But the architecture and API interactions may be heavier than necessary for a modern custom frontend on a low-budget project.

Keep as research reference, not current favorite.

---

# 15.13 OroCRM

Potentially good extensible CRM platform.

Worth a small technical check if needed.

However IOETI requires many non-CRM business domains, so the custom percentage may be too large.

---

# 15.14 ERP5

Very powerful and conceptually interesting unified business model.

Potentially supports many enterprise concepts and workflows.

But it is unconventional and likely costly in developer learning/maintenance.

Not favored for this project's economics.

---

# 15.15 metasfresh

Strong ERP, especially operations/logistics/order workflows.

Less direct fit for IOETI's training/ISO/recruitment/fundraising mix.

---

# 16. Current Platform Ranking

Current subjective ranking before a formal coverage audit:

```text
Tier S
1. Axelor
2. Odoo Community + OCA
3. Frappe CRM + ERPNext

Tier A
4. Tryton
5. Dolibarr
6. SuiteCRM

Specialized / Backup
- EspoCRM
- CiviCRM
- Corteza
- Twenty

Heavy enterprise reference options
- Apache OFBiz
- iDempiere
- ERP5
- metasfresh
- OroCRM
```

Do **not** treat this ranking as final.

The next agent should challenge it.

---

# 17. The Most Important Next Research Task

Build a **requirement-level coverage matrix**.

Do not compare products with vague labels such as “has CRM” or “has training”.

Take every meaningful requirement and score every serious platform.

Recommended scoring:

```text
2.0 = native and directly usable
1.5 = native, needs moderate adaptation
1.0 = community/addon or strong reusable foundation
0.5 = generic platform capability; significant custom work
0.0 = must build from scratch
```

Also include a second dimension:

```text
Implementation Difficulty
1 = trivial/configuration
2 = small adapter/customization
3 = meaningful custom module
4 = deep extension
5 = effectively custom build
```

Example:

| Requirement | Axelor | Odoo/OCA | Frappe | Tryton | Dolibarr |
|---|---:|---:|---:|---:|---:|
| Lead | 2 | 2 | 2 | 2 | 2 |
| Lead scoring | 2 | 2 | 1.5 | ? | ? |
| Duplicate detection | 2 | 2 | 1.5 | ? | ? |
| Round robin | ? | 2 | 2 | ? | ? |
| SLA | ? | 1.5–2 | 2 | ? | ? |
| Custom pipelines | 2 | 2 | 2 | 2 | 2 |
| Quotes | 2 | 2 | 2 | 2 | 2 |
| Price books | 2 | 2 | 2 | 2 | ? |
| Advanced pricing | 2 | 2 | 1.5 | 2 | ? |
| Contracts | 2 | 1.5–2 | 1 | ? | 2 |
| Payment schedule | 2 | 2 | 2 | 2 | ? |
| Training | 1.5 | 1.5 | 1 | 0.5 | 0.5 |
| Recruitment | 1.5 | 2 | 1.5 | 0 | 0.5 |
| Quality | 2 | 2 via OCA | 1.5 | 2 | 0.5 |
| ISO audit | 1.5–2 | 2 via OCA | 1 | 1 | 0 |
| Fundraising | 0.5–1 | 1.5 via OCA | 1 | 0 | 0.5 |
| Headless/API | 2 | 1.5 | 2 | 1.5 | 1.5 |

Then calculate:

1. Raw coverage
2. Weighted coverage
3. Custom-code estimate
4. Licensing risk
5. Upgrade risk
6. Developer learning cost

---

# 18. Weighting by Business Importance

Not every requirement is equally important.

Suggested weights:

## Weight 5 — Critical

- Users / permissions
- Leads
- Accounts / contacts
- opportunities
- pipelines
- activities/tasks
- service catalog
- quotations
- contracts
- payment tracking
- handover
- API/headless
- audit trail
- Arabic/custom UI compatibility

## Weight 4 — Very Important

- pricing rules
- approval workflows
- projects / engagements
- ISO audit
- training cohorts
- trainee records
- recruitment request/candidates
- dashboards
- files/documents
- configurable fields

## Weight 3

- marketing campaigns
- lead scoring
- deduplication
- renewals
- fundraising
- surveys
- certificate engine

## Weight 2

- WhatsApp automation
- email sequences
- calendar sync
- electronic acceptance
- advanced forecasting
- NPS
- customer portal

## Weight 1 — Later

- commissions
- e-signature
- advanced certificate verification
- complex cross-selling
- sophisticated health scores

This weighting should be validated with the actual client.

---

# 19. V1 Scope Strategy

The original requirements are too large for a low-budget first delivery.

V1 should answer:

> What makes IOETI able to work from the system tomorrow morning?

Core operational chain:

```text
Lead
→ Opportunity
→ Quote
→ Contract
→ Payment milestone
→ Handover
→ Engagement / Execution
```

Recommended V1 areas:

- users / roles
- leads
- accounts / contacts
- opportunities
- business-line pipelines
- tasks / activities
- services/catalog
- quotations
- basic approvals
- contracts
- payment tracking
- operations handover
- engagement
- basic ISO flow
- basic training
- basic recruitment
- basic fundraising pipeline
- dashboard
- Arabic RTL custom UI
- mobile responsive
- deployment
- backups

---

# 20. Explicit Phase 2 / Deferred Features

These can be deferred unless extremely easy through the selected platform:

- advanced Arabic fuzzy deduplication
- complex lead scoring
- Meta Ads ingestion
- full WhatsApp Business automation
- email nurturing sequences
- Google/Microsoft calendar
- e-signatures
- quote view tracking
- advanced forecasting
- health score
- cross-sell recommendation engine
- QR attendance
- public certificate verification
- NPS automation
- advanced renewal automations
- complex fundraising grant management
- commissions
- full client portal
- deep BI

Do not accidentally promise these inside a cheap fixed-price V1.

---

# 21. Commercial Positioning

The developer wants a price appropriate for an Egyptian client who likely has a limited budget.

The current thinking is:

## Recommended opening offer

**USD 3,000**

## Target close

**USD 2,500–2,750**

## Rough floor

Around **USD 2,000**, and only if scope is explicitly reduced.

Do not sell the entire original long-term specification for USD 2,000–3,000.

Sell:

> **IOETI CRM / Business Platform — V1**

Potential payment structure for a USD 2,750 deal:

```text
$750  project start
$750  core CRM milestone
$750  commercial + operations milestone
$500  UAT + deployment
```

Alternative:

```text
30% upfront
25% after Core CRM
25% after Operations/Commercial
20% after UAT
```

External costs should be excluded or explicitly separated:

- hosting
- WhatsApp API
- SMS
- email sending services
- Meta integrations
- paid platform licenses if ultimately required
- commercial addons
- third-party signatures
- payment gateway fees

---

# 22. Delivery Timeline

Because AI and prebuilt platforms are being used, coding can be fast.

But production delivery still requires:

- integration
- tests
- data migration
- role validation
- UAT
- bug fixing
- deployment
- backups
- user feedback

Current estimate:

## Internal target

**20–25 focused working days**

## Client-facing calendar estimate

**5–6 weeks**

A realistic outline:

### Week 1 — Foundation

- select/freeze backend platform
- deployment/dev environment
- auth
- users
- roles
- basic permission model
- business lines
- API/BFF skeleton
- source-of-truth mapping

### Week 2 — CRM

- leads
- accounts
- contacts
- opportunities
- pipelines
- activities
- tasks
- kanban
- search
- filters
- dashboard foundation
- mobile foundation

### Week 3 — Commercial

- catalog
- pricing
- quotations
- approval basics
- contracts
- invoice/payment tracking
- handover

### Week 4 — IOETI Domains

- engagement
- ISO basics
- training basics
- recruitment request
- fundraising pipeline

### Week 5 — Hardening

- permissions audit
- state transition audit
- RTL
- mobile
- calculation testing
- UAT
- deployment
- backups
- fixes

Week 6 is buffer if required.

---

# 23. Existing Structured JSON Is a Major Asset

The developer stated that there is already a **complete JSON representation** of:

- system map
- workflows
- scenarios
- likely states / transitions / business behavior

This should become the implementation truth layer.

The next agent should request/use that JSON before inventing domain behavior.

Potential pipeline:

```text
Requirements JSON
      ↓
Domain normalization
      ↓
Platform mapping
      ↓
Generate:
  - domain models
  - state machines
  - API contracts
  - permissions
  - validation rules
  - UI schemas
  - test cases
  - seed data
      ↓
Implementation agent
      ↓
Review agent
      ↓
Automated tests
      ↓
Requirement traceability audit
```

---

# 24. Recommended AI Development Workflow

The goal is not to let two agents randomly edit the codebase.

Assign specialized roles.

## Codex — Builder

Primary responsibilities:

- repository changes
- backend extensions
- APIs
- frontend
- database mappings
- migrations
- adapters
- tests
- fixes
- deployment configuration

## Claude — Reviewer / Architect / QA

Primary responsibilities:

- read source JSON
- compare implementation vs requirements
- architecture review
- security review
- edge-case review
- workflow review
- identify missing requirements
- review Codex patches
- produce structured gap reports

Loop:

```text
Codex implements
      ↓
Claude audits
      ↓
Gap report
      ↓
Codex repairs
      ↓
Automated tests
      ↓
Claude final review
```

This avoids an agent grading its own design.

---

# 25. Requirement Traceability Is Mandatory

Every requirement should eventually have an ID.

Example:

```json
{
  "id": "LEAD-ASSIGN-004",
  "domain": "lead",
  "title": "Exclude employees on leave from automatic assignment",
  "priority": "P1",
  "phase": "V1",
  "implementation": {
    "platform": "native|adapter|custom",
    "component": "...",
    "status": "planned|implemented|tested"
  },
  "tests": [
    "..."
  ]
}
```

This gives us a reliable AI coding system.

Never rely on prompts such as:

> “finish all missing CRM features.”

Instead use explicit requirement IDs.

---

# 26. Suggested Repository / Architecture Layout

A possible generic structure:

```text
/ioeti-platform

  /docs
    requirements/
    architecture/
    workflows/
    decisions/
    traceability/

  /backend
    platform/
    ioeti_core/
    ioeti_api/
    integrations/

  /frontend
    app/
    design-system/
    features/
    api-client/

  /tests
    contract/
    integration/
    e2e/
    permissions/
    workflows/

  /scripts
    seed/
    migration/
    audit/

  /ai
    requirements.json
    domain-map.json
    workflows.json
    scenarios.json
    agent-prompts/
```

If the selected platform requires a different repo model, adapt this rather than forcing it.

---

# 27. API Design Principle

The frontend should interact with semantic IOETI endpoints, not raw backend table/model names.

Examples:

```text
/api/leads
/api/leads/:id
/api/leads/:id/qualify
/api/leads/:id/handover-to-sales

/api/accounts
/api/contacts

/api/opportunities
/api/opportunities/:id/change-stage
/api/opportunities/:id/create-quote

/api/quotes
/api/quotes/:id/submit
/api/quotes/:id/approve
/api/quotes/:id/revise

/api/contracts
/api/contracts/:id/activate

/api/engagements

/api/iso/engagements
/api/iso/audits
/api/iso/findings
/api/iso/nonconformities

/api/training/courses
/api/training/cohorts
/api/training/attendance

/api/recruitment/requests
/api/recruitment/candidates

/api/fundraising/opportunities

/api/invoices
/api/payments
```

The API/BFF protects us from platform-specific implementation details.

If we migrate from Axelor to Odoo or vice versa later, the frontend should ideally change minimally.

---

# 28. Never Fork Core Unless Absolutely Necessary

For whichever backend platform is selected:

Avoid modifying core source files.

Preferred hierarchy:

```text
core platform
      ↓
official/community addon
      ↓
ioeti extension module
      ↓
ioeti API adapter
      ↓
custom frontend
```

Benefits:

- easier upgrades
- easier debugging
- clearer licensing
- easier AI reasoning
- lower vendor lock-in
- less technical debt

---

# 29. Licensing Needs a Dedicated Audit

This is not optional.

Before choosing modules, generate a license manifest:

```text
Module
Repository
Version
License
Dependency
Modified?
Linked?
Distributed?
Critical?
Alternative?
```

Particularly important for:

- Odoo Community
- OCA addons
- Axelor Open Suite
- Frappe/ERPNext
- any copied/customized community addon

Do not infer all addons in an ecosystem use the same license.

The next agent should treat license risk as part of architecture selection.

---

# 30. Platform PoC Strategy

Do not fully build four platforms.

Create a fixed mini-scenario and implement it on the leading candidates.

## Golden Scenario

```text
1. Create a hotel account.
2. Create contact.
3. Create lead for ISO 22000.
4. Qualify lead.
5. Convert to opportunity.
6. Assign salesperson.
7. Add service line.
8. Calculate price.
9. Create quotation.
10. Apply discount requiring approval.
11. Approve quote.
12. Convert to contract.
13. Define 50/50 payment schedule.
14. Mark advance paid.
15. Trigger handover.
16. Create ISO engagement/project.
17. Schedule audit/site visit.
18. Complete checklist.
19. Create nonconformity.
20. Assign corrective action.
21. Close action.
22. Show account timeline.
23. Verify sales user cannot access hidden cost field.
24. Verify manager can approve.
25. Retrieve all of the above through API.
```

Run this on:

- Axelor
- Odoo/OCA
- Frappe

Optionally Tryton if results remain close.

Measure:

- native coverage
- custom code
- number of plugins/addons
- permissions complexity
- API friction
- deployment friction
- UI independence
- testability
- upgrade risk

This PoC should heavily influence the final choice.

---

# 31. Decision Criteria

Use weighted decision criteria:

| Criterion | Weight |
|---|---:|
| Domain coverage | 25% |
| Custom development effort | 20% |
| API/headless friendliness | 15% |
| Security/permissions | 10% |
| Maintainability/upgrades | 10% |
| License simplicity | 7% |
| Deployment/hosting cost | 5% |
| Community/ecosystem | 5% |
| Arabic/local ecosystem | 3% |

Adjust weights if new information suggests otherwise.

---

# 32. Important Questions Still Unanswered

The next agent should actively answer these.

## Platform

1. Is Axelor Community actually sufficient without paid features?
2. Which exact Axelor modules are usable in the free/open build?
3. Which OCA modules and exact versions are required?
4. Is Odoo/OCA dependency complexity worth its higher coverage?
5. How much custom work would Frappe really require for ISO/training?
6. Does Tryton offer an unexpectedly clean path with lower maintenance cost?

## Client / Scope

7. How many users initially?
8. Which roles must go live on day one?
9. Which business line is most important at launch?
10. Do they already have an accounting system?
11. Do they need actual invoice generation or tracking only?
12. Is Meta/WhatsApp required for V1 or can it wait?
13. Is training essential for V1?
14. Is recruitment essential for V1?
15. How critical is fundraising at launch?
16. Does the client truly need full platform configurability from day one?

## Data

17. Existing leads/customers count?
18. Existing Excel/Sheets?
19. Existing contracts?
20. Existing trainee database?
21. Existing certificates?
22. Existing recruitment candidate database?

## Security

23. Is self-hosting mandatory?
24. Exact audit requirements?
25. Is SSO needed now or later?
26. Is field-level security truly needed on many fields or only cost/margin?

## Deployment

27. Expected hosting budget?
28. Backups/RPO/RTO expectations?
29. Need staging + production?
30. Need local Egyptian data residency or just company-controlled hosting?

---

# 33. What the Next Agent Should NOT Do

Do not:

- immediately pick Odoo just because it is famous.
- immediately pick Axelor because it looks like the current dark horse.
- design a new database from zero before testing reusable domain models.
- build a custom authentication system.
- rebuild quotation calculations if the engine already handles them.
- expose raw generic ERP APIs directly as the permanent frontend contract.
- promise all advanced features inside V1.
- estimate based only on lines of code.
- let AI implement without traceability.
- modify core platform code casually.
- assume community plugins are maintained or license-compatible.
- spend weeks polishing UI before the domain/permissions backbone is proven.

---

# 34. What the Next Agent SHOULD Do First

Recommended sequence:

## Step 1 — Read the complete original requirements

Extract a normalized domain/requirement map.

## Step 2 — Obtain the user's existing JSON

Do not rebuild work that already exists.

Validate whether it contains:

- entities
- workflows
- scenarios
- roles
- transitions
- permissions
- business rules
- edge cases

## Step 3 — Normalize requirements to IDs

Create traceability.

## Step 4 — Build platform coverage matrix

At minimum:

- Axelor
- Odoo Community + OCA
- Frappe CRM + ERPNext
- Tryton
- Dolibarr

## Step 5 — Select top 2–3

Based on weighted coverage.

## Step 6 — Run Golden Scenario PoCs

Do not trust documentation only.

## Step 7 — Freeze V1 scope

Map each requirement to:

```text
V1
Phase 2
Later
Dropped
```

## Step 8 — Produce final architecture

Including:

- platform version
- modules
- addons
- custom extensions
- API strategy
- frontend
- deployment
- backups
- security
- licensing

## Step 9 — Generate build plan

Milestones, dependencies, acceptance criteria.

## Step 10 — Feed structured implementation batches to Codex

Then use Claude as independent reviewer.

---

# 35. Suggested First Deliverable From the Next Agent

The most useful immediate output is not another generic recommendation.

Produce:

# `IOETI_PLATFORM_DECISION_PACK`

Containing:

```text
1. REQUIREMENTS_NORMALIZED.md
2. IOETI_REQUIREMENTS.json
3. PLATFORM_COVERAGE_MATRIX.xlsx/csv
4. AXELOR_AUDIT.md
5. ODOO_OCA_AUDIT.md
6. FRAPPE_AUDIT.md
7. TRYTON_AUDIT.md
8. POC_SCENARIO.md
9. LICENSE_MATRIX.md
10. FINAL_PLATFORM_RECOMMENDATION.md
11. V1_SCOPE.md
12. ARCHITECTURE.md
13. IMPLEMENTATION_PLAN.md
14. AI_AGENT_WORKFLOW.md
15. RISK_REGISTER.md
```

---

# 36. Recommended AI Task Decomposition

Do not give one agent:

> Build the complete CRM.

Break work into controlled packets.

Example:

```text
M0 Platform Foundation
M1 Identity and RBAC
M2 Organization / Contacts
M3 Leads
M4 Opportunities / Pipelines
M5 Catalog / Pricing
M6 Quotations
M7 Contracts
M8 Payment Tracking
M9 Handover / Engagement
M10 ISO
M11 Training
M12 Recruitment
M13 Fundraising
M14 Reporting
M15 Integrations
M16 Hardening / Security / UAT
```

Each packet should contain:

- requirement IDs
- accepted data model
- API contract
- UI states
- permission rules
- workflows
- tests
- out-of-scope list

---

# 37. Definition of Done for a Module

Example:

## Leads module is not “done” because the page renders.

It is done when:

- create works
- edit works
- required fields validated
- duplicate logic implemented at agreed level
- assignment works
- user scope enforced
- stage transitions enforced
- audit recorded
- activities appear
- conversion works
- permissions tested
- mobile tested
- Arabic/RTL tested
- API contract tests pass
- E2E happy path passes
- negative permission tests pass
- source requirement IDs all marked tested

The AI workflow should enforce this rigor.

---

# 38. Risks

## Scope risk

The original document is broad enough to become a long-running product.

Mitigation:
freeze V1 and use change requests.

## Platform mismatch

Documentation may make a platform appear more suitable than reality.

Mitigation:
Golden Scenario PoC.

## Licensing

Addon licenses may complicate distribution/customization.

Mitigation:
license matrix before implementation.

## AI overconfidence

Agents may produce plausible but incorrect workflows/security.

Mitigation:
source-of-truth JSON + independent review + tests.

## Permissions

Record scope is complex.

Mitigation:
permission-first architecture and negative tests.

## Data migration

Legacy data may be inconsistent.

Mitigation:
migration scripts + dry-run + dedupe report.

## Upgradeability

Heavy core changes can trap the project.

Mitigation:
extensions only; avoid core forks.

## Underpricing

Cheap fixed price can become unlimited custom development.

Mitigation:
clear V1 scope + exclusions + CR policy.

---

# 39. Commercial Change-Request Policy

The proposal should define:

Included:

- agreed V1 requirements
- one initial migration/import
- deployment
- agreed acceptance testing
- limited stabilization period

Not automatically included:

- new integrations
- new business lines beyond agreed set
- new reports not listed
- new workflow states
- complex custom dashboards
- third-party API behavior changes
- new automation campaigns
- external portal
- mobile native app
- e-signatures
- advanced BI

Any meaningful change after scope freeze:

```text
Change Request
→ estimate
→ approval
→ implementation
```

This is critical if selling at USD ~2.5–3k.

---

# 40. Final Current Position

At this exact point, no final backend has been selected.

The strategic direction is clear:

> **Reuse as much domain logic as possible from a mature open-source business suite, build IOETI-specific extensions only where necessary, expose a stable semantic API, and build a fully custom Arabic-first UI.**

The current leading hypotheses are:

### Axelor
Potentially best unified dark horse if Community/free availability checks out.

### Odoo Community + OCA
Potentially highest domain coverage and strongest ecosystem, but dependency/license/upgrade complexity must be controlled.

### Frappe
Potentially fastest custom extension platform and easiest AI-assisted custom domain development.

### Tryton
Potential clean architecture dark horse.

Final decision must be evidence-driven.

---

# 41. One-Sentence Mission for the Next Agent

> **Find the architecture that satisfies the largest percentage of IOETI's real day-one workflows with the least custom code, least licensing risk, least maintenance cost, and best ability to sit behind a fully custom Arabic/RTL frontend — then convert that decision into an executable AI-assisted build plan within a ~$2.5k–$3k V1 commercial envelope.**

---

# 42. Suggested Prompt to Start the Next Agent

You can give the receiving agent this instruction:

```text
You are taking over architecture and planning for the IOETI CRM / Business Operating System.

Read this handoff completely before recommending anything.

Do not assume the current ranking is correct.
Challenge it.

Your first job is NOT to write production code.

Your job is to:
1. normalize the requirements,
2. inspect the user's existing JSON system/workflow/scenario map,
3. create a requirement-level platform coverage matrix,
4. deeply compare Axelor, Odoo Community + OCA, Frappe CRM + ERPNext, Tryton, and Dolibarr,
5. identify any additional legitimate dark-horse platform,
6. verify licensing and actual Community/free module availability,
7. design a Golden Scenario PoC,
8. recommend the cheapest reliable architecture,
9. freeze a realistic V1,
10. produce an executable milestone plan optimized for Codex as builder and Claude as independent reviewer.

Important constraints:
- Egyptian low-budget client.
- Target V1 selling price roughly USD 2,500–3,000.
- Custom frontend is allowed and preferred.
- Do not rebuild generic CRM/ERP functionality unnecessarily.
- Do not modify platform core if avoidable.
- Backend must enforce permissions.
- Arabic/RTL/mobile matter.
- V1 must be production-usable, not a demo.
- Advanced integrations can be Phase 2.
- The user already has structured JSON for maps/workflows/scenarios, so use it as source of truth.
- Every implementation decision must be traceable back to requirement IDs.
```

---

# 43. Source Material Available

Primary source in the originating conversation:

- `Pasted markdown.md`
- Title inside source: **IOETI Egypt — CRM Requirements Specification**
- Approximately 451 lines of detailed requirements.
- The user also states they have additional structured JSON representing the system map, workflows, and scenarios.

The next agent should ask for / inspect those JSON artifacts before final architecture freeze.

---

# END OF HANDOFF

**Status:** Research / architecture selection phase.

**Implementation status:** Not started.

**Backend selected:** No.

**Current strongest candidates:** Axelor, Odoo Community + OCA, Frappe CRM + ERPNext.

**Current commercial target:** ~$3,000 quoted, ~$2,500–2,750 close.

**Current delivery expectation:** ~20–25 focused working days / ~5–6 calendar weeks for a disciplined V1.

**Next decisive artifact:** requirement-level coverage matrix + Golden Scenario PoC.
