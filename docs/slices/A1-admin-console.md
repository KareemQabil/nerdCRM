# A1: administration from the platform (`ioeti-admin`)

Status: implemented and checked against the real backend:
- `scripts/admin_probe.py` 43/43 (in backend CI);
- JUnit `AdminRulesTest` 6/6;
- mocked browser tests `tests/admin.spec.ts` 4/4;
- a real-browser walk-through in the three themes, at desktop and 390 px.

Part of phase 1 of the journeys plan (journey 8: a new person starts, a person leaves).

## Why

The Administration area only showed things: business lines could be read but not added or changed, and there was no way to manage people, teams or access. Those tasks were left to the native Axelor screens, which ADR-001 rules out: every screen, administration included, is part of the IOETI app. There was also no API for any of it.

## What an administrator can do

| Area | Actions | API (`/ws/ioeti/admin`) |
|---|---|---|
| People | List (search, active or deactivated, by line); add with a temporary password; edit name, e-mail, language, profile, lines and teams; deactivate and activate; set a new temporary password; see what the profile allows; see the person's change log | `GET/POST /users` · `GET/POST /users/{id}` · `/deactivate` · `/activate` · `/password` |
| Access profiles | List each profile with how many people use it and its rules; read what a profile allows per record type | `GET /profiles` · `GET /profiles/{code}` |
| Teams | Add, rename, set members | `GET/POST /teams` · `POST /teams/{id}` |
| Business lines | Add (it starts in set-up); change names, status, order, purpose, responsible team, manager; set exactly who belongs | `GET/POST /business-lines` · `POST /business-lines/{code}` · `GET/POST /{code}/members` |
| Change log | Every administrative change, newest first, filtered by type or record | `GET /audit` |

`GET /ws/ioeti/session` now also returns `administrator`. It only decides whether the console is offered; every admin endpoint checks it again on the server.

## Rules

- **Administrators only.** Checked on every call: 401 without a session, 403 for anyone else (probe: every endpoint, both cases).
- **Temporary passwords.**
  - The browser generates a strong password (Web Crypto) that the administrator can change or copy.
  - The server checks length and variety and applies the native password policies.
  - It hashes the password with the native `AuthService` and sets `forcePasswordChange`.
  - At the next sign-in, Axelor answers with its change-password route instead of a session. The sign-in screen then asks for a new password and sends it with the native `newPassword` field.
  - A password is never returned and never written to the change log.
- **E-mail.** It is written but never returned: responses carry `contactOnFile` only. The G-007 gate classifies it RESTRICTED.
- **Deactivation.**
  - Sets the native `blocked` flag; the person's records stay.
  - Sign-in is refused.
  - An already open session is refused at its next call by the native security filter (403, then 401). The probe checks this.
- **Self-protection (422).** An administrator cannot deactivate their own account, remove their own administrator profile, or reset their own password from the console.
- **Conflicts.** Every change carries the record version; a stale version answers 409.
- **Change log.**
  - Each change records who, what, which record, the field names, and safe values (codes, languages, member sign-in names).
  - The e-mail and password values are never stored.
  - Migration V016/U016 (`ioeti_admin_audit`); `db_migrate.py verify` passes 8/8.

## Policy

Named roles and their action × scope × field matrix are **D-07** (open). The console assigns the profiles that exist (native groups) and shows what each allows; it does not author profiles. The screen says so.

Moving a departing person's records to someone else is reassignment, which is D-12 / D-07. It is not offered.

## Screens

The new **Admin console** item (`#/admin/…`) appears only for administrators, with five tabs:
- **People:** a list, a full person page, and dialogs to add, edit, deactivate and set a temporary password. After adding a person, a handover card shows the sign-in name and the temporary password.
- **Teams:** cards with members.
- **Business lines:** a table, with dialogs to add or edit a line and to choose its members.
- **Access profiles:** a list, and a table of the rights per record type, named by area.
- **Change log:** a timeline you can filter.

The person record is a full page; dialogs are only for bounded actions (docs/design/RECORD_INTERACTION_RULES.md).
