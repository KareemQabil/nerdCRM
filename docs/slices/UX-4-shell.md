# UX-4: shell (one page table, a breadcrumb that names the area, page jumps in Ctrl+K)

Status: implemented. The mocked suite passes (119 tests) and the demo suite passes (27); the type check is clean.

## One table of pages

The side menu already listed the pages a person can open, grouped by how they work and filtered by their rights:
administrators see the admin console, and policy owners see policies. Other places kept their own copies:

- **Breadcrumb:** a single expression about 2,000 characters long, with 27 nested branches and its own names. Some
  disagreed with the menu.
- **Command palette:** knew no pages at all.

Now the menu's groups produce one list of pages (`id`, name, area). The breadcrumb, the browser tab title and the palette all
read it.

## Breadcrumb and tab title

- **Breadcrumb:** "area / page", for example "التنفيذ والخدمات / الفواتير والتحصيل". It used to read "مساحة العمل / …" on every
  page.
- **Demo areas:** keep their own names, now in one table instead of two inline objects.
- **Tab title:** the browser tab and history name the page ("الفواتير والتحصيل · IOETI"), so tabs and screen-reader page
  announcements are distinguishable.

## Ctrl+K jumps to pages

- **Matching pages:** pages whose name or area matches come first (up to five, marked "صفحة"), then the records from the
  server search as before.
- **Arabic spelling:** the match ignores hamza forms, taa marbuta, alef maqsura and diacritics, so "الاشعارات" finds "الإشعارات".
- **Rights:** only pages in the person's menu are offered. The server still checks every page's data.

## Tests

- **New:**
  - "الاشعارات" finds the notifications page.
  - "الفواتير" puts the finance page first, and Enter opens it.
  - The breadcrumb shows its area, and the tab title names it.
- **Unchanged:** the existing palette tests pass with the same result counts.

## Not here

Moving from hash routing to path routing: deep links (`#/opportunities/101`) are shared and tested across the platform. Changing
them buys nothing the user sees and would break saved links.
