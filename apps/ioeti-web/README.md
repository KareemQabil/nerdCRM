# IOETI custom web application

An independent React/TypeScript design foundation using the supplied NerdPOS design system and hierarchy philosophy, adapted for a real Axelor-backed CRM.

## Start locally

1. Start the existing Axelor stack using the repository's docs/DEVELOPMENT_GUIDE.md.
2. Make sure ioeti-core and ioeti-business-lines are installed and /ws/ioeti/business-lines works.
3. From the repo root:

```bash
cd apps/ioeti-web
npm install
npm run dev
```

Open http://127.0.0.1:5173. The dev server proxies /axelor-erp to http://127.0.0.1:8080. Override IOETI_AXELOR_ORIGIN for a different **local** Axelor origin. The dev server binds to loopback only.

Use a **development-only** account that has permission to read BusinessLine. The browser submits credentials to the same-origin proxied Axelor /callback and verifies the session with GET /ws/ioeti/business-lines. There are no hard-coded credentials, mock business records, browser-stored tokens or generic REST calls.

Scripts:
- npm run dev — start local UI.
- npm run typecheck — TypeScript validation.
- npm run build — typecheck and production asset build.
- npm run preview — preview assets locally (NOT a production deployment).

## First accessible vertical slice

- Real session-gated app shell.
- Arabic RTL / English LTR.
- Three NerdPOS-inspired themes: Light, Dark, Luxury.
- Density (compact/comfortable) and sidebar layout (rail/expanded).
- Overview counts based ONLY on the returned visible business lines.
- Business Lines list with search, filters and detail drawer.
- Design system lab for live theme and component inspection.

**Not implemented:** opportunities, client management, quote flow, ISO operations or admin writes. Their entries are disabled rather than faked.

**Security gates:** This UI is a development prototype only. There is no verified server-side logout workflow, no hardened auth/session gateway, no CSRF threat model, and upstream permission/context findings remain unresolved. The app must not be publicly exposed or deployed to production. Native Axelor stays maintenance-only in the intended architecture.

Fonts: Almarai and Inter via Google Fonts, with system fallbacks when offline. No proprietary font assets are committed.

## Design documents

- docs/decisions/ADR-001-FULLY-CUSTOM-UI.md
- docs/design/NERDPOS_PHILOSOPHY_TO_CRM.md

## Phase 2: first real CRM interaction

The frontend now has an Opportunities page backed by dedicated IOETI endpoints:
`GET /ws/ioeti/session`, `GET /ws/ioeti/opportunities`,
`GET /ws/ioeti/opportunities/{id}`, `POST /ws/ioeti/opportunities`,
and `PUT /ws/ioeti/opportunities/{id}`. Creation and rename use Axelor
OpportunityService; record visibility and writes use Axelor permissions.

Frontend tests use **mocked contract-shaped HTTP** to verify the UX; this is not
proof of backend integration. Run `scripts/ioeti.sh pilot-smoke` against a real,
isolated Axelor dev environment and execute the role/security gates described
in docs/PILOT_PLAN.md before calling the first real pilot accepted.

The custom UI is still NOT production-ready.

## Native module reverse mapping (incremental)

Read-only Lead Inbox and Account Directory have been added using the pinned native
Axelor Lead and Partner models. These surfaces use only explicit IOETI DTO endpoints,
not Axelor's unrestricted generic REST or direct JPA entities. They have no writes.

In Vercel demo mode the two directories use **fictional in-memory examples**.
Real mode uses authenticated Axelor endpoints. The "System map" page opens the
first connected UI surfaces, while other modules remain architectural previews.
See docs/UX_REVERSE_MAPPING.md.

Do not deploy the real backend publicly until its security gates are closed.

## Record navigation (corrected UX decision)

The **existing module Sidebar is unchanged**. Clicking Account, Lead or Business Line **View details** opens a full record workspace, not a slide-over. Contextual list→record flow supports record URL, browser Back/Forward, and return to list with current search. Small Opportunity create/rename operations use a centered modal. See `docs/design/RECORD_INTERACTION_RULES.md`.
