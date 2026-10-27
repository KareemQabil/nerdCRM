# Open IOETI policy decisions (D-01 to D-12)

These decisions belong to IOETI's owners, accountants, legal advisers and certification authority. **Engineers must not invent them.** Until a decision is signed:
- the affected command stays behind a feature gate and fails closed with an explicit "blocked by policy" result;
- modelling, read paths and tests that do not depend on the decision may proceed;
- any default used anywhere is a **test fixture only**, never production configuration.

Status values: `OPEN` (no answer), `PROPOSED` (an engineering proposal awaits owner signature), `SIGNED` (answer recorded with date and signer), `DEFERRED` (owner-approved deferral).

All twelve were signed on 2026-10-25 (see *Signed decisions* below). What was signed is the structure of each rule; the values themselves (rates, thresholds, periods) are policy settings the policy owners enter under Policies, and every workflow that needs one stays refused until it is set.

| ID | Decision needed | Blocks (fail-closed) | Proceeds without it | Status |
|---|---|---|---|---|
| D-01 | **Missing specification.** Official chapters after section 9, and the "JSON workflow map" mentioned in the handoff (the owner said none exists). | Treating handoff-only requirements as signed acceptance criteria | Spec 1–9 slices, and handoff items marked provisional | SIGNED |
| D-02 | **External ISO certification.** Schemes, accreditation body, impartiality and competence rules, decision authority, certificate numbering, validity, suspension/withdrawal, surveillance intervals, public verification. | Certification decision, certificate issuance/reissue/revoke, public verification | Cycle/site/scope/audit-programme modelling, auditor competence records, NC/CAPA capture, fail-closed decision gate and its tests: **built** in `ioeti-certification` (Wave 4b). Fail closed: `POST /ws/ioeti/certification/cycles/{id}/decision`, `…/certificate`, and planning SURVEILLANCE or RECERTIFICATION audits answer 422 `BLOCKED_BY_POLICY` | SIGNED |
| D-03 | **External training.** Attendance threshold, assessment pass rules, eligibility, cancellation/refund, certificate wording and serials, national-ID collection and retention. | Training certificate issuance, refunds, storing national IDs | Course/cohort/session/enrolment, capacity and waitlist, attendance capture: **built** in `ioeti-training` (Wave 4a). Fail closed: `POST /ws/ioeti/training/enrollments/{id}/certificate` and `POST /ws/ioeti/training/cohorts/{id}/cancel` answer 422 `BLOCKED_BY_POLICY`; national IDs are not modelled | SIGNED |
| D-04 | **Client recruitment.** Lawful basis and consent wording, per-client fee structure, guarantee period and replacement rules, CV/salary retention. | Submitting a candidate to a client, fee invoicing, guarantee claims | Job orders, candidate records without submission, consent capture UI behind the gate | SIGNED |
| D-05 | **Fundraising.** Receipt rules, restricted-fund accounting, donor privacy, approval chain. | Issuing donation receipts, posting restricted funds | Donor/grant/pledge records, kept separate from received cash | SIGNED |
| D-06 | **Finance.** Invoicing-only vs Axelor accounting vs external system; Egyptian VAT/WHT and ETA e-invoicing; currency policy. Also the company's sales/accounting setup: with the AOS account app installed, every quoted product needs a sales ledger account. | Invoice issuance, tax computation and tax amounts on quotations, e-invoice submission, finalizing quotations | Payment milestones, invoice *requests*, booked/invoiced/collected reporting vocabulary | SIGNED |
| D-07 | **Roles and access.** Named roles and their action × scope × field matrix, business-line membership and **opportunity-create eligibility**, delegation and expiry, MFA policy, data retention. | Production role configuration, delegation, MFA enforcement | The scope mechanism (Own/Team/Line/All) with test-only fixtures, negative tests. **PROPOSED (fail-closed, in force):** only administrators and members of a line (`User.ioetiBusinessLines`) may create opportunities in it (SEC-003, `docs/security/SEC-003-scopes.md`). | SIGNED |
| D-08 | **Hosting and operations.** Production host/domain/TLS ownership, backup encryption and off-site storage, RPO/RTO, monitoring owner. | Any production deployment | Local/CI environments, runbook drafts, backup/restore scripts tested on disposable data | SIGNED |
| D-09 | **V1 scope and UAT.** Which business lines go live first, mandatory V1 functions, UAT participants and sign-off. | Go-live, real customer data | Engineering of all policy-independent slices | SIGNED |
| D-10 | **External exposure.** Public certificate/training verification, client portal, public intake forms, external integrations (WhatsApp/Meta/LinkedIn, e-signature, payments, SSO). | Every public or third-party integration | Internal, authenticated features only | SIGNED |
| D-11 | **Commercial approvals, quotation terms and contract signature.** Who approves a quotation and at which value/discount, quotation validity, standard terms and conditions, who may send to the customer; legal review and who may sign/activate a customer contract; what evidence of signature is required; when a deal is handed over to operations. | Finalizing or sending a quotation (`POST /ws/ioeti/quotes/{id}/finalize`), activating/signing a contract (`POST /ws/ioeti/contracts/{id}/activate`) and operations handover (`…/handover`): 422 `BLOCKED_BY_POLICY` | Draft quotations, catalog lines, totals before tax, payment milestones, draft contracts (Wave 3) | SIGNED |
| D-12 | **Lead response and routing.** Response-time targets per business line or source (first contact, qualification), working hours and holidays they count, who is alerted or receives the lead when a target is missed, and how new leads are distributed (round robin, territory, line, manual). | Response-time timers, escalation and reminders; assigning or reassigning a lead to someone else (`POST /ws/ioeti/leads/{id}/assign` with another `userId`: 422 `BLOCKED_BY_POLICY` citing D-07 and D-12, because routing also needs the role matrix) | Lead stages, lose/reopen, assign-to-me, the received time on every lead (`receivedAt`), the unassigned queue as a test fixture | SIGNED |

## Signed decisions (owner interview, 2026-10-25)

Signer: the project owner, answering a structured interview in the engineering session on 2026-10-25. Each answer is recorded as given. Where the owner asked engineering for a recommendation, the recommendation and the owner's approval are both recorded.

### P — the governing principle (applies to every decision below)

1. **Every business rule is a configurable policy, never hard-coded.** This covers tax rates, discount and approval thresholds, validity periods, certificate rules, attendance and pass marks, SLAs, fees, retention periods and the like.
   - Policies live in one *Policies* area of the admin console. **None are shipped.**
   - The code reads the policy in force and **fails closed** (`422 POLICY_NOT_SET`) until it is set.
2. **Who may change a policy:** only people holding the dedicated **policy-owner** permission. Technical administrators cannot change business rules unless they also hold it. Every change is audited.
3. **Policies are effective-dated.** A change applies from its effective date, and a record keeps the policy version it was created under.

### Per decision

| ID | Decision (owner's answer) |
|---|---|
| D-01 | No further specification documents. **The decisions recorded here, plus what is already built, are the accepted requirements**; gaps found later are raised as questions. |
| D-02 | Certification decisions (grant, suspend, withdraw) support **both** an independent reviewer and a committee of N. The mode is chosen **per scheme by the policy owner** (to be confirmed by the quality manager against the accreditation body's requirements). **The decision-maker can never have been on that client's audit team** (always enforced). Fail closed until the mode is set. Certificate numbering, validity, surveillance intervals and suspension/withdrawal rules are policy settings per scheme. A public certificate check is approved (see D-10). Engineering recommended this design; the owner approved it. |
| D-03 | **The training coordinator issues certificates** after reviewing who meets the course's criteria (attendance % and pass mark are per-course policy settings). **National ID is optional per course** (not asked / optional / required), stored as restricted data. **Cancellations and refunds:** the refund is computed from the cancellation policy (deadlines and percentages are settings), **approved by finance and issued as a credit note** in accounting. Engineering recommended this; the owner approved it. |
| D-04 | A candidate's CV and contact details are shared with a client **only with the candidate's recorded consent for that job order, and only through the client portal**. No attachments are e-mailed, and every view is logged. **When the placement fee is invoiced** (start date or offer accepted), the fee %, the guarantee period and the replacement rules are **policy settings per client agreement**. |
| D-05 | **Finance issues donation receipts**, only after the money is recorded as collected. **Restricted funds are posted to separate analytic accounts per restriction** in accounting. |
| D-06 | **Full Axelor accounting** (journals, chart of accounts, ledgers). **ETA e-invoicing is not in V1.** Tax rates are **policy settings, not hard-coded**. **Multi-currency with conversion to EGP:** rates come from a **public source**, with a **manual override** by finance when the source is wrong or unavailable. The source itself is a setting. |
| D-07 | Roles: **editable role templates**, deny by default (sales rep, sales manager, GM, marketing, operations, auditor/trainer, finance, fundraising, read-only, policy owner). **MFA is optional** (users may turn it on). **Retention:** periods are policy settings per data type; when a period runs out the record is **flagged for review**, never removed automatically. |
| D-08 | **Production on Railway.** Backups: **encrypted daily, kept off-site**, so at most 24 h of data can be lost; restores are tested monthly. Production deployment itself still waits for an explicit go from the owner. |
| D-09 | V1 business lines: **ISO certification, training, recruitment and fundraising**. Go-live with real data waits for an explicit go from the owner. |
| D-10 | Approved for V1, each behind its own settings and credentials:<ul><li>public lead forms</li><li>public certificate check</li><li>client portal</li><li>public course sign-up</li><li>e-mail sending</li><li>WhatsApp Business</li><li>e-signature</li><li>online payments</li></ul>Consent and opt-outs always apply. Credentials are environment secrets, never in the repository. |
| D-11 | **Quotation approval is tiered by thresholds.** Each tier's limits (discount %, value) and approver role are settings. **The rep sends the finalized quotation themselves** and records it as sent; the platform does not e-mail quotations. **Contract signature evidence:** an uploaded signed scan **or** an e-signature completion; an authorized person then activates the contract. **Won** requires evidence of a binding commitment. Each business line sets whether that is an **active contract** or an **accepted quotation / purchase order with uploaded evidence**, and a line without the setting cannot mark Won. Engineering recommended this; the owner approved it. |
| D-12 | Leads are **routed by rules** (business line, governorate, source → team), then **round-robin inside the team**, skipping people on leave or at their workload cap. Response-time targets are settings per line and source, counted in working hours. **When a target is missed, the line's manager gets an in-app notice and the lead is flagged overdue. Nothing is reassigned automatically.** |

## Engineering notes awaiting owner review

- **D-04 (2026-10-20, Wave 4D):** the brief for Wave 4D asks for "submit an explicitly authorized candidate to the client", with externally consequential sharing kept fail-closed. Engineering therefore implemented submission as a recorded step that needs the recruiter's write access, a shortlisted candidate and an **unrevoked consent for that job order**. Only the non-restricted profile (name, current role, years of experience) can be presented; sharing the CV or contact details, offer terms, fees, invoices, guarantee and replacement stay `BLOCKED_BY_POLICY`. This is narrower than the "Blocks" column above, which lists submission itself. If the owners decide that no presentation may happen before the consent wording is approved, `POST /ws/ioeti/recruitment/applications/{id}/submit` is the single command to close. The decision status stays OPEN.

- **D-11 (2026-10-20, Wave 5):** the operations handover workflow (`/ws/ioeti/operations`) accepts only **active (signed)** contracts. Contract activation stays `BLOCKED_BY_POLICY`, so in production no handover can start until D-11 is signed; the checklist each business line requires is configuration the owners maintain, and a line without one cannot hand over. Probes make a contract active with SQL in the disposable database as a stand-in for the signature (test fixture only). Whether a payment or other financial prerequisite must come before handover (D-06/D-11) is not assumed; it can be added as a checklist item once decided. The decision status stays OPEN.

- **Lead contact consent (2026-10-20, Wave 6):** `ioeti-marketing` records consent and opt-outs per channel (e-mail, calls) with the method and an evidence reference (required for consent, not for an opt-out). The native do-not-email/do-not-call flags hold the current state. Engineering did **not** decide the lawful basis, the consent wording, how long consent evidence is kept (D-07 retention), or whether an opt-out on one lead must apply to every record of the same person. Nothing is sent from the CRM: outbound channels are D-10, and automatic reminders, routing and escalation are D-12. Duplicate leads are reviewed but not merged, because merging changes ownership and history (D-07).

- **D-11 implemented (2026-10-25, P3a and P3b):** the approval tiers, the validity period, who activates a contract
  (`sales.contract-signatory`, added so the signatory is a setting like the other D-11 rules) and the won evidence are
  policies the owners set; nothing is shipped.
  - Quotations are finalized natively under their tier and recorded as sent by the rep (P3a, `docs/slices/P3a-quote-approvals.md`).
  - A client's acceptance on uploaded evidence confirms the order natively. A contract is activated natively on its signed
    copy by the signatory role (P3b, `docs/slices/P3b-commitments.md`).
  - The operations handover now starts from a contract activated this way. Probes that make a contract active or confirm an
    order with SQL keep doing so as test fixtures, because they test other steps.
  - E-signature completion (D-10) is a later channel.

## Related, owner-only actions (not engineering decisions)

- Send, or decide not to send, the private upstream report for the AOP thread-bound identity issue. The draft is held outside the repository; see PR #9.
- Decide whether `docs/upstream-issues/AOP-thread-bound-user-leak.md`, which has been public on `main` since the first push, stays public.

## How engineering records a signed decision

For each signed decision, add the date, the signer and the exact rule. Link the PR that turns the fail-closed gate into the approved behaviour, together with its tests. Never edit a decision silently.
