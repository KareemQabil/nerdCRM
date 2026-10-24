# A5: the live system map

Status: implemented; mocked browser tests 2/2 in live mode. The 3 schematic journey tests moved to the demo suite, where that view remains.

The capability map was a schematic. It said "not connected" for domains that have long been live, and it opened journeys that "send no requests". In live mode it is now the **system map**:

- **Status per domain.** Each of the 15 domains is live, partly live or being built, as shipped in this build.
- **What works now,** in a sentence or two.
- **What waits for a company decision,** with its number (D-02 … D-12) from `docs/decisions/OPEN_IOETI_POLICY_DECISIONS.md`.
- **What is coming next** for the parts still being built: field visits, general quality actions, campaign management, the finance invoicing queue, price lists.
- **A live access check** per domain.
  - One light read tells the person whether they can reach it ("You have access" / "Not in your permissions").
  - The "Open" button goes to the real screen, and is offered only when access is not refused.

The schematic map and its journeys stay in the fictional preview (demo build).

Keep the statuses in step with `docs/IMPLEMENTATION_LOG.md` when a domain changes.

## Found on the way

On a 390 px phone in English, the top bar overflowed by 5 px once the quick-search button joined it.
- The page name now gives way: it truncates, and on phones it drops the "Workspace" segment and the divider.
- The test asserts that the page never scrolls sideways.
