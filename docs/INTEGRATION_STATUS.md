# Integration status and merge-order checklist

Updated: 2026-10-20. Nothing has been merged into `main`; all PRs are drafts awaiting owner review.

## 1. Cumulative baseline

- **`claude/ioeti-integration-next`** is the continuously verified integration branch. It starts at `86264ad`, the head of #30, which contains **every** open PR (#1, #6–#9, #14–#30) and is 119 commits ahead of `main`.
- A draft PR from this branch to `main` exists only so CI runs on the cumulative head. **Do not merge it as-is**; merge the reviewed PRs in the order below.
- New work (Wave 4C onward) branches from the baseline. Each slice gets a draft PR into `claude/ioeti-integration-next`, so reviewers see only that slice's diff. A slice is merged into the integration branch (merge commit, never a force-push) only after its own CI and the real Axelor/PostgreSQL regression pass.

## 2. Status of the existing PR chain

CI is the latest run on the head SHA: B = backend (live Axelor + PostgreSQL probes), E = session-expiry, F = frontend, L = source ledger.

| PR | Scope | Head | CI | Depends on | Merge readiness | Remaining issues |
|---|---|---|---|---|---|---|
| #1 | Owner's custom UI foundation | `82fe3e4` | B ✗, F ✓ | `main` | superseded by #14 | its own backend job is red; the fix is in #6/#9 via #14 |
| #6 | API-001 stale/concurrent rename → 409 | `a919cfa` | B ✓ | #1 | folded into #14 | — |
| #7 | Source reverse-mapping docs | `e5e82cf` | L ✓ | #1 | folded into #14 | — |
| #8 | Fictional 16-domain demo UI | `3d403cc` | F ✓ | #1 | folded into #14 | demo only, never real data |
| #9 | SEC-001 identity boundary | `d0bb9e1` | B ✓ | #6 | folded into #14 | private upstream disclosure is an owner action |
| #14 | Integration of #6 #7 #8 #9 | `e8f493b` | B L F ✓ | #1 | review as one unit | "do not merge as-is" note |
| #15 | SEC-002 error contract, oracle, generic REST closed | `563d59d` | B F ✓ | #14 | ready for review | — |
| #16 | SEC-004 CSRF, logout, throttle, expiry | `2d1e506` | B E F ✓ | #15 | ready for review | `Secure` cookie needs HTTPS staging (D-08) |
| #17 | SEC-003 Own/Team/Line/All scopes | `be7ec94` | B E F ✓ | #16 | ready for review | production roles D-07 |
| #18 | Lead → Account + Opportunity, Account 360 | `a614aa6` | B E F ✓ | #17 | ready for review | — |
| #19 | Catalog and draft quotations | `b6b9688` | B E F ✓ | #18 | ready for review | taxes D-06, finalize D-11 |
| #20 | Migrations (G-008), encrypted backup drill (G-009) | `9786ad9` | B E L ✓ | #19 | ready for review | key custody D-08 |
| #21 | Payment milestones | `51d7a77` | B E F ✓ | #20 | ready for review | invoicing D-06 |
| #22 | Draft customer contracts | `1d533be` | B E F ✓ | #21 | ready for review | signature D-11 |
| #23 | Contract lines from quotation | `195b027` | B E F ✓ | #22 | ready for review | — |
| #24 | SEC-001 WebSocket, jobs, expiry | `a6440da` | B E L ✓ | #23 | ready for review | multi-node check at deployment |
| #25 | Lead qualification and assignment | `2ad1863` | B E F L ✓ | #24 | ready for review | SLA and routing D-12 |
| #26 | G-007 PII classification, gate, masking | `f4f4b89` | B E L ✓ | #25 | ready for review | log pipeline D-08 |
| #27 | G-010 pilot UAT script and dataset | `cff7b1f` | B E L ✓ | #26 | ready for review | reviewer sign-off D-09 |
| #28 | Wave 4a external training backend | `4403865` | B E L ✓ | #27 | ready for review | certificates/refunds D-03 |
| #29 | Wave 4a training UI | `7ff4025` | F ✓ | #28 | ready for review | — |
| #30 | Wave 4b ISO certification backend | `86264ad` | B E L ✓ | #29 | ready for review | decision/certificates D-02 |

## 3. Merge-order checklist (owner)

1. [ ] Review #14 (integration of #6–#9) together with #1. Merge #1 → `main` only together with #14, because #1's own backend job is red without #6/#9.
2. [ ] Merge #15 → #16 → #17 (security foundation). Each is a fast-forward on the previous one.
3. [ ] Merge #18 → #19 → #20 → #21 → #22 → #23 → #24 (CRM and commercial chain, platform, SEC-001 residual).
4. [ ] Merge #25 → #26 → #27 → #28 → #29 → #30.
5. [ ] Merge the Wave 4C+ slice PRs that target `claude/ioeti-integration-next`, in the order listed in §4. Each lists its own dependencies.
6. [ ] After each step, check that backend CI is green on `main`.

## 4. New slices (targeting `claude/ioeti-integration-next`)

| Slice | Branch | PR | Depends on | Status |
|---|---|---|---|---|
| Wave 4C ISO certification UI | `claude/ioeti-wave4c-certification-ui` | #32 | #30 | ready for review; CI green on `22f4810` |
| Wave 4D agency recruitment | `claude/ioeti-wave4d-recruitment` | #33 | #32 (stacked: base is the 4C branch; retarget after #32 lands) | ready for review; local regression green |
| Wave 4E fundraising | `claude/ioeti-wave4e-fundraising` | #34 | #33 (stacked) | ready for review; local regression green |
| Wave 5 handover and engagement | `claude/ioeti-wave5-handover` | #36 | #34 (stacked) | ready for review; local regression green |
| Wave 5b commercial workflows and Account 360 | `claude/ioeti-wave5b-commercial-workflows` | #37 | #36 (stacked) | ready for review; CI green on `2b67ffc` |
| Wave 6 lead intake and marketing completeness | `claude/ioeti-wave6-leads` | #38 | #37 (stacked) | ready for review; local regression green |
| Wave 7a documents and knowledge base | `claude/ioeti-wave7a-content` | #39 | #38 (stacked) | ready for review; local regression green |
| Lean staging runner and release gate (owner) | `feat/ioeti-lean-staging-release-gate` | #35 | #34 | opened by the owner; touches `scripts/ioeti.sh` like the later slices (merge carefully) |

Merging the slices is the reviewer's decision. Engineering does not merge them into `claude/ioeti-integration-next`, because GitHub would then mark the PRs as merged. Order: #32 → #33 → later slices. The stack is kept to these waves and **ends at Wave 7**: no further slices are stacked on it until the earlier PRs are reviewed; later work branches from the newest reviewed base.
