import { useCallback, useEffect, useState } from "react";
import { CircleAlert, ClipboardCheck, LockKeyhole, Plus } from "lucide-react";
import { ApiError, createContract, fillContractFromQuote, getContracts, getQuotes, type Contract } from "./api";
import type { Language } from "./preferences";
import { ContractWorkflow } from "./WorkflowPanels";

const strings = {
  ar: {
    title:"العقد",desc:"عقد العميل في Axelor (Contract) المرتبط بهذه الفرصة.",loading:"جار التحميل...",
    empty:"لا يوجد عقد لهذه الفرصة بعد",type:"نوع العقد",billing:"عقد فوترة",framework:"عقد إطاري",
    create:"إنشاء مسودة عقد",creating:"جار الإنشاء...",draft:"مسودة",active:"ساري",closed:"مغلق",
    activate:"توقيع وتفعيل العقد",handover:"التسليم لفريق التنفيذ",
    blocked:"التوقيع والتفعيل والتسليم للتنفيذ متوقفة حتى اعتماد سياسة الموافقات والاعتماد القانوني (D-11).",
    exists:"يوجد عقد لهذه الفرصة بالفعل.",accountRequired:"اربط الفرصة بحساب عميل أولًا.",
    setup:"إعداد العقود لهذه الشركة غير مكتمل (مثل تسلسل أرقام العقود)؛ اطلب من المسؤول استكماله.",
    changed:"تم تعديل الفرصة من مكان آخر؛ حدّثنا البيانات، أعد المحاولة.",denied:"ليست لديك صلاحية لهذا الإجراء.",failed:"تعذّر تنفيذ الطلب.",
    fill:"نسخ البنود من عرض السعر",filling:"جار النسخ...",noQuote:"لا يوجد عرض سعر به بنود لهذه الفرصة.",
    product:"المنتج أو الخدمة",quantity:"الكمية",unitPrice:"سعر الوحدة قبل الضريبة",lineTotal:"الإجمالي قبل الضريبة",
    total:"إجمالي العقد قبل الضريبة",fromQuote:"منسوخة من عرض السعر",linesExist:"بنود العقد موجودة بالفعل.",
    quoteEmpty:"عرض السعر لا يحتوي على بنود منتجات.",
  },
  en: {
    title:"Contract",desc:"The Axelor customer contract (Contract) of this opportunity.",loading:"Loading...",
    empty:"No contract for this opportunity yet",type:"Contract type",billing:"Billing contract",framework:"Framework contract",
    create:"Create draft contract",creating:"Creating...",draft:"Draft",active:"Active",closed:"Closed",
    activate:"Sign & activate contract",handover:"Hand over to operations",
    blocked:"Signature, activation and operations handover are blocked until the approval and legal policy (D-11) is signed.",
    exists:"A contract already exists for this opportunity.",accountRequired:"Link the opportunity to a customer account first.",
    setup:"Contract setup for this company is incomplete (for example the contract number sequence); ask an administrator.",
    changed:"This opportunity changed elsewhere; the data is refreshed, try again.",denied:"You do not have permission for this action.",failed:"The request failed.",
    fill:"Copy lines from quotation",filling:"Copying...",noQuote:"No quotation with lines for this opportunity.",
    product:"Product or service",quantity:"Quantity",unitPrice:"Unit price before tax",lineTotal:"Total before tax",
    total:"Contract total before tax",fromQuote:"Copied from quotation",linesExist:"The contract already has lines.",
    quoteEmpty:"The quotation has no product lines.",
  },
} as const;
type Labels = typeof strings.ar | typeof strings.en;

function message(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.failed;
  if (error.code === "CONTRACT_EXISTS") return l.exists;
  if (error.code === "LINES_EXIST") return l.linesExist;
  if (error.fields[0]?.code === "QUOTE_EMPTY") return l.quoteEmpty;
  if (error.statusCode === 409) return l.changed;
  if (error.fields[0]?.code === "ACCOUNT_REQUIRED") return l.accountRequired;
  if (error.code === "SETUP_REQUIRED") return l.setup;
  if (error.statusCode === 403 || error.statusCode === 404) return l.denied;
  return l.failed;
}

/** The opportunity's contract: a draft can be created; signature and handover stay blocked (D-11). */
export function ContractPanel({opportunityId,opportunityVersion,language,onOpportunityChanged}:{
  opportunityId:number; opportunityVersion:number; language:Language; onOpportunityChanged?:()=>void;
}){
  const l=strings[language];
  const [contracts,setContracts]=useState<Contract[]|null>(null);
  const [type,setType]=useState<"BILLING"|"FRAMEWORK">("BILLING");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{setContracts(await getContracts(opportunityId));},[opportunityId]);
  useEffect(()=>{setError("");setContracts(null);void load().catch(e=>setError(message(e,l)));},[load,l]);
  async function create(){
    if(busy)return;
    setBusy(true);setError("");
    try{const created=await createContract(opportunityId,opportunityVersion,type);setContracts([created]);onOpportunityChanged?.();}
    catch(e){setError(message(e,l));if(e instanceof ApiError&&e.statusCode===409){void load().catch(()=>undefined);onOpportunityChanged?.();}}
    finally{setBusy(false);}
  }
  async function fill(target:Contract){
    if(busy)return;
    setBusy(true);setError("");
    try{
      const quote=(await getQuotes(opportunityId)).find(q=>q.lines.length>0);
      if(!quote){setError(l.noQuote);return;}
      const updated=await fillContractFromQuote(target.id,target.version,quote.id);
      setContracts(current=>(current||[]).map(c=>c.id===updated.id?updated:c));
    }catch(e){setError(message(e,l));if(e instanceof ApiError&&e.statusCode===409)void load().catch(()=>undefined);}
    finally{setBusy(false);}
  }
  const contract=contracts?.[0]??null;
  const lines=contract?.lines||[];
  const statusLabel=(s:string|null)=>s==="DRAFT"?l.draft:s==="ACTIVE"?l.active:s==="CLOSED"?l.closed:(s||"—");
  return <section className="record-content-card contract-panel" aria-labelledby="contract-title">
    <div className="record-section-header"><div className="record-section-icon"><ClipboardCheck size={20}/></div><div>
      <h2 id="contract-title">{l.title}</h2><p>{l.desc}</p></div></div>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {contracts===null?<div className="empty-state" role="status">{l.loading}</div>
    :!contract?<div className="contract-create">
      <p>{l.empty}</p>
      <label><span>{l.type}</span><select value={type} onChange={e=>setType(e.target.value as "BILLING"|"FRAMEWORK")}>
        <option value="BILLING">{l.billing}</option><option value="FRAMEWORK">{l.framework}</option></select></label>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={()=>void create()}><Plus size={16}/>{busy?l.creating:l.create}</button>
    </div>
    :<div className="contract-body">
      <div className="quote-head"><code dir="ltr">{contract.reference||"#"+contract.id}</code>
        <span className="record-status-tag">{statusLabel(contract.status)}</span>
        <span>{contract.contractType==="FRAMEWORK"?l.framework:l.billing}</span>
        {contract.accountName&&<span>{contract.accountName}</span>}</div>
      {lines.length>0?<div className="table-scroll"><table className="quote-lines">
        <thead><tr><th>{l.product}</th><th>{l.quantity}</th><th>{l.unitPrice}</th><th>{l.lineTotal}</th></tr></thead>
        <tbody>{lines.map(line=><tr key={line.id}>
          <td><strong>{line.name}</strong>{line.productCode&&<small className="quote-code" dir="ltr">{line.productCode}</small>}</td>
          <td dir="ltr">{Number(line.quantity)}</td><td dir="ltr">{line.unitPriceBeforeTax} {contract.currency}</td>
          <td dir="ltr">{line.totalBeforeTax} {contract.currency}</td></tr>)}</tbody>
        <tfoot><tr><th colSpan={3}>{l.total}{contract.sourceQuoteId?` · ${l.fromQuote} #${contract.sourceQuoteId}`:""}</th>
          <th dir="ltr">{contract.totalBeforeTax} {contract.currency}</th></tr></tfoot>
      </table></div>
      :contract.status==="DRAFT"&&<div><button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void fill(contract)}><Plus size={16}/>{busy?l.filling:l.fill}</button></div>}
      <ContractWorkflow contract={contract} language={language} onChanged={()=>void load().catch(()=>undefined)}/>
      <div className="quote-finalize">
        <button type="button" className="btn btn-primary" disabled aria-describedby="contract-blocked">{l.activate}</button>
        <button type="button" className="btn btn-secondary" disabled aria-describedby="contract-blocked">{l.handover}</button>
      </div>
    </div>}
    <p className="record-security-note" id="contract-blocked"><LockKeyhole size={15}/>{l.blocked}</p>
  </section>;
}
