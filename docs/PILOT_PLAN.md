# IOETI — plan to the first REAL internal pilot

## Definition: real pilot vs visual demo

Real pilot = user signs in, selects an active IOETI business line, creates one
real Axelor Opportunity through /ws/ioeti/opportunities, retrieves it again,
renames it with a version check, and verifies persistence. A second user without
read/write permission must be denied on all relevant APIs. The same workflows
must work in Arabic RTL and English LTR, across Light/Dark/Luxury and mobile
layouts. Nothing in this acceptance path may depend on a fake data source.

This is an internal **test-data pilot**. It is NOT a public launch.

## Checkpoints and gates

| Gate | Deliverable | Definition of done | Status |
|---|---|---|---|
| G0 | Custom frontend baseline | Light/Dark/Luxury, density, nav variants, RTL/LTR, build | PREVIOUS PR #1: frontend CI passed |
| G1 | Session boundary | independent session/identity route; 401 != 403; no credentials stored locally | IMPLEMENTED IN CODE — backend integration still to be tested |
| G2 | Secure CRM contracts | explicit list/detail/create/rename endpoints; DTOs, permission and record filters, paging and optimistic version | IMPLEMENTED IN CODE — backend CI & smoke required |
| G3 | Interactive CRM | UI for real opportunity list/create/edit with no mocks at runtime | IMPLEMENTED IN CODE — browser/real backend checks required |
| G4 | Regression automation | frontend Playwright browser tests + Java/JPA CI + live Axelor pilot smoke | AUTOMATION ADDED; await results |
| G5 | Security review | resolve context/field access risk, CSRF/session lifecycle, role scopes, deny paths, negative tests, threat review | BLOCKED: independent verification required |
| G6 | First controlled pilot | real two-user end-to-end workflow on isolated test database; QA record in Arabic/English and mobile | READY FOR REVIEWER: `docs/runbooks/PILOT_UAT_SCRIPT.md`; dataset via `scripts/pilot_readiness.py setup/check/teardown` (in backend CI). Needs the IOETI reviewer's sign-off (D-09) |
| G7 | Expansion | Lead→Opportunity→Quote→Contract→Handover with configs and approvals | AFTER PILOT |

## Gate evidence (2026-10-20, draft PRs #15–#26, backend CI)

| Gate | Evidence |
|---|---|
| G1 session boundary | SEC-004 probe 20/20 plus expiry job; SEC-001 identity probe 0 leaks under load |
| G2 secure contracts | SEC-002 contract probe 31/31; DTO allowlists in every live probe; G-007 field gate |
| G3 interactive CRM | live lead → convert → opportunity → quotation → milestones → contract probes (28, 24, 50 checks) |
| G4 regression automation | backend CI runs every probe above on Axelor 9.1.10 + PostgreSQL 16; web CI runs 30 mocked + 14 demo tests |
| G5 security review | engineering items closed or fail-closed (see `docs/reverse-mapping/GAP_REGISTER.md` P0 status); independent review still required |
| G6 pilot | dataset and script ready; **not run by a reviewer yet** |

## Real application setup

```bash
scripts/ioeti.sh init
scripts/ioeti.sh db-up
scripts/ioeti.sh run             # separate terminal
scripts/ioeti.sh install-apps    # after ready, only once per fresh DB
scripts/ioeti.sh test
scripts/ioeti.sh pilot-smoke     # temporary real Axelor opportunity, create+read+rename+conflict
# separate terminal:
cd apps/ioeti-web
npm install
npm run dev
npm test                      # mocked-API browser interaction, distinct from pilot-smoke
```

Open http://127.0.0.1:5173. Only run on loopback / test network.

## Manual pilot role tests

- Admin: create, fetch, rename and verify persistence.
- Sales user allowed to create/read/write only assigned business line: permitted action passes.
- Sales user denied another business line/record: list, get and update return denial with no data.
- Read-only user: list/detail pass, create/update denied.
- Anonymous and disabled user: session and all IOETI APIs denied.
- Following an administrative metadata reload and concurrent activity, previous users' permissions MUST remain isolated.
- UI browser checks: desktop/mobile, AR RTL/EN LTR, all three themes, keyboard and accessible labels.
- Logs show no sensitive values in error pages.
- Backup/restore tested before any pilot with substantial data.

## Release blockers

1. Axelor authentication-context isolation issue previously reported by the development agent — confirm and remediate across all HTTP and background entrypoints; a request-only filter smoke test is not full assurance.
2. Generic Axelor REST field protection — isolate sensitive data structurally and harden endpoint exposure.
3. CSRF, secure session cookie policy, logout endpoint, rate limiting and access gateway not yet proven production-ready.
4. Record-scope policies Own/Team/BusinessLine/All not yet configured for actual pilot roles.
5. Frontend browser tests use intercepted endpoints and cannot replace running PostgreSQL/Axelor tests.
6. Public disclosure of a suspected upstream vulnerability should be handled responsibly in private with Axelor.

## Following the pilot

Next implementation is Sales/CRM workflow: configurable stages and stage gates,
Lead→Opportunity handoff, account linking, deal values, quotation generation and
approvals. Then Contract→Invoice/Payment Milestones→Operations Handover.

ISO audits, external training, client recruitment and donor/grant management get
their own bounded contexts reusing these shared business capabilities.

No timeline estimate is treated as a guarantee; gate completion depends on test evidence.

## Reverse mapping tranche — actual sources to UX

Read-only native-domain DTO endpoints and corresponding user experiences have been
added for `Lead` and `Partner` under `/ws/ioeti/leads` and
`/ws/ioeti/accounts`. Customer directory deliberately excludes internal,
employee, vendor-only and contact-only records, with minimal response fields.

These endpoints are built from confirmed pinned Axelor 9.1.10 domain XML and
apply existing server-side model/record ACL. Frontend screens are fully custom.

Status:
- Code implemented; frontend/browser contract tests added.
- The demo uses explicit fictional fixtures and never calls live Axelor.
- Actual production-like two-user permission tests and backend integration evidence
  are required before the read-only screens are promoted to operational status.
- Lead conversion/assignment, Account 360 detail composition and write operations
  remain future vertical slices.

See `docs/UX_REVERSE_MAPPING.md` and `docs/MODULE_REUSE_MATRIX.md`.
