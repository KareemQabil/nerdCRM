# Upstream baseline (pinned)

Verified on 2026-10-19. All versions below are what the running local instance uses.

## Source repositories

| Component | Repository | Pin | Commit SHA | Date | How pinned |
|---|---|---|---|---|---|
| Axelor webapp (application shell) | https://github.com/axelor/open-suite-webapp | tag `v9.1.10` | `dc50bc5a5c4006c607579bafa18c48564a951d6e` | 2026-10-16 | git submodule `axelor-app` of the IOETI repo |
| Axelor Open Suite (26 modules) | https://github.com/axelor/axelor-open-suite | tag `v9.1.10` (`version.txt` = 9.1.10) | `e7cbea53bae88d2540f59a70b09bf0f326f1022e` | 2026-10-16 | nested submodule `axelor-app/modules/axelor-open-suite`, commit pinned by the webapp tag |
| Axelor Open Platform | artifacts `com.axelor:axelor-core/web/tomcat/test:8.2.5` and Gradle plugin `com.axelor.app` 8.2.5 (in `axelor-app/settings.gradle`) | 8.2.5 | GitHub only has tags up to `v8.2.4` (`60071cb8`); 8.2.5 is consumed from `repository.axelor.com` | — | Gradle plugin version |
| Axelor Studio / BPM / DMN | https://github.com/axelor/axelor-studio, artifact `com.axelor.addons:axelor-studio:4.0.7` | 4.0.7 | tag object `403796c1`, commit `06d8c6dffa1f78a72009b560be53ba6e7b4047be` | — | `libs.gradle` of AOS (already a dependency — **not added again**) |
| axelor-message / axelor-utils | `com.axelor.addons:axelor-message:4.0.3`, `axelor-utils:4.0.2` | — | — | — | `libs.gradle` of AOS |

The webapp `.gitmodules` uses an SSH URL; `scripts/ioeti.sh init` overrides it **locally** with
HTTPS (`git config submodule.axelor-open-suite.url`) without changing the pinned commit.

## Release lines found
- open-suite-webapp tags: … v9.1.5 – **v9.1.10** (latest); branches `9.0`, `9.1-*`, `8.5`, `dev`, `master`, `wip`.
- AOP tags on GitHub: … v8.2.2, v8.2.3, v8.2.4. AOS 9.1.10 requires plugin 8.2.5.
- Axelor Studio tags: 4.0.5, 4.0.6, **4.0.7**.

## Toolchain (actual)

| Tool | Version | Notes |
|---|---|---|
| Java | OpenJDK 21.0.12 | `build.gradle` sets toolchain 21 |
| Gradle | 8.14.3 (wrapper) | deprecation warnings for Gradle 9 come from upstream scripts |
| PostgreSQL | 16.15 (`postgres:16-alpine`) | extensions `unaccent` 1.1, `pg_trgm` 1.6 |
| Node (front build of some AOS modules) | 24.5.0 downloaded by node-gradle | `axelor-base/build.gradle` (`download = true`) |
| Docker | 29.8.2 | only PostgreSQL runs in Docker |
| OS used for verification | Ubuntu 24.04 (x86_64, 4 vCPU, 15 GB RAM) | Windows: use WSL2 + same scripts, or `scripts/ioeti.ps1` |

## Licences
- open-suite-webapp, AOS: **AGPL-3.0** (`LICENSE` in both repos).
- Axelor Studio 4.0.x: source headers `SPDX-License-Identifier: AGPL-3.0-or-later` (no LICENSE file at repo root).
- AOP: AGPL-3.0 (artifacts from Axelor Maven).
- **Not available in Community / public sources**: the `axelor-portal` backend used by the Goovee
  portal (Goovee itself: Sustainable Use License + Enterprise-licensed parts), Axelor Pro/Enterprise
  features advertised as "advanced Studio", AI, BI, migration scripts. None of them is used here.
- Consequence for IOETI: modifications to AGPL code that are offered to users over a network must
  be made available to those users. IOETI's own modules are distributed under a licence compatible
  with AGPL-3.0 (recommendation: AGPL-3.0 as well).

## What was built and run
- `./gradlew assemble` of the unmodified upstream webapp: **BUILD SUCCESSFUL in 2m32s**,
  `axelor-erp-9.1.10.war` (304 MB).
- First start on an empty DB: 1,181 tables (1,182 with IOETI), all 32 modules registered
  (26 AOS + core, web, utils, message, studio, erp; + 2 IOETI).
- Known upstream startup errors (not caused by IOETI, present in the pure baseline log
  `logs/app-run-baseline.log`): duplicate `invoice-line-form`, duplicate action
  `action-prod-process-method-compute-hazard-phrases`, missing extend target in `base-message-form`.
- A fresh AOS database has **all 35 "apps" uninstalled**; IOETI installs the ones it reuses with
  `scripts/ioeti.sh install-apps` (base, crm, sale, contract, project, intervention, quality,
  marketing, gdpr + their dependencies account, invoice, purchase, stock, supplychain, employee).
