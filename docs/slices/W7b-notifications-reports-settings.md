# Wave 7b: in-app notifications, the held outbox, reports and settings (`ioeti-automation`, `ioeti-reports`)

Status: LIVE_INTEGRATION_PASS on Axelor 9.1.10 + PostgreSQL 16 (`scripts/insights_probe.py`, plus inbox checks in `scripts/operations_probe.py` and `scripts/workspace_probe.py`, all in backend CI), with mocked browser contracts for the UI. Roles are fixtures; production roles are D-07.

**Nothing in this slice sends anything outside the CRM** (outbound channels are **D-10**). Nothing reminds or escalates on a timer (**D-12**).

## 1. In-app notifications

`com.ioeti.core.notify.Notifier` is a small interface in `ioeti-core`:
- By default it does nothing (Guice `OptionalBinder`).
- `ioeti-automation` replaces it with a stored inbox (`InboxNotice`, table `ioeti_auto_notification`).

Workflow modules call it inside their own transaction, so a refused or rolled-back step leaves no notice behind. A notice to oneself, to nobody or to a blocked user is dropped.

| Notice | When | To | Links to |
|---|---|---|---|
| `REVIEW_CHANGES_REQUESTED` | A reviewer sends a quotation or contract back | The requester | The opportunity |
| `HANDOVER_REWORK` / `HANDOVER_REJECTED` / `HANDOVER_ACCEPTED` | The operations reviewer decides | The requester | The handover |
| `ENGAGEMENT_ASSIGNED` | A handover is accepted | The operations lead (when someone else accepted) | The engagement |
| `MENTION` | A colleague points to a record | The chosen colleague | The record |

**Opening a notice applies the reader's own permissions.** A notice never grants access; the probe checks that the mentioned lead still answers 404 to a colleague who cannot read it.

Endpoints:
- `GET /ws/ioeti/automation/inbox[?unread=true]` and `GET …/inbox/count`: only the caller's own notices.
- `POST …/inbox/{id}/read`: the caller's own notice only; anyone else's → 404.
- `POST …/inbox/read-all`.

**Mentions:** `POST /ws/ioeti/automation/mentions {recipientId, subject, subjectId, message}`.
- The sender must be able to read the record (same subjects as documents: lead, opportunity, account, quotation, contract, engagement); otherwise 404.
- The recipient must be an active colleague and not the sender (422).
- At most 280 characters.

`GET …/people?q=` returns active colleagues by name, needs at least 2 characters, and gives only id and name.

## 2. The held outbox

`OutboundMessage` (table `ioeti_auto_outbound`) is a message to a lead that is drafted but never sent.
- **Drafting** needs write access to the lead, the e-mail channel (the only channel), an e-mail address on the lead (otherwise 422 `NO_ADDRESS`), and no opt-out (otherwise 422 `OPTED_OUT`, from the native flag set by Wave 6 consent).
- **Sending** checks the opt-out **again** (a lead may opt out after the draft was written), then answers **422 `BLOCKED_BY_POLICY` (D-10)**. The probe checks that the native `message_message` table does not grow. The UI shows the send button disabled, with the policy note.
- **Cancel** works once (then 422 `MESSAGE_STATE`); a stale version → 409; another salesperson → 404.

## 3. Reports from authorized queries

`ScopedAggregates` builds every aggregate query as `SELECT … FROM <Entity> self … WHERE <native read filter for this user> AND <report condition> GROUP BY …`. Counts and sums therefore only ever cover records the caller could list. Archived records are excluded.

`GET /ws/ioeti/reports/sales?from=&to=&businessLine=`:
- **pipeline:** opportunities by business line and stage, with the count and the **expected value per currency**. Currencies are never added together, and these are salespeople's estimates, not revenue.
- **lead funnel:** total, open, converted and lost, by source. The stage kind comes from the native lead lifecycle configuration.
- **campaigns:** readable campaigns with the number of readable leads attributed to each.
- **follow-ups:** the caller's own lead follow-ups: planned, overdue, and done in the last 30 days.

`GET /ws/ioeti/reports/areas?from=&to=` counts readable records per area: training enrolments, certification cycles, job orders, candidate applications, placements, handovers, engagements and funding opportunities.

**An area the caller has no read right on is left out (`null` or absent), never shown as 0.** Dates filter on the creation date. End before start, more than five years, or a bad date → 422.

`GET /ws/ioeti/reports/system` (administrators only, otherwise 403) lists the installed IOETI modules, the applied schema migrations (from `ioeti_schema_migration`) and the 12 policy decisions with their status. The decision list is a resource that `scripts/policy_registry_check.py` keeps equal to `docs/decisions/OPEN_IOETI_POLICY_DECISIONS.md` (CI fails if they differ).

Knowledge articles are not counted: their visibility per business line cannot be expressed in the native read filter, so a count could include articles the caller cannot see.

## 4. UI (live mode)

- **Notifications** in the navigation, with an unread badge. The count refreshes on sign-in, on navigation and every 60 s; that is an internal read, not a reminder. The page has an unread filter, open (link to the record), mark read and mark all read.
- **Lead page:** an outbox panel (draft, cancel, a disabled send with the D-10 note) and a mention form. Account and opportunity pages have the mention form.
- **Reports page:** date range and business line filters; pipeline, lead funnel with the conversion share computed from the returned counts, campaigns, follow-ups and areas.
  - Sections the caller may not read do not appear.
  - **CSV export** includes a BOM for Arabic, and text that a spreadsheet would run as a formula (`= + - @`, tab, carriage return) is prefixed with an apostrophe.
- **Settings page** (previously disabled in live mode):
  - language and theme;
  - lead sources (adding one needs create on the native `Source`: `POST /ws/ioeti/marketing/sources`);
  - for administrators, the system status: modules, migrations and policy decisions.
- The fictional preview is unchanged. Its own Settings area stays the demo admin workspace.

## 5. Not done

| Item | Why |
|---|---|
| Sending e-mail, SMS or WhatsApp; delivery tracking | D-10 |
| Reminders, response-time alerts and escalations sent by the system | D-12 |
| Notifying reviewers when a review is requested (who reviews what) | D-11 / D-07 |
| Revenue, margin, collections and finance KPIs | D-06; the fundraising page keeps pledged, scheduled and collected money apart in its own overview |
| Role and permission administration from the IOETI UI | D-07; done in Axelor administration |
| Scheduled report e-mails | D-10 |
