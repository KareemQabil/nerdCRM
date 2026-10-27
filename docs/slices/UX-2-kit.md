# UX-2: one money format, shared page header and error banner, calmer surfaces

Status: implemented. The mocked suite passes (117 tests) and the demo suite passes (27); the type check is clean. Home, finance,
the opportunity record and training were checked in a real browser against the live backend, desktop and phone, light and dark.

## One way to show money

Every real-mode screen now uses `src/format.ts`. The local formatters it replaced:

| Screen | Before | Now |
|---|---|---|
| Finance, invoices | Arabic-Indic digits in Arabic, no fixed decimals (`٣٤٬٥٠٠ EGP`) | `34,500.00 EGP` |
| Catalogue, opportunity estimate | same | `amount()` |
| Home pipeline | whole numbers, Arabic-Indic digits | `amount(…, true)`: `34,500 EGP` |
| Exchange rates | Arabic-Indic digits | `rate()`: `48.5` |
| Fundraising, reports, workflow, milestones | their own copy of the en-US format | `amount()` |
| Finance, invoices, exchange-rate dates | three copies of the same day format | `day()` |

Amounts use Latin digits, thousands separators and two decimals, as accounting documents and e-invoices do. Tables align
figures with tabular numbers. Demo-mode screens keep their own whole-number display: fictional data, separate tests.

## Shared components (`src/ui.tsx`)

- **`PageHeader`:** the area, the title, one line on what the screen is for, and its actions. 18 screens moved onto it:
  - admin, agenda, campaigns, catalogue, certification, directory (leads and accounts), finance, fundraising, home;
  - operations, opportunities, policies, quality, recruitment, system map, training, visits.
  - Five of them carried a large icon that the stylesheet already hid; that dead markup is gone.
- **`ErrorBanner`:** a failed load or refused change, announced to screen readers, with an optional retry. 14 banners moved
  onto it. The opportunity list uses its retry.

The kit renders the classes the stylesheet already defines, so a screen moved onto it looks the same.

## Errors in the reader's language

- The opportunity list and the leads and accounts directory showed the server's English message ("Request failed", "Record
  was changed elsewhere"). They now go through `problem()`, like the rest of the platform.
- The new test for the retry banner found this.

## Surfaces

- Tighter radii: cards 14 px, headers 18 px.
- The record header is flat, without the gradient.
- Figures use tabular numbers.
- One focus ring everywhere.
- The home tiles fit one row at desktop width (five tiles at 1440 px), and their arrow sits clear of a two-line label.

## Tests

- **Updated:** the finance figures now expect the single format (`30,000.00 EGP`, `0.00 EGP`, `48.5 EGP`). They accepted
  either digit system before and now require the one shown.
- **New:** a failed opportunity list shows the Arabic message, its retry loads the list, and the banner goes away.

## Next

UX-3 brings one `DataTable` for the registers, with sorting, density, row open and saved filters. It also brings the list parts
of the kit: `Toolbar`, `EmptyState` and `StatusChip`.
