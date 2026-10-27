# UX-1: enterprise UI foundation (first step of the UI upgrade)

Status: implemented. The mocked suite passes (116 tests) and the demo suite passes (27); the type check is clean. The opportunity
record was checked in a real browser against the live backend with showcase data: desktop and phone, light and dark.

## Why

A real-browser audit visited 25 screens × desktop/phone × light/dark (100 views). It found no console errors, no horizontal
overflow and no screen over 4 s. The problems it did find are about reading and finding things:

| Finding | Where | Fixed here |
|---|---|---|
| Raw server decimals: `4500.0000000000 EGP` | quotation and contract line tables | yes |
| Raw status codes in Arabic: `CONFIRMED` | quotation card | yes |
| English connection errors in Arabic: `Backend is unreachable` | sign-in and start-up | yes |
| The opportunity record is a single 4,800 px scroll with no way to jump between sections | opportunity record | yes |
| Five record facts take a whole card; the permission note appears twice | opportunity record | yes |
| Each screen formats money its own way (8 copies; Arabic-Indic digits in some, Latin in others) | finance, catalog, home, … | the shared formatter starts here; the screens move to it in UX-2 |
| No shared components: 29 "-head", 23 "-row", 20 "-form" style variants | everywhere | UX-2 |
| Lists are rows with a repeated "details" link: no sorting, density, bulk actions or saved filters | leads, accounts, opportunities | UX-3 |
| Hand-written hash routing and a nested breadcrumb in `App.tsx` | shell | UX-4 |

(The sidebar that looked cut off in full-page screenshots is fixed-position, so it is not a defect: the capture only shows it
once.)

## What changed

- **`src/format.ts`**: `amount()` gives `3,000.00 EGP` (Latin digits, grouping, two decimals, as on accounting documents and as
  milestones, workflow and reports already show). `quantity()` drops trailing zeros (`14`, `1.5`). Quotation and contract tables,
  the tax row and the catalog picker use them.
- **Quotation status:** draft, finalized, confirmed, completed and canceled are shown in the reader's language.
- **Errors:** `problem()` now covers an unreachable server, an ended session and server errors (5xx) in both languages. Start-up
  and sign-in use it, so no English server message reaches an Arabic screen.
- **Opportunity record:**
  - The facts (business line, reference, record number, version, source) sit in the header as a compact strip.
  - A sticky section bar under the top bar holds: path and estimate, activities, quotations, contract, documents.
  - The bar marks the section in view, including the last ones, which cannot reach the top of the page.
  - It keeps the hash route, so a jump is not navigation, and it scrolls sideways on a phone.
  - Demo mode keeps its overview cards.

## Tests

- **Updated:** the quotation and contract totals now read `3,000.00 EGP`, and the confirmed quotation reads `مؤكد`. Same checks,
  new display.
- **New:**
  - The section bar lists the sections, jumps to the documents section, marks it, keeps the route and sits below the top bar.
  - With the server refusing connections, the sign-in screen says so in Arabic and the English message is absent.

## Upgrade plan (next PRs)

1. **UX-2, UI kit:** `PageHeader`, `Panel`, `StatusChip`, `EmptyState`, `KpiTile`, `Field`, `Toolbar`. Move every screen's money
   and dates to `format.ts`. Remove the duplicated CSS variants.
2. **UX-3, data lists:** one `DataTable` for leads, accounts, opportunities, invoices and the other registers, with:
   - sortable columns and a density toggle;
   - row click to open, keeping the keyboard path;
   - saved filters and column choice;
   - bulk actions only where the server already has a permission-checked endpoint.
3. **UX-4, shell:** a typed route table in place of the hand-written hash routing and nested breadcrumb, a collapsible sidebar
   with groups, and a command palette over the routes and records.
4. **UX-5, home and reports:** role-aware cockpit tiles and real charts from the reports API. Every figure comes from the
   server; nothing is invented in real mode.
5. **UX-6, checks:** accessibility (axe), contrast in the three themes, and a visual regression set for the main screens at
   phone and desktop width.
