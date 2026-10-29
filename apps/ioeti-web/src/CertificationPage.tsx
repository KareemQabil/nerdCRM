import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, Award, Ban, BadgeCheck, CalendarCheck, CalendarClock, CheckCircle2, CircleAlert, CircleDashed, CirclePause,
  CirclePlay, ClipboardList, Gavel, History, LockKeyhole, Plus, RefreshCw, Search, ShieldCheck, ThumbsDown, ThumbsUp, UserCheck, Users, XCircle,
} from "lucide-react";
import { ApiError, getAccounts, type AccountSummary, type BusinessLine } from "./api";
import {
  cancelAudit, changeCertificate, closeNonconformity, completeAudit, createCycle, createQualification, getAuditorCandidates, getAudits,
  getCycle, getCycles, getDecision, getEligibleAuditors, getNonconformities, getQualifications, getTimeline, planAudit,
  raiseNonconformity, recordDecision, respondNonconformity, voteOnChange,
  type AuditType, type CertificateAction, type ChangeRound, type ChangeVote, type CertificationAudit, type CertificationCycle, type CyclePhase, type DecisionBlocker,
  type DecisionPanel, type DecisionRound, type IsoCertificate, type NcGrade, type Nonconformity, type Person, type Qualification,
  type TimelineEvent, type Vote,
} from "./certificationApi";
import { Dialog } from "./Dialog";
import { day } from "./format";
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
    phases:{STAGE1_PENDING:"بانتظار المرحلة الأولى",STAGE2_PENDING:"بانتظار المرحلة الثانية",FINDINGS_OPEN:"ملاحظات جسيمة مفتوحة",READY_FOR_DECISION:"جاهزة لقرار الاعتماد",CERTIFIED:"معتمدة (صدرت الشهادة)"},
    readiness:"الجاهزية لقرار الاعتماد",readinessDesc:"ما يفصل هذه الدورة عن قرار الاعتماد، كما يحسبه الخادم.",
    blockers:{STAGE1_NOT_COMPLETED:"إتمام تدقيق المرحلة الأولى",STAGE2_NOT_COMPLETED:"إتمام تدقيق المرحلة الثانية (بعد الأولى)",OPEN_MAJOR_NONCONFORMITIES:"إغلاق كل عدم المطابقات الجسيمة بعد رد العميل",POLICY_D02:"ضبط سياسات الاعتماد لمعيار الدورة (D-02): مين ياخد القرار، وصلاحية الشهادة وإيقاع المراقبة"},
    programme:"برنامج التدقيق",stage:{STAGE1:"تدقيق المرحلة الأولى",STAGE2:"تدقيق المرحلة الثانية",SURVEILLANCE:"تدقيق مراقبة",RECERTIFICATION:"تدقيق إعادة الاعتماد"},
    notPlanned:"لم يُخطط بعد",plannedDate:"تاريخ التدقيق المخطط",auditor:"المدقق الرئيسي",chooseAuditor:"اختر مدققًا مؤهلًا",
    noEligible:"لا يوجد مدقق مؤهل لهذا المعيار في هذا التاريخ. سجّل كفاءة مدقق أو اختر تاريخًا آخر.",pickDate:"اختر التاريخ لعرض المدققين المؤهلين في ذلك اليوم.",
    plan:"تخطيط التدقيق",completedOn:"تاريخ الإتمام",complete:"تسجيل الإتمام",cancelAudit:"إلغاء التدقيق",
    stage2Hint:"يمكن تخطيط المرحلة الثانية الآن، لكن لا تُسجل كمكتملة قبل إتمام المرحلة الأولى.",
    status:{PLANNED:"مخطط",COMPLETED:"مكتمل",CANCELLED:"ملغى",OPEN:"مفتوحة",RESPONDED:"تم الرد",CLOSED:"مغلقة"},
    findings:"عدم المطابقات والملاحظات",noFindings:"لا توجد ملاحظات مسجلة",grade:"الدرجة",grades:{MAJOR:"جسيمة",MINOR:"بسيطة",OBSERVATION:"ملاحظة"},
    clause:"البند",statement:"بيان عدم المطابقة",raise:"تسجيل ملاحظة",response:"تصحيح العميل وإجراءه التصحيحي",respond:"تسجيل رد العميل",
    close:"إغلاق بعد التحقق",timeline:"سجل التدقيق",noTimeline:"لا توجد أحداث بعد",
    events:{CYCLE_OPENED:"فُتحت دورة الاعتماد",AUDIT_PLANNED:"خُطط تدقيق",AUDIT_COMPLETED:"اكتمل تدقيق",AUDIT_CANCELLED:"أُلغي تدقيق",NC_RAISED:"سُجلت ملاحظة",NC_RESPONDED:"رد العميل",NC_CLOSED:"أُغلقت ملاحظة",DECISION_VOTE:"اتسجل صوت في قرار الاعتماد",DECISION_GRANT:"اتاخد قرار بمنح الشهادة",DECISION_REFUSE:"اتاخد قرار برفض المنح",CERTIFICATE_ISSUED:"صدرت الشهادة",CERTIFICATE_SUSPENDED:"اتوقفت الشهادة",CERTIFICATE_RESTORED:"الشهادة اتفعلت تاني",CERTIFICATE_WITHDRAWN:"اتسحبت الشهادة",CERTIFICATE_CHANGE_VOTE:"اتسجل صوت في تصويت اللجنة على تغيير الشهادة",CERTIFICATE_CHANGE_REJECTED:"اللجنة رفضت تغيير الشهادة، ومفيش حاجة اتغيرت"},
    qualifications:"سجل كفاءة المدققين",noQualifications:"لا توجد كفاءات مسجلة",validFrom:"صالحة من",validUntil:"صالحة حتى",
    evidence:"مرجع الإثبات",addQualification:"تسجيل كفاءة",expired:"منتهية",candidatesDenied:"تسجيل الكفاءات متاح لمن يملك صلاحية ذلك فقط.",
    readonly:"عرض فقط: مدير البرنامج وحده يعدّل هذه الدورة.",
    errors:{NOT_QUALIFIED:"المدقق غير مؤهل لهذا المعيار في التاريخ المخطط.",STAGE_EXISTS:"هذه المرحلة مخطط لها بالفعل في الدورة.",STAGE1_REQUIRED:"أتمّ تدقيق المرحلة الأولى قبل الثانية.",AUDIT_STATE:"لا يمكن تعديل إلا تدقيق مخطط.",AUDIT_CANCELLED:"لا تُسجل ملاحظات على تدقيق ملغى.",RESPONSE_REQUIRED:"سجّل رد العميل قبل الإغلاق.",NC_CLOSED:"هذه الملاحظة مغلقة بالفعل.",BLOCKED_BY_POLICY:"متوقف حتى اعتماد السياسة D-02.",POLICY_NOT_SET:"سياسات الاعتماد لمعيار الدورة مش متظبطة؛ صاحب السياسات يظبطها من صفحة السياسات.",NO_DECISION_RIGHT:"معندكش صلاحية قرار الاعتماد.",AUDITED_CLIENT:"إنت كنت مدقق عند العميل ده، فمينفعش تاخد قرار اعتماده (الحيادية).",ALREADY_VOTED:"إنت صوّت خلاص في القرار ده.",ALREADY_CERTIFIED:"الدورة دي صدرت لها شهادة خلاص.",NOT_READY:"الدورة مش جاهزة للمنح: لازم التدقيق يخلص وكل عدم المطابقات الجسيمة تتقفل.",CERTIFICATE_STATE:"الإجراء ده مش مناسب لحالة الشهادة دلوقتي.",CERTIFICATE_EXPIRED:"الشهادة انتهت ومينفعش تتغير.",CERTIFICATE_REQUIRED:"تدقيق المراقبة وإعادة الاعتماد بيتخطط بعد ما الشهادة تصدر وتكون سارية.",NO_CERTIFICATE:"الدورة دي ملهاش شهادة.",CHANGE_PENDING:"فيه تصويت لجنة مفتوح على تغيير تاني للشهادة؛ لازم يخلص الأول قبل ما تطلب تغيير جديد.",NO_CHANGE_PENDING:"مفيش تصويت مفتوح على تغيير الشهادة دلوقتي؛ حدّثنا الصفحة.",conflict:"تم تعديل البيانات من مكان آخر؛ حدّثناها، أعد المحاولة.",invalid:"راجع الحقول المطلوبة وقيمها.",denied:"ليست لديك صلاحية لهذا الإجراء.",failed:"تعذّر تنفيذ الطلب."},
  },
  en: {
    title:"Client ISO certification",desc:"Certification cycles, audit programme, auditor competence and nonconformities, within your permissions.",
    cycles:"Certification cycles",competence:"Auditor competence",newCycle:"Open a certification cycle",search:"Search by reference or client name",
    allStandards:"All standards",allPhases:"All phases",mine:"My cycles only",apply:"Search",loadMore:"Load more",
    empty:"No matching certification cycles",loading:"Loading...",retry:"Retry",open:"Open",back:"Back to certification cycles",
    reference:"Reference",client:"Client",chooseClient:"Choose a client",standard:"Standard",chooseStandard:"Choose a standard",scope:"Certification scope",
    sites:"Sites",manager:"Programme manager",save:"Save",cancel:"Cancel",openMajors:"Open major nonconformities",
    phases:{STAGE1_PENDING:"Awaiting Stage 1",STAGE2_PENDING:"Awaiting Stage 2",FINDINGS_OPEN:"Major findings open",READY_FOR_DECISION:"Ready for decision",CERTIFIED:"Certified"},
    readiness:"Readiness for the certification decision",readinessDesc:"What stands between this cycle and a decision, as computed by the server.",
    blockers:{STAGE1_NOT_COMPLETED:"Complete the Stage 1 audit",STAGE2_NOT_COMPLETED:"Complete the Stage 2 audit (after Stage 1)",OPEN_MAJOR_NONCONFORMITIES:"Close every major nonconformity after the client's response",POLICY_D02:"Set the certification policies for this standard (D-02): who decides, certificate validity and surveillance rhythm"},
    programme:"Audit programme",stage:{STAGE1:"Stage 1 audit",STAGE2:"Stage 2 audit",SURVEILLANCE:"Surveillance audit",RECERTIFICATION:"Recertification audit"},
    notPlanned:"Not planned yet",plannedDate:"Planned date",auditor:"Lead auditor",chooseAuditor:"Choose a qualified auditor",
    noEligible:"No auditor is qualified for this standard on that date. Record a qualification or choose another date.",pickDate:"Pick the date to see the auditors qualified on that day.",
    plan:"Plan audit",completedOn:"Completed on",complete:"Record completion",cancelAudit:"Cancel audit",
    stage2Hint:"Stage 2 can be planned now but cannot be completed before Stage 1.",
    status:{PLANNED:"Planned",COMPLETED:"Completed",CANCELLED:"Cancelled",OPEN:"Open",RESPONDED:"Responded",CLOSED:"Closed"},
    findings:"Nonconformities and observations",noFindings:"No findings recorded",grade:"Grade",grades:{MAJOR:"Major",MINOR:"Minor",OBSERVATION:"Observation"},
    clause:"Clause",statement:"Nonconformity statement",raise:"Record finding",response:"Client correction and corrective action",respond:"Record client response",
    close:"Close after verification",timeline:"Audit history",noTimeline:"No events yet",
    events:{CYCLE_OPENED:"Cycle opened",AUDIT_PLANNED:"Audit planned",AUDIT_COMPLETED:"Audit completed",AUDIT_CANCELLED:"Audit cancelled",NC_RAISED:"Finding recorded",NC_RESPONDED:"Client responded",NC_CLOSED:"Finding closed",DECISION_VOTE:"Decision vote recorded",DECISION_GRANT:"Decision taken: certification granted",DECISION_REFUSE:"Decision taken: certification refused",CERTIFICATE_ISSUED:"Certificate issued",CERTIFICATE_SUSPENDED:"Certificate suspended",CERTIFICATE_RESTORED:"Certificate restored",CERTIFICATE_WITHDRAWN:"Certificate withdrawn",CERTIFICATE_CHANGE_VOTE:"Committee vote recorded on a certificate change",CERTIFICATE_CHANGE_REJECTED:"The committee rejected a certificate change; nothing changed"},
    qualifications:"Auditor competence register",noQualifications:"No qualifications recorded",validFrom:"Valid from",validUntil:"Valid until",
    evidence:"Evidence reference",addQualification:"Record qualification",expired:"Expired",candidatesDenied:"Only people allowed to record qualifications can add them.",
    readonly:"Read only: only the programme manager changes this cycle.",
    errors:{NOT_QUALIFIED:"The auditor is not qualified for this standard on the planned date.",STAGE_EXISTS:"This stage is already planned for the cycle.",STAGE1_REQUIRED:"Complete the Stage 1 audit before Stage 2.",AUDIT_STATE:"Only a planned audit can be changed.",AUDIT_CANCELLED:"A cancelled audit cannot record findings.",RESPONSE_REQUIRED:"Record the client's response before closing.",NC_CLOSED:"This finding is already closed.",BLOCKED_BY_POLICY:"Blocked until policy D-02 is signed.",POLICY_NOT_SET:"The certification policies for this standard are not set; a policy owner sets them under Policies.",NO_DECISION_RIGHT:"You do not have the certification decision right.",AUDITED_CLIENT:"You audited this client, so you cannot take its certification decisions (impartiality).",ALREADY_VOTED:"You already voted in this decision.",ALREADY_CERTIFIED:"This cycle already has its certificate.",NOT_READY:"Not ready to grant: the audits must be completed and every major nonconformity closed.",CERTIFICATE_STATE:"This action does not apply to the certificate's current status.",CERTIFICATE_EXPIRED:"The certificate has expired and can no longer change.",CERTIFICATE_REQUIRED:"Surveillance and recertification audits are planned once a certificate is issued and in force.",NO_CERTIFICATE:"This cycle has no certificate.",CHANGE_PENDING:"A committee vote on another change to this certificate is still open; it must finish before a new change is asked for.",NO_CHANGE_PENDING:"No committee vote on a certificate change is open now; the page is refreshed.",conflict:"The data changed elsewhere; it is refreshed, try again.",invalid:"Check the required fields and their values.",denied:"You do not have permission for this action.",failed:"The request failed."},
  },
} as const;
type Labels = typeof strings.ar | typeof strings.en;
const PHASES: CyclePhase[] = ["STAGE1_PENDING","STAGE2_PENDING","FINDINGS_OPEN","READY_FOR_DECISION","CERTIFIED"];
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
  const [decision,setDecision]=useState<DecisionPanel|null>(null);const [decisionError,setDecisionError]=useState("");
  const [error,setError]=useState("");const [loadError,setLoadError]=useState("");
  const reloadDecision=useCallback(()=>getDecision(cycleId).then(p=>{setDecision(p);setDecisionError("");})
    .catch(e=>setDecisionError(message(e,l))),[cycleId,l]);
  const reload=useCallback(async()=>{
    const [c,a,t]=await Promise.all([getCycle(cycleId),getAudits(cycleId),getTimeline(cycleId)]);
    setCycle(c);setAudits(a);setTimeline(t);
    // the decision panel loads on its own: the programme stays usable if it cannot be read
    void reloadDecision();
  },[cycleId,reloadDecision]);
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
  const d=decisionLabels[language];
  const certificate=decision?.certificate??null;
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
      <span className={"record-readonly-pill cert-hero-status"+(certificate?" is-"+certificate.status.toLowerCase():"")}>
        {certificate?<><Award size={14}/><span dir="ltr">{certificate.number}</span> · {d.certStatus[certificate.status]}</>
          :<><Gavel size={14}/>{decision?d.statusShort[decision.status]:d.title}</>}</span>
    </div></div>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {!editable&&<p className="record-security-note"><LockKeyhole size={15}/>{l.readonly}</p>}
    <div className="record-content-grid">
      <section className="record-content-card" aria-labelledby="readiness-title">
        <div className="record-section-header"><div className="record-section-icon"><ShieldCheck size={20}/></div><div><h2 id="readiness-title">{l.readiness}</h2><p>{l.readinessDesc}</p></div></div>
        <ol className="cert-readiness">{BLOCKERS.map(b=>{const blocked=cycle.decisionBlockers.includes(b);
          return <li key={b} className={blocked?"is-blocked":"is-done"}>{blocked?<XCircle size={17}/>:<CheckCircle2 size={17}/>}<span>{l.blockers[b]}</span></li>;})}</ol>
        <p className="cert-hint"><a className="text-action" href="#cert-decision-title">{d.goToDecision}</a></p>
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
    <DecisionSection cycle={cycle} panel={decision} error={decisionError} l={l} d={d} language={language}
      onChanged={async()=>{await reload().catch(e=>setLoadError(message(e,l)));}} onRetry={()=>void reloadDecision()}/>
    <section className="record-content-card cert-programme" aria-labelledby="programme-title">
      <div className="record-section-header"><div className="record-section-icon"><CalendarCheck size={20}/></div><div><h2 id="programme-title">{l.programme}</h2></div></div>
      <div className="cert-stages">{(["STAGE1","STAGE2"] as AuditType[]).map(type=><StageCard key={type} type={type} audit={active(type)}
        cycle={cycle} editable={editable} l={l} run={run} stage1Done={active("STAGE1")?.status==="COMPLETED"}/>)}</div>
    </section>
    <FollowUps cycle={cycle} audits={audits} certificate={certificate} editable={editable} l={l} d={d} language={language} run={run}/>
    <section className="record-content-card" aria-labelledby="timeline-title">
      <div className="record-section-header"><div className="record-section-icon"><History size={20}/></div><div><h2 id="timeline-title">{l.timeline}</h2></div></div>
      {timeline.length===0?<div className="empty-state">{l.noTimeline}</div>
      :<ol className="cert-timeline">{timeline.map((ev,i)=><li key={i}><span className="cert-timeline-dot"/>
        <div><strong>{l.events[ev.kind]}</strong> <span dir="ltr">{ev.label in l.stage?l.stage[ev.label as AuditType]:ev.label}</span>{ev.actorName?` · ${ev.actorName}`:""}
          <small dir="ltr">{ev.at?ev.at.replace("T"," ").slice(0,16):""}</small></div></li>)}</ol>}
    </section>
  </article>;
}

function StageCard({type,audit,cycle,editable,l,run,stage1Done,suggestedDate,hint}:{type:AuditType;audit:CertificationAudit|null;cycle:CertificationCycle;
  editable:boolean;l:Labels;run:(a:()=>Promise<unknown>)=>Promise<boolean>;stage1Done:boolean;suggestedDate?:string;hint?:string}){
  const [date,setDate]=useState(suggestedDate??"");const [eligible,setEligible]=useState<Person[]|null>(null);const [auditor,setAuditor]=useState("");
  const [doneOn,setDoneOn]=useState(today());const [busy,setBusy]=useState(false);
  useEffect(()=>{setAuditor("");setEligible(null);if(!date)return;let current=true;
    void getEligibleAuditors(cycle.id,date).then(r=>{if(current)setEligible(r);}).catch(()=>{if(current)setEligible([]);});
    return()=>{current=false;};},[date,cycle.id]);
  const act=async(action:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);await run(action);setBusy(false);};
  const headingId="stage-"+type+"-"+(audit?.id??"new");
  return <div className={"cert-stage"+(audit?" is-"+audit.status.toLowerCase():"")} aria-labelledby={headingId}>
    <div className="cert-stage-head"><h3 id={headingId}>{l.stage[type]}</h3>
      <span className="record-status-tag">{audit?l.status[audit.status]:l.notPlanned}</span></div>
    {audit?<dl className="record-properties">
      <div><dt>{l.plannedDate}</dt><dd dir="ltr">{audit.plannedDate}</dd></div>
      <div><dt>{l.auditor}</dt><dd><UserCheck size={14}/> {audit.auditorName}</dd></div>
      {audit.completedOn&&<div><dt>{l.completedOn}</dt><dd dir="ltr">{audit.completedOn}</dd></div>}
    </dl>:editable?<form className="opportunity-form cert-form" onSubmit={e=>{e.preventDefault();
        void act(async()=>{await planAudit(cycle.id,cycle.version,type,date,Number(auditor));setDate("");});}}>
      {type==="STAGE2"&&!stage1Done&&<p className="cert-hint">{l.stage2Hint}</p>}
      {hint&&<p className="cert-hint cert-due-hint"><CalendarClock size={14}/>{hint}</p>}
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

/* --- D-02: certification decision, certificate and follow-up audits ------------------------------------------------- */

const decisionLabels = {
  ar: {
    title:"قرار الاعتماد",goToDecision:"روح لقرار الاعتماد",loading:"جاري تحميل القرار...",retry:"إعادة المحاولة",
    statusShort:{BLOCKED_BY_POLICY:"القرار متوقف على السياسات",NOT_READY:"التدقيق لسه مخلصش",AWAITING_DECISION:"مستني قرار الاعتماد",GRANTED:"اتمنحت الشهادة",REFUSED:"آخر قرار: رفض المنح"},
    status:{
      BLOCKED_BY_POLICY:"القرار متوقف لحد ما سياسات الاعتماد لمعيار الدورة تتظبط. ده مقصود: محدش ياخد قرار من غير ما يكون معروف مين اللي من حقه يقرر وصلاحية الشهادة قد إيه.",
      NOT_READY:"لسه بدري على القرار: لازم تدقيق المرحلة الأولى والثانية يخلصوا الأول.",
      AWAITING_DECISION:"الدورة مستنية قرار الاعتماد.",
      REFUSED:"آخر قرار كان رفض المنح. ممكن ياخدوا قرار جديد بعد ما العميل يستكمل الإجراءات التصحيحية.",
      GRANTED:"اتمنحت الشهادة وصدرت برقمها.",
    },
    missingIntro:(code:string)=>`ناقص تتظبط السياسات دي لمعيار ${code}:`,
    missing:{"cert.decision":"مين ياخد القرار: مراجع مستقل واحد أو لجنة (cert.decision)","cert.cycle":"صلاحية الشهادة بالشهور وإيقاع تدقيق المراقبة (cert.cycle)"},
    ownerHint:"صاحب السياسات بس هو اللي يظبطها، من صفحة السياسات.",openPolicies:"فتح السياسات",
    modeTitle:"طريقة القرار",
    mode:{INDEPENDENT_REVIEWER:"مراجع مستقل واحد بياخد القرار ويكتب سببه.",COMMITTEE:(n:number)=>`لجنة من ${n} أعضاء مستقلين، كل عضو بيصوّت. القرار بالأغلبية، والتعادل بيعتبر رفض.`},
    rules:(v:number|null,s:number|null)=>v&&s?`الشهادة صالحة ${v} شهر من تاريخ إصدارها، وتدقيق المراقبة كل ${s} شهر.`:"",
    impartiality:"اللي ياخد القرار عمره ما يكون كان مدقق عند نفس العميل، في أي دورة.",
    whoDecides:"مين يقدر ياخد القرار",
    nobody:{
      NO_ROLE_HOLDERS:"محدش عنده صلاحية قرار الاعتماد لسه. مسؤول النظام يدي الدور ioeti-cert-decision-maker لشخص مستقل عن فريق التدقيق.",
      ALL_AUDITED_CLIENT:"كل اللي عندهم صلاحية القرار كانوا مدققين عند العميل ده، فمحدش منهم ينفع يقرر (الحيادية). محتاجين شخص مستقل.",
      NOT_ENOUGH_ELIGIBLE:"عدد المستقلين اللي يقدروا يصوتوا أقل من عدد أعضاء اللجنة المطلوب، فالقرار مش هيكتمل. زوّدوا أعضاء مستقلين أو صاحب السياسات يغيّر حجم اللجنة.",
    },
    votesSoFar:(n:number,m:number)=>`${n} من ${m} أصوات`,votedAt:"صوّت",
    hiddenVotes:"الأصوات وأسبابها بتظهر لما كل الأعضاء يصوتوا، عشان كل عضو يقرر باستقلال.",
    cannot:{NO_DECISION_RIGHT:"إنت معندكش صلاحية قرار الاعتماد، فالقرار هنا للعرض بس.",AUDITED_CLIENT:"إنت كنت مدقق عند العميل ده، فمينفعش تاخد قرار اعتماده (الحيادية).",ALREADY_VOTED:"إنت صوّت خلاص؛ مستنيين باقي أعضاء اللجنة."},
    yourDecision:"قرارك",yourVote:"صوتك",grant:"منح الشهادة",refuse:"رفض المنح",reason:"سبب القرار",reasonHint:"اكتب الأساس اللي بنيت عليه قرارك (نتيجة التدقيق، الإجراءات التصحيحية...).",
    submit:"سجّل قرار الاعتماد",submitVote:"سجّل صوتك في قرار الاعتماد",
    grantBlocked:"المنح مش متاح لحد ما كل عدم المطابقات الجسيمة تتقفل. الرفض متاح.",grantIssues:"المنح بيصدر الشهادة فورًا برقم جديد.",
    pastRounds:"قرارات سابقة",outcome:{GRANT:"منح",REFUSE:"رفض"},decidedOn:"اتاخد في",tally:(g:number,r:number)=>`${g} منح · ${r} رفض`,
    certificate:"الشهادة",number:"رقم الشهادة",issuedOn:"تاريخ الإصدار",expiresOn:"صالحة لحد",
    certStatus:{ACTIVE:"سارية",SUSPENDED:"موقوفة",WITHDRAWN:"مسحوبة",EXPIRED:"منتهية"},
    surveillance:"مواعيد تدقيق المراقبة",surveillanceEvery:(n:number)=>`كل ${n} شهر من تاريخ الإصدار`,due:(n:number)=>`المراقبة ${n}`,
    done:"اتعمل",overdue:"متأخر",upcoming:"جاي",recertBy:"تدقيق إعادة الاعتماد قبل",
    actions:{suspend:"إيقاف الشهادة",restore:"إعادة تفعيل الشهادة",withdraw:"سحب الشهادة"},
    actionHint:{suspend:"الشهادة هتظهر موقوفة في التحقق العام لحد ما تتفعل تاني.",restore:"الشهادة هترجع سارية.",withdraw:"السحب نهائي ومينفعش يترجع فيه. الشهادة هتظهر مسحوبة في التحقق العام."},
    actionReason:"السبب (بيتسجل في سجل الشهادة)",confirm:"تأكيد",cancel:"إلغاء",
    manageOnly:"الإيقاف وإعادة التفعيل والسحب لصاحب صلاحية القرار اللي ما دققش عند العميل ده بس.",
    actionsCommittee:{suspend:"اطلب إيقاف الشهادة (تصويت لجنة)",restore:"اطلب إعادة تفعيل الشهادة (تصويت لجنة)",withdraw:"اطلب سحب الشهادة (تصويت لجنة)"},
    committeeHint:(n:number)=>`في المعيار ده القرار بلجنة من ${n} أعضاء، فالإيقاف وإعادة التفعيل والسحب كمان بيحتاجوا تصويت اللجنة.`,
    committeeActionHint:(n:number)=>`الطلب ده هيفتح تصويت للجنة من ${n} أعضاء، وصوتك بالموافقة هيتسجل أول صوت. الشهادة مش هتتغير غير لما أغلبية اللجنة توافق؛ لو التصويت اتعادل أو الأغلبية رفضت، مفيش حاجة هتتغير.`,
    startVote:"ابدأ تصويت اللجنة",
    changeAction:{SUSPEND:"إيقاف الشهادة",RESTORE:"إعادة تفعيل الشهادة",WITHDRAW:"سحب الشهادة (نهائي)"},
    changeOpenTitle:(a:string)=>`تصويت لجنة مفتوح: ${a}`,requestedBy:"طلبه",requestReason:"سبب الطلب",
    changeExplain:"الشهادة لسه زي ما هي. التغيير هيتنفذ بس لما كل أعضاء اللجنة يصوتوا والأغلبية توافق؛ لو التصويت اتعادل أو الأغلبية رفضت، الطلب بيتقفل ومفيش حاجة بتتغير.",
    changeBlocked:"مينفعش حد يطلب تغيير تاني على الشهادة لحد ما التصويت ده يخلص.",
    changeYourVote:"صوتك على الطلب ده",approve:"موافق على التغيير",reject:"رافض التغيير",changeReason:"سبب صوتك",
    changeReasonHint:"اكتب ليه موافق أو رافض (الأسباب بتظهر لما التصويت يخلص).",submitChangeVote:"سجّل صوتك",
    changeVoteLabel:{APPROVE:"موافق",REJECT:"رافض"},
    changeCannot:{NO_DECISION_RIGHT:"معندكش صلاحية قرار الاعتماد، فالتصويت ده للعرض بس.",AUDITED_CLIENT:"إنت كنت مدقق عند العميل ده، فمينفعش تصوت على شهادته (الحيادية).",ALREADY_VOTED:"إنت صوّت خلاص على الطلب ده؛ مستنيين باقي أعضاء اللجنة.",POLICY_NOT_SET:"سياسة طريقة القرار لمعيار الدورة مش متظبطة دلوقتي، فمحدش يقدر يصوت لحد ما تتظبط."},
    pastChanges:"تصويتات سابقة على تغيير الشهادة",changeOutcome:{APPROVED:"اتوافق عليه واتنفذ",REJECTED:"اترفض، والشهادة متغيرتش"},
    changeTally:(a:number,r:number)=>`${a} موافق · ${r} رافض`,
    history:"سجل الشهادة",events:{ISSUED:"صدرت",SUSPENDED:"اتوقفت",RESTORED:"اتفعلت تاني",WITHDRAWN:"اتسحبت"},
    followUps:"تدقيقات المراقبة وإعادة الاعتماد",followUpsLocked:"بتتخطط بعد ما الشهادة تصدر وطول ما هي سارية أو موقوفة.",
    nextSurveillance:(date:string)=>`الموعد المقترح للمراقبة الجاية: ${date}`,recertHint:(date:string)=>`لازم يخلص قبل انتهاء الشهادة: ${date}`,
  },
  en: {
    title:"Certification decision",goToDecision:"Go to the certification decision",loading:"Loading the decision...",retry:"Retry",
    statusShort:{BLOCKED_BY_POLICY:"Decision blocked by policy",NOT_READY:"Audits not finished",AWAITING_DECISION:"Awaiting the decision",GRANTED:"Certification granted",REFUSED:"Last decision: refused"},
    status:{
      BLOCKED_BY_POLICY:"The decision waits until the certification policies for this standard are set. This is on purpose: nobody decides before it is known who may decide and how long a certificate is valid.",
      NOT_READY:"Too early to decide: the Stage 1 and Stage 2 audits must be completed first.",
      AWAITING_DECISION:"The cycle awaits its certification decision.",
      REFUSED:"The last decision refused certification. A new decision can be taken after the client completes corrective action.",
      GRANTED:"Certification was granted and the certificate issued with its number.",
    },
    missingIntro:(code:string)=>`These policies are not set for ${code}:`,
    missing:{"cert.decision":"Who decides: one independent reviewer or a committee (cert.decision)","cert.cycle":"Certificate validity in months and surveillance rhythm (cert.cycle)"},
    ownerHint:"Only a policy owner sets them, under Policies.",openPolicies:"Open Policies",
    modeTitle:"How the decision is taken",
    mode:{INDEPENDENT_REVIEWER:"One independent reviewer decides and records the reason.",COMMITTEE:(n:number)=>`A committee of ${n} independent members votes. Majority wins; a tie refuses.`},
    rules:(v:number|null,s:number|null)=>v&&s?`A certificate is valid ${v} months from issue, with surveillance every ${s} months.`:"",
    impartiality:"Whoever decides was never an auditor of the same client, in any cycle.",
    whoDecides:"Who may decide",
    nobody:{
      NO_ROLE_HOLDERS:"Nobody holds the certification decision right yet. An administrator gives the ioeti-cert-decision-maker role to someone independent of the audit team.",
      ALL_AUDITED_CLIENT:"Everyone with the decision right audited this client, so none of them may decide (impartiality). Someone independent is needed.",
      NOT_ENOUGH_ELIGIBLE:"Fewer independent people can vote than the committee needs, so the decision cannot complete. Add independent members, or a policy owner changes the committee size.",
    },
    votesSoFar:(n:number,m:number)=>`${n} of ${m} votes`,votedAt:"voted",
    hiddenVotes:"Votes and their reasons are shown once every member has voted, so each member decides independently.",
    cannot:{NO_DECISION_RIGHT:"You do not have the certification decision right; this is for reading only.",AUDITED_CLIENT:"You audited this client, so you cannot take its certification decisions (impartiality).",ALREADY_VOTED:"You have voted; waiting for the other committee members."},
    yourDecision:"Your decision",yourVote:"Your vote",grant:"Grant certification",refuse:"Refuse certification",reason:"Reason for the decision",reasonHint:"State what the decision rests on (audit results, corrective actions...).",
    submit:"Record the certification decision",submitVote:"Record your vote on the certification decision",
    grantBlocked:"Granting is unavailable until every major nonconformity is closed. Refusing is available.",grantIssues:"Granting issues the certificate at once, with a new number.",
    pastRounds:"Earlier decisions",outcome:{GRANT:"Granted",REFUSE:"Refused"},decidedOn:"Decided on",tally:(g:number,r:number)=>`${g} grant · ${r} refuse`,
    certificate:"Certificate",number:"Certificate number",issuedOn:"Issued on",expiresOn:"Valid until",
    certStatus:{ACTIVE:"Active",SUSPENDED:"Suspended",WITHDRAWN:"Withdrawn",EXPIRED:"Expired"},
    surveillance:"Surveillance schedule",surveillanceEvery:(n:number)=>`every ${n} months from issue`,due:(n:number)=>`Surveillance ${n}`,
    done:"Done",overdue:"Overdue",upcoming:"Upcoming",recertBy:"Recertification audit before",
    actions:{suspend:"Suspend certificate",restore:"Restore certificate",withdraw:"Withdraw certificate"},
    actionHint:{suspend:"The certificate shows as suspended in the public check until it is restored.",restore:"The certificate becomes active again.",withdraw:"Withdrawal is final and cannot be undone. The certificate shows as withdrawn in the public check."},
    actionReason:"Reason (kept in the certificate's history)",confirm:"Confirm",cancel:"Cancel",
    manageOnly:"Suspending, restoring and withdrawing are for holders of the decision right who never audited this client.",
    actionsCommittee:{suspend:"Propose suspension (committee vote)",restore:"Propose restoring (committee vote)",withdraw:"Propose withdrawal (committee vote)"},
    committeeHint:(n:number)=>`For this standard a committee of ${n} decides, so suspending, restoring and withdrawing also need the committee's vote.`,
    committeeActionHint:(n:number)=>`This opens a vote for a committee of ${n} members, with your approval as the first vote. The certificate changes only when most of the committee approves; a tie or a majority against means nothing changes.`,
    startVote:"Start the committee vote",
    changeAction:{SUSPEND:"Suspend the certificate",RESTORE:"Restore the certificate",WITHDRAW:"Withdraw the certificate (final)"},
    changeOpenTitle:(a:string)=>`Open committee vote: ${a}`,requestedBy:"Asked by",requestReason:"Reason for the request",
    changeExplain:"The certificate is unchanged for now. The change applies only once every committee member has voted and most approve; a tie or a majority against closes the request and nothing changes.",
    changeBlocked:"Nobody can ask for another change to this certificate until this vote finishes.",
    changeYourVote:"Your vote on this request",approve:"Approve the change",reject:"Reject the change",changeReason:"Reason for your vote",
    changeReasonHint:"Say why you approve or reject (reasons are shown once the vote is over).",submitChangeVote:"Record your vote",
    changeVoteLabel:{APPROVE:"Approve",REJECT:"Reject"},
    changeCannot:{NO_DECISION_RIGHT:"You do not have the certification decision right; this vote is for reading only.",AUDITED_CLIENT:"You audited this client, so you cannot vote on its certificate (impartiality).",ALREADY_VOTED:"You have voted on this request; waiting for the other committee members.",POLICY_NOT_SET:"The decision-mode policy for this standard is not set now, so nobody can vote until it is."},
    pastChanges:"Earlier committee votes on certificate changes",changeOutcome:{APPROVED:"Approved and applied",REJECTED:"Rejected; the certificate did not change"},
    changeTally:(a:number,r:number)=>`${a} approve · ${r} reject`,
    history:"Certificate history",events:{ISSUED:"Issued",SUSPENDED:"Suspended",RESTORED:"Restored",WITHDRAWN:"Withdrawn"},
    followUps:"Surveillance and recertification audits",followUpsLocked:"Planned once the certificate is issued, while it is active or suspended.",
    nextSurveillance:(date:string)=>`Suggested date for the next surveillance: ${date}`,recertHint:(date:string)=>`Must be done before the certificate expires: ${date}`,
  },
};
type DecisionLabels = typeof decisionLabels.ar | typeof decisionLabels.en;

function DecisionSection({cycle,panel,error,l,d,language,onChanged,onRetry}:{cycle:CertificationCycle;panel:DecisionPanel|null;error:string;
  l:Labels;d:DecisionLabels;language:Language;onChanged:()=>Promise<void>;onRetry:()=>void}){
  const [vote,setVote]=useState<Vote|"">("");const [reason,setReason]=useState("");const [busy,setBusy]=useState(false);const [formError,setFormError]=useState("");
  const head=<div className="record-section-header"><div className="record-section-icon"><Gavel size={20}/></div>
    <div><h2 id="cert-decision-title">{d.title}</h2>{panel&&<p>{d.status[panel.status]}</p>}</div></div>;
  if(error||!panel)return <section className="record-content-card cert-decision" aria-labelledby="cert-decision-title">{head}
    {error?<div className="error-banner" role="status"><CircleAlert size={17}/><span>{error}</span>
      <button type="button" className="btn btn-secondary" onClick={onRetry}><RefreshCw size={15}/>{d.retry}</button></div>
    :<div className="empty-state" role="status">{d.loading}</div>}</section>;
  const committee=panel.mode==="COMMITTEE";
  const ar=language==="ar";
  const submit=async()=>{
    if(busy||!vote||!reason.trim())return;
    setBusy(true);setFormError("");
    try{await recordDecision(cycle.id,panel.cycleVersion,vote,reason.trim());setVote("");setReason("");}
    catch(e){setFormError(message(e,l));}
    finally{await onChanged();setBusy(false);}
  };
  return <section className={"record-content-card cert-decision is-"+panel.status.toLowerCase()} aria-labelledby="cert-decision-title">
    {head}
    {panel.missingPolicies.length>0&&<div className="cert-policy-missing" role="note">
      <strong>{d.missingIntro(cycle.standardCode)}</strong>
      <ul>{panel.missingPolicies.map(k=><li key={k}><LockKeyhole size={14}/>{d.missing[k]}</li>)}</ul>
      <p>{d.ownerHint} <a className="text-action" href="#/policies">{d.openPolicies}</a></p>
    </div>}
    {panel.mode&&<div className="cert-decision-grid">
      <div className="cert-decision-block"><h3>{d.modeTitle}</h3>
        <p>{panel.mode==="COMMITTEE"?d.mode.COMMITTEE(panel.requiredVotes??0):d.mode.INDEPENDENT_REVIEWER}</p>
        {d.rules(panel.validityMonths,panel.surveillanceMonths)&&<p className="cert-hint">{d.rules(panel.validityMonths,panel.surveillanceMonths)}</p>}
        <p className="cert-hint"><ShieldCheck size={14}/> {d.impartiality}</p></div>
      {!panel.certificate&&<div className="cert-decision-block"><h3><Users size={16}/> {d.whoDecides}</h3>
        {panel.nobodyReason?<p className="cert-nobody" role="note"><CircleAlert size={15}/>{d.nobody[panel.nobodyReason]}</p>:null}
        {panel.eligibleDeciders.length>0&&<ul className="cert-people">{panel.eligibleDeciders.map(p=><li key={p.id}><UserCheck size={14}/>{p.name}</li>)}</ul>}
      </div>}
    </div>}
    {panel.openRound&&<RoundCard round={panel.openRound} d={d} ar={ar} open/>}
    {!panel.certificate&&panel.status!=="BLOCKED_BY_POLICY"&&panel.status!=="NOT_READY"&&(panel.canVote
      ?<form className="cert-vote-form" aria-label={committee?d.yourVote:d.yourDecision} onSubmit={e=>{e.preventDefault();void submit();}}>
        <fieldset><legend>{committee?d.yourVote:d.yourDecision}</legend>
          <div className="cert-vote-choices" role="radiogroup" aria-label={committee?d.yourVote:d.yourDecision}>
            <label className={"cert-vote-choice is-grant"+(vote==="GRANT"?" is-selected":"")+(panel.canGrant?"":" is-disabled")}>
              <input type="radio" name="cert-vote" value="GRANT" checked={vote==="GRANT"} disabled={!panel.canGrant} onChange={()=>setVote("GRANT")}/>
              <Award size={16}/>{d.grant}</label>
            <label className={"cert-vote-choice is-refuse"+(vote==="REFUSE"?" is-selected":"")}>
              <input type="radio" name="cert-vote" value="REFUSE" checked={vote==="REFUSE"} onChange={()=>setVote("REFUSE")}/>
              <Ban size={16}/>{d.refuse}</label>
          </div>
          <p className="cert-hint">{panel.canGrant?d.grantIssues:d.grantBlocked}</p>
          <label className="cert-wide"><span>{d.reason}</span><textarea required rows={3} maxLength={4000} value={reason}
            placeholder={d.reasonHint} onChange={e=>setReason(e.target.value)}/></label>
        </fieldset>
        {formError&&<div className="login-error" role="alert"><CircleAlert size={17}/>{formError}</div>}
        <div className="lead-actions"><button type="submit" className="btn btn-primary" disabled={busy||!vote||!reason.trim()}>
          <Gavel size={16}/>{committee?d.submitVote:d.submit}</button></div>
      </form>
      :panel.cannotDecideReason&&<p className="record-security-note"><LockKeyhole size={15}/>{d.cannot[panel.cannotDecideReason]}</p>)}
    {panel.certificate&&<CertificateCard cycle={cycle} certificate={panel.certificate} canManage={panel.canManageCertificate} l={l} d={d} ar={ar}
      committeeSize={panel.mode==="COMMITTEE"?panel.requiredVotes:null} openChange={panel.openChange??null} pastChanges={panel.pastChanges??[]} onChanged={onChanged}/>}
    {panel.pastRounds.length>0&&<div className="cert-past-rounds"><h3>{d.pastRounds}</h3>
      {panel.pastRounds.map(r=><RoundCard key={r.id} round={r} d={d} ar={ar}/>)}</div>}
  </section>;
}

function RoundCard({round,d,ar,open}:{round:DecisionRound;d:DecisionLabels;ar:boolean;open?:boolean}){
  return <div className={"cert-round"+(round.outcome?" is-"+round.outcome.toLowerCase():"")}>
    <div className="cert-round-head">
      {open?<strong>{d.votesSoFar(round.votesCast,round.requiredVotes)}</strong>
        :<strong>{round.outcome?d.outcome[round.outcome]:""}</strong>}
      {round.decidedAt&&<span className="cert-hint">{d.decidedOn} {day(round.decidedAt,ar)}</span>}
      {!open&&round.grantVotes!=null&&round.refuseVotes!=null&&round.requiredVotes>1&&<span className="cert-hint">{d.tally(round.grantVotes,round.refuseVotes)}</span>}
    </div>
    {open&&round.requiredVotes>1&&<div className="cert-meter" aria-hidden="true"><span style={{width:`${Math.min(100,round.votesCast*100/round.requiredVotes)}%`}}/></div>}
    <ul className="cert-votes">{round.votes.map(v=><li key={v.voterId}>
      <UserCheck size={14}/><strong>{v.voterName}</strong>
      {v.vote?<span className={"cert-vote-tag is-"+v.vote.toLowerCase()}>{d.outcome[v.vote]}</span>:<span className="cert-hint">{d.votedAt}</span>}
      {v.reason&&<p>{v.reason}</p>}
    </li>)}</ul>
    {open&&round.requiredVotes>1&&<p className="cert-hint">{d.hiddenVotes}</p>}
  </div>;
}

function CertificateCard({cycle,certificate,canManage,l,d,ar,committeeSize,openChange,pastChanges,onChanged}:{cycle:CertificationCycle;
  certificate:IsoCertificate;canManage:boolean;l:Labels;d:DecisionLabels;ar:boolean;committeeSize:number|null;openChange:ChangeRound|null;
  pastChanges:ChangeRound[];onChanged:()=>Promise<void>}){
  const [action,setAction]=useState<CertificateAction|null>(null);const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const available:CertificateAction[]=certificate.status==="ACTIVE"?["suspend","withdraw"]:certificate.status==="SUSPENDED"?["restore","withdraw"]:[];
  const close=()=>{if(!busy){setAction(null);setReason("");setError("");}};
  const confirm=async()=>{
    if(!action||busy||!reason.trim())return;
    setBusy(true);setError("");
    try{await changeCertificate(cycle.id,action,certificate.version,reason.trim());setAction(null);setReason("");await onChanged();}
    catch(e){setError(message(e,l));await onChanged();}
    finally{setBusy(false);}
  };
  const icon={suspend:<CirclePause size={16}/>,restore:<CirclePlay size={16}/>,withdraw:<Ban size={16}/>};
  return <div className={"cert-card is-"+certificate.status.toLowerCase()} aria-labelledby="cert-card-title">
    <div className="cert-card-head"><Award size={26}/>
      <div><h3 id="cert-card-title">{d.certificate}</h3><span className="cert-card-number" dir="ltr">{certificate.number}</span></div>
      <span className={"cert-status-badge is-"+certificate.status.toLowerCase()}>{d.certStatus[certificate.status]}</span></div>
    <dl className="record-properties">
      <div><dt>{d.number}</dt><dd dir="ltr">{certificate.number}</dd></div>
      <div><dt>{l.standard}</dt><dd dir="ltr">{certificate.standardCode}</dd></div>
      <div><dt>{d.issuedOn}</dt><dd>{day(certificate.issuedOn,ar)}</dd></div>
      <div><dt>{d.expiresOn}</dt><dd>{day(certificate.expiresOn,ar)}</dd></div>
    </dl>
    <div className="cert-schedule"><h4><CalendarClock size={15}/> {d.surveillance} <small>({d.surveillanceEvery(certificate.surveillanceMonths)})</small></h4>
      <ol>{certificate.surveillance.map(s=><li key={s.index} className={s.done?"is-done":s.overdue?"is-overdue":""}>
        <span>{d.due(s.index)}</span><span>{day(s.dueOn,ar)}</span>
        <span className="cert-hint">{s.done?d.done:s.overdue?d.overdue:d.upcoming}</span></li>)}
        <li><span>{d.recertBy}</span><span>{day(certificate.recertificationDueBy,ar)}</span><span/></li></ol></div>
    {openChange&&<ChangeRoundCard cycle={cycle} certificate={certificate} round={openChange} l={l} d={d} ar={ar} onChanged={onChanged}/>}
    {openChange&&available.length>0&&<p className="cert-hint"><LockKeyhole size={14}/> {d.changeBlocked}</p>}
    {!openChange&&available.length>0&&(canManage
      ?<>{committeeSize!=null&&<p className="cert-hint"><Users size={14}/> {d.committeeHint(committeeSize)}</p>}
        <div className="lead-actions cert-card-actions">{available.map(a=><button key={a} type="button"
          className={"btn btn-secondary"+(a==="withdraw"?" cert-withdraw":"")} onClick={()=>setAction(a)}>{icon[a]}
          {committeeSize!=null?d.actionsCommittee[a]:d.actions[a]}</button>)}</div></>
      :<p className="record-security-note"><LockKeyhole size={15}/>{d.manageOnly}</p>)}
    {certificate.events.length>0&&<div className="cert-card-history"><h4>{d.history}</h4>
      <ol className="cert-timeline">{certificate.events.map((e,i)=><li key={i}><span className="cert-timeline-dot"/>
        <div><strong>{d.events[e.action]}</strong>{e.actorName?` · ${e.actorName}`:""}{e.reason&&<p>{e.reason}</p>}
          <small dir="ltr">{e.at?e.at.replace("T"," ").slice(0,16):""}</small></div></li>)}</ol></div>}
    {pastChanges.length>0&&<div className="cert-past-rounds"><h4>{d.pastChanges}</h4>
      {pastChanges.map(r=><ChangeRoundCard key={r.id} cycle={cycle} certificate={certificate} round={r} l={l} d={d} ar={ar} onChanged={onChanged}/>)}</div>}
    {action&&<Dialog title={committeeSize!=null?d.actionsCommittee[action]:d.actions[action]} description={d.actionHint[action]} kicker={certificate.number}
      busy={busy} onClose={close}
      footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>{d.cancel}</button>
        <button type="button" className="btn btn-primary" disabled={busy||!reason.trim()} onClick={()=>void confirm()}>{icon[action]}
          {committeeSize!=null?d.startVote:d.confirm}</button></>}>
      {committeeSize!=null&&<p className="cert-hint cert-committee-note"><Users size={14}/> {d.committeeActionHint(committeeSize)}</p>}
      {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
      <label className="cert-dialog-field"><span>{d.actionReason}</span>
        <textarea rows={3} maxLength={4000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    </Dialog>}
  </div>;
}

/** A committee vote on a certificate change: open (votes hidden, Approve / Reject for members who may vote) or decided. */
function ChangeRoundCard({cycle,certificate,round,l,d,ar,onChanged}:{cycle:CertificationCycle;certificate:IsoCertificate;round:ChangeRound;
  l:Labels;d:DecisionLabels;ar:boolean;onChanged:()=>Promise<void>}){
  const [vote,setVote]=useState<ChangeVote|"">("");const [reason,setReason]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const open=round.status==="OPEN";
  const submit=async()=>{
    if(busy||!vote||!reason.trim())return;
    setBusy(true);setError("");
    try{await voteOnChange(cycle.id,certificate.version,vote,reason.trim());setVote("");setReason("");}
    catch(e){setError(message(e,l));}
    finally{await onChanged();setBusy(false);}
  };
  const tone=round.outcome==="APPROVED"?" is-grant":round.outcome==="REJECTED"?" is-refuse":"";
  return <div className={"cert-round cert-change-round"+tone} aria-label={d.changeAction[round.action]}>
    <div className="cert-round-head">
      <strong>{open?d.changeOpenTitle(d.changeAction[round.action]):d.changeAction[round.action]}</strong>
      {open?<span className="cert-hint">{d.votesSoFar(round.votesCast,round.requiredVotes)}</span>
        :round.outcome&&<span className={"cert-vote-tag"+tone}>{d.changeOutcome[round.outcome]}</span>}
      {round.decidedAt&&<span className="cert-hint">{d.decidedOn} {day(round.decidedAt,ar)}</span>}
      {!open&&round.approveVotes!=null&&round.rejectVotes!=null&&<span className="cert-hint">{d.changeTally(round.approveVotes,round.rejectVotes)}</span>}
    </div>
    {open&&<div className="cert-meter" aria-hidden="true"><span style={{width:`${Math.min(100,round.votesCast*100/Math.max(1,round.requiredVotes))}%`}}/></div>}
    <dl className="cert-change-request">
      <div><dt>{d.requestedBy}</dt><dd>{round.requestedByName??"—"}</dd></div>
      {round.reason&&<div><dt>{d.requestReason}</dt><dd>{round.reason}</dd></div>}
    </dl>
    {open&&<p className="cert-hint">{d.changeExplain}</p>}
    <ul className="cert-votes">{round.votes.map(v=><li key={v.voterId}>
      <UserCheck size={14}/><strong>{v.voterName}</strong>
      {v.vote?<span className={"cert-vote-tag "+(v.vote==="APPROVE"?"is-grant":"is-refuse")}>{d.changeVoteLabel[v.vote]}</span>:<span className="cert-hint">{d.votedAt}</span>}
      {v.reason&&<p>{v.reason}</p>}
    </li>)}</ul>
    {open&&<p className="cert-hint">{d.hiddenVotes}</p>}
    {open&&(round.canVote
      ?<form className="cert-vote-form" aria-label={d.changeYourVote} onSubmit={e=>{e.preventDefault();void submit();}}>
        <fieldset><legend>{d.changeYourVote}</legend>
          <div className="cert-vote-choices" role="radiogroup" aria-label={d.changeYourVote}>
            <label className={"cert-vote-choice is-grant"+(vote==="APPROVE"?" is-selected":"")}>
              <input type="radio" name={"cert-change-vote-"+round.id} value="APPROVE" checked={vote==="APPROVE"} onChange={()=>setVote("APPROVE")}/>
              <ThumbsUp size={16}/>{d.approve}</label>
            <label className={"cert-vote-choice is-refuse"+(vote==="REJECT"?" is-selected":"")}>
              <input type="radio" name={"cert-change-vote-"+round.id} value="REJECT" checked={vote==="REJECT"} onChange={()=>setVote("REJECT")}/>
              <ThumbsDown size={16}/>{d.reject}</label>
          </div>
          <label className="cert-wide"><span>{d.changeReason}</span><textarea required rows={3} maxLength={4000} value={reason}
            placeholder={d.changeReasonHint} onChange={e=>setReason(e.target.value)}/></label>
        </fieldset>
        {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
        <div className="lead-actions"><button type="submit" className="btn btn-primary" disabled={busy||!vote||!reason.trim()}>
          <Gavel size={16}/>{d.submitChangeVote}</button></div>
      </form>
      :round.cannotVoteReason&&<p className="record-security-note"><LockKeyhole size={15}/>{d.changeCannot[round.cannotVoteReason]}</p>)}
  </div>;
}

function FollowUps({cycle,audits,certificate,editable,l,d,language,run}:{cycle:CertificationCycle;audits:CertificationAudit[];certificate:IsoCertificate|null;
  editable:boolean;l:Labels;d:DecisionLabels;language:Language;run:(a:()=>Promise<unknown>)=>Promise<boolean>}){
  const followUps=audits.filter(a=>(a.type==="SURVEILLANCE"||a.type==="RECERTIFICATION")&&a.status!=="CANCELLED");
  const inForce=certificate&&(certificate.status==="ACTIVE"||certificate.status==="SUSPENDED");
  if(!certificate&&followUps.length===0)return null;
  const ar=language==="ar";
  const nextDue=certificate?.surveillance.find(s=>!s.done)??null;
  const surveillancePlanned=followUps.some(a=>a.type==="SURVEILLANCE"&&a.status==="PLANNED");
  const recert=followUps.find(a=>a.type==="RECERTIFICATION")??null;
  return <section className="record-content-card cert-programme" aria-labelledby="followups-title">
    <div className="record-section-header"><div className="record-section-icon"><CalendarClock size={20}/></div>
      <div><h2 id="followups-title">{d.followUps}</h2>{!inForce&&<p>{d.followUpsLocked}</p>}</div></div>
    <div className="cert-stages">
      {followUps.map(a=><StageCard key={a.id} type={a.type} audit={a} cycle={cycle} editable={editable} l={l} run={run} stage1Done/>)}
      {inForce&&editable&&!surveillancePlanned&&<StageCard key={"plan-s-"+(nextDue?.dueOn??"")} type="SURVEILLANCE" audit={null} cycle={cycle}
        editable={editable} l={l} run={run} stage1Done suggestedDate={nextDue?.dueOn}
        hint={nextDue?d.nextSurveillance(day(nextDue.dueOn,ar)):undefined}/>}
      {inForce&&editable&&!recert&&certificate&&<StageCard key="plan-r" type="RECERTIFICATION" audit={null} cycle={cycle} editable={editable} l={l}
        run={run} stage1Done hint={d.recertHint(day(certificate.recertificationDueBy,ar))}/>}
    </div>
  </section>;
}
