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

## Complete fictional operating-demo architecture (separate from real mode)

Set `VITE_IOETI_DEMO=true` to open an interactive, browser-memory-only operating preview.
All existing global Sidebar sections remain in the same positions; ISO, Training,
Recruitment and Fundraising become clickable **only in demo mode**. The existing
System Map opens sixteen domain workspaces:

- Quotes, Service catalog, Contracts, Finance, Projects, Field visits,
  Quality/CAPA, Marketing, External Training, Agency Recruitment, ISO Certification,
  Fundraising/Grants.

The lazily used `demoBusiness.ts` fixture defines **48 explicitly fictional, linked scenario records**
and separate in-memory actions. `DemoBusinessWorkspace` provides searchable lists,
stage filters, deep-linkable full record pages, workflow timelines, notes, decision
simulation with confirmation and narrative, record creation, and cross-domain links.
Examples include Quote → Contract → Project → Visit/ISO or Corporate Training.
The UI is Arabic-first and supports the same English mode and Light/Dark/Luxury
tokens. **No actions produce a real invoice, signature, certificate, payment,
candidate share, email or backend write.**

The real production build only invokes these demo screens behind `DEMO_MODE`
and does not enable the four not-yet-secured specialized sidebar sections.
A lazily-loaded React chunk isolates the sample workspace from the initial
authenticated application's execution path. Do not place real data in demo fixtures.

Run `npm test` for mocked API-contract tests in non-demo mode and
`npm run test:demo` for browser-only fictional workflow E2E coverage. CI runs both.
Demo business-stage logic is an **interaction contract**, not certified ISO,
accounting, legal, privacy or recruitment policy. Backend API and authorization
integration remains separate work for Claude.

### Expanded platform-control demo
The same in-memory-only experience also covers Documents/Knowledge,
Automations/Approvals, Analytics/Reporting, and Administration/Business-line
configuration. These four areas are reachable through the System Map's
platform shortcuts without introducing a new sidebar category. The existing
Settings sidebar item is enabled only in demo mode, opening the fictional
Administration workspace. None of the workflows change server security,
schedule jobs, publish templates or export customer data.

**Bundle boundary:** `demoAreas.ts` contains only constant module IDs. `App.tsx` and `NativeModules.tsx` do not statically import the 48-row operating fixture; the scenario data and all interactive operating workspaces are loaded only from the demo route. The existing minimal Lead/Account/Opportunity preview fixtures live separately in `demo.ts` and remain unavailable to real APIs when demo mode is disabled. A production release should additionally verify the built asset inventory, not rely solely on source imports.

### Pipeline board and keyboard navigation (fictional preview)

Each operating demo register includes a theme-aware **List / Pipeline board** switch with stage grouping and shared search. Click a card to open the complete record workspace. Stages are *not* draggable and do not make backend writes; any transition remains a clearly labeled, confirmed in-memory simulation. Press `/` while on the register to focus search. Record detail tabs support Home/End and RTL-aware arrow keys. The Back-to-register control stays within the current module when arriving from a cross-domain relation.

Production connectors must add authorized, versioned stage-command DTOs and negative-permission checks before enabling equivalent functionality for live customer data. `npm run test:demo` covers these interactions; it does not replace backend security validation.
