# Open Mercato — independent reconnaissance (secondary candidate)

Inspected in a separate directory (`/home/user/research/open-mercato`, not part of the IOETI repo),
HEAD `4374c48def1654927805c4b760f0e7f8648280f2` (2026-10-16). Nothing from Open Mercato was
integrated into the Axelor foundation. "Proven" = seen in repository source; "claim" = marketing
text in README/docs not verified by running it.

## 1. Project facts (proven)
| Item | Finding |
|---|---|
| Age / releases | first commit 2025-09-10; tags v0.6.x → **v0.9.0 (2026-10-09)**, v0.8.0 (2026-09-18), v0.7.0 (2026-08-25): pre-1.0, roughly monthly minors |
| Activity | 2,094 commits in the last 90 days; `CHANGELOG.md` 341 KB, `UPGRADE_NOTES.md` 288 KB (high churn) |
| Stack | TypeScript monorepo; Next.js 16.3, React 19.2, MikroORM 7, Awilix DI, BullMQ, zod 4; PostgreSQL 17 + pgvector, Redis 7, Meilisearch; **Node 24** required |
| Licence | core **MIT**; `packages/enterprise` is **commercial** (no production/commercial use without a licence): modules `security` (MFA), `sso`, `record_locks`, `agent_orchestrator`, `system_status_overlays` |
| Vendor production stance | enterprise README: "Uncertified Open Mercato deployments should not go to production" — production = enterprise licence + architecture/security audit; per-project, revenue-tiered pricing with usage "phone home" |
| Docs | in-repo Docusaurus (`apps/docs`); docs.openmercato.com not reachable from this sandbox |
| Tests | 3,763 unit test files, 1,464 integration specs (`__integration__/TC-*.spec.ts`) |
| i18n | locales **en, de, es, pl, ko** — **no Arabic, no RTL handling found** |

## 2. Ready-made business modules (proven, `packages/core/src/modules`, 46 modules)
api_docs, api_keys, attachments, audit_logs, auth, availability, business_rules, catalog,
communication_channels, configs, currencies, customer_accounts, customer_groups, **customers**,
dashboards, data_sync, design_system, devices, dictionaries, directory, entities, eudr,
feature_toggles, **forms**, inbox_ops, integrations, messages, notifications, payment_gateways,
perspectives, phone_calls, planner, portal, progress, push_notifications, query_index, resources,
**sales**, seeds, shipping_carriers, staff, sync_excel, translations, warranty_claims, widgets, wms,
**workflows**.

- **CRM (`customers`)**: people + companies (polymorphic `customer_entities`), person–company links
  and roles, **deals with multiple pipelines** (`customer_pipelines`, `customer_pipeline_stages`,
  stage transitions), activities, interactions, comments, addresses, tags/labels, billing data.
  No separate Lead entity: lifecycle is a `lifecycle_stage` field on the customer entity.
- **Sales**: quotes (+ lines, adjustments), orders, invoices, credit memos, payments + allocations,
  tax rates, document sequences, shipments/returns (commerce oriented).
- **Platform**: custom fields (EAV) + admin-created virtual entities ("Data designer"), step-based
  **workflow engine** (user tasks, async activities, event triggers, signals, compensation),
  business rules, forms module, audit logs, translations module, dashboards, portal.
- **Not present for IOETI**: contracts/MOUs with renewals, projects/engagements, field
  service/audit visits, quality/CAPA, external training, client recruitment, fundraising
  (donor/grant), payment milestone invoicing.

## 3. Architecture & extension model (proven)
- Module = folder with `acl.ts` (features), `setup.ts` (default role grants), `di.ts` (Awilix),
  `events.ts` (declared events), `extension-points.ts` (data-table / CRUD-form / detail injection
  hosts), `migrations/` (MikroORM per module), `ce.ts` (custom-field registration), `i18n/`.
- Cross-module integration via events, widget/menu injection, extension points; DI resolution only.
- **RBAC**: string features (`module.action`) granted to roles and per-user ACL overrides,
  organisation visibility lists, tenant + organisation scoping on every entity. No record-ownership
  conditions (Own/Team) and **no field-level read ACL** found; PII protected by **field encryption
  maps** instead (`encryption.ts`).
- **Backward-compatibility contract** (`BACKWARD_COMPATIBILITY.md`): deprecation protocol, bridges,
  spec required for contract changes.
- **AI-agent workflow**: 31 KB root `AGENTS.md`, per-module `AGENTS.md` (Always / Ask first / Never /
  validation commands), spec-first `.ai/specs/`, skills, and the Cezar orchestrator (MIT). This is the
  strongest part of the project.

## 4. "Start with 80% done" — measured against IOETI, not generic business software
Using the IOETI domain list (DOMAIN_GAP_ANALYSIS.md): Open Mercato covers CRM people/companies,
multi-pipeline deals, quotes/invoices/payments, workflows, custom entities and forms. It does **not**
cover contracts, engagements/handover, ISO certification operations, audit visits/checklists,
CAPA, training, recruitment for clients, fundraising, Arabic/RTL, MFA/SSO (enterprise). For IOETI the
reusable share is closer to **30–40 %** than 80 %, and the uncovered part contains the
highest-risk domains.

## 5. Smoke test (optional, isolated: own directory, Node 24.22, own containers)
Evidence: `docs/evidence/open-mercato-smoke.txt`.
| Step | Result |
|---|---|
| Tooling | Node 24 required (system had 22 → downloaded locally); corepack could not reach `repo.yarnpkg.com` from the sandbox → Yarn 4.17.1 via `COREPACK_NPM_REGISTRY=https://registry.npmjs.org`; Docker Hub pulls needed retries (HTTP 429) |
| `npx create-mercato-app --preset crm` (v0.9.0 packages) | scaffold + install + migrations OK; **initialization FAILED**: "Metadata for entity ApiKey not found" |
| `--preset classic` (README default) | install, artifacts, migrations, **initialization OK** (54 s); `/login` page **200**; `POST /api/auth/login` **200** (first compile ~28 s) |
| Backend pages (customers, deals, quotes) | **NOT VERIFIED**: the Next.js dev runtime exited unexpectedly ("dev server exited unexpectedly with exit code 0") right after warming the login route, reproduced in `yarn setup` and in a separate `yarn dev` run, on a 4 vCPU / 15 GB VM that was also running Axelor |

Conclusion: the framework installs and authenticates, but the documented CRM preset failed and the
dev runtime was not stable in this environment. Not investigated further (secondary candidate).

## 6. Comparison for IOETI

| Criterion | Axelor (foundation) | Open Mercato |
|---|---|---|
| A. Reusable logic for IOETI | CRM, quotes/versions, pricing formulas, contracts+renewal, milestone invoicing, accounting, projects, intervention visits + checklists, quality improvement, GDPR, mobile app | CRM + multi-pipeline deals, quotes→invoices→payments, workflows, forms |
| B. Effort for missing domains | XML domains + Java services; Studio/BPM for config; ISO/training/recruitment/fundraising still new modules | TypeScript modules; most IOETI domains are new modules, plus contracts/projects/quality/field service |
| C. Workflow customisation | Studio BPMN + DMN (AGPL), configurable by admins | step-based workflow engine + business rules (developer/admin) |
| D. Upgrade safety | stable 9.x line, AGPL, no free migration scripts; IOETI keeps upstream untouched | pre-1.0, fast-moving (288 KB upgrade notes), strong BC contract |
| E. Security model | model + record-condition permissions enforced on APIs; field rules UI/export only; upstream thread-user leak found and mitigated | feature RBAC + org scoping; no record ownership or field ACL found; MFA/SSO enterprise-only |
| F. AI-agent development speed | conventional Java/XML; IOETI AGENTS.md added | excellent: designed for agents (AGENTS.md per module, specs, skills) |
| G. Licence / commercial | AGPL everywhere used; portal backend & extras commercial | MIT core; vendor says production requires enterprise licence + certification |
| H. Arabic | RTL UI works; AOS strings en/fr only; PDF needs external renderer | no Arabic locale, no RTL found |
| I. Operational complexity | JVM app + PostgreSQL | Next.js app + PostgreSQL 17/pgvector + Redis + Meilisearch (+ optional others) |
| J. Evolvability into a product | mature ERP backbone, heavier UX | modern stack and UX, younger domain coverage |

## 7. Ideas worth adopting in the Axelor foundation (without copying code)
1. Per-module `AGENTS.md` with Always / Ask first / Never + validation commands (root AGENTS.md exists; add per module as modules grow).
2. Spec-first folder (`docs/specs/<module>/<feature>.md`) with "Open questions" and requirement IDs before code.
3. A backward-compatibility contract for IOETI REST DTOs and extension points.
4. Declared extension points per IOETI module (what other modules may extend).
5. Field-level **encryption** for PII (Axelor domain fields support `encrypted="true"`) in addition to structural isolation.
6. Integration test IDs (TC-xxx) mapped to requirement IDs.
