# Wave 2 (part 1): Lead → Account (+ Contact) + Opportunity, and Account 360

Status: LIVE_INTEGRATION_PASS and NEGATIVE_SECURITY_PASS on Axelor 9.1.10 + PostgreSQL 16 (`scripts/lead_conversion_probe.py`, also in backend CI). Every role used in tests is a fixture; the production role matrix is policy D-07.

## 1. What the slice does

One command converts a lead the caller may edit into:
- a **customer account**: a new prospect Partner built from the lead, or an existing client account the caller may edit;
- a **contact**: only for a company lead, attached to the account;
- an **opportunity**: owned by the caller, in an eligible business line, linked to the account and contact, with the lead recorded as its origin.

The lead is marked converted with the native converted status. Everything happens in **one transaction**, so either all of it is saved or none of it is.

The UI adds:
- **"Convert to account & opportunity"** on the lead page. It opens a full-page wizard at `#/leads/{id}/convert`. After conversion the lead page links to the account and the opportunity.
- **Account 360** on the account page: *Opportunities* and *Contacts* tabs, each filtered by the server with the caller's permissions.

## 2. Native first

| Need | Reused from AOS 9.1.10 / AOP 8.2.5 | IOETI addition |
|---|---|---|
| Partner and contact creation, event/message transfer, converted status, lost-lead rule | `ConvertLeadWizardService.generateDataAndConvertLead`. Field maps mirror `ConvertLeadWizardController.getPartnerMap`/`getContactMap`. | `PersistingConvertLeadWizardService` (see below) |
| Opportunity creation and sequence | `OpportunityService.saveOpportunity` | — |
| Stale version | `ConflictChecker.checkVersion` (409) | — |
| Simultaneous conversion | Hibernate versioned UPDATE on the lead | `OptimisticLockConflicts` (409, everything rolled back) |
| Line scope on leads | native permission conditions (SEC-003) | `Lead.ioetiBusinessLine` |
| Lineage | — | `Opportunity.ioetiOriginLead` (AOS has no lead link on Opportunity) |

**Why `PersistingConvertLeadWizardService` exists.** The native service builds the account and contact but does not save them: the native UI saves them through the partner form. `convertLead` then links them to the lead and copies the lead's related messages using their ids. Called directly, they would be transient and those ids null.

The subclass saves each one right after it is built, in the same transaction. It is **not bound in Guice**, so the native Axelor UI keeps its own behaviour. No upstream file is modified.

## 3. API

`POST /ws/ioeti/leads/{id}/convert`

Request body: `{version, opportunityName?, businessLineCode?, accountId?}`
- `opportunityName` defaults to the company name, otherwise the person's name.
- `businessLineCode` defaults to the lead's line.

On success it answers **201** with `{leadId, accountId, contactId|null, opportunityId}`.

| Case | Answer | Persisted |
|---|---|---|
| No `version` | 400 `INVALID_REQUEST` | nothing |
| Lead unknown or outside the read scope | 404 (same as a missing id) | nothing |
| Lead readable but not writable | 403 | nothing |
| No create right on Opportunity, or on Partner when creating an account | 403 | nothing |
| Stale version | 409 `CONFLICT` | nothing |
| Already converted | 409 `ALREADY_CONVERTED` | nothing |
| Lost concurrent conversion | 409 `CONFLICT` | its account, contact and opportunity rolled back |
| Line unknown, unreadable, inactive or not eligible | 422 field `businessLineCode` (one identical answer) | nothing |
| `accountId` unknown, unreadable, not editable, or not a client account | 422 field `accountId` (one identical answer) | nothing |
| Bad opportunity name | 422 field `name` | nothing |
| Native rule refuses (e.g. lost lead, incomplete address) | 422 `CONVERSION_REJECTED` with a fixed safe message | nothing |
| AppCrm `crmProcessOnPartner` enabled | 422 `CONVERSION_UNSUPPORTED`. That mode needs a partner status chosen in the native form. | nothing |

Lead DTO, read endpoints:
- adds `version`, `converted`, `businessLineCode` (only if the line is readable), `accountId` (only if the account is readable) and `opportunityId` (only if the opportunity is readable);
- still has **no contact details**.

Account 360:
- `GET /ws/ioeti/accounts/{id}/contacts` returns `{id, name, jobTitle}`, readable contacts only, with no e-mail or phone.
- `GET /ws/ioeti/accounts/{id}/opportunities` returns the opportunity DTO, in the caller's scope.
- Both answer 404 for a non-client partner or a missing id, exactly like `GET /accounts/{id}`.

## 4. Evidence

`scripts/lead_conversion_probe.py`: **28/28**, with 20 concurrent rounds locally and 10 in CI. Evidence is in `docs/evidence/wave2/`.

What the 28 checks cover:
- Company lead:
  - account (company, prospect), contact attached to it, opportunity linked to account, contact, owner, line and origin lead;
  - the lead is stored as converted with the native status, and its DTO shows the links.
- Person lead: individual account, no contact, chosen opportunity name.
- Existing account:
  - a non-client partner and an unknown id get the identical 422 and create nothing;
  - conversion into a real account creates no new account.
- Retry: 409 `ALREADY_CONVERTED`, with still exactly one opportunity and one account.
- Refusals, each leaving no trace and the lead unconverted:
  - another user's lead: 404, identical to a missing id;
  - read-only user: 403;
  - non-member line: 422;
  - lost lead: 422 `CONVERSION_REJECTED`, with no stack trace in the body;
  - stale version: 409;
  - no version: 400.
- **Concurrent double conversion**: two sessions of the same user send the same version at the same time, on N leads. Every lead gets exactly one 201 and one 409, and exactly one opportunity and one account.
- Account 360:
  - the owner sees the converted contact and opportunity;
  - another rep (own scope) sees no opportunity;
  - a non-client or missing partner gets 404.

UI, mocked:
- the wizard sends the version, name and line plus the CSRF token, then shows links;
- Account 360 tabs;
- a converted lead shows links instead of the convert action;
- 422 `accountId`, `CONVERSION_REJECTED`, 409 and `ALREADY_CONVERTED` are localized, with no correlation id or raw text shown.

**Test hygiene.** Converted accounts and contacts reference each other (`contactPartnerSet` ↔ `mainPartner`), so the probe detaches them first. `probe_fixtures` also removes what Axelor records for a test user's requests: sequence reservations (`ReservedSequence`) and logged errors (`TraceBack`; the losing side of a concurrent conversion is logged there).

## 5. Not done here (tracked)

| Item | Why / where |
|---|---|
| Lead capture, qualification, assignment and activities in the custom UI | next Wave 2 slices; native Axelor screens remain available to maintenance users |
| Duplicate-account detection before creating an account | needs a matching rule (name/tax id/e-mail): policy, not engineering |
| Scope rules for leads and partners in production | D-07; the mechanism is native permission conditions (SEC-003) |
| Address capture during conversion | the DTOs carry no address; the native rule rejects an incomplete lead address with 422 |
| PII fields (e-mail, phone) on contacts | G-007: classification and masking first |
| Versioned migration for the two new columns | G-008 (dev uses `ddl=update`) |
| Account 360: quotes, contracts, invoices, activities | Waves 3–4 |
