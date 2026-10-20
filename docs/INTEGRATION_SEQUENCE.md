# Integration sequence for PR #1, #6, #9, #7 and #8

This document is change-safe: no contributor branch is rewritten and nothing is merged into `main` without owner review. Every step names the exact heads it used, so it can be re-checked after other agents push.

## 1. Topology (verified 2026-10-19 from GitHub)

| PR | Head branch | Head | Base | Area |
|---|---|---|---|---|
| #1 | `feat/ioeti-custom-ui-nerdpos-design-foundation` | `82fe3e4` | `main` | custom UI + first DTO foundation |
| #6 | `claude/ioeti-production-hardening-and-domain-slices` | `a919cfa` | #1 | API-001 (409 contract) |
| #9 | `claude/ioeti-sec-001-identity-isolation` | `d0bb9e1` | #6 | SEC-001 identity boundary |
| #7 | `docs/exhaustive-source-reverse-mapping` | `e5e82cf` | #1 | 377 capabilities, 52 surfaces, GAP register |
| #8 | `feat/ioeti-opportunity-record-workspace` | `3d403cc` | #1 | 16-domain demo workspaces, record UX |

The change sets are disjoint:
- #7 touches only `docs/reverse-mapping/**` and its CI;
- #8 touches only `apps/ioeti-web/**` and the web CI;
- #6 and #9 touch `modules/**`, `scripts/**`, `docs/security` and `docs/evidence`.

## 2. Integration base: `claude/ioeti-integration`

1. Start from #9 `d0bb9e1`, which already contains #6.
2. Merge #7 `e5e82cf` with an explicit merge commit. Result: no conflicts.
3. Merge #8 `3d403cc` with an explicit merge commit. Result: no conflicts.

The original branches are untouched. Later IOETI work branches from this base and opens stacked draft PRs against it.

### Verification of the integrated tree (local, before push)

| Check | Result |
|---|---|
| `scripts/ioeti.sh test` (JUnit, HSQLDB, real Guice/AOP classes) | 34/34, 0 skipped |
| `node docs/reverse-mapping/validate.mjs` (#7 structural validator) | pass |
| `apps/ioeti-web`: `npm run build` (tsc + vite) | pass |
| `apps/ioeti-web`: mocked-API browser contract tests | 17/17 |
| `apps/ioeti-web`: fictional demo tests | 14/14 |

**Local note on the Playwright runs.** npm resolved `@playwright/test` 1.64.1 (the package has no lockfile), which expects a Chromium build that this sandbox does not ship. The same tests were run through an untracked local config that points `launchOptions.executablePath` at the preinstalled Chromium. CI installs its own browser. The missing lockfile is tracked under G-030 (reproducible builds).

CI results for the integration PR are recorded on the PR itself.

## 3. Proposed merge order for the owner (review-gated)

1. #6 into #1 (API-001). #9 is stacked on it.
2. #9 into #1 after #6 (SEC-001). It stays OPEN for WebSocket/job/expiry; see issue #10.
3. #7 into #1 (documentation only).
4. #8 into #1 (UI). The demo stays fictional and lazily loaded; real mode is unchanged.
5. After those merges, `claude/ioeti-integration` reduces to this document plus later stacked work. Rebase decisions belong to the owner.
6. #1 into `main` only after an owner decision, the P0 gates (`docs/reverse-mapping/GAP_REGISTER.md` G-001 to G-014) and the UAT in `docs/UAT_SCENARIOS.md`.

If any PR changes before it is merged, re-run section 2 against the new heads. Conflicts are resolved explicitly in a merge commit on the integration branch; contributor branches are never force-pushed.

## 4. Stacked work after integration

| Order | Scope | Gate it closes | Depends on |
|---|---|---|---|
| 1 | SEC-002: IOETI error contract, existence-oracle removal, generic `/ws/rest` exposure policy | G-003, G-006, part of G-007 | integration base |
| 2 | SEC-004: session, cookie, CSRF, logout, expiry verification | G-005, G-014 | 1 |
| 3 | SEC-003: Own/Team/Line/All mechanism with test-only role fixtures | G-004 | 1; D-07 for production roles |
| 4 | Wave 2 slice: Lead qualification and conversion to Account/Contact/Opportunity, then Account 360 | G-040, G-029 | 1–3 |
| 5 | Wave 3: catalog/pricing, quote, approvals, contract, milestones | G-042–G-044 | 4; D-06 for finance |

Draft PRs, each stacked on the previous one:
- 1: #15;
- 2: #16;
- 3: #17;
- 4, part 1 (conversion and Account 360): #18;
- 5, part 1 (catalog and draft quotations): #19;
- platform part 1 (migrations and backup): #20;
- 5, part 2a (payment milestones): #21;
- 5, part 2b (draft contracts): #22;
- 5, part 2c (contract lines from the quotation): branch `claude/ioeti-wave3-contract-lines`.

Policy-dependent steps follow `docs/decisions/OPEN_IOETI_POLICY_DECISIONS.md`.
