# X1a: an easier app shell

Status: implemented.

This slice comes from the owner's request for a much easier, more powerful UX, and from the screen audit of 2026-10-27.

| Check | Result |
|---|---|
| `scripts/daily_work_probe.py`, with the new session-pages check | 45/45 |
| `tests/shell.spec.ts` (new) | 5/5 |
| Full mocked + demo suites | 149 + 27; typecheck OK |
| PII DTO audit | 0 problems |

## What changed

- **The menu shows only what opens.**
  - `GET /ws/ioeti/session` now also returns `pages`: the pages whose main records the person may read natively. Examples:
    leads (Lead), accounts (Partner), certification (CertificationCycle), finance (InvoiceRequest or SaleOrder).
  - The side menu, the breadcrumb, Ctrl+K and "+ New" offer only those pages.
  - The design playground and the system map are for administrators.
  - This is a convenience only: every endpoint still checks access. With an older server that does not send `pages`,
    the menu stays as it was.
- **"+ New" from anywhere.** The top-bar button, or the **N** key, opens a menu with: new lead, opportunity, account,
  calendar item, field visit.
  - Each item has a one-letter key: L, O, A, C, V.
  - It opens that page's own create form. Nothing is created until the form is saved.
- **An ended session goes back to sign-in.** Any request answered `401` now returns to the sign-in screen with "your
  session ended", instead of leaving error banners while the header still says "connected".
- **Notices are plain language.**
  - A success notice shows no technical code. "SAVED · HTTP 200" is gone.
  - A failure keeps a short support reference, the error code, and no HTTP status.
  - The duplicated "connection unavailable; connection unavailable" banner text is fixed.
- **Arabic everywhere it was missing.**
  - A lead's stage is shown translated in its record.
  - The leads list names the business line (أيزو 9001), not its code.
  - Record reference chips no longer use a monospace font, which broke Arabic letter joining.
