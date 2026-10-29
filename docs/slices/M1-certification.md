# M1: certification decision, certificates and public check (D-02, `ioeti-certification`)

Status: built and unit/UI tested; the live probe (`scripts/certification_probe.py`) is extended but has to be run by the
coordinator against a server restarted with this code. Signed decision: **D-02** (and **D-10** for the public check).
This replaces the `BLOCKED_BY_POLICY` gates of Wave 4b (`docs/slices/W4-iso-certification.md`).

## 1. Policies used (nothing is shipped)

| Policy | Scope | Fields | Used for |
|---|---|---|---|
| `cert.decision` | scheme = the cycle's standard code (business line), default allowed | `mode` INDEPENDENT_REVIEWER or COMMITTEE, `committeeSize` 2–9 | how a decision is taken |
| `cert.cycle` | scheme, default allowed | `validityMonths`, `surveillanceMonths` | certificate expiry and surveillance due dates |
| `channels.enabled` | company | `channels` contains `CERTIFICATE_CHECK` | public certificate check on/off |

While `cert.decision` or `cert.cycle` is not in force for the scheme, every decision (and every certificate change, and
surveillance/recertification planning) answers **422 `POLICY_NOT_SET`**, and the cycle shows the `POLICY_D02` blocker.
Recommended starting values already exist in R1 (independent reviewer; 36/12 months; no channel).

## 2. Rules

**Who may decide.** A person who
- holds the Axelor role **`ioeti-cert-decision-maker`** (directly or through their group, as approver roles do in
  `QuoteApprovalService`), is active, and can read the cycle; and
- **was never the auditor of any audit, of any cycle, of the same client** (any audit status). Always enforced.

Otherwise: no role → 403 `NO_DECISION_RIGHT`; auditor of the client → 403 `AUDITED_CLIENT`; cycle not readable → 404.
Decision makers do not need write access to the cycle; the vote carries the cycle's version (stale → 409).

**Readiness.** A vote needs Stage 1 and Stage 2 completed (422 `NOT_READY`). A GRANT also needs no open major
nonconformity; this is checked for each GRANT vote and again when the votes are tallied.

**Rounds and tally.** The first vote opens a round with the mode and size the policy gives *at that moment*; the round
keeps them even if the policy changes later.
- Independent reviewer: one vote decides (GRANT or REFUSE, with a reason).
- Committee of N: N distinct eligible people vote (one vote each, 409 `ALREADY_VOTED`). The decision is taken when the
  N-th vote is in. **GRANT needs a strict majority; a tie refuses** (certification is granted only when most of the
  committee says so).
- While a committee round is open, the panel shows who voted but **not how**; votes and reasons are shown once decided.
- After a REFUSE a new round may start (e.g. after more corrective action). After a GRANT: 409 `ALREADY_CERTIFIED`.
- Eligible people are told in-app when a cycle becomes ready (`CERT_DECISION_NEEDED`) and when a committee round opens
  (`CERT_VOTE_NEEDED`); the programme manager is told of the outcome and of certificate changes (`CERT_GRANTED`,
  `CERT_REFUSED`, `CERT_SUSPENDED`, `CERT_RESTORED`, `CERT_WITHDRAWN`). Subject `CERT_CYCLE`, title by cycle reference only.

**Certificate.** Issued in the same transaction as the GRANT:
- number `<SCHEME>-<YEAR>-<serial>` (4 digits, serial per scheme and issue year; allocated under a transaction lock per
  scheme and year, unique in the database). The format is fixed; `cert.cycle` has no numbering field;
- issue date = today; **expiry = issue date + `validityMonths`** (calendar months); status ACTIVE;
- surveillance due every `surveillanceMonths` from issue, strictly before expiry; recertification due by expiry;
- the policy versions in force are stored on the round and the certificate.

**Certificate life.** Suspend (ACTIVE → SUSPENDED), restore (SUSPENDED → ACTIVE), withdraw (ACTIVE or SUSPENDED →
WITHDRAWN, final). Each needs a reason and an eligible decision maker (same rule as deciding), the certificate's version
(409 when stale), and is kept in the certificate's history with who and when.

**Certificate changes follow the decision mode** (owner decision confirmed 2026-10-29). Independent reviewer: one eligible
person changes the certificate at once (as before). Committee of N: the request opens a *change round* (action, certificate,
requester and reason) with the requester's APPROVE vote; the other members vote APPROVE or REJECT
(`POST …/certificate/change-vote`, one vote each, 409 `ALREADY_VOTED`). When N votes are in, a strict majority applies the
change (event in the history with the requester and reason, notice `CERT_SUSPENDED`/`…` to the manager); a tie or a
majority against closes the round, nothing changes, the manager gets `CERT_CHANGE_REJECTED`. Members are told
(`CERT_CHANGE_VOTE_NEEDED`) when a round opens. One open change round per certificate: the same action again records the
caller's APPROVE; another action → 409 `CHANGE_PENDING`; a vote with no round open → 409 `NO_CHANGE_PENDING`. A round keeps
the mode and size it was opened with. Votes lock the cycle as grant votes do. Change rounds never count as grant rounds. Past its expiry a certificate reads EXPIRED
and cannot change (422 `CERTIFICATE_EXPIRED`); other wrong transitions → 422 `CERTIFICATE_STATE`.

**Surveillance and recertification audits** are no longer blocked: they need a certificate in force (active or
suspended; otherwise 422 `CERTIFICATE_REQUIRED`) and `cert.cycle`. The lead auditor rule is the same as Stage 1/2. One
surveillance audit may be planned at a time; one recertification audit per cycle. The UI pre-fills the next due date.

**Public check.** `GET /ws/public/ioeti/certificates/{number}`, no sign-in:
- only while `channels.enabled` contains `CERTIFICATE_CHECK`; otherwise the same 404 as an unknown number;
- exact number only (case-insensitive, `[A-Z0-9._/-]`, 3–60 characters), no listing, no search;
- returns `number`, `standardCode`, `clientName` (only when the client is a company), `status`
  (ACTIVE/SUSPENDED/WITHDRAWN/EXPIRED), `expiresOn`;
- 30 checks a minute per client address (`ioeti.certificate-check.per-minute`; `X-Forwarded-For` believed only from
  `ioeti.security.trusted.proxies`), then 429 with `Retry-After`.

It sits under `/ws/public/**`, which Axelor's own security configuration already serves without sign-in (as for
`/ws/public/app/info`); no security setting was changed. The IOETI generic-API gate already allows `/ws/public`.

## 3. API (`/ws/ioeti/certification`)

| Endpoint | Notes |
|---|---|
| `GET /cycles/{id}/decision` | panel: `status` (BLOCKED_BY_POLICY, NOT_READY, AWAITING_DECISION, GRANTED, REFUSED), `missingPolicies`, `mode`, `requiredVotes`, validity/surveillance months, `blockers`, `canVote`, `canGrant`, `cannotDecideReason`, `eligibleDeciders` (id, name), `nobodyReason` (NO_ROLE_HOLDERS, ALL_AUDITED_CLIENT, NOT_ENOUGH_ELIGIBLE), `openRound`, `pastRounds`, `certificate` (with surveillance schedule and history), `canManageCertificate`, `openChange` (action, mode, required votes, requester, reason, who voted but not how, `canVote`/`cannotVoteReason`), `pastChanges` (votes and reasons) |
| `POST /cycles/{id}/decision` | `{version (cycle), vote GRANT/REFUSE, reason}` → the panel. Errors above |
| `POST /cycles/{id}/certificate/{suspend\|restore\|withdraw}` | `{version (certificate), reason}` → the panel; unknown action → 404; no certificate → 422 `NO_CERTIFICATE`; in committee mode opens (or votes APPROVE in) a change round; 409 `CHANGE_PENDING` |
| `POST /cycles/{id}/certificate/change-vote` | `{version (certificate), vote APPROVE/REJECT, reason}` → the panel; 403/404 as for decisions; 409 `ALREADY_VOTED`, `NO_CHANGE_PENDING` |
| `POST /cycles/{id}/audits` | now also `SURVEILLANCE` and `RECERTIFICATION` (rules above) |
| `GET /cycles`, `GET /cycles/{id}` | `decisionStatus` is now computed (values as the panel's `status`); new `certificateNumber`, `certificateStatus`; phase `CERTIFIED`; `POLICY_D02` only while a policy is missing; `readyForDecision` = audits done and no open major |
| `GET /cycles/{id}/timeline` | adds DECISION_VOTE, DECISION_GRANT/REFUSE, CERTIFICATE_ISSUED/SUSPENDED/RESTORED/WITHDRAWN |
| ~~`POST /cycles/{id}/certificate`~~ | removed: a certificate is issued by a GRANT, never on request |

Decision and certificate data are part of the cycle: whoever can read the cycle reads them (names PERSONAL, reasons
BUSINESS; registry updated). There is no generic `/ws/rest` access for non-administrators (deny by default).

## 4. Data (migrations V027 and V031, rollbacks U027 and U031)

`ioeti_cert_decision` (round), `ioeti_cert_vote` (unique per round and person), `ioeti_cert_certificate` (unique number,
one per cycle), `ioeti_cert_certificate_event` (history). V031 adds to `ioeti_cert_decision` the change-round columns
`change_action`, `certificate`, `requested_by`, `request_reason` (all empty on grant rounds). `CertificationAudit.typeSelect` gains 3 SURVEILLANCE and
4 RECERTIFICATION (no schema change).

## 5. UI (`#/certification/{id}`)

- Hero shows the certificate number and status, or the decision status.
- Readiness checklist as before; the policy line now names the D-02 policies for the standard.
- **Decision panel**: why it is blocked (which policy is missing, with a link to Policies and who sets it), the mode in
  plain words, validity/surveillance, the impartiality rule, who may decide (or why nobody can), the open round
  (votes so far, hidden values), the person's own GRANT/REFUSE with a required reason (GRANT disabled with the reason
  when majors are open), or why they cannot decide; earlier rounds with votes and reasons.
- **Certificate card**: number, status, dates, surveillance schedule (done / overdue / upcoming), recertification date,
  history; suspend / restore / withdraw in a dialog with a reason (withdraw warns that it is final), shown only to
  eligible people (the server enforces it anyway).
- In committee mode the certificate buttons read "propose … (committee vote)" and the dialog explains the vote; an open
  change round shows the request, who voted (not how) and Approve/Reject with a reason for members who may vote; earlier
  change votes are listed with their outcome, votes and reasons.
- **Follow-up audits**: surveillance (pre-filled with the next due date) and recertification cards, reusing the stage card.
- Arabic first, English second; RTL; works at phone width.

## 6. Tests

- Unit (`DecisionRulesTest`, 12 tests): mode parsing and fail-closed, committee tally and tie, eligibility order, role held
  directly or via group (blocked people excluded), expiry and surveillance dates, number format and normalisation,
  certificate transitions, channel switch, rate limit; change tally (strict majority, tie rejects) and change routing
  (apply / open / vote, 409 CHANGE_PENDING, fail closed).
- Playwright (`apps/ioeti-web/tests/certification.spec.ts`, 7 tests, mocked API): fail-closed explanation, independent
  GRANT → certificate → suspend → withdraw, committee with hidden votes and server refusal, impartiality and read-only,
  surveillance planning from the due date at phone width; committee change round (start, hidden votes, reject, 409
  CHANGE_PENDING) and an approved change in English.
- Live probe (`scripts/certification_probe.py`, section 7): fail closed, who decides (403/404/409/422), readiness,
  independent GRANT and numbering/dates, second decision 409, public check on/off/unknown/no listing, suspend/restore/
  withdraw with negatives, surveillance/recertification planning, committee of 3 (majority) and of 2 (tie refuses, new
  round), committee changes (suspend needs 3 votes, 2–1 approves, a 1–2 rejected restore changes nothing, 409
  CHANGE_PENDING / ALREADY_VOTED / NO_CHANGE_PENDING, a round keeps its mode, independent again is one step), notices,
  and two simultaneous GRANTs → one certificate. Needs a disposable database (it appoints a policy owner).

## 7. Still open

| Item | Why / who |
|---|---|
| Role template for the decision right in the admin console (`RoleAdmin.TEMPLATES`) | shared admin module; today an administrator grants `ioeti-cert-decision-maker` in user maintenance |
| Reissue (new number after a scope change) and renewal after recertification (new cycle) | not built |
| Numbering format as a policy field | `cert.cycle` has none; the format is fixed |
| Public page in the web app (`#/verify`) and the inbox route for `CERT_CYCLE` notices | `App.tsx` / `automationApi.ts` are shared files |
| Impartiality beyond the audit team (conflict-of-interest declarations, technical review) | not in D-02's signed text |
