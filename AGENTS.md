# AGENTS.md — rules for AI coding agents (Codex, Claude, …) and humans

## UI interaction rules — record details are NEVER the navigation drawer

Keep existing global left/right App navigation and module switching unchanged. The user explicitly corrected the distinction: **"View details" opens a full record page within the current shell, never a narrow drawer.** Follow docs/design/RECORD_INTERACTION_RULES.md. A bounded quick edit may use a centered modal; a complex workflow must be a full page. Per-module record UX is driven by task/decision complexity, not generic CRUD templates.

## Product direction — authoritative UI decision

**Accepted ADR-001:** IOETI is a fully custom React/TypeScript user experience. Axelor is the domain engine, NOT the final UI, including everyday admin. Read docs/decisions/ADR-001-FULLY-CUSTOM-UI.md and docs/design/NERDPOS_PHILOSOPHY_TO_CRM.md. Native Axelor views are developer/maintenance-only. Design tokens, themes, RTL/LTR, layouts and UI components belong under apps/ioeti-web. Never build normal IOETI workflows in native Axelor views as the final product. Never substitute generic /ws/rest for explicit, authorized IOETI API contracts.

IOETI Egypt business operating system on **Axelor Open Suite 9.1.10 / Axelor Open Platform 8.2.5**
(Community, AGPL). Read `docs/ARCHITECTURE.md`, `docs/SECURITY_MODEL.md` and
`docs/MODULE_REUSE_MATRIX.md` before changing anything.

## System map
- `axelor-app/` — **UPSTREAM** submodule (open-suite-webapp v9.1.10) with nested AOS submodule.
  **Never edit, commit inside, or reformat anything here.** `git -C axelor-app status` must stay clean.
- `modules/ioeti-*` — IOETI modules (Java packages `com.ioeti.<context>`), linked into
  `axelor-app/modules/` by `scripts/ioeti.sh init|run`.
- `gradle/ioeti-module.gradle` — must be applied by every IOETI module.
- `infra/` — PostgreSQL 16 compose, DB init SQL, Axelor config template. `scripts/` — dev commands and tests.

## Where to put things
| Need | Place |
|---|---|
| New bounded context | new `modules/ioeti-<context>/` (copy `ioeti-business-lines` structure), add it to `IOETI_MODULES` in `scripts/ioeti.sh` and `$Modules` in `scripts/ioeti.ps1` |
| New entity | `modules/<m>/src/main/resources/domains/<Entity>.xml`, package `com.ioeti.<context>.db`, **explicit `table="ioeti_<snake_name>"`** |
| Field on an upstream entity | redeclare the entity in the IOETI module's `domains/` with the **upstream** `<module name=… package=…/>`; prefix new fields `ioeti` (e.g. `ioetiBusinessLine`) |
| Any new IOETI table/column/index | add `db/migrations/V###__name.sql` (idempotent, same names Hibernate generates) and `db/migrations/rollback/U###__name.sql`; `python3 scripts/db_migrate.py verify` must pass (backend CI enforces it). Never edit an applied migration |
| Any new field in an IOETI REST record (request or response) | classify it in `docs/security/pii-classification.json` (`REFERENCE`, `BUSINESS`, `PERSONAL`, `RESTRICTED`); `RESTRICTED` (contact details, identity numbers, personal money, free text about a person) is input-only. `python3 scripts/pii_dto_audit.py` must pass (backend CI enforces it). See `docs/security/PII_CLASSIFICATION.md` |
| Rule on an IOETI entity | pure validator class (unit-tested) + `<Entity>ManagementRepository.save()` bound in the module's `AxelorModule` |
| Rule on an upstream entity | JPA `entity-listener` declared in the IOETI domain extension (see `OpportunityBusinessLineListener`); do **not** subclass upstream `*ManagementRepository` bindings unless unavoidable |
| UI change to an upstream form/grid | view with `extension="true"` and `<extend target=…>` in the IOETI module |
| Selection change | new `<selection>` with the same name and an `id` (higher priority wins) |
| Menus | under `ioeti-root` (defined in `ioeti-core`) |
| Labels | English in XML/Java; Arabic in `src/main/resources/i18n/messages_ar.csv` of the module |
| Seeds, groups, permissions | `src/main/resources/data-init/` (imported once at module install) |
| REST API | `com.ioeti.<context>.rest`, `@Path("/ioeti/<resource>")`, returns DTO records |
| Library versions | reuse `modules/axelor-open-suite/libs.gradle` (`apply from: rootProject.file(...)`) |

## Dependency rules
- IOETI modules depend on `ioeti-core` and upstream modules only; no cycles between IOETI modules.
- Never depend on Axelor Enterprise/Pro modules, Goovee or private repositories.
- New third-party libraries need a licence compatible with AGPL-3.0 and a note in the PR.

## Security invariants (non-negotiable)
1. Every new model gets permissions in `data-init` (Axelor is deny-by-default for non-admin users).
2. Every custom REST endpoint: `new SecurityCheck().readAccess/writeAccess(...).check()` **and**
   `JpaSecurity.getFilter(...)` applied to list queries (record-level conditions).
3. Field-level `MetaPermission` rules are **not enforced on API reads** (verified). Sensitive data
   (cost, margin, salary, donor, national ID) goes into separate entities with model permissions,
   and APIs return DTOs that omit it.
4. Domain rules live in repositories/listeners/services, never only in views.
5. Never create users with plaintext passwords through `/ws/rest`.
6. No secrets in git: `.env` and `.local/` are ignored; config comes from
   `infra/axelor/axelor-config.ioeti.template.properties` + `.env`.
7. Every rule gets a negative test.
8. Never remove `com.ioeti.core.web.StaleThreadUserFilter`: it mitigates an upstream AOP leak where a
   pooled request thread keeps an admin identity (docs/upstream-issues/AOP-thread-bound-user-leak.md).
   Run `scripts/ioeti.sh probes` after upgrades; any leak is a release blocker.

## Database migration rules
- Dev uses `ddl=update` (adds only). Never rename/drop a column in XML without a migration script
  under `src/main/resources/db/migration/` and a note in `docs/UPGRADE_STRATEGY.md`.
- Seeds must be idempotent (`search="self.code = :code"`).

## API guidelines
- Paths `/ws/ioeti/<plural-resource>[/{code-or-id}]`; JSON via `ResponseConstructor.build(status, message, dto)`.
- Use business keys (code) in APIs where they exist; normalise case.
- Do not expose JPA entities; do not rely on the generic `/ws/rest` for non-admin integrations.

## Testing expectations
- `scripts/ioeti.sh test` — unit tests for validators/utilities; JPA tests with the Guice graph in
  the module's `*TestModule` (HSQLDB) for repositories/listeners.
- `scripts/ioeti.sh smoke` and `ui` against a running app for API/permission/UI behaviour.
- Never report a test as passing without running it; paste the summary line.

## Forbidden
- Editing, patching or force-updating anything under `axelor-app/` (including its submodule pins)
  except through the documented upgrade procedure.
- `git push`, force push, history rewrites, destructive resets, deleting Docker volumes other than
  `ioeti_dev_pgdata` via `scripts/ioeti.sh reset-db`.
- Using production credentials or connecting to production systems.

## Definition of Done (per change)
- Code + XML in an IOETI module only; module builds (`scripts/ioeti.sh build`).
- Unit/JPA tests added and passing (`scripts/ioeti.sh test`).
- If views/i18n changed: `restore-meta` done and UI checked; Arabic label added.
- Permissions + negative test for new data access paths; `smoke` passes.
- Docs updated (reuse matrix / gap analysis / upgrade touch points) when an upstream contract is used.
- Requirement IDs referenced in the commit message once the requirements catalogue exists.
