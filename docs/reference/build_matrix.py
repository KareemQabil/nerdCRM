"""Builds PLATFORM_COVERAGE_MATRIX.csv and prints weighted scores.

Scores (per handoff): 2 native/usable, 1.5 native+moderate adaptation,
1 addon or strong foundation, 0.5 generic capability only, 0 build from scratch.
Weights: 5 critical .. 1 later.  Phase: V1 or P2 (proposed cut, to be validated).
Ev: V = verified in source code this session, D = from docs/experience, not re-verified.

Platforms:
  AX = Axelor Open Suite 9.1 + Axelor Studio/BPM 4.0 + Axelor Mobile (all AGPL)
  OD = Odoo 18.0 Community + OCA 18.0 (Odoo 19 lacks OCA tier validation/donation)
  FR = Frappe v16 + ERPNext v16 + Frappe CRM + HRMS + Education/LMS
"""
import csv, sys
from collections import defaultdict

R = [
# id, domain, requirement, weight, phase, AX, OD, FR, ev, AX note, OD note, FR note
("SEC-01","Security","Roles defined from admin",5,"V1",2,2,2,"V","Role/Group/Permission UI","res.groups UI; OCA base_user_role","Role / Role Profile"),
("SEC-02","Security","Record scope Own/Team/BusinessLine/All",5,"V1",1.5,1.5,1,"D","Permission conditions in UI (domain on user/team)","ir.rule in UI; team rules exist, BL rule custom","if_owner + User Permission; team hierarchy needs permission_query hook"),
("SEC-03","Security","Field-level security (cost, margin, salary, donor)",5,"V1",2,1,2,"V","MetaPermission field rules in UI","groups= on fields via code (no UI)","permlevel per field via Customize Form"),
("SEC-04","Security","Action perms: export/import/delete/approve",4,"V1",2,1.5,2,"D","Permission has import/export flags","OCA base_export_manager","Per-role export/import/delete/submit"),
("SEC-05","Security","Soft delete only",3,"V1",1,1.5,1.5,"D","archived flag","active=False archiving on most models","Deleted Document (restorable)"),
("SEC-06","Security","Dept > Team > User; user in many business lines",4,"V1",1.5,1.5,1,"D","Team + CompanyDepartment","crm.team members (multi-team) + hr.department","CRM Sales Hierarchy; BL membership custom"),
("SEC-07","Security","Temporary delegation with auto-expiry",2,"P2",0.5,0.5,0.5,"D","custom","custom","custom"),
("SEC-08","Security","2FA + Google/Microsoft SSO",3,"V1",2,2,2,"V","MFA in AOP core; pac4j OAuth/OIDC","auth_totp, auth_oauth (CE)","2FA + social login"),
("SEC-09","Security","Immutable audit log (who/what/when/device)",5,"V1",1.5,1.5,1.5,"V","AuditLog + GlobalTrackingLog","chatter tracking + OCA auditlog","Version + Access/Activity Log"),
("SEC-10","Security","Role-based onboarding tour",1,"P2",0.5,1,1,"D","custom","web_tour / OCA web_quick_start_screen","Form Tour / onboarding"),
("BL-01","Business lines","Business Line entity: own pipeline, fields, templates, handover tasks, no code",5,"V1",1,1.5,1,"V","Studio can model it; opp statuses are global","crm.team = BL: own stages + lead_properties_definition per team","custom DocType; CRM deal statuses are global"),
("CAT-01","Catalog","Service catalog (bilingual, BL, deliverables, duration, mode, status)",5,"V1",1.5,1.5,1.5,"D","Product + Studio json fields","product.template translatable + properties","Item + custom fields"),
("CAT-02","Catalog","Pricing models: fixed/per person/per day/tiers/% /custom",4,"V1",2,1.5,1.5,"V","Pricing engine with Groovy formulas + PriceList","pricelist rules (min qty tiers, formulas); % of salary custom","Pricing Rule tiers; % custom"),
("CAT-03","Catalog","Bundles (ISO + training in one offer)",3,"V1",2,1.5,2,"V","Pack/PackLine","combo products / OCA sale_product_set","Product Bundle"),
("LEAD-01","Leads","Lead record with admin-editable fields per BL",5,"V1",2,2,2,"V","Lead + Studio json fields","crm.lead + properties per team","CRM Lead + custom fields"),
("LEAD-02","Leads","Web form / webhook / API capture",4,"V1",1,2,2,"D","REST + Studio WS connectors; no form builder","website_crm forms + mail alias + API","Web Form + REST"),
("LEAD-03","Leads","Meta / LinkedIn Lead Ads auto-intake",2,"P2",0.5,0.5,0.5,"D","custom/Zapier","CE none (EE social)","custom/Zapier"),
("LEAD-04","Leads","WhatsApp inbound/outbound",2,"P2",0,0.5,1.5,"V","none","whatsapp module is Enterprise","frappe/whatsapp (MIT) + CRM integration"),
("LEAD-05","Leads","Email-to-lead",3,"V1",1.5,2,2,"D","email accounts/messages","mail alias per team","Email Account -> Lead"),
("LEAD-06","Leads","Excel/CSV import with mapping + preview",4,"V1",1.5,2,1.5,"V","AdvancedImport","base_import mapping + test run","Data Import"),
("LEAD-07","Leads","Lifecycle New>Working>MQL>Handed>SAL>SQL + side states w/ mandatory reason",5,"V1",1.5,1,1.5,"V","LeadStatus configurable + LostReason","leads have no stage pipeline in CE; custom status field","CRM Lead Status configurable"),
("LEAD-08","Leads","Dedup phone/email/domain/company + fuzzy warning",3,"V1",1,1.5,0.5,"V","generic duplicate finder","duplicate_lead_ids native; OCA base_search_fuzzy, partner_email_duplicate_warn","custom"),
("LEAD-09","Leads","Arabic text normalization for matching",2,"P2",0.5,0.5,0.5,"D","custom","custom","custom"),
("LEAD-10","Leads","Merge preserving history",3,"V1",1,2,1.5,"D","basic merge","lead merge + partner merge wizard","rename/merge"),
("LEAD-11","Leads","Fit + engagement scoring, admin-tunable",3,"P2",1,1,0.5,"V","leadScoringSelect manual; DMN tables could compute","predictive probability (naive Bayes); rules custom","custom"),
("LEAD-12","Leads","Assignment: round-robin/by BL/governorate/language, workload cap, skip on leave",4,"V1",0.5,1.5,2,"V","custom/BPM","team member assignment_domain + assignment_max + optout","Assignment Rule: Round Robin/Load Balancing/Based on Field"),
("LEAD-13","Leads","SLA first-contact timer + reassign/escalate",3,"V1",0.5,0.5,2,"V","SLA only for helpdesk tickets","custom cron","SLA on any DocType; CRM SLA on leads/deals"),
("LEAD-14","Leads","Lead pool (unowned, pull rules)",2,"P2",1,1.5,1,"D","unassigned filter","unassigned leads per team","unassigned filter"),
("LEAD-15","Leads","Nurturing sequences email/WA, stop on reply",2,"P2",1,1,1,"D","marketing campaigns basic","mass_mailing (automation is EE)","Email Campaign schedules"),
("LEAD-16","Leads","One-click convert to Account+Contact+Opportunity",5,"V1",2,2,2,"V","native convert","native convert","native convert"),
("MKT-01","Marketing","Campaigns: channel, budget, UTM, cost/lead, attributed revenue",3,"V1",1.5,1.5,1.5,"V","Campaign","utm.campaign; budget custom","Campaign + UTM fields on opp"),
("MKT-02","Marketing","Bilingual form builder + landing page",2,"P2",0.5,2,1.5,"D","none","website builder (CE)","Web Form/Web Page"),
("MKT-03","Marketing","Events/expos: attendees linked to leads",3,"V1",1.5,2,0.5,"V","Campaign attendees/Event","event + event_crm","custom"),
("MKT-04","Marketing","Dynamic segments + bulk email/WA with opt-out",2,"P2",1,1.5,1,"D","TargetList","mass_mailing lists + opt-out","Email Group/Newsletter"),
("PIPE-01","Pipelines","Separate pipeline per business line",5,"V1",0.5,2,0.5,"V","single OpportunityStatus list","stages per crm.team","single CRM Deal Status list"),
("PIPE-02","Pipelines","Probability per stage, weighted forecast",4,"V1",1.5,1.5,1.5,"V","probability on opp","OCA crm_stage_probability","Deal Status probability"),
("PIPE-03","Pipelines","Stage gates (mandatory fields to advance)",4,"V1",1.5,1,1.5,"D","Studio/BPM conditions","stage requirements tooltip only; enforce custom","Workflow conditions / mandatory_depends_on"),
("PIPE-04","Pipelines","Rotting: max days in stage, red flag, notify manager",3,"V1",0.5,1,0.5,"V","custom","native in Odoo 19 (rotting_threshold_days); custom cron on 18","custom"),
("PIPE-05","Pipelines","Auto tasks + playbook files on stage entry",3,"V1",1.5,1.5,1.5,"D","BPM","base_automation","Notification/Server Script"),
("OPP-01","Opportunities","Multiple service line items on the opportunity",5,"V1",1,1,2,"V","lines live on SaleOrder, not opp","lines live on sale.order, not crm.lead","Opportunity Item / CRM Products"),
("OPP-02","Opportunities","Contacts with decision roles; stakeholder map",3,"V1",1,1,1.5,"D","custom","OCA partner_multi_relation / contact role","CRM Contacts table on deal"),
("OPP-03","Opportunities","Competitors / incumbent provider",2,"V1",0.5,0.5,2,"V","custom","custom","Competitor Detail on Opportunity"),
("ACT-01","Activities","Calls/meetings/visits/notes/email/WA in one timeline",5,"V1",1.5,2,2,"D","Event + messages","chatter + activities","timeline + CRM activities"),
("ACT-02","Activities","Google/Outlook calendar sync",2,"P2",1.5,2,1.5,"V","ICalendar/CalDAV","google_calendar, microsoft_calendar (CE)","Google Calendar"),
("ACT-03","Activities","Next-step required; 'no follow-up' list",3,"V1",1,1.5,1,"D","nextScheduledEventDateT","activity deadlines + filters","next_step field"),
("VIEW-01","UX","Kanban/List/Calendar + saved views",4,"V1",2,2,2,"D","native","native","native"),
("FCST-01","Reporting","Forecast + targets by rep/team/BL",2,"P2",1,1,1,"D","CrmReporting","team targets; forecast is EE","Sales Person targets"),
("WL-01","Reporting","Win/loss: reasons, cycle time, stage conversion",2,"V1",1.5,1.5,1.5,"D","LostReason + reports","lost reasons + pivots","lost reasons + status change log"),
("ACC-01","Accounts","Account types + parent/child hierarchy roll-up",5,"V1",2,2,1,"D","Partner parent","parent_id/commercial partner; OCA partner_company_group","no parent on Customer/CRM Org; custom"),
("ACC-02","Accounts","Contact linked to many accounts, left-company history",4,"V1",1,1,2,"D","custom","OCA partner_multi_relation","Contact dynamic links"),
("ACC-03","Accounts","Certificates held by client + renewal alerts",3,"V1",0.5,0.5,0.5,"D","custom","custom","custom"),
("ACC-04","Accounts","Account 360 page (all related records + summary)",5,"V1",1.5,1.5,1.5,"D","dashlets","smart buttons","connections dashboard"),
("ACC-05","Accounts","Health score, cross-sell suggestions",1,"P2",0.5,0.5,0.5,"D","custom","custom","custom"),
("ACC-06","Accounts","Bulk ownership reassignment",3,"V1",1.5,2,2,"D","mass update","mass edit","bulk edit"),
("PRICE-01","Pricing","Price books per BL/segment with validity + versions",4,"V1",2,1.5,1.5,"V","PriceList + Pricing historization","pricelists w/ dates; OCA product_pricelist_revision","Price List + Pricing Rule validity"),
("PRICE-02","Pricing","EGP/USD/EUR, rate locked at issue",4,"V1",2,2,2,"D","native","native","native"),
("PRICE-03","Pricing","Egypt VAT / WHT / stamp tax config",3,"V1",1.5,2,1.5,"V","tax engine, no Egypt package","l10n_eg (LGPL)","tax templates"),
("QUOTE-01","Quotes","Quote from opp with discounts within limits",5,"V1",2,2,2,"D","native","native","native"),
("QUOTE-02","Quotes","Options A/B/C + optional lines",3,"V1",1,2,0.5,"D","custom","optional products (sale_management)","custom"),
("QUOTE-03","Quotes","Arabic/English/bilingual branded templates + clause library",5,"V1",1,2,1.5,"V","87 BIRT designs, FR/EN only; Arabic RTL in BIRT is fiddly","QWeb HTML->PDF (RTL ok) + OCA base_comment_template + sale_pdf_quote_builder","Jinja Print Format + T&C templates"),
("QUOTE-04","Quotes","Word export",2,"P2",1,1,0.5,"D","BIRT docx output","OCA report_py3o","custom"),
("QUOTE-05","Quotes","Numbering per BL/year + versions V1/V2 w/ compare",4,"V1",2,1.5,1.5,"V","Sequence + SaleOrder.versionNumber","sequences + OCA sale_order_revision","naming series + amend"),
("QUOTE-06","Quotes","Discount-threshold approvals by role, mobile, reject reason",5,"V1",1.5,1.5,2,"V","BPM + DMN thresholds","OCA sale_tier_validation (18.0 only)","Workflow transitions with conditions"),
("QUOTE-07","Quotes","Send by email/WA with view tracking",2,"P2",1,1.5,1,"D","email","portal link + mail tracking","email (+whatsapp app)"),
("QUOTE-08","Quotes","Client e-acceptance from link",2,"P2",1,2,1,"D","client-portal module","portal sign/accept (CE)","portal on Contract only"),
("QUOTE-09","Quotes","Statuses Draft..Expired/Revised + expiry alert",4,"V1",1.5,1.5,1.5,"D","statusSelect + validity","state + validity_date","status + valid_till"),
("QUOTE-10","Quotes","Quote library + standard quotes",3,"V1",2,2,1,"V","SaleOrder.template flag","quotation templates","copy only"),
("QUOTE-11","Quotes","Accept -> contract -> invoice -> engagement in one flow",5,"V1",1.5,1.5,1,"D","SO -> contract/project/invoice","SO -> invoice + sale_project; OCA agreement_sale","Quotation -> SO -> Invoice/Project; contract manual"),
("CTR-01","Contracts","Contract/MOU types + bilingual templates with variables",5,"V1",2,1.5,1.5,"V","Contract + ContractTemplate + ContractVersion","OCA agreement + agreement_legal","Contract + Contract Template (Jinja)"),
("CTR-02","Contracts","Lifecycle Draft..Terminated, auto-renew, expiry alerts",4,"V1",2,1.5,1,"V","statuses, tacit renewal, versions","OCA agreement stages / contract","signed/unsigned + dates"),
("CTR-03","Contracts","Opp can't be Won without signed contract (per pipeline)",3,"V1",1,1,1,"D","custom rule","custom rule","custom validation"),
("PAY-01","Finance","Event-based payment milestones -> invoice request",5,"V1",1,1.5,1,"V","PaymentCondition is time-based; AdvancePayment","OCA sale_invoice_plan + down payments; event trigger custom","Payment Terms Template (time-based)"),
("INV-01","Finance","Invoice record / simple issuing",5,"V1",2,2,2,"D","native","native","native"),
("INV-02","Finance","Egypt ETA e-invoice",3,"P2",0,2,0.5,"V","none","l10n_eg_edi_eta (LGPL, CE)","third-party only"),
("INV-03","Finance","Credit notes",3,"V1",2,2,2,"D","native","native","native"),
("PAY-02","Finance","Partial payments, receipts, Unpaid/Partial/Paid/Overdue",5,"V1",2,2,2,"D","InvoicePayment/InvoiceTerm","native","Payment Entry"),
("PAY-03","Finance","Automatic collection reminders",3,"V1",2,1.5,1.5,"V","DebtRecovery","OCA account_credit_control","Dunning / Payment Reminder"),
("PAY-04","Finance","Aging + Booked/Invoiced/Collected by BL/rep",4,"V1",1.5,1.5,2,"D","reports","OCA account_financial_report","AR aging native"),
("COM-01","Finance","Commissions on collected revenue",1,"P2",1,1,1.5,"D","basic","OCA commission","Sales Team commission"),
("TRN-01","Training","Bilingual course catalog",4,"V1",1,1.5,1.5,"V","talent Training (internal)","event types + slides","LMS Course / Education Course"),
("TRN-02","Training","TNA form -> quote lines -> annual plan",2,"P2",1,1.5,0.5,"D","intervention questionnaires","survey (+ survey_sale_generation on 19)","custom"),
("TRN-03","Training","Cohorts with states, capacity, min seats",4,"V1",1,2,1.5,"V","TrainingSession (internal)","event seats/tickets/states + OCA event_min_seat","LMS Batch seat_count/timetable"),
("TRN-04","Training","Trainer profiles, availability, conflict detection",3,"P2",0.5,1,1.5,"D","custom","custom/resource","Education Instructor + schedule overlap checks"),
("TRN-05","Training","Rooms/venues booking",2,"P2",0.5,1,1.5,"D","custom","custom","Education Room"),
("TRN-06","Training","External trainee registration (public page + bulk), waitlist",4,"V1",0.5,1.5,1,"V","TrainingRegister links Employee only","website_event registration + import; waitlist custom","LMS enrollment requires a User"),
("TRN-07","Training","Cohort budget / profitability",2,"P2",1,1,1,"D","analytics","analytic account","project costing"),
("TRN-08","Training","Attendance (mobile/QR) + min attendance rule",3,"V1",0.5,1.5,1.5,"V","custom","registration barcode check-in","Student Attendance tool"),
("TRN-09","Training","Pre/post tests, grades, pass/fail",2,"P2",0.5,1.5,2,"D","custom","survey scoring","Assessment Plan/Result; LMS quiz"),
("TRN-10","Training","Certificates PDF, serial, QR verify, bulk issue",3,"V1",0.5,1.5,1.5,"V","custom","survey certification + OCA report_qr","LMS Certificate + print format"),
("TRN-11","Training","Satisfaction surveys / NPS",2,"P2",1,2,1.5,"D","basic","survey","LMS batch feedback / Quality Feedback"),
("TRN-12","Training","Longitudinal trainee profile -> candidate pool",2,"P2",0.5,1,1,"D","custom","partner + hr_skills_event","custom link"),
("ISO-01","ISO","Certification cycle: readiness, Stage1/2, surveillance, renewal",4,"V1",0.5,1,0.5,"V","custom","mgmtsystem_audit + project as foundation","custom"),
("ISO-02","ISO","Audit plan/visit scheduling + auditor assignment",4,"V1",1,1.5,0.5,"V","Intervention scheduling","OCA fieldservice + mgmtsystem_audit","project tasks"),
("ISO-03","ISO","Audit checklists",3,"V1",1.5,1.5,0.5,"V","Intervention Range/Question questionnaires","mgmtsystem_audit questions / survey","custom"),
("ISO-04","ISO","Findings / nonconformities / corrective actions",4,"V1",1,1.5,1,"V","QI (manufacturing-oriented)","mgmtsystem_nonconformity + _action + mgmtsystem_partner","Non Conformance + Quality Action (internal QMS)"),
("ISO-05","ISO","Certificates issued to clients + surveillance schedule",3,"V1",0.5,0.5,0.5,"D","custom","custom","custom"),
("REC-01","Recruitment","Client recruitment request/positions linked to account",4,"V1",1,1,1,"V","JobPosition internal; add partner","hr.job + partner field","Job Requisition/Opening + customer field"),
("REC-02","Recruitment","Candidate pipeline, interviews, offers",4,"V1",1.5,2,2,"V","JobApplication + HiringStage","hr_recruitment","Job Applicant/Interview/Job Offer"),
("REC-03","Recruitment","Fee %, split payments, replacement guarantee",3,"V1",0.5,0.5,0.5,"D","custom","custom","custom"),
("FUND-01","Fundraising","Donor/grant pipeline",3,"V1",1,1.5,1,"D","opportunity type","crm.team pipeline","CRM deal"),
("FUND-02","Fundraising","Donations / commitments / receipts",3,"P2",0.5,1,0.5,"V","custom","OCA donation (18.0 only)","non_profit app archived"),
("PLAT-01","Platform","Admin-defined fields/objects/workflows without code",4,"V1",2,1,2,"V","Studio: custom models, fields, BPMN, DMN, dashboards (AGPL)","Properties fields + base_automation; Studio is EE","Custom DocType, Customize Form, Workflow, Server Scripts"),
("PLAT-02","Platform","API / headless friendliness",5,"V1",1.5,1.5,2,"D","generic /ws/rest","JSON-RPC; OCA fastapi","auto REST + whitelisted methods"),
("PLAT-03","Platform","Arabic + RTL admin UI out of the box",4,"V1",0.5,2,2,"V","RTL code in front 8.x; 0 Arabic strings (en/fr only)","ar.po across modules","ar.po across apps"),
("PLAT-04","Platform","Mobile for field sales/auditors",4,"V1",2,1.5,1.5,"V","Axelor Mobile (AGPL): crm, intervention, quality, sale apps","responsive + OCA web_responsive","responsive / PWA"),
("PLAT-05","Platform","Knowledge base / document bank",3,"V1",1.5,1.5,1.5,"V","DMS + project Wiki","OCA document_page + dms","Wiki app (MIT) / attachments"),
("PLAT-06","Platform","Dashboards per level",4,"V1",1.5,1.5,1.5,"D","Studio dashboards","spreadsheet_dashboard + pivots","workspaces + charts"),
("PLAT-07","Platform","Automation + notifications engine",4,"V1",2,1.5,2,"V","BPM (BPMN) + DMN","base_automation","Notification + Server Script"),
("PLAT-08","Platform","Client portal",1,"P2",1.5,2,1.5,"D","client-portal module","portal","portal"),
]

# ---- Round 2 (deeper Axelor review): corrections backed by source evidence ----
# id -> (field index, new score, note appended)
CORRECTIONS = {
    "ISO-02": (5, 1.5, "R2: Intervention has client, contact, contract, opportunity, assignedTo, planned dates, To plan>Planned>Started>Suspended>Finished, offline mode"),
    "ISO-03": (5, 2, "R2: InterventionQuestion: required/conditional questions, photo, signature, measure answers; Axelor Mobile intervention app"),
    "ISO-04": (5, 1.5, "R2: QualityImprovement type Product|System, detection origin Supplier|Internal|Customer, analysis/causes/decisions/actions"),
    "PAY-01": (5, 1.5, "R2: supplychain Timetable on SaleOrder: title, %, amount, estimatedDate, invoiced, linked invoice"),
    "QUOTE-03": (5, 1.5, "R2: BIRT has BiDi/RTL support + HTML Print templates (Flying Saucer/OpenPDF); Arabic shaping must be proven in PoC"),
    "QUOTE-04": (5, 1.5, "R2: Print template formats PDF/WORD/ODT"),
    "LEAD-10": (5, 1.5, "R2: DuplicateObjectsService + merge wizard"),
    "SEC-05": (5, 1.5, "R2: archived flag on all auditable models"),
}
for i, r in enumerate(R):
    if r[0] in CORRECTIONS:
        idx, val, note = CORRECTIONS[r[0]]
        r = list(r); r[idx] = val; r[9] = f"{r[9]} | {note}"; r[8] = "V"; R[i] = tuple(r)

# Spec rows missed in round 1 (both favour Axelor)
R += [
    ("LEAD-17","Leads","Contact consent tracking (موافقة التواصل) + opt-out",2,"V1",2,1.5,1,"V","axelor-gdpr: processing register, requests, erasure log","mail blacklist / opt-out","custom consent field"),
    ("ACT-04","Activities","Field visit result from mobile with photo + location",2,"V1",2,1,1,"V","crm Tour/TourLine + Axelor Mobile (photo, offline)","activities via mobile web","mobile web"),
]

P = ("AX", "OD", "FR")

def score(rows):
    tw = sum(r[3] * 2 for r in rows)
    return {p: sum(r[3] * r[5 + i] for r in rows) / tw * 100 for i, p in enumerate(P)}

def gap(rows):
    return {p: sum(r[3] * (2 - r[5 + i]) for r in rows) for i, p in enumerate(P)}

out = sys.argv[1]
with open(out, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["id","domain","requirement","weight","phase","axelor","odoo_oca","frappe","evidence","axelor_note","odoo_note","frappe_note"])
    w.writerows(R)

v1 = [r for r in R if r[4] == "V1"]
print(f"rows={len(R)} v1={len(v1)}")
for name, rows in (("ALL", R), ("V1", v1)):
    s, g = score(rows), gap(rows)
    print(name, " ".join(f"{p}={s[p]:.1f}% gap={g[p]:.0f}" for p in P))
by = defaultdict(list)
for r in R:
    by[r[1]].append(r)
print("\nper-domain weighted coverage %")
for d, rows in by.items():
    s = score(rows)
    print(f"{d:15s} " + " ".join(f"{p}={s[p]:5.1f}" for p in P))
# what if Axelor gets Arabic translated (PLAT-03 -> 2, QUOTE-03 -> 1.5)
fix = [list(r) for r in R]
for r in fix:
    if r[0] == "PLAT-03": r[5] = 2
    if r[0] == "QUOTE-03": r[5] = 1.5
s = score(fix); s1 = score([r for r in fix if r[4] == "V1"])
print(f"\nAxelor after Arabic i18n: ALL={s['AX']:.1f}% V1={s1['AX']:.1f}%")
