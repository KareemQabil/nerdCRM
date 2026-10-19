# IOETI — Platform Comparison, Round 2 (deeper Axelor review)

Date: 2026-10-19 · Inputs: *IOETI Egypt — CRM Requirements Specification* (sections 1–9) + Mega Handoff (ISO, recruitment, fundraising) · Matrix: `PLATFORM_COVERAGE_MATRIX.csv` (111 requirements; regenerate with `python3 build_matrix.py PLATFORM_COVERAGE_MATRIX.csv`)

| Code | Stack | License |
|---|---|---|
| **AX** | Axelor Open Suite 9.1.10 + Axelor Studio/BPM 4.0 + Axelor Mobile | AGPL-3 |
| **OD** | Odoo 18.0 Community + OCA 18.0 | LGPL-3 core, mostly AGPL-3 OCA |
| **FR** | Frappe/ERPNext v16 + Frappe CRM + HRMS + Education/LMS | MIT / GPL-3 / AGPL-3 |

## 1. What changed in round 2

Re-reading Axelor's source code showed that round 1 under-scored it. Corrections (all `V`, verified in source):

| Row | Round 1 → 2 | Evidence |
|---|---|---|
| ISO-02 audit visit scheduling | 1 → **1.5** | `Intervention`: client, contact, contract, opportunity, `assignedTo`, planned dates, status To plan → Planned → Started → Suspended → Finished, `offlineIntervention` |
| ISO-03 audit checklists | 1.5 → **2** | `InterventionQuestion`: required and conditional questions; photo, signature and measure answers; Axelor Mobile intervention app |
| ISO-04 findings / NC / CAPA | 1 → **1.5** | `QualityImprovement.type` = Product **or System**; detection origin includes **Customer**; analysis, causes, decisions, actions |
| PAY-01 payment milestones | 1 → **1.5** | `Timetable` on SaleOrder: %, amount, estimated date, invoiced flag, linked invoice |
| QUOTE-03 Arabic templates | 1 → **1.5** | BIRT supports right-to-left (BiDi), plus HTML print templates. Arabic letter shaping still needs proving in the PoC |
| QUOTE-04 Word export | 1 → **1.5** | Print formats PDF / WORD / ODT |
| LEAD-10 merge | 1 → **1.5** | `DuplicateObjectsService` + merge wizard |
| SEC-05 soft delete | 1 → **1.5** | `archived` flag on all models |
| **New** LEAD-17 consent | AX **2** / OD 1.5 / FR 1 | `axelor-gdpr` (processing register, requests, erasure log) |
| **New** ACT-04 field visit with photo | AX **2** / OD 1 / FR 1 | CRM `Tour`/`TourLine` + Axelor Mobile |

Also confirmed for Axelor: translations live in the database, are editable live, and there is a bulk `ImportExportTranslation` tool, so loading Arabic is a configuration job.

## 2. Results

| | Axelor | Odoo 18 + OCA | Frappe |
|---|---:|---:|---:|
| Native coverage, all 111 rows | 67.7 % | **75.1 %** | 70.3 % |
| Native coverage, V1 (84 rows) | 72.8 % | **77.4 %** | 73.8 % |
| Axelor with Arabic translated | 68.5 % / V1 73.7 % | — | — |
| Only the 57 rows verified in source | 69.4 % | **75.8 %** | 69.8 % |
| **Effort-adjusted V1 gap** (lower is better)* | **142** | 146 | 145 |
| Weighted decision criteria (handoff §31, out of 5) | 3.52 | 3.73 | **3.91** |

\* Effort-adjusted assumes a gap that is mostly data model, form or workflow costs about **60 %** as much to close with Axelor Studio (custom models, BPMN, DMN) or Frappe DocTypes/Workflow as with Odoo Community Python code, since Odoo Studio is Enterprise-only. The 60 % is my assumption, not a measurement.

**Reading:**
- **Modules out of the box:** Odoo leads by 4–5 points on V1. That's a real lead but not a large one.
- **Build effort:** the three are essentially tied. Axelor is marginally best because its free Studio closes model and workflow gaps without code. This is where your intuition about Axelor holds up.
- **Overall criteria:** Axelor comes last. That's caused by ecosystem, Arabic, license complexity and upgrades, not by modules.

## 3. Weighted decision criteria (handoff §31)

| Criterion | W | Odoo | Axelor | Frappe | Why |
|---|---:|---:|---:|---:|---|
| Domain coverage | 25 | 3.87 | 3.64 | 3.69 | V1 native % ÷ 20 |
| Custom effort | 20 | 3.9 | **4.0** | 3.9 | effort-adjusted gap (tie) |
| API / headless | 15 | 3.0 | 4.0 | **4.5** | AX generic REST with ACL; FR REST + whitelisted methods; OD JSON-RPC or OCA fastapi |
| Security | 10 | 3.5 | **4.5** | 4.0 | AX record and field permissions in the UI, MFA in core |
| Maintainability | 10 | 3.0 | 2.5 | **3.5** | AX Community gets **no official migration scripts** (Axelor forum); OD has OCA porting lag (19.0 still missing tier validation and donation) |
| License simplicity | 7 | 4.0 | 3.0 | **4.5** | AX has a Community/Pro/Enterprise split and closed portal backend (see §4) |
| Hosting | 5 | **4.0** | 3.0 | 3.5 | JVM/Tomcat needs more RAM |
| Ecosystem / Egypt hiring | 5 | **5.0** | 2.0 | 3.5 | |
| Arabic / local | 3 | **5.0** | 1.5 | 4.0 | AX has 0 Arabic strings shipped; Egypt e-invoicing only in Odoo |
| **Total** | | 3.73 | 3.52 | **3.91** | |

The 1–5 scores outside coverage and effort are judgment calls. Change them and rerun if you disagree.

## 4. Axelor edition and licensing findings (new)

- **All 26 modules in the public `axelor-open-suite` repo are AGPL-3**, so everything scored above is usable for free.
- **Axelor's pricing page** (as quoted in search results; axelor.com is blocked from this environment) describes three tiers:
  - Community: "essential modules", community support.
  - Pro: "all business modules", updates, e-invoicing.
  - Enterprise: AI, BI, **SSO**, **"advanced Studio"**.

  The basic Studio, BPM and DMN are in the AGPL `axelor-studio` repo. Which Studio features count as "advanced" is still unknown.
- **The Goovee portal isn't free for this use.** It's Axelor's Next.js portal with events, registration, quotations, invoices and CMS. It's under a **Sustainable Use License** (internal business use only), parts under an **Enterprise License**, and it needs an `axelor-portal` backend module (`portal_portal_event` tables) that is **not** in the open-source repo. Public course registration and a client portal would have to be built for IOETI.
- **The Axelor forum says Community users get no migration scripts** between versions; those come with Pro/Enterprise.

## 5. Where each platform clearly wins

- **Axelor:** no-code Studio/BPM/DMN for IOETI admins; native mobile with offline audit checklists (photo and signature); contracts with versions and tacit renewal; formula pricing; record and field permissions in the UI; GDPR consent; field visit planning.
- **Odoo:** the most domain modules out of the box. Pipelines per business line, events and training registration, surveys and certificates, OCA ISO management-system, donations, Egypt tax and e-invoicing, quote templates with portal e-sign, Arabic everywhere, largest Egyptian talent pool.
- **Frappe:** best API and custom-app platform; Assignment Rules and SLA on any record type; opportunity line items, contact roles and competitors; simplest licensing.

## 6. Conclusion

- **The data doesn't support "Axelor is way better."** It also doesn't support dismissing Axelor. On build effort, which matters most for a fixed-price V1, the three are effectively tied. Axelor's advantages (Studio, mobile audits, permissions, contracts) are real. Its disadvantages are mostly outside modules: no Arabic, small Egyptian ecosystem, paid-only migration scripts, closed portal.

**If you go with Axelor**, it's a defensible choice under these conditions:
1. **Price the Arabic work in:** about 12k strings, roughly **3–5 days** with an LLM pass and review.
2. **Prove Arabic PDFs on day 1:** quote and certificate in BIRT or HTML Print, with Arabic letter shaping and right-to-left layout. If it fails, generate PDFs from the custom frontend instead.
3. **Build these in Studio/BPM:** per-business-line pipelines (PIPE-01, the biggest gap), external trainee training, fundraising, lead assignment and SLA.
4. **Don't depend on Goovee or the portal backend.** IOETI's public registration and portal go in your own Next.js frontend.
5. **Budget upgrades yourself:** pin 9.1.x, with no migration scripts in Community.
6. **Expect to be the long-term maintainer.** Tell IOETI that Axelor developers in Egypt are scarce.

**Decisive next step either way:** a 2-day Golden Scenario PoC on Axelor 9.1. It should test:
- Arabic UI and PDF
- a Studio-built business-line pipeline
- quote → contract → Timetable → invoice
- Intervention as an ISO audit with a QI nonconformity
- field permissions on cost
- the REST API from a test client

If day 1 (Arabic PDF + Studio pipeline) passes, Axelor is a sound choice.

## 7. Underrated companion tools (round 3)

No further core platform beats the top three:
- Krayin (MIT) is CRM-only.
- NocoBase now ships under its own non-open-source agreement.
- Twenty and EspoCRM were already ruled out.

The useful finds are companion tools that fill specific gaps. Licenses were checked in each repo.

| Tool | License | Fills | Matters most for |
|---|---|---|---|
| **`axelor/n8n-nodes-axelor`** (official, updated 2026-10-16) + n8n or Activepieces | MIT nodes; n8n Sustainable Use (internal use OK); Activepieces MIT core | Webhook/form intake, Meta/LinkedIn lead ads, SLA timers, reassignment, nurturing sequences, renewal alerts. The nodes support Axelor record CRUD, triggers, Studio custom models, DMS and actions | Axelor |
| **Gotenberg** | MIT | HTML/DOCX → PDF via Chromium/LibreOffice; correct Arabic shaping and right-to-left. Covers quotes, contracts and QR certificates | Axelor's main PDF risk |
| **Chatwoot** | MIT core (+ separate enterprise folder) | WhatsApp Cloud API shared inbox | Axelor, Odoo Community |
| **CAMeL Tools** (NYU Abu Dhabi) + Postgres `pg_trgm` + libphonenumber | MIT | Arabic normalization, fuzzy company matching, +20 phone normalization (LEAD-08/09) | all |
| **Moodle** + `mod_customcert` / **OpenEduCat** (Odoo, LGPL, 18.0/20.0) | GPL / LGPL | Training delivery: attendance, exams, certificates. OpenEduCat adds courses, batches, timetable, classrooms | Training if scope grows |
| **Documenso** | AGPL | Contract e-signature, quote acceptance | Phase 2 |
| **Metabase** | AGPL core | Role dashboards, booked/invoiced/collected reports on Postgres. It bypasses app permissions, so give it to managers only or point it at filtered views | all |
| **BookStack** / Wiki.js | MIT / AGPL | Knowledge base | if built-in DMS/wiki isn't enough |
| Formbricks | AGPL core | Surveys, NPS, needs-assessment forms | Phase 2 |

**Effect on scores** (companion tools applied to every platform where they help, Axelor Arabic translated):

| | Axelor | Odoo 18 + OCA | Frappe |
|---|---:|---:|---:|
| All rows | 71.9 % | 76.5 % | 71.1 % |
| V1 rows | **76.2 %** | 77.9 % | 73.8 % |

These tools help Axelor the most, because its gaps sit exactly where they plug in. Combined with the effort-adjusted tie (§2), **Axelor + Gotenberg + n8n-nodes-axelor is within about 2 points of Odoo on V1 coverage.** For a $3k V1, add only Gotenberg (and n8n if lead intake is in scope); the rest is Phase 2.
