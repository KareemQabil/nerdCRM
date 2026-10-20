# Wave 6: lead intake, duplicates, consent, attribution, saved views and follow-ups (`ioeti-marketing`)

Status: LIVE_INTEGRATION_PASS on Axelor 9.1.10 + PostgreSQL 16 (`scripts/marketing_probe.py`, also in backend CI), with mocked browser contracts for the UI. Roles are fixtures; production roles are D-07.

Everything here is built on native CRM records: the lead (`Lead`), its source (`Source`), the marketing campaign (`Campaign.leadSet`) and the CRM event (`Event.eventLead`). Policy-dependent work stays fail-closed: automatic routing, response-time targets and escalation (**D-12**). **No endpoint sends a message.**

## 1. Arabic normalization and the search key

`com.ioeti.core.text.ArabicNormalizer` (in `ioeti-core`, so other modules can reuse it) applies these steps:
- removes diacritics and tatweel;
- unifies alef forms (أ إ آ ٱ → ا), teh marbuta (ة → ه), alef maksura and yeh with hamza (ى ئ → ي), and waw with hamza (ؤ → و);
- turns Arabic-Indic and Persian digits into Latin digits;
- lower-cases the text;
- collapses anything other than letters, digits, `@` and `+` into one space.

Phones are keyed by their last 9 digits, so `+20 100…` and `0100…` meet. E-mails are lower-cased.

`Lead.ioetiSearchKey` is an extension column (max 1000). An entity listener (`LeadSearchKeyListener`) keeps it up to date from these fields:
- first name, name and organization;
- e-mail;
- mobile and fixed phone.

V012 backfills the key of existing leads with SQL functions that mirror the normalizer. The probe checks that the SQL key equals the Java key for a lead with every variant.

Known limit: the listener runs when the lead itself changes. If only the linked e-mail address record is edited elsewhere, the key keeps the old e-mail until the lead is next saved.

## 2. Intake with duplicate review

| Endpoint | Notes |
|---|---|
| `POST /ws/ioeti/marketing/leads/duplicates` | Leads **the caller may read** that share the e-mail, the phone (≥ 7 digits) or the normalized name and organization (at most 10) |
| `POST /ws/ioeti/marketing/leads` | E-mail and phone format checked (422 on the field). Business line, source and campaign must be visible to the caller. With possible duplicates → **409 `POSSIBLE_DUPLICATE`** until `confirmNotDuplicate: true`. The caller becomes the owner; a chosen campaign is attributed. |

Only readable leads are compared, so the check never reveals that a lead exists outside the caller's scope. As a result, two salespeople with separate scopes can each record the same person; a manager with a wider scope sees both.

The check is advisory, not a uniqueness constraint: two intakes submitted at the same moment can both pass it. Merging duplicates is not built. It would change ownership and history, which needs D-07.

## 3. Server-side lists, filters and saved views

`GET /ws/ioeti/marketing/leads` returns only readable leads. It takes these parameters:
- `q`: normalized words, all of which must match the search key;
- `stageId`, `sourceId`, `businessLine` and `mine`;
- `limit` (1–100) and `offset` (≤ 10000).

The live lead list in the UI uses this endpoint, so search covers every lead the caller may read, not just the loaded page.

Saved views (`ioeti_mkt_saved_view`) belong to their owner. The name is unique per owner (422 `DUPLICATE`), and unknown stages or sources → 422. Another user can neither list nor delete them (404).

## 4. Consent and opt-outs

`POST /ws/ioeti/marketing/leads/{id}/consents {version, channel EMAIL|CALL, allowed, method, evidenceReference}`:
- Consent (`allowed: true`) needs an evidence reference; an opt-out does not.
- The native `isDoNotSendEmail` / `isDoNotCall` flags hold the current state. Every change is appended to `LeadConsentEvent` with the method, evidence, actor and time.
- A stale version → 409. Concurrent changes on one version: one wins, the rest get 409, and no history is lost.

`GET …/consents` returns the current state per channel and the history, newest first. Nothing decides here what the consent allows. The lawful basis, wording and retention are not assumed; see the engineering note in `docs/decisions/OPEN_IOETI_POLICY_DECISIONS.md`.

## 5. Source and campaign attribution

`GET /ws/ioeti/marketing/leads/{id}/attribution` returns the lead's native source and the campaigns the caller may read whose native `leadSet` holds the lead. `POST …/campaigns {version, campaignId}` needs **write** on the campaign (403 otherwise). The same campaign twice → 409 `ALREADY_ATTRIBUTED`.

Concurrent attributions of different leads to one campaign are serialized with a row lock taken before the campaign is reloaded, so none is lost and none is refused. The probe runs this with several leads at once.

`GET /ws/ioeti/marketing/campaigns` lists the readable campaigns.

## 6. Follow-ups and the activity timeline

- `POST /ws/ioeti/marketing/leads/{id}/follow-ups {version, type CALL|MEETING|TASK, subject, at}` plans a native CRM `Event` linked to the lead, owned by the caller and lasting 30 minutes. A bad date or type → 422.
- `GET /ws/ioeti/marketing/follow-ups[?overdue=true]` returns the caller's planned lead follow-ups, oldest first.
- `POST /ws/ioeti/marketing/follow-ups/{id}/done {version}` → realized. Doing it again → 422 `FOLLOW_UP_STATE`.
- `GET /ws/ioeti/marketing/leads/{id}/timeline` merges the lead's readable events and consent changes, newest first.

These are reminders for people. **No reminder, notification or escalation is sent automatically** (D-12), and no e-mail, SMS or WhatsApp message is sent (D-10).

## 7. Policy blocks

`POST /ws/ioeti/marketing/leads/{id}/route` → 422 `BLOCKED_BY_POLICY` (D-12) for a caller who may change the lead, and 404 for anyone else.

## 8. UI

- **Leads page (live mode):**
  - server-side search;
  - stage, source, business line and "only mine" filters;
  - saved views: apply, save and delete;
  - a **New lead** form with the duplicate review (links to the similar leads, then "Not a duplicate, record");
  - a **Follow-ups** tab with the overdue filter and "Done".
- **Lead page:**
  - consent per channel (consent disabled until there is an evidence reference) and its history;
  - source and campaigns, with attribution;
  - follow-up planning;
  - the activity timeline;
  - a note that nothing is sent from here.

  Each action sends the lead's current version and reloads the lead afterwards.
- The fictional preview is unchanged and stays read-only.

## 9. Not done

| Item | Why |
|---|---|
| Automatic routing, round robin or territory assignment, response-time targets, escalation, reminders sent by the system | D-12 (with D-07 for assigning to others) |
| Sending e-mail, SMS or WhatsApp; public web forms; ad-platform lead import | D-10 |
| Merging duplicate leads | D-07 (ownership and history) |
| Lawful basis, consent wording, retention; whether an opt-out applies to every record of the same person | Owner decision; see the engineering note |
| Campaign budgets, ROI and attribution models | Reporting (Wave 7), only from real data |
