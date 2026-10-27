import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, BadgeCheck, CalendarCheck, CheckCircle2, CircleAlert, CircleDashed, ClipboardList, History,
  LockKeyhole, Plus, RefreshCw, Search, ShieldCheck, UserCheck, XCircle,
} from "lucide-react";
import { ApiError, getAccounts, type AccountSummary, type BusinessLine } from "./api";
import {
  cancelAudit, closeNonconformity, completeAudit, createCycle, createQualification, getAuditorCandidates, getAudits,
  getCycle, getCycles, getEligibleAuditors, getNonconformities, getQualifications, getTimeline, planAudit,
  raiseNonconformity, respondNonconformity,
  type AuditType, type CertificationAudit, type CertificationCycle, type CyclePhase, type DecisionBlocker, type NcGrade,
  type Nonconformity, type Person, type Qualification, type TimelineEvent,
} from "./certificationApi";
import type { Language } from "./preferences";
import "./certification.css";
import { PageHeader } from "./ui";

const strings = {
  ar: {
    title:"شهادات الأيزو للعملاء",desc:"دورات الاعتماد وبرنامج التدقيق وكفاءة المدققين وعدم المطابقات، ضمن صلاحياتك.",
    cycles:"دورات الاعتماد",competence:"كفاءة المدققين",newCycle:"فتح دورة اعتماد",search:"ابحث بالمرجع أو اسم العميل",
    allStandards:"كل المعايير",allPhases:"كل المراحل",mine:"دوراتي فقط",apply:"بحث",loadMore:"تحميل المزيد",
    empty:"لا توجد دورات اعتماد مطابقة",loading:"جار التحميل...",retry:"إعادة المحاولة",open:"فتح",back:"العودة إلى دورات الاعتماد",
    reference:"المرجع",client:"العميل",chooseClient:"اختر العميل",standard:"المعيار",chooseStandard:"اختر المعيار",scope:"نطاق الاعتماد",
    sites:"عدد المواقع",manager:"مدير البرنامج",save:"حفظ",cancel:"إلغاء",openMajors:"عدم مطابقة جسيمة مفتوحة",
    phases:{STAGE1_PENDING:"بانتظار المرحلة الأولى",STAGE2_PENDING:"بانتظار المرحلة الثانية",FINDINGS_OPEN:"ملاحظات جسيمة مفتوحة",READY_FOR_DECISION:"جاهزة لقرار الاعتماد"},
    readiness:"الجاهزية لقرار الاعتماد",readinessDesc:"ما يفصل هذه الدورة عن قرار الاعتماد، كما يحسبه الخادم.",
    blockers:{STAGE1_NOT_COMPLETED:"إتمام تدقيق المرحلة الأولى",STAGE2_NOT_COMPLETED:"إتمام تدقيق المرحلة الثانية (بعد الأولى)",OPEN_MAJOR_NONCONFORMITIES:"إغلاق كل عدم المطابقات الجسيمة بعد رد العميل",POLICY_D02:"اعتماد سياسة الاعتماد (D-02): من يتخذ القرار، الحيادية، ترقيم الشهادات وصلاحيتها والمراقبة"},
    decision:"قرار الاعتماد",certificate:"إصدار الشهادة",policyNote:"قرار الاعتماد وإصدار الشهادات وتدقيقات المراقبة وإعادة الاعتماد متوقفة حتى اعتماد IOETI للسياسة D-02. لا تُحسب أيام التدقيق ولا مدد الصلاحية هنا.",
    programme:"برنامج التدقيق",stage:{STAGE1:"تدقيق المرحلة الأولى",STAGE2:"تدقيق المرحلة الثانية"},
    notPlanned:"لم يُخطط بعد",plannedDate:"تاريخ التدقيق المخطط",auditor:"المدقق الرئيسي",chooseAuditor:"اختر مدققًا مؤهلًا",
    noEligible:"لا يوجد مدقق مؤهل لهذا المعيار في هذا التاريخ. سجّل كفاءة مدقق أو اختر تاريخًا آخر.",pickDate:"اختر التاريخ لعرض المدققين المؤهلين في ذلك اليوم.",
    plan:"تخطيط التدقيق",completedOn:"تاريخ الإتمام",complete:"تسجيل الإتمام",cancelAudit:"إلغاء التدقيق",
    stage2Hint:"يمكن تخطيط المرحلة الثانية الآن، لكن لا تُسجل كمكتملة قبل إتمام المرحلة الأولى.",
    status:{PLANNED:"مخطط",COMPLETED:"مكتمل",CANCELLED:"ملغى",OPEN:"مفتوحة",RESPONDED:"تم الرد",CLOSED:"مغلقة"},
    findings:"عدم المطابقات والملاحظات",noFindings:"لا توجد ملاحظات مسجلة",grade:"الدرجة",grades:{MAJOR:"جسيمة",MINOR:"بسيطة",OBSERVATION:"ملاحظة"},
    clause:"البند",statement:"بيان عدم المطابقة",raise:"تسجيل ملاحظة",response:"تصحيح العميل وإجراءه التصحيحي",respond:"تسجيل رد العميل",
    close:"إغلاق بعد التحقق",timeline:"سجل التدقيق",noTimeline:"لا توجد أحداث بعد",
    events:{CYCLE_OPENED:"فُتحت دورة الاعتماد",AUDIT_PLANNED:"خُطط تدقيق",AUDIT_COMPLETED:"اكتمل تدقيق",AUDIT_CANCELLED:"أُلغي تدقيق",NC_RAISED:"سُجلت ملاحظة",NC_RESPONDED:"رد العميل",NC_CLOSED:"أُغلقت ملاحظة"},
    qualifications:"سجل كفاءة المدققين",noQualifications:"لا توجد كفاءات مسجلة",validFrom:"صالحة من",validUntil:"صالحة حتى",
    evidence:"مرجع الإثبات",addQualification:"تسجيل كفاءة",expired:"منتهية",candidatesDenied:"تسجيل الكفاءات متاح لمن يملك صلاحية ذلك فقط.",
    readonly:"عرض فقط: مدير البرنامج وحده يعدّل هذه الدورة.",
    errors:{NOT_QUALIFIED:"المدقق غير مؤهل لهذا المعيار في التاريخ المخطط.",STAGE_EXISTS:"هذه المرحلة مخطط لها بالفعل في الدورة.",STAGE1_REQUIRED:"أتمّ تدقيق المرحلة الأولى قبل الثانية.",AUDIT_STATE:"لا يمكن تعديل إلا تدقيق مخطط.",AUDIT_CANCELLED:"لا تُسجل ملاحظات على تدقيق ملغى.",RESPONSE_REQUIRED:"سجّل رد العميل قبل الإغلاق.",NC_CLOSED:"هذه الملاحظة مغلقة بالفعل.",BLOCKED_BY_POLICY:"متوقف حتى اعتماد السياسة D-02.",conflict:"تم تعديل البيانات من مكان آخر؛ حدّثناها، أعد المحاولة.",invalid:"راجع الحقول المطلوبة وقيمها.",denied:"ليست لديك صلاحية لهذا الإجراء.",failed:"تعذّر تنفيذ الطلب."},
  },
  en: {
    title:"Client ISO certification",desc:"Certification cycles, audit programme, auditor competence and nonconformities, within your permissions.",
    cycles:"Certification cycles",competence:"Auditor competence",newCycle:"Open a certification cycle",search:"Search by reference or client name",
    allStandards:"All standards",allPhases:"All phases",mine:"My cycles only",apply:"Search",loadMore:"Load more",
    empty:"No matching certification cycles",loading:"Loading...",retry:"Retry",open:"Open",back:"Back to certification cycles",
    reference:"Reference",client:"Client",chooseClient:"Choose a client",standard:"Standard",chooseStandard:"Choose a standard",scope:"Certification scope",
    sites:"Sites",manager:"Programme manager",save:"Save",cancel:"Cancel",openMajors:"Open major nonconformities",
    phases:{STAGE1_PENDING:"Awaiting Stage 1",STAGE2_PENDING:"Awaiting Stage 2",FINDINGS_OPEN:"Major findings open",READY_FOR_DECISION:"Ready for decision"},
    readiness:"Readiness for the certification decision",readinessDesc:"What stands between this cycle and a decision, as computed by the server.",
    blockers:{STAGE1_NOT_COMPLETED:"Complete the Stage 1 audit",STAGE2_NOT_COMPLETED:"Complete the Stage 2 audit (after Stage 1)",OPEN_MAJOR_NONCONFORMITIES:"Close every major nonconformity after the client's response",POLICY_D02:"Sign the certification policy (D-02): decision maker, impartiality, certificate numbering, validity and surveillance"},
    decision:"Certification decision",certificate:"Issue certificate",policyNote:"Certification decisions, certificates, surveillance and recertification audits are blocked until IOETI signs policy D-02. Audit days and validity periods are not computed here.",
    programme:"Audit programme",stage:{STAGE1:"Stage 1 audit",STAGE2:"Stage 2 audit"},
    notPlanned:"Not planned yet",plannedDate:"Planned date",auditor:"Lead auditor",chooseAuditor:"Choose a qualified auditor",
    noEligible:"No auditor is qualified for this standard on that date. Record a qualification or choose another date.",pickDate:"Pick the date to see the auditors qualified on that day.",
    plan:"Plan audit",completedOn:"Completed on",complete:"Record completion",cancelAudit:"Cancel audit",
    stage2Hint:"Stage 2 can be planned now but cannot be completed before Stage 1.",
    status:{PLANNED:"Planned",COMPLETED:"Completed",CANCELLED:"Cancelled",OPEN:"Open",RESPONDED:"Responded",CLOSED:"Closed"},
    findings:"Nonconformities and observations",noFindings:"No findings recorded",grade:"Grade",grades:{MAJOR:"Major",MINOR:"Minor",OBSERVATION:"Observation"},
    clause:"Clause",statement:"Nonconformity statement",raise:"Record finding",response:"Client correction and corrective action",respond:"Record client response",
    close:"Close after verification",timeline:"Audit history",noTimeline:"No events yet",
    events:{CYCLE_OPENED:"Cycle opened",AUDIT_PLANNED:"Audit planned",AUDIT_COMPLETED:"Audit completed",AUDIT_CANCELLED:"Audit cancelled",NC_RAISED:"Finding recorded",NC_RESPONDED:"Client responded",NC_CLOSED:"Finding closed"},
    qualifications:"Auditor competence register",noQualifications:"No qualifications recorded",validFrom:"Valid from",validUntil:"Valid until",
    evidence:"Evidence reference",addQualification:"Record qualification",expired:"Expired",candidatesDenied:"Only people allowed to record qualifications can add them.",
    readonly:"Read only: only the programme manager changes this cycle.",
    errors:{NOT_QUALIFIED:"The auditor is not qualified for this standard on the planned date.",STAGE_EXISTS:"This stage is already planned for the cycle.",STAGE1_REQUIRED:"Complete the Stage 1 audit before Stage 2.",AUDIT_STATE:"Only a planned audit can be changed.",AUDIT_CANCELLED:"A cancelled audit cannot record findings.",RESPONSE_REQUIRED:"Record the client's response before closing.",NC_CLOSED:"This finding is already closed.",BLOCKED_BY_POLICY:"Blocked until policy D-02 is signed.",conflict:"The data changed elsewhere; it is refreshed, try again.",invalid:"Check the required fields and their values.",denied:"You do not have permission for this action.",failed:"The request failed."},
  },
} as const;
type Labels = typeof strings.ar | typeof strings.en;
const PHASES: CyclePhase[] = ["STAGE1_PENDING","STAGE2_PENDING","FINDINGS_OPEN","READY_FOR_DECISION"];
const BLOCKERS: DecisionBlocker[] = ["STAGE1_NOT_COMPLETED","STAGE2_NOT_COMPLETED","OPEN_MAJOR_NONCONFORMITIES","POLICY_D02"];

function message(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.errors.failed;
  const field = error.fields[0];
  if (field?.code === "NOT_QUALIFIED") return l.errors.NOT_QUALIFIED;
  const known = error.code && (l.errors as Record<string, string>)[error.code];
  if (known) return known;
  if (error.statusCode === 409) return l.errors.conflict;
  if (error.statusCode === 422 && error.fields.length) return l.errors.invalid;
  if (error.statusCode === 403 || error.statusCode === 404) return l.errors.denied;
  return l.errors.failed;
}
const today = () => new Date().toISOString().slice(0, 10);
function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/certification\/?/, "").split("/").filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const sync = () => setRoute(read());
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => { window.removeEventListener("hashchange", sync); window.removeEventListener("popstate", sync); };
  }, []);
  return route;
}
function go(path: string) {
  if (window.location.hash !== "#/certification" + path) window.location.hash = "#/certification" + path;
}

/** Client ISO certification workspace (real mode): register, cycle record and auditor competence. */
export function CertificationPage({language,lines}:{language:Language;lines:BusinessLine[]}){
  const l=strings[language];
  const route=useRoute();
  const standards=useMemo(()=>lines.filter(line=>line.status===2&&/^ISO/.test(line.code)),[lines]);
  const cycleId=route[0]&&/^\d+$/.test(route[0])?Number(route[0]):null;
  if(cycleId!=null)return <CycleRecord key={cycleId} cycleId={cycleId} l={l} language={language}/>;
  return <section className="page-enter certification-page">
    <PageHeader className="directory-head" eyebrow={language==="ar"?"التنفيذ والخدمات":"Delivery & services"} title={l.title} description={l.desc}/>
    <div className="demo-record-tabs cert-tabs" role="tablist" aria-label={l.title}>
      <button type="button" role="tab" aria-selected={route[0]!=="qualifications"} className={route[0]!=="qualifications"?"active":""} onClick={()=>go("")}>{l.cycles}</button>
      <button type="button" role="tab" aria-selected={route[0]==="qualifications"} className={route[0]==="qualifications"?"active":""} onClick={()=>go("/qualifications")}>{l.competence}</button>
    </div>
    {route[0]==="qualifications"?<QualificationsView l={l} standards={standards}/>:<CycleRegister l={l} standards={standards}/>}
  </section>;
}

function CycleRegister({l,standards}:{l:Labels;standards:BusinessLine[]}){
  const [rows,setRows]=useState<CertificationCycle[]|null>(null);
  const [q,setQ]=useState("");const [applied,setApplied]=useState("");
  const [standard,setStandard]=useState("");const [phase,setPhase]=useState<CyclePhase|"">("");const [mine,setMine]=useState(false);
  const [more,setMore]=useState(false);const [error,setError]=useState("");const [creating,setCreating]=useState(false);
  const filters={q:applied,standardCode:standard,phase,mine};
  const load=useCallback(async(offset=0)=>{
    setError("");
    const page=await getCycles({...filters,limit:25,offset});
    setRows(cur=>offset===0?page:[...(cur||[]),...page]);setMore(page.length===25);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[applied,standard,phase,mine]);
  useEffect(()=>{setRows(null);void load().catch(e=>{setRows([]);setError(message(e,l));});},[load,l]);
  return <>
    <form className="list-toolbar cert-filters" role="search" onSubmit={e=>{e.preventDefault();setApplied(q.trim());}}>
      <label className="search-field"><Search size={18}/><span className="sr-only">{l.search}</span><input value={q} placeholder={l.search} maxLength={100} onChange={e=>setQ(e.target.value)}/></label>
      <label className="cert-filter"><span className="sr-only">{l.standard}</span><select value={standard} onChange={e=>setStandard(e.target.value)}>
        <option value="">{l.allStandards}</option>{standards.map(s=><option key={s.code} value={s.code}>{s.code}</option>)}</select></label>
      <label className="cert-filter"><span className="sr-only">{l.allPhases}</span><select value={phase} onChange={e=>setPhase(e.target.value as CyclePhase|"")}>
        <option value="">{l.allPhases}</option>{PHASES.map(p=><option key={p} value={p}>{l.phases[p]}</option>)}</select></label>
      <label className="cert-mine"><input type="checkbox" checked={mine} onChange={e=>setMine(e.target.checked)}/>{l.mine}</label>
      <button type="submit" className="btn btn-secondary"><Search size={16}/>{l.apply}</button>
      <button type="button" className="btn btn-primary" onClick={()=>setCreating(c=>!c)}><Plus size={16}/>{l.newCycle}</button>
    </form>
    {creating&&<CycleForm l={l} standards={standards} onCancel={()=>setCreating(false)} onCreated={c=>{setCreating(false);go("/"+c.id);}}/>}
    {error&&<div className="error-banner" role="alert"><CircleAlert size={17}/><span>{error}</span><button className="btn btn-secondary" type="button" onClick={()=>void load().catch(e=>setError(message(e,l)))}><RefreshCw size={15}/>{l.retry}</button></div>}
    <div className="data-panel"><div className="data-panel-heading"><strong>{l.cycles}</strong><span>{rows?.length??0}</span></div>
      {rows===null?<div className="empty-state" role="status">{l.loading}</div>
      :rows.length===0?<div className="empty-state"><CircleDashed size={26}/>{l.empty}</div>
      :<div className="directory-items">{rows.map(c=><article className="directory-item cert-row" key={c.id}>
        <div className="line-monogram">{c.standardCode.replace("ISO","").slice(0,4)}</div>
        <div className="directory-record"><strong>{c.clientName||"—"}</strong>
          <small><span dir="ltr">{c.reference}</span> · {c.standardCode}{c.managerName?` · ${c.managerName}`:""}</small></div>
        <PhaseBadge phase={c.phase} l={l}/>
        {c.openMajors>0&&<span className="cert-majors" title={l.openMajors}>{c.openMajors}</span>}
        <a className="text-action" href={"#/certification/"+c.id}>{l.open}</a>
      </article>)}</div>}
      {more&&<div className="directory-more"><button type="button" className="btn btn-secondary" onClick={()=>void load(rows?.length??0).catch(e=>setError(message(e,l)))}>{l.loadMore}</button></div>}
    </div>
  </>;
}

function PhaseBadge({phase,l}:{phase:CyclePhase;l:Labels}){
  return <span className={"cert-phase cert-phase-"+phase.toLowerCase()}>{phase==="READY_FOR_DECISION"?<CheckCircle2 size={14}/>:<CircleDashed size={14}/>}{l.phases[phase]}</span>;
}

function CycleForm({l,standards,onCancel,onCreated}:{l:Labels;standards:BusinessLine[];onCancel:()=>void;onCreated:(c:CertificationCycle)=>void}){
  const [accounts,setAccounts]=useState<AccountSummary[]>([]);
  const [reference,setReference]=useState("");const [clientId,setClientId]=useState("");const [standard,setStandard]=useState("");
  const [scope,setScope]=useState("");const [sites,setSites]=useState("1");const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  useEffect(()=>{void getAccounts(0,50).then(setAccounts).catch(()=>setAccounts([]));},[]);
  return <form className="record-content-card opportunity-form cert-form" onSubmit={e=>{e.preventDefault();if(busy)return;setBusy(true);setError("");
    createCycle({reference,clientId:Number(clientId),standardCode:standard,scope,siteCount:sites?Number(sites):undefined})
      .then(onCreated).catch(err=>setError(message(err,l))).finally(()=>setBusy(false));}}>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    <label><span>{l.reference}</span><input required dir="ltr" maxLength={30} value={reference} onChange={e=>setReference(e.target.value)}/></label>
    <label><span>{l.client}</span><select required value={clientId} onChange={e=>setClientId(e.target.value)}>
      <option value="">{l.chooseClient}</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <label><span>{l.standard}</span><select required value={standard} onChange={e=>setStandard(e.target.value)}>
      <option value="">{l.chooseStandard}</option>{standards.map(s=><option key={s.code} value={s.code}>{s.code}</option>)}</select></label>
    <label><span>{l.sites}</span><input type="number" min="1" max="1000" value={sites} onChange={e=>setSites(e.target.value)}/></label>
    <label className="cert-wide"><span>{l.scope}</span><textarea required rows={3} maxLength={4000} value={scope} onChange={e=>setScope(e.target.value)}/></label>
    <div className="lead-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{l.save}</button>
      <button type="button" className="btn btn-secondary" onClick={onCancel}>{l.cancel}</button></div>
  </form>;
}

function CycleRecord({cycleId,l,language}:{cycleId:number;l:Labels;language:Language}){
  const [cycle,setCycle]=useState<CertificationCycle|null>(null);
  const [audits,setAudits]=useState<CertificationAudit[]>([]);
  const [timeline,setTimeline]=useState<TimelineEvent[]>([]);
  const [error,setError]=useState("");const [loadError,setLoadError]=useState("");
  const reload=useCallback(async()=>{
    const [c,a,t]=await Promise.all([getCycle(cycleId),getAudits(cycleId),getTimeline(cycleId)]);
    setCycle(c);setAudits(a);setTimeline(t);
  },[cycleId]);
  useEffect(()=>{void reload().catch(e=>setLoadError(message(e,l)));window.scrollTo({top:0,behavior:"instant"});},[reload,l]);
  const run=useCallback(async(action:()=>Promise<unknown>)=>{
    setError("");
    try{await action();await reload();return true;}
    catch(e){setError(message(e,l));void reload().catch(()=>undefined);return false;}
  },[reload,l]);
  const Back=language==="ar"?ArrowRight:ArrowLeft;
  if(loadError)return <section className="page-enter"><a className="record-back" href="#/certification"><Back size={17}/>{l.back}</a>
    <div className="error-banner" role="alert"><CircleAlert size={17}/><span>{loadError}</span><button type="button" className="btn btn-secondary" onClick={()=>{setLoadError("");void reload().catch(e=>setLoadError(message(e,l)));}}>{l.retry}</button></div></section>;
  if(!cycle)return <div className="empty-state" role="status">{l.loading}</div>;
  const editable=cycle.managedByMe;
  const active=(type:AuditType)=>audits.find(a=>a.type===type&&a.status!=="CANCELLED")||null;
  return <article className="record-workspace page-enter cert-record" aria-labelledby="cycle-title">
    <div className="record-context-bar"><a className="record-back" href="#/certification"><Back size={17}/>{l.back}</a>
      <span className="record-context-separator">/</span><span className="record-current" aria-current="page" dir="ltr">{cycle.reference}</span></div>
    <div className="record-hero"><div className="record-hero-main">
      <span className="eyebrow"><span className="record-eyebrow-dot"/>{l.title} · {cycle.standardCode}</span>
      <div className="record-hero-heading"><div className="record-identity-icon"><BadgeCheck size={30}/></div>
        <div><h1 id="cycle-title">{cycle.clientName||cycle.reference}</h1>
          <div className="record-tags"><PhaseBadge phase={cycle.phase} l={l}/><span className="record-ref" dir="ltr">{cycle.reference}</span>
            {cycle.clientId!=null&&<a className="record-ref" href={"#/accounts/"+cycle.clientId}>{l.client}</a>}</div></div></div>
      <p className="record-hero-description">{cycle.scope}</p>
    </div><div className="record-hero-actions">
      <span className="record-readonly-pill"><LockKeyhole size={14}/>{l.decision}</span>
    </div></div>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {!editable&&<p className="record-security-note"><LockKeyhole size={15}/>{l.readonly}</p>}
    <div className="record-content-grid">
      <section className="record-content-card" aria-labelledby="readiness-title">
        <div className="record-section-header"><div className="record-section-icon"><ShieldCheck size={20}/></div><div><h2 id="readiness-title">{l.readiness}</h2><p>{l.readinessDesc}</p></div></div>
        <ol className="cert-readiness">{BLOCKERS.map(b=>{const blocked=cycle.decisionBlockers.includes(b);
          return <li key={b} className={blocked?"is-blocked":"is-done"}>{blocked?<XCircle size={17}/>:<CheckCircle2 size={17}/>}<span>{l.blockers[b]}</span></li>;})}</ol>
        <div className="lead-actions"><button type="button" className="btn btn-primary" disabled aria-describedby="cert-policy">{l.decision}</button>
          <button type="button" className="btn btn-secondary" disabled aria-describedby="cert-policy">{l.certificate}</button></div>
        <p className="record-security-note" id="cert-policy"><LockKeyhole size={15}/>{l.policyNote}</p>
      </section>
      <section className="record-content-card" aria-labelledby="cycle-facts">
        <div className="record-section-header"><div className="record-section-icon"><ClipboardList size={20}/></div><div><h2 id="cycle-facts">{l.scope}</h2></div></div>
        <dl className="record-properties">
          <div><dt>{l.client}</dt><dd>{cycle.clientName||"—"}</dd></div>
          <div><dt>{l.standard}</dt><dd dir="ltr">{cycle.standardCode}</dd></div>
          <div><dt>{l.sites}</dt><dd>{cycle.siteCount??"—"}</dd></div>
          <div><dt>{l.manager}</dt><dd>{cycle.managerName||"—"}</dd></div>
          <div><dt>{l.openMajors}</dt><dd>{cycle.openMajors}</dd></div>
        </dl>
      </section>
    </div>
    <section className="record-content-card cert-programme" aria-labelledby="programme-title">
      <div className="record-section-header"><div className="record-section-icon"><CalendarCheck size={20}/></div><div><h2 id="programme-title">{l.programme}</h2></div></div>
      <div className="cert-stages">{(["STAGE1","STAGE2"] as AuditType[]).map(type=><StageCard key={type} type={type} audit={active(type)}
        cycle={cycle} editable={editable} l={l} run={run} stage1Done={active("STAGE1")?.status==="COMPLETED"}/>)}</div>
    </section>
    <section className="record-content-card" aria-labelledby="timeline-title">
      <div className="record-section-header"><div className="record-section-icon"><History size={20}/></div><div><h2 id="timeline-title">{l.timeline}</h2></div></div>
      {timeline.length===0?<div className="empty-state">{l.noTimeline}</div>
      :<ol className="cert-timeline">{timeline.map((ev,i)=><li key={i}><span className="cert-timeline-dot"/>
        <div><strong>{l.events[ev.kind]}</strong> <span dir="ltr">{ev.label in l.stage?l.stage[ev.label as AuditType]:ev.label}</span>{ev.actorName?` · ${ev.actorName}`:""}
          <small dir="ltr">{ev.at?ev.at.replace("T"," ").slice(0,16):""}</small></div></li>)}</ol>}
    </section>
  </article>;
}

function StageCard({type,audit,cycle,editable,l,run,stage1Done}:{type:AuditType;audit:CertificationAudit|null;cycle:CertificationCycle;
  editable:boolean;l:Labels;run:(a:()=>Promise<unknown>)=>Promise<boolean>;stage1Done:boolean}){
  const [date,setDate]=useState("");const [eligible,setEligible]=useState<Person[]|null>(null);const [auditor,setAuditor]=useState("");
  const [doneOn,setDoneOn]=useState(today());const [busy,setBusy]=useState(false);
  useEffect(()=>{setAuditor("");setEligible(null);if(!date)return;let current=true;
    void getEligibleAuditors(cycle.id,date).then(r=>{if(current)setEligible(r);}).catch(()=>{if(current)setEligible([]);});
    return()=>{current=false;};},[date,cycle.id]);
  const act=async(action:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);await run(action);setBusy(false);};
  return <div className={"cert-stage"+(audit?" is-"+audit.status.toLowerCase():"")} aria-labelledby={"stage-"+type}>
    <div className="cert-stage-head"><h3 id={"stage-"+type}>{l.stage[type]}</h3>
      <span className="record-status-tag">{audit?l.status[audit.status]:l.notPlanned}</span></div>
    {audit?<dl className="record-properties">
      <div><dt>{l.plannedDate}</dt><dd dir="ltr">{audit.plannedDate}</dd></div>
      <div><dt>{l.auditor}</dt><dd><UserCheck size={14}/> {audit.auditorName}</dd></div>
      {audit.completedOn&&<div><dt>{l.completedOn}</dt><dd dir="ltr">{audit.completedOn}</dd></div>}
    </dl>:editable?<form className="opportunity-form cert-form" onSubmit={e=>{e.preventDefault();
        void act(async()=>{await planAudit(cycle.id,cycle.version,type,date,Number(auditor));setDate("");});}}>
      {type==="STAGE2"&&!stage1Done&&<p className="cert-hint">{l.stage2Hint}</p>}
      <label><span>{l.plannedDate}</span><input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label>
      <label><span>{l.auditor}</span><select required value={auditor} disabled={!eligible||eligible.length===0} onChange={e=>setAuditor(e.target.value)}>
        <option value="">{l.chooseAuditor}</option>{(eligible||[]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <p className="cert-hint" role="status">{!date?l.pickDate:eligible&&eligible.length===0?l.noEligible:""}</p>
      <button type="submit" className="btn btn-primary" disabled={busy||!auditor}><Plus size={16}/>{l.plan}</button>
    </form>:<p className="cert-hint">{l.notPlanned}</p>}
    {audit&&audit.status==="PLANNED"&&editable&&<form className="opportunity-form cert-form" onSubmit={e=>{e.preventDefault();
        void act(()=>completeAudit(audit.id,audit.version,doneOn));}}>
      <label><span>{l.completedOn}</span><input type="date" required value={doneOn} onChange={e=>setDoneOn(e.target.value)}/></label>
      <div className="lead-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{l.complete}</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void act(()=>cancelAudit(audit.id,audit.version))}>{l.cancelAudit}</button></div>
    </form>}
    {audit&&<Findings audit={audit} editable={editable} l={l} run={run}/>}
  </div>;
}

function Findings({audit,editable,l,run}:{audit:CertificationAudit;editable:boolean;l:Labels;run:(a:()=>Promise<unknown>)=>Promise<boolean>}){
  const [rows,setRows]=useState<Nonconformity[]|null>(null);
  const [grade,setGrade]=useState<NcGrade>("MINOR");const [clause,setClause]=useState("");const [statement,setStatement]=useState("");
  const [responses,setResponses]=useState<Record<number,string>>({});const [busy,setBusy]=useState(false);
  const load=useCallback(()=>getNonconformities(audit.id).then(setRows).catch(()=>setRows([])),[audit.id]);
  // the audit version moves when a finding is added, so reload findings with it
  useEffect(()=>{void load();},[load,audit.version]);
  const act=async(action:()=>Promise<unknown>)=>{if(busy)return false;setBusy(true);const ok=await run(action);await load();setBusy(false);return ok;};
  return <div className="cert-findings"><h4>{l.findings}</h4>
    {rows===null?<div className="empty-state" role="status">{l.loading}</div>:rows.length===0?<p className="cert-hint">{l.noFindings}</p>
    :<ul className="cert-nc-list">{rows.map(nc=><li key={nc.id} className={"cert-nc cert-nc-"+nc.grade.toLowerCase()}>
      <div className="cert-nc-head"><span className="cert-grade">{l.grades[nc.grade]}</span>{nc.clause&&<span dir="ltr">{nc.clause}</span>}
        <span className="record-status-tag">{l.status[nc.status]}</span></div>
      <p>{nc.statement}</p>
      {nc.clientResponse&&<p className="cert-response"><strong>{l.response}:</strong> {nc.clientResponse}</p>}
      {editable&&nc.status!=="CLOSED"&&<div className="cert-nc-actions">
        <label><span className="sr-only">{l.response}</span><textarea rows={2} maxLength={4000} placeholder={l.response}
          value={responses[nc.id]??""} onChange={e=>setResponses(r=>({...r,[nc.id]:e.target.value}))}/></label>
        <div className="lead-actions"><button type="button" className="btn btn-secondary" disabled={busy||!(responses[nc.id]||"").trim()}
          onClick={()=>void act(()=>respondNonconformity(nc.id,nc.version,(responses[nc.id]||"").trim())).then(ok=>{if(ok)setResponses(r=>({...r,[nc.id]:""}));})}>{l.respond}</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={()=>void act(()=>closeNonconformity(nc.id,nc.version))}>{l.close}</button></div>
      </div>}
    </li>)}</ul>}
    {editable&&audit.status!=="CANCELLED"&&<form className="opportunity-form cert-form" onSubmit={e=>{e.preventDefault();
        void act(()=>raiseNonconformity(audit.id,audit.version,grade,clause.trim(),statement.trim())).then(ok=>{if(ok){setClause("");setStatement("");}});}}>
      <label><span>{l.grade}</span><select value={grade} onChange={e=>setGrade(e.target.value as NcGrade)}>
        {(["MAJOR","MINOR","OBSERVATION"] as NcGrade[]).map(g=><option key={g} value={g}>{l.grades[g]}</option>)}</select></label>
      <label><span>{l.clause}</span><input dir="ltr" maxLength={20} value={clause} onChange={e=>setClause(e.target.value)}/></label>
      <label className="cert-wide"><span>{l.statement}</span><textarea required rows={2} maxLength={4000} value={statement} onChange={e=>setStatement(e.target.value)}/></label>
      <button type="submit" className="btn btn-secondary" disabled={busy}><Plus size={16}/>{l.raise}</button>
    </form>}
  </div>;
}

function QualificationsView({l,standards}:{l:Labels;standards:BusinessLine[]}){
  const [rows,setRows]=useState<Qualification[]|null>(null);const [people,setPeople]=useState<Person[]|null>(null);
  const [auditor,setAuditor]=useState("");const [standard,setStandard]=useState("");const [from,setFrom]=useState("");const [until,setUntil]=useState("");
  const [evidence,setEvidence]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const load=useCallback(()=>getQualifications().then(setRows),[]);
  useEffect(()=>{void load().catch(e=>{setRows([]);setError(message(e,l));});void getAuditorCandidates().then(setPeople).catch(()=>setPeople([]));},[load,l]);
  const now=today();
  return <>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {people&&people.length>0?<form className="record-content-card opportunity-form cert-form" onSubmit={e=>{e.preventDefault();if(busy)return;setBusy(true);setError("");
        createQualification({auditorId:Number(auditor),standardCode:standard,validFrom:from,validUntil:until,...(evidence?{evidenceReference:evidence}:{})})
          .then(async()=>{setAuditor("");setEvidence("");await load();}).catch(err=>setError(message(err,l))).finally(()=>setBusy(false));}}>
      <label><span>{l.auditor}</span><select required value={auditor} onChange={e=>setAuditor(e.target.value)}>
        <option value="">{l.chooseAuditor}</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label><span>{l.standard}</span><select required value={standard} onChange={e=>setStandard(e.target.value)}>
        <option value="">{l.chooseStandard}</option>{standards.map(s=><option key={s.code} value={s.code}>{s.code}</option>)}</select></label>
      <label><span>{l.validFrom}</span><input type="date" required value={from} onChange={e=>setFrom(e.target.value)}/></label>
      <label><span>{l.validUntil}</span><input type="date" required value={until} onChange={e=>setUntil(e.target.value)}/></label>
      <label><span>{l.evidence}</span><input dir="ltr" maxLength={255} value={evidence} onChange={e=>setEvidence(e.target.value)}/></label>
      <button type="submit" className="btn btn-primary" disabled={busy}><Plus size={16}/>{l.addQualification}</button>
    </form>:people&&<p className="record-security-note"><LockKeyhole size={15}/>{l.candidatesDenied}</p>}
    <div className="data-panel"><div className="data-panel-heading"><strong>{l.qualifications}</strong><span>{rows?.length??0}</span></div>
      {rows===null?<div className="empty-state" role="status">{l.loading}</div>:rows.length===0?<div className="empty-state">{l.noQualifications}</div>
      :<div className="table-scroll"><table><thead><tr><th>{l.auditor}</th><th>{l.standard}</th><th>{l.validFrom}</th><th>{l.validUntil}</th><th>{l.evidence}</th></tr></thead>
        <tbody>{rows.map(qr=><tr key={qr.id}><td><strong>{qr.auditorName}</strong></td><td dir="ltr">{qr.standardCode}</td><td dir="ltr">{qr.validFrom}</td>
          <td><span dir="ltr">{qr.validUntil}</span>{qr.validUntil<now&&<span className="cert-expired"> · {l.expired}</span>}</td><td dir="ltr">{qr.evidenceReference||"—"}</td></tr>)}</tbody></table></div>}
    </div>
  </>;
}
