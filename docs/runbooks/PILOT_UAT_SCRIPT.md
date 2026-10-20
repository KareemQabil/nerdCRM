# Pilot UAT script (G-010): internal, test data only

Purpose: a reviewer at IOETI walks the live chain on an **isolated test database** with fictional records, as several users, and signs the result. It does not replace automated evidence (CI probes) and it is not a go-live. Go-live, real customer data and the V1 scope remain decision D-09.

## 0. Prepare (engineer)

```bash
scripts/ioeti.sh db-up && scripts/ioeti.sh run          # loopback only
scripts/ioeti.sh install-apps                            # once per fresh database
python3 scripts/pilot_readiness.py setup                 # fictional users, roles and data
python3 scripts/pilot_readiness.py check                 # read-only: each pilot user sees what this script expects
cd apps/ioeti-web && npm run dev                         # http://127.0.0.1:5173
```

`pilot_readiness.py setup`:
- creates the users `pilot.repa`, `pilot.repb`, `pilot.viewer` and `pilot.outsider`;
- creates their test-only groups and permissions (own records for reps, read-only for the viewer, nothing for the outsider);
- creates fictional leads, a catalog product and the company setup the quotation chain needs;
- writes the passwords to `.local/pilot-users.txt` (git-ignored, mode 600).

`pilot_readiness.py teardown` removes all of it. Every record name starts with `PILOT-TEST`.

## 1. Script (reviewer)

Run each step in **Arabic (RTL)** and repeat the marked steps in **English** and on a **phone-width** window.

| # | User | Steps | Expected |
|---|---|---|---|
| 1 | outsider | sign in, open Leads, Opportunities | sign-in works; every list says you have no permission; no data shown |
| 2 | repa | Leads → open `PILOT-TEST Lead A` | lead page shows stage, received time, "not assigned to you" if unassigned |
| 3 | repa | assign to me; move to the next stage | owner changes to you; stage changes; refresh keeps both |
| 4 | repb | open the same lead by URL | "not found" (the lead left repb's scope) |
| 5 | repa | mark `Lead B` lost with a reason and a note; reopen it | lost reason shows, note does **not** show anywhere; reopen returns it to the first stage |
| 6 | repa | convert `Lead A` (new account) | account and opportunity open from the lead; account page lists the opportunity and contact |
| 7 | repa | on the opportunity: new quotation, add the catalog product (qty 2) | total before tax = 2 × price; no tax amount; "approve & send" disabled with D-06/D-11 note |
| 8 | repa | add milestones 30 % and 70 %; try another 10 % | third one refused (above 100 %) |
| 9 | repa | create a billing contract, copy lines from the quotation | same lines and total; activate and handover disabled with policy note |
| 10 | viewer | open the opportunity, quotation and contract | can read; every change button refused with a permission message |
| 11 | repa + repa (two tabs) | rename the opportunity in both tabs | second save says the record changed elsewhere; nothing overwritten |
| 12 | repa | sign out; press back; reopen a tab | signed out everywhere; no data without signing in again |
| 13 | all | English and phone width for steps 2, 3, 6, 7 | same results; layout readable, no horizontal scroll |

## 2. Record

For each step write PASS, FAIL (with a screenshot and the time) or BLOCKED. A FAIL becomes a GitHub issue; never paste passwords, cookies or real customer data into it.

| Step | AR | EN | Mobile | Notes |
|---|---|---|---|---|
| 1–13 | | | | |

Sign-off (reviewer name, role, date):

The pilot gate G6 in `docs/PILOT_PLAN.md` is marked **done** only with this sign-off **and** green backend CI on the same commit.

## 3. Afterwards

`python3 scripts/pilot_readiness.py teardown`, then confirm `leftovers: none` in its output.
