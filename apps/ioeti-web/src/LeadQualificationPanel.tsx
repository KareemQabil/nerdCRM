import { useEffect, useState } from "react";
import { ResponseDetails, responseNote } from "./LeadResponse";
import { CircleAlert, Clock3, RotateCcw, Shuffle, UserCheck, XCircle } from "lucide-react";
import {
  ApiError, assignLeadToMe, getLeadStages, getLostReasons, loseLead, moveLeadStage, reopenLead,
  type LeadStage, type LeadSummary, type LostReason,
} from "./api";
import { governorateName } from "./governorates";
import { routeLead } from "./marketingApi";
import type { Language } from "./preferences";

const MAX_NOTE = 500;
const strings = {
  ar: {
    stage:"مرحلة التأهيل",move:"نقل للمرحلة",moving:"جار النقل...",received:"تاريخ الاستلام",
    owner:"المسؤول",mine:"مكلّف بك",notMine:"غير مكلّف بك",assign:"تكليف لي",
    lose:"تسجيل كخسارة",reason:"سبب الخسارة",noReason:"بدون سبب محدد",note:"ملاحظة داخلية (اختياري)",
    confirmLose:"تأكيد الخسارة",cancel:"إلغاء",lost:"خسارة",lostBecause:"سبب الخسارة",
    reopen:"إعادة فتح العميل المحتمل",unassigned:"مش متكلّف بيه حد",route:"توزيع بالقواعد",routing:"جار التوزيع...",
    routed:(who:string,team:string)=>`اتوزع على ${who} (${team}).`,routedAway:(team:string)=>`اتوزع على فريق ${team}.`,
    noRule:"مفيش قاعدة توزيع مطابقة؛ الـ lead فاضل من غير مسؤول ومدير الخط اتبلّغ.",noOne:"مفيش حد متاح في الفريق (إجازة أو وصلوا للحد)؛ فاضل من غير مسؤول ومدير الخط اتبلّغ.",
    noRules:"خط الأعمال ده مالوش قواعد توزيع لسه؛ مالك السياسات يحددها.",needLine:"حدد خط أعمال الـ lead الأول.",already:"الـ lead ده بقى ليه مسؤول؛ مفيش إعادة توزيع.",
    governorate:"المحافظة",
    loading:"جار التحميل...",changed:"تم تعديل السجل من مكان آخر؛ حدّث الصفحة وأعد المحاولة.",
    lostLocked:"أعد فتح العميل المحتمل أولًا لتغيير مرحلته.",rejected:"لا يمكن تنفيذ هذا الإجراء على العميل المحتمل في حالته الحالية.",
    noteTooLong:"الملاحظة بحد أقصى 500 حرف.",setup:"إعداد CRM غير مكتمل؛ اطلب من المسؤول استكماله.",
    denied:"ليست لديك صلاحية لهذا الإجراء.",failed:"تعذّر تنفيذ الطلب.",converted:"تم تحويل هذا العميل المحتمل بالفعل.",
  },
  en: {
    stage:"Qualification stage",move:"Move to stage",moving:"Moving...",received:"Received",
    owner:"Owner",mine:"Assigned to you",notMine:"Not assigned to you",assign:"Assign to me",
    lose:"Mark as lost",reason:"Lost reason",noReason:"No specific reason",note:"Internal note (optional)",
    confirmLose:"Confirm lost",cancel:"Cancel",lost:"Lost",lostBecause:"Lost reason",
    reopen:"Reopen lead",unassigned:"Nobody is assigned",route:"Route by the rules",routing:"Routing...",
    routed:(who:string,team:string)=>`Routed to ${who} (${team}).`,routedAway:(team:string)=>`Routed to the ${team} team.`,
    noRule:"No routing rule matches; the lead stays unassigned and the line's manager was told.",noOne:"Nobody in the team is available (on leave or at their cap); it stays unassigned and the line's manager was told.",
    noRules:"This business line has no routing rules yet; a policy owner sets them.",needLine:"Set the lead's business line first.",already:"This lead already has an owner; nothing is reassigned.",
    governorate:"Governorate",
    loading:"Loading...",changed:"This lead changed elsewhere; refresh and try again.",
    lostLocked:"Reopen this lead before changing its stage.",rejected:"This action is not possible for the lead in its current state.",
    noteTooLong:"The note can have at most 500 characters.",setup:"CRM setup is incomplete; ask an administrator to complete it.",
    denied:"You do not have permission for this action.",failed:"The request failed.",converted:"This lead has already been converted.",
  },
} as const;
type Labels = typeof strings.ar | typeof strings.en;

function message(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.failed;
  if (error.code === "ALREADY_CONVERTED") return l.converted;
  if (error.code === "ALREADY_ASSIGNED") return l.already;
  if (error.code === "POLICY_NOT_SET") return l.noRules;
  if (error.code === "BUSINESS_LINE_REQUIRED") return l.needLine;
  if (error.statusCode === 409) return l.changed;
  if (error.code === "LEAD_LOST") return l.lostLocked;
  if (error.code === "SETUP_REQUIRED") return l.setup;
  if (error.fields[0]?.field === "note") return l.noteTooLong;
  if (error.statusCode === 403 || error.statusCode === 404) return l.denied;
  if (error.statusCode === 422) return l.rejected;
  return l.failed;
}

/** Stage, lose/reopen and assign-to-me on a live, unconverted lead (native AOS rules). */
export function LeadQualificationPanel({lead,language,onChanged}:{
  lead:LeadSummary; language:Language; onChanged:(updated:LeadSummary)=>void;
}){
  const l=strings[language];
  const [stages,setStages]=useState<LeadStage[]|null>(null);
  const [reasons,setReasons]=useState<LostReason[]>([]);
  const [target,setTarget]=useState("");
  const [losing,setLosing]=useState(false);
  const [reasonId,setReasonId]=useState("");
  const [note,setNote]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  async function route(){
    if(busy)return;
    setBusy(true);setError("");setNotice("");
    try{
      const r=await routeLead(lead.id);
      setNotice(r.outcome==="ASSIGNED"?(r.lead?l.routed(r.assigneeName??"",r.teamName??""):l.routedAway(r.teamName??"")):r.outcome==="NO_RULE"?l.noRule:l.noOne);
      if(r.lead)onChanged(r.lead);
    }catch(e){setError(message(e,l));}
    finally{setBusy(false);}
  }
  useEffect(()=>{
    let current=true;
    Promise.all([getLeadStages(),getLostReasons()])
      .then(([s,r])=>{if(current){setStages(s);setReasons(r);}})
      .catch(e=>{if(current){setStages([]);setError(message(e,l));}});
    return()=>{current=false;};
  },[l]);
  useEffect(()=>{setTarget("");setLosing(false);setError("");},[lead.id]);
  const stage=stages?.find(s=>s.id===lead.stageId);
  const isLost=(lead.stageKind??stage?.kind)==="LOST";
  const openStages=(stages||[]).filter(s=>s.kind==="OPEN"&&s.id!==lead.stageId);
  async function run(action:()=>Promise<LeadSummary>){
    if(busy||lead.version==null)return;
    setBusy(true);setError("");
    try{onChanged(await action());setTarget("");setLosing(false);setReasonId("");setNote("");}
    catch(e){setError(message(e,l));}
    finally{setBusy(false);}
  }
  const version=lead.version??0;
  const received=lead.receivedAt?new Date(lead.receivedAt).toLocaleString(language==="ar"?"ar-EG":"en-GB",{dateStyle:"medium",timeStyle:"short"}):"—";
  if(stages===null)return <div className="empty-state" role="status">{l.loading}</div>;
  return <div className="lead-qualification">
    <dl className="record-properties">
      <div><dt>{l.stage}</dt><dd>{isLost?<span className="lead-lost-tag"><XCircle size={14}/>{l.lost}</span>:lead.stage||"—"}</dd></div>
      <div><dt>{l.received}</dt><dd><Clock3 size={14}/> {received}</dd></div>
      <div><dt>{l.owner}</dt><dd>{lead.assignedToMe?l.mine:lead.assignedToMe===null?l.unassigned:l.notMine}</dd></div>
      {lead.governorate&&<div><dt>{l.governorate}</dt><dd>{governorateName(lead.governorate,language==="ar")}</dd></div>}
      <ResponseDetails response={lead.response} ar={language==="ar"}/>
      {isLost&&lead.lostReason&&<div><dt>{l.lostBecause}</dt><dd>{lead.lostReason}</dd></div>}
    </dl>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {notice&&<p className="daily-note" role="status"><Shuffle size={15}/>{notice}</p>}
    {isLost?<div className="lead-actions">
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void run(()=>reopenLead(lead.id,version))}><RotateCcw size={16}/>{l.reopen}</button>
    </div>
    :<>
      <form className="opportunity-form lead-stage-form" onSubmit={e=>{e.preventDefault();if(target)void run(()=>moveLeadStage(lead.id,version,Number(target)));}}>
        <label><span>{l.move}</span><select value={target} onChange={e=>setTarget(e.target.value)}>
          <option value="">—</option>
          {openStages.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
        <button type="submit" className="btn btn-primary" disabled={busy||!target}>{busy?l.moving:l.move}</button>
      </form>
      <div className="lead-actions">
        {!lead.assignedToMe&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void run(()=>assignLeadToMe(lead.id,version))}><UserCheck size={16}/>{l.assign}</button>}
        {lead.assignedToMe===null&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void route()}><Shuffle size={16}/>{busy?l.routing:l.route}</button>}
        {!losing&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>setLosing(true)}><XCircle size={16}/>{l.lose}</button>}
      </div>
      {losing&&<form className="opportunity-form lead-lose-form" onSubmit={e=>{e.preventDefault();void run(()=>loseLead(lead.id,version,reasonId?Number(reasonId):null,note.trim()));}}>
        <label><span>{l.reason}</span><select value={reasonId} onChange={e=>setReasonId(e.target.value)}>
          <option value="">{l.noReason}</option>
          {reasons.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
        </select></label>
        <label><span>{l.note}</span><textarea maxLength={MAX_NOTE} rows={3} value={note} onChange={e=>setNote(e.target.value)}/></label>
        <div className="lead-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>{l.confirmLose}</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>setLosing(false)}>{l.cancel}</button>
        </div>
      </form>}
    </>}
    <p className="record-security-note"><Clock3 size={15}/>{responseNote(language==="ar")}</p>
  </div>;
}
