# A6: campaigns from the platform

Status: implemented and checked against the real backend:
- `scripts/campaign_probe.py` 11/11 (in backend CI); the lists 15/15 and daily-work 44/44 probes still pass;
- mocked browser tests `tests/campaigns.spec.ts` 2/2;
- a real-browser look in light at desktop and dark at 390 px.

On the capability map, marketing was partly live: sources, attribution and consent existed, but campaigns themselves could not be created or followed.

## What people can do

| Action | API (`/ws/ioeti/campaigns`) |
|---|---|
| See the campaign board, with results within your read scope | `GET ?q=` |
| Open a campaign with its results and the attributed leads you may read | `GET /{id}` |
| Add a campaign: a draft owned by its author | `POST` |
| Change name, type, period or summary, with the version | `POST /{id}` |
| Move it to another stage | `POST /{id}/stage` |
| Campaign types | `GET /types`; managed in the admin console's Lists tab (`campaign-types`) |

Built on the native `Campaign`. The period uses its start and end, the owner is its assigned user, and attribution is its lead set.

## Rules

- **Access.** Native campaign permissions decide on every call: anonymous 401, read-only 403 on changes.
- **Stages.**
  - Draft → planned → running ⇄ paused → ended, and planned → draft.
  - Anything else answers 422 `STAGE_NOT_ALLOWED`. An ended campaign stays ended.
  - A stale version answers 409.
- **Results** are counted from real records only: attributed leads, those converted, and the opportunities that came from them.
  - **Only within the caller's read scope.** A colleague's lead in the same campaign is neither counted nor listed for you.
  - There is no cost, revenue or ROI figure, because none is recorded.
- **Attribution moves the campaign's version.** The native lead set is saved on the campaign, so an edit opened before new leads arrived answers 409 and asks to refresh.
- **Sending from a campaign** (e-mail, WhatsApp, ads) is external exposure (D-10). It is not offered, and the screens say so.
- **Campaign types** are a fifth admin list: add, rename, and delete only while unused.

## Screens

- **Campaigns** (`#/campaigns`, under Sales): a board with a column per stage.
  - Cards show the type and the three figures.
  - **Drag a card to another column** with mouse or touch. Columns that cannot take it dim while dragging. A refused move is explained, sends nothing, and the card stays.
  - Each card also has a "move to" picker, the keyboard and screen-reader path.
  - Drag announcements are in Arabic or English.
- **Campaign page:**
  - the stage, the period, the type and the owner;
  - a button for each allowed next stage;
  - a results funnel (leads → converted → opportunities) and the attributed leads, linked to their pages.
