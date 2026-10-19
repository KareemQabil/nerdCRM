# Upstream method evidence — pinned AOS v9.1.10

This file records **interface declarations actually read from the pinned source**. Method existence proves an API entrypoint, not that it satisfies IOETI workflows. Before coding, read its implementation, module bindings, call transactions, unit tests, permissions and persisted data semantics.

| Area / direct source reference | Confirmed methods | IOETI conclusion |
|---|---|---|
| [CRM Lead Conversion](https://github.com/axelor/axelor-open-suite/blob/e7cbea53bae88d2540f59a70b09bf0f326f1022e/axelor-crm/src/main/java/com/axelor/apps/crm/service/ConvertLeadWizardService.java) | `generateDataAndConvertLead(...)`, `convertMapListToPartnerList(...)` | Reuse native conversion; extend field propagation, preserve activities, validate role/scope/duplicates |
| [Sale Order Versioning](https://github.com/axelor/axelor-open-suite/blob/e7cbea53bae88d2540f59a70b09bf0f326f1022e/axelor-sale/src/main/java/com/axelor/apps/sale/service/saleorder/SaleOrderVersionService.java) | `createNewVersion(SaleOrder)`, `recoverVersion(...)`, `getVersionDateTime(...)` | Quote versions exist; multi-option A/B/C and approval evidence still new |
| [Invoice Milestone Service](https://github.com/axelor/axelor-open-suite/blob/e7cbea53bae88d2540f59a70b09bf0f326f1022e/axelor-supplychain/src/main/java/com/axelor/apps/supplychain/service/TimetableService.java) | `generateInvoice(Timetable)`, `createInvoice(Timetable)`, `applyTemplate(...)`, `computeAmount(...)` | Native invoice creation exists; event-based ISO/training/recruitment triggers still IOETI automation |
| [Contracts](https://github.com/axelor/axelor-open-suite/blob/e7cbea53bae88d2540f59a70b09bf0f326f1022e/axelor-contract/src/main/java/com/axelor/apps/contract/service/ContractService.java) | `activeContract`, `renewContract`, `terminateContract`, `copyFromTemplate`, `generateContractFromOpportunity` | Contract engine reused, not evidence of legal-review/signature-specific IOETI approval |
| [Intervention lifecycle](https://github.com/axelor/axelor-open-suite/blob/e7cbea53bae88d2540f59a70b09bf0f326f1022e/axelor-intervention/src/main/java/com/axelor/apps/intervention/service/InterventionService.java) | `create(CustomerRequest)`, `create(Contract)`, `start`, `plan`, `reschedule`, `cancel`, `suspend`, `finish`, `fillFromContract` | Reuse field visit engine, but never mistake field visit for certificate grant |
| [Intervention checklists](https://github.com/axelor/axelor-open-suite/blob/e7cbea53bae88d2540f59a70b09bf0f326f1022e/axelor-intervention/src/main/java/com/axelor/apps/intervention/service/InterventionQuestionService.java) | `deleteSurvey`, `advancedMonitoringAnswer` | Model and question services exist; need full checklist workflow tests |
| [Quality Improvement](https://github.com/axelor/axelor-open-suite/blob/e7cbea53bae88d2540f59a70b09bf0f326f1022e/axelor-quality/src/main/java/com/axelor/apps/quality/service/QualityImprovementService.java) | `getDefaultQIStatus()` (interface signature) | CAUTION: don't invent service methods based on its name. Other specialized services exist and must be opened individually; internal-QMS logic needs client cycle wrapper |
| [Training Register](https://github.com/axelor/axelor-open-suite/blob/e7cbea53bae88d2540f59a70b09bf0f326f1022e/axelor-talent/src/main/java/com/axelor/apps/talent/service/TrainingRegisterService.java) | `plan`, `complete`, `cancel`, `updateEventCalendar`, `massTrainingRegisterCreation` | Native registrations are employees. Need external trainee domain |
| [Job Application](https://github.com/axelor/axelor-open-suite/blob/e7cbea53bae88d2540f59a70b09bf0f326f1022e/axelor-talent/src/main/java/com/axelor/apps/talent/service/JobApplicationService.java) | `createEmployeeFromJobApplication`, `setDMSFile`, `getInlineUrl` | Confirms **internal hiring bias**. External client job-order/placement is new domain |
| [Marketing Campaign](https://github.com/axelor/axelor-open-suite/blob/e7cbea53bae88d2540f59a70b09bf0f326f1022e/axelor-marketing/src/main/java/com/axelor/apps/marketing/service/CampaignService.java) | `sendEmail`, `sendReminderEmail`, `generateEvents`, `generateTargets`, `inviteAllTargets`, `markLeadPresent`, `markPartnerPresent` | Campaign/event delivery reusable; ROI and channels need extension |

### Conflict utility — important for Claude parallel work

Pinned Axelor Utils 4.0.2:
- `com.axelor.utils.api.ConflictChecker.checkVersion(AuditableModel,int)` throws **`ClientErrorException` with 409**.
- `HttpExceptionHandlerImpl` maps `ClientErrorException` to 409; a plain `WebApplicationException` falls to generic 500 branch.
- A 409 preflight check is **different** from a flush/commit race. Preserve actual optimistic locking, rollback semantics, and don't leak raw exception text. At snapshot, real Opportunity stale-write regression had failed even though create/read/rename persisted.

This mapping-only PR does **not** modify Claude's concurrency fix or claim its tests passed.
