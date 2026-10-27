import { useEffect, useRef } from "react";
import {
  ArrowLeft, ArrowRight, BadgeCheck, BriefcaseBusiness, CalendarClock,
  ChevronLeft, ChevronRight, ClipboardCheck, FileText, Layers3, LockKeyhole,
  Network, ShieldCheck, Workflow
} from "lucide-react";
import type { Opportunity } from "./api";
import { DEMO_MODE } from "./demo";
import type { Language } from "./preferences";
import { stageLabel } from "./labels";
import { QuotesPanel } from "./QuotesPanel";
import { ContractPanel } from "./ContractPanel";
import { DocumentsPanel } from "./DocumentsPanel";
import { MentionForm } from "./InboxPage";
import { ActivityPanel } from "./ActivityPanel";
import { OpportunityPlanCard, OpportunityStageRail } from "./OpportunityStageRail";

type Props = {
  record: Opportunity; language: Language; onBack: () => void;
  onRename: () => void; onPrevious?: () => void; onNext?: () => void;
  onRecordChanged?: () => void;
};
const copy = {
  ar: {
    back: "الرجوع إلى الفرص", eyebrow: "ملف الفرصة التجارية", sample: "بيانات تجريبية خيالية",
    real: "البيانات المسجلة على الفرصة", read: "حسب صلاحيات الخادم", edit: "تعديل اسم الفرصة",
    previous: "السابق", next: "التالي", overview: "نظرة عامة", source: "المصدر",
    line: "خط الأعمال", stage: "المرحلة الحالية", ref: "مرجع الفرصة",
    version: "نسخة السجل", id: "رقم السجل", unknown: "غير محدد",
    context: "السياق التجاري", linked: "سجلات الأعمال المرتبطة",
    linkedDesc: "لا نعرض علاقات عميل أو عروض أسعار أو عقود غير موجودة في الـAPI المصرح بها.",
    missing: "هذا القسم لم يُوصّل بمصدر حقيقي بعد",
    stepsTitle: "الرحلة التجارية", stepsDesc: "دي خريطة للخطوات المستقبلية، وليست حالة تقدم فعلية لهذه الفرصة.",
    steps: ["التأهيل", "العرض والموافقة", "العقد والتوقيع", "التسليم للتنفيذ"],
    permission: "تُعرض الحقول المصرح بها فقط. لا يتم استنتاج العميل أو المسؤول أو القيمة التجارية من اسم الفرصة.",
    timeline: "الأنشطة والمتابعة", timelineNote: "سيظهر سجل الأنشطة بعد ربط Event API مع قواعد وصول مستقلة.",
    quote: "عروض الأسعار", quoteNote: "لا توجد عروض أسعار بعد.",
    contract: "العقود", contractNote: "لم يتم ربط Contract بهذا السجل بعد.",
  },
  en: {
    back: "Back to opportunities", eyebrow: "Opportunity workspace", sample: "Fictional demo data",
    real: "What is recorded on this opportunity", read: "Server permissions apply", edit: "Rename opportunity",
    previous: "Previous", next: "Next", overview: "Overview", source: "Source",
    line: "Business line", stage: "Current stage", ref: "Opportunity reference",
    version: "Record version", id: "Record ID", unknown: "Not specified",
    context: "Commercial context", linked: "Related business records",
    linkedDesc: "We do not fabricate linked accounts, quotes or contracts that have no authorized API.",
    missing: "This section is not connected to a verified source yet",
    stepsTitle: "Commercial journey", stepsDesc: "These are planned steps, not this record's actual progress.",
    steps: ["Qualification", "Proposal & approval", "Contract & signature", "Operations handover"],
    permission: "Only allowlisted fields are shown. Client, owner, and deal value are never inferred from the opportunity name.",
    timeline: "Activities & follow-ups", timelineNote: "Activity history awaits a separately authorized Event API.",
    quote: "Quotations", quoteNote: "No quotations yet.",
    contract: "Contracts", contractNote: "No authorized Contract linkage has been connected yet.",
  },
} as const;

export function OpportunityRecordWorkspace({record,language,onBack,onRename,onPrevious,onNext,onRecordChanged}:Props){
  const c=copy[language],ar=language==="ar";
  const Back=ar?ArrowRight:ArrowLeft;
  const Prev=ar?ChevronRight:ChevronLeft;
  const Next=ar?ChevronLeft:ChevronRight;
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{
    heading.current?.focus();
    window.scrollTo({top:0,behavior:"instant"});
  },[record.id]);
  const line=ar?record.businessLineNameAr||record.businessLineCode:record.businessLineNameEn||record.businessLineCode;
  const facts=[
    {label:c.line,value:line||c.unknown},
    {label:c.stage,value:record.stage?stageLabel(record.stage,language):c.unknown},
    {label:c.ref,value:record.reference||c.unknown},
    {label:c.id,value:"#"+record.id},
    {label:c.version,value:"v"+record.version},
  ];
  return <article className="record-workspace opportunity-record page-enter" aria-labelledby="opportunity-record-title">
    <div className="record-context-bar">
      <button type="button" className="record-back" onClick={onBack}><Back size={17}/>{c.back}</button>
      <span className="record-context-separator">/</span>
      <span aria-current="page" className="record-current">{record.name}</span>
    </div>
    <div className="record-hero">
      <div className="record-hero-main">
        <span className="eyebrow"><BriefcaseBusiness size={15}/>{c.eyebrow} · {DEMO_MODE?c.sample:c.real}</span>
        <div className="record-hero-heading">
          <div className="record-identity-icon"><Workflow size={30}/></div>
          <div><h1 ref={heading} tabIndex={-1} id="opportunity-record-title">{record.name}</h1>
            <div className="record-tags">
              <span className="record-status-tag"><BadgeCheck size={14}/>{record.stage?stageLabel(record.stage,language):c.unknown}</span>
              <span className="record-ref" dir="ltr">{record.reference||"#"+record.id}</span>
            </div>
          </div>
        </div>
        <p className="record-hero-description">{c.permission}</p>
      </div>
      <div className="record-hero-actions">
        <span className="record-readonly-pill"><ShieldCheck size={15}/>{c.read}</span>
        <button type="button" className="btn btn-primary" onClick={onRename}>{c.edit}</button>
        <div className="record-paging">
          <button type="button" className="btn btn-secondary" disabled={!onPrevious} onClick={onPrevious}><Prev size={17}/>{c.previous}</button>
          <button type="button" className="btn btn-secondary" disabled={!onNext} onClick={onNext}>{c.next}<Next size={17}/></button>
        </div>
      </div>
    </div>
    <div className="record-section-label"><strong className="record-label-active">{c.overview}</strong><span>{c.source}: {ar ? "المبيعات · الفرص التجارية" : "Sales · Opportunities"}</span></div>
    <div className={"record-content-grid"+(DEMO_MODE?"":" is-single")}>
      <section className="record-content-card" aria-labelledby="opportunity-facts-title">
        <div className="record-section-header"><div className="record-section-icon"><Layers3 size={20}/></div><div>
          <h2 id="opportunity-facts-title">{c.context}</h2><p>{c.real}</p>
        </div></div>
        <dl className="record-properties">{facts.map(f=><div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
        <p className="record-security-note"><LockKeyhole size={15}/>{c.permission}</p>
      </section>
      {DEMO_MODE&&<section className="record-content-card" aria-labelledby="opportunity-related-title">
        <div className="record-section-header"><div className="record-section-icon"><Network size={20}/></div><div>
          <h2 id="opportunity-related-title">{c.linked}</h2><p>{c.linkedDesc}</p>
        </div></div>
        <div className="opportunity-linked-list">
          {[
            {name:c.timeline,detail:c.timelineNote,icon:CalendarClock},
            ...(DEMO_MODE?[{name:c.quote,detail:c.quoteNote,icon:FileText}]:[]),
            ...(DEMO_MODE?[{name:c.contract,detail:c.contractNote,icon:ClipboardCheck}]:[])
          ].map(section=>{const Icon=section.icon;return <div className="opportunity-link-placeholder" key={section.name}>
            <Icon size={19}/><div><strong>{section.name}</strong><p>{section.detail}</p></div><span className="opportunity-link-pending" aria-label={c.missing}>—</span>
          </div>})}
        </div>
      </section>}
    </div>
    {!DEMO_MODE&&record.stageId!==undefined&&<section className="record-content-card opportunity-path">
      <OpportunityStageRail record={record} language={language} onChanged={()=>onRecordChanged?.()}/>
      <OpportunityPlanCard record={record} language={language} onChanged={()=>onRecordChanged?.()}/>
    </section>}
    {!DEMO_MODE&&<section className="record-content-card record-activities">
      <ActivityPanel record="OPPORTUNITY" recordId={record.id} version={record.version} language={language} onChanged={()=>onRecordChanged?.()}/>
    </section>}
    {!DEMO_MODE&&<QuotesPanel opportunityId={record.id} opportunityVersion={record.version} language={language} onOpportunityChanged={onRecordChanged}/>}
    {!DEMO_MODE&&<ContractPanel opportunityId={record.id} opportunityVersion={record.version} language={language} onOpportunityChanged={onRecordChanged}/>}
    {!DEMO_MODE&&<section className="record-content-card record-documents"><DocumentsPanel subject="OPPORTUNITY" subjectId={record.id} language={language}/>
      <MentionForm subject="OPPORTUNITY" subjectId={record.id} language={language}/></section>}
    {DEMO_MODE&&<section className="record-flow-card" aria-labelledby="opportunity-journey-title">
      <div className="record-flow-title"><div className="record-section-icon"><Workflow size={20}/></div><div>
        <h2 id="opportunity-journey-title">{c.stepsTitle}</h2><p>{c.stepsDesc}</p>
      </div></div>
      <div className="record-flow-stages">
        {c.steps.map((step,i)=><div className="record-flow-stage" key={step}><span className="record-flow-step">{String(i+1).padStart(2,"0")}</span><strong>{step}</strong><small className="record-flow-pending">{c.missing}</small></div>)}
      </div>
    </section>}
  </article>;
}
