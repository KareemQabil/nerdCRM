import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, CircleDashed, ClipboardCheck, ClipboardList, History, LockKeyhole, Plus,
  RefreshCw, Send, Undo2, UserRoundCog, Workflow, XCircle,
} from "lucide-react";
import { ApiError, getBusinessLines, type BusinessLine } from "./api";
import {
  accept, addRequirement, addTask, completeItem, completeTask, getEngagement, getEngagements, getEvents, getHandover, getHandovers,
  getPeople, getReadyContracts, getRequirements, getTasks, reject, requestHandover, resubmit, retireRequirement, sendBack, transfer,
  type ContractOption, type Engagement, type Handover, type HandoverEvent, type HandoverStatus, type Person, type Reason, type Requirement, type Task,
} from "./operationsApi";
import type { Language } from "./preferences";
import "./operations.css";
import { ErrorBanner, PageHeader } from "./ui";

const strings = {
  ar: {
    title:"التسليم والتشغيل",desc:"تسليم العقود الموقعة من المبيعات إلى فريق التشغيل، ثم متابعة المشروع التنفيذي ومهامه.",
    tabs:{handovers:"طلبات التسليم",engagements:"المشروعات التنفيذية",checklists:"قوائم التسليم"},
    loading:"جار التحميل...",retry:"إعادة المحاولة",open:"فتح",back:"العودة إلى التشغيل",empty:"لا يوجد",allStatuses:"كل الحالات",
    status:{SUBMITTED:"بانتظار المراجعة",REWORK_REQUESTED:"مطلوب استكمال",ACCEPTED:"مقبول",REJECTED:"مرفوض"},
    noHandovers:"لا توجد طلبات تسليم",request:"طلب تسليم عقد",chooseContract:"اختر عقدًا ساريًا",requestAction:"إرسال للتشغيل",
    noReady:"لا توجد عقود سارية جاهزة للتسليم. العقد بيبقى ساري لما المسؤول عن التفعيل يفعّله على النسخة الموقّعة (D-11).",
    contract:"العقد",client:"العميل",line:"خط الأعمال",requestedBy:"مقدم الطلب",reviewedBy:"المراجع",lead:"مسؤول التشغيل",
    checklist:"قائمة التسليم",required:"مطلوب",optional:"اختياري",done:"تم",evidence:"مرجع الإثبات",markDone:"تم",missing:"بنود مطلوبة متبقية",
    review:"مراجعة التشغيل",reason:"السبب",reasons:{MISSING_SCOPE:"نطاق العمل غير مكتمل",MISSING_DOCUMENTS:"مستندات ناقصة",NO_CAPACITY:"لا توجد سعة تشغيلية",CLIENT_NOT_READY:"العميل غير جاهز",OTHER:"سبب آخر"},
    rework:"إعادة للاستكمال",rejectAction:"رفض",resubmit:"إعادة الإرسال",acceptAction:"قبول وإنشاء المشروع",chooseLead:"اختر مسؤول التشغيل",startDate:"تاريخ البدء",
    acceptNote:"القبول يتطلب إتمام كل البنود المطلوبة، وينشئ مشروعًا تنفيذيًا واحدًا مرتبطًا بهذا الطلب.",
    trail:"سجل القرارات (لا يُعدّل)",events:{SUBMITTED:"أُرسل للتشغيل",ITEM_DONE:"تم بند",REWORK_REQUESTED:"أُعيد للاستكمال",RESUBMITTED:"أُعيد الإرسال",ACCEPTED:"قُبل",REJECTED:"رُفض",ENGAGEMENT_CREATED:"أُنشئ المشروع",OWNER_CHANGED:"نُقلت المسؤولية"},
    engagement:"المشروع التنفيذي",openEngagement:"فتح المشروع",noEngagements:"لا توجد مشروعات تنفيذية",mine:"مشروعاتي فقط",
    progress:"الإنجاز",tasks:"المهام",overdue:"متأخرة",taskName:"المهمة",dueDate:"تاريخ الاستحقاق",assignee:"المسؤول",noAssignee:"بدون",addTask:"إضافة مهمة",
    complete:"إنهاء",transfer:"نقل المسؤولية",transferTo:"إلى",handover:"طلب التسليم",
    requirements:"بنود التسليم لكل خط أعمال",requirement:"البند",mandatory:"مطلوب قبل القبول",order:"الترتيب",addRequirement:"إضافة بند",retire:"إيقاف",
    configNote:"محتوى القوائم يحدده المسؤولون المخولون؛ خط الأعمال بلا قائمة لا يمكنه التسليم.",readonly:"عرض فقط لهذا السجل.",
    errors:{CONTRACT_NOT_ACTIVE:"العقد ليس ساريًا (موقعًا).",HANDOVER_EXISTS:"لهذا العقد طلب تسليم مفتوح أو مقبول.",CHECKLIST_NOT_CONFIGURED:"لا توجد قائمة تسليم لخط الأعمال هذا.",CHECKLIST_INCOMPLETE:"أكمل كل البنود المطلوبة قبل القبول.",HANDOVER_STATE:"هذا الإجراء غير متاح في الحالة الحالية.",ENGAGEMENT_EXISTS:"لهذا الطلب مشروع بالفعل.",SAME_OWNER:"هذا الشخص هو المسؤول بالفعل.",TASK_DONE:"المهمة منتهية بالفعل.",BUSINESS_LINE_REQUIRED:"فرصة العقد بلا خط أعمال.",BLOCKED_BY_POLICY:"متوقف حتى اعتماد السياسة.",conflict:"تم تعديل البيانات من مكان آخر؛ حدّثناها، أعد المحاولة.",invalid:"راجع الحقول المطلوبة وقيمها.",denied:"ليست لديك صلاحية لهذا الإجراء.",failed:"تعذّر تنفيذ الطلب."},
  },
  en: {
    title:"Handover and operations",desc:"Hand signed contracts from sales to operations, then run the engagement and its tasks.",
    tabs:{handovers:"Handovers",engagements:"Engagements",checklists:"Handover checklists"},
    loading:"Loading...",retry:"Retry",open:"Open",back:"Back to operations",empty:"None",allStatuses:"All statuses",
    status:{SUBMITTED:"Awaiting review",REWORK_REQUESTED:"Rework requested",ACCEPTED:"Accepted",REJECTED:"Rejected"},
    noHandovers:"No handovers",request:"Request a handover",chooseContract:"Choose an active contract",requestAction:"Send to operations",
    noReady:"No active contract is ready for handover. A contract becomes active when its signatory activates it on the signed copy (D-11).",
    contract:"Contract",client:"Client",line:"Business line",requestedBy:"Requested by",reviewedBy:"Reviewed by",lead:"Operations lead",
    checklist:"Handover checklist",required:"Required",optional:"Optional",done:"Done",evidence:"Evidence reference",markDone:"Done",missing:"required items left",
    review:"Operations review",reason:"Reason",reasons:{MISSING_SCOPE:"Scope incomplete",MISSING_DOCUMENTS:"Missing documents",NO_CAPACITY:"No delivery capacity",CLIENT_NOT_READY:"Client not ready",OTHER:"Other"},
    rework:"Send back for rework",rejectAction:"Reject",resubmit:"Resubmit",acceptAction:"Accept and create the engagement",chooseLead:"Choose the operations lead",startDate:"Start date",
    acceptNote:"Acceptance needs every required item and creates exactly one engagement linked to this handover.",
    trail:"Decision trail (read only)",events:{SUBMITTED:"Sent to operations",ITEM_DONE:"Item done",REWORK_REQUESTED:"Sent back for rework",RESUBMITTED:"Resubmitted",ACCEPTED:"Accepted",REJECTED:"Rejected",ENGAGEMENT_CREATED:"Engagement created",OWNER_CHANGED:"Ownership transferred"},
    engagement:"Engagement",openEngagement:"Open the engagement",noEngagements:"No engagements",mine:"Mine only",
    progress:"Progress",tasks:"Tasks",overdue:"Overdue",taskName:"Task",dueDate:"Due date",assignee:"Assignee",noAssignee:"Nobody",addTask:"Add task",
    complete:"Complete",transfer:"Transfer ownership",transferTo:"To",handover:"Handover",
    requirements:"Handover items per business line",requirement:"Item",mandatory:"Required before acceptance",order:"Order",addRequirement:"Add item",retire:"Retire",
    configNote:"Authorized administrators define the lists; a business line without one cannot hand over.",readonly:"Read only for this record.",
    errors:{CONTRACT_NOT_ACTIVE:"The contract is not active (signed).",HANDOVER_EXISTS:"This contract already has an open or accepted handover.",CHECKLIST_NOT_CONFIGURED:"This business line has no handover checklist.",CHECKLIST_INCOMPLETE:"Complete every required item before accepting.",HANDOVER_STATE:"This action is not available in the current state.",ENGAGEMENT_EXISTS:"This handover already has an engagement.",SAME_OWNER:"This person already leads the engagement.",TASK_DONE:"This task is already done.",BUSINESS_LINE_REQUIRED:"The contract's opportunity has no business line.",BLOCKED_BY_POLICY:"Blocked until the policy is signed.",conflict:"The data changed elsewhere; it is refreshed, try again.",invalid:"Check the required fields and their values.",denied:"You do not have permission for this action.",failed:"The request failed."},
  },
} as const;
type Labels = typeof strings.ar | typeof strings.en;
const REASONS: Reason[] = ["MISSING_SCOPE","MISSING_DOCUMENTS","NO_CAPACITY","CLIENT_NOT_READY","OTHER"];

function message(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.errors.failed;
  const known = error.code && (l.errors as Record<string, string>)[error.code];
  if (known) return known;
  if (error.statusCode === 409) return l.errors.conflict;
  if (error.statusCode === 422 && error.fields.length) return l.errors.invalid;
  if (error.statusCode === 403 || error.statusCode === 404) return l.errors.denied;
  return l.errors.failed;
}
const today = () => new Date().toISOString().slice(0, 10);
const stamp = (value: string | null) => value ? value.replace("T", " ").slice(0, 16) : "—";
function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/operations\/?/, "").split("/").filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const sync = () => setRoute(read());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return route;
}
function useAction(l: Labels, after: () => Promise<unknown>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = useCallback(async (action: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true); setError("");
    try { await action(); await after(); return true; }
    catch (e) { setError(message(e, l)); void after().catch(() => undefined); return false; }
    finally { setBusy(false); }
  }, [busy, l, after]);
  return { busy, error, run };
}
function Retry({error,onRetry,l}:{error:string;onRetry:()=>void;l:Labels}){
  return <div className="error-banner" role="alert"><CircleAlert size={17}/><span>{error}</span><button type="button" className="btn btn-secondary" onClick={onRetry}><RefreshCw size={15}/>{l.retry}</button></div>;
}

/** Handover and engagement workspace (real mode). */
export function OperationsPage({language}:{language:Language}){
  const l=strings[language];
  const route=useRoute();
  const Back=language==="ar"?ArrowRight:ArrowLeft;
  if(route[0]==="handovers"&&/^\d+$/.test(route[1]||""))return <HandoverRecord key={route[1]} handoverId={Number(route[1])} l={l} Back={Back}/>;
  if(route[0]==="engagements"&&/^\d+$/.test(route[1]||""))return <EngagementRecord key={route[1]} engagementId={Number(route[1])} l={l} Back={Back}/>;
  const tab=(["engagements","checklists"] as const).find(t=>t===route[0])??"handovers";
  return <section className="page-enter ops-page">
    <PageHeader className="directory-head" eyebrow={language==="ar"?"التنفيذ والخدمات":"Delivery & services"} title={l.title} description={l.desc}/>
    <div className="demo-record-tabs ops-tabs" role="tablist" aria-label={l.title}>
      {(["handovers","engagements","checklists"] as const).map(t=><button key={t} type="button" role="tab" aria-selected={tab===t} className={tab===t?"active":""}
        onClick={()=>{window.location.hash=t==="handovers"?"#/operations":"#/operations/"+t;}}>{l.tabs[t]}</button>)}
    </div>
    {tab==="handovers"&&<HandoverRegister l={l}/>}
    {tab==="engagements"&&<EngagementRegister l={l}/>}
    {tab==="checklists"&&<Checklists l={l}/>}
  </section>;
}

function HandoverRegister({l}:{l:Labels}){
  const [status,setStatus]=useState<HandoverStatus|"">("");const [rows,setRows]=useState<Handover[]|null>(null);const [error,setError]=useState("");
  const [ready,setReady]=useState<ContractOption[]|null>(null);const [pick,setPick]=useState("");const [busy,setBusy]=useState(false);const [formError,setFormError]=useState("");
  const load=useCallback(()=>getHandovers(status||undefined).then(r=>{setRows(r);setError("");}),[status]);
  useEffect(()=>{setRows(null);void load().catch(e=>{setRows([]);setError(message(e,l));});},[load,l]);
  useEffect(()=>{void getReadyContracts().then(setReady).catch(()=>setReady([]));},[]);
  return <>
    <section className="record-content-card ops-request" aria-labelledby="ops-request-title">
      <div className="record-section-header"><div className="record-section-icon"><Send size={20}/></div><div><h2 id="ops-request-title">{l.request}</h2></div></div>
      {ready===null?<p className="ops-muted">{l.loading}</p>:ready.length===0?<p className="record-security-note"><LockKeyhole size={15}/>{l.noReady}</p>
      :<form className="opportunity-form ops-form" onSubmit={e=>{e.preventDefault();if(busy)return;setBusy(true);setFormError("");
          requestHandover(Number(pick)).then(h=>{window.location.hash="#/operations/handovers/"+h.id;}).catch(err=>setFormError(message(err,l))).finally(()=>setBusy(false));}}>
        {formError&&<div className="login-error" role="alert"><CircleAlert size={17}/>{formError}</div>}
        <label><span>{l.contract}</span><select required value={pick} onChange={e=>setPick(e.target.value)}><option value="">{l.chooseContract}</option>
          {ready.map(c=><option key={c.id} value={c.id}>{c.reference??c.id} · {c.name??""}{c.clientName?` · ${c.clientName}`:""}</option>)}</select></label>
        <button type="submit" className="btn btn-primary" disabled={busy||!pick}><Send size={16}/>{l.requestAction}</button></form>}
    </section>
    <div className="list-toolbar ops-toolbar"><label><span className="sr-only">{l.allStatuses}</span><select aria-label={l.allStatuses} value={status} onChange={e=>setStatus(e.target.value as HandoverStatus|"")}>
      <option value="">{l.allStatuses}</option>{(Object.keys(l.status) as HandoverStatus[]).map(s=><option key={s} value={s}>{l.status[s]}</option>)}</select></label></div>
    {error&&<Retry error={error} l={l} onRetry={()=>void load().catch(e=>setError(message(e,l)))}/>}
    <div className="data-panel"><div className="data-panel-heading"><strong>{l.tabs.handovers}</strong><span>{rows?.length??0}</span></div>
      {rows===null?<div className="empty-state" role="status">{l.loading}</div>:rows.length===0?<div className="empty-state"><CircleDashed size={26}/>{l.noHandovers}</div>
      :<div className="directory-items">{rows.map(h=><article key={h.id} className="directory-item ops-row">
        <div className="line-monogram">{h.businessLineCode.slice(0,2)}</div>
        <div className="directory-record"><strong>{h.contractName??h.contractReference}</strong><small>{h.clientName??"—"} · <span dir="ltr">{h.contractReference}</span> · {h.requestedBy??"—"}</small></div>
        <span className={"ops-status ops-status-"+h.status.toLowerCase()}>{l.status[h.status]}</span>
        {h.missingRequired>0&&<span className="ops-missing" title={l.missing}>{h.missingRequired}</span>}
        <a className="text-action" href={"#/operations/handovers/"+h.id}>{l.open}</a></article>)}</div>}
    </div>
  </>;
}

function HandoverRecord({handoverId,l,Back}:{handoverId:number;l:Labels;Back:typeof ArrowLeft}){
  const [h,setH]=useState<Handover|null>(null);const [events,setEvents]=useState<HandoverEvent[]>([]);const [loadError,setLoadError]=useState("");
  const [people,setPeople]=useState<Person[]|null>(null);const [lead,setLead]=useState("");const [start,setStart]=useState(today());const [reason,setReason]=useState<Reason>("MISSING_DOCUMENTS");
  const [evidence,setEvidence]=useState<Record<number,string>>({});
  const reload=useCallback(async()=>{const [x,e]=await Promise.all([getHandover(handoverId),getEvents(handoverId).catch(()=>[] as HandoverEvent[])]);setH(x);setEvents(e);},[handoverId]);
  useEffect(()=>{void reload().catch(e=>setLoadError(message(e,l)));void getPeople().then(setPeople).catch(()=>setPeople(null));},[reload,l]);
  const {busy,error,run}=useAction(l,reload);
  if(loadError)return <section className="page-enter"><a className="record-back" href="#/operations"><Back size={17}/>{l.back}</a><ErrorBanner message={loadError}/></section>;
  if(!h)return <div className="empty-state" role="status">{l.loading}</div>;
  const open=h.status==="SUBMITTED"||h.status==="REWORK_REQUESTED";
  const reviewer=people!==null; // the server lists people only to callers who may create engagements
  return <article className="record-workspace page-enter ops-record" aria-labelledby="handover-title">
    <div className="record-context-bar"><a className="record-back" href="#/operations"><Back size={17}/>{l.back}</a><span className="record-context-separator">/</span><span className="record-current" dir="ltr">{h.contractReference}</span></div>
    <div className="record-hero"><div className="record-hero-main"><span className="eyebrow"><span className="record-eyebrow-dot"/>{l.handover} · {h.businessLineCode}</span>
      <div className="record-hero-heading"><div className="record-identity-icon"><ClipboardList size={30}/></div><div><h1 id="handover-title">{h.contractName??h.contractReference}</h1>
        <div className="record-tags"><span className={"ops-status ops-status-"+h.status.toLowerCase()}>{l.status[h.status]}</span><span className="record-ref" dir="ltr">{h.contractReference}</span>
          {h.clientId!=null&&<a className="record-ref" href={"#/accounts/"+h.clientId}>{h.clientName}</a>}
          {h.engagementId!=null&&<a className="record-ref" href={"#/operations/engagements/"+h.engagementId}>{l.openEngagement}</a>}</div></div></div></div>
      <div className="record-hero-actions"><dl className="ops-facts"><div><dt>{l.requestedBy}</dt><dd>{h.requestedBy??"—"}</dd></div><div><dt>{l.reviewedBy}</dt><dd>{h.reviewedBy??"—"}</dd></div><div><dt>{l.lead}</dt><dd>{h.operationsLead??"—"}</dd></div></dl></div></div>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    <section className="record-content-card" aria-labelledby="checklist-title">
      <div className="record-section-header"><div className="record-section-icon"><ClipboardCheck size={20}/></div><div><h2 id="checklist-title">{l.checklist}</h2>{h.missingRequired>0&&<p>{h.missingRequired} {l.missing}</p>}</div></div>
      <ul className="ops-checklist">{h.items.map(i=><li key={i.id} className={i.done?"is-done":""}>
        {i.done?<CheckCircle2 size={17}/>:<CircleDashed size={17}/>}
        <div><strong>{i.title}</strong> <span className="ops-tag">{i.mandatory?l.required:l.optional}</span>
          {i.done&&<small>{i.doneBy??""} · <span dir="ltr">{stamp(i.doneAt)}</span>{i.evidenceReference?<> · <span dir="ltr">{i.evidenceReference}</span></>:null}</small>}</div>
        {open&&!i.done&&<span className="ops-item-action"><label><span className="sr-only">{l.evidence} · {i.title}</span>
          <input dir="ltr" maxLength={255} placeholder={l.evidence} value={evidence[i.id]??""} onChange={e=>setEvidence(v=>({...v,[i.id]:e.target.value}))}/></label>
          <button type="button" className="btn btn-secondary" disabled={busy} aria-label={`${l.markDone}: ${i.title}`} onClick={()=>void run(()=>completeItem(i.id,i.version,evidence[i.id]))}><CheckCircle2 size={15}/>{l.markDone}</button></span>}
      </li>)}</ul>
      {h.status==="REWORK_REQUESTED"&&h.requestedByMe&&<button type="button" className="btn btn-primary" disabled={busy} onClick={()=>void run(()=>resubmit(h.id,h.version))}><Send size={15}/>{l.resubmit}</button>}
    </section>
    {h.status==="SUBMITTED"&&reviewer&&<section className="record-content-card" aria-labelledby="review-title">
      <div className="record-section-header"><div className="record-section-icon"><UserRoundCog size={20}/></div><div><h2 id="review-title">{l.review}</h2></div></div>
      <form className="opportunity-form ops-form" onSubmit={e=>{e.preventDefault();void run(()=>accept(h.id,h.version,Number(lead),start));}}>
        <label><span>{l.lead}</span><select required value={lead} onChange={e=>setLead(e.target.value)}><option value="">{l.chooseLead}</option>{(people??[]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label><span>{l.startDate}</span><input type="date" required value={start} onChange={e=>setStart(e.target.value)}/></label>
        <button type="submit" className="btn btn-primary" disabled={busy}><CheckCircle2 size={16}/>{l.acceptAction}</button>
        <p className="ops-hint">{l.acceptNote}</p></form>
      <div className="opportunity-form ops-form">
        <label><span>{l.reason}</span><select value={reason} onChange={e=>setReason(e.target.value as Reason)}>{REASONS.map(r=><option key={r} value={r}>{l.reasons[r]}</option>)}</select></label>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void run(()=>sendBack(h.id,h.version,reason))}><Undo2 size={16}/>{l.rework}</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void run(()=>reject(h.id,h.version,reason))}><XCircle size={16}/>{l.rejectAction}</button>
      </div>
    </section>}
    <section className="record-content-card" aria-labelledby="trail-title">
      <div className="record-section-header"><div className="record-section-icon"><History size={20}/></div><div><h2 id="trail-title">{l.trail}</h2></div></div>
      {events.length===0?<p className="ops-muted">{l.empty}</p>:<ol className="ops-trail">{events.map(e=><li key={e.id}><span className="ops-trail-dot"/>
        <div><strong>{(l.events as Record<string,string>)[e.kind]??e.kind}</strong>{e.itemTitle?<> · {e.itemTitle}</>:null}{e.reason?<> · {l.reasons[e.reason]}</>:null}
          {e.fromUser||e.toUser?<> · {e.fromUser??"—"} → {e.toUser??"—"}</>:null}<small>{e.actorName??"—"} · <span dir="ltr">{stamp(e.at)}</span></small></div></li>)}</ol>}
    </section>
  </article>;
}

function EngagementRegister({l}:{l:Labels}){
  const [mine,setMine]=useState(false);const [rows,setRows]=useState<Engagement[]|null>(null);const [error,setError]=useState("");
  const load=useCallback(()=>getEngagements(mine).then(r=>{setRows(r);setError("");}),[mine]);
  useEffect(()=>{setRows(null);void load().catch(e=>{setRows([]);setError(message(e,l));});},[load,l]);
  return <>
    <div className="list-toolbar ops-toolbar"><label className="ops-check"><input type="checkbox" checked={mine} onChange={e=>setMine(e.target.checked)}/><span>{l.mine}</span></label></div>
    {error&&<Retry error={error} l={l} onRetry={()=>void load().catch(e=>setError(message(e,l)))}/>}
    <div className="data-panel"><div className="data-panel-heading"><strong>{l.tabs.engagements}</strong><span>{rows?.length??0}</span></div>
      {rows===null?<div className="empty-state" role="status">{l.loading}</div>:rows.length===0?<div className="empty-state"><CircleDashed size={26}/>{l.noEngagements}</div>
      :<div className="directory-items">{rows.map(g=><article key={g.id} className="directory-item ops-row">
        <div className="line-monogram">{g.businessLineCode.slice(0,2)}</div>
        <div className="directory-record"><strong>{g.name}</strong><small>{g.clientName??"—"} · <span dir="ltr">{g.code}</span> · {g.leadName??"—"}</small></div>
        <div className="ops-progress" role="progressbar" aria-label={l.progress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={g.progress}><span style={{width:g.progress+"%"}}/></div>
        {g.tasksOverdue>0&&<span className="ops-missing" title={l.overdue}>{g.tasksOverdue}</span>}
        <a className="text-action" href={"#/operations/engagements/"+g.id}>{l.open}</a></article>)}</div>}
    </div>
  </>;
}

function EngagementRecord({engagementId,l,Back}:{engagementId:number;l:Labels;Back:typeof ArrowLeft}){
  const [g,setG]=useState<Engagement|null>(null);const [tasks,setTasks]=useState<Task[]>([]);const [people,setPeople]=useState<Person[]>([]);const [loadError,setLoadError]=useState("");
  const [name,setName]=useState("");const [due,setDue]=useState("");const [assignee,setAssignee]=useState("");const [to,setTo]=useState("");
  const reload=useCallback(async()=>{const [x,t]=await Promise.all([getEngagement(engagementId),getTasks(engagementId)]);setG(x);setTasks(t);},[engagementId]);
  useEffect(()=>{void reload().catch(e=>setLoadError(message(e,l)));void getPeople().then(setPeople).catch(()=>setPeople([]));},[reload,l]);
  const {busy,error,run}=useAction(l,reload);
  if(loadError)return <section className="page-enter"><a className="record-back" href="#/operations/engagements"><Back size={17}/>{l.back}</a><ErrorBanner message={loadError}/></section>;
  if(!g)return <div className="empty-state" role="status">{l.loading}</div>;
  const editable=people.length>0;
  return <article className="record-workspace page-enter ops-record" aria-labelledby="eng-title">
    <div className="record-context-bar"><a className="record-back" href="#/operations/engagements"><Back size={17}/>{l.back}</a><span className="record-context-separator">/</span><span className="record-current" dir="ltr">{g.code}</span></div>
    <div className="record-hero"><div className="record-hero-main"><span className="eyebrow"><span className="record-eyebrow-dot"/>{l.engagement} · {g.businessLineCode}</span>
      <div className="record-hero-heading"><div className="record-identity-icon"><Workflow size={30}/></div><div><h1 id="eng-title">{g.name}</h1>
        <div className="record-tags"><span className="record-ref" dir="ltr">{g.code}</span>{g.clientId!=null&&<a className="record-ref" href={"#/accounts/"+g.clientId}>{g.clientName}</a>}
          <a className="record-ref" href={"#/operations/handovers/"+g.handoverId}>{l.handover} <span dir="ltr">{g.contractReference}</span></a></div></div></div></div>
      <div className="record-hero-actions"><dl className="ops-facts"><div><dt>{l.lead}</dt><dd>{g.leadName??"—"}</dd></div><div><dt>{l.progress}</dt><dd>{g.progress}%</dd></div>
        <div><dt>{l.tasks}</dt><dd>{g.tasksDone}/{g.tasks}</dd></div><div><dt>{l.overdue}</dt><dd>{g.tasksOverdue}</dd></div></dl>
        <div className="ops-progress ops-progress-lg" role="progressbar" aria-label={l.progress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={g.progress}><span style={{width:g.progress+"%"}}/></div></div></div>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {!editable&&<p className="record-security-note"><LockKeyhole size={15}/>{l.readonly}</p>}
    <section className="record-content-card" aria-labelledby="tasks-title">
      <div className="record-section-header"><div className="record-section-icon"><ClipboardCheck size={20}/></div><div><h2 id="tasks-title">{l.tasks}</h2></div></div>
      {tasks.length===0?<p className="ops-muted">{l.empty}</p>:<ul className="ops-checklist">{tasks.map(t=><li key={t.id} className={t.done?"is-done":t.overdue?"is-overdue":""}>
        {t.done?<CheckCircle2 size={17}/>:<CircleDashed size={17}/>}
        <div><strong>{t.name}</strong>{t.overdue&&<span className="ops-tag ops-tag-overdue">{l.overdue}</span>}<small><span dir="ltr">{t.dueDate??"—"}</span> · {t.assigneeName??l.noAssignee}{t.status?` · ${t.status}`:""}</small></div>
        {editable&&!t.done&&<button type="button" className="btn btn-secondary" disabled={busy} aria-label={`${l.complete}: ${t.name}`} onClick={()=>void run(()=>completeTask(t.id,t.version))}>{l.complete}</button>}
      </li>)}</ul>}
      {editable&&<form className="opportunity-form ops-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await addTask(g.id,g.version,{name,...(due?{dueDate:due}:{}),...(assignee?{assigneeId:Number(assignee)}:{})});setName("");setDue("");});}}>
        <label><span>{l.taskName}</span><input required maxLength={255} value={name} onChange={e=>setName(e.target.value)}/></label>
        <label><span>{l.dueDate}</span><input type="date" value={due} onChange={e=>setDue(e.target.value)}/></label>
        <label><span>{l.assignee}</span><select value={assignee} onChange={e=>setAssignee(e.target.value)}><option value="">{l.noAssignee}</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <button type="submit" className="btn btn-secondary" disabled={busy}><Plus size={16}/>{l.addTask}</button></form>}
    </section>
    {editable&&<section className="record-content-card" aria-labelledby="owner-title">
      <div className="record-section-header"><div className="record-section-icon"><UserRoundCog size={20}/></div><div><h2 id="owner-title">{l.transfer}</h2></div></div>
      <form className="opportunity-form ops-form" onSubmit={e=>{e.preventDefault();void run(()=>transfer(g.id,g.version,Number(to)));}}>
        <label><span>{l.transferTo}</span><select required value={to} onChange={e=>setTo(e.target.value)}><option value="">{l.chooseLead}</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <button type="submit" className="btn btn-secondary" disabled={busy}>{l.transfer}</button></form>
    </section>}
  </article>;
}

function Checklists({l}:{l:Labels}){
  const [lines,setLines]=useState<BusinessLine[]>([]);const [code,setCode]=useState("");const [rows,setRows]=useState<Requirement[]|null>(null);const [error,setError]=useState("");
  const [title,setTitle]=useState("");const [mandatory,setMandatory]=useState(true);const [sequence,setSequence]=useState("10");
  useEffect(()=>{void getBusinessLines().then(ls=>{setLines(ls);if(ls[0])setCode(c=>c||ls[0].code);}).catch(()=>setLines([]));},[]);
  const load=useCallback(()=>code?getRequirements(code).then(r=>{setRows(r);setError("");}):Promise.resolve(setRows([])),[code]);
  useEffect(()=>{setRows(null);void load().catch(e=>{setRows([]);setError(message(e,l));});},[load,l]);
  const {busy,error:actionError,run}=useAction(l,load);
  return <>
    <p className="record-security-note"><LockKeyhole size={15}/>{l.configNote}</p>
    <div className="list-toolbar ops-toolbar"><label><span className="sr-only">{l.line}</span><select aria-label={l.line} value={code} onChange={e=>setCode(e.target.value)}>
      {lines.map(b=><option key={b.code} value={b.code}>{b.code}</option>)}</select></label></div>
    {error&&<Retry error={error} l={l} onRetry={()=>void load().catch(e=>setError(message(e,l)))}/>}
    {actionError&&<div className="login-error" role="alert"><CircleAlert size={17}/>{actionError}</div>}
    <div className="data-panel"><div className="data-panel-heading"><strong>{l.requirements}</strong><span>{rows?.length??0}</span></div>
      {rows===null?<div className="empty-state" role="status">{l.loading}</div>:rows.length===0?<div className="empty-state"><CircleDashed size={26}/>{l.empty}</div>
      :<ul className="ops-checklist">{rows.map(r=><li key={r.id}><ClipboardCheck size={17}/><div><strong>{r.title}</strong> <span className="ops-tag">{r.mandatory?l.required:l.optional}</span><small>{l.order}: {r.sequence??"—"}</small></div>
        <button type="button" className="text-action" disabled={busy} onClick={()=>void run(()=>retireRequirement(r.id,r.version))}>{l.retire}</button></li>)}</ul>}
    </div>
    {code&&<form className="record-content-card opportunity-form ops-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await addRequirement({businessLineCode:code,title,mandatory,sequence:Number(sequence)});setTitle("");});}}>
      <label><span>{l.requirement}</span><input required maxLength={255} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label><span>{l.order}</span><input type="number" min="0" max="999" value={sequence} onChange={e=>setSequence(e.target.value)}/></label>
      <label className="ops-check"><input type="checkbox" checked={mandatory} onChange={e=>setMandatory(e.target.checked)}/><span>{l.mandatory}</span></label>
      <button type="submit" className="btn btn-secondary" disabled={busy}><Plus size={16}/>{l.addRequirement}</button></form>}
  </>;
}
