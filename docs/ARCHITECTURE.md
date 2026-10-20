# IOETI architecture on Axelor Open Suite

Status: foundation implemented and running (see EXECUTION_REPORT.md). Sections marked
**(proposed)** are not built yet.

## 1. Repository and runtime layout

```
ioeti/                                  IOETI repository (this repo, branch main)
├── axelor-app/                         git submodule → axelor/open-suite-webapp @ v9.1.10 (UPSTREAM, untouched)
│   └── modules/
│       ├── axelor-open-suite/          nested submodule → AOS @ v9.1.10 (UPSTREAM, untouched)
│       ├── ioeti-core -> ../../modules/ioeti-core                  symlink (git-excluded locally)
│       └── ioeti-business-lines -> ../../modules/ioeti-business-lines
├── modules/                            IOETI SOURCE (compiled into the Axelor app)
│   ├── ioeti-core/                     shared kernel
│   └── ioeti-business-lines/           first bounded context (vertical slice)
├── gradle/ioeti-module.gradle          shared build conventions for IOETI modules
├── infra/                              docker compose (PostgreSQL 16), DB init, Axelor config template
├── scripts/                            ioeti.sh / ioeti.ps1, smoke tests, probes, app installer
└── docs/
```

Why symlinks: the upstream `settings.gradle` auto-includes every directory under
`axelor-app/modules` that has a `build.gradle`. Linking keeps IOETI code in the IOETI repo, keeps
the upstream working tree clean (`git -C axelor-app status` is empty), and needs **zero upstream
edits**. The only side effect (JDK canonical paths in tests) is handled in
`gradle/ioeti-module.gradle`.

Runtime: one Axelor web application (embedded Tomcat via `gradlew run` in dev, WAR in production)
+ PostgreSQL 16. Config is the upstream `axelor-config.properties` overridden by
`.local/axelor-config.local.properties` rendered from `infra/axelor/*.template.properties` and `.env`
(`gradlew run --config`; production: `AXELOR_CONFIG` env var or `-Daxelor.config`).

## 2. Layers

**A. Upstream Axelor (reused, never edited)** — AOP (ORM, security, REST, views, i18n, Quartz),
AOS functional modules (CRM, sale, contract, account, project, intervention, quality, talent,
marketing, gdpr…), Studio/BPM/DMN. See MODULE_REUSE_MATRIX.md.

**B. IOETI domain (`modules/ioeti-*`, package `com.ioeti.<context>`)**
- entities in `domains/*.xml` with **explicit `table="ioeti_<name>"`** (default would use the
  package segment, e.g. `businessline_business_line`);
- extensions of upstream entities by redeclaring them in IOETI `domains/` (AOP merges fields and
  `entity-listener`s) — example: `Opportunity.ioetiBusinessLine` + `OpportunityBusinessLineListener`;
- domain rules in pure Java validators + repository `save()` overrides bound in the module's
  `AxelorModule` + JPA listeners for rules on upstream entities;
- REST resources under `/ws/ioeti/...` returning DTO records;
- views/menus/selections/translations as XML/CSV in the module; seeds + permissions in `data-init`.

**C. Infrastructure** — PostgreSQL 16 (`unaccent`, `pg_trgm`), attachments under
`IOETI_DATA_DIR`, logs under `logs/`, Quartz for jobs (proposed use for SLA timers), health check
`scripts/ioeti.sh health`, tests (JUnit 6 + Axelor `GuiceExtension` on HSQLDB; Python API tests;
Playwright UI tests).

**D. Experience** — native Axelor web UI (RTL for Arabic), IOETI menus under "IOETI", Arabic
translations per module; Axelor Mobile for field work **(proposed)**; optional custom frontend
**(proposed, not now)**.

## 3. Module decisions

Compiled now (each has a purpose and tests):

| Module | Purpose | Depends on |
|---|---|---|
| `ioeti-core` | IOETI root menu, Arabic language + translations, `ArabicTextNormalizer`, `StaleThreadUserFilter` (security mitigation), shared conventions | `axelor-base` |
| `ioeti-business-lines` | `BusinessLine` registry, Opportunity extension + listener, viewer group/permission seeds, REST read API | `ioeti-core`, `axelor-crm` |

Documented boundaries (create only when the first real requirement is implemented):

| Future module | Owns | Builds on (upstream) |
|---|---|---|
| `ioeti-sales-extension` | lead lifecycle/SLA fields, IOETI quote rules, approvals, per-line pipelines | crm, sale |
| `ioeti-handover` | handover + engagement objects, task templates per business line | project, contract |
| `ioeti-certification` | certification cycle, audit programme, client certificates, surveillance/renewal | intervention, quality, contract |
| `ioeti-training` | courses, cohorts, trainees, attendance, certificates | (new domain; talent only for skills/categories) |
| `ioeti-recruitment` | client recruitment requests, placements, guarantee | talent (applications, stages) |
| `ioeti-fundraising` | donors, grants, commitments, receipts | crm (pipeline), account |
| `ioeti-automation` | assignment, SLA timers, event→invoice request, notifications | Quartz, BPM |
| `ioeti-integrations` | PDF renderer (Gotenberg), WhatsApp, lead-ads webhooks, n8n | — |
| `ioeti-reporting` | dashboards per role, KPIs | Studio dashboards |

Dependency rule: `ioeti-*` modules depend on `ioeti-core` and on upstream modules; never on
each other in cycles; cross-context links go through IDs/events or a lower module.

## 4. UI strategy — SUPERSEDED BY ADR-001 (2026-10-19)

The table below is a historical phase-1 evaluation. **It is not the current product decision.** The current decision is FULLY CUSTOM UI for all employees AND business administrators, in apps/ioeti-web, backed by authorized IOETI DTO/command APIs. See docs/decisions/ADR-001-FULLY-CUSTOM-UI.md. Native Axelor UI is developer/maintenance-only.

### Historical comparison

| Option | Pros | Cons |
|---|---|---|
| 1. Extend native Axelor UI | zero extra stack; RTL proven; security, forms, grids, kanban, dashboards, Studio for free; mobile app exists | Axelor look & feel; upstream labels need Arabic translation; UX limited to Axelor widgets |
| 2. Axelor headless + custom frontend | full IOETI UX control | rebuild every screen; API hardening required (generic `/ws/rest` leaks fields — SECURITY_MODEL.md); doubles cost |
| 3. Hybrid | native UI for back office; small custom apps (public course registration, client portal, field forms) on IOETI APIs | two UIs to maintain (but small) |

**Historical decision, no longer valid: Option 1 (native UI).** Move to Option 3 only for public/external
surfaces (course registration, certificate verification, client portal), built on IOETI DTO APIs —
not on the generic `/ws/rest` API.

## 5. Integrations (proposed)
- PDF: Chromium-based renderer (Gotenberg) for Arabic documents — required (ARABIC_AND_PDF.md).
- Automation/integrations: `axelor/n8n-nodes-axelor` (MIT) + n8n/Activepieces for lead ads,
  WhatsApp, e-mail sequences; Chatwoot for WhatsApp inbox.
- Egypt e-invoicing (ETA): external integration if IOETI's accountant does not cover it.
