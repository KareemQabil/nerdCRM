import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, CircleAlert, GitMerge, ShieldCheck } from "lucide-react";
import {
  ApiError, convertLead, getAccounts, getCreatableBusinessLines, getLead,
  type AccountSummary, type BusinessLine, type LeadConversion, type LeadSummary,
} from "./api";
import type { Language } from "./preferences";

const strings = {
  ar: {
    title:"تحويل العميل المحتمل",back:"الرجوع إلى العميل المحتمل",
    intro:"ينشئ التحويل حساب العميل (وجهة اتصال إن كانت شركة) وفرصة تجارية في عملية واحدة؛ إن فشل أي جزء لا يُحفظ شيء.",
    opportunityName:"اسم الفرصة التجارية",businessLine:"خط الأعمال",chooseLine:"اختر خط الأعمال",
    account:"الحساب",newAccount:"إنشاء حساب جديد من بيانات العميل المحتمل",existingAccount:"إضافة إلى حساب موجود",
    chooseAccount:"اختر الحساب",convert:"تحويل",converting:"جار التحويل...",loading:"جار التحميل...",
    done:"تم التحويل",doneDesc:"أُنشئت السجلات التالية وربطت بالعميل المحتمل.",
    openAccount:"فتح الحساب",openOpportunity:"فتح الفرصة التجارية",already:"تم تحويل هذا العميل المحتمل من قبل.",
    changed:"عدّل شخص آخر هذا السجل؛ حمّلنا أحدث نسخة، راجعها ثم أعد المحاولة.",
    invalidName:"الاسم يجب أن يكون من 3 إلى 160 حرفًا",
    lineUnavailable:"خط الأعمال غير متاح لك أو غير نشط؛ اختر خطًا آخر",
    accountUnavailable:"لا يمكنك إضافة الفرصة إلى هذا الحساب؛ اختر حسابًا آخر أو أنشئ حسابًا جديدًا",
    rejected:"لا يمكن تحويل هذا العميل المحتمل في حالته الحالية (مثلًا: مفقود أو عنوانه ناقص).",
    denied:"ليست لديك صلاحية تحويل هذا العميل المحتمل.",failed:"تعذّر التحويل؛ حاول مرة أخرى.",
    noLines:"لم يتم تعيينك على أي خط أعمال بعد؛ اطلب من المسؤول إضافتك",
    security:"الصلاحيات والتحقق من الإصدار وخط الأعمال يفرضها الخادم.",
  },
  en: {
    title:"Convert lead",back:"Back to lead",
    intro:"Conversion creates the account (and a contact for a company) and an opportunity in one step; if any part fails, nothing is saved.",
    opportunityName:"Opportunity name",businessLine:"Business line",chooseLine:"Choose business line",
    account:"Account",newAccount:"Create a new account from this lead",existingAccount:"Add to an existing account",
    chooseAccount:"Choose account",convert:"Convert",converting:"Converting...",loading:"Loading...",
    done:"Lead converted",doneDesc:"These records were created and linked to the lead.",
    openAccount:"Open account",openOpportunity:"Open opportunity",already:"This lead has already been converted.",
    changed:"Someone else changed this lead; the latest version is loaded. Review it and try again.",
    invalidName:"Name must be 3–160 characters",
    lineUnavailable:"This business line is not available to you or not active; choose another",
    accountUnavailable:"You cannot add the opportunity to this account; choose another or create a new one",
    rejected:"This lead cannot be converted in its current state (for example lost, or an incomplete address).",
    denied:"You do not have permission to convert this lead.",failed:"Conversion failed; try again.",
    noLines:"You are not assigned to any business line yet; ask an administrator to add you",
    security:"Permissions, record version and business line are enforced by the server.",
  },
} as const;

type Props = { leadId: number; language: Language };

export function LeadConvertPage({leadId,language}:Props){
  const ar=language==="ar";
  const l=strings[language];
  const BackArrow=ar?ArrowRight:ArrowLeft;
  const [lead,setLead]=useState<LeadSummary|null>(null);
  const [lines,setLines]=useState<BusinessLine[]|null>(null);
  const [accounts,setAccounts]=useState<AccountSummary[]>([]);
  const [name,setName]=useState("");
  const [lineCode,setLineCode]=useState("");
  const [useExisting,setUseExisting]=useState(false);
  const [accountId,setAccountId]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [result,setResult]=useState<LeadConversion|null>(null);
  const heading=useRef<HTMLHeadingElement>(null);

  const loadLead=useCallback(async()=>{
    const record=await getLead(leadId);
    setLead(record);
    return record;
  },[leadId]);
  useEffect(()=>{
    let current=true;
    setError("");
    Promise.all([loadLead(),getCreatableBusinessLines(),getAccounts(0,50).catch(()=>[] as AccountSummary[])])
      .then(([record,creatable,accountList])=>{
        if(!current)return;
        setLines(creatable);setAccounts(accountList);
        setName(record.organization||record.name);
        setLineCode(creatable.some(line=>line.code===record.businessLineCode)?record.businessLineCode||"":creatable[0]?.code||"");
      })
      .catch(e=>{if(current)setError(e instanceof ApiError&&e.statusCode===403?l.denied:l.failed);});
    return()=>{current=false;};
  },[loadLead,l.denied,l.failed]);
  useEffect(()=>{heading.current?.focus();},[]);

  async function submit(e:React.FormEvent){
    e.preventDefault();
    if(!lead||lead.version==null||busy)return;
    setBusy(true);setError("");
    try{
      const converted=await convertLead(lead.id,{
        version:lead.version,opportunityName:name.trim(),businessLineCode:lineCode,
        ...(useExisting&&accountId?{accountId:Number(accountId)}:{}),
      });
      setResult(converted);
      void loadLead().catch(()=>undefined);
    }catch(err){
      if(err instanceof ApiError){
        const field=err.fields[0]?.field;
        if(err.code==="ALREADY_CONVERTED"){setError(l.already);void loadLead().catch(()=>undefined);}
        else if(err.statusCode===409){setError(l.changed);void loadLead().catch(()=>undefined);}
        else if(field==="name")setError(l.invalidName);
        else if(field==="businessLineCode")setError(l.lineUnavailable);
        else if(field==="accountId")setError(l.accountUnavailable);
        else if(err.code==="CONVERSION_REJECTED")setError(l.rejected);
        else if(err.statusCode===403||err.statusCode===404)setError(l.denied);
        else setError(l.failed);
      }else setError(l.failed);
    }finally{setBusy(false);}
  }

  const back=()=>{window.location.hash="#/leads/"+leadId;};
  const converted=result||(lead?.converted&&lead.accountId&&lead.opportunityId
    ?{leadId,accountId:lead.accountId,contactId:null,opportunityId:lead.opportunityId}:null);
  return <article className="record-workspace page-enter lead-convert" aria-labelledby="lead-convert-title">
    <div className="record-context-bar">
      <button type="button" className="record-back" onClick={back}><BackArrow size={17}/>{l.back}</button>
      <span className="record-context-separator">/</span>
      <span className="record-current" aria-current="page">{lead?.name||"…"}</span>
    </div>
    <div className="record-hero">
      <div className="record-hero-main">
        <span className="eyebrow"><span className="record-eyebrow-dot"/>Axelor CRM · Lead → Partner + Opportunity</span>
        <div className="record-hero-heading">
          <div className="record-identity-icon"><GitMerge size={30}/></div>
          <div><h1 tabIndex={-1} ref={heading} id="lead-convert-title">{l.title}</h1>
            {lead&&<div className="record-tags"><span className="record-status-tag">{lead.organization||lead.name}</span></div>}</div>
        </div>
        <p className="record-hero-description">{l.intro}</p>
      </div>
    </div>
    {converted?<section className="record-content-card" role="status" aria-labelledby="lead-convert-done">
      <div className="record-section-header"><div className="record-section-icon"><CheckCircle2 size={20}/></div><div><h2 id="lead-convert-done">{result?l.done:l.already}</h2><p>{l.doneDesc}</p></div></div>
      <div className="drawer-actions">
        <a className="btn btn-secondary" href={"#/accounts/"+converted.accountId}><Building2 size={16}/>{l.openAccount}</a>
        <a className="btn btn-primary" href={"#/opportunities/"+converted.opportunityId}>{l.openOpportunity}</a>
      </div>
    </section>
    :<section className="record-content-card">
      {!lead||lines===null?(error?<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>:<div className="empty-state" role="status">{l.loading}</div>)
      :<form className="opportunity-form" onSubmit={e=>void submit(e)}>
        <label><span>{l.opportunityName}</span><input value={name} maxLength={160} minLength={3} required onChange={e=>setName(e.target.value)}/></label>
        <label><span>{l.businessLine}</span><select required value={lineCode} onChange={e=>setLineCode(e.target.value)}>
          <option value="">{l.chooseLine}</option>
          {lines.map(line=><option key={line.id} value={line.code}>{ar?line.nameAr:line.nameEn}</option>)}
        </select></label>
        {lines.length===0&&<div className="login-error" role="status"><CircleAlert size={17}/>{l.noLines}</div>}
        <fieldset className="convert-account"><legend>{l.account}</legend>
          <label className="convert-choice"><input type="radio" name="account-mode" checked={!useExisting} onChange={()=>setUseExisting(false)}/>{l.newAccount}</label>
          <label className="convert-choice"><input type="radio" name="account-mode" checked={useExisting} disabled={accounts.length===0} onChange={()=>setUseExisting(true)}/>{l.existingAccount}</label>
          {useExisting&&<label><span>{l.chooseAccount}</span><select required value={accountId} onChange={e=>setAccountId(e.target.value)}>
            <option value="">{l.chooseAccount}</option>
            {accounts.map(account=><option key={account.id} value={account.id}>{account.name}{account.reference?` · ${account.reference}`:""}</option>)}
          </select></label>}
        </fieldset>
        {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
        <div className="drawer-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={back}>{l.back}</button>
          <button type="submit" className="btn btn-primary" disabled={busy||lines.length===0||lead.version==null}><GitMerge size={16}/>{busy?l.converting:l.convert}</button>
        </div>
      </form>}
      <p className="record-security-note"><ShieldCheck size={15}/>{l.security}</p>
    </section>}
  </article>;
}
