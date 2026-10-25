import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CircleAlert, LockKeyhole, Plus, Trash2 } from "lucide-react";
import { ApiError, addMilestone, getMilestones, removeMilestone, type MilestonePlan } from "./api";
import type { Language } from "./preferences";
import { InvoiceRequests } from "./WorkflowPanels";

const strings = {
  ar: {
    title:"دفعات السداد",desc:"خطة الدفعات على عرض السعر. المحجوز والمطلوب فوترته والمحصّل أرقام منفصلة.",
    booked:"محجوز (أمر مؤكد)",notBooked:"غير محجوز بعد",planned:"المخطط",invoiced:"المُفوتر",collected:"المُحصّل",
    name:"اسم الدفعة",percentage:"النسبة %",dueDate:"تاريخ الاستحقاق",amount:"المبلغ قبل الضريبة",state:"الحالة",
    add:"إضافة دفعة",adding:"جار الإضافة...",remove:"حذف الدفعة",empty:"لا توجد دفعات بعد",loading:"جار التحميل...",
    states:{PLANNED:"مخططة",INVOICED:"مُفوترة",PARTIALLY_COLLECTED:"محصّلة جزئيًا",COLLECTED:"محصّلة"} as Record<string,string>,
    invoiceNote:"الفاتورة بتتصدر من صفحة المالية بعد طلب الفوترة، في حسابات Axelor (D-06).",
    totalExceeded:"مجموع نسب الدفعات لا يمكن أن يتجاوز 100%.",badPercentage:"النسبة أكبر من صفر وحتى 100 وبحد أقصى رقمين عشريين.",
    badDate:"أدخل تاريخًا صحيحًا.",badTitle:"اسم الدفعة من 3 إلى 120 حرفًا.",changed:"تم تعديل عرض السعر من مكان آخر؛ حدّثنا البيانات، أعد المحاولة.",
    notDraft:"لا يمكن تعديل إلا عرض سعر في حالة المسودة.",invoicedMilestone:"لا يمكن حذف دفعة تمت فوترتها.",
    denied:"ليست لديك صلاحية لهذا الإجراء.",failed:"تعذّر تنفيذ الطلب.",
  },
  en: {
    title:"Payment milestones",desc:"Payment plan of this quotation. Booked, requested for invoicing and collected are separate figures.",
    booked:"Booked (confirmed order)",notBooked:"Not booked yet",planned:"Planned",invoiced:"Invoiced",collected:"Collected",
    name:"Milestone",percentage:"Percent",dueDate:"Due date",amount:"Amount before tax",state:"State",
    add:"Add milestone",adding:"Adding...",remove:"Remove milestone",empty:"No milestones yet",loading:"Loading...",
    states:{PLANNED:"Planned",INVOICED:"Invoiced",PARTIALLY_COLLECTED:"Partly collected",COLLECTED:"Collected"} as Record<string,string>,
    invoiceNote:"Finance issues the invoice from its page once invoicing is requested, in Axelor accounting (D-06).",
    totalExceeded:"Milestones cannot exceed 100 % in total.",badPercentage:"Percent must be above 0, at most 100, with up to 2 decimals.",
    badDate:"Enter a valid date.",badTitle:"Milestone name must be 3–120 characters.",changed:"This quotation changed elsewhere; the data is refreshed, try again.",
    notDraft:"Only a draft quotation can be changed.",invoicedMilestone:"An invoiced milestone cannot be removed.",
    denied:"You do not have permission for this action.",failed:"The request failed.",
  },
} as const;
type Labels = typeof strings.ar | typeof strings.en;

function message(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.failed;
  const field = error.fields[0];
  if (error.statusCode === 409) return l.changed;
  if (field?.code === "TOTAL_EXCEEDED") return l.totalExceeded;
  if (field?.field === "percentage") return l.badPercentage;
  if (field?.field === "dueDate") return l.badDate;
  if (field?.field === "title") return l.badTitle;
  if (error.code === "QUOTE_NOT_DRAFT") return l.notDraft;
  if (error.code === "MILESTONE_INVOICED") return l.invoicedMilestone;
  if (error.statusCode === 403 || error.statusCode === 404) return l.denied;
  return l.failed;
}

/** Payment milestones of one quotation; every change is a server command with the quotation version. */
export function MilestonesPanel({quoteId,editable,language,onQuoteChanged}:{quoteId:number;editable:boolean;language:Language;onQuoteChanged:()=>void}){
  const l=strings[language];
  const [plan,setPlan]=useState<MilestonePlan|null>(null);
  const [title,setTitle]=useState("");
  const [percentage,setPercentage]=useState("");
  const [dueDate,setDueDate]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{setPlan(await getMilestones(quoteId));},[quoteId]);
  useEffect(()=>{setError("");void load().catch(e=>setError(message(e,l)));},[load,l]);
  async function run(action:()=>Promise<MilestonePlan>){
    if(busy||!plan)return;
    setBusy(true);setError("");
    try{setPlan(await action());onQuoteChanged();return true;}
    catch(e){setError(message(e,l));if(e instanceof ApiError&&e.statusCode===409){void load().catch(()=>undefined);onQuoteChanged();}return false;}
    finally{setBusy(false);}
  }
  const submit=(e:React.FormEvent)=>{
    e.preventDefault();
    if(!plan)return;
    void run(()=>addMilestone(quoteId,plan.quoteVersion,title.trim(),percentage,dueDate)).then(ok=>{if(ok){setTitle("");setPercentage("");setDueDate("");}});
  };
  // Latin digits, as on the quotation lines, so amounts read the same in Arabic and English
  const money=(value:string|null)=>value==null?"—":`${Number(value).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})} ${plan?.currency||""}`;
  return <div className="milestones" aria-labelledby="milestones-title">
    <div className="milestones-head"><CalendarClock size={18}/><div><h3 id="milestones-title">{l.title}</h3><p>{l.desc}</p></div></div>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {!plan?<div className="empty-state" role="status">{l.loading}</div>:<>
      <dl className="milestone-figures">
        <div><dt>{l.planned}</dt><dd dir="ltr">{Number(plan.plannedPercentage)}% · {money(plan.plannedAmountBeforeTax)}</dd></div>
        <div><dt>{l.booked}</dt><dd dir="ltr">{plan.bookingStatus==="BOOKED"?money(plan.bookedBeforeTax):<span>{l.notBooked}</span>}</dd></div>
        <div><dt>{l.invoiced}</dt><dd dir="ltr">{money(plan.invoiced)}</dd></div>
        <div><dt>{l.collected}</dt><dd dir="ltr">{money(plan.collected)}</dd></div>
      </dl>
      <div className="table-scroll"><table className="quote-lines">
        <thead><tr><th>{l.name}</th><th>{l.percentage}</th><th>{l.dueDate}</th><th>{l.amount}</th><th>{l.state}</th>{editable&&<th><span className="sr-only">{l.remove}</span></th>}</tr></thead>
        <tbody>{plan.milestones.length===0?<tr><td colSpan={editable?6:5}>{l.empty}</td></tr>:plan.milestones.map(m=><tr key={m.id}>
          <td>{m.title}</td><td dir="ltr">{Number(m.percentage)}%</td><td dir="ltr">{m.dueDate||"—"}</td><td dir="ltr">{money(m.amountBeforeTax)}</td>
          <td>{l.states[m.state]||m.state}</td>
          {editable&&<td><button type="button" className="icon-button" aria-label={`${l.remove}: ${m.title}`} disabled={busy||m.state!=="PLANNED"}
            onClick={()=>void run(()=>removeMilestone(quoteId,m.id,plan.quoteVersion))}><Trash2 size={16}/></button></td>}
        </tr>)}</tbody>
      </table></div>
      {editable&&<form className="opportunity-form milestone-form" onSubmit={submit}>
        <label><span>{l.name}</span><input required minLength={3} maxLength={120} value={title} onChange={e=>setTitle(e.target.value)}/></label>
        <label><span>{l.percentage}</span><input type="number" required min="0.01" max="100" step="0.01" value={percentage} onChange={e=>setPercentage(e.target.value)}/></label>
        <label><span>{l.dueDate}</span><input type="date" required value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label>
        <button type="submit" className="btn btn-secondary" disabled={busy}><Plus size={16}/>{busy?l.adding:l.add}</button>
      </form>}
      <p className="record-security-note"><LockKeyhole size={15}/>{l.invoiceNote}</p>
      {!editable&&plan.milestones.length>0&&<InvoiceRequests plan={plan} language={language} onChanged={()=>{void load().catch(()=>undefined);onQuoteChanged();}}/>}
    </>}
  </div>;
}
