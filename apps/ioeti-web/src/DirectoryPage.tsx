import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Building2, CircleAlert, Layers3, LockKeyhole, RefreshCw, Search, UserRound, X } from "lucide-react";
import { ApiError, getAccount, getAccounts, getLead, getLeads, type AccountSummary, type LeadSummary } from "./api";
import { DEMO_MODE } from "./demo";
import type { Language } from "./preferences";

type Kind = "leads" | "accounts";
type Row = LeadSummary | AccountSummary;
type Props = { kind: Kind; language: Language };
const strings = {
  ar: {
    leads:"العملاء المحتملون",accounts:"دليل حسابات العملاء",
    leadsSub:"قائمة العملاء المحتملين المتاحين لك من Axelor CRM، بحد أدنى من الحقول.",
    accountsSub:"الشركات المصنفة عملاء أو فرصًا محتملة فقط، دون بيانات البنوك والموظفين والموردين.",
    search:"ابحث في السجلات المحمّلة...",record:"السجل",organization:"الجهة",status:"الحالة",reference:"المرجع",
    active:"عميل",prospect:"محتمل",empty:"لا توجد نتائج",loading:"جار تحميل البيانات المسموح بها...",
    more:"تحميل المزيد",refresh:"تحديث",details:"عرض التفاصيل",close:"إغلاق",unavailable:"تعذّر جلب السجلات",
    offline:"معلومات النطاق قيد التوصيل بالـBackend",readOnly:"عرض فقط · لم تُبنَ إجراءات الإنشاء/التحويل الآمنة بعد",
    demo:"هذه السجلات خيالية للمعاينة فقط",noPermission:"ليس لديك صلاحية قراءة هذا الموديول.",
    source:"المصدر", leadSource:"Axelor Lead · LeadStatus", accountSource:"Axelor Partner",
    next:"القادم: تأهيل/توزيع العملاء المحتملين من Axelor", nextAccounts:"القادم: Account 360 وروابط جهات الاتصال",
  },
  en: {
    leads:"Lead inbox",accounts:"Account directory",
    leadsSub:"Authorized Axelor CRM Lead records with a limited, safe field selection.",
    accountsSub:"Customer/prospect companies only, excluding employee, vendor-only, and banking data.",
    search:"Search loaded records...",record:"Record",organization:"Organization",status:"Status",reference:"Reference",
    active:"Customer",prospect:"Prospect",empty:"No results",loading:"Loading authorized records...",
    more:"Load more",refresh:"Refresh",details:"Details",close:"Close",unavailable:"Could not load records",
    offline:"Backend domain connection is in progress",readOnly:"Read only · safe create/convert commands are not implemented yet",
    demo:"All records are fictional and for visual review only",noPermission:"No permission to read this module.",
    source:"Source",leadSource:"Axelor Lead · LeadStatus",accountSource:"Axelor Partner",
    next:"Next: Axelor-native lead qualification and routing", nextAccounts:"Next: Account 360 and contact associations",
  },
} as const;

function isLead(item: Row): item is LeadSummary { return "organization" in item; }

export function DirectoryPage({kind,language}: Props) {
  const ar = language === "ar";
  const l = strings[language];
  const [items,setItems]=useState<Row[]>([]);
  const [filter,setFilter]=useState("");
  const [loading,setLoading]=useState(true);
  const [busyMore,setBusyMore]=useState(false);
  const [error,setError]=useState("");
  const [hasMore,setHasMore]=useState(false);
  const [selected,setSelected]=useState<Row|null>(null);
  const [detailLoading,setDetailLoading]=useState(false);
  const dialogClose=useRef<HTMLButtonElement>(null);
  const focusReturn=useRef<HTMLElement|null>(null);
  const load = useCallback(async () => {
    setLoading(true);setError("");
    try {
      const result=kind==="leads"?await getLeads(0,25):await getAccounts(0,25);
      setItems(result);
      setHasMore(result.length===25);
    } catch(e) {
      if(e instanceof ApiError && e.statusCode===403)setError(l.noPermission);
      else setError(e instanceof Error?e.message:l.unavailable);
      setItems([]);setHasMore(false);
    } finally{setLoading(false);}
  },[kind,l.noPermission,l.unavailable]);
  useEffect(()=>{void load()},[load]);
  useEffect(()=>{
    if(!selected)return;
    dialogClose.current?.focus();
    const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape")setSelected(null);};
    document.addEventListener("keydown",onKey);
    return()=>{document.removeEventListener("keydown",onKey);focusReturn.current?.focus();};
  },[selected]);
  const visible=useMemo(()=>items.filter(item=>{
    const query=filter.trim().toLocaleLowerCase();
    if(!query)return true;
    const haystack=isLead(item)?[item.name,item.organization,item.stage]:[item.name,item.reference];
    return haystack.some(value=>(value||"").toLocaleLowerCase().includes(query));
  }),[filter,items]);
  async function open(item:Row,button:HTMLButtonElement){
    focusReturn.current=button;setDetailLoading(true);setError("");
    try{setSelected(kind==="leads"?await getLead(item.id):await getAccount(item.id));}
    catch(e){setError(e instanceof Error?e.message:l.unavailable);}
    finally{setDetailLoading(false);}
  }
  async function more(){
    if(busyMore)return;
    setBusyMore(true);
    try{
      const result=kind==="leads"?await getLeads(items.length,25):await getAccounts(items.length,25);
      setItems(current=>[...current,...result.filter(row=>!current.some(c=>c.id===row.id))]);
      setHasMore(result.length===25);
    }catch(e){setError(e instanceof Error?e.message:l.unavailable);}
    finally{setBusyMore(false);}
  }
  return <section className="page-enter directory-explorer">
    <div className="directory-head">
      <div className="page-title">
        <span className="eyebrow">{l.source} · {kind==="leads"?l.leadSource:l.accountSource}</span>
        <h1>{kind==="leads"?l.leads:l.accounts}</h1><p>{kind==="leads"?l.leadsSub:l.accountsSub}</p>
      </div>
      <div className="directory-head-symbol">{kind==="leads"?<UserRound size={29}/>:<Building2 size={29}/>}</div>
    </div>
    <div className="directory-topline"><div className="directory-illustration"><Layers3 size={17}/><span>{DEMO_MODE?l.demo:l.readOnly}</span></div><span>{visible.length} {ar?"سجل":"records"}</span></div>
    <div className="list-toolbar">
      <label className="search-field"><Search size={18}/><span className="sr-only">{l.search}</span><input value={filter} placeholder={l.search} onChange={e=>setFilter(e.target.value)}/></label>
      <button type="button" className="icon-button" aria-label={l.refresh} onClick={()=>void load()}><RefreshCw size={18}/></button>
    </div>
    {error&&<div className="error-banner" role="alert"><CircleAlert size={17}/><span>{error}</span><button className="btn btn-secondary" type="button" onClick={()=>void load()}>{l.refresh}</button></div>}
    <div className="data-panel">
      <div className="data-panel-heading"><strong>{kind==="leads"?l.leads:l.accounts}</strong><span>{l.readOnly}</span></div>
      {loading?<div className="empty-state" role="status">{l.loading}</div>:visible.length===0?<div className="empty-state">{l.empty}</div>:
      <div className="directory-items">
        {visible.map(item=><article className="directory-item" key={item.id}>
          <div className="line-monogram">{item.name.trim().slice(0,1).toLocaleUpperCase()}</div>
          <div className="directory-record"><strong>{item.name}</strong><small>{isLead(item)?item.organization||"—":item.reference||"—"}</small></div>
          <div className="directory-state">{isLead(item)?item.stage||"—":(item.customer?l.active:l.prospect)}</div>
          <button className="text-action" disabled={detailLoading} type="button" onClick={e=>void open(item,e.currentTarget)}>{l.details}{ar?<ArrowLeft size={16}/>:<ArrowRight size={16}/>}</button>
        </article>)}
      </div>}
    </div>
    {hasMore&&<div className="load-more"><button className="btn btn-secondary" type="button" disabled={busyMore} onClick={()=>void more()}>{busyMore?l.loading:l.more}</button></div>}
    <div className="directory-next"><LockKeyhole size={18}/><span>{kind==="leads"?l.next:l.nextAccounts}</span></div>
    {selected&&<div className="drawer-overlay" onMouseDown={e=>{if(e.currentTarget===e.target)setSelected(null)}}>
      <section className="record-drawer" role="dialog" aria-modal="true" aria-labelledby="directory-detail-title">
        <div className="drawer-header"><div className="detail-kicker">{kind==="leads"?l.leads:l.accounts}</div><button className="icon-button" type="button" ref={dialogClose} aria-label={l.close} onClick={()=>setSelected(null)}><X size={18}/></button></div>
        <div className="drawer-body">
          <div className="detail-icon">{kind==="leads"?<UserRound size={28}/>:<Building2 size={28}/>}</div>
          <h2 id="directory-detail-title">{selected.name}</h2><p>{l.readOnly}</p>
          <dl className="detail-list">
            <div><dt>{l.record}</dt><dd>#{selected.id}</dd></div>
            <div><dt>{isLead(selected)?l.organization:l.reference}</dt><dd>{(isLead(selected)?selected.organization:selected.reference)||"—"}</dd></div>
            <div><dt>{l.status}</dt><dd>{isLead(selected)?selected.stage||"—":selected.customer?l.active:l.prospect}</dd></div>
          </dl>
          <p className="scope-note"><LockKeyhole size={15}/>{l.readOnly}</p>
        </div>
        <div className="drawer-footer"><button className="btn btn-secondary" type="button" onClick={()=>setSelected(null)}>{l.close}</button></div>
      </section></div>}
  </section>;
}
