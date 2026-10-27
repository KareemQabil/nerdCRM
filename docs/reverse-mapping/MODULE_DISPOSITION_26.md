# All 26 Axelor Open Suite v9.1.10 modules — explicit disposition

**Source inventory:** `SOURCE_SCOPE_COUNTS.json` + 26 CSVs in `source-ledger/`. Each module has an indexed exact repository tree, even if outside IOETI scope. These are architecture recommendations, **not a runtime activation inventory**.

| Pinned AOS module | IOETI relationship | Proposed treatment | Trace targets |
|---|---|---|---|
| axelor-account | Invoice, payments, credit, aging, tax | **SELECTIVE REUSE** (avoid promising full ERP/general ledger) | FIN, CT, ANA |
| axelor-bank-payment | Reconciliation, payment batch and bank orders | **EVALUATE / P2** only if accounting scope approved | FIN, DEP |
| axelor-base | Partner, contact, product, price, teams, source, documents and settings | **CORE REUSE** and extend missing IOETI semantics | ORG, AC, CAT, ADM |
| axelor-budget | Budget, scenario, cost center variance | **OPTIONAL** fundraising/project budget controls after accounting decision | FIN, FUND |
| axelor-cash-management | Cash forecasts and opportunity-based receipts forecast | **OPTIONAL P2**, not ordinary revenue ledger | FIN, ANA |
| axelor-client-portal | Portal models and simple client views | **EVALUATE**, no production capability assumed and separate UI/auth required | INT, SCOPE |
| axelor-contract | Contract, versions, templates, renewable contracts | **CORE REUSE + EXTEND** legal review, signed copies and terms | CT, REC, FUND |
| axelor-crm | Lead, Opportunity, Event, Tour, contacts | **CORE REUSE + EXTEND** per-line pipeline and staged handover | LD, OP, AC |
| axelor-fleet | Vehicles, costs, maintenance bookings | **OUT OF CURRENT SPEC**, source indexed | SCOPE |
| axelor-gdpr | Consent/erasure request and processing registers | **SELECTIVE REUSE**, not automatic proof of Egyptian compliance | ORG, LD, REC, FUND |
| axelor-helpdesk | Ticket, TicketStatus, SLA | **OPTIONAL** customer service/certification query case handling | OPS |
| axelor-human-resource | Payroll, timesheets, leave, employee history | **LIMITED REUSE** only organizational employee/trainer references if lawful, not an HR rollout | TR, SCOPE |
| axelor-intervention | Field visit, checklist, evidence, signature, scheduler | **CORE REUSE + NEW ISO DOMAIN** | ISO, OPS |
| axelor-maintenance | Machine/equipment maintenance requests | **OUT OF CURRENT SPEC**, source indexed | SCOPE |
| axelor-marketing | Campaign, target lists, attendees, email | **CORE REUSE + EXTEND** ROI/source and channel connectors | MKT, LD |
| axelor-mobile-settings | Mobile menus, dashboards, links | **OPTIONAL** native mobile PoC; custom responsive UI remains primary | UX, INT |
| axelor-production | Manufacturing order, BOM, machine routing | **OUT OF CURRENT SPEC**, source indexed | SCOPE |
| axelor-project | Projects, tasks, resources, wiki, templates | **CORE REUSE + NEW HANDOVER DOMAIN** | OPS, DOC |
| axelor-purchase | Supplier orders, tender | **OPTIONAL** outsourced-trainer procurement / finance approval only if needed | SCOPE |
| axelor-quality | QI root cause CAPA, quality control | **SELECTIVE REUSE**, internal QMS != client ISO certification | ISO |
| axelor-sale | Quote, sale order lines, versions, packs, approvals infrastructure | **CORE REUSE + EXTEND** A/B/C, discounts and bilingual output | QT, CAT, OP |
| axelor-stock | Inventory movement, warehouse, tracking | **OUT OF CURRENT SPEC** unless physical inventory is later required | SCOPE |
| axelor-supplier-management | Supplier purchase extensions | **OPTIONAL** only if accepted purchasing scope | SCOPE |
| axelor-supplier-portal | Supplier external access | **OUT OF CURRENT SPEC**, supplier access != client portal | SCOPE |
| axelor-supplychain | Timetable/milestone invoicing, procurement integration | **SELECTIVE REUSE** milestone service only; no warehouse scope implied | FIN, CT |
| axelor-talent | Employee Training/Recruitment/Skills | **SELECTIVE REUSE + NEW EXTERNAL DOMAINS**; cannot substitute internal hire/train models | TR, REC |

## Non-AOS but pinned

- **Axelor Studio 4.0.7** — dynamic MetaJsonModel/Field, BPM human tasks, DMN tables, migrations, template features: use underneath IOETI custom business admin after runtime and security proof.
- **Axelor Utils 4.0.2** — conflicts/REST error handler and common helpers; version conflicts must use correct exception mapping and integration proof.
- **Axelor Open Platform 8.2.5** — authenticating permissions, metadata, generic REST and frontend runtime. Source-only version tree unresolved at audit time; binaries/JAR source audit is an outstanding P0 need.
- **Axelor Open Suite Webapp v9.1.10** — wrapper and pinned submodule, not business capability itself.

## Review non-core modules before enabling

Many upstream apps initialize tables, menus, resources and jobs, and may change permissions or data processing defaults. For an IOETI deployment, maintain explicit enabled app list with justification, license/SBOM review, installed migrations and role blast radius. Do not activate the whole platform just because all files were inventoried.
