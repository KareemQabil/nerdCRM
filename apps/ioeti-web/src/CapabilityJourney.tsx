import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardList, GitBranch, LockKeyhole, ShieldAlert, Workflow } from "lucide-react";
import type { Language } from "./preferences";

/**
 * A design-time journey map, NOT executable business functionality.
 * Steps and route contracts are sourced from the pinned AOS/IOETI reverse map.
 * No unknown endpoint is called and no business record is synthesized.
 */
export type JourneyKey =
  | "leads" | "accounts" | "quotes" | "catalog" | "contracts" | "finance"
  | "projects" | "visits" | "quality" | "marketing" | "learning"
  | "recruiting" | "certification" | "fundraising";
type Stage = { ar: string; en: string; entity: string; route: string; surface: string; gateAr: string; gateEn: string; connected?: boolean };
const stage=(ar:string,en:string,entity:string,route:string,surface:string,gateAr:string,gateEn:string,connected=false):Stage=>({ar,en,entity,route,surface,gateAr,gateEn,connected});
const gates={
  scope:"صلاحيات قراءة السجل ومرجع العميل وخط الأعمال",scopeEn:"Record, account and business-line authorization",
  flow:"حالات الانتقال وقواعد الموافقة من الخادم",flowEn:"Server-side transitions and approval policy",
  links:"السجلات المرتبطة تتطلب صلاحيات مستقلة",linksEn:"Related models require independent authorization",
  policy:"سياسة تشغيلية معتمدة من IOETI",policyEn:"IOETI owner-approved operating policy",
  safety:"الحفظ والمعاملات والتدقيق والاختبارات السلبية",safetyEn:"Transactional, audit and negative authorization tests"
};
export const capabilityJourneys: Record<JourneyKey, Stage[]> = {
  leads:[
    stage("استقبال الطلب","Lead intake","Lead","GET /ws/ioeti/leads","Inbox",gates.scope,gates.scopeEn,true),
    stage("التحقق والتأهيل","Qualification","LeadStatus","POST /ws/ioeti/leads/{id}/qualify","Full workflow",gates.flow,gates.flowEn),
    stage("الأنشطة والمسؤولية","Activities & assignment","Event · Team","GET /ws/ioeti/leads/{id}/activities","Record section",gates.links,gates.linksEn),
    stage("التحويل للعميل والفرصة","Conversion","ConvertLeadWizardService","POST /ws/ioeti/leads/{id}/convert","Guided wizard",gates.safety,gates.safetyEn),
  ],
  accounts:[
    stage("هوية العميل","Account identity","Partner","GET /ws/ioeti/accounts/{id}","Full record",gates.scope,gates.scopeEn,true),
    stage("جهات الاتصال","Contacts & hierarchy","PartnerLink","GET /ws/ioeti/accounts/{id}/contacts","Record section",gates.links,gates.linksEn),
    stage("الفرص والعقود","Commercial relationships","Opportunity · Contract","GET /ws/ioeti/accounts/{id}/timeline","Record section",gates.links,gates.linksEn),
    stage("الخدمات والتجديدات","Delivery & renewals","Project · Contract","GET /ws/ioeti/accounts/{id}/renewals","Record section",gates.policy,gates.policyEn),
  ],
  quotes:[
    stage("اختيار الخدمات","Service scope","Product · PriceList","GET /ws/ioeti/services","Full record",gates.scope,gates.scopeEn),
    stage("بناء العرض وتسعيره","Quote composition","SaleOrderLine","POST /ws/ioeti/quotes","Full wizard",gates.flow,gates.flowEn),
    stage("الموافقة والإصدارات","Approvals & versions","SaleOrderVersion","GET /ws/ioeti/quotes/{id}","Full record",gates.safety,gates.safetyEn),
    stage("التوقيع والتصدير","Send & accept","PrintingTemplate · SaleOrder","POST /ws/ioeti/quotes/{id}/pdf","Document workflow",gates.policy,gates.policyEn),
  ],
  catalog:[
    stage("فهرس الخدمات","Service catalog","Product · ProductCategory","GET /ws/ioeti/services","Index",gates.scope,gates.scopeEn),
    stage("خط الأعمال والمخرجات","Business-line scope","Product · BusinessLine","GET /ws/ioeti/services/{id}","Full record",gates.flow,gates.flowEn),
    stage("قوائم الأسعار","Price books","PriceList","GET /ws/ioeti/pricebooks","Full record",gates.links,gates.linksEn),
    stage("محاكاة التسعير","Pricing preview","PricingRule","POST /ws/ioeti/pricing/preview","Guided wizard",gates.safety,gates.safetyEn),
  ],
  contracts:[
    stage("مسودة الاتفاقية","Contract draft","Contract · ContractTemplate","GET /ws/ioeti/contracts/{id}","Full record",gates.scope,gates.scopeEn),
    stage("المراجعة القانونية","Legal review","ContractVersion","POST /ws/ioeti/contracts/{id}/approval","Full workflow",gates.flow,gates.flowEn),
    stage("التوقيع والإثبات","Signature evidence","Contract · MetaFile","GET /ws/ioeti/contracts/{id}","Full record",gates.links,gates.linksEn),
    stage("المتابعة والتجديد","Renewal","ContractService","POST /ws/ioeti/contracts/{id}/renewal","Guided workflow",gates.safety,gates.safetyEn),
  ],
  finance:[
    stage("الاستحقاقات","Milestone schedule","Timetable","GET /ws/ioeti/invoices","Index",gates.scope,gates.scopeEn),
    stage("طلب الفاتورة","Invoice request","Invoice","POST /ws/ioeti/milestones/{id}/complete","Full workflow",gates.policy,gates.policyEn),
    stage("التسوية والتحصيل","Collection","InvoicePayment","GET /ws/ioeti/invoices","Full record",gates.safety,gates.safetyEn),
    stage("التقارير والذمم","Aging & reporting","DebtRecovery","GET /ws/ioeti/finance/aging","Analytics",gates.links,gates.linksEn),
  ],
  projects:[
    stage("استلام الصفقة","Sales handover","Project · Contract","POST /ws/ioeti/handovers","Full workflow",gates.flow,gates.flowEn),
    stage("التخطيط والمسؤوليات","Engagement planning","ProjectTemplate","GET /ws/ioeti/engagements/{id}","Full record",gates.scope,gates.scopeEn),
    stage("التنفيذ والمواعيد","Delivery & resources","ProjectTask · ResourceBooking","GET /ws/ioeti/engagements/{id}","Task workspace",gates.safety,gates.safetyEn),
    stage("الاعتماد والإغلاق","Acceptance & closure","Project","GET /ws/ioeti/engagements/{id}","Full workflow",gates.policy,gates.policyEn),
  ],
  visits:[
    stage("جدولة الزيارة","Visit scheduling","Intervention","GET /ws/ioeti/visits/{id}","Full record",gates.scope,gates.scopeEn),
    stage("قائمة التحقق","Checklist","InterventionQuestion","GET /ws/ioeti/visits/{id}","Guided checklist",gates.flow,gates.flowEn),
    stage("الأدلة والتوقيع","Evidence & signatures","Intervention · Picture","GET /ws/ioeti/visits/{id}","Evidence workflow",gates.links,gates.linksEn),
    stage("المراجعة والإغلاق","Review & closure","InterventionService","GET /ws/ioeti/visits/{id}","Full workflow",gates.safety,gates.safetyEn),
  ],
  quality:[
    stage("تسجيل الملاحظة","Finding","QualityImprovement","GET /ws/ioeti/certification/findings/{id}","Full record",gates.scope,gates.scopeEn),
    stage("تحليل الأسباب","Root-cause analysis","QIAnalysis · QICause","GET /ws/ioeti/certification/findings/{id}","Full workflow",gates.policy,gates.policyEn),
    stage("الإجراءات التصحيحية","CAPA","QIAction","GET /ws/ioeti/certification/findings/{id}","Full workflow",gates.safety,gates.safetyEn),
    stage("التحقق المستقل","Independent verification","QIResolution","GET /ws/ioeti/certification/findings/{id}","Review workflow",gates.flow,gates.flowEn),
  ],
  marketing:[
    stage("تحديد الجمهور","Segments","TargetList","GET /ws/ioeti/marketing/campaigns","Full record",gates.scope,gates.scopeEn),
    stage("إنشاء الحملة","Campaign setup","Campaign","GET /ws/ioeti/marketing/campaigns","Full workflow",gates.policy,gates.policyEn),
    stage("المتابعة والاستجابة","Lead attribution","Campaign · Lead","GET /ws/ioeti/marketing/campaigns","Full record",gates.links,gates.linksEn),
    stage("النتائج المالية","Attribution & ROI","Campaign · Invoice","GET /ws/ioeti/marketing/analytics","Analytics",gates.safety,gates.safetyEn),
  ],
  learning:[
    stage("البرنامج والمدرب","Course & trainer","Training · Skill","GET /ws/ioeti/training/cohorts/{id}","Full record",gates.policy,gates.policyEn),
    stage("تسجيل المتدربين","External enrollment","NEW: Trainee · Enrollment","POST /ws/ioeti/training/cohorts/{id}/enroll","Guided wizard",gates.scope,gates.scopeEn),
    stage("الحضور والتقييم","Attendance & assessment","NEW: Attendance · Assessment","POST /ws/ioeti/training/cohorts/{id}/attendance","Matrix",gates.safety,gates.safetyEn),
    stage("إصدار الشهادة","Certificate issuance","NEW: TrainingCertificate","POST /ws/ioeti/training/certificates/{id}/issue","Full workflow",gates.flow,gates.flowEn),
  ],
  recruiting:[
    stage("طلب التوظيف من العميل","Client job order","NEW: ClientJobOrder","GET /ws/ioeti/recruitment/job-orders/{id}","Full record",gates.scope,gates.scopeEn),
    stage("مطابقة المرشحين","Candidate screening","NEW: CandidateConsent","GET /ws/ioeti/recruitment/job-orders/{id}","Full workflow",gates.policy,gates.policyEn),
    stage("مشاركة الملفات والمقابلات","Submission & interviews","NEW: CandidateSubmission","POST /ws/ioeti/recruitment/job-orders/{id}/submit-candidate","Restricted wizard",gates.links,gates.linksEn),
    stage("التعيين والضمان","Placement & guarantee","NEW: Placement · GuaranteeClaim","POST /ws/ioeti/recruitment/placements/{id}/verify","Full workflow",gates.safety,gates.safetyEn),
  ],
  certification:[
    stage("دورة الشهادة ونطاقها","Certification cycle","NEW: CertificationCycle","GET /ws/ioeti/certification/cycles/{id}","Full record",gates.scope,gates.scopeEn),
    stage("Stage 1 وStage 2","Audits & evidence","Intervention · InterventionQuestion","POST /ws/ioeti/certification/audits/{id}/submit","Audit wizard",gates.policy,gates.policyEn),
    stage("المخالفات والـCAPA","NC & corrective actions","QualityImprovement · QIAction","GET /ws/ioeti/certification/findings/{id}","Full workflow",gates.safety,gates.safetyEn),
    stage("القرار المستقل والإصدار","Independent decision","NEW: CertificationDecision","POST /ws/ioeti/certification/decisions/{id}","Restricted workflow",gates.flow,gates.flowEn),
    stage("المراقبة والتجديد","Surveillance & renewal","NEW: CertificateRegister","GET /ws/ioeti/certification/certificates/{id}","Full record",gates.links,gates.linksEn),
  ],
  fundraising:[
    stage("المانح والجهة","Donor identity","Partner · NEW: Donor","GET /ws/ioeti/fundraising/donors/{id}","Full record",gates.scope,gates.scopeEn),
    stage("المقترح والمنحة","Grant application","NEW: Grant","GET /ws/ioeti/fundraising/grants/{id}","Full workflow",gates.policy,gates.policyEn),
    stage("التعهد والاستحقاق","Pledge schedule","NEW: Pledge","GET /ws/ioeti/fundraising/grants/{id}","Full record",gates.flow,gates.flowEn),
    stage("الاستلام والتقارير","Receipts & reporting","NEW: DonationReceipt","POST /ws/ioeti/fundraising/pledges/{id}/receipt","Restricted workflow",gates.safety,gates.safetyEn),
  ],
};
const copy={
 ar:{title:"رحلة العمل المقترحة",desc:"تستند للموديولات والمواصفات الحالية؛ ليست عمليات متاحة للمستخدم قبل توصيل الـAPI واختبار الصلاحيات.",draft:"غير موصل",read:"قراءة محدودة",step:"الخطوة",source:"الكيان والمصدر",contract:"عقد الـAPI",interaction:"طريقة التفاعل",gate:"شرط التنفيذ والأمان",warning:"هذه خريطة UX وليست Workflow شغالة؛ لا يتم إرسال أي طلبات.",details:"تفاصيل الخطوة"},
 en:{title:"Planned business journey",desc:"Derived from pinned source and requirements, not an enabled workflow until APIs and permissions pass verification.",draft:"Not connected",read:"Limited read",step:"Step",source:"Source entity",contract:"API contract",interaction:"Interaction surface",gate:"Security / completion gate",warning:"UX contract preview only. No requests are sent.",details:"Stage details"},
};
export function CapabilityJourney({id,language}:{id:JourneyKey;language:Language}){
 const l=copy[language],ar=language==="ar",steps=capabilityJourneys[id];
 const [index,setIndex]=useState(0);
 useEffect(()=>setIndex(0),[id]);
 const selected=steps[Math.min(index,steps.length-1)];
 const Arrow=ar?ArrowLeft:ArrowRight;
 return <section className="journey-planner" aria-label={l.title}>
   <div className="journey-planner-header">
     <div><span className="eyebrow"><GitBranch size={15}/> Source → Task → UX</span><h3>{l.title}</h3><p>{l.desc}</p></div>
     <span className="journey-planner-tag"><LockKeyhole size={14}/>{l.warning}</span>
   </div>
   <div className="journey-step-strip" role="tablist" aria-label={l.title}>
     {steps.map((step,i)=><button type="button" key={step.en} role="tab" aria-selected={index===i}
       aria-controls="journey-stage-detail" className={"journey-step"+(index===i?" active":"")}
       onClick={()=>setIndex(i)}>
       <span className="journey-step-marker">{step.connected?<CheckCircle2 size={16}/>:String(i+1).padStart(2,"0")}</span>
       <strong>{ar?step.ar:step.en}</strong>
       <small>{step.connected?l.read:l.draft}</small>
       {i<steps.length-1 && <Arrow size={15} className="journey-step-arrow"/>}
     </button>)}
   </div>
   <div className="journey-stage-detail" id="journey-stage-detail" role="tabpanel">
     <div className="journey-stage-summary">
       <div className="journey-stage-icon"><Workflow size={23}/></div>
       <div><span className="detail-kicker">{l.step} {index+1}/{steps.length}</span><h4>{ar?selected.ar:selected.en}</h4>
         <span className={"journey-stage-status"+(selected.connected?" has-read":"")}><ShieldAlert size={13}/>{selected.connected?l.read:l.draft}</span>
       </div>
     </div>
     <dl className="journey-stage-facts">
       <div><dt><ClipboardList size={14}/>{l.source}</dt><dd dir="ltr">{selected.entity}</dd></div>
       <div><dt>{l.contract}</dt><dd dir="ltr">{selected.route}</dd></div>
       <div><dt>{l.interaction}</dt><dd>{selected.surface}</dd></div>
       <div><dt>{l.gate}</dt><dd>{ar?selected.gateAr:selected.gateEn}</dd></div>
     </dl>
   </div>
 </section>;
}
