# UI Reverse Mapping — Axelor 9.1.10 → IOETI Custom CRM

Status: working source-based inventory; **implementation and verification separate**.
Pinned AOS SHA: `e7cbea53bae88d2540f59a70b09bf0f326f1022e`.
Evidence: `docs/MODULE_REUSE_MATRIX.md` and AOS source files referenced below.

## The four distinct states

- **SOURCE_CONFIRMED:** class/domain/service exists at pinned Axelor commit.
- **API_IMPLEMENTED:** an IOETI allowlisted endpoint exists in this repo (not necessarily verified running).
- **UI_IMPLEMENTED:** custom IOETI read/interaction surface exists in the React frontend.
- **INTEGRATED_VERIFIED:** real Axelor/PostgreSQL, multiple role-limited users, negative permission and restart tests pass.

These states MUST NOT be collapsed into a single "Done" status.

| Domain | Confirmed upstream source models | IOETI API | Custom UI | Gaps before IOETI completion |
|---|---|---|---|---|
| Business lines | IOETI `BusinessLine` (new), CRM Opportunity extension | `/ws/ioeti/business-lines` | Overview, list, detail | Per-line stage/pipeline/config/rules |
| Opportunities | `axelor-crm/.../domains/Opportunity.xml`, OpportunityService | `/ws/ioeti/opportunities` list/detail/create/rename | List, create, rename | Stage gates, owner roles, activity stream, concurrency proof |
| Leads | `axelor-crm/.../domains/Lead.xml`, LeadStatus, LeadService | `/ws/ioeti/leads` read-only | Lead inbox, search, detail drawer | Conversion, assignment, SLA, B/L and tracking |
| Accounts | `axelor-base/.../domains/Partner.xml`, PartnerLink | `/ws/ioeti/accounts` read-only, customer/prospect filtering | Account directory, search, detail drawer | Contact tree, account 360, ISO/training/finance rollups |
| Lead activities | `Event` | Not implemented | Not implemented | CRM timeline, communication history |
| Marketing | `Campaign`, `TargetList` | Not implemented | Planned in explorer | Attribution, multi-channel |
| Service catalog | `Product`, `PriceList`, `Pricing`, `Pack` | Not implemented | Planned | Business-line-specific packages/pricing |
| Quotes | `SaleOrder`, `SaleOrderVersionService` | Not implemented | Planned | Approval, Arabic PDF and versions |
| Contracts | `Contract`, `ContractVersion`, `ContractTemplate` | Not implemented | Planned | MOU/contract-specific gates |
| Receivables | `Invoice`, `Timetable`, `DebtRecovery` | Not implemented | Planned | Event milestones, ETA integration |
| Operations | `Project`, `ProjectTemplate` | Not implemented | Planned | Sales-to-ops handover |
| Audit field visits | `Intervention`, `InterventionRange`, `InterventionQuestion` | Not implemented | Planned | Auditor scheduling/competence, ISO cycle |
| NC/CAPA | `QualityImprovement`, `QIAction` | Not implemented | Planned | Client NC/CAPA + certification decision separation |
| External training | Internal `Training`, `TrainingRegister` (employee) | Not implemented | Planned | New external-trainee/cohort/payment/certificates domain |
| Client recruitment | Internal `JobApplication`, `HiringStage` | Not implemented | Planned | Client job order, submission, placements, guarantees |
| Fundraising | `Opportunity` pipeline foundation | Not implemented | Planned | Donor/grants/pledges/receipts entity |
| Administration | AOP role/security, Axelor Studio/BPM/DMN | Not implemented | Theme setting only | Fully custom safe business configuration UI |

## Lead entity projection: deliberately minimal

From `Lead.xml`: `Lead.id`, `fullName`, `name`,
`enterpriseName`, `leadStatus.name`. NO email, mobile, phone,
ID, consent flags, notes, or arbitrary fields in this first DTO.

The user may be authorized to view Leads but not all personal contact fields:
the absence of a global field-level API protection is an open risk; only expose
additional PII through specifically scoped endpoints after reviewing policies.

## Account entity projection: deliberately minimal

From `Partner.xml`: `id`, `name`, `partnerSeq`,
`isCustomer`, `isProspect`. Excludes internal contacts, employees,
supplier-only rows, and bank/tax fields.

Note: filtered query windows can contain fewer than requested customer records.
Pagination/search mechanics must be improved with an authorization-preserving,
database-side customer-scope predicate before large-scale production use.

## Next implementation order

1. Close the known **stale Opportunity update** test failure (real CI did not reject
   a write with a reused old version); prove transactional optimistic locking.
2. Test Lead and Account DTO security with restricted and cross-team users, including
   API reads and exports.
3. Implement Lead qualification/assignment using existing `LeadService` and
   `ConvertLeadWizardService`; do not reimplement native business actions in React.
4. Build Account 360 aggregation contract from Partner, events/opportunities,
   sale, contracts and billing while applying separate read permissions on each.
5. Build Product/PriceList → SaleOrder frontend with approvals and Arabic PDF.
6. Build Contract/Timetable/Project/Intervention user workflows.
7. Only after source-first reuse, implement dedicated IOETI domains for ISO cycles,
   external trainee cohorts, recruitment agency, donor/grant accounting.

## Public preview vs operational system

`VITE_IOETI_DEMO=true`: fictional ephemeral records only, no passwords, no DB.
The preview lets users evaluate information hierarchy, theme family, navigation
and mapping. It is **not** a deployed multi-user CRM.

Real mode: browser uses explicit IOETI application API, backed by Axelor.
No live production customer data should go to public Vercel preview yet.

## Criteria for labelling a domain "connected and verified"

- Source paths and pinned commit documented.
- Controller/API classes compiled with the real Axelor classpath.
- Real PostgreSQL integration test passes with actual records.
- Positive and negative role tests prove server enforcement.
- Browser E2E checks Arabic RTL, English LTR, mobile, empty/error/detail.
- No sensitive properties in endpoint JSON beyond declared DTO fields.
