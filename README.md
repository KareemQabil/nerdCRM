# IOETI Egypt — Business Operating System (development foundation)

Built on **Axelor Open Suite 9.1.10** (Community, AGPL-3.0) without modifying upstream code.
IOETI-specific code lives in `modules/ioeti-*`; Axelor is a pinned git submodule in `axelor-app/`.

Status: Axelor foundation (phase 1) plus custom IOETI React UI (design + read-only Business Lines vertical slice). See `docs/EXECUTION_REPORT.md` for backend checks and `apps/ioeti-web/README.md` for frontend scope; frontend is not production-ready.

## Quick start (Linux / macOS / WSL2)
```bash
scripts/ioeti.sh init          # .env with generated secrets, submodules, config, module links
scripts/ioeti.sh db-up         # PostgreSQL 16 on 127.0.0.1:5433
scripts/ioeti.sh run           # http://localhost:8080/axelor-erp  (admin / admin on a new DB — change it)
scripts/ioeti.sh install-apps  # once per database, in a second terminal after "Ready to serve..."
scripts/ioeti.sh test | smoke | ui | health | restore-meta | status
```
Windows: WSL2 recommended; `scripts\ioeti.ps1` covers init/db-up/build/run/health.

## Custom IOETI interface

The product UI is independent from Axelor (ADR-001). Run the local React app from apps/ioeti-web with npm install && npm run dev after starting Axelor. Inspired by user-supplied NerdPOS design tokens and five-level attention hierarchy: Light, Dark and Luxury themes; Arabic RTL/English LTR; compact/comfortable density; alternate navigation; real read-only Business Lines data. No mock CRM records.

The original Axelor UI is retained for developer/maintenance only. See docs/design/NERDPOS_PHILOSOPHY_TO_CRM.md.

## Documentation
| Document | Content |
|---|---|
| [AGENTS.md](AGENTS.md) | rules for AI agents and developers (where code goes, invariants, DoD) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | layers, module boundaries, UI strategy |
| [docs/UPSTREAM_BASELINE.md](docs/UPSTREAM_BASELINE.md) | pinned versions, SHAs, toolchain, licences |
| [docs/MODULE_REUSE_MATRIX.md](docs/MODULE_REUSE_MATRIX.md) | what Axelor provides per IOETI need, with source paths |
| [docs/DOMAIN_GAP_ANALYSIS.md](docs/DOMAIN_GAP_ANALYSIS.md) | what must be built, ranked by risk |
| [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) | enforced vs UI-only protections, record scopes |
| [docs/ARABIC_AND_PDF.md](docs/ARABIC_AND_PDF.md) | RTL, translations, Arabic PDF findings |
| [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md) | setup, workflow, troubleshooting |
| [docs/UPGRADE_STRATEGY.md](docs/UPGRADE_STRATEGY.md) | upstream upgrades, migrations |
| [docs/OPEN_MERCATO_RESEARCH.md](docs/OPEN_MERCATO_RESEARCH.md) | secondary platform investigation |
| [docs/PLATFORM_DECISION.md](docs/PLATFORM_DECISION.md) | continue / reconsider recommendation |
| [docs/EXECUTION_REPORT.md](docs/EXECUTION_REPORT.md) + [docs/execution-summary.json](docs/execution-summary.json) | what was run, evidence, PASS/FAIL |
| [docs/BACKLOG.md](docs/BACKLOG.md) | next-stage implementation backlog |
| [docs/reference/](docs/reference/) | requirements spec (sections 1–9), handoff, earlier platform comparison |

## Licence
IOETI modules are intended to be released under AGPL-3.0 (same as Axelor). Axelor components keep
their own licences (see `axelor-app/LICENSE`).
