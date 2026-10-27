# Execution report: Wave 4C to Wave 7b (IOETI Business OS on Axelor Open Suite 9.1.10)

Date: 2026-10-20. Scope: the brief "IOETI CRM — execution continuation: Wave 4C through production completion".

This report records what was built, the final gate results and what remains. Nothing was merged, nothing was deployed, no real customer data was used, and no policy decision was taken by engineering.

## 1. Slices (stacked draft PRs; the chain ends at Wave 7b)

| Wave | PR | Branch | What it adds | Policy gates kept closed |
|---|---|---|---|---|
| 4C | #32 | `claude/ioeti-wave4c-certification-ui` | ISO certification workspace UI | D-02 decisions and certificates |
| 4D | #33 | `claude/ioeti-wave4d-recruitment` | Agency recruitment: job orders, candidates, consent per job order, pipeline, interviews, offers, placements, fees | D-04 sharing/fees/guarantee, D-06 |
| 4E | #34 | `claude/ioeti-wave4e-fundraising` | Donors, grants, commitments, schedules, collections (pledge ≠ collected), stewardship | D-05 receipts/restricted funds, D-06 |
| 5 | #36 | `claude/ioeti-wave5-handover` | Handover checklist → one native Project per accepted handover, tasks, ownership | D-11 activation/handover trigger |
| 5b | #37 | `claude/ioeti-wave5b-commercial-workflows` | Quotation versions, review requests, invoice requests, renewals, Account 360 summary | D-11 approve/reject, D-06 invoice/tax |
| 6 | #38 | `claude/ioeti-wave6-leads` | Lead intake with Arabic-normalized duplicate review, consent/opt-outs, attribution, saved views, follow-ups | D-12 routing/SLA, D-10 outbound |
| 7a | #39 | `claude/ioeti-wave7a-content` | Documents on records (type-checked, immutable revisions), knowledge base | D-02/D-03/D-11 templates, D-07 approval |
| 7b | #40 | `claude/ioeti-wave7b-insights` | In-app notices and mentions, held outbox, scoped reports, real Settings page | D-10 sending, D-12 reminders, D-06 finance KPIs |

Merge order: #32 → #33 → #34 → #36 → #37 → #38 → #39 → #40. The owner's PR #35 (staging runner) was not touched; it also changes `scripts/ioeti.sh`, so merge it with care. **No further slice will be stacked on this chain until it is reviewed.**

## 2. Final gates (on the Wave 7b head, which contains every slice)

| Gate | Result | Evidence |
|---|---|---|
| Regression: every live probe on real Axelor 9.1.10 + PostgreSQL 16 | **25/25 suites** pass | `docs/evidence/wave7b-insights/regression.txt` |
| Identity isolation (concurrent users, restores, workers) | **399,575 checks, 0 leaks** | same |
| Scope matrix, API contract, sessions/CSRF/throttle, WebSocket identity | 65/65, 31/31, 20/20, 7/7 | same |
| Personal-data gate (G-007) | 867 fields classified, **0 problems**; no RESTRICTED field in any response | `scripts/pii_dto_audit.py` |
| Policy registry | the 12 decisions shown in the app equal the decision document | `scripts/policy_registry_check.py` |
| Schema migrations V001–V015 | apply + verify against Hibernate **8/8**; rollbacks provided | `scripts/db_migrate.py verify` |
| Backup and restore drill | **10/10**, 9.5 MB backup in ~2 s, restore ~21 s | `scripts/backup_restore_drill.py` |
| Pilot readiness (fictional dataset) | setup, check **11/11**, teardown with no leftovers | `scripts/pilot_readiness.py` |
| JUnit (all IOETI modules) | **103 tests, 0 failures** | `scripts/ioeti.sh test` |
| Web: typecheck, production build | OK | `apps/ioeti-web` |
| Web: real-mode contracts (mocked API) | **61/61**, including the **mobile gate** (16 live routes at 390 px, no horizontal scroll) | `tests/app.spec.ts` |
| Web: fictional preview | **14/14** | `tests/demo.spec.ts` |
| CI | Backend, frontend, session-expiry and source-ledger checks green on every PR, #32–#40 | GitHub checks |

### Security review of the new surface (Waves 6–7b)
- **Access.** Every new endpoint takes its access from native permissions, or from the record a document or notice belongs to. Records the caller may not read answer 404 (no existence oracle). Anonymous calls get 401, or a login redirect for downloads, never data.
- **Generic API.** The generic Axelor API (`/ws/rest`, `/ws/action`) stays closed to non-maintenance users (SEC-002). Native read rights therefore cannot bypass the IOETI rules: draft knowledge articles, other users' notices and restricted profiles stay out of reach.
- **Aggregates.** Reports always embed the caller's native read filter. An area without a read right is left out, never shown as zero, and currencies are never added together.
- **Uploads.** Checked by detected content type, size and extension. Downloads are attachments with `nosniff`, `no-store` and a sandbox CSP.
- **CSV export.** Neutralizes spreadsheet formulas.
- **No outbound sending.** Nothing is sent outside the CRM: the outbox is held (D-10), and the probe checks that the native message queue does not grow.
- **Concurrency.** Optimistic versions on every write. Row locks where two writers must not collide: revisions, attributions, consent, invoice requests, acceptance.
- **Issues found and fixed during these waves:**
  - concurrent campaign attributions were wrongly refused;
  - a refused publish was shown with the wrong error;
  - the sidebar could not reach its last items at 720 px.

## 3. Real versus mocked

- **Real:** everything under §2 except the web Playwright suites. Those check the UI against mocked API contracts whose shapes are the ones the live probes verify.
- **Test fixtures only (disposable database):** for transitions that policy blocks in the API, the probes use SQL stand-ins. Contract activation and order confirmation (D-11/D-06) are examples. These stand-ins are labeled in each probe.

## 4. Policy decisions (all still OPEN)

D-01 to D-12 are unchanged and listed in `docs/decisions/OPEN_IOETI_POLICY_DECISIONS.md`. Engineering notes awaiting owner review:
- D-04: submission scope;
- D-11: handover start;
- lead contact consent.

Every action that depends on an open decision answers `422 BLOCKED_BY_POLICY` naming the decision, and the UI shows it disabled with the reason.

## 5. Handoff

- **Local environment:** run `bash scripts/ioeti.sh init`, then start PostgreSQL 16 and the app as described in `docs/DEVELOPMENT_GUIDE.md`.
  - Never build while the server is running.
  - JUnit runs with the server stopped (`bash scripts/ioeti.sh test`).
  - The probes run against a running server, as in the CI job `.github/workflows/ioeti-backend.yml`.
- **Owner actions, not engineering:**
  - review the stacked PRs;
  - decide D-01 to D-12;
  - decide on PR #35 and the upstream report noted in the decisions document.
- **When the owners sign a decision:** follow "How engineering records a signed decision" in the decisions document. Each blocked command is a single entry point named in the slice documents (`docs/slices/`).
