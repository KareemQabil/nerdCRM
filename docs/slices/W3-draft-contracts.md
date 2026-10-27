# Wave 3 (part 2b): draft customer contracts; signature and handover fail closed

Status: LIVE_INTEGRATION_PASS and NEGATIVE_SECURITY_PASS on Axelor 9.1.10 + PostgreSQL 16 (`scripts/quote_probe.py`, section 7, also in backend CI).

**Policy-blocked, fail-closed (D-11):** signing or activating a contract, and handing it over to operations. Roles and master data are test fixtures.

## 1. What the slice does

The native model is the AOS `axelor-contract` `Contract`; `ioeti-commercial` now also depends on that upstream module.

| Endpoint | What it does |
|---|---|
| `GET /ws/ioeti/contracts?opportunityId=`, `GET /ws/ioeti/contracts/{id}` | Contracts in the caller's scope (hidden = missing) |
| `POST /ws/ioeti/contracts` `{opportunityId, opportunityVersion, contractType: BILLING\|FRAMEWORK}` | Draft customer contract through the native `ContractService.generateContractFromOpportunity`. The contract type is the user's explicit choice, because the native wizard leaves it to the user too. |
| `POST /ws/ioeti/contracts/{id}/activate` | **422 `BLOCKED_BY_POLICY` (D-11)** |
| `POST /ws/ioeti/contracts/{id}/handover` | 422 `CONTRACT_NOT_ACTIVE` for a contract that isn't active; otherwise **422 `BLOCKED_BY_POLICY` (D-11)** |

**One contract per opportunity, also under concurrency.** AOS checks this only in its form (`checkContractIsGenerated`), and that check is not atomic. IOETI locks the opportunity row with `PESSIMISTIC_FORCE_INCREMENT` before checking. The second of two concurrent requests then answers 409, and a later attempt answers 409 `CONTRACT_EXISTS`.

**Company.** Same native default as for quotations. The contract number comes from the company's contract sequence. Without one, the native repository fails inside a `PersistenceException`.

**Error mapping, now shared.** `NativeCommands` finds an `AxelorException` anywhere in the cause chain: a direct throw, an `ObserverBaseException`, or a `PersistenceException`. Configuration errors answer `SETUP_REQUIRED`, other native rules the command's own code, and the native message goes only to the server log, with the correlation id.

**UI.** A *Contract* section on the opportunity page (real mode only):
- with no contract: a type choice and *Create draft contract*;
- with a contract: reference, status, type and account, and disabled *Sign & activate* and *Hand over to operations* buttons with the D-11 explanation;
- the fictional demo is unchanged.

## 2. Evidence

`scripts/quote_probe.py`: 35 → **44/44**. The 9 contract checks:
1. No company for the user: 422 `SETUP_REQUIRED`, nothing created.
2. Bad type, no account, or stale version: 422, 422 `ACCOUNT_REQUIRED`, 409, and nothing created.
3. Another rep's opportunity gets the same 404 as a missing id; read-only gets 403; nothing created.
4. Draft created: status DRAFT, the chosen type, a reference from the fixture's contract sequence, links to opportunity and account, activation `BLOCKED_BY_POLICY`.
5. Persisted natively as a customer contract: draft, account, opportunity, company.
6. A second contract for the same opportunity: 409 `CONTRACT_EXISTS`, still exactly one.
7. **Two sessions create at the same time**: one 201 and one 409, exactly one contract.
8. Reads: the owner lists it; another rep gets 404 for the contract and for the opportunity's list.
9. Activation gives 422 `BLOCKED_BY_POLICY`; handover of a draft gives 422 `CONTRACT_NOT_ACTIVE`; still a draft.

JUnit:
- `ContractRulesTest` (2): type choice and stable status values;
- `QuoteRulesTest`: also covers a native refusal wrapped in a `PersistenceException`.

UI, mocked:
- `SETUP_REQUIRED` is localized, with no correlation id shown;
- the draft is created with the chosen type and the opportunity version;
- signature and handover are disabled, with the D-11 text.

The record-page test now asserts the connected quotation and contract sections, instead of the earlier "not connected yet" placeholder.

**Test hygiene.** The generic API cannot delete a contract: `currentContractVersion` is mandatory, and Hibernate hits an AssertionFailure on the one-to-one cascade. `probe_fixtures.delete_contract` therefore deletes test contracts and their versions with targeted SQL in the disposable PostgreSQL container (local and CI only). Fixture sequences are removed with their reservations.

## 3. For the owner

Contracts in production need, per IOETI company:
- a **contract number sequence** (AOS sequence code `customerContract`);
- optionally, **contract templates**. These are legal text and owner data, so none is invented.

## 4. Not done here

| Item | Why / where |
|---|---|
| Signature, legal approval, activation, signed-contract evidence (attachments) | D-11; secure record-scoped attachments are part of the DMS work |
| Operations handover (native `axelor-project` project or task) | needs an active contract (D-11) |
| Contract lines and versions from the quotation | next contract slice; native `ContractLine` / `ContractVersion` |
| Contract invoicing | D-06 |
