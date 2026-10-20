# G-007: personal data classification and masking

Status: ENGINEERING_CONTROLS_PASS (gate with negative controls in backend CI, `PiiMaskerTest` 4/4). Engineering controls in place for the IOETI API and its logs. The retention period, lawful basis and the field-level role matrix are owner decisions (D-07 and, for recruitment and training data, D-03 and D-04); nothing here sets them.

## 1. Classes

| Class | Meaning | Examples | Allowed in an API response | Allowed in logs |
|---|---|---|---|---|
| `REFERENCE` | ids, versions, codes, statuses, flags, fixed messages | `id`, `version`, `stageKind`, `taxStatus` | yes | yes |
| `BUSINESS` | commercial data about organizations, products, amounts, dates | opportunity name, product, totals before tax, `receivedAt` | yes, within record permissions | yes |
| `PERSONAL` | names and roles that identify a person: leads, contacts, individual accounts, users | lead `name`, contact `name` and `jobTitle`, `accountName`, session `code`/`name` | yes, only through record permissions and DTO allowlists | user codes in security events only; never bulk |
| `RESTRICTED` | contact details, identity numbers, personal money, free text about a person | e-mail, phone, address, national ID, salary, CV, notes | **never** | **masked** |

Account and quotation `accountName` are `PERSONAL`, not `BUSINESS`: an AOS partner can be an individual.

## 2. Controls

1. **Registry and gate.** `docs/security/pii-classification.json` classifies every field of every record in an IOETI REST package (`modules/ioeti-*/…/rest|web|api`). `scripts/pii_dto_audit.py` reads the Java sources and fails, in CI, when:
   - a field has no class (a new field must be classified in the same PR);
   - a response record (`…View`, `…Plan`, `…Response`, `SessionIdentity`, `FieldError`) holds a `RESTRICTED` field;
   - a field named like contact or identity data, money about a person or free text (`email`, `phone`, `address`, `national`, `salary`, `note`, …) is classified as anything but `RESTRICTED`;
   - the registry lists a field that no longer exists.
2. **Response allowlists at runtime.** The live probes compare every lead, account, contact, catalog, quotation and contract response with a key allowlist. Examples: `opportunity_pilot_smoke.py`, `lead_conversion_probe.py`, `lead_lifecycle_probe.py`, `quote_probe.py`.
3. **Restricted input stays write-only.** The only `RESTRICTED` input today is the lost-lead note (`LoseLead.note`). It is stored natively (`Lead.lostReasonStr`) and never returned; `lead_lifecycle_probe.py` checks that it is absent from the response.
4. **Log masking.** `PiiMasker` (`ioeti-core`) replaces:
   - e-mail addresses;
   - Egyptian national IDs (14 digits starting with 2 or 3);
   - phone-like numbers (seven or more digits, with `+`, spaces, dots or dashes).

   It covers Latin, Arabic-Indic and Eastern Arabic-Indic digits, keeps ISO dates and times, and bounds the line to 500 characters. Dotted IPv4 addresses are masked as phone numbers too; that is intended, since a client IP is personal data. It is applied to the native AOS refusal messages that `NativeCommands` logs, because they can quote the refused record.
5. **Error responses carry no data.** The IOETI error contract (SEC-002) answers fixed messages and a correlation id. Native messages, SQL and stack traces stay in the server log.
6. **Public demo.** The Vercel demo uses fictional records only and never calls a real Axelor (see `AGENTS.md`).

## 3. Residual risk (not closed here)

| Risk | Why open | Owner / decision |
|---|---|---|
| Unexpected 500 errors log the full exception, including driver messages that may quote values (e.g. a unique-key violation) | Stack traces are needed for diagnosis. Masking belongs in the production log pipeline, together with retention and access. | D-08 |
| AOS's own screens (`/axelor-erp` UI, its REST) show native PII under native permissions | Native UI is admin-only in the pilot; generic `/ws/rest` is closed to non-admins (SEC-002) | D-07 |
| Retention and deletion of lead and contact data, consent wording | Policy | D-07, D-04 |
| Database and backup content | Backups are `age`-encrypted (G-009); production custody is a policy item | D-08 |

## 4. Adding a field

Classify it in `pii-classification.json` in the same PR. If it is `RESTRICTED`, it may only be an input. Expose it in a response only after D-07 names the roles that may see it, through a separate, audited endpoint.
