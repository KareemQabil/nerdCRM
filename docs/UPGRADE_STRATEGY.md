# Upgrade strategy

## Principles
1. Upstream code is consumed **unmodified**: `axelor-app` is a git submodule pinned to an
   open-suite-webapp tag, which pins the AOS submodule. `git -C axelor-app status` must be clean.
2. All IOETI code lives in `modules/ioeti-*`, `gradle/`, `infra/`, `scripts/`, `docs/`.
3. IOETI depends on upstream only through extension points: domain extension XML, view
   `extension="true"`, selection override by id/priority, Guice bindings of repositories/services,
   JPA listeners, REST resources, data-init. Each one is listed in `docs/UPGRADE_SURFACE.md`
   **(to create when there are more than a handful; today: see table below)**.
4. Community edition has **no official migration scripts** (Axelor forum); IOETI owns its upgrade
   testing.

## Current upstream touch points (re-check on every upgrade)

| IOETI file | Upstream contract it relies on |
|---|---|
| `ioeti-business-lines/domains/Opportunity.xml` | entity `com.axelor.apps.crm.db.Opportunity` exists in module `crm` |
| `ioeti-business-lines/views/Opportunity.xml` | form `opportunity-form` contains `//field[@name='opportunityType']` |
| `OpportunityBusinessLineListener` | JPA lifecycle on Opportunity; JPQL `Opportunity.ioetiBusinessLine` |
| `BusinessLineTestModule` | Guice modules `AuthModule, AppModule, UtilsModule, MessageModule, StudioModule, BaseModule, CrmModule` |
| `ioeti-core/views/Selects.xml` | selection `select.language` (axelor-core) |
| `scripts/install_apps.py` | action `com.axelor.studio.app.web.AppController:installApp` |
| `scripts/ioeti.sh restore-meta` | action `com.axelor.meta.web.MetaController:restoreAll` |
| `scripts/api_smoke_test.py` | `/callback` JSON login, `/ws/rest` payload shape, Shiro 2 argon2 hash format |
| `ioeti-business-lines/build.gradle` | `modules/axelor-open-suite/libs.gradle` (`libs.swagger_jaxrs`) |

## Procedure for a patch release (e.g. 9.1.10 → 9.1.11)
1. Branch `upgrade/aos-9.1.11`.
2. `git -C axelor-app fetch --tags && git -C axelor-app checkout v9.1.11 && git -C axelor-app submodule update`.
3. Read `axelor-app/CHANGELOG.md` and AOS `changelogs/` for touched entities/views listed above.
4. `scripts/ioeti.sh build && scripts/ioeti.sh test`.
5. Restore a copy of a recent IOETI database into a scratch volume, `run` (AOP applies
   `ddl=update`), then `restore-meta`, `smoke`, `ui`.
6. Commit the submodule pointer + any IOETI adjustments; record the new SHAs in
   `docs/UPSTREAM_BASELINE.md`.

## Minor/major releases (9.1 → 9.2, 9 → 10)
Same procedure plus: check the AOP plugin version and Java/PostgreSQL baseline, view XSD version
(`object-views_8.x.xsd`), Studio/BPM model migrations, and run on a production copy with a
rollback plan (database backup before upgrade, previous WAR kept).

## Database migrations (IOETI)
- Development: `ddl=update` adds tables/columns. It never drops or renames.
- Production: run with `db.default.ddl = none` and ship explicit SQL migration scripts per IOETI
  module (`modules/<m>/src/main/resources/db/migration/V<yyyymmdd>_<n>__<desc>.sql`, applied by a
  migration step in deployment — tool choice pending; Flyway is compatible). Renames/removals
  always go through a migration script plus a data backfill.
