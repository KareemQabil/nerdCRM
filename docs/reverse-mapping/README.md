# IOETI / nerdCRM — pinned-source reverse mapping master

**Snapshot:** 2026-10-19. **Analysis-only branch.** Based on the current custom-UI branch head `82fe3e4fd6aa469ba536cd0b26c588c4ee9cf9f6` (before independent Claude changes) and the exact Axelor Open Suite v9.1.10 commit `e7cbea53bae88d2540f59a70b09bf0f326f1022e`. The source and runtime are **separate forms of evidence**.

## Purpose and non-overclaim

This is a source-complete **tracked-file index** of **all 26 top-level AOS business modules**, plus a **377-row requirement/capability-to-source/UX/GAP traceability map**. It does **not** claim that every Java method has been manually reviewed, that an entity constitutes an implemented IOETI capability, that all AOP/Studio internals have been exhaustively indexed, or that missing requirement sections have magically been recovered. Until all such evidence is available, "absolutely no gaps" is not an intellectually valid assertion.

### Entry points

1. [Source counts](SOURCE_SCOPE_COUNTS.json): 26 AOS top-level modules; **7,865 tracked Git files**, including **961 domain XML files** and **976 view XML files** (domain XML can extend an upstream entity; it is *not* unique-model count).
2. [Raw tracked-file ledger](source-ledger/): **one CSV for every AOS module**, including every Git blob in that module, exact path and blob hash. No files were filtered out. Use the [upstream pinned tree](https://github.com/axelor/axelor-open-suite/tree/e7cbea53bae88d2540f59a70b09bf0f326f1022e).
3. [IOETI repository ledger](IOETI_REPO_FILE_LEDGER.csv): source code, custom UI, infrastructure, scripts and documents as of the branch creation.
4. [Identity, business line, lead, account and opportunity mapping](CAPABILITY_CORE_CRM_TRACE.csv): 88 capabilities.
5. [Catalog, quote, contract, finance, operations and marketing mapping](CAPABILITY_COMMERCIAL_OPERATIONS_TRACE.csv): 84 capabilities.
6. [ISO, external training, client recruitment, fundraising](CAPABILITY_SPECIALIZED_IOETI_TRACE.csv): 86 capabilities.
7. [Documents, automation, admin, analytics, UX, security, deployment, integrations, scope](CAPABILITY_PLATFORM_AND_GOVERNANCE_TRACE.csv): 119 capabilities.
8. [API-001 Claude PR #6 reconciliation](PR6_API001_RECONCILIATION.md) — verified latest GitHub CI and remaining security boundary work.
9. [Pinned Studio 4.0.7 source ledger](platform-source-ledger/axelor-studio-4_0_7.csv), [Utils 4.0.2 source ledger](platform-source-ledger/axelor-utils-4_0_2.csv), and [Webapp wrapper ledger](platform-source-ledger/open-suite-webapp-v9_1_10.csv) extend coverage to metadata/BPM/DMN/exception utilities.
10. [Gap register and dependencies](GAP_REGISTER.md) and [verified upstream service methods](SERVICE_METHOD_EVIDENCE.md).

**Total: 377 capability rows. In addition to 7,865 AOS files, the pinned Studio (1,825 files), Utils (494 files), and Webapp wrapper (56 files) have been indexed — **10,240 tracked-file ledger rows** across these sources. Axelor Open Platform 8.2.5 remains a binary dependency without a resolved version-specific public Git tree, so its internal implementation must be checked from exact dependency source JAR/decompiled symbols in a dedicated pass.** This is traceability coverage against *available documents*, not a functionality completion percentage.

## Baseline requirement provenance

- **PRIMARY / SPEC:** `docs/reference/IOETI_CRM_Requirements_Spec_sections_1-9.md`. The provided specification covers general scope, identity/roles, lines & catalog, Leads, Sales pipelines, Accounts/Contacts, Quotes, Contracts/Payments, Training.
- **HANDOFF:** `docs/reference/IOETI_CRM_MEGA_HANDOFF.md`, especially §§6–14. It supplements ISO, recruitment, fundraising and other topics but is *planning/hypothesis*, **not** a signed product acceptance specification.
- **SOURCE:** `docs/MODULE_REUSE_MATRIX.md`, `docs/DOMAIN_GAP_ANALYSIS.md`, `docs/UX_REVERSE_MAPPING.md`; plus fresh pinned AOS Git-tree sweep and independently read service interface declarations.
- **PROJECT DECISION:** `docs/decisions/ADR-001-FULLY-CUSTOM-UI.md` and `docs/design/RECORD_INTERACTION_RULES.md`. They override historical native-UI-first advice.
- **EVIDENCE:** `docs/EXECUTION_REPORT.md`, `docs/PILOT_PLAN.md`, `docs/evidence` and GitHub Actions are time-bound tests. Do not treat initial 16/16 smoke as proof for all new entities and endpoints.

## UI/API interaction ledger added in parallel with PR #8

- [UI/API Surface Contracts](UI_API_SURFACE_CONTRACTS.json): **52 traced surfaces**. Each carries capability IDs, native source models, a concrete or proposed API route, interaction type, verified implementation state, a negative authorization acceptance condition, and dependency. All 52 capabilities links are validated by CI.
- [Source field → DTO → Record UI evidence](FIELD_TO_DTO_EVIDENCE.md) and [Commercial/finance/operations relationships](COMMERCIAL_FIELD_RELATIONSHIP_EVIDENCE.md) documents actual Lead/Partner/Opportunity declarations and currently-exposed vs restricted fields.
- [Source-driven UI implementation queue](NEXT_UI_SLICES.md): explicit next sequence based on current DTO fields and permission/test dependencies.
- [PR #8](https://github.com/KareemQabil/nerdCRM/pull/8) implements the **full Opportunity record workspace** with the existing global sidebar unchanged, correct route `#/opportunities/{id}`, contextual rename modal, deep link, and visibly disconnected related areas. The separate frontend tests/CI passed for PR #8. The code is **not merged**, so the mapping row retains DRAFT_PR8 rather than verified production.

All routes labelled NOT_IMPLEMENTED in the JSON are **API proposals, not existing endpoints**. Do not expose fake data or call them from a connected UI until the backend is approved.

## How to read capability CSV files

| Column | Meaning |
|---|---|
| `id` | Stable requirement/capability key, prefixed by area, e.g. `LD-011` |
| `requirement_source` | The SPEC section, HANDOFF section, or explicit project decision |
| `upstream_source_symbols` | `moduleAlias:ClassOrDomain` references; **not** proof of method behavior |
| `reuse_strategy` | Whether to use native objects, configure, extend, build new bounded domain, integrate externally, or deliberately defer |
| `implementation_state` | Explicit current evidence; default NOT_IMPLEMENTED_OR_NOT_EVIDENCED means precisely that |
| `outstanding_work` | Build gap or required decision |
| `ui_interaction` | Suggested custom UI surface, using record vs task vs modal policy |
| `priority` | Release priority: P0 security/integrity, P1 essential platform/product, P2 deferred/conditional |
| `tests_required` | Minimum test gate suggestion; module-specific acceptance details in Gap Register |

### Source-reference alias conventions

| Alias | Path prefix |
|---|---|
| `account`, `bankPayment`, `base`, `budget`, `cash` | `axelor-account`, `axelor-bank-payment`, `axelor-base`, `axelor-budget`, `axelor-cash-management` |
| `clientPortal`, `contract`, `crm`, `fleet`, `gdpr`, `helpdesk`, `hr` | matching `axelor-*` directory, except `hr` = `axelor-human-resource` |
| `intervention`, `maintenance`, `marketing`, `mobile`, `production`, `project`, `purchase` | matching `axelor-*`, except `mobile` = `axelor-mobile-settings` |
| `quality`, `sale`, `stock`, `supplierMgmt`, `supplierPortal`, `supplychain`, `talent` | matching `axelor-*` |
| `studio` | Pinned [axelor-studio 4.0.7](platform-source-ledger/axelor-studio-4_0_7.csv), including MetaJsonModel/Field, StudioApp, WkfProcess, WkfDmnModel |
| `utils` | Pinned [axelor-utils 4.0.2](platform-source-ledger/axelor-utils-4_0_2.csv), including ConflictChecker/HttpExceptionHandlerImpl |
| `AOP` | Axelor Open Platform 8.2.5 runtime artifacts; **exact version-specific public source Git tree not resolved**; confirm against binary/source JAR, not the moving master branch |
| `ioeti` | Existing local code or an architecture placeholder; inspect IOETI_REPO_FILE_LEDGER.csv and code for precise grounding |
| `none` | No native module; out of scope or new domain |

**Reference existence check:** all **468 individual `axelor-*` symbol occurrences** across the 377 capabilities for aliases inside the 26 AOS modules resolved to a matching `.xml` or `.java` file by exact basename in the saved raw ledgers (0 unresolved). This verifies **source symbol existence only**, not implementation of the claimed business semantics. AOP/IOETI placeholders were intentionally excluded from this filename check; Studio refs were newly reclassified after indexing pinned Studio 4.0.7. Names frequently refer to native INTERNAL processes which require explicit adaptation.

## Critical distinctions that prevent false reuse

1. `axelor-quality` is mostly an **internal organization Quality Improvement** system; ISO certification of external clients requires a *new independent decision/cycle/certificate* domain.
2. `axelor-talent:TrainingRegister` concerns **employee training**, not external paying trainees. A new separate Trainee/Cohort/Registration/Assessment/Certificate context is essential.
3. `axelor-talent:JobPosition` and `JobApplication` primarily handle internal recruitment, not **agency recruitment on behalf of client Accounts**.
4. `axelor-crm:Opportunity` and a FUNDRAISING business line are **not a donor, grant, pledge or restricted-fund ledger**.
5. `OpportunityStatus` is globally shared: stage codes alone do not supply per-business-line pipeline version, gates, SLA, approvals and transition integrity.
6. Native `MetaPermission` field rules **reportedly failed to redact generic REST output**. Data sensitivity requires structural isolation, app DTO allowlists and negative tests, not visual hiding.
7. The upstream thread-bound user concern may cross sessions under load. Tests of one filter are not sufficient proof.
8. Current Vercel preview intentionally uses **fictional memory-only fixtures**, never proves backend workflows. UI implementation != integrated verification.
9. AOS `axelor-client-portal` contains some public repo models; that is not confirmation that every desired IOETI portal capability is provided, free, complete or secure.

## State of code at this snapshot

| IOETI capability | Code evidence | Runtime acceptance |
|---|---|---|
| Business Line registry, 5 seeds, custom model and Opportunity extension | `modules/ioeti-business-lines/domains`, repositories, services, `/ws/ioeti/business-lines`, UI list/details | Earlier dev smoke; multi-role production-quality test **not passed** |
| Minimal Opportunity DTO list/get/create/rename | `OpportunityRestController.java`, custom page with create/rename | Live create/read/rename previously succeeded; stale-version expected 409 returned 500 **in this branch's base snapshot**; **Claude PR #6 fixes it independently, passing latest backend CI** |
| Read-only Lead list/detail | `LeadRestController.java`, `DirectoryPage.tsx` | UI contract tests use mocked responses; negative real role integration incomplete |
| Read-only external customer/prospect Partner list/detail | `AccountRestController.java`, `RecordWorkspace.tsx` | UI contract tests; relationship 360 not built |
| Session identity | `SessionRestController.java` | Session hardening/logout/CSRF tests missing |
| Three themes and Arabic/English | `apps/ioeti-web` | Frontend CI and demo, not comprehensive accessibility/mobile real-device acceptance |
| Real commercial, ISO, training, recruitment and fundraising domain | Mostly only upstream reusable primitives | NOT IMPLEMENTED/NOT VERIFIED |

The **current Claude concurrency branch is not merged into this snapshot**. Refresh these states when integrating another agent's changes; don't overwrite its work.

## Design policy (DO NOT REPLACE NAV)

**Keep the existing sidebar/global module switching.** The user was specifically asking for record-level flow: `View Details` → **full-width deep-linkable record workspace** within the same shell. Use centered modal for small bounded edits, popover for quick choice, inline for safe fields, full wizard/page for high-stakes multi-step operations. Do not render a complete Account/Opportunity/ISO cycle in a side drawer. See `docs/design/RECORD_INTERACTION_RULES.md`.

## Canonical production verification chain

`Requirement → Source model → Confirmed service behavior → Authorized IOETI API → UI full flow → Transaction/integration tests → Negative role tests → Staging/UAT → Release gate`.

Passing only the first two arrows MUST NOT be marked green end-to-end.

## What a second agent should do next with this material

1. Read all four capability CSV files and [Gap Register](GAP_REGISTER.md).
2. Merge/cherry-pick documentation only after reconciling branch base and latest source changes; this branch is strictly an **analysis sibling** of code work.
3. Choose a P0/P1 vertical slice; for every item, add actual source file/method evidence, permission decisions and acceptance tests.
4. Promote `SOURCE_CONFIRMED` → `SERVICE_VERIFIED` → `API_TESTED` → `UI_TESTED` → `PROD_CANDIDATE` *individually*. Never globally mark a module done.
5. Obtain missing spec/owner decisions below before encoding business policy into irreversible workflows.

## Missing owner inputs / cannot responsibly infer

- Full requirements chapters beyond §§1–9, referenced open questions and JSON workflow map were never provided.
- ISO accreditation and impartiality scheme procedures, independent reviewer membership, audit-day formulas, NC closure decision authority.
- Training certification eligibility, trainee data retention, taxes, trainer pay and examination policy.
- Recruitment fee basis and guarantee replacement obligations; client permissions for candidate information.
- Donation/grant restrictions, legal receipts, accounting treatment and donor access rules.
- Accounting depth, ETA e-invoicing obligations, invoices vs invoice requests, payment integration, taxation, deployment domain/RPO/RTO, retention/consent policies.
- Final P1/P2 scope and release sign-off by IOETI business owners.

Never invent any of those facts as if signed off.
