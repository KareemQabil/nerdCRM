# Source field → IOETI DTO → Record UX (verified source XML)

**Pinned source** `axelor-open-suite@e7cbea53bae88d2540f59a70b09bf0f326f1022e`; compared against current IOETI controllers on feature baseline `82fe3e4`. **This is a field declaration/projection audit, not an authorization proof**. Every additional field requires explicit business purpose, field sensitivity policy and negative API tests.

## Actual native Lead.xml declarations

Source: `axelor-crm/src/main/resources/domains/Lead.xml`

| Source fields actually declared | Current IOETI projection | UI / security interpretation |
|---|---|---|
| `name`, `fullName`, `enterpriseName` | `LeadView(name, organization)` | Verified source to DTO: UI Lead profile header and associated organization string; **not a Partner ID** |
| `leadStatus` | `stage=leadStatus.name` | Status label only, not IOETI MQL/SAL/SQL workflow engine |
| `id` (inherited JPA model) | `id` | Stable numeric record key; account/deal relationship cannot be inferred from same display name |
| `source`, `sourceDescription`, `contactDate`, `industrySector` | **Not exposed** | Add only with approved source attribution and query ACL |
| `user`, `team`, `company`, `companyDepartment` | **Not exposed** | Used for ownership/department and Own/Team/Line record scopes; must test server-side |
| `partner`, `eventList`, `lostReason`, `lostReasonStr` | **Not exposed** | Conversion lineage, activity and disposition pending dedicated authorized APIs |
| `mobilePhone`, `fixedPhone`, `emailAddress`, `address` | **Not exposed** | PII and consent constraints; do not add to browser DTO indiscriminately |
| `isDoNotCall`, `isDoNotSendEmail`, `isConverted`, `isNurturing` | **Not exposed** | Operational flags to respect before outbound activity and conversion |
| `picture`, `description`, `statusDescription` | **Not exposed** | Files/notes can expose private data and require field and attachment policy |

**Negative audit:** Current Lead DTO should contain exactly `id,name,organization,stage` (nullable where declared). The existing detail controller combines `SecurityCheck().readAccess(Lead.class,id)` with a subsequent `Query.filter`; review whether that filter replaces, rather than augments, prior record restrictions; it separately uses `JpaSecurity.isPermitted`. Do not turn this into a broader DTO before SEC-003.

## Actual Partner.xml and PartnerLink.xml declarations

Sources:
- `axelor-base/src/main/resources/domains/Partner.xml`
- `axelor-base/src/main/resources/domains/PartnerLink.xml`

| Source fields | Current IOETI projection | Context for Account 360 |
|---|---|---|
| `id`, `name`, `partnerSeq` | `id,name,reference` | Identity and reference only |
| `isCustomer`, `isProspect` | `customer,prospect` | UI labels; not evidence of paid invoices or live opportunities |
| `isInternal`, `isEmployee`, `isContact`, `isSupplier` | **Only filtering predicate, not output** | Account endpoint filters out internal/employee/contact and requires customer or prospect; check edge cases in mixed flags and business ownership |
| `parentPartner`, `mainPartner`, `contactPartnerSet`, `partnerAddressList` | **Not exposed** | Account hierarchy, contacts and branch/site navigation need protected association APIs |
| `managedByPartnerLinkList`, `managedForPartnerLinkList` | **Not exposed** | PartnerLink `partner1,partner2,partnerLinkType` are source-backed relation fields; not yet user-facing verified links |
| `user`, `team`, `companySet` | **Not exposed** | Scope/ownership requires cross-entity record ACL |
| `salePartnerPriceList`, `paymentDelay`, `currency`, `fiscalPosition` | **Not exposed** | Financial/commercial policy, client finance scopes |
| `bankDetailsList`, `bankDetails`, `taxNbr`, `registrationCode`, `saleTurnover` | **Not exposed** | Sensitive financial/identifying fields; **never** expose from generic unrestricted entity |
| `emailAddress`, `fixedPhone`, `mobilePhone`, `partnerAddressList` | **Not exposed** | Contact personal data and location retention/consent review |
| `industrySector`, `partnerCategory`, `source`, `parentPartner` | **Not exposed** | Enrich Account 360 only with explicit projection and approval |

**Known query correctness gap:** Current account list first applies `fetch(limit,offset)`, *then filters* customer/prospect predicates in Java, causing short pages and incomplete pagination across mixed Partner types. Move *non-sensitive type qualification* into the DB query while preserving the permission filter. Do not confuse the post-fetch predicate with record authorization.

**Account ID oracle:** Detail executes `SecurityCheck().readAccess(Partner.class,id)` then repository `.find(id)`. Normalize forbidden/existing vs unknown status through an agreed security policy.

## Actual Opportunity.xml declarations

Source: `axelor-crm/src/main/resources/domains/Opportunity.xml`. IOETI adds `ioetiBusinessLine` in `modules/ioeti-business-lines/src/main/resources/domains/Opportunity.xml`.

| Source fields | Current Opportunity DTO | UX / GAP |
|---|---|---|
| `id`, `name` | `id,name` | Source-grounded record identity |
| `opportunitySeq` | `reference` | Source-backed reference; do not replace with list order |
| `opportunityStatus` | `stage` | Current Axelor status name; not per-business-line configurable gates |
| `ioetiBusinessLine` (IOETI extension) | `businessLineCode,businessLineNameAr,businessLineNameEn` | Verifies real source to custom label; remember membership permissions |
| inherited `version` | `version` | Optimistic mutation guards, Claude PR #6 409 fix (not yet merged) |
| `partner`, `contact` | **Not exposed** | To build actual Account/Contact linkage without name guessing |
| `currency`, `amount`, `probability`, `bestCase`, `worstCase` | **Not exposed** | Quote/forecast fields need finance and line scope |
| `user`, `team`, `company` | **Not exposed** | Ownership, team, company and authorization first |
| `expectedCloseDate`, `eventList`, `nextScheduledEventDateT`, `lastEventDateT` | **Not exposed** | Real due actions and activities should use dedicated scoped DTOs |
| `source`, `lostReason`, `lostReasonStr`, `description`, `memo` | **Not exposed** | Sensitive notes and reason controls, do not simply serialize all |
| `recurrentAmount`, recurring dates, `opportunityRating` | **Not exposed** | Reporting optional only with approved semantics |

**PR #8 UI statement:** The new full-page Opportunity workspace displays only `id,name,reference,stage,businessLine,version`; missing Account, Owner, activity, quote, contract and finance sections deliberately say "not connected", since the API does not supply them. This is **truthful source-first UI** with no fabricated relationship.

## Proposed minimal protected relationship contracts (NOT implemented)

| Feature | Proposed endpoint | Required model checks / denial |
|---|---|---|
| Opportunity → contact/customer | `GET /ws/ioeti/opportunities/{id}/parties` | Opportunity read plus Partner/Contact read and field allowlists; unknown vs forbidden consistency |
| Opportunity → events | `GET /ws/ioeti/opportunities/{id}/activities` | Opportunity read + per-Event read; no internal/private event leak |
| Account → all opportunities | `GET /ws/ioeti/accounts/{id}/opportunities` | Partner read + per-Opportunity read + business-line filter; pagination |
| Account → contacts | `GET /ws/ioeti/accounts/{id}/contacts` | Partner read + per-contact Partner read; PII field scope and relationship validity |
| Lead conversion preview | `GET /ws/ioeti/leads/{id}/conversion-preview` | Lead read + candidate Partner matching with privacy-safe masked output |

These endpoints are **proposed** and must not be called from connected UI before Claude SEC-002/SEC-003 acceptance.

## Field-level acceptance next steps

- Map each field to exact source path, derived/inherited indicator, allowed roles, row scope, PII class, API DTO property and UAT usage.
- Add restricted-user negative tests to prove each new field's **absence**, not simply the presence of list records.
- Add separate linked-record denial tests to prevent cross-BusinessLine Account 360 leakage.
- Test downstream export and document endpoints independently of UI visibility.
- Require server-side search/pagination for large client datasets.
- Track true state as `SOURCE_FIELD_VERIFIED` vs `API_IMPLEMENTED` vs `ROLE_VERIFIED` vs `UI_TESTED` vs `UAT_ACCEPTED`.

No Source → DTO expansion is authorized by this document alone.
