#!/usr/bin/env python3
"""Fictional showcase data for reviewing the product on a local or staging server. Never production.

  setup [--demo-states]   creates seven fictional people with role groups built from native permissions,
                          then works through the real IOETI APIs as those people: leads (one converted, with
                          a quotation, milestones, a review sent back and a draft contract), a training cohort
                          with a waitlist and attendance, a certification cycle with audits and a finding, a
                          recruitment job order with a pipeline, a funded grant with installments and a
                          collection, a published knowledge article and in-app mentions.
                          --demo-states also marks the contract active and the order confirmed with SQL, so the
                          handover, engagement and invoice-request screens have data. Those two states are
                          policy-blocked in the product (D-11, D-06); the flag is for demonstration databases only.
  teardown                removes everything setup created (state in .local/showcase-state.json)
Credentials for the fictional people are written to .local/showcase-users.txt (mode 600, never committed).
"""
import json
import os
import secrets
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_smoke_test import ENV, ROOT, Client, axelor_password_hash, ok, rest_create  # noqa: E402
from probe_fixtures import CONTRACT, RESERVED_SEQUENCE, _delete_where, cleanup, delete_contract  # noqa: E402

USER, GROUP, PERM = "com.axelor.auth.db.User", "com.axelor.auth.db.Group", "com.axelor.auth.db.Permission"
ROLE = "com.axelor.auth.db.Role"
PARTNER, PRODUCT, COMPANY = "com.axelor.apps.base.db.Partner", "com.axelor.apps.base.db.Product", "com.axelor.apps.base.db.Company"
CURRENCY, SOURCE, CAMPAIGN = "com.axelor.apps.base.db.Currency", "com.axelor.apps.base.db.Source", "com.axelor.apps.marketing.db.Campaign"
STOCK_LOCATION, STOCK_CONFIG = "com.axelor.apps.stock.db.StockLocation", "com.axelor.apps.stock.db.StockConfig"
ACCOUNT, ACCOUNT_CONFIG = "com.axelor.apps.account.db.Account", "com.axelor.apps.account.db.AccountConfig"
ACCOUNT_MANAGEMENT = "com.axelor.apps.account.db.AccountManagement"
ACCOUNTING_SITUATION = "com.axelor.apps.account.db.AccountingSituation"
SALE_ORDER, SALE_ORDER_LINE = "com.axelor.apps.sale.db.SaleOrder", "com.axelor.apps.sale.db.SaleOrderLine"
TIMETABLE = "com.axelor.apps.supplychain.db.Timetable"
SEQUENCE, SEQUENCE_VERSION = "com.axelor.apps.base.db.Sequence", "com.axelor.apps.base.db.SequenceVersion"
LEAD, EVENT, OPP = "com.axelor.apps.crm.db.Lead", "com.axelor.apps.crm.db.Event", "com.axelor.apps.crm.db.Opportunity"
CONTRACT_LINE, EMAIL_ADDRESS = "com.axelor.apps.contract.db.ContractLine", "com.axelor.message.db.EmailAddress"
PROJECT, TASK, TEAM = "com.axelor.apps.project.db.Project", "com.axelor.apps.project.db.ProjectTask", "com.axelor.team.db.Team"
LINE, META_FILE = "com.ioeti.businessline.db.BusinessLine", "com.axelor.meta.db.MetaFile"
W, O, C, T, R, F, D, A, M = ("com.ioeti.workspace.db.", "com.ioeti.operations.db.", "com.ioeti.certification.db.", "com.ioeti.training.db.",
                             "com.ioeti.recruitment.db.", "com.ioeti.fundraising.db.", "com.ioeti.content.db.", "com.ioeti.automation.db.",
                             "com.ioeti.marketing.db.")
REVIEW, REVIEW_EVENT, INVOICE_REQUEST = W + "ReviewRequest", W + "ReviewEvent", W + "InvoiceRequest"
REQ, HANDOVER, ITEM, H_EVENT = O + "HandoverRequirement", O + "HandoverRequest", O + "HandoverItem", O + "HandoverEvent"
CYCLE, AUDIT, NC, QUAL = C + "CertificationCycle", C + "CertificationAudit", C + "Nonconformity", C + "AuditorQualification"
COURSE, COHORT, ENROLLMENT, SESSION, ATTENDANCE = (T + "TrainingCourse", T + "TrainingCohort", T + "TrainingEnrollment",
                                                   T + "CohortSession", T + "TrainingAttendance")
ORDER, CAND, PRIV, CONSENT = R + "ClientJobOrder", R + "RecruitmentCandidate", R + "CandidatePrivateProfile", R + "CandidateConsent"
APP, INTERVIEW, PLACEMENT, FEE = R + "CandidateApplication", R + "ClientInterview", R + "Placement", R + "RecruitmentFeeMilestone"
DONOR, F_OPP, COMMIT, INST, COLL, STEW = (F + "DonorProfile", F + "FundingOpportunity", F + "FundingCommitment", F + "PledgeInstallment",
                                          F + "DonationCollection", F + "StewardshipActivity")
DOC, REV, KB_CAT, KB_ART, KB_REV = D + "RecordDocument", D + "DocumentRevision", D + "KnowledgeCategory", D + "KnowledgeArticle", D + "KnowledgeRevision"
NOTICE, OUTBOUND, M_CONSENT, SAVED_VIEW = A + "InboxNotice", A + "OutboundMessage", M + "LeadConsentEvent", M + "SavedLeadView"
STATE = os.path.join(ROOT, ".local", "showcase-state.json")
CREDS = os.path.join(ROOT, ".local", "showcase-users.txt")
PEOPLE = {  # login: (display name, group)
    "sara": ("سارة منصور", "sales"), "hany": ("هاني فؤاد", "manager"), "karim": ("كريم حسن", "ops"),
    "mona": ("منى عادل", "cert"), "laila": ("ليلى سمير", "training"), "omar": ("عمر شريف", "recruit"), "nour": ("نور الهدى", "fund"),
}

# Rights on the records the M1 decisions added (D-02, D-03, D-04, D-05). Kept apart so an existing showcase gets them too
# ("grants", run by the Railway bootstrap on every start): fictional people only.
MODULE_GRANTS = {
    "cert": [("c.decision", C + "CertificationDecision", "rd"), ("c.vote", C + "CertificationVote", "rd"),
             ("c.certificate", C + "ClientCertificate", "rd"), ("c.certevent", C + "CertificateEvent", "rd")],
    "training": [("t.certificate", T + "TrainingCertificate", "rw"), ("t.nationalid", T + "TrainingNationalId", "w"),
                 ("t.fee", T + "TrainingFee", "rd"), ("t.refund", T + "TrainingRefund", "rw")],
    "recruit": [("r.offerterms", R + "OfferPrivateTerms", "w"), ("r.feerequest", R + "RecruitmentFeeRequest", "rd")],
    "fund": [("f.receipt", F + "DonationReceipt", "rd"), ("f.restriction", F + "FundRestriction", "rd")],
}
GRANT_RIGHTS = {"rd": dict(canRead=True), "rw": dict(canRead=True, canWrite=True, canCreate=True), "w": dict(canWrite=True, canCreate=True)}
# D-02: the certification manager of the showcase may take decisions (never on a client she audited; the server checks)
DECISION_ROLE, DECISION_PERSON = "ioeti-cert-decision-maker", "mona"


def admin_client():
    client = Client()
    assert client.login(os.environ.get("IOETI_ADMIN_USER", ENV.get("IOETI_ADMIN_USER", "admin")),
                        os.environ.get("IOETI_ADMIN_PASSWORD", ENV.get("IOETI_ADMIN_PASSWORD", "admin"))) == 200
    return client


def obj(body):
    return (body.get("object") if isinstance(body, dict) else None) or {}


def setup(demo_states):
    if os.path.exists(STATE):
        raise SystemExit("showcase already seeded (run teardown first)")
    admin = admin_client()
    created = []
    complete = []

    def save_state():
        os.makedirs(os.path.dirname(STATE), exist_ok=True)
        with open(STATE, "w", encoding="utf-8") as f:
            json.dump({"created": created, "complete": bool(complete)}, f)

    def create(model, values):
        _, body = rest_create(admin, model, values)
        if not ok(body):
            save_state()
            raise SystemExit(f"fixture creation failed for {model.split('.')[-1]}: {json.dumps(body, ensure_ascii=False)[:300]}")
        created.append([model, body["data"][0]["id"]])
        return body["data"][0]

    def track(model, body):
        rid = obj(body).get("id")
        if rid:
            created.append([model, rid])
        return obj(body)

    def search(model, domain, fields=("id",)):
        _, body = admin.call("POST", f"/ws/rest/{model}/search",
                             {"fields": list(fields), "limit": 500, "data": {"_domain": domain, "_archived": True}})
        return body.get("data") or []

    def version(model, rid):
        _, body = admin.call("POST", f"/ws/rest/{model}/{rid}/fetch", {"fields": ["version"]})
        return (body.get("data") or [{}])[0].get("version")

    def must(answer, what):
        status, body = answer
        if status not in (200, 201):
            save_state()
            raise SystemExit(f"{what} failed: {status} {json.dumps(body, ensure_ascii=False)[:300]}")
        return obj(body)

    try:
        # --- master data -------------------------------------------------------------------------------------
        egp = search(CURRENCY, "self.codeISO = 'EGP'")[0]
        co = create(COMPANY, {"name": "IOETI عرض توضيحي", "code": "IOETISC", "currency": {"id": egp["id"]}})
        location = create(STOCK_LOCATION, {"name": "عرض توضيحي", "company": {"id": co["id"]}, "typeSelect": 1})
        create(STOCK_CONFIG, {"company": {"id": co["id"]}, "pickupDefaultStockLocation": {"id": location["id"]}})
        create(ACCOUNT_CONFIG, {"company": {"id": co["id"]}})
        create(SEQUENCE, {"company": {"id": co["id"]}, "name": "Showcase contracts", "codeSelect": "customerContract", "padding": 4,
                          "toBeAdded": 1, "prefixe": "CT-", "sequenceVersionList": [{"startDate": "2026-01-01", "nextNum": 1}]})
        ledger = create(ACCOUNT, {"name": "Showcase services revenue", "code": "SC4100", "company": {"id": co["id"]}, "commonPosition": 0})
        products = [create(PRODUCT, {"name": name, "code": code, "sellable": True, "salePrice": price, "saleCurrency": {"id": egp["id"]},
                                     "productTypeSelect": "service"})
                    for name, code, price in (("يوم مراجعة ISO 9001", "SC-AUDIT-DAY", "4500"), ("إعداد دليل الجودة", "SC-QM", "12000"))]
        for p in products:
            create(ACCOUNT_MANAGEMENT, {"company": {"id": co["id"]}, "product": {"id": p["id"]}, "typeSelect": 1, "saleAccount": {"id": ledger["id"]}})
        lines = {code: (search(LINE, f"self.code = '{code}'") or [None])[0] for code in ("ISO9001", "TRAINING", "RECRUITMENT", "FUNDRAISING")}
        if not all(lines.values()):
            raise SystemExit("standard business lines are missing; run scripts/ioeti.sh install-apps first")
        sources = [create(SOURCE, {"name": n}) for n in ("معرض القاهرة للصناعات الغذائية", "الموقع الإلكتروني", "توصية عميل")]
        campaign = create(CAMPAIGN, {"name": "حملة الجودة في الصناعات الغذائية"})
        team = create(TEAM, {"name": "فريق تنفيذ الأيزو"})

        def perm(name, model, condition=None, **rights):
            return create(PERM, {"name": f"showcase.{name}", "object": model, **rights,
                                 **({"condition": condition, "conditionParams": "__user__"} if condition else {})})

        rw = dict(canRead=True, canWrite=True, canCreate=True)
        rd = dict(canRead=True)
        groups = {
            "sales": [perm("lead", LEAD, "self.user = ?", **rw), perm("event", EVENT, "self.user = ?", **rw), perm("opp", OPP, "self.user = ?", **rw),
                      perm("partner", PARTNER, **rw), perm("so", SALE_ORDER, "self.salespersonUser = ?", **rw),
                      perm("sol", SALE_ORDER_LINE, "self.saleOrder.salespersonUser = ?", **rw, canRemove=True),
                      perm("tt", TIMETABLE, "self.saleOrder.salespersonUser = ?", **rw, canRemove=True),
                      perm("contract", CONTRACT, "self.opportunity.user = ?", **rw), perm("cline", CONTRACT_LINE, canRead=True, canCreate=True),
                      perm("review", REVIEW, "self.requestedBy = ?", **rw), perm("revent", REVIEW_EVENT, "self.review.requestedBy = ?", **rd),
                      perm("ireq", INVOICE_REQUEST, "self.requestedBy = ?", **rw), perm("handover", HANDOVER, "self.requestedBy = ?", **rw),
                      perm("item", ITEM, "self.handover.requestedBy = ?", canRead=True, canWrite=True),
                      perm("hevent", H_EVENT, "self.handover.requestedBy = ?", **rd), perm("req", REQ, **rd), perm("product", PRODUCT, **rd),
                      perm("line", LINE, **rd), perm("source", SOURCE, **rd), perm("campaign", CAMPAIGN, **rd), perm("article", KB_ART, **rd),
                      perm("kbcat", KB_CAT, **rd)],
            "manager": [perm("m.review", REVIEW, canRead=True, canWrite=True), perm("m.revent", REVIEW_EVENT, **rd), perm("m.so", SALE_ORDER, **rd),
                        perm("m.contract", CONTRACT, **rd), perm("m.partner", PARTNER, **rd), perm("m.opp", OPP, **rd), perm("m.lead", LEAD, **rd),
                        perm("m.line", LINE, **rd), perm("m.article", KB_ART, **rw), perm("m.kbcat", KB_CAT, **rw)],
            "ops": [perm("o.handover", HANDOVER, canRead=True, canWrite=True), perm("o.item", ITEM, canRead=True, canWrite=True),
                    perm("o.event", H_EVENT, **rd), perm("o.project", PROJECT, **rw), perm("o.task", TASK, **rw), perm("o.contract", CONTRACT, **rd),
                    perm("o.partner", PARTNER, **rd), perm("o.req", REQ, **rw), perm("o.line", LINE, **rd), perm("o.team", TEAM, **rd)],
            "cert": [perm("c.qual", QUAL, canRead=True, canCreate=True), perm("c.cycle", CYCLE, "self.manager = ?", **rw),
                     perm("c.audit", AUDIT, "self.cycle.manager = ?", **rw), perm("c.nc", NC, "self.audit.cycle.manager = ?", **rw),
                     perm("c.partner", PARTNER, **rd), perm("c.line", LINE, **rd)],
            "training": [perm("t.course", COURSE, canRead=True, canCreate=True), perm("t.cohort", COHORT, "self.coordinator = ?", **rw),
                         perm("t.enrol", ENROLLMENT, "self.cohort.coordinator = ?", **rw), perm("t.session", SESSION, "self.cohort.coordinator = ?", **rw),
                         perm("t.attend", ATTENDANCE, "self.session.cohort.coordinator = ?", **rw), perm("t.partner", PARTNER, **rd)],
            "recruit": [perm("r.order", ORDER, "self.recruiter = ?", **rw), perm("r.cand", CAND, "self.owner = ?", **rw),
                        perm("r.priv", PRIV, "self.candidate.owner = ?", **rw), perm("r.consent", CONSENT, "self.candidate.owner = ?", **rw),
                        perm("r.app", APP, "self.jobOrder.recruiter = ?", **rw), perm("r.interview", INTERVIEW, "self.application.jobOrder.recruiter = ?", **rw),
                        perm("r.placement", PLACEMENT, "self.application.jobOrder.recruiter = ?", **rw), perm("r.partner", PARTNER, **rd)],
            "fund": [perm(f"f.{m.split('.')[-1].lower()}", m, cond, **rw) for m, cond in (
                (DONOR, "self.relationshipManager = ?"), (F_OPP, "self.donor.relationshipManager = ?"),
                (COMMIT, "self.opportunity.donor.relationshipManager = ?"), (INST, "self.commitment.opportunity.donor.relationshipManager = ?"),
                (COLL, "self.installment.commitment.opportunity.donor.relationshipManager = ?"), (STEW, "self.donor.relationshipManager = ?"))]
                    + [perm("f.partner", PARTNER, **rd), perm("f.campaign", CAMPAIGN, **rd)],
        }
        group_rows = {k: create(GROUP, {"code": f"showcase-{k}", "name": f"Showcase {k}", "permissions": [{"id": p["id"]} for p in v]})
                      for k, v in groups.items()}
        users, sessions, creds = {}, {}, []
        for login, (name, group) in PEOPLE.items():
            # a shared password set by the operator (IOETI_SHOWCASE_PASSWORD), or a random one per person
            password = os.environ.get("IOETI_SHOWCASE_PASSWORD") or "Sc!" + secrets.token_urlsafe(12)
            users[login] = create(USER, {"code": f"showcase.{login}", "name": name, "blocked": False, "language": "ar",
                                         "group": {"id": group_rows[group]["id"]}, "activeCompany": {"id": co["id"]},
                                         "ioetiBusinessLines": [{"id": l["id"]} for l in lines.values()],
                                         "password": axelor_password_hash(password)})
            sessions[login] = Client()
            assert sessions[login].login(f"showcase.{login}", password) == 200, login
            creds.append(f"showcase.{login}\t{password}\t{name}\t{group}")
        os.makedirs(os.path.dirname(CREDS), exist_ok=True)
        with open(CREDS, "w", encoding="utf-8") as f:
            f.write("login\tpassword\tname\trole (fictional showcase users)\n" + "\n".join(creds) + "\n")
        os.chmod(CREDS, 0o600)
        sara, hany, karim, mona, laila, omar, nour = (sessions[k] for k in PEOPLE)
        save_state()

        # --- sales -------------------------------------------------------------------------------------------
        leads = []
        for i, (first, last, org, line_code, src) in enumerate((
                ("أحمد", "عبد الله", "شركة النيل للأغذية", "ISO9001", 0), ("مريم", "حسن", "مصنع الدلتا للألبان", "ISO9001", 0),
                ("يوسف", "إبراهيم", "فندق البحر الأحمر", "TRAINING", 1), ("هدى", "مصطفى", "مستشفى الشفاء التخصصي", "ISO9001", 2),
                ("عمر", "السيد", "مجموعة الأهرام للمقاولات", "RECRUITMENT", 1), ("سارة", "علي", "مؤسسة الأمل الخيرية", "FUNDRAISING", 2),
                ("كريم", "منصور", "مطاحن الصعيد", "ISO9001", 0), ("نادين", "شريف", "أكاديمية المستقبل", "TRAINING", 1))):
            lead = must(sara.call("POST", "/ws/ioeti/marketing/leads", {
                "firstName": first, "name": last, "organization": org, "email": f"contact{i + 1}@showcase.example",
                "phone": f"+20 10{i + 1:02d} 555 01{i:02d}", "businessLineCode": line_code, "sourceId": sources[src]["id"],
                "campaignId": campaign["id"] if line_code == "ISO9001" else None}), "lead intake")
            created.append([LEAD, lead["id"]])
            leads.append(lead)
        when = (date.today() + timedelta(days=1)).isoformat() + "T10:00:00"
        late = (date.today() - timedelta(days=2)).isoformat() + "T11:00:00"
        for lead, at, subject in ((leads[1], when, "مكالمة لتحديد موعد زيارة المصنع"), (leads[3], late, "إرسال عرض الأسعار المبدئي")):
            sara.call("POST", f"/ws/ioeti/marketing/leads/{lead['id']}/follow-ups",
                      {"version": version(LEAD, lead["id"]), "type": "CALL", "subject": subject, "at": at})
        conv = must(sara.call("POST", f"/ws/ioeti/leads/{leads[0]['id']}/convert", {"version": version(LEAD, leads[0]["id"])}), "conversion")
        for model, key in ((PARTNER, "accountId"), (PARTNER, "contactId"), (OPP, "opportunityId")):
            created.append([model, conv[key]])
        account_id, opp_id = conv["accountId"], conv["opportunityId"]
        quote = must(sara.call("POST", "/ws/ioeti/quotes", {"opportunityId": opp_id, "opportunityVersion": version(OPP, opp_id)}), "quotation")
        created.append([SALE_ORDER, quote["id"]])
        for product, qty in ((products[0], "4"), (products[1], "1")):
            must(sara.call("POST", f"/ws/ioeti/quotes/{quote['id']}/lines", {"version": version(SALE_ORDER, quote["id"]),
                                                                            "productId": product["id"], "quantity": qty}), "quote line")
        sara.call("POST", f"/ws/ioeti/quotes/{quote['id']}/versions", {"version": version(SALE_ORDER, quote["id"])})
        for title, pct, due in (("دفعة مقدمة عند التعاقد", "30", 15), ("بعد مراجعة المرحلة الأولى", "40", 60), ("عند إصدار التقرير النهائي", "30", 120)):
            must(sara.call("POST", f"/ws/ioeti/quotes/{quote['id']}/milestones", {"version": version(SALE_ORDER, quote["id"]), "title": title,
                                                                                 "percentage": pct, "dueDate": (date.today() + timedelta(days=due)).isoformat()}), "milestone")
        review = must(sara.call("POST", "/ws/ioeti/workspace/reviews", {"quoteId": quote["id"], "version": version(SALE_ORDER, quote["id"])}), "review")
        hany.call("POST", f"/ws/ioeti/workspace/reviews/{review['id']}/changes", {"version": version(REVIEW, review["id"]), "reason": "PRICING"})
        # revised after the reviewer's note and sent again: one review stays pending in the reviewer's queue
        must(sara.call("POST", f"/ws/ioeti/quotes/{quote['id']}/lines", {"version": version(SALE_ORDER, quote["id"]),
                                                                        "productId": products[0]["id"], "quantity": "1"}), "quote line")
        sara.call("POST", "/ws/ioeti/workspace/reviews", {"quoteId": quote["id"], "version": version(SALE_ORDER, quote["id"])})
        contract = must(sara.call("POST", "/ws/ioeti/contracts", {"opportunityId": opp_id, "opportunityVersion": version(OPP, opp_id),
                                                                 "contractType": "BILLING"}), "contract")
        sara.call("POST", f"/ws/ioeti/contracts/{contract['id']}/lines-from-quote", {"version": version(CONTRACT, contract["id"]), "quoteId": quote["id"]})
        sara.call("POST", "/ws/ioeti/automation/mentions", {"recipientId": users["hany"]["id"], "subject": "OPPORTUNITY", "subjectId": opp_id,
                                                             "message": "راجعت التسعير بعد ملاحظاتك، أرجو المراجعة مرة أخرى."})
        hany.call("POST", "/ws/ioeti/automation/mentions", {"recipientId": users["sara"]["id"], "subject": "LEAD", "subjectId": leads[1]["id"],
                                                             "message": "مصنع الدلتا مهتم بزيارة قبل نهاية الشهر."})
        for title, seq in (("نسخة العقد الموقعة", 10), ("خطة المراجعة المعتمدة من العميل", 20), ("بيانات مسؤول الجودة لدى العميل", 30)):
            body = obj(karim.call("POST", "/ws/ioeti/operations/requirements", {"businessLineCode": "ISO9001", "title": title,
                                                                               "mandatory": seq < 30, "sequence": seq})[1])
            if body.get("id"):
                created.append([REQ, body["id"]])
        if demo_states:
            from db_migrate import DATABASE, psql
            # DEMONSTRATION ONLY: these states are policy-blocked in the product (D-11 signature, D-06 confirmation)
            psql(DATABASE, f"UPDATE contract_contract SET status_select = 2 WHERE id = {int(contract['id'])};")
            psql(DATABASE, f"UPDATE sale_sale_order SET status_select = 3 WHERE id = {int(quote['id'])};")
            first = (search(TIMETABLE, f"self.saleOrder.id = {int(quote['id'])}", ("title",)) or [{}])[0]
            sara.call("POST", "/ws/ioeti/workspace/invoice-requests", {"milestoneId": first.get("id"), "quoteVersion": version(SALE_ORDER, quote["id"])})
            ho = obj(sara.call("POST", "/ws/ioeti/operations/handovers", {"contractId": contract["id"]})[1])
            if ho.get("id"):
                items = obj(karim.call("GET", f"/ws/ioeti/operations/handovers/{ho['id']}")[1]).get("items") or []
                for item in items[:1]:
                    sara.call("POST", f"/ws/ioeti/operations/items/{item['id']}/complete", {"version": version(ITEM, item["id"]), "evidenceReference": "DOC-عقد-موقع"})

        # --- training ----------------------------------------------------------------------------------------
        course = must(laila.call("POST", "/ws/ioeti/training/courses", {"code": "ia-9001", "name": "Internal auditor ISO 9001",
                                                                        "nameAr": "المراجع الداخلي لنظام الأيزو 9001", "durationHours": 16}), "course")
        created.append([COURSE, course["id"]])
        cohort = must(laila.call("POST", "/ws/ioeti/training/cohorts", {"courseId": course["id"], "code": "ia-cai-11", "capacity": 4, "minSeats": 2,
                                                                        "location": "القاهرة · مدينة نصر",
                                                                        "startDate": (date.today() + timedelta(days=10)).isoformat(),
                                                                        "endDate": (date.today() + timedelta(days=11)).isoformat()}), "cohort")
        created.append([COHORT, cohort["id"]])
        laila.call("POST", f"/ws/ioeti/training/cohorts/{cohort['id']}/open", {"version": version(COHORT, cohort["id"])})
        trainees = [create(PARTNER, {"firstName": first, "name": last, "partnerTypeSelect": 2}) for first, last in (
            ("محمود", "طارق"), ("رانيا", "فهمي"), ("خالد", "نبيل"), ("دينا", "سامي"), ("أيمن", "رشاد"), ("سلمى", "جمال"))]
        enrolments = []
        for trainee in trainees:
            e = obj(laila.call("POST", f"/ws/ioeti/training/cohorts/{cohort['id']}/enrollments",
                               {"version": version(COHORT, cohort["id"]), "traineeId": trainee["id"], "clientId": account_id})[1])
            if e.get("id"):
                created.append([ENROLLMENT, e["id"]])
                enrolments.append(e)
        day1 = obj(laila.call("POST", f"/ws/ioeti/training/cohorts/{cohort['id']}/sessions",
                              {"version": version(COHORT, cohort["id"]), "title": "اليوم الأول: متطلبات المواصفة",
                               "startsAt": (date.today() + timedelta(days=10)).isoformat() + "T09:00", "durationMinutes": 360})[1])
        if day1.get("id"):
            created.append([SESSION, day1["id"]])
            for e, status in zip(enrolments[:4], ("PRESENT", "PRESENT", "LATE", "ABSENT")):
                a = obj(laila.call("POST", f"/ws/ioeti/training/sessions/{day1['id']}/attendance",
                                   {"version": version(SESSION, day1["id"]), "enrollmentId": e["id"], "status": status})[1])
                if a.get("id"):
                    created.append([ATTENDANCE, a["id"]])

        # --- certification -----------------------------------------------------------------------------------
        q = obj(mona.call("POST", "/ws/ioeti/certification/qualifications", {"auditorId": users["mona"]["id"], "standardCode": "ISO9001",
                                                                             "validFrom": "2026-01-01", "validUntil": "2027-12-31",
                                                                             "evidenceReference": "IRCA-شهادة-مراجع-رئيسي"})[1])
        if q.get("id"):
            created.append([QUAL, q["id"]])
        cycle = must(mona.call("POST", "/ws/ioeti/certification/cycles", {"reference": "nile-9001-2026", "clientId": account_id, "standardCode": "ISO9001",
                                                                          "scope": "تصنيع وتعبئة المنتجات الغذائية المجففة", "siteCount": 2}), "cycle")
        created.append([CYCLE, cycle["id"]])
        stage1 = obj(mona.call("POST", f"/ws/ioeti/certification/cycles/{cycle['id']}/audits",
                               {"version": version(CYCLE, cycle["id"]), "type": "STAGE1", "auditorId": users["mona"]["id"],
                                "plannedDate": (date.today() + timedelta(days=5)).isoformat()})[1])
        if stage1.get("id"):
            created.append([AUDIT, stage1["id"]])
            mona.call("POST", f"/ws/ioeti/certification/audits/{stage1['id']}/complete", {"version": version(AUDIT, stage1["id"]),
                                                                                          "completedOn": (date.today() + timedelta(days=5)).isoformat()})
            finding = obj(mona.call("POST", f"/ws/ioeti/certification/audits/{stage1['id']}/nonconformities",
                                    {"version": version(AUDIT, stage1["id"]), "grade": "MINOR", "clause": "7.5.3",
                                     "statement": "سجلات معايرة أجهزة القياس غير مكتملة لخط التعبئة الثاني."})[1])
            if finding.get("id"):
                created.append([NC, finding["id"]])
        stage2 = obj(mona.call("POST", f"/ws/ioeti/certification/cycles/{cycle['id']}/audits",
                               {"version": version(CYCLE, cycle["id"]), "type": "STAGE2", "auditorId": users["mona"]["id"],
                                "plannedDate": (date.today() + timedelta(days=40)).isoformat()})[1])
        if stage2.get("id"):
            created.append([AUDIT, stage2["id"]])

        # --- recruitment -------------------------------------------------------------------------------------
        order = must(omar.call("POST", "/ws/ioeti/recruitment/job-orders", {"reference": "jo-qm-2026", "clientId": account_id, "headcount": 1,
                                                                            "title": "مدير جودة لمصنع أغذية", "location": "العاشر من رمضان"}), "job order")
        created.append([ORDER, order["id"]])
        for i, (cand_name, stage) in enumerate((("أحمد فتحي", "SHORTLISTED"), ("منة الله سعيد", "SCREENED"), ("طارق عبد العزيز", "SOURCED"))):
            cand = obj(omar.call("POST", "/ws/ioeti/recruitment/candidates", {"displayName": cand_name, "headline": "خبرة في أنظمة الجودة والسلامة الغذائية",
                                                                              "yearsExperience": 8 - i * 2})[1])
            if not cand.get("id"):
                continue
            created.append([CAND, cand["id"]])
            app = obj(omar.call("POST", f"/ws/ioeti/recruitment/job-orders/{order['id']}/applications",
                                {"version": version(ORDER, order["id"]), "candidateId": cand["id"]})[1])
            if not app.get("id"):
                continue
            created.append([APP, app["id"]])
            for step in ("SCREENED", "SHORTLISTED"):
                if stage == "SOURCED" or (stage == "SCREENED" and step == "SHORTLISTED"):
                    break
                omar.call("POST", f"/ws/ioeti/recruitment/applications/{app['id']}/stage", {"version": version(APP, app["id"]), "stage": step})
            if i == 0:
                c = obj(omar.call("POST", f"/ws/ioeti/recruitment/candidates/{cand['id']}/consents",
                                  {"version": version(CAND, cand["id"]), "jobOrderId": order["id"], "method": "WRITTEN",
                                   "givenOn": date.today().isoformat(), "evidenceReference": "موافقة-موقعة"})[1])
                if c.get("id"):
                    created.append([CONSENT, c["id"]])
                omar.call("POST", f"/ws/ioeti/recruitment/applications/{app['id']}/submit", {"version": version(APP, app["id"])})
                iv = obj(omar.call("POST", f"/ws/ioeti/recruitment/applications/{app['id']}/interviews",
                                   {"version": version(APP, app["id"]), "round": 1,
                                    "scheduledAt": (date.today() + timedelta(days=3)).isoformat() + "T11:00"})[1])
                if iv.get("id"):
                    created.append([INTERVIEW, iv["id"]])

        # --- fundraising -------------------------------------------------------------------------------------
        foundation = create(PARTNER, {"name": "مؤسسة الخير للتنمية", "isProspect": True, "partnerTypeSelect": 1})
        donor = must(nour.call("POST", "/ws/ioeti/fundraising/donors", {"partnerId": foundation["id"], "donorType": "FOUNDATION"}), "donor")
        created.append([DONOR, donor["id"]])
        grant = must(nour.call("POST", "/ws/ioeti/fundraising/opportunities", {"reference": "gr-stem-2026", "donorId": donor["id"],
                                                                               "title": "منح لتدريب الفتيات على أنظمة الجودة", "purpose": "منح تدريبية",
                                                                               "kind": "GRANT", "proposedAmount": "600000.00", "currencyCode": "EGP",
                                                                               "campaignId": campaign["id"]}), "grant")
        created.append([F_OPP, grant["id"]])
        for stage in ("PROPOSAL", "SUBMITTED"):
            nour.call("POST", f"/ws/ioeti/fundraising/opportunities/{grant['id']}/stage", {"version": version(F_OPP, grant["id"]), "stage": stage})
        commitment = obj(nour.call("POST", f"/ws/ioeti/fundraising/opportunities/{grant['id']}/approve", {
            "version": version(F_OPP, grant["id"]), "committedAmount": "450000.00", "approvedOn": date.today().isoformat(),
            "periodEnd": (date.today() + timedelta(days=365)).isoformat(), "restricted": True,
            "restrictionPurpose": "منح تدريب الفتيات فقط", "agreementReference": "AGR-الخير-2026"})[1])
        if commitment.get("id"):
            created.append([COMMIT, commitment["id"]])
            installments = []
            for days, amount in ((20, "150000"), (140, "150000"), (260, "150000")):
                inst = obj(nour.call("POST", f"/ws/ioeti/fundraising/commitments/{commitment['id']}/installments",
                                     {"version": version(COMMIT, commitment["id"]), "dueDate": (date.today() + timedelta(days=days)).isoformat(),
                                      "amount": amount})[1])
                if inst.get("id"):
                    created.append([INST, inst["id"]])
                    installments.append(inst)
            if installments:
                col = obj(nour.call("POST", f"/ws/ioeti/fundraising/installments/{installments[0]['id']}/collections",
                                    {"version": version(INST, installments[0]["id"]), "amount": "100000", "receivedOn": date.today().isoformat(),
                                     "bankReference": "SHOWCASE-NBE-0001"})[1])
                if col.get("id"):
                    created.append([COLL, col["id"]])
        nour.call("POST", f"/ws/ioeti/fundraising/donors/{donor['id']}/stewardship",
                  {"version": version(DONOR, donor["id"]), "type": "MEETING", "summary": "اجتماع متابعة مع مجلس الأمناء", "occurredOn": date.today().isoformat()})

        # --- knowledge ---------------------------------------------------------------------------------------
        cat = obj(hany.call("POST", "/ws/ioeti/content/kb/categories", {"code": "proc", "nameEn": "Procedures", "nameAr": "الإجراءات"})[1])
        if cat.get("id"):
            created.append([KB_CAT, cat["id"]])
        for title_ar, title_en, body_ar in (("التحضير ليوم المراجعة", "Preparing for the audit day", "راجع دليل الجودة، وجهّز سجلات المعايرة، وأكّد حضور مسؤول الجودة."),
                                            ("من العميل المحتمل إلى العقد", "From lead to contract", "سجّل العميل المحتمل، أهّله، حوّله، ثم جهّز العرض والعقد واطلب المراجعة.")):
            art = obj(hany.call("POST", "/ws/ioeti/content/kb/articles", {"titleAr": title_ar, "titleEn": title_en, "bodyAr": body_ar, "bodyEn": title_en + ".",
                                                                          "categoryId": cat.get("id"), "businessLineCode": "ISO9001"})[1])
            if art.get("id"):
                created.append([KB_ART, art["id"]])
                hany.call("POST", f"/ws/ioeti/content/kb/articles/{art['id']}/publish", {"version": art.get("version")})
        complete.append(True)
        save_state()
        print(f"SHOWCASE_SETUP=PASS records={len(created)} users={len(PEOPLE)} credentials={os.path.relpath(CREDS, ROOT)}"
              + (" demo-states=on" if demo_states else ""))
    finally:
        save_state()


def teardown():
    if not os.path.exists(STATE):
        print("nothing to remove")
        return 0
    admin = admin_client()
    created = [tuple(c) for c in json.load(open(STATE, encoding="utf-8"))["created"]]

    def search(model, domain, fields=("id",)):
        _, body = admin.call("POST", f"/ws/rest/{model}/search",
                             {"fields": list(fields), "limit": 500, "data": {"_domain": domain, "_archived": True}})
        return body.get("data") or []

    def add(model, domain):
        for row in search(model, domain):
            if (model, row["id"]) not in created:
                created.append((model, row["id"]))

    uids = [rid for m, rid in created if m == USER]
    users = ",".join(map(str, uids)) or "0"
    opp_ids = ",".join(str(r) for m, r in created if m == OPP) or "0"
    quotes = ",".join(str(r["id"]) for r in search(SALE_ORDER, f"self.opportunity.id in ({opp_ids})")) or "0"
    contracts = [r["id"] for r in search(CONTRACT, f"self.opportunity.id in ({opp_ids})")]
    cids = ",".join(map(str, contracts)) or "0"
    handovers = ",".join(str(r["id"]) for r in search(HANDOVER, f"self.contract.id in ({cids})")) or "0"
    if handovers != "0":
        from db_migrate import DATABASE, psql
        psql(DATABASE, f"UPDATE ioeti_ops_handover SET engagement = NULL WHERE id IN ({handovers});")
    for model, domain in (
            (INVOICE_REQUEST, f"self.quote.id in ({quotes})"), (REVIEW_EVENT, f"self.review.quote.id in ({quotes}) OR self.review.contract.id in ({cids})"),
            (REVIEW, f"self.quote.id in ({quotes}) OR self.contract.id in ({cids})"), (TIMETABLE, f"self.saleOrder.id in ({quotes})"),
            (SALE_ORDER_LINE, f"self.saleOrder.id in ({quotes}) OR self.oldVersionSaleOrder.id in ({quotes})"), (SALE_ORDER, f"self.id in ({quotes})"),
            (TASK, f"self.project.ioetiHandover.id in ({handovers})"), (PROJECT, f"self.ioetiHandover.id in ({handovers})"),
            (H_EVENT, f"self.handover.id in ({handovers})"), (ITEM, f"self.handover.id in ({handovers})"), (HANDOVER, f"self.id in ({handovers})"),
            (EVENT, f"self.user.id in ({users})"), (M_CONSENT, f"self.createdBy.id in ({users})"), (SAVED_VIEW, f"self.owner.id in ({users})"),
            (NOTICE, f"self.recipient.id in ({users}) OR self.actor.id in ({users})"), (OUTBOUND, f"self.author.id in ({users})"),
            (ATTENDANCE, f"self.createdBy.id in ({users})"), (SESSION, f"self.createdBy.id in ({users})"), (ENROLLMENT, f"self.createdBy.id in ({users})"),
            (NC, f"self.createdBy.id in ({users})"), (AUDIT, f"self.createdBy.id in ({users})"), (INTERVIEW, f"self.createdBy.id in ({users})"),
            (CONSENT, f"self.createdBy.id in ({users})"), (APP, f"self.createdBy.id in ({users})"), (PLACEMENT, f"self.createdBy.id in ({users})"),
            (PRIV, f"self.createdBy.id in ({users})"), (COLL, f"self.createdBy.id in ({users})"), (INST, f"self.createdBy.id in ({users})"),
            (STEW, f"self.createdBy.id in ({users})"), (COMMIT, f"self.createdBy.id in ({users})"), (KB_REV, f"self.createdBy.id in ({users})"),
            (REV, f"self.createdBy.id in ({users})"), (DOC, f"self.createdBy.id in ({users})"), (META_FILE, f"self.createdBy.id in ({users})"),
            (PARTNER, f"self.createdBy.id in ({users})"), (EMAIL_ADDRESS, f"self.createdBy.id in ({users})"), (LEAD, f"self.user.id in ({users})")):
        add(model, domain)
    partners = ",".join(str(r) for m, r in created if m == PARTNER) or "0"
    add(ACCOUNTING_SITUATION, f"self.partner.id in ({partners})")  # created by Axelor for partners
    for model, rid in list(created):
        if model == PARTNER:
            _, body = admin.call("POST", f"/ws/rest/{PARTNER}/{rid}/fetch", {"fields": ["contactPartnerSet", "mainPartner"]})
            row = (body.get("data") or [{}])[0] if ok(body) else {}
            if row.get("contactPartnerSet") or row.get("mainPartner"):
                admin.call("POST", f"/ws/rest/{PARTNER}/{rid}", {"data": {"id": rid, "version": row.get("version"), "contactPartnerSet": [], "mainPartner": None}})
        if model == KB_ART:
            from db_migrate import DATABASE, psql
            psql(DATABASE, f"UPDATE ioeti_kb_article SET published_revision = NULL WHERE id = {int(rid)};")
    order = {INVOICE_REQUEST: 0, REVIEW_EVENT: 0, TASK: 0, ATTENDANCE: 0, NC: 0, INTERVIEW: 0, COLL: 0, STEW: 0, KB_REV: 0, REV: 0, NOTICE: 0,
             OUTBOUND: 0, EVENT: 0, M_CONSENT: 0, SAVED_VIEW: 0, PLACEMENT: 0,
             REVIEW: 1, TIMETABLE: 1, SALE_ORDER_LINE: 1, PROJECT: 1, H_EVENT: 1, ITEM: 1, SESSION: 1, ENROLLMENT: 1, AUDIT: 1, CONSENT: 1,
             APP: 1, PRIV: 1, INST: 1, DOC: 1, KB_ART: 1,
             SALE_ORDER: 2, HANDOVER: 2, COHORT: 2, CYCLE: 2, ORDER: 2, CAND: 2, COMMIT: 2, KB_CAT: 2, QUAL: 2, META_FILE: 2,
             REQ: 3, COURSE: 3, F_OPP: 3, OPP: 4, CAMPAIGN: 4, LEAD: 5, DONOR: 5, ACCOUNT_MANAGEMENT: 5,
             ACCOUNTING_SITUATION: 5, PRODUCT: 6, PARTNER: 6, EMAIL_ADDRESS: 7, SOURCE: 7, TEAM: 7, ACCOUNT: 7, ACCOUNT_CONFIG: 8, STOCK_CONFIG: 8,
             STOCK_LOCATION: 9, SEQUENCE_VERSION: 9, SEQUENCE: 9, USER: 10, GROUP: 11, PERM: 12, COMPANY: 13}
    complete, leftovers = False, []
    cleanup(admin, [(m, r) for m, r in created if order.get(m, 99) <= 3], order)
    for cid in contracts:
        delete_contract(admin, cid)
    for model, rid in list(created):
        if model == SEQUENCE:
            _delete_where(admin, RESERVED_SEQUENCE, f"self.sequenceVersion.sequence.id = {rid}")
            add(SEQUENCE_VERSION, f"self.sequence.id = {rid}")
    complete, leftovers = cleanup(admin, created, order)
    if complete:
        os.remove(STATE)
        if os.path.exists(CREDS):
            os.remove(CREDS)
    print("SHOWCASE_TEARDOWN=PASS" if complete else f"SHOWCASE_TEARDOWN=FAIL leftovers: {leftovers}")
    return 0 if complete else 1


def grants():
    """Adds the M1 rights (and the decision role) to an existing, complete showcase; idempotent. Anything it creates is
    recorded in the state file, so teardown removes it."""
    if not os.path.exists(STATE):
        print("SHOWCASE_GRANTS=SKIP no showcase")
        return 0
    with open(STATE, encoding="utf-8") as f:
        state = json.load(f)
    if not state.get("complete"):
        print("SHOWCASE_GRANTS=SKIP showcase incomplete")
        return 0
    admin = admin_client()

    def search(model, domain, fields=("id",)):
        _, body = admin.call("POST", f"/ws/rest/{model}/search", {"fields": list(fields), "data": {"_domain": domain}})
        return body.get("data") or []

    def create(model, values):
        _, body = rest_create(admin, model, values)
        if not ok(body):
            raise SystemExit(f"SHOWCASE_GRANTS=FAIL creating {model.split('.')[-1]}: {json.dumps(body, ensure_ascii=False)[:300]}")
        state["created"].append([model, body["data"][0]["id"]])
        return body["data"][0]

    def link(model, rid, field, ids):
        _, cur = admin.call("POST", f"/ws/rest/{model}/{rid}/fetch", {"fields": ["version", field]})
        row = (cur.get("data") or [{}])[0]
        have = {x["id"] for x in row.get(field) or []}
        if set(ids) <= have:
            return 0
        _, body = admin.call("POST", f"/ws/rest/{model}/{rid}", {"data": {"id": rid, "version": row.get("version"),
                                                                          field: [{"id": x} for x in sorted(have | set(ids))]}})
        if not ok(body):
            raise SystemExit(f"SHOWCASE_GRANTS=FAIL updating {model.split('.')[-1]}: {json.dumps(body, ensure_ascii=False)[:300]}")
        return len(set(ids) - have)

    added = 0
    try:
        for group, rows in MODULE_GRANTS.items():
            found = search(GROUP, f"self.code = 'showcase-{group}'")
            if not found:
                continue
            ids = []
            for name, model, rights in rows:
                existing = search(PERM, f"self.name = 'showcase.{name}'")
                ids.append(existing[0]["id"] if existing else create(PERM, {"name": f"showcase.{name}", "object": model, **GRANT_RIGHTS[rights]})["id"])
            added += link(GROUP, found[0]["id"], "permissions", ids)
        person = search(USER, f"self.code = 'showcase.{DECISION_PERSON}'")
        if person:
            role = search(ROLE, f"self.name = '{DECISION_ROLE}'")
            role_id = role[0]["id"] if role else create(ROLE, {"name": DECISION_ROLE})["id"]
            added += link(USER, person[0]["id"], "roles", [role_id])
    finally:
        with open(STATE, "w", encoding="utf-8") as f:
            json.dump(state, f)
    print(f"SHOWCASE_GRANTS=PASS added={added}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in ("setup", "teardown", "grants"):
        raise SystemExit("usage: showcase_seed.py setup [--demo-states] | grants | teardown")
    if sys.argv[1] == "grants":
        sys.exit(grants())
    sys.exit(setup("--demo-states" in sys.argv) or 0 if sys.argv[1] == "setup" else teardown())
