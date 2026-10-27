# Release hardening: end-to-end scenarios on the real backend (S1–S7)

Status: LIVE_INTEGRATION_PASS on Axelor 9.1.10 + PostgreSQL 16. Every scenario runs in backend CI (`.github/workflows/ioeti-backend.yml`) after the per-area probes. Roles are test fixtures; production roles are D-07. Data is fictional. No policy decision was taken: every blocked step still answers `422 BLOCKED_BY_POLICY`.

The per-area probes test one area at a time and race two requests on one version. These scenarios do two other things:
- follow one client across every team and check that every area agrees on the same records at the end;
- put many users on the same records at the same moment.

They found four defects that the per-area probes and the mocked browser tests could not see. All four are fixed in this slice (§2).

## 1. Scenarios

| | Script | What it proves | Result |
|---|---|---|---|
| S1 | `scripts/scenario_iso_lifecycle_probe.py` | One ISO client from intake to certification, with six users (see below) | 14/14 |
| S2–S4 | `scripts/scenario_services_probe.py` | Training, recruitment and fundraising under concurrent load; one client across the three areas | 6/6 |
| S5 | inside S1 (steps 9 and 10) | A permission removed mid-session; a backup restored mid-scenario | in S1 |
| S6 | `scripts/scale_load_probe.py` | 5,000 leads and 1,000 opportunities; 20 concurrent sessions × 50 requests | 5/5 |
| S7 | `apps/ioeti-web/tests/live.spec.ts` with `scripts/live_ui_fixture.py` | The real web app against the running server (no mocked API) | 2/2 |

### S1: ISO client lifecycle (six users: two salespeople, a reviewer, operations, a checklist editor, a certification manager)
1. **Intake.** A lead is recorded. The same person spelled differently, with the phone in Arabic-Indic digits, answers 409 `POSSIBLE_DUPLICATE`. Another salesperson may record their own copy and learns nothing.
2. **Conversion.** The lead becomes an account, a contact and an opportunity on the business line. Another salesperson gets 404.
3. **Quotation.** 3 + 2 audit days at 1,500 = 7,500 EGP; a version is saved. The review is sent back for pricing, the quotation is revised to 9,000 and sent again. Approval answers `BLOCKED_BY_POLICY` (D-11).
4. **Milestones and contract.** Milestones of 30 % and 70 % come to exactly 2,700 and 6,300. The contract is filled from the quotation with the same 9,000 total.
5. **Before handover.** A handover before activation is refused (`CONTRACT_NOT_ACTIVE`).
   - Activation and order confirmation are SQL **test fixtures** standing in for D-11 and D-06.
   - The deposit invoice request is exactly 2,700. Issuing it answers `BLOCKED_BY_POLICY` (D-06).
6. **Handover.** The configured checklist is copied. Accepting while items are open answers 422. The handover is sent back for rework; the signed contract is filed as a document and cited as evidence; the handover is resubmitted and accepted.
   - The result is exactly one engagement; a stale acceptance gets 409.
   - Documents follow their record.
7. **Certification.** A certification cycle opens for the converted client. The decision answers `BLOCKED_BY_POLICY` (D-02).
8. **Every area agrees, exactly:**
   - **Account 360 (administrator):** one record in each area. Money per stage: 0 draft, 9,000 booked, 2,700 requested, 0 invoiced, 0 collected.
   - **Account 360 (salesperson):** only the areas sales may read. Invoices show `null`, never 0.
   - **Another salesperson:** sees zeros.
   - **Sales report:** exact counts per caller.
   - **Notices:** exactly three, all to the requester. Nothing is sent outside the CRM.
9. **Permission removed mid-session.** The contract right is removed from the salesperson's group while they are signed in. The very next requests lose contracts (403), and nothing changes. Restored, the contract is back.
10. **Backup mid-scenario.** `pg_dump` → `pg_restore` into a new database. Every scenario row is identical in the copy, compared field by field as JSON: lead, quotation and lines, contract and lines, reviews, invoice request, handover, checklist, trail, engagement, document revisions, cycle and notices.

### S2–S4: one client, three areas, concurrent users
- **S2:** 10 sessions enrol 10 trainees into a 3-seat cohort at once, each retrying on a stale version.
  - Every trainee is enrolled exactly once: 3 confirmed, waitlist exactly 1..7.
  - The 3 confirmed enrolments are then cancelled at the same moment. The first three waitlisted are promoted in order and the waitlist closes up to 1..4.
- **S3:** two accepted candidates are placed at the same moment on a one-position job order. One placement succeeds; the other gets 422 `HEADCOUNT_FILLED`.
- **S4:** two fundraisers record the same bank reference on different commitments at the same moment, for 5 rounds.
  - Each round: one 201 and one 409 `DUPLICATE_COLLECTION`, never a server error.
  - Collected totals equal the accepted collections exactly. A pledge never appears as collected.
- **Cross-area:** Account 360 counts 10 enrolments, 1 job order and 1 donor profile. A salesperson sees none of these areas.

### S6: volume and a busy hour (developer machine, from the regression run)
- **Seed:** 5,000 leads through the real intake API from 8 sessions in 21.4 s.
  - Each intake runs the Arabic duplicate check against everything the owner already has.
  - Intake p95 was 41.7 ms over the first tenth and 56.5 ms over the last tenth.
- **Load:** 20 sessions × 50 requests (1,000 requests in 3.2 s). Every answer was 200; scope held (the second salesperson never saw the first one's records).

| Endpoint | p50 ms | p95 ms | max ms |
|---|---|---|---|
| Arabic search | 38 | 95 | 129 |
| search by digits | 36 | 90 | 171 |
| paging deep into the list | 97 | 197 | 354 |
| duplicate check | 34 | 75 | 164 |
| sales report | 72 | 167 | 204 |
| Account 360 (1,000 opportunities) | 37 | 87 | 156 |
| opportunity list | 49 | 101 | 162 |

**Index decision: none needed yet.**
- The search uses `LIKE '%word%'` on `crm_lead.ioeti_search_key`.
- At 5,000 leads PostgreSQL walks the primary key backwards and stops at 25 rows: 0.2 ms (the plan is in `logs/scale-load.json`).
- A `pg_trgm` GIN index becomes worth adding when a rare search must read most of the table. Re-measure with this probe (`PROBE_SCALE_LEADS=100000`) before the lead count reaches tens of thousands.

### S7: the real web app against the running server
`tests/live.spec.ts` is skipped unless `IOETI_LIVE_FIXTURE` names a fixture made by `scripts/live_ui_fixture.py setup`. Its teardown removes everything the test created.
- **Desktop, Arabic:**
  - sign in;
  - record a lead;
  - the same person spelled differently is caught before anything is recorded (link to the existing lead);
  - convert;
  - open the account with its opportunity;
  - the converted lead no longer offers conversion.
- **Phone (390 px):** leads, accounts, opportunities, reports, inbox, settings and the account record, all with real data, without sideways scrolling.
- **No server error** during either test.

## 2. Defects found and fixed

Each one was reproduced by a scenario before the fix and passes after it.

| # | Found by | Defect | Fix |
|---|---|---|---|
| 1 | S7 | **No write worked from the real web app.** Axelor scopes `CSRF-TOKEN` to `Path=/axelor-erp`, but the app runs at `/`, so the page could not read the token and every unsafe request answered 403 (shown as "no permission"). The mocked tests set the cookie at the root and could not see this. | The Vite proxy rewrites the cookie path to `/` (`vite.config.ts`, `cookiePathRewrite`). The session cookie stays HttpOnly. **Deployment requirement:** any host must keep the app and `/axelor-erp` on one origin and make the CSRF cookie readable by the app's path (proxy cookie-path rewrite, or serve the app under `/axelor-erp/`). S7 checks this on every run. |
| 2 | S4 | The same bank reference recorded at the same moment on two different commitments answered **500**. The data was right (the unique index kept one row), but the API answer was wrong. The duplicate check only held a lock on its own commitment. | `Locks.key("ioeti.collection", reference)` holds a PostgreSQL transaction lock on the reference, so the check sees the other writer's row and answers 409 `DUPLICATE_COLLECTION`. |
| 3 | S2 | Cancelling **different** enrolments of one cohort at the same moment answered 409 to all but one user, although nothing they sent was stale. The service locked the cohort instance loaded at the start of the request, and that also compared the cohort's version. | `Locks.parent(...)` reloads the parent under a row lock before bumping its version. Writers on one cohort still take turns; only a stale version of the record the caller sent answers 409. |
| 4 | S3 | Two placements on the last position at the same moment: the loser got 409 `CONFLICT` instead of 422 `HEADCOUNT_FILLED`. | Same as #3. Also applied wherever a command versions a child but locks its parent: fundraising collections, voids, installment cancellation and deliverables (commitment); audit completion and cancellation (cycle); task completion (engagement). Locks whose record *is* the versioned record are unchanged. |

## 3. How to run

```bash
python3 scripts/scenario_iso_lifecycle_probe.py      # S1 (+S5)
python3 scripts/scenario_services_probe.py           # S2–S4   PROBE_SCENARIO_ROUNDS (default 5)
python3 scripts/scale_load_probe.py                  # S6      PROBE_SCALE_LEADS / _OPPS / _USERS / _REQUESTS / _P95_MS
python3 scripts/live_ui_fixture.py setup /tmp/s7.json
(cd apps/ioeti-web && IOETI_LIVE_FIXTURE=/tmp/s7.json npx playwright test tests/live.spec.ts)
python3 scripts/live_ui_fixture.py teardown /tmp/s7.json
```

## 4. Still open, and not engineering's to decide

- **Staging run of S7 and S1–S6.** These need a staging host and credentials, and the hosting choice is open.
- **Real-mode SQL stand-ins.** These stay test fixtures until D-11 (signature/activation) and D-06 (order confirmation, invoicing) are signed.
