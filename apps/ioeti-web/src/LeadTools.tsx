import { useCallback, useEffect, useState } from "react";
import { PhoneFilters } from "./PhoneFilters";
import { WhenChips, localValue, nextWorkingMorning } from "./WhenChips";
import { BellRing, CalendarClock, CheckCircle2, CircleAlert, History, LockKeyhole, Megaphone, Plus, Save, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { ApiError, getBusinessLines, getLead, getLeadStages, type BusinessLine, type LeadStage, type LeadSummary } from "./api";
import {
  attributeCampaign, deleteView, findDuplicates, getAttribution, getCampaigns, getConsents, getFollowUps, getSavedViews, getSources,
  getTimeline, markFollowUpDone, planFollowUp, recordConsent, recordLead, saveView,
  type Attribution, type Channel, type ConsentMethod, type ConsentState, type FollowUp, type FollowUpType, type LeadIntake,
  type LeadQuery, type Option, type SavedView, type TimelineItem,
} from "./marketingApi";
import { GovernorateOptions } from "./governorates";
import type { Language } from "./preferences";
import "./marketing.css";

const strings = {
  ar: {
    stage:"المرحلة",source:"المصدر",line:"خط العمل",all:"الكل",mine:"المكلّفون بي فقط",views:"العروض المحفوظة",chooseView:"اختر عرضًا محفوظًا",
    saveView:"حفظ الفلتر",viewName:"اسم العرض",deleteView:"حذف العرض",save:"حفظ",cancel:"إلغاء",
    newLead:"عميل محتمل جديد",firstName:"الاسم الأول",name:"الاسم أو اسم العائلة",organization:"الجهة",email:"البريد الإلكتروني",phone:"الهاتف",
    campaign:"الحملة",governorate:"المحافظة",keepMine:"أنا هتابعه بنفسي",keepMineHint:"من غير كده، لو خط الأعمال ليه قواعد توزيع، الـ lead بيتوزع على الفريق بالدور.",none:"بدون",record:"تسجيل",recording:"جار التسجيل...",
    duplicates:"عملاء محتملون مشابهون ضمن نطاقك",duplicatesHint:"راجعهم قبل التسجيل؛ المقارنة تشمل الاسم بكل طرق كتابته والبريد والهاتف.",
    open:"فتح",recordAnyway:"ليس تكرارًا، سجّل",
    followUps:"المتابعات",overdueOnly:"المتأخرة فقط",noFollowUps:"لا توجد متابعات مخططة",done:"تم",overdue:"متأخرة",
    types:{CALL:"مكالمة",MEETING:"اجتماع",TASK:"مهمة",OTHER:"نشاط"},
    consent:"الموافقة على التواصل",channel:"القناة",type:"النوع",channels:{EMAIL:"البريد الإلكتروني",CALL:"الاتصال"},allowed:"مسموح",optedOut:"رفض التواصل",
    methods:{WRITTEN:"نموذج مكتوب",EMAIL:"بريد إلكتروني",WEB_FORM:"نموذج على الموقع",PHONE:"مكالمة هاتفية",IN_PERSON:"حضوريًا"},
    give:"تسجيل موافقة",withdraw:"تسجيل رفض",method:"الطريقة",evidence:"مرجع الإثبات",evidenceHint:"مطلوب للموافقة؛ غير مطلوب للرفض.",
    history:"سجل الموافقات",noHistory:"لا توجد موافقات مسجلة",
    attribution:"المصدر والحملات",noSource:"بدون مصدر",noCampaigns:"غير مرتبط بحملة",attribute:"ربط بحملة",
    plan:"تخطيط متابعة",subject:"الموضوع",when:"الموعد",timeline:"النشاط",noTimeline:"لا يوجد نشاط بعد",
    kinds:{CONSENT_GIVEN:"موافقة",OPTED_OUT:"رفض التواصل"},status:{PLANNED:"مخططة",DONE:"تمت",CANCELLED:"ملغاة"},
    outbound:"لا يُرسل النظام أي رسالة. التوزيع بقواعد خط الأعمال وبالدور جوه الفريق، وأهداف الاستجابة بساعات العمل (D-12)؛ مدير الخط بيوصله إشعار داخلي. الـ lead اللي ليه مسؤول عمره ما بيتنقل تلقائي.",noSend:"هذه الصفحة تسجّل فقط؛ لا يُرسل منها أي بريد أو رسالة للعميل.",
    loading:"جار التحميل...",
    errors:{POSSIBLE_DUPLICATE:"يوجد عملاء محتملون مشابهون.",ALREADY_ATTRIBUTED:"العميل مرتبط بهذه الحملة بالفعل.",FOLLOW_UP_STATE:"هذه المتابعة ليست مخططة.",BLOCKED_BY_POLICY:"متوقف حتى اعتماد السياسة.",
      email:"أدخل بريدًا إلكترونيًا صحيحًا.",phone:"أدخل رقم هاتف صحيحًا.",name:"الاسم مطلوب.",evidenceReference:"الموافقة تحتاج مرجع إثبات.",at:"اختر موعدًا صحيحًا.",subject:"الموضوع مطلوب.",
      DUPLICATE:"لديك عرض بهذا الاسم بالفعل.",conflict:"تم تعديل البيانات من مكان آخر؛ حدّثناها، أعد المحاولة.",denied:"ليست لديك صلاحية لهذا الإجراء.",failed:"تعذّر تنفيذ الطلب."},
  },
  en: {
    stage:"Stage",source:"Source",line:"Business line",all:"All",mine:"Only mine",views:"Saved views",chooseView:"Choose a saved view",
    saveView:"Save filter",viewName:"View name",deleteView:"Delete view",save:"Save",cancel:"Cancel",
    newLead:"New lead",firstName:"First name",name:"Name or family name",organization:"Organization",email:"E-mail",phone:"Phone",
    campaign:"Campaign",governorate:"Governorate",keepMine:"I will follow it up myself",keepMineHint:"Otherwise, when the business line has routing rules, the lead goes to its team in turn.",none:"None",record:"Record",recording:"Recording...",
    duplicates:"Similar leads in your scope",duplicatesHint:"Review them first; names are compared however they are spelled, with e-mail and phone.",
    open:"Open",recordAnyway:"Not a duplicate, record",
    followUps:"Follow-ups",overdueOnly:"Overdue only",noFollowUps:"No planned follow-ups",done:"Done",overdue:"Overdue",
    types:{CALL:"Call",MEETING:"Meeting",TASK:"Task",OTHER:"Activity"},
    consent:"Contact consent",channel:"Channel",type:"Type",channels:{EMAIL:"E-mail",CALL:"Calls"},allowed:"Allowed",optedOut:"Opted out",
    methods:{WRITTEN:"Written form",EMAIL:"E-mail",WEB_FORM:"Web form",PHONE:"Phone call",IN_PERSON:"In person"},
    give:"Record consent",withdraw:"Record opt-out",method:"Method",evidence:"Evidence reference",evidenceHint:"Required for consent; not for an opt-out.",
    history:"Consent history",noHistory:"No consent recorded",
    attribution:"Source and campaigns",noSource:"No source",noCampaigns:"Not attributed to a campaign",attribute:"Attribute to campaign",
    plan:"Plan a follow-up",subject:"Subject",when:"When",timeline:"Activity",noTimeline:"No activity yet",
    kinds:{CONSENT_GIVEN:"Consent",OPTED_OUT:"Opt-out"},status:{PLANNED:"Planned",DONE:"Done",CANCELLED:"Cancelled"},
    outbound:"Nothing is sent to anyone. Leads are routed by the line's rules, in turn inside the team, and response targets run in working hours (D-12); the line's manager gets in-app notices. A lead that has an owner is never moved automatically.",noSend:"This page only records; no e-mail or message is sent to the lead from here.",
    loading:"Loading...",
    errors:{POSSIBLE_DUPLICATE:"Similar leads exist.",ALREADY_ATTRIBUTED:"The lead is already attributed to this campaign.",FOLLOW_UP_STATE:"This follow-up is not planned.",BLOCKED_BY_POLICY:"Blocked until the policy is signed.",
      email:"Enter a valid e-mail address.",phone:"Enter a valid phone number.",name:"The name is required.",evidenceReference:"Consent needs an evidence reference.",at:"Choose a valid date and time.",subject:"The subject is required.",
      DUPLICATE:"You already have a view with this name.",conflict:"The data changed elsewhere; it is refreshed, try again.",denied:"You do not have permission for this action.",failed:"The request failed."},
  },
} as const;
type Labels = typeof strings.ar | typeof strings.en;

function message(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.errors.failed;
  const errors = l.errors as Record<string, string>;
  const field = error.fields[0];
  if (field && (errors[field.field] || errors[field.code])) return errors[field.code] || errors[field.field];
  if (error.code && errors[error.code]) return errors[error.code];
  if (error.statusCode === 409) return l.errors.conflict;
  if (error.statusCode === 403 || error.statusCode === 404) return l.errors.denied;
  return l.errors.failed;
}
const stamp = (value: string | null) => value ? value.replace("T", " ").slice(0, 16) : "—";
const optional = <T,>(load: () => Promise<T[]>) => load().catch(() => [] as T[]);
const lineName = (line: BusinessLine, ar: boolean) => ar ? line.nameAr : line.nameEn;

/** Server-side lead filters and the caller's own saved views. */
export function LeadFilterBar({query,onChange,language}:{query:LeadQuery; onChange:(query:LeadQuery)=>void; language:Language}){
  const l=strings[language];
  const ar=language==="ar";
  const [stages,setStages]=useState<LeadStage[]>([]);
  const [sources,setSources]=useState<Option[]>([]);
  const [lines,setLines]=useState<BusinessLine[]>([]);
  const [views,setViews]=useState<SavedView[]>([]);
  const [viewId,setViewId]=useState("");
  const [naming,setNaming]=useState(false);
  const [name,setName]=useState("");
  const [error,setError]=useState("");
  useEffect(()=>{
    let current=true;
    void Promise.all([optional(getLeadStages),optional(getSources),optional(getBusinessLines),optional(getSavedViews)])
      .then(([s,src,ln,v])=>{if(current){setStages(s);setSources(src);setLines(ln);setViews(v);}});
    return()=>{current=false;};
  },[]);
  const set=(patch:Partial<LeadQuery>)=>{setViewId("");onChange({...query,...patch});};
  function apply(id:string){
    setViewId(id);
    const view=views.find(v=>String(v.id)===id);
    if(view)onChange({q:view.searchText??"",stageId:view.stageId??undefined,sourceId:view.sourceId??undefined,businessLine:view.businessLineCode??undefined,mine:view.onlyMine});
  }
  async function store(){
    setError("");
    try{
      const saved=await saveView(name,query);
      setViews(current=>[...current,saved].sort((a,b)=>a.name.localeCompare(b.name)));
      setViewId(String(saved.id));setNaming(false);setName("");
    }catch(e){setError(message(e,l));}
  }
  async function remove(){
    const id=Number(viewId);
    if(!id)return;
    setError("");
    try{await deleteView(id);setViews(current=>current.filter(v=>v.id!==id));setViewId("");}
    catch(e){setError(message(e,l));}
  }
  const active=[query.stageId,query.sourceId,query.businessLine,query.mine||undefined].filter(v=>v!=null&&v!=="").length;
  return <PhoneFilters label={ar?"فلترة":"Filters"} active={active}><div className="mk-filters">
    <label><span>{l.stage}</span><select value={query.stageId??""} onChange={e=>set({stageId:e.target.value?Number(e.target.value):undefined})}>
      <option value="">{l.all}</option>{stages.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label><span>{l.source}</span><select value={query.sourceId??""} onChange={e=>set({sourceId:e.target.value?Number(e.target.value):undefined})}>
      <option value="">{l.all}</option>{sources.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label><span>{l.line}</span><select value={query.businessLine??""} onChange={e=>set({businessLine:e.target.value||undefined})}>
      <option value="">{l.all}</option>{lines.map(line=><option key={line.code} value={line.code}>{lineName(line,ar)}</option>)}</select></label>
    <label className="mk-check"><input type="checkbox" checked={!!query.mine} onChange={e=>set({mine:e.target.checked})}/><span>{l.mine}</span></label>
    <label><span>{l.views}</span><select aria-label={l.views} value={viewId} onChange={e=>apply(e.target.value)}>
      <option value="">{l.chooseView}</option>{views.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
    {viewId&&<button type="button" className="btn btn-secondary" onClick={()=>void remove()}><Trash2 size={15}/>{l.deleteView}</button>}
    {naming
      ?<form className="mk-inline" onSubmit={e=>{e.preventDefault();void store();}}>
        <label><span className="sr-only">{l.viewName}</span><input value={name} maxLength={80} required placeholder={l.viewName} onChange={e=>setName(e.target.value)}/></label>
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>{l.save}</button>
        <button type="button" className="btn btn-secondary" onClick={()=>{setNaming(false);setName("");}}>{l.cancel}</button>
      </form>
      :<button type="button" className="btn btn-secondary" onClick={()=>setNaming(true)}><Save size={15}/>{l.saveView}</button>}
    {error&&<p className="mk-error" role="alert"><CircleAlert size={15}/>{error}</p>}
  </div></PhoneFilters>;
}

/** New lead with a duplicate review: the server answers 409 POSSIBLE_DUPLICATE until the user confirms. */
export function LeadIntakePanel({language,onRecorded,onClose}:{language:Language; onRecorded:(lead:LeadSummary)=>void; onClose:()=>void}){
  const l=strings[language];
  const ar=language==="ar";
  const [form,setForm]=useState<LeadIntake>({name:""});
  const [lines,setLines]=useState<BusinessLine[]>([]);
  const [sources,setSources]=useState<Option[]>([]);
  const [campaigns,setCampaigns]=useState<Option[]>([]);
  const [similar,setSimilar]=useState<LeadSummary[]|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    let current=true;
    void Promise.all([optional(getBusinessLines),optional(getSources),optional(getCampaigns)])
      .then(([ln,src,c])=>{if(current){setLines(ln);setSources(src);setCampaigns(c);}});
    return()=>{current=false;};
  },[]);
  const field=(key:keyof LeadIntake)=>(e:{target:{value:string}})=>{setSimilar(null);setForm(f=>({...f,[key]:e.target.value||undefined}));};
  async function submit(confirm:boolean){
    if(busy)return;
    setBusy(true);setError("");
    try{onRecorded(await recordLead({...form,name:form.name??"",confirmNotDuplicate:confirm}));}
    catch(e){
      if(e instanceof ApiError&&e.code==="POSSIBLE_DUPLICATE"){
        try{setSimilar(await findDuplicates(form));}catch(inner){setError(message(inner,l));}
      }else setError(message(e,l));
    }finally{setBusy(false);}
  }
  return <section className="mk-intake" aria-labelledby="mk-intake-title">
    <h2 id="mk-intake-title"><UserPlus size={18}/>{l.newLead}</h2>
    <form onSubmit={e=>{e.preventDefault();void submit(false);}}>
      <div className="mk-grid">
        <label><span>{l.firstName}</span><input value={form.firstName??""} maxLength={255} onChange={field("firstName")}/></label>
        <label><span>{l.name}</span><input value={form.name??""} maxLength={255} required onChange={e=>{setSimilar(null);setForm(f=>({...f,name:e.target.value}));}}/></label>
        <label><span>{l.organization}</span><input value={form.organization??""} maxLength={255} onChange={field("organization")}/></label>
        <label><span>{l.email}</span><input type="email" dir="ltr" value={form.email??""} maxLength={255} onChange={field("email")}/></label>
        <label><span>{l.phone}</span><input type="tel" dir="ltr" value={form.phone??""} maxLength={20} onChange={field("phone")}/></label>
        <label><span>{l.line}</span><select value={form.businessLineCode??""} onChange={field("businessLineCode")}>
          <option value="">{l.none}</option>{lines.map(line=><option key={line.code} value={line.code}>{lineName(line,ar)}</option>)}</select></label>
        <label><span>{l.source}</span><select value={form.sourceId??""} onChange={e=>setForm(f=>({...f,sourceId:e.target.value?Number(e.target.value):undefined}))}>
          <option value="">{l.none}</option>{sources.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label><span>{l.governorate}</span><select value={form.governorate??""} onChange={field("governorate")}><GovernorateOptions ar={ar} none={l.none}/></select></label>
        {campaigns.length>0&&<label><span>{l.campaign}</span><select value={form.campaignId??""} onChange={e=>setForm(f=>({...f,campaignId:e.target.value?Number(e.target.value):undefined}))}>
          <option value="">{l.none}</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      </div>
      <label className="mk-keep"><input type="checkbox" checked={!!form.keepMine} onChange={e=>setForm(f=>({...f,keepMine:e.target.checked||undefined}))}/>
        <span>{l.keepMine}<small>{l.keepMineHint}</small></span></label>
      {error&&<p className="mk-error" role="alert"><CircleAlert size={15}/>{error}</p>}
      {similar&&<div className="mk-duplicates" role="region" aria-label={l.duplicates}>
        <strong>{l.duplicates}</strong><p className="wf-muted">{l.duplicatesHint}</p>
        <ul>{similar.map(lead=><li key={lead.id}><span>{lead.name}<small>{lead.organization||"—"} · {lead.stage||"—"}</small></span><a href={`#/leads/${lead.id}`}>{l.open}</a></li>)}</ul>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void submit(true)}>{l.recordAnyway}</button>
      </div>}
      <div className="mk-actions">
        <button type="submit" className="btn btn-primary" disabled={busy||!form.name?.trim()||!!similar}><Plus size={15}/>{busy?l.recording:l.record}</button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>{l.cancel}</button>
      </div>
    </form>
  </section>;
}

/** The caller's planned lead follow-ups (native CRM events), overdue first. */
export function FollowUpQueue({language}:{language:Language}){
  const l=strings[language];
  const [overdueOnly,setOverdueOnly]=useState(false);
  const [rows,setRows]=useState<FollowUp[]|null>(null);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{
    setError("");
    try{setRows(await getFollowUps(overdueOnly));}catch(e){setRows([]);setError(message(e,l));}
  },[overdueOnly,l]);
  useEffect(()=>{void load();},[load]);
  async function done(row:FollowUp){
    setError("");
    try{await markFollowUpDone(row.id,row.version);await load();}
    catch(e){setError(message(e,l));await load();}
  }
  return <section className="mk-queue" aria-labelledby="mk-queue-title">
    <div className="mk-queue-head"><h2 id="mk-queue-title"><BellRing size={18}/>{l.followUps}</h2>
      <label className="mk-check"><input type="checkbox" checked={overdueOnly} onChange={e=>setOverdueOnly(e.target.checked)}/><span>{l.overdueOnly}</span></label></div>
    {error&&<p className="mk-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    {rows===null?<p className="wf-muted" role="status">{l.loading}</p>:rows.length===0?<p className="wf-muted">{l.noFollowUps}</p>:
    <ul className="wf-list">{rows.map(row=><li key={row.id} className={row.overdue?"mk-overdue":undefined}>
      <span><strong>{l.types[row.type]}</strong> · {row.subject}<small className="mk-sub">{stamp(row.at)}{row.overdue?` · ${l.overdue}`:""} · <a href={`#/leads/${row.leadId}`}>{row.leadName||"—"}</a></small></span>
      <button type="button" className="btn btn-secondary" onClick={()=>void done(row)}><CheckCircle2 size={15}/>{l.done}</button>
    </li>)}</ul>}
    <p className="wf-muted"><LockKeyhole size={13}/> {l.outbound}</p>
  </section>;
}

/** Consent, attribution, follow-ups and the activity timeline of one live lead. */
export function LeadEngagementPanel({lead,language,onLeadChanged}:{lead:LeadSummary; language:Language; onLeadChanged:(lead:LeadSummary)=>void}){
  const l=strings[language];
  const [consent,setConsent]=useState<ConsentState|null>(null);
  const [attribution,setAttribution]=useState<Attribution|null>(null);
  const [campaigns,setCampaigns]=useState<Option[]>([]);
  const [timeline,setTimeline]=useState<TimelineItem[]>([]);
  const [channel,setChannel]=useState<Channel>("EMAIL");
  const [method,setMethod]=useState<ConsentMethod>("WRITTEN");
  const [evidence,setEvidence]=useState("");
  const [campaignId,setCampaignId]=useState("");
  const [type,setType]=useState<FollowUpType>("CALL");
  const [subject,setSubject]=useState("");
  const [at,setAt]=useState(()=>localValue(nextWorkingMorning()));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [loadError,setLoadError]=useState("");
  const load=useCallback(async()=>{
    const [c,a,t]=await Promise.all([getConsents(lead.id),getAttribution(lead.id),getTimeline(lead.id)]);
    setConsent(c);setAttribution(a);setTimeline(t);
  },[lead.id]);
  useEffect(()=>{
    let current=true;
    setLoadError("");
    load().catch(e=>{if(current)setLoadError(message(e,l));});
    void optional(getCampaigns).then(c=>{if(current)setCampaigns(c);});
    return()=>{current=false;};
  },[load,l]);
  async function run(action:(version:number)=>Promise<unknown>,reset:()=>void){
    if(busy||lead.version==null)return;
    setBusy(true);setError("");
    try{await action(lead.version);reset();}
    catch(e){setError(message(e,l));}
    finally{
      // every change bumps the lead's version; reload it and the panel either way
      try{onLeadChanged(await getLead(lead.id));await load();}catch{/* the error above is shown */}
      setBusy(false);
    }
  }
  const state=(c:Channel)=>consent?.channels.find(x=>x.channel===c);
  return <section className="mk-engagement" aria-labelledby="mk-engagement-title">
    <h2 id="mk-engagement-title" className="sr-only">{l.consent}</h2>
    {error&&<p className="mk-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    {loadError&&<p className="mk-error"><CircleAlert size={15}/>{loadError}</p>}
    <div className="mk-columns">
      <div className="wf-block">
        <h4><ShieldCheck size={16}/>{l.consent}</h4>
        <ul className="mk-channels">{(["EMAIL","CALL"] as Channel[]).map(c=><li key={c}><span>{l.channels[c]}</span>
          <span className={state(c)?.allowed===false?"wf-status mk-out":"wf-status mk-in"}>{state(c)==null?"—":state(c)!.allowed?l.allowed:l.optedOut}</span></li>)}</ul>
        <form className="mk-form" onSubmit={e=>e.preventDefault()}>
          <label><span>{l.channel}</span><select value={channel} onChange={e=>setChannel(e.target.value as Channel)}>
            {(["EMAIL","CALL"] as Channel[]).map(c=><option key={c} value={c}>{l.channels[c]}</option>)}</select></label>
          <label><span>{l.method}</span><select value={method} onChange={e=>setMethod(e.target.value as ConsentMethod)}>
            {(Object.keys(l.methods) as ConsentMethod[]).map(m=><option key={m} value={m}>{l.methods[m]}</option>)}</select></label>
          <label><span>{l.evidence}</span><input value={evidence} maxLength={255} onChange={e=>setEvidence(e.target.value)}/><small className="wf-muted">{l.evidenceHint}</small></label>
          <div className="mk-actions">
            <button type="button" className="btn btn-primary" disabled={busy||!evidence.trim()} onClick={()=>void run(v=>recordConsent(lead.id,v,channel,true,method,evidence),()=>setEvidence(""))}>{l.give}</button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void run(v=>recordConsent(lead.id,v,channel,false,method,evidence),()=>setEvidence(""))}>{l.withdraw}</button>
          </div>
        </form>
        <h4><History size={16}/>{l.history}</h4>
        {!consent||consent.history.length===0?<p className="wf-muted">{l.noHistory}</p>:
        <ul className="wf-trail">{consent.history.map(h=><li key={h.id}>{l.channels[h.channel]}: {h.allowed?l.allowed:l.optedOut} · {l.methods[h.method]}{h.evidenceReference?` · ${h.evidenceReference}`:""}
          <small>{h.recordedBy||"—"} · {stamp(h.at)}</small></li>)}</ul>}
      </div>
      <div className="wf-block">
        <h4><Megaphone size={16}/>{l.attribution}</h4>
        <p className="mk-source">{l.source}: <strong>{attribution?.sourceName||l.noSource}</strong></p>
        {attribution&&attribution.campaigns.length===0?<p className="wf-muted">{l.noCampaigns}</p>:
        <ul className="mk-tags">{attribution?.campaigns.map(c=><li key={c.id}>{c.name}</li>)}</ul>}
        {campaigns.length>0&&<form className="mk-inline" onSubmit={e=>{e.preventDefault();void run(v=>attributeCampaign(lead.id,v,Number(campaignId)),()=>setCampaignId(""));}}>
          <label><span className="sr-only">{l.campaign}</span><select aria-label={l.campaign} value={campaignId} onChange={e=>setCampaignId(e.target.value)}>
            <option value="">{l.campaign}</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <button type="submit" className="btn btn-secondary" disabled={busy||!campaignId}>{l.attribute}</button>
        </form>}
        <h4><CalendarClock size={16}/>{l.plan}</h4>
        <form className="mk-form" onSubmit={e=>{e.preventDefault();void run(v=>planFollowUp(lead.id,v,type,subject,at),()=>{setSubject("");setAt(localValue(nextWorkingMorning()));});}}>
          <label><span>{l.type}</span><select value={type} onChange={e=>setType(e.target.value as FollowUpType)}>
            {(["CALL","MEETING","TASK"] as FollowUpType[]).map(t=><option key={t} value={t}>{l.types[t]}</option>)}</select></label>
          <label><span>{l.subject}</span><input value={subject} maxLength={255} required onChange={e=>setSubject(e.target.value)}/></label>
          <div className="when-field"><label><span>{l.when}</span><input type="datetime-local" value={at} required onChange={e=>setAt(e.target.value)}/></label>
            <WhenChips language={language} onPick={setAt}/></div>
          <div className="mk-actions"><button type="submit" className="btn btn-primary" disabled={busy||!subject.trim()||!at}>{l.plan}</button></div>
        </form>
      </div>
    </div>
    <div className="wf-block">
      <h4><History size={16}/>{l.timeline}</h4>
      {timeline.length===0?<p className="wf-muted">{l.noTimeline}</p>:
      <ul className="wf-trail mk-timeline">{timeline.map((item,i)=>{
        const activity=item.kind.startsWith("ACTIVITY_")?item.kind.slice(9) as FollowUpType|"OTHER":null;
        const kind=activity?l.types[activity]:(l.kinds as Record<string,string>)[item.kind]??item.kind;
        const label=activity?item.label:(l.channels as Record<string,string>)[item.label??""]??item.label;
        return <li key={`${item.kind}-${item.eventId??i}-${item.at}`}><strong>{kind}</strong>{label?` · ${label}`:""}{item.status?` · ${(l.status as Record<string,string>)[item.status]??item.status}`:""}
          <small>{item.actorName||"—"} · {stamp(item.at)}</small></li>;})}</ul>}
    </div>
    <p className="wf-muted"><LockKeyhole size={13}/> {l.noSend}</p>
  </section>;
}
