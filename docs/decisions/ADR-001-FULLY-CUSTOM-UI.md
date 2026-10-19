# ADR-001 — Fully Custom IOETI UX above Axelor

Status: **Accepted** · 2026-10-19 · supersedes the native-UI-first decision in docs/ARCHITECTURE.md.

## Decision

All customer-facing and employee-facing IOETI screens — including normal business administration — are designed in a dedicated React/TypeScript frontend. Axelor Open Suite remains the domain engine and source of truth, not the user-facing product design.

- Frontend: apps/ioeti-web (now a Vite/React pilot; future build decisions must be justified).
- Backend: Axelor + modules/ioeti-*.
- Data: PostgreSQL through Axelor services only.
- API: explicit authenticated, authorized IOETI DTO endpoints and business commands.
- Axelor native UI: isolated developer/maintenance tool, NOT a product dependency.
- No rewriting pricing, CRM, contracts, invoices, field-service or BPM semantics in browser code.

This decision applies to Sales, Marketing, Accounts, ISO, Training, Recruitment, Fundraising, Operations, Analytics AND Admin.

## Why

1. A bespoke Arabic-first UX can reflect role, context and frequency of tasks rather than Axelor's generic modules.
2. Axelor upstream remains unmodified and upgradeable.
3. The visual language can change independently from workflows and domain rules.
4. The user-provided NerdPOS DESIGN_SYSTEM.md and nerdPOS-Hierarchy.md define the interaction/design philosophy, adapted to CRM tasks (docs/design/NERDPOS_PHILOSOPHY_TO_CRM.md).

## Important distinction

**Fully custom UI does not mean rebuilding all of Axelor Studio/BPM in the first release.** Only the IOETI-admin workflows needed by a business user must get custom, guarded admin experiences. Generic infrastructure maintenance can continue in an isolated native admin.

## Security preconditions

The original repo reports a thread-context authorization bug and generic REST field-read leakage. These require independent review and remediation. The UI must never expose Axelor's generic REST directly to ordinary users or provide an illusion of security based on hidden controls.

This first UI PR consumes ONLY the existing explicit, read-only /ws/ioeti/business-lines DTO endpoint. No lead/opportunity generic REST calls, no business mutations, no fake client data.

Do not deploy the UI or Axelor to production until the upstream/context vulnerability, safe logout, CSRF/session lifecycle, user permissions, API boundary and deployment model are resolved and tested.

## Consequences

- Maintain an app-specific design system rather than styling Axelor's DOM.
- Develop end-to-end vertical slices (backend permission/DTO, UI, Arabic, tests) one workflow at a time.
- Prioritize accessible, responsive interactions; visual redesigns must not affect business rules.
- Document theme contrast, reduced motion and user-defined density/navigation preferences.
