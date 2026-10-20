# Module reuse matrix — Axelor Open Suite 9.1.10 vs IOETI

Every row was checked against source in `axelor-app/modules/axelor-open-suite` (AOS 9.1.10,
commit `e7cbea53`), Axelor Open Platform 8.2.5 jars and Axelor Studio 4.0.7 jars.
Paths are relative to `axelor-app/modules/axelor-open-suite/` unless stated.
"Running" = also exercised in the running local instance in this phase.

Classification: **NATIVE_REUSE** (use as is) · **CONFIGURATION** (data/config/Studio, no Java) ·
**EXTENSION** (IOETI module extends the upstream entity/view/service) · **NEW_DOMAIN_MODULE**
(new IOETI bounded context) · **EXTERNAL_INTEGRATION** · **UNVERIFIED**.

Confidence: H = fields/services read in source (+ running where noted), M = source read but
behaviour not exercised, L = inferred.

## CRM

| IOETI need | Upstream class / source | Key fields & services | Domain mismatch | Classification | Remaining work | Conf. |
|---|---|---|---|---|---|---|
| Lead record | `com.axelor.apps.crm.db.Lead` — `axelor-crm/src/main/resources/domains/Lead.xml` | name, enterpriseName, jobTitleFunction, mobilePhone, source, leadStatus, user, team, industrySector, numberOfEmployees, `leadScoringSelect` (manual 1–5), `isNurturing`, lostReason, tagSet; `LeadService`, `LeadComputeNameService` | No business line, no governorate/stars/branches, no consent field (GDPR module separate), scoring is a manual select | EXTENSION | add `ioetiBusinessLine`, governorate, stars, branches, UTM, referrer, consent link | H |
| Lead lifecycle New→MQL→SAL→SQL + side states with reasons | `LeadStatus` (configurable list), `LostReason`; `AppCrm` default/converted/lost statuses | statuses are data | No stage gates, no mandatory reason per transition, no SLA clock | CONFIGURATION + EXTENSION | seed IOETI statuses; transition rules (BPM or service) | H |
| Duplicate detection | `LeadDuplicateService.getDuplicateRecordsFullName`, base `DuplicateObjectsService` + merge wizard (`views/DuplicateObjectWizard.xml`) | name-based + generic field duplicate finder | No phone normalisation (+20), no Arabic normalisation, no fuzzy matching | EXTENSION | IOETI dedup service on `ArabicTextNormalizer` (done, `ioeti-core`) + `pg_trgm` (extension enabled) | H |
| Lead conversion to Account+Contact+Opportunity | `ConvertLeadWizardService.generateDataAndConvertLead` | one wizard converts to partner/contact/opportunity | Must carry IOETI fields (business line, UTM) | NATIVE_REUSE + EXTENSION | map IOETI fields in conversion | H |
| Lead assignment, round robin, workload cap, SLA | `AppCrm.assignableUsers/groupsAssignable` only restricts who can be assigned | — | No round robin, no SLA timer, no escalation | NEW_DOMAIN_MODULE (`ioeti-automation`) or BPM timer events | IOETI assignment service + scheduled batch; or BPMN timers | H |
| Opportunity | `com.axelor.apps.crm.db.Opportunity` (Opportunity.xml in crm, sale, contract…) | name, partner, contact, amount, probability, opportunityStatus, opportunityType, source, user, team, lostReason, expectedCloseDate; `OpportunityService`, sequence `OpportunitySequenceService` | **Single global `OpportunityStatus` list** — no pipeline per business line; amount is a single value (lines live on SaleOrder) | EXTENSION (running) | `ioetiBusinessLine` added + guarded by listener (**done, running**); per-line pipeline = new `ioeti-business-lines` stage model or Studio | H |
| Activities / timeline | `crm.db.Event` (calls, meetings, tasks), mail messages on tracked entities | eventList on Lead/Opportunity, ICalendar sync | WhatsApp channel absent | NATIVE_REUSE | WhatsApp via integration | M |
| Field visits from mobile | `Tour`, `TourLine` (`TourLineRestController` `/aos/tour-line`), Axelor Mobile CRM app | validate visit, last visit date | — | NATIVE_REUSE | Arabic labels in mobile app | M |
| Campaigns | `marketing.db.Campaign`, `TargetList`, `CampaignService` | leads/partners targets, email campaigns, events/attendees | No budget/cost-per-lead/attributed revenue, no WhatsApp | EXTENSION | ROI fields + attribution report | M |
| Consent / opt-out | `axelor-gdpr` (GDPRRequest, GDPRProcessingRegister, erasure log) | — | per-channel consent flag on lead not native | CONFIGURATION + EXTENSION | consent fields on Lead/Partner | M |

## Accounts / contacts

| IOETI need | Upstream | Key facts | Mismatch | Classification | Remaining work | Conf. |
|---|---|---|---|---|---|---|
| Account, parent/child chain | `base.db.Partner` (customer/prospect/contact flags, parent partner), `PartnerService` | company + contacts in one entity, addresses, tags | No stars/governorate/certificates held | EXTENSION | IOETI partner fields; certificates-held child entity | H |
| Contact with roles, many accounts | `Partner` (contact) + `PartnerLink`/`PartnerLinkType` (base) | link types between partners | Decision-role (decision maker/influencer) not native | CONFIGURATION (link types) + EXTENSION | role select on contact links | M |
| Account 360 | Partner form dashlets (sales, invoices, opportunities…) | per-module panels | IOETI tabs (certificates, training, recruitment) | EXTENSION | add panels from IOETI modules | M |

## Commercial

| IOETI need | Upstream | Key facts | Mismatch | Classification | Remaining work | Conf. |
|---|---|---|---|---|---|---|
| Service catalog | `base.db.Product` (+ `ProductCategory`, `ProductFamily`) | product types incl. services; translatable name | No business line/delivery mode/deliverables | EXTENSION | `ioetiBusinessLine` + service fields on Product | H |
| Price books, versions, currencies | `base.db.PriceList`/`PriceListLine`, `Pricing`/`PricingRule` (Groovy formulas, `historizedBy`) | formula-based pricing on any model | — | NATIVE_REUSE + CONFIGURATION | encode ISO day/branch/employee tiers as Pricing rules | H |
| Bundles | `sale.db.Pack`, `PackLine`, `PackLineService` | packs on sale orders | — | NATIVE_REUSE | — | H |
| Quotations | `sale.db.SaleOrder` (`versionNumber`, `template`, advance payments, margins), `SaleOrderVersionService.createNewVersion/recoverVersion` | quote = sale order in draft; standard quotes = templates | No A/B/C options, no discount approval matrix, no view tracking | NATIVE_REUSE + EXTENSION | approval rules (BPM/DMN or service); option groups | H |
| Quote PDF Arabic/bilingual | BIRT designs (87 `.rptdesign`), HTML `Print`/`PrintingTemplate` (Flying Saucer 10 + OpenPDF 3) | formats PDF/WORD/ODT | **Flying Saucer ignores `dir=rtl` layout** (probe, see ARABIC_AND_PDF.md); BIRT RTL unverified | EXTERNAL_INTEGRATION (Chromium/Gotenberg) | IOETI templates rendered by Chromium | H (FS) / UNVERIFIED (BIRT) |
| Contracts / MOUs | `contract.db.Contract`, `ContractVersion`, `ContractTemplate`; `ContractService.generateContractFromOpportunity, activeContract, renewContract, terminateContract` | versions, tacit renewal, invoicing periods, opportunity link | Lifecycle names differ (Legal Review, Sent); recruitment fee % / guarantee absent | NATIVE_REUSE + EXTENSION | IOETI statuses, recruitment terms, "no Won without signed contract" rule | H |
| Payment milestones | `supplychain.db.Timetable` (title, %, amount, estimatedDate, invoiced, invoice); `TimetableService.createInvoice/generateInvoice` | milestone invoicing from a sale order | Trigger is manual/date, not event (audit stage done, candidate start) | EXTENSION | event → invoice-request automation in `ioeti-automation` | H |
| Invoices, payments, partial, aging, credit notes | `account.db.Invoice`, `InvoiceTerm`, `InvoicePayment`, `DebtRecovery` | full accounting | Spec wants tracking, not full ERP; Egypt ETA e-invoice absent | NATIVE_REUSE (scope down) + EXTERNAL_INTEGRATION (ETA) | decide accounting depth with IOETI accountant | H |

## Operations

| IOETI need | Upstream | Key facts | Mismatch | Classification | Remaining work | Conf. |
|---|---|---|---|---|---|---|
| Handover / engagement | `project.db.Project`, `ProjectTask`, `ProjectTemplate`, `TaskTemplate` | templates with tasks | No handover object linking quote/contract/payment state | NEW_DOMAIN_MODULE (`ioeti-handover`) on top of Project | handover + engagement entities | H |
| ISO audit visit scheduling | `intervention.db.Intervention` (deliveredPartner, contact, contract, opportunity, assignedTo, planif dates, statuses To plan/Planned/Started/Suspended/Finished/Cancelled, `offlineIntervention`, `nonConforming`); `InterventionService.plan/start/suspend/finish/fillFromContract` | field-service visit engine | Equipment-oriented (`equipmentSet`); no certification cycle (Stage 1/2, surveillance, renewal) | NATIVE_REUSE (visit) + NEW_DOMAIN_MODULE (`ioeti-certification` cycle) | certification cycle + auditor competence | H | Wave 4b note: the certification programme itself is the new `ioeti-certification` module; native `Intervention` stays the candidate for field-visit execution and is not linked yet.
| Audit checklists / evidence | `InterventionRange`, `InterventionQuestion` (required, conditional, picture, signature, measure answers), `InterventionQuestionService` | questionnaire engine, mobile | Checklist per ISO clause must be authored | CONFIGURATION | ISO 9001 / 22000 checklists as ranges | H |
| Findings / NC / CAPA | `quality.db.QualityImprovement` (type Product/**System**, detection origin incl. **Customer**), `QIAnalysis`, `QICause`, `QIDecision`, `QIAction`, `QIResolution` | 8D-style improvement | Built for the company's own QMS, not certifying clients | EXTENSION | link QI to client certification cycle, classify major/minor NC | H |
| Client certificates & surveillance | — | — | Not present | NEW_DOMAIN_MODULE (`ioeti-certification`) | certificate register, validity, surveillance plan, renewal opportunity | H |
| Training catalog / sessions | `talent.db.Training`, `TrainingSession`, `TrainingRegister` (**employee** only), `TrainingRegisterService.plan/complete/cancel` | internal HR training | External paying trainees, capacity, waitlist, certificates, invoices absent | NEW_DOMAIN_MODULE (`ioeti-training`) | **built (Wave 4a)**: courses, cohorts, capacity and waitlist, enrolment, sessions, attendance (`docs/slices/W4-external-training.md`); certificates and invoices wait for D-03 and D-06 | H |
| Recruitment for clients | `talent.db.JobPosition` (companyDepartment, internal), `JobApplication`, `HiringStage`, `JobApplicationService` | candidate pipeline | Positions belong to IOETI, not to client accounts; no fee/guarantee | EXTENSION (candidate pipeline) + NEW_DOMAIN_MODULE (`ioeti-recruitment` request/placement) | client request, placement, guarantee | H |
| Fundraising | Opportunity (+ business line FUNDRAISING) | pipeline only | No donor/grant/commitment objects | NEW_DOMAIN_MODULE (`ioeti-fundraising`) | donor, grant, commitment, receipts | H |
| Documents / knowledge | AOP DMS (`com.axelor.dms.db.DMSFile`), project `Wiki`/`WikiFolder` | attachments, folders | — | NATIVE_REUSE | folder conventions | M |

## Platform

| IOETI need | Upstream | Key facts | Classification | Conf. |
|---|---|---|---|---|
| Role/group/permission | AOP `auth.db.Role/Group/Permission`; `AuthSecurity` deny-by-default for non-admin, conditional permissions = record filter | **running**: negative tests pass | NATIVE_REUSE | H |
| Field-level permissions | AOP `MetaPermission` / `MetaPermissionRule` (domain in axelor-core) | read in source, not exercised yet | CONFIGURATION | M |
| Audit trail | AOP `AuditLog` (MFA/auth), `mail` tracking (`<track>` on entities, used by BusinessLine), AOS `GlobalTrackingLog` | tracking proven on BusinessLine form; global log not exercised | NATIVE_REUSE | M |
| 2FA | AOP `MFA` domain + `MFAService` | not exercised | NATIVE_REUSE | M |
| Studio (custom models/fields/apps) | `axelor-studio` 4.0.7 (AGPL): `MetaJsonModel`, `MetaJsonField`, `StudioApp`, `StudioDashboard` | installed (module list), not exercised | CONFIGURATION | M |
| BPM / DMN | `axelor-studio`: `WkfModel`, `WkfProcess`, `WkfDmnModel`; `ProcessEngineService` (needed even in tests) | engine bound at runtime | CONFIGURATION | M |
| REST API | AOP generic `/ws/rest/{model}` (search/fetch/save/delete) + custom JAX-RS resources auto-discovered by `MetaScanner` (`/ws/...`) | **running** for both | NATIVE_REUSE | H |
| Translations | AOP `meta_translation` (DB, live-editable), module `i18n/messages_<lang>.csv`, `ImportExportTranslation` (AOS base) | **running**: IOETI `ar` strings loaded; AOS ships en/fr only | NATIVE_REUSE + CONFIGURATION | H |
| RTL UI | axelor-front RTL for `ar` | **running** (screenshot `logs/ui/04-business-lines-arabic-rtl.png`) | NATIVE_REUSE | H |
| Background jobs | AOP Quartz `MetaSchedule`, AOS batches (`CrmBatch`…) | not exercised | NATIVE_REUSE | M |
| Mobile | Axelor Mobile (separate repo, AGPL) + `axelor-mobile-settings` | not exercised | NATIVE_REUSE | L |
| Client portal | `axelor-client-portal` (public) vs Goovee/`axelor-portal` backend (**not public; Enterprise/SUL**) | — | EXTERNAL / custom | M |
