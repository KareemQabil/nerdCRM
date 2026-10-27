# S8: the pipeline numbers agree, for every caller, in a company with history

Status: implemented and run against a real Axelor and PostgreSQL. The scenario is in backend CI.

| Scenario | Script | Result |
|---|---|---|
| S8 pipeline numbers | `scripts/scenario_pipeline_numbers_probe.py` | 9/9, cleanup complete |

The earlier scenarios started from an empty company. A company that has been selling for a while has hundreds of closed
opportunities and thousands of accounts. This scenario gives two business lines that history and checks four things for
each person: the board, the sales report, the list and the search all say the same thing as the records.

## The people and the records

Roles are test fixtures built from native permissions (D-07 defines the real ones). Every person and record is fictional
and is removed afterwards.

| Person | Scope |
|---|---|
| RepA, RepB | Their own opportunities. Both on line L1, and RepA also has two on L2 |
| RepC | Their own, on L2 |
| Line manager | Line scope, member of L1 |
| Head | All |

- **L1:**
  - 48 open opportunities across four stages, in EGP and USD; some have no close date;
  - 4 won and 3 lost recently;
  - 1,000 lost four months ago. Their dates are set by SQL, a test fixture standing in for history.
- **L2:** 12 open, plus RepA's 2.
- **Accounts:** 1,050 prospects, for the search check.

## What is checked

1. **The board** shows, for each person:
   - every open opportunity they may read;
   - the won and lost of the last 30 days;
   - none of the old history.

   The line and "mine" filters hold.
2. **Totals.** Every board column total, per currency, is exactly the sum of the records. The board's open stages equal the
   sales report's.
3. **The sales report** counts every stage per person and currency, history included. Lost on L1: RepA 1,000, RepB 3, the
   line manager 1,003.
4. **Drag race,** run 3 times. The owner and the line manager move the same card to different stages at the same moment.
   - One move goes through; the other gets `409`.
   - Board and report follow the winner exactly.
5. **A card marked lost** leaves its column and joins "lost" in both the board and the report, amount for amount.
6. **Scope changed mid-session.** The line manager is moved from L1 to L2. The next request shows L2 only, and an L1 card
   answers `404`.
7. **A card handed over** from RepA to RepB moves between their boards on the next request.
8. **The list** pages through every opportunity RepA may read, history included, once, with no gaps or repeats.
9. **Search** finds:
   - the oldest of 1,050 accounts, typed with another spelling (ه for ة, no hamza) and Arabic-Indic digits;
   - the oldest of the 1,000 opportunities.

   A person who may not read the opportunity does not find it.

## Two real bugs S8 found, and their fixes

### The board lost its open cards once the history grew

**What was wrong:** the board read the first 500 opportunities the caller may read, ordered by close date, and only then
dropped the old closed ones. Old closed opportunities have early close dates, so they filled the 500 first. With the
1,000 above:
- RepA's board showed **0 of 38** open opportunities;
- the line manager's showed 0 of 55;
- the column totals were wrong with no warning.

The line and "mine" filters were also applied after the 500.

**What changed:**
- The "open, or closed in the last 30 days" condition, the line and "mine" now run in the database query, with the
  caller's permission filter. The 500 cap applies only to cards that will be shown.
- When a board does reach 500 cards, it now says so. Its totals then cover the cards shown only, and it points to the
  sales report for full figures.

### Search could not find an older account or opportunity

**What was wrong:** global search (Ctrl/Cmd+K) read the newest 1,000 accounts and the newest 1,000 opportunities, then
matched names in memory. Any older client was never found, whatever was typed.

There was a second weakness behind the first: even after narrowing, reading only the first 1,000 can still miss the
match. A common word (here the digit 0) can match nearly every account.

**What changed:**
- The database first narrows to records where every typed word appears. It folds the name the same way the Arabic
  matching does (alef forms, ة/ه, ى/ي, hamza seats, diacritics, tatweel, Arabic-Indic digits), using `translate()`.
- The exact check then reads the narrowed records page by page, newest first, until it has 8 matches or the records run
  out (up to 20,000).
- Field visits are narrowed the same way, by reference or by the client's name. The exact check still shows a client's
  name only to someone who may read the client.
- Quality issues still read the newest 1,000. Their title comes from a related resolution line, and there are far fewer
  of them.
- `ArabicNormalizer.FOLD_FROM` and `FOLD_TO` sit next to the Java rules. A unit test keeps the two foldings equal, letter
  by letter.

Regression after the fixes: `daily_work_probe.py` 48/48, `cross_domain_probe.py` 9/9, `ArabicNormalizerTest` 5/5,
`tests/pipeline.spec.ts` 5/5.

## Run

```
python3 scripts/scenario_pipeline_numbers_probe.py
```

- `PROBE_PIPELINE_HISTORY` sets the number of old closed opportunities (default 1,000).
- `PROBE_SEARCH_ACCOUNTS` sets the number of accounts (default 1,050).
- `PROBE_SCENARIO_ROUNDS` sets how many times the drag race repeats (default 3).

The report is written to `logs/scenario-pipeline-numbers.json`.
