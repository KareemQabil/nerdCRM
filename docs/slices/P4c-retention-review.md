# P4c: retention review queue (D-07)

Status: implemented and checked against the real backend.
- `scripts/retention_probe.py` passes 21/21 (backend CI) with complete cleanup.
- Unit tests: `RetentionRulesTest` 5/5.
- Mocked browser suite: `tests/retention.spec.ts` 3/3, including axe (WCAG 2.1 A/AA, light and dark) and a 390 px phone.
- Migration chain: `scripts/db_migrate.py verify` 8/8 with `V024__ioeti_privacy_retention.sql`.
- PII DTO audit: 0 problems.

D-07 (signed 2026-10-25) says:
- **Retention:** periods are policy settings per data type.
- When a period runs out, the record is **flagged for review**.
- Records are **never removed automatically**.

## The rule and its setting

The period is the existing policy `privacy.retention` (months, 1–600), set per data type by a policy owner under Policies.
**Nothing is shipped.**

A data type without a period:
- is reported as **"not set"**, never as "nothing to review";
- has its queue and decisions refused with `422 POLICY_NOT_SET`.

Retiring a period closes its queue again.

| Data type | The record | Its last activity (the latest of) |
|---|---|---|
| `LEADS` | the native CRM lead | the lead, its follow-ups (native events) |
| `CANDIDATES` | the recruitment candidate | the candidate, its applications, its private profile |
| `TRAINEES` | the person (native partner) enrolled on a course | the person, their enrolments, the end of their cohorts |
| `DONORS` | the donor profile | the profile, the person, funding opportunities, stewardship, money collected |
| `CONTACTS` | a native contact (`Partner.isContact`) | the contact, follow-ups with them |

A record is **due** when its last activity is on or before *today minus the period*. Due records are listed with the date
they became due, the longest overdue first (200 at a time, with the total).

**Listing changes nothing.** There is no job: the queue is computed when it is read.

## Who

**Policy owners only.** The queue reads every record whatever its owner or business line, and anonymizing cannot be undone.
- Everyone else answers `403`, technical administrators included, unless they are also policy owners.
- Hiding the menu entry is not the control: the server checks every call.

## Decisions (one record at a time)

Every decision is one append-only row in `ioeti_privacy_decision`, with:
- the reason;
- who decided, and when;
- the record's last activity;
- the **policy version** it was made under.

The record's name is **not** copied into the log, so an anonymized person does not survive there. The decision and the change
it makes are one transaction. The record's row is locked (`FOR UPDATE`), so two reviewers cannot decide the same record at once.

A record that is not due is refused with `422 NOT_DUE`: still within its period, kept, or already anonymized. This stops the
endpoints being used on arbitrary records.

### Keep

- A reason (at most 500 characters) is required.
- A **review-again date** is required: after today, and at most **one more period** away.
- The record leaves the queue until that date, and comes back then if it is still due.

### Anonymize (leads and candidates)

The person's details are overwritten **in place** with "Anonymized". **The record and its business history stay.**

| Data type | What is overwritten |
|---|---|
| Lead | Name, first name, title, company and office name, department, phones, website, picture and the notes fields. Also the search key. The e-mail and the address are scrubbed only when no contact shares them; otherwise the lead lets go of them. |
| Lead history | The lead's tracking messages and comments, its follow-ups (subject, description, place) and their messages, drafted outbound messages, and in-app notices about it. |
| Candidate | Name, current role and years of experience. Its private profile: e-mail, phone, expected salary, CV reference. Its messages and notices. |

It is written as SQL on purpose. Saving through the ORM would make the native change tracking write a **new** message holding
the old name, after the old messages had been scrubbed.

Anonymizing is refused in two cases:
- **`FILES_FILED`:** documents are filed on the record. A document's content cannot be anonymized here, and revisions are
  never deleted. The record can still be kept.
- **`ANONYMIZE_NOT_AVAILABLE`:** trainees, donors and contacts. They are shared partner records that invoices, receipts and
  certificates point to. What accounting must keep about them is not decided, so they can only be kept.

## API

| Method | Path | Answer |
|---|---|---|
| GET | `/ws/ioeti/privacy/retention` | Per type: set or not, months, policy version, due count (null when not set) |
| GET | `/ws/ioeti/privacy/retention/{type}` | The due records, or `422 POLICY_NOT_SET` |
| POST | `/ws/ioeti/privacy/retention/{type}/{id}/keep` | `{reason, reviewAgainOn}` |
| POST | `/ws/ioeti/privacy/retention/{type}/{id}/anonymize` | `{reason}` |
| GET | `/ws/ioeti/privacy/retention/decisions` | The latest 100 decisions |

## Screen

Administration › **Retention review** (policy owners only):
- **A tile per data type:** its period, and how many records are due, or "period not set".
- **The chosen type's queue:** name, last activity, due since, and the Keep and Anonymize buttons.
- **Anonymizing needs** a reason and an explicit "I understand this cannot be undone".
- **Types that can only be kept** say why.
- **The decision log** shows each record by number, never by name.

## Found while building it

- **The native e-mail row's name is NOT NULL.** The first probe run found it. Scrubbing the address alone failed, and the
  whole decision rolled back with nothing half-changed. The anonymized address is now written to both columns.
- **Policy changes are in the admin change log.** The probe cleans them up like the other policy probes, and the fixture
  partners' tracking messages too.

## Open questions for the owners (not decided by engineering)

1. **The clock.** Retention runs from a record's **last activity**, as defined in the table above. If the owners want it to
   run from creation, or from the end of the relationship, only `RetentionService.SOURCES` changes.
2. **Who reviews.** Policy owners only. A separate privacy-reviewer role can be added if the owners want one.
3. **Shared partner records** (trainees, donors, contacts). They can be kept, not anonymized, until accounting's own retention
   is decided.
4. **Consent evidence.** Lead and candidate consent records keep their method and evidence reference after anonymization,
   as proof of lawful contact. How long consent evidence is kept is part of the same D-07 retention question.
5. **Documents filed on a record** block anonymization. Removing a document revision would need its own decision; revisions
   are never deleted today.
