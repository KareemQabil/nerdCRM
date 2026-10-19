# Development guide

## Prerequisites
- Java 21 (Temurin/OpenJDK), Git, Docker (Desktop on Windows/macOS), Python 3.10+, Node 20+ (only
  for UI tests; Playwright with Chromium).
- 8 GB RAM minimum (16 GB recommended): Gradle + Axelor need ~3–4 GB, PostgreSQL ~0.5 GB.
- Network access to `repo.maven.apache.org`, `repository.axelor.com`, `plugins.gradle.org`,
  `services.gradle.org`, `nodejs.org`, Docker Hub.

## First setup (Linux, macOS, WSL2)
```bash
git clone --recurse-submodules <ioeti-repo-url> ioeti   # or: git clone … && cd ioeti
cd ioeti
scripts/ioeti.sh init        # .env with generated secrets, submodules (HTTPS), config, module links
scripts/ioeti.sh db-up       # PostgreSQL 16 on 127.0.0.1:5433 (unaccent, pg_trgm)
scripts/ioeti.sh build       # ~2.5 min first time (downloads dependencies)
scripts/ioeti.sh run         # first start on empty DB ~4 min; then http://localhost:8080/axelor-erp
# in another terminal, once "Ready to serve..." is logged:
scripts/ioeti.sh health
scripts/ioeti.sh install-apps   # installs AOS apps IOETI reuses (one time per database)
scripts/ioeti.sh smoke          # API + permission checks (16 checks)
scripts/ioeti.sh ui             # browser checks (7 checks; needs Playwright)
```
Default login on a new database: `admin` / `admin` — **change it immediately** on any shared
environment. Tests read `IOETI_ADMIN_USER` / `IOETI_ADMIN_PASSWORD`.

## Windows
Recommended: WSL2 (Ubuntu) + Docker Desktop with WSL integration, then use the Linux commands
inside WSL (keep the repo on the WSL filesystem for speed). Native PowerShell is supported for the
main commands: `scripts\ioeti.ps1 init|db-up|build|run|health`. Symlinks on native Windows need
Developer Mode (or an elevated shell); `init` falls back to directory junctions.

## Daily workflow
| I changed… | Do |
|---|---|
| Java code in an IOETI module | restart `scripts/ioeti.sh run` (Gradle recompiles) |
| `domains/*.xml` (new field/entity) | restart; schema is updated automatically in dev (`db.default.ddl = update`) |
| views, menus, selections, `i18n/*.csv` of an **already installed** module | `scripts/ioeti.sh restore-meta` (≈40 s) and refresh the browser — a plain restart does **not** reload them |
| `data-init` seeds | only imported when the module is first installed; for an existing DB import via the UI (Administration → Data management) or reset the dev DB |
| user language | users must log in again for a language change (and RTL) to apply |

## Tests
- `scripts/ioeti.sh test` — JUnit tests of IOETI modules (unit + JPA tests on in-memory HSQLDB with
  the real Axelor Guice graph: see `BusinessLineTestModule`). Results:
  `modules/*/build/test-results/test/*.xml`.
- `scripts/ioeti.sh smoke` — API end-to-end against the running app (creates and cleans up its
  own test records and a throw-away user).
- `scripts/ioeti.sh ui` — Playwright checks; screenshots in `logs/ui/`.
- `python3 scripts/field_permission_probe.py` — documents the field-rule gap (SECURITY_MODEL.md).

## Resetting the dev database
`scripts/ioeti.sh reset-db` deletes only the `ioeti-dev-postgres` container and the
`ioeti_dev_pgdata` volume, after typing `reset ioeti_dev`. Attachments under `.local/data` are
kept. Then `db-up`, `run`, `install-apps`.

## Troubleshooting
| Symptom | Cause / fix |
|---|---|
| Gradle `Received status code 429` | Maven Central rate limiting through a proxy: retry; build uses `--max-workers=2` |
| Docker pull `429 Too Many Requests` | Docker Hub anonymous limit: retry later or `docker login` |
| `ln: … File exists` in `run` | stale symlink; fixed in script — delete `axelor-app/modules/ioeti-*` link and re-run `init` |
| JPA test: `targets the type 'X' which does not belong to the same persistence unit` | test class path not canonical — module must apply `gradle/ioeti-module.gradle` |
| JPA test: missing `HibernateListenerConfigurator` / `ProcessEngineService` | install the full module graph in the test Guice module (Auth, App, Utils, Message, Studio, Base, Crm, IOETI) |
| User created by API cannot log in ("User is disabled") | users are created `blocked=true`; set `blocked=false` and a hashed password |
| "There's no configured sequence for opportunities" | CRM app not installed → `scripts/ioeti.sh install-apps` |
| New view/translation not visible | `restore-meta`, then hard refresh |
| Arabic not applied | user language `ar` + log out/in |
| Port 5433 in use | change `IOETI_DB_PORT` in `.env`, re-run `init` |
| Startup log shows 3–4 ERROR lines about `invoice-line-form`, hazard phrases, `base-message-form` | upstream AOS 9.1.10 issues, harmless for IOETI |

## Logging
Axelor logs to the console (`logs/app-run*.log` when started by the scripts) and to
`logs/axelor.log` (`logging.path`). Levels: root WARN, `com.axelor` INFO, `com.ioeti` DEBUG
(`infra/axelor/axelor-config.ioeti.template.properties`).
