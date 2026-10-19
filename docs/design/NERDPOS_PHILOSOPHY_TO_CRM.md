# NerdPOS visual philosophy → IOETI CRM design language

Source: user-provided **DESIGN_SYSTEM.md** and **nerdPOS-Hierarchy.md** (NerdPOS).

This is a domain adaptation of the supplied source documents, not a rewrite of their principles. UI brand is IOETI; visual system concepts are carried across. The source documents disagree on a few secondary swatches (e.g. dark background), so DESIGN_SYSTEM.md is canonical for theme values; hierarchy guidance is canonical for attention/layout.

## Non-negotiable principles from NerdPOS

1. **Glassmorphism-first, not glassmorphism-everywhere.** Translucent surfaces, subtle depth, clear borders, selective blur. Keep tables and lengthy forms readable and efficient.
2. **Theme-agnostic tokens.** Light, Dark and Luxury are separate palettes using the same semantic component tokens, not three separate UI implementations.
3. **Arabic-first.** RTL is native. Use CSS logical properties and explicit LTR only for numbers/codes; English flips the entire experience cleanly.
4. **Performance.** Animate transform/opacity, avoid paint-heavy blurs on repeated table rows; reduce motion when the OS requests it.
5. **Accessibility.** Visible keyboard focus, semantic elements, legible surface contrast; verify WCAG AA with actual screenshot/audit tests rather than claiming compliance by inspection.
6. **Feature-first hierarchy.** Most important actions get strongest visual weight; less relevant controls show progressively.

## Five levels of attention — applied to CRM

| NerdPOS hierarchy | IOETI application |
|---|---|
| 1. Primary actions | Qualify lead, approve quotation, issue certificate after checks, save form |
| 2. Secondary actions | Search, assign owner, filter records, schedule follow-up |
| 3. Tertiary actions | Edit metadata, archive, additional actions / menus |
| 4. Informational | Stage, owner, timestamp, SLA due time, contact/channel |
| 5. Decorative | Background glow, blur, separators; never compete with user tasks |

Do NOT apply the original POS 56px checkout sizing to every CRM action. High-density enterprise tables need contextual rhythm.

## Atomic design hierarchy

- **Atoms:** Button, Field, StatusPill, IconButton, typography, tokens, indicators.
- **Molecules:** SearchField, RoleSelector, DateRange, TableRowAction, ApprovalStatus.
- **Organisms:** Sidebar, AppHeader, DataTable, RecordDrawer, PipelineBoard, QuoteSummary.
- **Templates:** Dashboard, SearchableList, MasterDetail, Transaction/Approval, Planner/Calendar.
- **Pages:** Lead Queue, Opportunity Pipeline, Account 360, Quote Approval, ISO Audits, Training Cohorts.

Initial implementation includes atoms (Button, StatusPill, IconButton) and organisms (App Shell, BusinessLine List, Drawer); subsequent modules add components only once their secure APIs exist.

## CRM information architecture

```text
Authentication
└── Protected IOETI Workspace
    ├── Overview (role-personalized later)
    ├── Marketing & Leads
    ├── Sales & Opportunities
    ├── Accounts / Account 360
    ├── Proposals & Contracts
    ├── Execution
    │   ├── ISO Certification
    │   ├── Training
    │   └── Recruitment
    ├── Fundraising
    ├── Reports
    └── Administration
        ├── Business Lines
        ├── Pipelines / Stage Gates
        ├── Teams / Permissions
        ├── Catalog / Pricing Rules
        └── Workflow / Templates
```

Unimplemented navigation must remain DISABLED rather than presenting fabricated records or fake KPIs.

## Theme DNA copied from the source

| Theme | Background | Accent | Expression |
|---|---|---|---|
| Light | #f8fafc | #0891b2 | Bright, calm translucent whites |
| Dark | #020617 | #22d3ee | Deep navy, cyan highlights |
| Luxury | #000000 / near black | #f59e0b | Restrained amber/gold on dark |

The original source specifies Almarai for Arabic and Inter for English, with a separate LTR number style. Component tokens for typography, spacing (4px base), radii, glass opacity, interaction feedback and semantic states are implemented in apps/ioeti-web/src/styles.css.

Theme preference is stored locally under ioeti.ui.preferences.v1; **only presentation preferences**, never credentials, API tokens or private business data.

Beyond hue, the first release changes:
- Semantic tokens (surfaces, outlines, text, states).
- Density: comfortable / compact.
- Navigation: expanded / rail.
- Language and writing direction: Arabic / English.

Future visual families may change composition, typography and navigation grammar, but must preserve stable accessible primitives and domain behavior.

## Patterns transferred thoughtfully

- NerdPOS **Master–Detail** → Account 360 and record-side drawer.
- NerdPOS **Dashboard Grid** → role-specific KPI and task overview.
- NerdPOS **Kanban** → opportunity pipelines, case boards.
- NerdPOS **Wizard/Stepper** → quote approval and certificate decision.
- NerdPOS **Transactional Sticky Action Bar** → guarded quote/contract actions on relevant screens, not global sticky distractions.
- NerdPOS **Contextual Navigation** → dynamic sidebars based on role and business line.
- NerdPOS **Feedback confidence** → loading, disabled, error, empty, success, pending approval states.

## Motion and usability rules

- Microinteractions 100–200ms, state changes 150–300ms; layered animations only where they aid comprehension.
- Reduce glass blur on large virtualized tables, mobile and low-powered devices.
- Never make status recognizable through color alone.
- Menus, modals and drawers need keyboard access, Esc dismissal and robust focus management.
- Numeric and record codes retain LTR direction without reversing the full Arabic page.
- Mobile must be tested in real touch browsers, not just desktop responsive resizing.

## Implementation status (first custom UI PR)

Implemented: React application shell, Light/Dark/Luxury, density and nav variants, RTL/LTR, custom login tied to Axelor callback, Business Lines read-only endpoint, live searchable list, status filters, record drawer, design-lab theme preview, responsive styling.

Not implemented: complete session logout, all role-based permissions, user profile endpoint, secure opportunity API, full CRM operations, standalone custom administration beyond the design foundation, mobile gesture testing, verified WCAG audit.

Do not call this UI production-ready.
