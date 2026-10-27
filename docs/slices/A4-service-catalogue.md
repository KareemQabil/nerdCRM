# A4: the service catalogue from the platform

Status: implemented and checked against the real backend:
- `scripts/catalog_probe.py` 7/7 (in backend CI); `quote_probe.py` still passes 50/50;
- mocked browser tests `tests/catalog.spec.ts` 3/3;
- a real-browser look in light at desktop and dark at 390 px.

On the capability map, the catalogue was read-only: sellers could pick from it in a quotation, but nobody could add or change a service without the native Axelor screens.

## What people can do

| Who (native permission on products) | What | API (`/ws/ioeti/catalog/products`) |
|---|---|---|
| Read | See the services on sale, as in quotations | `GET ?q=` |
| Read + write | See the whole catalogue (services off sale too) | `GET ?all=true` |
| Create | Add a service | `POST` |
| Write | Change a service with its version | `POST /{id}` |
| Read | Units and categories to choose from | `GET /units` · `GET /categories` |

The fields of a service:
- code, name and short summary;
- service or product;
- the unit it is sold in, its price **before tax** and its currency;
- its category, whether it is on sale, and when it is available.

## Rules

- **Who may manage.** Access follows the native product permissions on every call. The screen shows the management controls only when the server answers the whole-catalogue read; sellers get the services on sale.
- **Codes.** Upper-cased, 2 to 30 letters, digits, dots, dashes or underscores, and unique ignoring case (422 `DUPLICATE`).
- **Prices.** Zero or more, at most two decimals; the currency must exist.
- **Dates.** The end date cannot be before the start.
- **Conflicts.** A stale version answers 409.
- **No tax is set or guessed** (D-06).
  - Each service shows whether finance set its **revenue account**, which D-06 notes every quoted product needs.
  - This is "ready to invoice" in the caller's active company, or in any company when the caller has none.
  - Until then the screen says the accounting set-up is with finance.
- **Taking a service off sale** hides it from sellers' quotations at once; it stays in the managers' catalogue.

## Screens

**Service catalogue** (`#/catalog`, under Sales):
- price-tag cards with code, category, price, unit and readiness;
- search, and a filter for on sale or off sale;
- dialogs to add or edit a service.

## Found on the way

Saving a product makes Axelor generate a barcode file owned by the person who saved it. The shared probe clean-up now removes the files a test user created, so test users can be deleted.
