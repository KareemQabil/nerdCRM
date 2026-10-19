# Execution report — IOETI foundation on Axelor (phase 1)

Date: 2026-10-19 · Machine: Ubuntu 24.04 x86_64, 4 vCPU, 15 GB RAM, Docker 29.8.2 (Linux cloud VM,
not Windows) · Machine-readable: [`execution-summary.json`](execution-summary.json) ·
Evidence files: [`docs/evidence/`](evidence/) (copies of `logs/` outputs).

## 1. Inputs
| Input | Status |
|---|---|
| Requirements spec | sections 1–9 only (pasted in conversation) → `docs/reference/IOETI_CRM_Requirements_Spec_sections_1-9.md`. **Missing:** ISO ops, recruitment, fundraising, KB, automation, reports, admin sections and the open-questions list |
| `PLATFORM_COVERAGE_MATRIX.csv`, `PLATFORM_COMPARISON.md`, handoff | found and copied to `docs/reference/` |
| JSON system/workflow map mentioned in the handoff | **not provided** (owner confirmed none exists) |

## 2. What was executed (in order)
1. Environment: Java 21.0.12, Gradle wrapper 8.14.3, Docker daemon started, PostgreSQL 16 container test, network checks (Axelor Maven, Maven Central, Gradle, Docker Hub, npm reachable; Docker Hub and Maven Central intermittently returned HTTP 429).
2. Open Mercato cloned separately (`/home/user/research/open-mercato`) and inspected (README, AGENTS.md, licences, modules, RBAC, extension points, tests).
3. `git clone --branch v9.1.10 open-suite-webapp`; `submodule update --init --recursive` (HTTPS rewrite) → AOS `e7cbea53` (v9.1.10).
4. `./gradlew --max-workers=2 assemble -x archiveReports` on the **unmodified** upstream → BUILD SUCCESSFUL in 2m32s (`evidence/upstream-build.txt`).
5. IOETI repo created (`git init`), webapp added as submodule; `.env` with generated secrets; PostgreSQL 16 via compose with `unaccent` + `pg_trgm`.
6. Baseline start (`gradlew run --config …`): 1,181 tables, 32 modules, login OK, unauthenticated → 302/401, bad password → 401.
7. IOETI modules `ioeti-core` and `ioeti-business-lines` implemented, linked, compiled; JUnit 16/16 (10 unit + 6 JPA on HSQLDB).
8. Dev DB reset (only the IOETI volume) and **fresh install with IOETI modules**: ready in ~4m15s, seeds + permissions + translations imported (`evidence/fresh-install-startup.txt`).
9. AOS apps installed through the action API (base, crm, sale, contract, project, intervention, quality, marketing, gdpr + dependencies).
10. API smoke test 16/16 incl. 6 negative permission checks (`evidence/api-smoke-test.json`); UI test 7/7 with screenshots incl. Arabic RTL (`evidence/ui/`).
11. Security probes: field-rule enforcement (not enforced on API reads), thread-bound-user leak (found, root-caused in AOP source, mitigated, re-verified) (`evidence/security/`).
12. Arabic PDF probes: Flying Saucer/OpenPDF vs Chromium (`evidence/pdf/`).
13. Open Mercato optional smoke test (separate dir, own Node 24, own containers) — see §5.
14. Documentation, AGENTS.md, scripts; local git commit (no push).

## 3. What works (verified by running software)
- Reproducible local stack: `scripts/ioeti.sh init → db-up → run → install-apps → health/smoke/ui`.
- Upstream untouched: `git -C axelor-app status` and AOS status are empty with IOETI modules installed.
- IOETI extension architecture: new entity (`ioeti_business_line`), native Opportunity extended (field + form + JPA listener), repository validation, data-init seeds (5 business lines, group, record-level permission), Arabic translations, Arabic user language (selection override), REST `/ws/ioeti/business-lines[/{code}]`, tracking.
- Security: deny-by-default, record-level conditions on both generic and IOETI APIs, write denied, anonymous refused; mitigation filter for the upstream thread-user leak (0/450 leaks after 3 admin restores vs 10–20 % without).
- Arabic: RTL UI, Arabic data in UI/API, Arabic normaliser utility.

## 4. What does not work / not done
| Item | Status | Detail |
|---|---|---|
| Field-level read restriction (`MetaPermission canRead=false`) through `/ws/rest` | FAIL (upstream limitation) | value still returned; mitigation is architectural (SECURITY_MODEL.md §3) |
| Upstream thread-bound user leak | FAIL upstream / PASS mitigated | `docs/upstream-issues/AOP-thread-bound-user-leak.md`; not reported to Axelor yet (owner decision) |
| Arabic PDF with Axelor HTML printing (Flying Saucer) | FAIL (RTL layout) | Chromium PASS; BIRT NOT_TESTED |
| Upstream AOS Arabic translations | not available | en/fr only |
| Studio custom model, BPMN, DMN, MFA, global audit log, Axelor Mobile | NOT_TESTED | present in build; next phase |
| `scripts/ioeti.ps1` on Windows | NOT_TESTED | mirrors the bash script; machine was Linux |
| CI pipeline | not created | BACKLOG 1.1 |
| Production configuration, backups | not created | BACKLOG 1.5 |
| Requirement IDs catalogue | not created | BACKLOG 0.2 (spec incomplete) |
| Upstream startup errors (3 view-loader ERROR lines) | present in pure upstream baseline | harmless for IOETI |

## 5. Open Mercato
Source reconnaissance done (OPEN_MERCATO_RESEARCH.md). Smoke test: `crm` preset initialization
FAILED ("Metadata for entity ApiKey not found"); `classic` preset installed, initialized, login page
and login API returned 200, then the Next.js dev runtime exited unexpectedly (twice), so backend
pages were not verified (`evidence/open-mercato-smoke.txt`).

## 6. Reproduction
```bash
cd /home/user/ioeti
scripts/ioeti.sh init && scripts/ioeti.sh db-up && scripts/ioeti.sh test
scripts/ioeti.sh run            # terminal 1; wait for "Ready to serve..."
scripts/ioeti.sh install-apps   # terminal 2, once per database
scripts/ioeti.sh health && scripts/ioeti.sh smoke && scripts/ioeti.sh ui
scripts/ioeti.sh restore-meta && scripts/ioeti.sh probes   # security regression probes
```

## 7. Next steps
See BACKLOG.md. Immediate: decisions 0.1–0.5 (missing spec sections, requirement IDs, accounting
depth, `/ws/rest` exposure), then CI (1.1), roles/scopes (1.2–1.4), PDF renderer (1.6).
Recommendation: **CONTINUE WITH AXELOR** under the conditions in PLATFORM_DECISION.md.
