import { useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, Layers3, LockKeyhole, Search, ShieldAlert, Workflow } from "lucide-react";
import type { Language } from "./preferences";

type Capability = {
  id: string; ar: string; en: string; entity: string; upstream: string;
  stage: "native" | "extended" | "new";
  summaryAr: string; summaryEn: string; gapAr: string; gapEn: string;
  pagesAr: string[]; pagesEn: string[];
};
/** Audited against docs/MODULE_REUSE_MATRIX.md — not a claim that every UI page is connected. */
const capabilities: Capability[] = [
  { id:"leads",ar:"العملاء المحتملون",en:"Leads",entity:"Lead · LeadStatus · LostReason",upstream:"axelor-crm",
    stage:"native",summaryAr:"تسجيل العملاء المحتملين وتحويلهم لجهات اتصال وفرص",summaryEn:"Capture and convert leads to partners and opportunities",
    gapAr:"مطلوب حقول النشاط والقنوات، قواعد التأهيل والتوزيع وSLA",gapEn:"IOETI fields, qualification gates, assignment and SLA still require work",
    pagesAr:["صندوق الوارد","تفاصيل العميل المحتمل","مسار التأهيل","الأنشطة"],pagesEn:["Lead inbox","Lead profile","Qualification","Activity timeline"]},
  { id:"accounts",ar:"حسابات العملاء",en:"Accounts & Contacts",entity:"Partner · PartnerLink",upstream:"axelor-base",
    stage:"native",summaryAr:"الشركات وجهات الاتصال وروابط العلاقات",summaryEn:"Company/customer master data and contact relationships",
    gapAr:"مطلوب Account 360 خاص بـIOETI وسجل الفروع والشهادات",gapEn:"IOETI account 360, locations and held certificates required",
    pagesAr:["دليل الحسابات","تفاصيل الحساب 360","جهات الاتصال","سجل العلاقات"],pagesEn:["Account directory","Account 360","Contacts","Relationships"]},
  { id:"quotes",ar:"عروض الأسعار",en:"Quotations",entity:"SaleOrder · SaleOrderVersion",upstream:"axelor-sale",
    stage:"native",summaryAr:"نسخ عروض الأسعار واحتساب الأسعار والخصومات",summaryEn:"Quotation drafts, versions, pricing and discounts",
    gapAr:"موافقات الخصم وقوالب PDF عربية وحزم عروض مخصصة",gapEn:"Discount approvals, Arabic PDF and IOETI quote variants",
    pagesAr:["قائمة العروض","محرر العرض","الموافقات","التصدير"],pagesEn:["Quote index","Quote editor","Approvals","Export"]},
  { id:"catalog",ar:"كتالوج الخدمات",en:"Services & Pricing",entity:"Product · PriceList · Pricing · Pack",upstream:"axelor-base / axelor-sale",
    stage:"native",summaryAr:"خدمات وأسعار وخصومات وباقات متعددة",summaryEn:"Services, price books, rules, and bundles",
    gapAr:"ربط الخدمات بخطوط الأعمال وتسعير أيام التدقيق والفروع",gapEn:"Business-line association and ISO audit-day pricing",
    pagesAr:["دليل الخدمات","قوائم الأسعار","قواعد التسعير","الباقات"],pagesEn:["Services","Price lists","Pricing rules","Bundles"]},
  { id:"contracts",ar:"العقود والاتفاقيات",en:"Contracts & MOUs",entity:"Contract · ContractVersion · ContractTemplate",upstream:"axelor-contract",
    stage:"native",summaryAr:"قوالب عقود وإصدارات وتجديد وإنهاء",summaryEn:"Contract templates, versioning, renewal and termination",
    gapAr:"مراحل Legal Review والتوقيع وشروط ضمان التوظيف",gapEn:"Legal review, signature gates and recruitment guarantees",
    pagesAr:["سجل العقود","التفاصيل والإصدارات","دورة الاعتماد","التجديد"],pagesEn:["Contract register","Versions","Approvals","Renewal"]},
  { id:"finance",ar:"الفواتير والتحصيل",en:"Invoices & Collections",entity:"Invoice · InvoicePayment · Timetable · DebtRecovery",upstream:"axelor-account / axelor-supplychain",
    stage:"native",summaryAr:"الفواتير والمدفوعات الجزئية وجداول الاستحقاق",summaryEn:"Invoice, partial payment, milestones, aged receivables",
    gapAr:"مراحل دفع مرتبطة بالتدقيق والتدريب والتوظيف والتكامل الضريبي",gapEn:"Event-driven milestones and Egypt e-invoice integration",
    pagesAr:["الفواتير","الدفعات","الاستحقاقات","التحصيل"],pagesEn:["Invoices","Payments","Milestones","Collections"]},
  { id:"projects",ar:"المشروعات والتسليم",en:"Projects & Handover",entity:"Project · ProjectTask · ProjectTemplate",upstream:"axelor-project",
    stage:"native",summaryAr:"المشروعات والقوالب والمهام التشغيلية",summaryEn:"Project workflows, templates and operational tasks",
    gapAr:"سجل Handover يربط الصفقة الموقعة بخطة التنفيذ",gapEn:"IOETI sales-to-operations handover entity",
    pagesAr:["المشروعات","المهام","قوالب التسليم","حالة التنفيذ"],pagesEn:["Projects","Tasks","Handover templates","Delivery"]},
  { id:"visits",ar:"الزيارات الميدانية",en:"Field Visits",entity:"Intervention · InterventionRange · InterventionQuestion",upstream:"axelor-intervention",
    stage:"native",summaryAr:"جدولة زيارات وقوائم تحقق بصور وتوقيع",summaryEn:"Visit scheduling, checklists, evidence and signatures",
    gapAr:"ربط الزيارات بدورة شهادة ISO ومراجعة حياد المدقق",gapEn:"Certification cycle link and auditor impartiality controls",
    pagesAr:["جدول الزيارات","تفاصيل الزيارة","قائمة التحقق","الأدلة"],pagesEn:["Visit planner","Visit detail","Checklist","Evidence"]},
  { id:"quality",ar:"الجودة والإجراءات التصحيحية",en:"Quality & CAPA",entity:"QualityImprovement · QIAction · QIResolution",upstream:"axelor-quality",
    stage:"native",summaryAr:"تحليل المخالفات والإجراءات والتحسين",summaryEn:"Nonconformity analysis, corrective actions and resolution",
    gapAr:"تصنيف المخالفات major/minor وربطها بقرارات إصدار الشهادات",gapEn:"Major/minor NC and client certification decisions",
    pagesAr:["سجل المخالفات","التحقيق والتحليل","خطة CAPA","الإغلاق"],pagesEn:["Findings","Analysis","CAPA plan","Closure"]},
  { id:"marketing",ar:"التسويق والحملات",en:"Marketing",entity:"Campaign · TargetList",upstream:"axelor-marketing",
    stage:"native",summaryAr:"الحملات والقوائم المستهدفة",summaryEn:"Campaigns, targeting lists and interactions",
    gapAr:"الإسناد التسويقي وROI وقنوات الواتساب والإعلانات",gapEn:"Attribution, campaign ROI, messaging and ad sources",
    pagesAr:["الحملات","القوائم المستهدفة","النتائج","الإسناد"],pagesEn:["Campaigns","Target lists","Results","Attribution"]},
  { id:"learning",ar:"التدريب الخارجي",en:"External Training",entity:"Training · TrainingSession · TrainingRegister",upstream:"axelor-talent (internal HR)",
    stage:"new",summaryAr:"يوجد تدريب موظفين داخلي فقط",summaryEn:"The existing module trains staff only",
    gapAr:"المتدرب الخارجي والمجموعات والحضور والاختبارات والشهادات تحتاج موديول IOETI",gapEn:"External trainees, cohorts, attendance, tests and certificates need an IOETI module",
    pagesAr:["البرامج","المجموعات","المتدربون","الشهادات"],pagesEn:["Programs","Cohorts","Trainees","Certificates"]},
  { id:"recruiting",ar:"التوظيف للعملاء",en:"Agency Recruitment",entity:"JobPosition · JobApplication · HiringStage",upstream:"axelor-talent (internal hiring)",
    stage:"new",summaryAr:"يوجد مسار توظيف داخلي وليس وكالة توظيف للعملاء",summaryEn:"Native hiring is internal, not a client recruitment agency",
    gapAr:"طلبات التوظيف للعميل والتعيين وعمولات/ضمان الاستبدال تحتاج تطوير",gapEn:"Client job orders, placement fees and replacement guarantees need an IOETI module",
    pagesAr:["طلبات العملاء","المرشحون","التقديمات","التعيينات"],pagesEn:["Job orders","Candidates","Submissions","Placements"]},
  { id:"certification",ar:"إدارة شهادات ISO",en:"ISO Certification",entity:"Intervention + QualityImprovement + (new) CertificationCycle",upstream:"axelor-intervention / axelor-quality",
    stage:"new",summaryAr:"الزيارات والجودة موجودة لكن إصدار شهادة العميل ليس موديولًا جاهزًا",summaryEn:"Visits and quality exist; external certification lifecycle does not",
    gapAr:"Stage 1/2 والقرار المستقل والمراقبة والتجديد وسجل الشهادات",gapEn:"Stage 1/2, independent decision, surveillance, renewals and certificate registry",
    pagesAr:["دورات الشهادة","الجدول السنوي","نتائج التدقيق","سجل الشهادات"],pagesEn:["Certification cycles","Audit programme","Audit findings","Certificate registry"]},
  { id:"fundraising",ar:"تنمية الموارد",en:"Fundraising",entity:"Opportunity (only) · (new) Donor/Grant/Pledge",upstream:"axelor-crm / new IOETI",
    stage:"new",summaryAr:"يمكن استعمال مسار فرص لكن لا يوجد سجل مانحين وتعهدات متكامل",summaryEn:"Opportunity pipeline exists; dedicated donation/grant ledger is absent",
    gapAr:"بيانات المانحين والمنح والتعهدات والإيصالات والتقارير",gapEn:"Donor profiles, grants, pledges, receipts and reports",
    pagesAr:["المانحون","الحملات","التعهدات","الإيصالات"],pagesEn:["Donors","Campaigns","Pledges","Receipts"]},
];
export function NativeModules({ language, onOpen }: { language: Language; onOpen: (page: "leads" | "accounts" | "opportunities") => void }) {
  const ar = language === "ar";
  const [active,setActive]=useState<Capability|null>(null);
  const [query,setQuery]=useState("");
  const visible=capabilities.filter(x=>[x.ar,x.en,x.entity,x.upstream].join(" ").toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  const uiConnection: Record<string, "leads" | "accounts" | "opportunities"> = { leads: "leads", accounts: "accounts" };
  const statusLabel=(x:Capability)=>x.stage==="new"?(ar?"مطلوب موديول IOETI":"IOETI module required"):(ar?"موديول Axelor موجود":"Existing Axelor domain");
  const arrow=ar?<ArrowLeft size={17}/>:<ArrowRight size={17}/>;
  return <section className="page-enter capability-explorer">
    <div className="page-title"><span className="eyebrow">{ar?"Source → Domain → UX":"Source → Domain → UX"}</span><h1>{ar?"خريطة الموديولات الحالية":"Existing System Map"}</h1>
      <p>{ar?"من كود Axelor إلى خريطة واجهة جديدة لكل جزء. التوصيل مع API لم يكتمل بعد؛ هذه شاشات تخطيطية وليست سجلات حقيقية.":"Reverse mapping from Axelor source models into future custom CRM screens. This is an architectural UX explorer, not connected records."}</p>
    </div>
    <div className="capability-summary">
      <div><strong>{capabilities.length}</strong><span>{ar?"نطاقًا مفحوصًا":"Audited areas"}</span></div>
      <div><strong>{capabilities.filter(x=>x.stage!=="new").length}</strong><span>{ar?"تعتمد على موديولات Axelor":"Native foundations"}</span></div>
      <div><strong>{capabilities.filter(x=>x.stage==="new").length}</strong><span>{ar?"تحتاج منطق IOETI إضافيًا":"IOETI domains required"}</span></div>
    </div>
    <label className="search-field cap-search"><Search size={17}/><span className="sr-only">{ar?"بحث":"Search"}</span><input value={query} placeholder={ar?"ابحث بالموديول أو الكيان البرمجي":"Search model, module or domain"} onChange={e=>setQuery(e.target.value)}/></label>
    <div className="capability-grid">
      {visible.map(item=><button type="button" className={"cap-card"+(active?.id===item.id?" selected":"")} key={item.id} onClick={()=>setActive(active?.id===item.id?null:item)} aria-expanded={active?.id===item.id}>
        <div className="cap-card-top"><span className="cap-card-icon">{item.stage==="new"?<Workflow size={21}/>:<Layers3 size={21}/>}</span><span className={"cap-type "+(item.stage==="new"?"required":"exists")}>{item.stage==="new"?<ShieldAlert size={13}/>:<CheckCircle2 size={13}/>} {statusLabel(item)}</span></div>
        <strong>{ar?item.ar:item.en}</strong><p>{ar?item.summaryAr:item.summaryEn}</p>
        <div className="cap-source"><span>{item.upstream}</span><ChevronDown size={15}/></div>
      </button>)}
    </div>
    {active && <section className="cap-detail" aria-live="polite">
      <div className="cap-detail-heading"><div><span className="eyebrow">{active.upstream}</span><h2>{ar?active.ar:active.en}</h2></div>
      <div className="cap-detail-actions">
        {uiConnection[active.id]&&<button type="button" className="btn btn-primary" onClick={()=>onOpen(uiConnection[active.id])}>{ar?"افتح واجهة القراءة المرتبطة":"Open connected read-only UI"}{arrow}</button>}
        <button type="button" className="btn btn-secondary" onClick={()=>setActive(null)}>{ar?"إغلاق":"Close"}</button>
      </div></div>
      <div className="cap-detail-cols">
        <div><span className="detail-kicker">{ar?"الكائنات البرمجية المثبتة بالمصدر":"Grounded domain models"}</span><p><code dir="ltr">{active.entity}</code></p>
          <span className="detail-kicker">{ar?"خريطة صفحات الواجهة":"Planned custom UI surfaces"}</span><div className="cap-page-list">{(ar?active.pagesAr:active.pagesEn).map((p,i)=><div key={p}><span>{String(i+1).padStart(2,"0")}</span><strong>{p}</strong>{arrow}</div>)}</div></div>
        <div className="cap-gap"><div className="cap-gap-icon"><LockKeyhole size={19}/></div><strong>{ar?"ما زال يحتاج تنفيذًا":"Remaining implementation"}</strong><p>{ar?active.gapAr:active.gapEn}</p><small>{ar?"الموجود هنا مؤكد على مستوى المصدر، وليس تأكيدًا على اكتمال هذه الشاشات أو الصلاحيات.":"Source-backed model mapping; UI endpoints and permissions remain subject to integration tests."}</small></div>
      </div>
    </section>}
    <p className="scope-note"><ShieldAlert size={15}/>{ar?"الموديولات الموجودة في Axelor لا تعني أن متطلبات IOETI التشغيلية اكتملت.":"An Axelor model is not proof of IOETI workflow completion."}</p>
  </section>;
}
