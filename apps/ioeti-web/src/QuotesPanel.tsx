import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, CircleAlert, FileText, LockKeyhole, Percent, Plus, Send } from "lucide-react";
import {
  ApiError, addQuoteLine, createQuote, finalizeQuote, getCatalog, getQuotes, markQuoteSent, refreshQuoteTax, setLineDiscount,
  type CatalogProduct, type Quote,
} from "./api";
import type { Language } from "./preferences";
import { MilestonesPanel } from "./MilestonesPanel";
import { QuoteWorkflow } from "./WorkflowPanels";
import { QuoteAcceptance } from "./CommitmentPanels";

const strings = {
  ar: {
    title:"عروض الأسعار",desc:"عروض الأسعار لهذه الفرصة وإصداراتها ومراجعتها، ضمن صلاحياتك.",
    create:"عرض سعر جديد",creating:"جار الإنشاء...",empty:"لا توجد عروض أسعار لهذه الفرصة بعد",
    loading:"جار التحميل...",draft:"مسودة",product:"المنتج أو الخدمة",chooseProduct:"اختر من الكتالوج",
    quantity:"الكمية",add:"إضافة بند",adding:"جار الإضافة...",unitPrice:"سعر الوحدة قبل الضريبة",
    lineTotal:"الإجمالي قبل الضريبة",total:"الإجمالي قبل الضريبة",noLines:"لا توجد بنود بعد",
    taxApplied:(name:string,rate:string,since:string)=>`الضريبة من سياسة المالية: ${name} ${rate}% سارية من ${since} (D-06).`,
    taxNotSet:"لم يحدد مالك السياسات ضريبة لخط الأعمال هذا بعد (D-06)، فالعرض محسوب بدون ضريبة ولا يمكن اعتماده.",
    taxOutdated:"تغيّرت سياسة الضريبة منذ آخر حساب لهذا العرض.",applyTax:"طبّق الضريبة الحالية",applying:"جار التطبيق...",
    totalWithTax:"الإجمالي شامل الضريبة",
    discount:"الخصم %",discountLine:"خصم على بند",chooseLine:"اختر البند",setDiscount:"طبّق الخصم",badDiscount:"الخصم من 0 لـ 100 وبحد أقصى رقمين عشريين.",
    approvalTitle:"الاعتماد والإرسال",finalize:"اعتماد العرض نهائيًا",finalizing:"جار الاعتماد...",
    approvers:{NONE:"من غير موافقة",SALES_MANAGER:"مدير المبيعات",GM:"المدير العام"},
    needed:(who:string,d:string)=>`الخصم ${d}% والقيمة دي محتاجين موافقة ${who}. اطلب مراجعة تحت، وهو اللي هيعتمد العرض.`,
    notNeeded:(d:string)=>`الخصم ${d}% في حدود المستوى اللي مش محتاج موافقة؛ تقدر تعتمد العرض بنفسك.`,
    approvalNotSet:"مالك السياسات لسه ما حددش مستويات الموافقة أو مدة صلاحية العروض لخط الأعمال ده (D-11)، فالعرض مينفعش يتعتمد.",
    outside:(d:string)=>`الخصم ${d}% أو القيمة أكبر من كل مستويات الموافقة؛ قلّل الخصم أو اطلب من مالك السياسات تعديل المستويات.`,
    approved:(who:string,at:string,tier:string)=>`اتعتمد بواسطة ${who} في ${at} (${tier}).`,validUntil:(d:string)=>`ساري لحد ${d}.`,expired:"العرض انتهت صلاحيته.",
    sendTitle:"تسجيل الإرسال",sendNote:"إزاي بعته (مثلًا: إيميل من حسابي، واتساب، تسليم باليد)",markSent:"سجّل إنه اتبعت",
    sendHint:"المنصة مش بتبعت العرض للعميل؛ ابعته انت وسجّل هنا إنه اتبعت.",
    sent:(who:string,at:string)=>`اتبعت بواسطة ${who} في ${at}.`,
    approvalRequired:"العرض ده محتاج موافقة؛ اطلب مراجعة.",policyNotSet:"سياسة لازمة لسه مش متحددة؛ مالك السياسات يحددها من صفحة السياسات.",
    outsideTiers:"الخصم أو القيمة أكبر من كل مستويات الموافقة.",taxOutdatedError:"سياسة الضريبة اتغيرت؛ طبّق الضريبة الحالية الأول.",
    notFinalized:"العرض لازم يكون نهائي الأول.",expiredError:"العرض انتهت صلاحيته.",
    accountRequired:"اربط الفرصة بحساب عميل أولًا (مثلًا بتحويل العميل المحتمل).",
    setup:"إعداد المبيعات لهذه الشركة أو لهذا المنتج غير مكتمل؛ اطلب من المسؤول استكماله.",
    changed:"تم تعديل السجل من مكان آخر؛ حدّثنا البيانات، أعد المحاولة.",
    productUnavailable:"اختر منتجًا قابلًا للبيع من الكتالوج.",badQuantity:"الكمية يجب أن تكون أكبر من صفر وحتى 100000 وبحد أقصى 4 أرقام عشرية.",
    notDraft:"لا يمكن تعديل إلا عرض سعر في حالة المسودة.",denied:"ليست لديك صلاحية لهذا الإجراء.",failed:"تعذّر تنفيذ الطلب.",
    catalogEmpty:"الكتالوج فارغ أو غير متاح لك",
  },
  en: {
    title:"Quotations",desc:"Quotations for this opportunity, their versions and review, within your permissions.",
    create:"New quotation",creating:"Creating...",empty:"No quotations for this opportunity yet",
    loading:"Loading...",draft:"Draft",product:"Product or service",chooseProduct:"Choose from catalog",
    quantity:"Quantity",add:"Add line",adding:"Adding...",unitPrice:"Unit price before tax",
    lineTotal:"Total before tax",total:"Total before tax",noLines:"No lines yet",
    taxApplied:(name:string,rate:string,since:string)=>`Tax from the finance policy: ${name} ${rate}%, in force from ${since} (D-06).`,
    taxNotSet:"No tax is set for this business line yet (D-06): the quotation is computed without tax and cannot be finalized.",
    taxOutdated:"The tax policy has changed since this quotation was computed.",applyTax:"Apply the current tax",applying:"Applying...",
    totalWithTax:"Total including tax",
    discount:"Discount %",discountLine:"Discount on a line",chooseLine:"Choose the line",setDiscount:"Apply discount",badDiscount:"A discount is from 0 to 100 with up to 2 decimals.",
    approvalTitle:"Approval and sending",finalize:"Finalize quotation",finalizing:"Finalizing...",
    approvers:{NONE:"No approval",SALES_MANAGER:"Sales manager",GM:"General manager"},
    needed:(who:string,d:string)=>`A ${d}% discount at this value needs approval from the ${who}. Ask for a review below; they finalize it.`,
    notNeeded:(d:string)=>`A ${d}% discount is within the tier that needs no approval; you can finalize it yourself.`,
    approvalNotSet:"The policy owners have not set the approval tiers or the quotation validity for this business line yet (D-11), so it cannot be finalized.",
    outside:(d:string)=>`A ${d}% discount or this value is above every approval tier; lower the discount or ask the policy owners to change the tiers.`,
    approved:(who:string,at:string,tier:string)=>`Approved by ${who} on ${at} (${tier}).`,validUntil:(d:string)=>`Valid until ${d}.`,expired:"This quotation has expired.",
    sendTitle:"Record sending",sendNote:"How you sent it (e.g. e-mail from my account, WhatsApp, by hand)",markSent:"Record as sent",
    sendHint:"The platform does not send the quotation to the client; send it yourself and record it here.",
    sent:(who:string,at:string)=>`Sent by ${who} on ${at}.`,
    approvalRequired:"This quotation needs approval; ask for a review.",policyNotSet:"A required policy is not set yet; a policy owner sets it under Policies.",
    outsideTiers:"The discount or value is above every approval tier.",taxOutdatedError:"The tax policy changed; apply the current tax first.",
    notFinalized:"The quotation has to be finalized first.",expiredError:"This quotation has expired.",
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
  if (field?.field === "percent") return l.badDiscount;
  if (error.code === "APPROVAL_REQUIRED") return l.approvalRequired;
  if (error.code === "POLICY_NOT_SET") return l.policyNotSet;
  if (error.code === "OUTSIDE_APPROVAL_TIERS") return l.outsideTiers;
  if (error.code === "TAX_OUTDATED") return l.taxOutdatedError;
  if (error.code === "QUOTE_NOT_FINALIZED") return l.notFinalized;
  if (error.code === "QUOTE_EXPIRED") return l.expiredError;
  if (error.code === "QUOTE_NOT_DRAFT") return l.notDraft;
  if (error.statusCode === 403 || error.statusCode === 404) return l.denied;
  return l.failed;
}

const stamp = (value: string | null) => value ? value.replace("T", " ").slice(0, 16) : "—";
const pct = (value: string | number | null | undefined) => String(Number(value ?? 0));

/**
 * D-11: where a quotation stands on approval. A draft shows the tier its discount and value fall in (finalized here when
 * no approval is needed, otherwise through a review); a finalized one shows who approved, its validity and sending.
 */
function QuoteApprovalBox({quote,l,busy,run,onUpdated}:{quote:Quote;l:Labels;busy:boolean;run:(a:()=>Promise<unknown>)=>Promise<void>;onUpdated:(q:Quote)=>void}){
  const [note,setNote]=useState("");
  const a=quote.approval;
  if(!a)return null;
  const who=(code:string|null)=>code?((l.approvers as Record<string,string>)[code]??code):"—";
  const taxReady=quote.taxStatus==="APPLIED"&&!quote.taxOutdated;
  return <div className="quote-approval" aria-labelledby="quote-approval-title">
    <h3 id="quote-approval-title"><BadgeCheck size={17}/>{l.approvalTitle}</h3>
    {quote.status==="DRAFT"?<>
      <p className={"quote-approval-note"+(a.status==="NOT_NEEDED"?" is-ok":"")} role="status">
        {a.status==="NEEDED"?l.needed(who(a.approver),pct(a.discountPercent))
          :a.status==="NOT_NEEDED"?l.notNeeded(pct(a.discountPercent))
          :a.status==="OUTSIDE_APPROVAL_TIERS"?l.outside(pct(a.discountPercent)):l.approvalNotSet}</p>
      {a.status==="NOT_NEEDED"&&<button type="button" className="btn btn-primary" disabled={busy||!taxReady||quote.lines.length===0}
        onClick={()=>void run(async()=>onUpdated(await finalizeQuote(quote)))}><BadgeCheck size={16}/>{busy?l.finalizing:l.finalize}</button>}
    </>:a.status==="APPROVED"&&<>
      <p className="quote-approval-note is-ok">{l.approved(a.approvedBy??"—",stamp(a.approvedAt),who(a.approver))} {a.validUntil&&l.validUntil(a.validUntil)}</p>
      {a.expired&&<p className="quote-approval-note is-late" role="status">{l.expired}</p>}
      {a.sentAt?<p className="quote-approval-note"><Send size={15}/>{l.sent(a.sentBy??"—",stamp(a.sentAt))}{a.sentVia?` · ${a.sentVia}`:""}</p>
      :quote.status==="FINALIZED"&&!a.expired&&<form className="quote-send" onSubmit={e=>{e.preventDefault();void run(async()=>{onUpdated(await markQuoteSent(quote,note));setNote("");});}}>
        <strong>{l.sendTitle}</strong><small>{l.sendHint}</small>
        <label><span>{l.sendNote}</span><input type="text" maxLength={300} value={note} onChange={e=>setNote(e.target.value)}/></label>
        <button type="submit" className="btn btn-primary" disabled={busy}><Send size={15}/>{l.markSent}</button>
      </form>}
    </>}
  </div>;
}

/** Quotations of one opportunity; tax comes from the finance.tax policy (D-06), approval from sales.quote-approval (D-11). */
export function QuotesPanel({opportunityId,opportunityVersion,language,onOpportunityChanged}:{
  opportunityId:number; opportunityVersion:number; language:Language; onOpportunityChanged?:()=>void;
}){
  const l=strings[language];
  const [quotes,setQuotes]=useState<Quote[]|null>(null);
  const [catalog,setCatalog]=useState<CatalogProduct[]>([]);
  const [productId,setProductId]=useState("");
  const [quantity,setQuantity]=useState("1");
  const [busy,setBusy]=useState(false);
  const [discountLine,setDiscountLine]=useState("");
  const [discount,setDiscount]=useState("0");
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
  const replace=(updated:Quote)=>setQuotes(current=>(current||[]).map(q=>q.id===updated.id?updated:q));
  const applyDiscount=(e:React.FormEvent)=>{
    e.preventDefault();
    if(!quote||!discountLine)return;
    void run(async()=>{replace(await setLineDiscount(quote,Number(discountLine),discount));setDiscountLine("");setDiscount("0");});
  };
  const applyTax=()=>run(async()=>{
    if(!quote)return;
    const updated=await refreshQuoteTax(quote.id,quote.version);
    setQuotes(current=>(current||[]).map(q=>q.id===updated.id?updated:q));
  });
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
        <thead><tr><th>{l.product}</th><th>{l.quantity}</th><th>{l.unitPrice}</th><th>{l.discount}</th><th>{l.lineTotal}</th></tr></thead>
        <tbody>{quote.lines.length===0?<tr><td colSpan={5}>{l.noLines}</td></tr>:quote.lines.map(line=><tr key={line.id}>
          <td><strong>{line.name}</strong>{line.productCode&&<small className="quote-code" dir="ltr">{line.productCode}</small>}</td>
          <td dir="ltr">{Number(line.quantity)}{line.unit?" "+line.unit:""}</td>
          <td dir="ltr">{line.unitPriceBeforeTax} {quote.currency}</td>
          <td dir="ltr">{pct(line.discountPercent)}%</td>
          <td dir="ltr">{line.totalBeforeTax} {quote.currency}</td>
        </tr>)}</tbody>
        <tfoot><tr><th colSpan={4}>{l.total}</th><th dir="ltr">{quote.totalBeforeTax} {quote.currency}</th></tr>
          {quote.taxStatus==="APPLIED"&&quote.tax&&<>
            <tr className="quote-tax-row"><th colSpan={4}>{quote.tax.name} {Number(quote.tax.ratePercent)}%</th><th dir="ltr">{quote.taxTotal} {quote.currency}</th></tr>
            <tr><th colSpan={4}>{l.totalWithTax}</th><th dir="ltr">{quote.totalWithTax} {quote.currency}</th></tr>
          </>}
        </tfoot>
      </table></div>
      <p className="record-security-note"><LockKeyhole size={15}/>{quote.taxStatus==="APPLIED"&&quote.tax
        ?l.taxApplied(quote.tax.name,String(Number(quote.tax.ratePercent)),quote.tax.since)
        :l.taxNotSet}</p>
      {quote.taxOutdated&&<div className="quote-tax-outdated" role="status"><CircleAlert size={16}/><span>{l.taxOutdated}</span>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void applyTax()}>{busy?l.applying:l.applyTax}</button></div>}
      {quote.status==="DRAFT"&&<form className="opportunity-form quote-line-form" onSubmit={addLine}>
        <label><span>{l.product}</span><select required value={productId} onChange={e=>setProductId(e.target.value)}>
          <option value="">{catalog.length?l.chooseProduct:l.catalogEmpty}</option>
          {catalog.map(p=><option key={p.id} value={p.id}>{p.name}{p.salePrice?` · ${Number(p.salePrice)} ${p.currency||""}`:""}</option>)}
        </select></label>
        <label><span>{l.quantity}</span><input type="number" min="0.0001" max="100000" step="any" required value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
        <button type="submit" className="btn btn-secondary" disabled={busy||!productId}><Plus size={16}/>{busy?l.adding:l.add}</button>
      </form>}
      {quote.status==="DRAFT"&&quote.lines.length>0&&<form className="opportunity-form quote-line-form" onSubmit={applyDiscount} aria-label={l.discountLine}>
        <label><span>{l.discountLine}</span><select required value={discountLine} onChange={e=>setDiscountLine(e.target.value)}>
          <option value="">{l.chooseLine}</option>
          {quote.lines.map(line=><option key={line.id} value={line.id}>{line.name}</option>)}
        </select></label>
        <label><span>{l.discount}</span><input type="number" min="0" max="100" step="0.01" required value={discount} onChange={e=>setDiscount(e.target.value)}/></label>
        <button type="submit" className="btn btn-secondary" disabled={busy||!discountLine}><Percent size={16}/>{l.setDiscount}</button>
      </form>}
      <QuoteApprovalBox quote={quote} l={l} busy={busy} run={run} onUpdated={replace}/>
      <QuoteAcceptance quote={quote} language={language} onChanged={()=>{void load().catch(()=>undefined);onOpportunityChanged?.();}}/>
      <QuoteWorkflow quote={quote} language={language} onChanged={()=>void load().catch(()=>undefined)}/>
      <MilestonesPanel quoteId={quote.id} editable={quote.status==="DRAFT"} language={language}
        onQuoteChanged={()=>void load().catch(()=>undefined)}/>
    </div>}
  </section>;
}
