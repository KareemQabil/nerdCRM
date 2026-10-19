# Next-stage implementation backlog

Ordered by dependency and risk. Each item is one PR-sized packet for the builder agent, reviewed
independently (AGENTS.md Definition of Done). Effort: S ≤ 2 d, M 3–7 d, L 2–4 weeks.

## Stage 0 — decisions and inputs (owner: project lead, before coding Stage 2+)
| # | Item | Why |
|---|---|---|
| 0.1 | Obtain spec sections 10+ (ISO, recruitment, fundraising, KB, automation, reports, admin) and the open-questions list | ISO/recruitment/fundraising currently rest on the handoff only |
| 0.2 | Build the requirement catalogue with IDs (`docs/requirements/IOETI_REQUIREMENTS.json`) from the spec | traceability for every PR |
| 0.3 | Decide accounting depth (Axelor invoicing vs. external accounting + ETA e-invoice) with IOETI's accountant | drives account/invoice app scope |
| 0.4 | Decide exposure of `/ws/rest` for non-admin roles (reverse-proxy rule) | field-rule gap (SECURITY_MODEL.md) |
| 0.5 | Confirm V1 business-line priority and user count | sizing of security groups and pipelines |

## Stage 1 — platform hardening (S/M)
| # | Item | Effort |
|---|---|---|
| 1.1 | CI pipeline (GitHub Actions or similar): build, `test`, start app on PostgreSQL service, `install-apps`, `smoke` | M |
| 1.2 | Admin password rotation + IOETI groups/roles seeds (Super admin, GM, Marketing, Sales rep, Sales manager, Operations, Trainer/Auditor, Finance, Fundraising, Read-only) with deny-by-default permissions | M |
| 1.3 | `User.ioetiBusinessLines` (M2M) + record-scope conditions Own / Team / Business line / All; negative tests per scope | M |
| 1.4 | Sensitive-data pattern: first isolated entity (`ServiceCost` for catalog cost/margin) + test that restricted roles cannot read it via any API | S |
| 1.5 | Production config profile (`ddl=none`, migration tool, logging, backups of DB + attachments) | M |
| 1.6 | Chromium PDF renderer integration (`ioeti-integrations`, Gotenberg container) + Arabic quote template prototype; test BIRT RTL for comparison | M |
| 1.7 | Arabic translation work package for the screens used in V1 (export keys of crm/sale/contract/base, translate, review) | M |

## Stage 2 — commercial chain (V1 core)
| # | Item | Upstream reused | Effort |
|---|---|---|---|
| 2.1 | Lead extension: business line, governorate, stars, branches, UTM, referrer, consent; IOETI lead statuses with mandatory reasons | Lead, LeadStatus, gdpr | M |
| 2.2 | Duplicate detection service (phone +20, email/domain, Arabic-normalised fuzzy company name with `pg_trgm`) + warning on save | LeadDuplicateService, DuplicateObjects merge, `ArabicTextNormalizer` | M |
| 2.3 | Assignment (round robin / by business line / governorate, workload cap, leave exclusion) + SLA timer & escalation (Quartz job) | AppCrm, Quartz | M |
| 2.4 | Per-business-line pipelines (stage model, probabilities, stage gates, rotting) on Opportunity | Opportunity, OpportunityStatus | M |
| 2.5 | Service catalog fields on Product (business line, delivery mode, deliverables, duration) + ISO pricing rules (employees, branches, audit days) | Product, Pricing, PriceList, Pack | M |
| 2.6 | Quote rules: numbering per line/year, discount approval matrix (BPM or service), Arabic/English templates via renderer | SaleOrder versions/templates | M |
| 2.7 | Contracts/MOUs: IOETI statuses, "no Won without signed contract" per pipeline, recruitment fee/guarantee terms | Contract, ContractVersion, generateContractFromOpportunity | M |
| 2.8 | Payment milestones linked to events (audit stage done, session start, candidate start) → invoice request; collection reminders | Timetable, Invoice, DebtRecovery | M |

## Stage 3 — operations domains (V1 basic)
| # | Item | Effort |
|---|---|---|
| 3.1 | `ioeti-handover`: handover object + checklist templates per business line, creates Project/engagement | M |
| 3.2 | `ioeti-certification`: certification cycle, audit visits on Intervention, ISO 9001/22000 checklists as InterventionRanges, findings on QualityImprovement (System/Customer), client certificate register, surveillance + renewal opportunity | L |
| 3.3 | `ioeti-training`: courses, cohorts (capacity, min seats, waitlist), external trainees, registrations, attendance, certificate PDF with serial + QR (verification page later) | L |
| 3.4 | `ioeti-recruitment`: client requests, positions, link to JobApplication pipeline, placement, guarantee | M |
| 3.5 | `ioeti-fundraising`: donor, grant, commitment, receipt (pipeline already via business line) | M |
| 3.6 | Role dashboards (rep, manager, GM, finance, operations) with Studio dashboards | M |

## Stage 4 — Phase 2 features
Lead ads/WhatsApp intake via `n8n-nodes-axelor` + Chatwoot; nurturing sequences; rule-based scoring
(DMN); e-signature (Documenso); public course registration & certificate verification (small
custom app on IOETI APIs); client portal; commissions; Axelor Mobile Arabic labels.
