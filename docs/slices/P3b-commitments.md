# P3b: client acceptance, contract activation and won on evidence (D-11)

Status: implemented and checked against the real backend.
- `scripts/commitment_probe.py` passes 7/7 (backend CI), twice in a row with complete cleanup.
- Mocked browser tests cover activation, the non-signatory view, acceptance and the won refusal, with no horizontal overflow
  at 390 px.

D-11 (signed 2026-10-25) says:
- A deal becomes binding on evidence: a signed quotation or purchase order, or a contract signed by scan (e-signature is a
  later D-10 channel), activated by an authorized person.
- **Won** requires the evidence each business line sets.

No role or rule is shipped. The owners set the policies below; until they do, these steps fail closed (`422 POLICY_NOT_SET`).

## Policies used

| Policy | Scope | What it holds |
|---|---|---|
| `sales.contract-signatory` (new) | business line or default | The role that activates contracts: `SALES_MANAGER` (role `ioeti-sales-manager`) or `GM` (role `ioeti-gm`). |
| `sales.won-evidence` | business line, no default | `ACTIVE_CONTRACT` or `ACCEPTED_QUOTE`. A line without it cannot mark won. |

## Evidence

- **Where it lives:** a document filed on the record through the documents module (`RecordDocument`), on the quotation or on
  the contract. That gives upload checks (type sniffing, 10 MiB), immutable revisions and access that follows the record.
- **How it is pinned:** the commitment stores the document, its revision number and the revision's SHA-256. A later revision
  does not change what was relied on.
- **Refused:** a document filed on another record, an archived one, or a missing one (`422 documentId`).

## Client acceptance

`POST /ws/ioeti/workspace/quotes/{id}/accept {version, kind, reference, acceptedOn, documentId}`

- **Who:** native write rights on the quotation.
- **`kind`:** `SIGNED_QUOTE` or `PURCHASE_ORDER`. A purchase order needs its number (`reference`).
- **Checks:**
  - The quotation is finalized (`QUOTE_NOT_FINALIZED`).
  - The acceptance date falls between the finalizing date and today.
  - The quotation was still valid on that date (`QUOTE_EXPIRED`).
- **Native:** `SaleOrderConfirmService.confirmSaleOrder` confirms the order. Payment milestones can then be invoiced through the
  existing request → issue flow (D-06).
- **Recorded:** kind, number, date, evidence (document, revision, hash), who recorded it and when.

## Contract activation

`POST /ws/ioeti/workspace/contracts/{id}/activate {version, signedOn, startOn?, documentId}`

- **Who:** native write rights on the contract, and the role the line's `sales.contract-signatory` names.
  - Without the policy: `POLICY_NOT_SET`.
  - Without the role: `403 NOT_SIGNATORY`.
- **Checks:**
  - The contract is a draft (`CONTRACT_NOT_DRAFT`).
  - The signature date is not in the future.
  - The start date (default: the signature date) falls between the signature date and today.
- **Native:** `ContractService.ongoingCurrentVersion` activates the current version from the start date.
- **Recorded:** the evidence (document, revision, hash), the signature date, who activated it and when, and the signatory policy
  version.
- **Contract view:** gains `activation`:
  - `SIGNED`: with the record above;
  - `ACTIVE`: activated before D-11;
  - `POLICY_NOT_SET`;
  - `NOT_SIGNATORY`: names the role;
  - `READY`.
- **Old stubs removed:** `POST /ws/ioeti/contracts/{id}/activate` and `…/handover` were `BLOCKED_BY_POLICY` stubs.
  - Activation is the workspace command above.
  - The handover to operations is `POST /ws/ioeti/operations/handovers` (Wave 5), which already requires an active contract.
- **Contract reviews:** a contract is approved by activating it, so approving or rejecting a contract review answers
  `422 USE_CONTRACT_ACTIVATION`.

## Won

- **Where:** `POST /opportunities/{id}/stage` to the won stage asks the commercial module through a `WonEvidence` interface
  (business lines → commercial). Without that module the default fails closed.
- **Rule:**
  - Without the line's `sales.won-evidence`: `POLICY_NOT_SET`.
  - `ACTIVE_CONTRACT`: a contract of the opportunity activated on signature evidence.
  - `ACCEPTED_QUOTE`: a quotation of the opportunity accepted with evidence.
  - Otherwise: `422 WON_EVIDENCE_MISSING`.
- **A won opportunity:** cannot be moved to another stage or lost.

## Screens

- **Quotation card:** once finalized, a "Client acceptance" box. It shows the documents filed on the quotation (upload the
  signed copy or purchase order there) and a form for the kind, number, date and evidence. After acceptance it shows what the
  acceptance was recorded on, with a link to that document revision.
- **Contract card:** a "Signature and activation" box. It uses the same documents panel (filed on the contract) and shows:
  - the signatory policy state, or who activates when the caller does not;
  - the activation form for the signatory;
  - once active, the signature record and a "Request handover to operations" button.
- **Opportunity stage path:** the won step is now a button. A refusal names the missing evidence.
- **Operations:** its empty state says how a contract becomes active.

## Data

Migration `V023` (rollback `U023`):
- `sale_sale_order` gains the acceptance columns.
- `contract_contract` gains the signature and activation columns.

## Changed expectations

| Probe | Before | Now |
|---|---|---|
| `quote_probe.py` | `BLOCKED_BY_POLICY` for activation | activation without evidence → `422 documentId`; the old stub → 404 |
| `operations_probe.py` | `BLOCKED_BY_POLICY` for activation | activation without evidence → `422 documentId` |
| `daily_work_probe.py` | won → `BLOCKED_BY_POLICY` | won without the line's setting → `POLICY_NOT_SET` |
| `workspace_probe.py` | contract approval → `BLOCKED_BY_POLICY` | contract approval → `USE_CONTRACT_ACTIVATION` |

All four pass against the live backend.

## Not in this slice

- E-signature completion and sending from the platform (D-10).
- Taking down the SQL stand-ins for order confirmation and contract activation in older probes. They test other steps (handover,
  invoicing) and keep the fixture.
