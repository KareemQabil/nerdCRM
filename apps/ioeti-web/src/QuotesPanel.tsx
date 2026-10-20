import { useCallback, useEffect, useState } from "react";
import { CircleAlert, FileText, LockKeyhole, Plus } from "lucide-react";
import { ApiError, addQuoteLine, createQuote, getCatalog, getQuotes, type CatalogProduct, type Quote } from "./api";
import type { Language } from "./preferences";
import { MilestonesPanel } from "./MilestonesPanel";

const strings = {
  ar: {
    title:"عروض الأسعار",desc:"عروض أسعار Axelor (SaleOrder) لهذه الفرصة، ضمن صلاحياتك.",
    create:"عرض سعر جديد",creating:"جار الإنشاء...",empty:"لا توجد عروض أسعار لهذه الفرصة بعد",
    loading:"جار التحميل...",draft:"مسودة",product:"المنتج أو الخدمة",chooseProduct:"اختر من الكتالوج",
    quantity:"الكمية",add:"إضافة بند",adding:"جار الإضافة...",unitPrice:"سعر الوحدة قبل الضريبة",
    lineTotal:"الإجمالي قبل الضريبة",total:"الإجمالي قبل الضريبة",noLines:"لا توجد بنود بعد",
    taxNote:"لا تُحسب الضرائب هنا حتى تعتمد IOETI سياسة الضرائب والفوترة (D-06).",
    finalize:"اعتماد وإرسال العرض",finalizeNote:"متوقف حتى اعتماد سياسات المالية (D-06) ومصفوفة الموافقات (D-11).",
    accountRequired:"اربط الفرصة بحساب عميل أولًا (مثلًا بتحويل العميل المحتمل).",
    setup:"إعداد المبيعات لهذه الشركة أو لهذا المنتج غير مكتمل؛ اطلب من المسؤول استكماله.",
    changed:"تم تعديل السجل من مكان آخر؛ حدّثنا البيانات، أعد المحاولة.",
    productUnavailable:"اختر منتجًا قابلًا للبيع من الكتالوج.",badQuantity:"الكمية يجب أن تكون أكبر من صفر وحتى 100000 وبحد أقصى 4 أرقام عشرية.",
    notDraft:"لا يمكن تعديل إلا عرض سعر في حالة المسودة.",denied:"ليست لديك صلاحية لهذا الإجراء.",failed:"تعذّر تنفيذ الطلب.",
    catalogEmpty:"الكتالوج فارغ أو غير متاح لك",
  },
  en: {
    title:"Quotations",desc:"Axelor quotations (SaleOrder) for this opportunity, within your permissions.",
    create:"New quotation",creating:"Creating...",empty:"No quotations for this opportunity yet",
    loading:"Loading...",draft:"Draft",product:"Product or service",chooseProduct:"Choose from catalog",
    quantity:"Quantity",add:"Add line",adding:"Adding...",unitPrice:"Unit price before tax",
    lineTotal:"Total before tax",total:"Total before tax",noLines:"No lines yet",
    taxNote:"Taxes are not calculated here until IOETI approves its tax and invoicing policy (D-06).",
    finalize:"Approve & send quotation",finalizeNote:"Blocked until the finance (D-06) and approval matrix (D-11) policies are signed.",
    accountRequired:"Link the opportunity to a customer account first (for example by converting the lead).",
    setup:"Sales setup for this company or product is incomplete; ask an administrator to complete it.",
    changed:"This record changed elsewhere; the data is refreshed, try again.",
    productUnavailable:"Choose a sellable product from the catalog.",badQuantity:"Quantity must be above 0, at most 100000, with up to 4 decimals.",
    notDraft:"Only a draft quotation can be changed.",denied:"You do not have permission for this action.",failed:"The request failed.",
    catalogEmpty:"The catalog is empty or not available to you",
  },
} as const;
type Labels = typeof strings.ar | typeof strings.en;

function message(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.failed;
  const field = error.fields[0];
  if (error.statusCode === 409) return l.changed;
  if (field?.code === "ACCOUNT_REQUIRED") return l.accountRequired;
  if (error.code === "SETUP_REQUIRED") return l.setup;
  if (field?.field === "productId") return l.productUnavailable;
  if (field?.field === "quantity") return l.badQuantity;
  if (error.code === "QUOTE_NOT_DRAFT") return l.notDraft;
  if (error.statusCode === 403 || error.statusCode === 404) return l.denied;
  return l.failed;
}

/** Draft quotations of one opportunity; amounts are before tax only (D-06). */
export function QuotesPanel({opportunityId,opportunityVersion,language,onOpportunityChanged}:{
  opportunityId:number; opportunityVersion:number; language:Language; onOpportunityChanged?:()=>void;
}){
  const l=strings[language];
  const [quotes,setQuotes]=useState<Quote[]|null>(null);
  const [catalog,setCatalog]=useState<CatalogProduct[]>([]);
  const [productId,setProductId]=useState("");
  const [quantity,setQuantity]=useState("1");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{
    setQuotes(await getQuotes(opportunityId));
  },[opportunityId]);
  useEffect(()=>{
    setError("");setQuotes(null);
    void load().catch(e=>setError(message(e,l)));
    void getCatalog().then(setCatalog).catch(()=>setCatalog([]));
  },[load,l]);
  const quote=quotes?.[0]??null;
  async function run(action:()=>Promise<unknown>){
    if(busy)return;
    setBusy(true);setError("");
    try{await action();}
    catch(e){
      setError(message(e,l));
      if(e instanceof ApiError&&e.statusCode===409){void load().catch(()=>undefined);onOpportunityChanged?.();}
    }finally{setBusy(false);}
  }
  const create=()=>run(async()=>{
    const created=await createQuote(opportunityId,opportunityVersion);
    setQuotes(current=>[created,...(current||[])]);
    onOpportunityChanged?.();
  });
  const addLine=(e:React.FormEvent)=>{
    e.preventDefault();
    if(!quote||!productId)return;
    void run(async()=>{
      const updated=await addQuoteLine(quote.id,quote.version,Number(productId),quantity);
      setQuotes(current=>(current||[]).map(q=>q.id===updated.id?updated:q));
      setProductId("");setQuantity("1");
    });
  };
  return <section className="record-content-card quotes-panel" aria-labelledby="quotes-title">
    <div className="record-section-header"><div className="record-section-icon"><FileText size={20}/></div><div>
      <h2 id="quotes-title">{l.title}</h2><p>{l.desc}</p>
    </div>
      {quotes!==null&&quotes.length===0&&<button type="button" className="btn btn-primary quotes-create" disabled={busy} onClick={()=>void create()}><Plus size={16}/>{busy?l.creating:l.create}</button>}
    </div>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {quotes===null?<div className="empty-state" role="status">{l.loading}</div>
    :!quote?<div className="record-related-empty"><FileText size={26}/><strong>{l.empty}</strong></div>
    :<div className="quote-body">
      <div className="quote-head"><code dir="ltr">{quote.reference||"#"+quote.id}</code><span className="record-status-tag">{quote.status==="DRAFT"?l.draft:quote.status}</span>{quote.accountName&&<span>{quote.accountName}</span>}</div>
      <div className="table-scroll"><table className="quote-lines">
        <thead><tr><th>{l.product}</th><th>{l.quantity}</th><th>{l.unitPrice}</th><th>{l.lineTotal}</th></tr></thead>
        <tbody>{quote.lines.length===0?<tr><td colSpan={4}>{l.noLines}</td></tr>:quote.lines.map(line=><tr key={line.id}>
          <td><strong>{line.name}</strong>{line.productCode&&<small className="quote-code" dir="ltr">{line.productCode}</small>}</td>
          <td dir="ltr">{Number(line.quantity)}{line.unit?" "+line.unit:""}</td>
          <td dir="ltr">{line.unitPriceBeforeTax} {quote.currency}</td>
          <td dir="ltr">{line.totalBeforeTax} {quote.currency}</td>
        </tr>)}</tbody>
        <tfoot><tr><th colSpan={3}>{l.total}</th><th dir="ltr">{quote.totalBeforeTax} {quote.currency}</th></tr></tfoot>
      </table></div>
      <p className="record-security-note"><LockKeyhole size={15}/>{l.taxNote}</p>
      {quote.status==="DRAFT"&&<form className="opportunity-form quote-line-form" onSubmit={addLine}>
        <label><span>{l.product}</span><select required value={productId} onChange={e=>setProductId(e.target.value)}>
          <option value="">{catalog.length?l.chooseProduct:l.catalogEmpty}</option>
          {catalog.map(p=><option key={p.id} value={p.id}>{p.name}{p.salePrice?` · ${Number(p.salePrice)} ${p.currency||""}`:""}</option>)}
        </select></label>
        <label><span>{l.quantity}</span><input type="number" min="0.0001" max="100000" step="any" required value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
        <button type="submit" className="btn btn-secondary" disabled={busy||!productId}><Plus size={16}/>{busy?l.adding:l.add}</button>
      </form>}
      <div className="quote-finalize"><button type="button" className="btn btn-primary" disabled aria-describedby="quote-finalize-note">{l.finalize}</button>
        <small id="quote-finalize-note">{l.finalizeNote}</small></div>
      <MilestonesPanel quoteId={quote.id} editable={quote.status==="DRAFT"} language={language}
        onQuoteChanged={()=>void load().catch(()=>undefined)}/>
    </div>}
  </section>;
}
