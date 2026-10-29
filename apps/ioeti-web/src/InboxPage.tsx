import { useCallback, useEffect, useState } from "react";
import { AtSign, CheckCheck, CircleAlert, LockKeyhole, Send, Undo2 } from "lucide-react";
import { ApiError } from "./api";
import {
  cancelMessage, draftMessage, findPeople, getInbox, getOutbox, markAllRead, markRead, mention, noticeRoute,
  type Notice, type OutboundMessage, type Person,
} from "./automationApi";
import type { Subject } from "./contentApi";
import type { Language } from "./preferences";
import "./insights.css";

const strings = {
  ar: {
    inbox:"الإشعارات",sub:"إشعارات داخلية فقط من سير العمل ومن زملائك. لا يُرسل النظام أي بريد أو رسالة خارجية.",
    unreadOnly:"غير المقروءة فقط",readAll:"تعليم الكل كمقروء",none:"لا توجد إشعارات",open:"فتح",markRead:"تعليم كمقروء",from:"من",
    kinds:{MENTION:"إشارة",REVIEW_CHANGES_REQUESTED:"مطلوب تعديل",REVIEW_APPROVAL_NEEDED:"عرض سعر مستني موافقتك",REVIEW_APPROVED:"اتعتمد عرض السعر",REVIEW_REJECTED:"اترفض عرض السعر",HANDOVER_REWORK:"تسليم يحتاج استكمال",HANDOVER_ACCEPTED:"قُبل التسليم",HANDOVER_REJECTED:"رُفض التسليم",ENGAGEMENT_ASSIGNED:"اتكلفت بمشروع",LEAD_FIRST_CONTACT_OVERDUE:"lead فات ميعاد أول تواصل معاه",LEAD_QUALIFICATION_OVERDUE:"lead فات ميعاد تأهيله",LEAD_ROUTED:"اتوزع عليك lead جديد",LEAD_UNROUTED:"lead مقدرش يتوزع على حد",VISIT_ASSIGNED:"اتكلفت بزيارة",VISIT_UNASSIGNED:"الزيارة اتنقلت لزميل",VISIT_RESCHEDULED:"موعد الزيارة اتغير",VISIT_CANCELLED:"الزيارة اتلغت",QUALITY_ACTION_ASSIGNED:"اتكلفت بإجراء تصحيحي",QUALITY_PLAN_ASSIGNED:"بقيت مسؤول خطة مشكلة جودة",TRAINING_REFUND_REQUESTED:"طلب استرداد تدريب مستني المالية",TRAINING_REFUND_CREDITED:"اتصرف استرداد التدريب (إشعار دائن)",TRAINING_REFUND_REJECTED:"اترفض طلب استرداد التدريب",CERT_DECISION_NEEDED:"دورة اعتماد مستنية قرار",CERT_VOTE_NEEDED:"صوتك مطلوب في قرار اعتماد",CERT_GRANTED:"اتمنحت الشهادة",CERT_REFUSED:"اترفض منح الشهادة",CERT_SUSPENDED:"الشهادة اتوقفت",CERT_RESTORED:"الشهادة رجعت سارية",CERT_WITHDRAWN:"الشهادة اتسحبت",CERT_CHANGE_VOTE_NEEDED:"صوتك مطلوب في تغيير شهادة اعتماد",CERT_CHANGE_REJECTED:"اللجنة رفضت تغيير الشهادة",RECRUITMENT_FEE_REQUESTED:"أتعاب تعيين مستنية فاتورة",RECRUITMENT_REFUND_REQUESTED:"استرداد أتعاب تعيين مستني المالية",RECRUITMENT_REPLACEMENT_OPENED:"اتفتح بديل مجاني لتعيين"},
    mentionTitle:"إشارة لزميل",person:"الزميل",search:"اكتب حرفين على الأقل",message:"الرسالة",send:"إرسال داخلي",sent:"تم إرسال الإشارة.",
    mentionNote:"الزميل يرى الرابط فقط؛ فتح السجل يخضع لصلاحياته.",
    outbox:"صندوق الرسائل للعميل المحتمل",subject:"عنوان الرسالة",body:"نص الرسالة",draft:"حفظ مسودة",none2:"لا توجد مسودات",
    trySend:"إرسال",cancel:"إلغاء المسودة",status:{DRAFT:"مسودة",CANCELLED:"ملغاة"},
    outboxNote:"الإرسال الخارجي متوقف حتى اعتماد D-10؛ يُفحص الرفض والموافقة عند الحفظ وعند محاولة الإرسال.",
    errors:{OPTED_OUT:"العميل رفض التواصل بالبريد.",NO_ADDRESS:"لا يوجد بريد إلكتروني للعميل.",BLOCKED_BY_POLICY:"الإرسال الخارجي متوقف حتى اعتماد D-10.",MESSAGE_STATE:"الرسالة ليست مسودة.",
      SELF:"اختر زميلًا آخر.",UNAVAILABLE:"اختر زميلًا نشطًا.",REQUIRED:"أكمل الحقول المطلوبة.",TOO_LONG:"النص أطول من المسموح.",conflict:"تم التعديل من مكان آخر؛ حدّثنا البيانات، أعد المحاولة.",denied:"ليست لديك صلاحية لهذا الإجراء.",failed:"تعذّر تنفيذ الطلب."},
  },
  en: {
    inbox:"Notifications",sub:"In-app notices only, from workflows and colleagues. Nothing is sent as e-mail or any outside message.",
    unreadOnly:"Unread only",readAll:"Mark all read",none:"No notifications",open:"Open",markRead:"Mark read",from:"From",
    kinds:{MENTION:"Mention",REVIEW_CHANGES_REQUESTED:"Changes requested",REVIEW_APPROVAL_NEEDED:"Quotation awaits your approval",REVIEW_APPROVED:"Quotation approved",REVIEW_REJECTED:"Quotation rejected",HANDOVER_REWORK:"Handover needs rework",HANDOVER_ACCEPTED:"Handover accepted",HANDOVER_REJECTED:"Handover rejected",ENGAGEMENT_ASSIGNED:"Engagement assigned to you",LEAD_FIRST_CONTACT_OVERDUE:"A lead missed its first-contact target",LEAD_QUALIFICATION_OVERDUE:"A lead missed its qualification target",LEAD_ROUTED:"A new lead was routed to you",LEAD_UNROUTED:"A lead could not be routed to anyone",VISIT_ASSIGNED:"Visit assigned to you",VISIT_UNASSIGNED:"Visit moved to a colleague",VISIT_RESCHEDULED:"Visit rescheduled",VISIT_CANCELLED:"Visit cancelled",QUALITY_ACTION_ASSIGNED:"Corrective action assigned to you",QUALITY_PLAN_ASSIGNED:"You own a quality issue's plan",TRAINING_REFUND_REQUESTED:"A training refund awaits finance",TRAINING_REFUND_CREDITED:"Training refund credited (credit note)",TRAINING_REFUND_REJECTED:"Training refund rejected",CERT_DECISION_NEEDED:"A certification cycle awaits a decision",CERT_VOTE_NEEDED:"Your vote is needed on a certification decision",CERT_GRANTED:"Certificate granted",CERT_REFUSED:"Certification refused",CERT_SUSPENDED:"Certificate suspended",CERT_RESTORED:"Certificate restored",CERT_WITHDRAWN:"Certificate withdrawn",CERT_CHANGE_VOTE_NEEDED:"Your vote is needed on a certificate change",CERT_CHANGE_REJECTED:"The committee rejected a certificate change",RECRUITMENT_FEE_REQUESTED:"A placement fee awaits invoicing",RECRUITMENT_REFUND_REQUESTED:"A placement fee refund awaits finance",RECRUITMENT_REPLACEMENT_OPENED:"A free replacement was opened"},
    mentionTitle:"Mention a colleague",person:"Colleague",search:"Type at least 2 letters",message:"Message",send:"Send in app",sent:"Mention sent.",
    mentionNote:"Your colleague only gets the link; opening the record follows their own permissions.",
    outbox:"Messages to this lead",subject:"Subject line",body:"Message",draft:"Save draft",none2:"No drafts",
    trySend:"Send",cancel:"Cancel draft",status:{DRAFT:"Draft",CANCELLED:"Cancelled"},
    outboxNote:"Sending outside the CRM waits for D-10; opt-outs are checked when saving and again when sending.",
    errors:{OPTED_OUT:"The lead opted out of e-mail.",NO_ADDRESS:"The lead has no e-mail address.",BLOCKED_BY_POLICY:"Sending outside the CRM waits for D-10.",MESSAGE_STATE:"The message is not a draft.",
      SELF:"Choose someone else.",UNAVAILABLE:"Choose an active colleague.",REQUIRED:"Complete the required fields.",TOO_LONG:"The text is longer than allowed.",conflict:"It changed elsewhere; the data is refreshed, try again.",denied:"You do not have permission for this action.",failed:"The request failed."},
  },
} as const;
type Labels = typeof strings.ar | typeof strings.en;

function message(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.errors.failed;
  const errors = l.errors as Record<string, string>;
  const field = error.fields[0];
  if (field && errors[field.code]) return errors[field.code];
  if (error.code && errors[error.code]) return errors[error.code];
  if (error.statusCode === 409) return l.errors.conflict;
  if (error.statusCode === 403 || error.statusCode === 404) return l.errors.denied;
  return l.errors.failed;
}
const stamp = (value: string | null) => value ? value.replace("T", " ").slice(0, 16) : "—";

export function InboxPage({language,onChanged}:{language:Language; onChanged?:()=>void}){
  const l=strings[language];
  const [unreadOnly,setUnreadOnly]=useState(false);
  const [rows,setRows]=useState<Notice[]|null>(null);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{
    try{setRows(await getInbox(unreadOnly));}catch(e){setRows([]);setError(message(e,l));}
  },[unreadOnly,l]);
  useEffect(()=>{void load();},[load]);
  async function run(action:()=>Promise<unknown>){
    setError("");
    try{await action();}catch(e){setError(message(e,l));}
    await load();onChanged?.();
  }
  return <section className="page-enter in-page">
    <div className="page-title"><span className="eyebrow">{language==="ar"?"مساحة العمل":"Workspace"}</span><h1>{l.inbox}</h1><p>{l.sub}</p></div>
    <div className="mk-queue-head">
      <label className="mk-check"><input type="checkbox" checked={unreadOnly} onChange={e=>setUnreadOnly(e.target.checked)}/><span>{l.unreadOnly}</span></label>
      <button type="button" className="btn btn-secondary" onClick={()=>void run(markAllRead)}><CheckCheck size={15}/>{l.readAll}</button>
    </div>
    {error&&<p className="mk-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    {rows===null?null:rows.length===0?<p className="wf-muted">{l.none}</p>:
    <ul className="wf-list in-list">{rows.map(n=>{
      const route=noticeRoute(n);
      return <li key={n.id} className={n.read?undefined:"in-unread"}>
        <span><strong>{(l.kinds as Record<string,string>)[n.kind]??n.kind}</strong> · {n.title}
          <small className="mk-sub">{l.from} {n.actorName??"—"} · {stamp(n.at)}</small></span>
        <span className="mk-actions">
          {route&&<a className="btn btn-secondary" href={route} onClick={()=>{if(!n.read)void markRead(n.id).then(onChanged).catch(()=>{});}}>{l.open}</a>}
          {!n.read&&<button type="button" className="btn btn-secondary" onClick={()=>void run(()=>markRead(n.id))}>{l.markRead}</button>}
        </span>
      </li>;})}</ul>}
  </section>;
}

/** Point a colleague to this record (in-app only). */
export function MentionForm({subject,subjectId,language}:{subject:Subject; subjectId:number; language:Language}){
  const l=strings[language];
  const [q,setQ]=useState("");
  const [people,setPeople]=useState<Person[]>([]);
  const [recipient,setRecipient]=useState("");
  const [text,setText]=useState("");
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [error,setError]=useState("");
  useEffect(()=>{
    if(q.trim().length<2){setPeople([]);return;}
    const timer=window.setTimeout(()=>void findPeople(q.trim()).then(setPeople).catch(()=>setPeople([])),250);
    return()=>window.clearTimeout(timer);
  },[q]);
  async function submit(){
    setBusy(true);setError("");setNotice("");
    try{await mention(Number(recipient),subject,subjectId,text);setText("");setNotice(l.sent);}
    catch(e){setError(message(e,l));}
    finally{setBusy(false);}
  }
  return <section className="in-mention" aria-labelledby={`in-mention-${subject}-${subjectId}`}>
    <h3 id={`in-mention-${subject}-${subjectId}`}><AtSign size={16}/>{l.mentionTitle}</h3>
    <form className="ct-form" onSubmit={e=>{e.preventDefault();void submit();}}>
      <label><span>{l.person}</span><input value={q} placeholder={l.search} onChange={e=>{setQ(e.target.value);setRecipient("");}}/></label>
      {people.length>0&&<label><span className="sr-only">{l.person}</span><select aria-label={l.person} value={recipient} required onChange={e=>setRecipient(e.target.value)}>
        <option value="">—</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      <label><span>{l.message}</span><input value={text} maxLength={280} required onChange={e=>setText(e.target.value)}/></label>
      <div className="mk-actions"><button type="submit" className="btn btn-secondary" disabled={busy||!recipient||!text.trim()}><Send size={15}/>{l.send}</button></div>
    </form>
    {error&&<p className="mk-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    {notice&&<p className="wf-ok" role="status">{notice}</p>}
    <p className="wf-muted">{l.mentionNote}</p>
  </section>;
}

/** Messages drafted for a lead; consent is checked, sending is blocked (D-10). */
export function OutboxPanel({leadId,language}:{leadId:number; language:Language}){
  const l=strings[language];
  const [rows,setRows]=useState<OutboundMessage[]>([]);
  const [subjectLine,setSubjectLine]=useState("");
  const [body,setBody]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{try{setRows(await getOutbox(leadId));}catch{setRows([]);}},[leadId]);
  useEffect(()=>{void load();},[load]);
  async function run(action:()=>Promise<unknown>,reset?:()=>void){
    if(busy)return;
    setBusy(true);setError("");
    try{await action();reset?.();}catch(e){setError(message(e,l));}
    finally{await load();setBusy(false);}
  }
  return <section className="in-outbox" aria-labelledby={`in-outbox-${leadId}`}>
    <h3 id={`in-outbox-${leadId}`}><Send size={16}/>{l.outbox}</h3>
    <form className="ct-form" onSubmit={e=>{e.preventDefault();void run(()=>draftMessage(leadId,subjectLine,body),()=>{setSubjectLine("");setBody("");});}}>
      <label><span>{l.subject}</span><input value={subjectLine} maxLength={200} required onChange={e=>setSubjectLine(e.target.value)}/></label>
      <label><span>{l.body}</span><textarea rows={4} value={body} maxLength={20000} required onChange={e=>setBody(e.target.value)}/></label>
      <div className="mk-actions"><button type="submit" className="btn btn-secondary" disabled={busy||!subjectLine.trim()||!body.trim()}>{l.draft}</button></div>
    </form>
    {error&&<p className="mk-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    {rows.length===0?<p className="wf-muted">{l.none2}</p>:
    <ul className="wf-list">{rows.map(m=><li key={m.id}><span><strong>{m.subjectLine}</strong> · <span className="wf-status">{l.status[m.status]}</span>
      <small className="mk-sub">{m.authorName??"—"} · {stamp(m.createdAt)}</small></span>
      {m.status==="DRAFT"&&<span className="mk-actions">
        <button type="button" className="btn btn-secondary" disabled aria-describedby={`in-outbox-note-${leadId}`}><Send size={15}/>{l.trySend}</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void run(()=>cancelMessage(m.id,m.version))}><Undo2 size={15}/>{l.cancel}</button>
      </span>}</li>)}</ul>}
    <p className="wf-muted" id={`in-outbox-note-${leadId}`}><LockKeyhole size={13}/> {l.outboxNote}</p>
  </section>;
}
