import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, BadgeCheck, Building2, ChevronLeft, ChevronRight,
  CircleDashed, FileClock, GitMerge, Layers3, LockKeyhole, MapPin, Network, Pencil, ShieldCheck, UserPlus, UserRound
} from "lucide-react";
import { Account360 } from "./Account360";
import { LeadQualificationPanel } from "./LeadQualificationPanel";
import { LeadEngagementPanel } from "./LeadTools";
import { DocumentsPanel } from "./DocumentsPanel";
import { MentionForm, OutboxPanel } from "./InboxPage";
import { getAccount, getLead, type AccountSummary, type LeadSummary } from "./api";
import { ActivityPanel } from "./ActivityPanel";
import { AccountDialog, ContactDialog, EditLeadDialog } from "./RecordDialogs";
import { NewVisitDialog } from "./VisitsPage";
import type { Language } from "./preferences";
import { stageLabel } from "./labels";
import { DEMO_MODE } from "./demo";

type RecordItem = LeadSummary | AccountSummary;
type Props = {
  kind: "leads" | "accounts"; language: Language; record: RecordItem;
  onBack: () => void; onPrevious?: () => void; onNext?: () => void;
  onRecordChanged?: (record: RecordItem) => void;
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
    leadLiveDesc:"التأهيل والموافقات والمتابعات والمستندات لهذا العميل المحتمل، ضمن صلاحياتك.",
    accountLiveDesc:"الفرص والعروض والعقود والمستندات المرتبطة بهذا الحساب، ضمن صلاحياتك.",
    convertedDesc:"تم تحويل هذا العميل المحتمل؛ المتابعة تتم على الحساب والفرصة.",
    connection:"لم تُربط البيانات المرتبطة بعد",
    connectionDesc:"لن نعرض فرصًا أو عقودًا أو تفاعلات غير موجودة في الـAPI. ربطها يتم بعد فحص الصلاحيات ومراجعة المصدر.",
    accountFlow:["الفرص التجارية","عروض الأسعار والعقود","التنفيذ والشهادات","الفواتير والمتابعة"],
    leadFlow:["التواصل والتأهيل","الأنشطة والتكليف","التحويل إلى فرصة","المتابعة"],
    source:"القسم",leadSource:"المبيعات · العملاء المحتملون",accountSource:"المبيعات · حسابات العملاء",
    summary:"السجل الأساسي",related:"الأنشطة المرتبطة",noLinks:"لم تُوصّل سجلات الارتباط بعد",
    security:"تُجلب معلومات هذا السجل من واجهة IOETI محدودة الحقول وفق صلاحيات الخادم.",
    convert:"تحويل إلى حساب وفرصة",converted:"تم التحويل",openAccount:"فتح الحساب",openOpportunity:"فتح الفرصة",
    accountRelated:"الفرص وجهات الاتصال المرتبطة بهذا الحساب ضمن صلاحياتك",
    lostLead:"عميل محتمل خاسر · أعد فتحه للتحويل",
    qualification:"مرحلة العميل المحتمل والمسؤول عنه ونتيجته",
    editLead:"تعديل البيانات",editAccount:"تعديل الحساب",addContact:"إضافة جهة اتصال",planVisit:"خطط زيارة",
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
    leadLiveDesc:"Qualification, consent, follow-ups and documents for this lead, within your permissions.",
    accountLiveDesc:"Opportunities, quotations, contracts and documents of this account, within your permissions.",
    convertedDesc:"This lead was converted; follow-up continues on the account and the opportunity.",
    connection:"Related data not connected yet",
    connectionDesc:"No invented opportunities, contracts or interactions. This will be connected after source and permission verification.",
    accountFlow:["Opportunities","Quotes & contracts","Delivery & certificates","Billing & follow-up"],
    leadFlow:["Contact & qualification","Activities & assignment","Convert to opportunity","Follow-up"],
    source:"Section",leadSource:"Sales · Leads",accountSource:"Sales · Accounts",
    summary:"Core record",related:"Related operations",noLinks:"Related records have not been connected yet",
    security:"This profile loads only allowlisted IOETI API fields subject to server permissions.",
    convert:"Convert to account & opportunity",converted:"Converted",openAccount:"Open account",openOpportunity:"Open opportunity",
    accountRelated:"Opportunities and contacts of this account within your permissions",
    lostLead:"Lost lead · reopen it to convert",
    qualification:"Stage, ownership and outcome of this lead",
    editLead:"Edit details",editAccount:"Edit account",addContact:"Add contact",planVisit:"Plan a visit",
  },
} as const;
function isLead(record:RecordItem):record is LeadSummary{return "organization" in record;}
function classification(item:AccountSummary,l:typeof strings.ar|typeof strings.en){
  if(item.customer&&item.prospect)return l.both;
  if(item.customer)return l.customer;
  if(item.prospect)return l.prospect;
  return l.empty;
}
export function RecordWorkspace({kind,language,record,onBack,onPrevious,onNext,onRecordChanged}:Props){
  const ar=language==="ar";
  const l=strings[language];
  const lead=isLead(record);
  const BackArrow=ar?ArrowRight:ArrowLeft;
  const NextArrow=ar?ChevronLeft:ChevronRight;
  const PreviousArrow=ar?ChevronRight:ChevronLeft;
  const heading=useRef<HTMLHeadingElement>(null);
  const [dialog,setDialog]=useState<"lead"|"account"|"contact"|"visit"|null>(null);
  useEffect(()=>{heading.current?.focus();window.scrollTo({top:0,behavior:"instant"});},[record.id]);
  // logging an activity or adding a contact moves the record's version: read it again
  const reload=async()=>{try{onRecordChanged?.(lead?await getLead(record.id):await getAccount(record.id));}catch{/* the panel shows its own error */}};
  const editableLead=lead&&!DEMO_MODE&&record.version!=null&&!record.converted;
  const liveAccount=!lead&&!DEMO_MODE&&record.version!=null;
  const typeLabel=kind==="leads"?l.lead:l.account;
  const status=lead?(record.stage?stageLabel(record.stage,language):l.empty):classification(record,l);
  const summary=lead?[
    [l.organization,record.organization||l.empty],
    [l.stage,record.stage?stageLabel(record.stage,language):l.empty],
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
        <p className="record-hero-description">{DEMO_MODE?(lead?l.leadJourneyDesc:l.accountJourneyDesc):(lead?l.leadLiveDesc:l.accountLiveDesc)}</p>
      </div>
      <div className="record-hero-actions">
        {(editableLead||liveAccount)&&<div className="record-quick-actions">
          {editableLead&&<button type="button" className="btn btn-secondary" onClick={()=>setDialog("lead")}><Pencil size={16}/>{l.editLead}</button>}
          {liveAccount&&<button type="button" className="btn btn-secondary" onClick={()=>setDialog("account")}><Pencil size={16}/>{l.editAccount}</button>}
          {liveAccount&&<button type="button" className="btn btn-secondary" onClick={()=>setDialog("contact")}><UserPlus size={16}/>{l.addContact}</button>}
          {liveAccount&&<button type="button" className="btn btn-secondary" onClick={()=>setDialog("visit")}><MapPin size={16}/>{l.planVisit}</button>}
        </div>}
        {lead&&!DEMO_MODE&&record.converted?<div className="record-paging">
          <span className="record-readonly-pill"><BadgeCheck size={14}/>{l.converted}</span>
          {record.accountId!=null&&<a className="btn btn-secondary" href={"#/accounts/"+record.accountId}><Building2 size={16}/>{l.openAccount}</a>}
          {record.opportunityId!=null&&<a className="btn btn-secondary" href={"#/opportunities/"+record.opportunityId}>{l.openOpportunity}</a>}
        </div>
        :lead&&!DEMO_MODE&&record.version!=null&&record.stageKind==="LOST"?<span className="record-readonly-pill"><LockKeyhole size={14}/>{l.lostLead}</span>
        :lead&&!DEMO_MODE&&record.version!=null?<a className="btn btn-primary" href={"#/leads/"+record.id+"/convert"}><GitMerge size={17}/>{l.convert}</a>
        :!liveAccount&&<span className="record-readonly-pill"><LockKeyhole size={14}/>{l.readonly}</span>}
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
        <div className="record-section-header"><div className="record-section-icon"><Network size={20}/></div><div><h2 id="record-related-heading">{l.related}</h2><p>{!lead&&!DEMO_MODE?l.accountRelated:lead&&!DEMO_MODE&&record.version!=null&&!record.converted?l.qualification:lead?l.leadJourney:l.accountJourney}</p></div></div>
        {!lead&&!DEMO_MODE?<Account360 key={record.id+":"+(record.version??0)} accountId={record.id} language={language}/>
        :lead&&!DEMO_MODE&&record.version!=null&&!record.converted?<LeadQualificationPanel lead={record} language={language} onChanged={updated=>onRecordChanged?.(updated)}/>
        :lead&&!DEMO_MODE&&record.converted?<div className="record-related-empty"><CircleDashed size={28}/><strong>{l.converted}</strong><p>{l.convertedDesc}</p></div>
        :<div className="record-related-empty"><CircleDashed size={28}/><strong>{l.connection}</strong><p>{l.connectionDesc}</p></div>}
      </section>
    </div>
    {lead&&!DEMO_MODE&&record.version!=null&&<section className="record-content-card record-engagement">
      <LeadEngagementPanel lead={record} language={language} onLeadChanged={updated=>onRecordChanged?.(updated)}/>
    </section>}
    {!DEMO_MODE&&record.version!=null&&<section className="record-content-card record-activities">
      <ActivityPanel record={lead?"LEAD":"ACCOUNT"} recordId={record.id} version={lead&&record.converted?null:record.version} language={language} onChanged={reload}/>
    </section>}
    {!DEMO_MODE&&<section className="record-content-card record-documents">
      <DocumentsPanel subject={lead?"LEAD":"ACCOUNT"} subjectId={record.id} language={language}/>
      {lead&&<OutboxPanel leadId={record.id} language={language}/>}
      <MentionForm subject={lead?"LEAD":"ACCOUNT"} subjectId={record.id} language={language}/>
    </section>}
    {DEMO_MODE&&<section className="record-flow-card" aria-labelledby="record-flow-heading">
      <div className="record-flow-title"><div className="record-section-icon"><FileClock size={20}/></div><div><h2 id="record-flow-heading">{lead?l.leadJourney:l.accountJourney}</h2><p>{l.connectionDesc}</p></div></div>
      <div className="record-flow-stages">{flow.map((label,index)=><div className="record-flow-stage" key={label}><span className="record-flow-step">{String(index+1).padStart(2,"0")}</span><span>{label}</span><span className="record-flow-pending">{l.connection}</span></div>)}</div>
    </section>}
    {dialog==="lead"&&lead&&<EditLeadDialog lead={record} language={language} onClose={()=>setDialog(null)} onSaved={next=>{setDialog(null);onRecordChanged?.(next);}}/>}
    {dialog==="account"&&!lead&&<AccountDialog account={record} language={language} onClose={()=>setDialog(null)} onSaved={next=>{setDialog(null);onRecordChanged?.(next);}}/>}
    {dialog==="visit"&&!lead&&<NewVisitDialog language={language} account={{id:record.id,name:record.name}} onClose={()=>setDialog(null)} onSaved={v=>{setDialog(null);window.location.hash="#/visits/"+v.id;}}/>}
    {dialog==="contact"&&!lead&&<ContactDialog account={record} language={language} onClose={()=>setDialog(null)} onSaved={()=>{setDialog(null);void reload();}}/>}
  </article>;
}
