# Arabic-first foundation and PDF rendering

## What was verified

| Topic | Finding | Evidence |
|---|---|---|
| RTL UI | Axelor web client (AOP 8.2.x) switches the whole layout to RTL when the user language is `ar` (`<html dir="rtl" lang="ar">`, menu on the right). Language is read at login: change language → log in again. | `scripts/ui_smoke_test.cjs` 7/7 PASS, `logs/ui/04-business-lines-arabic-rtl.png` |
| Arabic as a user language | Upstream `select.language` offers only `en`, `fr`. IOETI adds `ar` in `ioeti-core/views/Selects.xml` (id `ioeti-select-language`, priority 21 > axelor-core 20) — no upstream file changed. | DB `meta_select`, UI test |
| Translation storage | Translations live in `meta_translation` (DB, editable live by admins). Modules ship `src/main/resources/i18n/messages_<lang>.csv`; loaded on install and on **restore** (`scripts/ioeti.sh restore-meta`). AOS base also provides `ImportExportTranslation` for bulk work. | 14 IOETI `ar` keys loaded |
| Upstream Arabic coverage | AOS 9.1.10 ships **en and fr only** (26 modules × `messages_en/fr.csv`, ~17.7k keys; ~11.8k for the modules IOETI uses). In Arabic mode, upstream labels stay English ("Code", "Status", menus). | UI test INFO line, screenshot |
| Arabic text input & storage | PostgreSQL UTF-8 (`C.UTF-8` cluster), Arabic names stored and returned correctly through UI, generic API and IOETI API. | grid screenshot, API smoke test (`nameAr`) |
| Search normalisation | AOP enables `unaccent` when the extension exists (installed by `infra/postgres/init/01-extensions.sql`); `unaccent` does not normalise Arabic letter variants. IOETI `ArabicTextNormalizer` (alef/hamza, ta marbuta, alef maqsura, tashkeel, tatweel, Arabic-Indic digits) + `pg_trgm` (installed) are the basis for duplicate detection. | 6 unit tests PASS |
| PDF — Axelor HTML printing (Flying Saucer 10.0.6 + OpenPDF 3.0.1, the stack of AOS `Print` templates) | Arabic letters are **shaped correctly** but **RTL layout is ignored**: text left-aligned, table columns in LTR order; extracted text is in visual (reversed) order (not searchable/copyable). | `scripts/support/FlyingSaucerArabicProbe.java`, `logs/pdf/flying-saucer-arabic-1.png` |
| PDF — Chromium (Playwright; same engine as Gotenberg) | Correct shaping **and** RTL layout, logical text order. | `scripts/support/chromium_pdf_probe.cjs`, `logs/pdf/chromium-arabic-1.png` |
| PDF — BIRT (87 AOS report designs) | **UNVERIFIED** in this phase. | — |

## Decisions
1. **Production Arabic documents (quotes, contracts, certificates) need an external
   Chromium-based renderer** (e.g. Gotenberg, MIT) behind an IOETI service
   (`ioeti-integrations`), unless a BIRT RTL test later proves sufficient. Flying Saucer can be
   used only for simple LTR or single-paragraph Arabic documents.
2. Arabic translation of upstream AOS screens is a **separate work package**: export keys of the
   modules in use, machine-translate, human-review the screens IOETI staff actually use, ship as
   `ioeti-core/src/main/resources/i18n/messages_ar.csv` (or a dedicated `ioeti-i18n-ar` module if
   it grows). Do not translate all 17.7k keys blindly.
3. Fonts: use an Arabic font with good Naskh coverage (e.g. Noto Naskh Arabic / Cairo, OFL) for
   PDFs; the probe used DejaVu Sans only because it is installed.
