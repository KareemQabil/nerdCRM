import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft, ArrowRight, BriefcaseBusiness, CheckCircle2, CircleAlert, CircleDashed, ClipboardCheck, FileLock2,
  LockKeyhole, Plus, RefreshCw, Search, Send, UserRound, UsersRound,
} from "lucide-react";
import { ApiError, getAccounts, type AccountSummary } from "./api";
import {
  answerOffer, attachCandidate, confirmPlacement, createCandidate, createJobOrder, getApplications, getCandidate,
  getCandidates, getConsents, getInterviews, getJobOrder, getJobOrders, getPlacements, moveApplication, recordConsent,
  recordOffer, recordOutcome, recordStart, revokeConsent, savePrivateProfile, scheduleInterview, setJobOrderStatus,
  submitApplication,
  type Application, type Candidate, type Consent, type ConsentMethod, type Interview, type JobOrder, type PlacementRecord, type Stage,
} from "./recruitmentApi";
import type { Language } from "./preferences";
import "./recruitment.css";

const strings = {
  ar: {
    title:"التوظيف للعملاء",desc:"طلبات التوظيف من العملاء والمرشحون والموافقات ومسار الترشيح والتعيينات، ضمن صلاحياتك.",
    orders:"طلبات التوظيف",candidates:"المرشحون",newOrder:"طلب توظيف جديد",newCandidate:"مرشح جديد",search:"بحث",
    searchOrders:"ابحث بالمرجع أو المسمى الوظيفي",searchCandidates:"ابحث باسم المرشح",loading:"جار التحميل...",retry:"إعادة المحاولة",
    noOrders:"لا توجد طلبات توظيف",noCandidates:"لا يوجد مرشحون",open:"فتح",back:"العودة إلى التوظيف",
    reference:"المرجع",client:"العميل",chooseClient:"اختر العميل",jobTitle:"المسمى الوظيفي",headcount:"عدد الوظائف",location:"المكان",
    requirements:"المتطلبات",save:"حفظ",cancel:"إلغاء",recruiter:"مسؤول التوظيف",active:"في المسار",placed:"تم تعيينهم",
    status:{OPEN:"مفتوح",ON_HOLD:"معلّق",FILLED:"مكتمل",CLOSED:"مغلق"},hold:"تعليق",reopen:"إعادة فتح",close:"إغلاق الطلب",
    pipeline:"مسار المرشحين",addToPipeline:"إضافة مرشح للمسار",chooseCandidate:"اختر مرشحًا",add:"إضافة",empty:"لا يوجد",
    stages:{SOURCED:"مصدر",SCREENED:"تم الفرز",SHORTLISTED:"القائمة المختصرة",SUBMITTED:"مُرشح للعميل",INTERVIEWING:"مقابلات",OFFERED:"عرض عمل",PLACED:"تم التعيين",REJECTED:"مرفوض",WITHDRAWN:"انسحب"},
    consentOk:"موافقة سارية لهذا الطلب",consentMissing:"لا توجد موافقة سارية لهذا الطلب",
    screen:"تم الفرز",shortlist:"إلى القائمة المختصرة",reject:"رفض",withdraw:"انسحاب",submit:"ترشيح للعميل",
    submitNote:"يُشارك مع العميل الملف غير المقيّد فقط (الاسم والخبرة). مشاركة السيرة الذاتية وبيانات التواصل متوقفة حتى اعتماد D-04.",
    shareCv:"مشاركة السيرة الذاتية",interviews:"مقابلات العميل",round:"الجولة",scheduledAt:"الموعد",schedule:"جدولة مقابلة",
    outcomes:{PENDING:"بانتظار النتيجة",PASSED:"اجتاز",FAILED:"لم يجتز",NO_SHOW:"لم يحضر"},passed:"اجتاز",failed:"لم يجتز",noShow:"لم يحضر",
    offer:"عرض العمل",offerDate:"تاريخ العرض",recordOffer:"تسجيل عرض العميل",accepted:"قَبِل العرض",declined:"رفض العرض",
    offerNote:"لا تُسجل شروط العرض (الراتب) هنا حتى اعتماد D-04.",startDate:"تاريخ بدء العمل",place:"تأكيد التعيين",
    placements:"التعيينات",guarantee:"الضمان",guaranteePending:"شروط الضمان بانتظار السياسة D-04",fees:"أحداث الأتعاب",
    fee:{OFFER_ACCEPTED:"قبول العرض",CANDIDATE_STARTED:"بدء العمل"},recordStarted:"تسجيل بدء العمل",invoice:"إصدار فاتورة الأتعاب",replacement:"طلب بديل",
    feeNote:"قيم الأتعاب والفواتير وطلبات البديل متوقفة حتى اعتماد D-04 وD-06.",
    profile:"الملف غير المقيّد",displayName:"الاسم",headline:"الدور الحالي",years:"سنوات الخبرة",
    privateTitle:"البيانات المقيّدة",privateOnFile:"مسجلة (لا تُعرض)",privateNone:"غير مسجلة",
    privateNote:"البريد والهاتف والراتب المتوقع ومرجع السيرة الذاتية تُسجل ولا تُعرض. قراءتها متوقفة حتى اعتماد D-04 وD-07.",
    email:"البريد الإلكتروني",phone:"الهاتف",salary:"الراتب المتوقع",cv:"مرجع السيرة الذاتية",savePrivate:"تسجيل البيانات المقيّدة",
    consents:"الموافقات",noConsents:"لا توجد موافقات مسجلة",jobOrder:"طلب التوظيف",chooseOrder:"اختر طلب التوظيف",method:"طريقة الموافقة",
    methods:{WRITTEN:"كتابية",EMAIL:"بريد إلكتروني",RECORDED_CALL:"مكالمة مسجلة"},givenOn:"تاريخ الموافقة",evidence:"مرجع الإثبات",
    recordConsent:"تسجيل موافقة",revoke:"سحب الموافقة",revoked:"مسحوبة",readonly:"عرض فقط: المسؤول وحده يعدّل هذا السجل.",
    errors:{CONSENT_REQUIRED:"سجّل موافقة المرشح على هذا الطلب قبل ترشيحه للعميل.",STAGE_TRANSITION:"هذا الانتقال غير مسموح من المرحلة الحالية.",ALREADY_IN_PIPELINE:"المرشح موجود بالفعل في مسار هذا الطلب.",ORDER_NOT_OPEN:"طلب التوظيف ليس مفتوحًا.",ORDER_STATE:"لا يمكن تغيير حالة طلب مكتمل أو مغلق.",ALREADY_PLACED:"تم تعيين هذا المرشح بالفعل.",HEADCOUNT_FILLED:"اكتملت كل وظائف هذا الطلب.",OUTCOME_RECORDED:"سُجلت نتيجة هذه المقابلة بالفعل.",CONSENT_REVOKED:"هذه الموافقة مسحوبة بالفعل.",BLOCKED_BY_POLICY:"متوقف حتى اعتماد السياسة.",conflict:"تم تعديل البيانات من مكان آخر؛ حدّثناها، أعد المحاولة.",invalid:"راجع الحقول المطلوبة وقيمها.",denied:"ليست لديك صلاحية لهذا الإجراء.",failed:"تعذّر تنفيذ الطلب."},
  },
  en: {
    title:"Client recruitment",desc:"Client job orders, candidates, consent, the submission pipeline and placements, within your permissions.",
    orders:"Job orders",candidates:"Candidates",newOrder:"New job order",newCandidate:"New candidate",search:"Search",
    searchOrders:"Search by reference or job title",searchCandidates:"Search by candidate name",loading:"Loading...",retry:"Retry",
    noOrders:"No job orders",noCandidates:"No candidates",open:"Open",back:"Back to recruitment",
    reference:"Reference",client:"Client",chooseClient:"Choose a client",jobTitle:"Job title",headcount:"Positions",location:"Location",
    requirements:"Requirements",save:"Save",cancel:"Cancel",recruiter:"Recruiter",active:"In pipeline",placed:"Placed",
    status:{OPEN:"Open",ON_HOLD:"On hold",FILLED:"Filled",CLOSED:"Closed"},hold:"Put on hold",reopen:"Reopen",close:"Close order",
    pipeline:"Candidate pipeline",addToPipeline:"Add a candidate to the pipeline",chooseCandidate:"Choose a candidate",add:"Add",empty:"None",
    stages:{SOURCED:"Sourced",SCREENED:"Screened",SHORTLISTED:"Shortlisted",SUBMITTED:"Submitted",INTERVIEWING:"Interviewing",OFFERED:"Offered",PLACED:"Placed",REJECTED:"Rejected",WITHDRAWN:"Withdrawn"},
    consentOk:"Valid consent for this job order",consentMissing:"No valid consent for this job order",
    screen:"Mark screened",shortlist:"Shortlist",reject:"Reject",withdraw:"Withdraw",submit:"Submit to client",
    submitNote:"Only the non-restricted profile (name, experience) is shared. Sharing the CV and contact details waits for D-04.",
    shareCv:"Share CV",interviews:"Client interviews",round:"Round",scheduledAt:"Scheduled at",schedule:"Schedule interview",
    outcomes:{PENDING:"Awaiting outcome",PASSED:"Passed",FAILED:"Failed",NO_SHOW:"No show"},passed:"Passed",failed:"Failed",noShow:"No show",
    offer:"Job offer",offerDate:"Offer date",recordOffer:"Record client offer",accepted:"Offer accepted",declined:"Offer declined",
    offerNote:"Offer terms (salary) are not recorded here until D-04.",startDate:"Start date",place:"Confirm placement",
    placements:"Placements",guarantee:"Guarantee",guaranteePending:"Guarantee terms pending policy D-04",fees:"Fee events",
    fee:{OFFER_ACCEPTED:"Offer accepted",CANDIDATE_STARTED:"Candidate started"},recordStarted:"Record start",invoice:"Invoice fee",replacement:"Claim replacement",
    feeNote:"Fee amounts, invoices and replacement claims wait for D-04 and D-06.",
    profile:"Non-restricted profile",displayName:"Name",headline:"Current role",years:"Years of experience",
    privateTitle:"Restricted data",privateOnFile:"On file (not shown)",privateNone:"Not on file",
    privateNote:"E-mail, phone, expected salary and CV reference are recorded but never shown. Reading them waits for D-04 and D-07.",
    email:"E-mail",phone:"Phone",salary:"Expected salary",cv:"CV reference",savePrivate:"Record restricted data",
    consents:"Consents",noConsents:"No consents recorded",jobOrder:"Job order",chooseOrder:"Choose a job order",method:"Method",
    methods:{WRITTEN:"Written",EMAIL:"E-mail",RECORDED_CALL:"Recorded call"},givenOn:"Given on",evidence:"Evidence reference",
    recordConsent:"Record consent",revoke:"Revoke consent",revoked:"Revoked",readonly:"Read only: only the owner changes this record.",
    errors:{CONSENT_REQUIRED:"Record the candidate's consent for this job order before submitting.",STAGE_TRANSITION:"This change is not allowed from the current stage.",ALREADY_IN_PIPELINE:"The candidate is already in this job order's pipeline.",ORDER_NOT_OPEN:"The job order is not open.",ORDER_STATE:"A filled or closed job order cannot change status.",ALREADY_PLACED:"This candidate is already placed.",HEADCOUNT_FILLED:"Every position of this job order is filled.",OUTCOME_RECORDED:"This interview already has an outcome.",CONSENT_REVOKED:"This consent is already revoked.",BLOCKED_BY_POLICY:"Blocked until the policy is signed.",conflict:"The data changed elsewhere; it is refreshed, try again.",invalid:"Check the required fields and their values.",denied:"You do not have permission for this action.",failed:"The request failed."},
  },
} as const;
type Labels = typeof strings.ar | typeof strings.en;
const BOARD: Stage[] = ["SOURCED","SCREENED","SHORTLISTED","SUBMITTED","INTERVIEWING","OFFERED","PLACED"];

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
function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/recruitment\/?/, "").split("/").filter(Boolean);
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

/** Client recruitment workspace (real mode). */
export function RecruitmentPage({language}:{language:Language}){
  const l=strings[language];
  const route=useRoute();
  const Back=language==="ar"?ArrowRight:ArrowLeft;
  if(route[0]==="orders"&&/^\d+$/.test(route[1]||""))return <JobOrderRecord key={route[1]} orderId={Number(route[1])} l={l} Back={Back}/>;
  if(route[0]==="candidates"&&/^\d+$/.test(route[1]||""))return <CandidateRecord key={route[1]} candidateId={Number(route[1])} l={l} Back={Back}/>;
  const tab=route[0]==="candidates"?"candidates":"orders";
  return <section className="page-enter rec-page">
    <div className="directory-head"><div className="page-title">
      <span className="eyebrow">IOETI · ioeti-recruitment</span><h1>{l.title}</h1><p>{l.desc}</p>
    </div><div className="directory-head-symbol"><BriefcaseBusiness size={29}/></div></div>
    <div className="demo-record-tabs rec-tabs" role="tablist" aria-label={l.title}>
      <button type="button" role="tab" aria-selected={tab==="orders"} className={tab==="orders"?"active":""} onClick={()=>{window.location.hash="#/recruitment";}}>{l.orders}</button>
      <button type="button" role="tab" aria-selected={tab==="candidates"} className={tab==="candidates"?"active":""} onClick={()=>{window.location.hash="#/recruitment/candidates";}}>{l.candidates}</button>
    </div>
    {tab==="orders"?<OrdersRegister l={l}/>:<CandidatesRegister l={l}/>}
  </section>;
}

function OrdersRegister({l}:{l:Labels}){
  const [rows,setRows]=useState<JobOrder[]|null>(null);const [q,setQ]=useState("");const [applied,setApplied]=useState("");
  const [error,setError]=useState("");const [creating,setCreating]=useState(false);
  const load=useCallback(()=>getJobOrders(applied||undefined).then(setRows),[applied]);
  useEffect(()=>{setRows(null);setError("");void load().catch(e=>{setRows([]);setError(message(e,l));});},[load,l]);
  return <>
    <form className="list-toolbar rec-toolbar" role="search" onSubmit={e=>{e.preventDefault();setApplied(q.trim());}}>
      <label className="search-field"><Search size={18}/><span className="sr-only">{l.searchOrders}</span><input value={q} maxLength={100} placeholder={l.searchOrders} onChange={e=>setQ(e.target.value)}/></label>
      <button type="submit" className="btn btn-secondary"><Search size={16}/>{l.search}</button>
      <button type="button" className="btn btn-primary" onClick={()=>setCreating(c=>!c)}><Plus size={16}/>{l.newOrder}</button>
    </form>
    {creating&&<OrderForm l={l} onCancel={()=>setCreating(false)} onCreated={o=>{window.location.hash="#/recruitment/orders/"+o.id;}}/>}
    {error&&<div className="error-banner" role="alert"><CircleAlert size={17}/><span>{error}</span><button type="button" className="btn btn-secondary" onClick={()=>void load().then(()=>setError("")).catch(e=>setError(message(e,l)))}><RefreshCw size={15}/>{l.retry}</button></div>}
    <div className="data-panel"><div className="data-panel-heading"><strong>{l.orders}</strong><span>{rows?.length??0}</span></div>
      {rows===null?<div className="empty-state" role="status">{l.loading}</div>:rows.length===0?<div className="empty-state"><CircleDashed size={26}/>{l.noOrders}</div>
      :<div className="directory-items">{rows.map(o=><article className="directory-item rec-row" key={o.id}>
        <div className="line-monogram">{o.title.slice(0,1)}</div>
        <div className="directory-record"><strong>{o.title}</strong><small>{o.clientName||"—"} · <span dir="ltr">{o.reference}</span>{o.location?` · ${o.location}`:""}</small></div>
        <span className={"rec-status rec-status-"+o.status.toLowerCase()}>{l.status[o.status]}</span>
        <span className="rec-count" title={l.placed}>{o.placed}/{o.headcount}</span>
        <a className="text-action" href={"#/recruitment/orders/"+o.id}>{l.open}</a>
      </article>)}</div>}
    </div>
  </>;
}

function OrderForm({l,onCancel,onCreated}:{l:Labels;onCancel:()=>void;onCreated:(o:JobOrder)=>void}){
  const [accounts,setAccounts]=useState<AccountSummary[]>([]);
  const [reference,setReference]=useState("");const [clientId,setClientId]=useState("");const [title,setTitle]=useState("");
  const [headcount,setHeadcount]=useState("1");const [location,setLocation]=useState("");const [requirements,setRequirements]=useState("");
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  useEffect(()=>{void getAccounts(0,50).then(setAccounts).catch(()=>setAccounts([]));},[]);
  return <form className="record-content-card opportunity-form rec-form" onSubmit={e=>{e.preventDefault();if(busy)return;setBusy(true);setError("");
    createJobOrder({reference,clientId:Number(clientId),title,headcount:Number(headcount),...(location?{location}:{}),...(requirements?{requirements}:{})})
      .then(onCreated).catch(err=>setError(message(err,l))).finally(()=>setBusy(false));}}>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    <label><span>{l.reference}</span><input required dir="ltr" maxLength={30} value={reference} onChange={e=>setReference(e.target.value)}/></label>
    <label><span>{l.client}</span><select required value={clientId} onChange={e=>setClientId(e.target.value)}>
      <option value="">{l.chooseClient}</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <label><span>{l.jobTitle}</span><input required maxLength={255} value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label><span>{l.headcount}</span><input type="number" min="1" max="500" required value={headcount} onChange={e=>setHeadcount(e.target.value)}/></label>
    <label><span>{l.location}</span><input maxLength={255} value={location} onChange={e=>setLocation(e.target.value)}/></label>
    <label className="rec-wide"><span>{l.requirements}</span><textarea rows={3} maxLength={4000} value={requirements} onChange={e=>setRequirements(e.target.value)}/></label>
    <div className="lead-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{l.save}</button><button type="button" className="btn btn-secondary" onClick={onCancel}>{l.cancel}</button></div>
  </form>;
}

function JobOrderRecord({orderId,l,Back}:{orderId:number;l:Labels;Back:typeof ArrowLeft}){
  const [order,setOrder]=useState<JobOrder|null>(null);const [apps,setApps]=useState<Application[]>([]);
  const [placements,setPlacements]=useState<PlacementRecord[]>([]);const [candidates,setCandidates]=useState<Candidate[]>([]);
  const [selected,setSelected]=useState<number|null>(null);const [pick,setPick]=useState("");const [loadError,setLoadError]=useState("");
  const reload=useCallback(async()=>{
    const [o,a,p]=await Promise.all([getJobOrder(orderId),getApplications(orderId),getPlacements(orderId)]);
    setOrder(o);setApps(a);setPlacements(p);
  },[orderId]);
  useEffect(()=>{void reload().catch(e=>setLoadError(message(e,l)));void getCandidates().then(setCandidates).catch(()=>setCandidates([]));},[reload,l]);
  const {busy,error,run}=useAction(l,reload);
  if(loadError)return <section className="page-enter"><a className="record-back" href="#/recruitment"><Back size={17}/>{l.back}</a><div className="error-banner" role="alert"><CircleAlert size={17}/><span>{loadError}</span></div></section>;
  if(!order)return <div className="empty-state" role="status">{l.loading}</div>;
  const editable=order.recruitedByMe;
  const current=apps.find(a=>a.id===selected)||null;
  return <article className="record-workspace page-enter rec-record" aria-labelledby="order-title">
    <div className="record-context-bar"><a className="record-back" href="#/recruitment"><Back size={17}/>{l.back}</a><span className="record-context-separator">/</span><span className="record-current" dir="ltr">{order.reference}</span></div>
    <div className="record-hero"><div className="record-hero-main">
      <span className="eyebrow"><span className="record-eyebrow-dot"/>{l.orders} · {order.clientName||"—"}</span>
      <div className="record-hero-heading"><div className="record-identity-icon"><BriefcaseBusiness size={30}/></div>
        <div><h1 id="order-title">{order.title}</h1><div className="record-tags"><span className={"rec-status rec-status-"+order.status.toLowerCase()}>{l.status[order.status]}</span>
          <span className="record-ref" dir="ltr">{order.reference}</span>{order.clientId!=null&&<a className="record-ref" href={"#/accounts/"+order.clientId}>{l.client}</a>}</div></div></div>
      {order.requirements&&<p className="record-hero-description">{order.requirements}</p>}
    </div><div className="record-hero-actions">
      <dl className="rec-kpis"><div><dt>{l.headcount}</dt><dd>{order.headcount}</dd></div><div><dt>{l.active}</dt><dd>{order.activeCandidates}</dd></div><div><dt>{l.placed}</dt><dd>{order.placed}</dd></div></dl>
      {editable&&(order.status==="OPEN"||order.status==="ON_HOLD")&&<div className="lead-actions">
        {order.status==="OPEN"?<button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void run(()=>setJobOrderStatus(order.id,order.version,"ON_HOLD"))}>{l.hold}</button>
        :<button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void run(()=>setJobOrderStatus(order.id,order.version,"OPEN"))}>{l.reopen}</button>}
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void run(()=>setJobOrderStatus(order.id,order.version,"CLOSED"))}>{l.close}</button></div>}
    </div></div>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {!editable&&<p className="record-security-note"><LockKeyhole size={15}/>{l.readonly}</p>}
    <section className="record-content-card" aria-labelledby="pipeline-title">
      <div className="record-section-header"><div className="record-section-icon"><UsersRound size={20}/></div><div><h2 id="pipeline-title">{l.pipeline}</h2></div></div>
      <div className="rec-board" role="list">{BOARD.map(stage=>{const items=apps.filter(a=>a.stage===stage);
        return <section key={stage} className="rec-column" role="listitem" aria-label={l.stages[stage]}><h3>{l.stages[stage]} <span>{items.length}</span></h3>
          {items.length===0?<p className="rec-muted">{l.empty}</p>:items.map(a=><button type="button" key={a.id} className={"rec-card"+(selected===a.id?" is-selected":"")}
            aria-pressed={selected===a.id} onClick={()=>setSelected(a.id)}><strong>{a.candidateName}</strong><small>{a.candidateHeadline||""}</small>
            <span className={a.consentOnFile?"rec-consent-ok":"rec-consent-missing"}>{a.consentOnFile?<CheckCircle2 size={13}/>:<CircleAlert size={13}/>}{a.consentOnFile?l.consentOk:l.consentMissing}</span></button>)}
        </section>;})}</div>
      {apps.some(a=>a.stage==="REJECTED"||a.stage==="WITHDRAWN")&&<p className="rec-muted">{apps.filter(a=>a.stage==="REJECTED"||a.stage==="WITHDRAWN").map(a=>`${a.candidateName} (${l.stages[a.stage]})`).join(" · ")}</p>}
      {editable&&order.status==="OPEN"&&<form className="opportunity-form rec-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await attachCandidate(order.id,order.version,Number(pick));setPick("");});}}>
        <label><span>{l.addToPipeline}</span><select required value={pick} onChange={e=>setPick(e.target.value)}>
          <option value="">{l.chooseCandidate}</option>{candidates.filter(c=>!apps.some(a=>a.candidateId===c.id)).map(c=><option key={c.id} value={c.id}>{c.displayName}</option>)}</select></label>
        <button type="submit" className="btn btn-secondary" disabled={busy||!pick}><Plus size={16}/>{l.add}</button></form>}
    </section>
    {current&&<ApplicationPanel key={current.id+":"+current.version} app={current} editable={editable} l={l} run={run} busy={busy}/>}
    <section className="record-content-card" aria-labelledby="placements-title">
      <div className="record-section-header"><div className="record-section-icon"><ClipboardCheck size={20}/></div><div><h2 id="placements-title">{l.placements}</h2></div></div>
      {placements.length===0?<p className="rec-muted">{l.empty}</p>:<div className="table-scroll"><table><thead><tr><th>{l.displayName}</th><th>{l.startDate}</th><th>{l.guarantee}</th><th>{l.fees}</th><th><span className="sr-only">{l.recordStarted}</span></th></tr></thead>
        <tbody>{placements.map(p=><tr key={p.id}><td><strong>{p.candidateName}</strong></td><td dir="ltr">{p.startDate}</td><td>{l.guaranteePending}</td>
          <td>{p.feeMilestones.map(f=>l.fee[f]).join(" · ")||"—"}</td>
          <td>{editable&&!p.feeMilestones.includes("CANDIDATE_STARTED")&&<button type="button" className="text-action" disabled={busy} onClick={()=>void run(()=>recordStart(p.id,p.startDate))}>{l.recordStarted}</button>}</td></tr>)}</tbody></table></div>}
      <div className="lead-actions"><button type="button" className="btn btn-secondary" disabled aria-describedby="rec-fee-note">{l.invoice}</button><button type="button" className="btn btn-secondary" disabled aria-describedby="rec-fee-note">{l.replacement}</button></div>
      <p className="record-security-note" id="rec-fee-note"><LockKeyhole size={15}/>{l.feeNote}</p>
    </section>
  </article>;
}

function ApplicationPanel({app,editable,l,run,busy}:{app:Application;editable:boolean;l:Labels;run:(a:()=>Promise<unknown>)=>Promise<boolean>;busy:boolean}){
  const [interviews,setInterviews]=useState<Interview[]>([]);const [round,setRound]=useState("1");const [at,setAt]=useState("");
  const [offerOn,setOfferOn]=useState(today());const [start,setStart]=useState("");
  const loadInterviews=useCallback(()=>getInterviews(app.id).then(setInterviews).catch(()=>setInterviews([])),[app.id]);
  useEffect(()=>{void loadInterviews();},[loadInterviews]);
  const act=(a:()=>Promise<unknown>)=>void run(a).then(()=>loadInterviews());
  return <section className="record-content-card rec-application" aria-labelledby="app-title">
    <div className="record-section-header"><div className="record-section-icon"><UserRound size={20}/></div><div>
      <h2 id="app-title">{app.candidateName}</h2><p>{l.stages[app.stage]} · <a href={"#/recruitment/candidates/"+app.candidateId}>{l.profile}</a></p></div></div>
    <p className={app.consentOnFile?"rec-consent-ok":"rec-consent-missing"}>{app.consentOnFile?<CheckCircle2 size={15}/>:<CircleAlert size={15}/>}{app.consentOnFile?l.consentOk:l.consentMissing}</p>
    {editable&&<div className="lead-actions">
      {app.stage==="SOURCED"&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>act(()=>moveApplication(app.id,app.version,"SCREENED"))}>{l.screen}</button>}
      {app.stage==="SCREENED"&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>act(()=>moveApplication(app.id,app.version,"SHORTLISTED"))}>{l.shortlist}</button>}
      {app.stage==="SHORTLISTED"&&<button type="button" className="btn btn-primary" disabled={busy} onClick={()=>act(()=>submitApplication(app.id,app.version))}><Send size={15}/>{l.submit}</button>}
      {!["PLACED","REJECTED","WITHDRAWN"].includes(app.stage)&&<>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>act(()=>moveApplication(app.id,app.version,"REJECTED"))}>{l.reject}</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>act(()=>moveApplication(app.id,app.version,"WITHDRAWN"))}>{l.withdraw}</button></>}
      <button type="button" className="btn btn-secondary" disabled aria-describedby="rec-submit-note"><FileLock2 size={15}/>{l.shareCv}</button>
    </div>}
    <p className="record-security-note" id="rec-submit-note"><LockKeyhole size={15}/>{l.submitNote}</p>
    {["SUBMITTED","INTERVIEWING","OFFERED","PLACED"].includes(app.stage)&&<div className="rec-sub"><h3>{l.interviews}</h3>
      {interviews.length===0?<p className="rec-muted">{l.empty}</p>:<ul className="rec-list">{interviews.map(i=><li key={i.id}>
        <span>{l.round} {i.round} · <span dir="ltr">{i.scheduledAt.replace("T"," ").slice(0,16)}</span> · <strong>{l.outcomes[i.outcome]}</strong></span>
        {editable&&i.outcome==="PENDING"&&<span className="lead-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>act(()=>recordOutcome(i.id,i.version,"PASSED"))}>{l.passed}</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>act(()=>recordOutcome(i.id,i.version,"FAILED"))}>{l.failed}</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>act(()=>recordOutcome(i.id,i.version,"NO_SHOW"))}>{l.noShow}</button></span>}
      </li>)}</ul>}
      {editable&&(app.stage==="SUBMITTED"||app.stage==="INTERVIEWING")&&<form className="opportunity-form rec-form" onSubmit={e=>{e.preventDefault();act(()=>scheduleInterview(app.id,app.version,Number(round),at));}}>
        <label><span>{l.round}</span><input type="number" min="1" max="10" required value={round} onChange={e=>setRound(e.target.value)}/></label>
        <label><span>{l.scheduledAt}</span><input type="datetime-local" required value={at} onChange={e=>setAt(e.target.value)}/></label>
        <button type="submit" className="btn btn-secondary" disabled={busy}><Plus size={16}/>{l.schedule}</button></form>}
    </div>}
    {(app.stage==="INTERVIEWING"||app.stage==="OFFERED"||app.stage==="PLACED")&&<div className="rec-sub"><h3>{l.offer}</h3>
      {app.offerDate&&<p><span dir="ltr">{app.offerDate}</span> · {app.offerStatus==="ACCEPTED"?l.accepted:app.offerStatus==="DECLINED"?l.declined:"…"}</p>}
      {editable&&app.stage==="INTERVIEWING"&&<form className="opportunity-form rec-form" onSubmit={e=>{e.preventDefault();act(()=>recordOffer(app.id,app.version,offerOn));}}>
        <label><span>{l.offerDate}</span><input type="date" required value={offerOn} onChange={e=>setOfferOn(e.target.value)}/></label>
        <button type="submit" className="btn btn-secondary" disabled={busy}>{l.recordOffer}</button></form>}
      {editable&&app.stage==="OFFERED"&&app.offerStatus==="PENDING"&&<div className="lead-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={()=>act(()=>answerOffer(app.id,app.version,true))}>{l.accepted}</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>act(()=>answerOffer(app.id,app.version,false))}>{l.declined}</button></div>}
      {editable&&app.stage==="OFFERED"&&app.offerStatus==="ACCEPTED"&&<form className="opportunity-form rec-form" onSubmit={e=>{e.preventDefault();act(()=>confirmPlacement(app.id,app.version,start));}}>
        <label><span>{l.startDate}</span><input type="date" required value={start} onChange={e=>setStart(e.target.value)}/></label>
        <button type="submit" className="btn btn-primary" disabled={busy}>{l.place}</button></form>}
      <p className="rec-muted">{l.offerNote}</p>
    </div>}
  </section>;
}

function CandidatesRegister({l}:{l:Labels}){
  const [rows,setRows]=useState<Candidate[]|null>(null);const [q,setQ]=useState("");const [applied,setApplied]=useState("");
  const [creating,setCreating]=useState(false);const [error,setError]=useState("");
  const [name,setName]=useState("");const [headline,setHeadline]=useState("");const [years,setYears]=useState("");const [busy,setBusy]=useState(false);
  const load=useCallback(()=>getCandidates(applied||undefined).then(setRows),[applied]);
  useEffect(()=>{setRows(null);void load().catch(e=>{setRows([]);setError(message(e,l));});},[load,l]);
  return <>
    <form className="list-toolbar rec-toolbar" role="search" onSubmit={e=>{e.preventDefault();setApplied(q.trim());}}>
      <label className="search-field"><Search size={18}/><span className="sr-only">{l.searchCandidates}</span><input value={q} maxLength={100} placeholder={l.searchCandidates} onChange={e=>setQ(e.target.value)}/></label>
      <button type="submit" className="btn btn-secondary"><Search size={16}/>{l.search}</button>
      <button type="button" className="btn btn-primary" onClick={()=>setCreating(c=>!c)}><Plus size={16}/>{l.newCandidate}</button>
    </form>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {creating&&<form className="record-content-card opportunity-form rec-form" onSubmit={e=>{e.preventDefault();if(busy)return;setBusy(true);setError("");
      createCandidate({displayName:name,...(headline?{headline}:{}),...(years?{yearsExperience:Number(years)}:{})})
        .then(c=>{window.location.hash="#/recruitment/candidates/"+c.id;}).catch(err=>setError(message(err,l))).finally(()=>setBusy(false));}}>
      <label><span>{l.displayName}</span><input required maxLength={255} value={name} onChange={e=>setName(e.target.value)}/></label>
      <label><span>{l.headline}</span><input maxLength={255} value={headline} onChange={e=>setHeadline(e.target.value)}/></label>
      <label><span>{l.years}</span><input type="number" min="0" max="60" value={years} onChange={e=>setYears(e.target.value)}/></label>
      <div className="lead-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{l.save}</button><button type="button" className="btn btn-secondary" onClick={()=>setCreating(false)}>{l.cancel}</button></div>
    </form>}
    <div className="data-panel"><div className="data-panel-heading"><strong>{l.candidates}</strong><span>{rows?.length??0}</span></div>
      {rows===null?<div className="empty-state" role="status">{l.loading}</div>:rows.length===0?<div className="empty-state"><CircleDashed size={26}/>{l.noCandidates}</div>
      :<div className="directory-items">{rows.map(c=><article className="directory-item" key={c.id}>
        <div className="line-monogram">{c.displayName.slice(0,1)}</div>
        <div className="directory-record"><strong>{c.displayName}</strong><small>{c.headline||"—"}{c.yearsExperience!=null?` · ${c.yearsExperience}`:""}</small></div>
        <span className="rec-private">{c.privateProfileOnFile?<FileLock2 size={14}/>:null}{c.privateProfileOnFile?l.privateOnFile:l.privateNone}</span>
        <a className="text-action" href={"#/recruitment/candidates/"+c.id}>{l.open}</a>
      </article>)}</div>}
    </div>
  </>;
}

function CandidateRecord({candidateId,l,Back}:{candidateId:number;l:Labels;Back:typeof ArrowLeft}){
  const [cand,setCand]=useState<Candidate|null>(null);const [consents,setConsents]=useState<Consent[]>([]);const [orders,setOrders]=useState<JobOrder[]>([]);
  const [loadError,setLoadError]=useState("");
  const [email,setEmail]=useState("");const [phone,setPhone]=useState("");const [salary,setSalary]=useState("");const [cv,setCv]=useState("");
  const [orderId,setOrderId]=useState("");const [method,setMethod]=useState<ConsentMethod>("WRITTEN");const [givenOn,setGivenOn]=useState(today());const [evidence,setEvidence]=useState("");
  const reload=useCallback(async()=>{const [c,k]=await Promise.all([getCandidate(candidateId),getConsents(candidateId)]);setCand(c);setConsents(k);},[candidateId]);
  useEffect(()=>{void reload().catch(e=>setLoadError(message(e,l)));void getJobOrders().then(setOrders).catch(()=>setOrders([]));},[reload,l]);
  const {busy,error,run}=useAction(l,reload);
  if(loadError)return <section className="page-enter"><a className="record-back" href="#/recruitment/candidates"><Back size={17}/>{l.back}</a><div className="error-banner" role="alert"><CircleAlert size={17}/><span>{loadError}</span></div></section>;
  if(!cand)return <div className="empty-state" role="status">{l.loading}</div>;
  const editable=cand.ownedByMe;
  return <article className="record-workspace page-enter rec-record" aria-labelledby="cand-title">
    <div className="record-context-bar"><a className="record-back" href="#/recruitment/candidates"><Back size={17}/>{l.back}</a><span className="record-context-separator">/</span><span className="record-current">{cand.displayName}</span></div>
    <div className="record-hero"><div className="record-hero-main"><span className="eyebrow"><span className="record-eyebrow-dot"/>{l.candidates}</span>
      <div className="record-hero-heading"><div className="record-identity-icon"><UserRound size={30}/></div><div><h1 id="cand-title">{cand.displayName}</h1>
        <div className="record-tags"><span className="record-ref">{cand.headline||"—"}</span>{cand.yearsExperience!=null&&<span className="record-ref">{l.years}: {cand.yearsExperience}</span>}</div></div></div></div></div>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {!editable&&<p className="record-security-note"><LockKeyhole size={15}/>{l.readonly}</p>}
    <div className="record-content-grid">
      <section className="record-content-card rec-private-card" aria-labelledby="private-title">
        <div className="record-section-header"><div className="record-section-icon"><FileLock2 size={20}/></div><div><h2 id="private-title">{l.privateTitle}</h2><p>{cand.privateProfileOnFile?l.privateOnFile:l.privateNone}</p></div></div>
        <p className="record-security-note"><LockKeyhole size={15}/>{l.privateNote}</p>
        {editable&&<form className="opportunity-form rec-form" autoComplete="off" onSubmit={e=>{e.preventDefault();void run(async()=>{
            await savePrivateProfile(cand.id,cand.version,{...(email?{email}:{}),...(phone?{phone}:{}),...(salary?{expectedSalary:salary}:{}),...(cv?{cvReference:cv}:{})});
            setEmail("");setPhone("");setSalary("");setCv("");});}}>
          <label><span>{l.email}</span><input type="email" dir="ltr" maxLength={255} value={email} onChange={e=>setEmail(e.target.value)}/></label>
          <label><span>{l.phone}</span><input type="tel" dir="ltr" maxLength={20} value={phone} onChange={e=>setPhone(e.target.value)}/></label>
          <label><span>{l.salary}</span><input inputMode="decimal" dir="ltr" value={salary} onChange={e=>setSalary(e.target.value)}/></label>
          <label><span>{l.cv}</span><input dir="ltr" maxLength={255} value={cv} onChange={e=>setCv(e.target.value)}/></label>
          <button type="submit" className="btn btn-secondary" disabled={busy}>{l.savePrivate}</button></form>}
      </section>
      <section className="record-content-card" aria-labelledby="consents-title">
        <div className="record-section-header"><div className="record-section-icon"><ClipboardCheck size={20}/></div><div><h2 id="consents-title">{l.consents}</h2></div></div>
        {consents.length===0?<p className="rec-muted">{l.noConsents}</p>:<ul className="rec-list">{consents.map(c=><li key={c.id}>
          <span><strong dir="ltr">{c.jobOrderReference}</strong> · {l.methods[c.method]} · <span dir="ltr">{c.givenOn}</span>{c.revokedAt?` · ${l.revoked}`:""}</span>
          {editable&&c.active&&<button type="button" className="text-action" disabled={busy} onClick={()=>void run(()=>revokeConsent(c.id,c.version))}>{l.revoke}</button>}</li>)}</ul>}
        {editable&&<form className="opportunity-form rec-form" onSubmit={e=>{e.preventDefault();void run(()=>recordConsent(cand.id,cand.version,{jobOrderId:Number(orderId),method,givenOn,...(evidence?{evidenceReference:evidence}:{})}));}}>
          <label><span>{l.jobOrder}</span><select required value={orderId} onChange={e=>setOrderId(e.target.value)}>
            <option value="">{l.chooseOrder}</option>{orders.map(o=><option key={o.id} value={o.id}>{o.reference} · {o.title}</option>)}</select></label>
          <label><span>{l.method}</span><select value={method} onChange={e=>setMethod(e.target.value as ConsentMethod)}>
            {(["WRITTEN","EMAIL","RECORDED_CALL"] as ConsentMethod[]).map(m=><option key={m} value={m}>{l.methods[m]}</option>)}</select></label>
          <label><span>{l.givenOn}</span><input type="date" required max={today()} value={givenOn} onChange={e=>setGivenOn(e.target.value)}/></label>
          <label><span>{l.evidence}</span><input dir="ltr" maxLength={255} value={evidence} onChange={e=>setEvidence(e.target.value)}/></label>
          <button type="submit" className="btn btn-secondary" disabled={busy}><Plus size={16}/>{l.recordConsent}</button></form>}
      </section>
    </div>
  </article>;
}
