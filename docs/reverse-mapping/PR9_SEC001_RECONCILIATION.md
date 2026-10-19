# Security SEC-001 — evidence reconciliation for Claude PR #9

**Snapshot:** 2026-10-19. Sensitive exploitation details deliberately omitted; this document is for public traceability and implementation status only.

## Provenance and repository isolation

- [PR #9](https://github.com/KareemQabil/nerdCRM/pull/9) is the **stacked, unmerged Draft PR** `claude/ioeti-sec-001-identity-isolation`, based on Claude's API-001 PR #6 branch.
- Last inspected head: `d0bb9e1bd`. Code is **not present on the mapping branch** and no upstream Axelor files were modified.
- [CI run](https://github.com/KareemQabil/nerdCRM/actions/runs/39295555313) had started and was **still running at time of mapping review**. Recheck status before changing any approval.
- Claude's report is a contributor's local-source and runtime test account; these results have not been independently reproduced in this documentation-only branch.

## Source and regression claims made by the implementing agent

- Root cause examined against exact **Axelor Open Platform 8.2.5** source JAR artifacts, with checksums retained privately/on the implementation branch rather than guessed from another release tag.
- Proposed control: Servlet filter before authentication layers, clearing stale request-thread identity at entry and exit. The existing JAX-RS scoped layer remains as defense-in-depth. Application startup should fail when the filter cannot be registered.
- Local *unmitigated* control was intentionally run in isolation and demonstrated unauthorized identity and record-access behavior; do not publish reproduction detail or raw request traces.
- In independent local mitigated variants reported by Claude: 0 observed cross-user leaks across 317,623; 320,752 and final 325,020 checks. These are measured stress samples, not proofs of security.
- 34/34 JUnit, existing real PostgreSQL opportunity pilot, two-writer regression, 16/16 API smoke and record-filter probe reportedly passed locally.
- Real CI was extended to execute identity and race regressions for relevant backend changes; CI must be checked and must pass before acceptance.
- Residual surfaces remain: WebSockets and scheduled jobs are only source-reviewed, not live regression-tested; session expiration path not covered.

## Change of mapping statuses

| Gap | Interpretation after PR #9 | Release status |
|---|---|---|
| `G-002` | Concrete source-rooted outer request-boundary mitigation added on unmerged branch and stress-tested locally | **IMPLEMENTED_IN_DRAFT_PR9 / NOT VERIFIED COMPLETE** |
| `G-003` | Generic REST sensitive-field read exposure unchanged | **P0 OPEN** |
| `G-004` | Full Own/Team/BusinessLine/All model unresolved | **P0 OPEN** |
| `G-005` | Session expiry, CSRF and logout not covered by this fix | **P0 OPEN** |
| `G-011` | Sensitive upstream issue documentation already public | **P0 disclosure handling OPEN** |

## Scope of follow-up issues

- [#10](https://github.com/KareemQabil/nerdCRM/issues/10): identity-isolation residual surfaces.
- [#11](https://github.com/KareemQabil/nerdCRM/issues/11): SEC-002 field, route and error response security.
- [#12](https://github.com/KareemQabil/nerdCRM/issues/12): SEC-003 precise ownership/team/business-line permissions.
- [#13](https://github.com/KareemQabil/nerdCRM/issues/13): SEC-004 sessions, CSRF, audit, sensitive fields.

## Pilot release gate

Do not connect the public Vercel fictional-demo preview to live Axelor data. Pilot integration requires PR #6 and #9 review/integration, passing **current** CI, all role/record/field-scoped negative cases, and signoff of SEC-002/003/004 appropriate to pilot data. Demo's 16 operating workspaces are UX simulations only, not live business capabilities.

## Security disclosure caution

The current public repository was reported to contain an earlier reproduction document for the upstream vulnerability. The maintainers should coordinate a private upstream security notice and evaluate removing/sanitizing exposure, including Git history and forks where practical; merely deleting a line in the current tree does not erase past public exposure. Avoid copying private disclosure drafts or sensitive technical reproduction into public PRs.
