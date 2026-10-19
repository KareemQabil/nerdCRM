import { useEffect, useRef } from "react";
import {
  ArrowLeft, ArrowRight, BadgeCheck, Building2, ChevronLeft, ChevronRight,
  CircleDashed, FileClock, Layers3, LockKeyhole, Network, ShieldCheck, UserRound
} from "lucide-react";
import type { AccountSummary, LeadSummary } from "./api";
import type { Language } from "./preferences";
import { DEMO_MODE } from "./demo";

type RecordItem = LeadSummary | AccountSummary;
type Props = {
  kind: "leads" | "accounts"; language: Language; record: RecordItem;
  onBack: () => void; onPrevious?: () => void; onNext?: () => void;
};
const strings = {
  ar: {
    backAccounts:"الرجوع إلى حسابات العملاء",backLeads:"الرجوع إلى العملاء المحتملين",
    account:"ملف الحساب",lead:"ملف العميل المحتمل",profile:"نظرة عامة",
    context:"الهوية والعلاقة",record:"رقم السجل",reference:"المرجع",
    organization:"الشركة",stage:"المرحلة",classification:"تصنيف الحساب",
    customer:"عميل",prospect:"محتمل",both:"عميل ومحتمل",empty:"غير محدد",
    next:"التالي",previous:"السابق",existing:"بيانات مؤكدة من النظام",
    demo:"بيانات تخيلية للمعاينة فقط",readonly:"صفحة قراءة فقط",
    accountJourney:"رحلة العميل",leadJourney:"رحلة التأهيل",
    accountJourneyDesc:"هنا سترتبط الفرص التجارية، العقود، الخدمات، المستحقات والتنفيذ بهذا الحساب.",
    leadJourneyDesc:"هنا ستظهر الأنشطة، المسؤول، أهلية العميل ونتيجة التحويل لفرصة تجارية.",
    connection:"لم تُربط البيانات المرتبطة بعد",
    connectionDesc:"لن نعرض فرصًا أو عقودًا أو تفاعلات غير موجودة في الـAPI. ربطها يتم بعد فحص الصلاحيات ومراجعة المصدر.",
    accountFlow:["الفرص التجارية","عروض الأسعار والعقود","التنفيذ والشهادات","الفواتير والمتابعة"],
    leadFlow:["التواصل والتأهيل","الأنشطة والتكليف","التحويل إلى فرصة","المتابعة"],
    source:"المصدر",leadSource:"Axelor CRM · Lead",accountSource:"Axelor Base · Partner",
    summary:"السجل الأساسي",related:"الأنشطة المرتبطة",noLinks:"لم تُوصّل سجلات الارتباط بعد",
    security:"تُجلب معلومات هذا السجل من واجهة IOETI محدودة الحقول وفق صلاحيات الخادم.",
  },
  en: {
    backAccounts:"Back to accounts",backLeads:"Back to leads",
    account:"Account profile",lead:"Lead profile",profile:"Overview",
    context:"Identity and relationship",record:"Record ID",reference:"Reference",
    organization:"Organization",stage:"Stage",classification:"Account classification",
    customer:"Customer",prospect:"Prospect",both:"Customer & prospect",empty:"Not specified",
    next:"Next",previous:"Previous",existing:"Verified source fields",
    demo:"Fictional records for preview",readonly:"Read-only workspace",
    accountJourney:"Account journey",leadJourney:"Qualification journey",
    accountJourneyDesc:"Opportunities, contracts, service delivery, billing and engagement activity will link to this account.",
    leadJourneyDesc:"Activities, ownership, qualification and conversion will connect to this lead.",
    connection:"Related data not connected yet",
    connectionDesc:"No invented opportunities, contracts or interactions. This will be connected after source and permission verification.",
    accountFlow:["Opportunities","Quotes & contracts","Delivery & certificates","Billing & follow-up"],
    leadFlow:["Contact & qualification","Activities & assignment","Convert to opportunity","Follow-up"],
    source:"Source",leadSource:"Axelor CRM · Lead",accountSource:"Axelor Base · Partner",
    summary:"Core record",related:"Related operations",noLinks:"Related records have not been connected yet",
    security:"This profile loads only allowlisted IOETI API fields subject to server permissions.",
  },
} as const;
function isLead(record:RecordItem):record is LeadSummary{return "organization" in record;}
function classification(item:AccountSummary,l:typeof strings.ar|typeof strings.en){
  if(item.customer&&item.prospect)return l.both;
  if(item.customer)return l.customer;
  if(item.prospect)return l.prospect;
  return l.empty;
}
export function RecordWorkspace({kind,language,record,onBack,onPrevious,onNext}:Props){
  const ar=language==="ar";
  const l=strings[language];
  const lead=isLead(record);
  const BackArrow=ar?ArrowRight:ArrowLeft;
  const NextArrow=ar?ChevronLeft:ChevronRight;
  const PreviousArrow=ar?ChevronRight:ChevronLeft;
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus();window.scrollTo({top:0,behavior:"instant"});},[record.id]);
  const typeLabel=kind==="leads"?l.lead:l.account;
  const status=lead?(record.stage||l.empty):classification(record,l);
  const summary=lead?[
    [l.organization,record.organization||l.empty],
    [l.stage,record.stage||l.empty],
    [l.record,"#"+record.id],
  ]:[
    [l.reference,record.reference||l.empty],
    [l.classification,status],
    [l.record,"#"+record.id],
  ];
  const flow=kind==="leads"?l.leadFlow:l.accountFlow;
  return <article className="record-workspace page-enter" aria-labelledby="record-profile-title">
    <div className="record-context-bar">
      <button type="button" className="record-back" onClick={onBack}><BackArrow size={17}/>{kind==="leads"?l.backLeads:l.backAccounts}</button>
      <span className="record-context-separator">/</span>
      <span className="record-current" aria-current="page">{record.name}</span>
    </div>
    <div className="record-hero">
      <div className="record-hero-main">
        <span className="eyebrow"><span className="record-eyebrow-dot"/>{typeLabel} · {DEMO_MODE?l.demo:l.existing}</span>
        <div className="record-hero-heading">
          <div className="record-identity-icon">{lead?<UserRound size={30}/>:<Building2 size={30}/>}</div>
          <div><h1 tabIndex={-1} ref={heading} id="record-profile-title">{record.name}</h1>
            <div className="record-tags"><span className="record-status-tag"><BadgeCheck size={14}/>{status}</span>
              <span className="record-ref" dir="ltr">{lead?"#"+record.id:record.reference||"#"+record.id}</span></div>
          </div>
        </div>
        <p className="record-hero-description">{lead?l.leadJourneyDesc:l.accountJourneyDesc}</p>
      </div>
      <div className="record-hero-actions">
        <span className="record-readonly-pill"><LockKeyhole size={14}/>{l.readonly}</span>
        <div className="record-paging">
          <button type="button" className="btn btn-secondary" onClick={onPrevious} disabled={!onPrevious}><PreviousArrow size={17}/>{l.previous}</button>
          <button type="button" className="btn btn-secondary" onClick={onNext} disabled={!onNext}>{l.next}<NextArrow size={17}/></button>
        </div>
      </div>
    </div>
    <div className="record-section-label"><span className="record-label-active">{l.profile}</span><span>{l.source}: {kind==="leads"?l.leadSource:l.accountSource}</span></div>
    <div className="record-content-grid">
      <section className="record-content-card record-info" aria-labelledby="record-identity-heading">
        <div className="record-section-header"><div className="record-section-icon"><Layers3 size={20}/></div><div><h2 id="record-identity-heading">{l.context}</h2><p>{l.summary}</p></div></div>
        <dl className="record-properties">{summary.map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
        <p className="record-security-note"><ShieldCheck size={15}/>{l.security}</p>
      </section>
      <section className="record-content-card record-related" aria-labelledby="record-related-heading">
        <div className="record-section-header"><div className="record-section-icon"><Network size={20}/></div><div><h2 id="record-related-heading">{l.related}</h2><p>{lead?l.leadJourney:l.accountJourney}</p></div></div>
        <div className="record-related-empty"><CircleDashed size={28}/><strong>{l.connection}</strong><p>{l.connectionDesc}</p></div>
      </section>
    </div>
    <section className="record-flow-card" aria-labelledby="record-flow-heading">
      <div className="record-flow-title"><div className="record-section-icon"><FileClock size={20}/></div><div><h2 id="record-flow-heading">{lead?l.leadJourney:l.accountJourney}</h2><p>{l.connectionDesc}</p></div></div>
      <div className="record-flow-stages">{flow.map((label,index)=><div className="record-flow-stage" key={label}><span className="record-flow-step">{String(index+1).padStart(2,"0")}</span><span>{label}</span><span className="record-flow-pending">{l.connection}</span></div>)}</div>
    </section>
  </article>;
}
