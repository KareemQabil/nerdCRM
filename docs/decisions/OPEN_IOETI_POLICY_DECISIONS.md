# Open IOETI policy decisions (D-01 to D-10)

These decisions belong to IOETI's owners, accountants, legal advisers and certification authority. **Engineers must not invent them.** Until a decision is signed:
- the affected command stays behind a feature gate and fails closed with an explicit "blocked by policy" result;
- modelling, read paths and tests that do not depend on the decision may proceed;
- any default used anywhere is a **test fixture only**, never production configuration.

Status values: `OPEN` (no answer), `PROPOSED` (an engineering proposal awaits owner signature), `SIGNED` (answer recorded with date and signer), `DEFERRED` (owner-approved deferral).

| ID | Decision needed | Blocks (fail-closed) | Proceeds without it | Status |
|---|---|---|---|---|
| D-01 | **Missing specification.** Official chapters after section 9, and the "JSON workflow map" mentioned in the handoff (the owner said none exists). | Treating handoff-only requirements as signed acceptance criteria | Spec 1–9 slices, and handoff items marked provisional | OPEN |
| D-02 | **External ISO certification.** Schemes, accreditation body, impartiality and competence rules, decision authority, certificate numbering, validity, suspension/withdrawal, surveillance intervals, public verification. | Certification decision, certificate issuance/reissue/revoke, public verification | Cycle/site/scope/audit-programme modelling, auditor competence records, NC/CAPA capture, fail-closed decision gate and its tests | OPEN |
| D-03 | **External training.** Attendance threshold, assessment pass rules, eligibility, cancellation/refund, certificate wording and serials, national-ID collection and retention. | Training certificate issuance, refunds, storing national IDs | Course/cohort/session/enrolment, capacity and waitlist, attendance capture | OPEN |
| D-04 | **Client recruitment.** Lawful basis and consent wording, per-client fee structure, guarantee period and replacement rules, CV/salary retention. | Submitting a candidate to a client, fee invoicing, guarantee claims | Job orders, candidate records without submission, consent capture UI behind the gate | OPEN |
| D-05 | **Fundraising.** Receipt rules, restricted-fund accounting, donor privacy, approval chain. | Issuing donation receipts, posting restricted funds | Donor/grant/pledge records, kept separate from received cash | OPEN |
| D-06 | **Finance.** Invoicing-only vs Axelor accounting vs external system; Egyptian VAT/WHT and ETA e-invoicing; currency policy. | Invoice issuance, tax computation, e-invoice submission | Payment milestones, invoice *requests*, booked/invoiced/collected reporting vocabulary | OPEN |
| D-07 | **Roles and access.** Named roles and their action × scope × field matrix, business-line membership and **opportunity-create eligibility**, delegation and expiry, MFA policy, data retention. | Production role configuration, delegation, MFA enforcement | The scope mechanism (Own/Team/Line/All) with test-only fixtures, negative tests | OPEN |
| D-08 | **Hosting and operations.** Production host/domain/TLS ownership, backup encryption and off-site storage, RPO/RTO, monitoring owner. | Any production deployment | Local/CI environments, runbook drafts, backup/restore scripts tested on disposable data | OPEN |
| D-09 | **V1 scope and UAT.** Which business lines go live first, mandatory V1 functions, UAT participants and sign-off. | Go-live, real customer data | Engineering of all policy-independent slices | OPEN |
| D-10 | **External exposure.** Public certificate/training verification, client portal, public intake forms, external integrations (WhatsApp/Meta/LinkedIn, e-signature, payments, SSO). | Every public or third-party integration | Internal, authenticated features only | OPEN |

## Related, owner-only actions (not engineering decisions)

- Send, or decide not to send, the private upstream report for the AOP thread-bound identity issue. The draft is held outside the repository; see PR #9.
- Decide whether `docs/upstream-issues/AOP-thread-bound-user-leak.md`, which has been public on `main` since the first push, stays public.

## How engineering records a signed decision

For each signed decision, add the date, the signer and the exact rule. Link the PR that turns the fail-closed gate into the approved behaviour, together with its tests. Never edit a decision silently.
