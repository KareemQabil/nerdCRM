# UX-3: registers (one table for the platform's lists)

Status: implemented. The mocked suite passes (118 tests) and the demo suite passes (27); the type check is clean. Leads,
accounts and opportunities were checked in a real browser against the live backend, desktop and phone, light and dark.

## `DataTable` (`src/DataTable.tsx`)

- **Sorting:** a column with a sort value sorts the rows on screen, ascending then descending.
  - The header carries `aria-sort`.
  - Blanks go last in both directions.
  - Text sorts with an Arabic and English collator that orders numbers naturally.
- **Density:** comfortable or compact.
- **Shown columns:** optional columns can be hidden from the column menu.
- **Per-list memory:** sort, density and hidden columns are kept per list in this browser (`ioeti.table.<list>.v1`). In a
  private window the list still works; the view is just not kept.
- **Opening a row:**
  - A click anywhere on a row opens the record.
  - A click on the row's own link or button does what that control says.
  - By keyboard, the row's link opens it. No custom key handling is needed, and focus returns to that link.
- **Figures:** numeric columns are written left to right, aligned at the end, with tabular numbers.

## Lists moved onto it

| List | Columns |
|---|---|
| Opportunities | name, business line, stage (in the reader's language, coloured by kind), expected value, probability, expected close, reference, actions |
| Leads | name with organisation, stage, business line, received, actions |
| Accounts | name, reference, client or prospect, actions |

- **New columns:** the expected value, probability and close date were already in the list API and are now shown.
- **No estimate:** value and probability read "—", not "0", as on the record.
- **Stage names:** the opportunity list showed the stage's stored English name ("New"). It now uses the same labels as the
  record ("جديد").
- **Old card styles:** the card style of `.directory-item` no longer applies to table rows. Lists still built from cards
  (operations, recruitment, fundraising, certification, training) are unchanged.

## Tests

New: the opportunity register test covers:
- the figure format and the stage chip;
- sorting by value, ascending and descending, with the blank last;
- compact density and a hidden column kept after a reload;
- a click on a row opening the record.

The existing directory and opportunity tests pass unchanged.

## Not here

- Bulk actions: none until the server has a permission-checked bulk endpoint.
- Saved filter sets for leads: they already exist (D-12 lead filters).
- Sorting on the server: the lists sort the page on screen, and "load more" adds to it.
