import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Building2, CircleAlert, Layers3, LockKeyhole, RefreshCw, Search, UserRound } from "lucide-react";
import { ApiError, getAccount, getAccounts, getLead, getLeads, type AccountSummary, type LeadSummary } from "./api";
import { DEMO_MODE } from "./demo";
import type { Language } from "./preferences";
import { RecordWorkspace } from "./RecordWorkspace";
import { LeadConvertPage } from "./LeadConvertPage";

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
    offline:"معلومات النطاق قيد التوصيل بالـBackend",readOnly:"بيانات حية ضمن نطاق صلاحياتك",
    demo:"هذه السجلات خيالية للمعاينة فقط",noPermission:"ليس لديك صلاحية قراءة هذا الموديول.",
    source:"المصدر", leadSource:"Axelor Lead · LeadStatus", accountSource:"Axelor Partner",
    next:"تأهيل العملاء المحتملين وتحويلهم من صفحة كل عميل محتمل؛ التوزيع على الآخرين وأهداف زمن الاستجابة بانتظار D-07 وD-12", nextAccounts:"Account 360: الفرص وجهات الاتصال داخل صفحة الحساب",
  },
  en: {
    leads:"Lead inbox",accounts:"Account directory",
    leadsSub:"Authorized Axelor CRM Lead records with a limited, safe field selection.",
    accountsSub:"Customer/prospect companies only, excluding employee, vendor-only, and banking data.",
    search:"Search loaded records...",record:"Record",organization:"Organization",status:"Status",reference:"Reference",
    active:"Customer",prospect:"Prospect",empty:"No results",loading:"Loading authorized records...",
    more:"Load more",refresh:"Refresh",details:"Details",close:"Close",unavailable:"Could not load records",
    offline:"Backend domain connection is in progress",readOnly:"Live data within your permissions",
    demo:"All records are fictional and for visual review only",noPermission:"No permission to read this module.",
    source:"Source",leadSource:"Axelor Lead · LeadStatus",accountSource:"Axelor Partner",
    next:"Qualify and convert from each lead page; routing to others and response-time targets wait for D-07 and D-12", nextAccounts:"Account 360: opportunities and contacts on each account page",
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
  const [convertId,setConvertId]=useState<number|null>(null);
  const [detailLoading,setDetailLoading]=useState(false);
  const focusReturn=useRef<HTMLElement|null>(null);
  const listScroll=useRef(0);
  const returningFromDetail=useRef(false);
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

  // Deep-linkable record pages. The global navigation remains unchanged.
  useEffect(()=>{
    let generation=0;
    const sync=()=>{
      const mine=++generation;
      const convert=kind==="leads"?window.location.hash.match(/^#\/leads\/(\d+)\/convert$/):null;
      const target=convert?Number(convert[1]):null;
      setConvertId(target!==null&&Number.isSafeInteger(target)&&target>0?target:null);
      if(convert){setSelected(null);return;}
      const match=window.location.hash.match(/^#\/(leads|accounts)\/(\d+)$/);
      if(!match||match[1]!==kind){
        setSelected(null);
        return;
      }
      const id=Number(match[2]);
      if(!Number.isSafeInteger(id)||id<=0){setSelected(null);return;}
      setDetailLoading(true);
      void (kind==="leads"?getLead(id):getAccount(id))
        .then(record=>{if(mine===generation)setSelected(record);})
        .catch(error=>{if(mine===generation){setSelected(null);setError(error instanceof Error?error.message:l.unavailable);}})
        .finally(()=>{if(mine===generation)setDetailLoading(false);});
    };
    sync();
    window.addEventListener("popstate",sync);
    window.addEventListener("hashchange",sync);
    return()=>{generation++;window.removeEventListener("popstate",sync);window.removeEventListener("hashchange",sync);};
  },[kind,l.unavailable]);

  useEffect(()=>{
    if(selected){returningFromDetail.current=true;return;}
    if(returningFromDetail.current){
      returningFromDetail.current=false;
      requestAnimationFrame(()=>{
        window.scrollTo({top:listScroll.current,behavior:"instant"});
        focusReturn.current?.focus();
      });
    }
  },[selected]);
  const visible=useMemo(()=>items.filter(item=>{
    const query=filter.trim().toLocaleLowerCase();
    if(!query)return true;
    const haystack=isLead(item)?[item.name,item.organization,item.stage]:[item.name,item.reference];
    return haystack.some(value=>(value||"").toLocaleLowerCase().includes(query));
  }),[filter,items]);

  async function showRecord(item:Row,source?:HTMLButtonElement){
    if(source)focusReturn.current=source;
    if(!selected)listScroll.current=window.scrollY;
    setDetailLoading(true);setError("");
    try{
      const record=kind==="leads"?await getLead(item.id):await getAccount(item.id);
      const route="#/"+kind+"/"+item.id;
      if(window.location.hash!==route){
        window.history.pushState({ioetiRecordDetail:true,kind,id:item.id},"",route);
      }
      setSelected(record);
    }catch(e){setError(e instanceof Error?e.message:l.unavailable);}
    finally{setDetailLoading(false);}
  }
  function backToList(){
    if(window.history.state?.ioetiRecordDetail){
      window.history.back();
    }else{
      window.history.replaceState(null,"","#/"+kind);
      setSelected(null);
    }
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
  if(convertId!==null)return <LeadConvertPage leadId={convertId} language={language}/>;
  if(selected){
    const index=visible.findIndex(row=>row.id===selected.id);
    return <RecordWorkspace
      kind={kind} language={language} record={selected} onBack={backToList}
      onPrevious={index>0?()=>void showRecord(visible[index-1]):undefined}
      onNext={index>=0&&index<visible.length-1?()=>void showRecord(visible[index+1]):undefined}
      onRecordChanged={row=>{setSelected(row);setItems(current=>current.map(c=>c.id===row.id?row:c));}}
    />;
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
          <button className="text-action" disabled={detailLoading} type="button" onClick={e=>void showRecord(item,e.currentTarget)}>{l.details}{ar?<ArrowLeft size={16}/>:<ArrowRight size={16}/>}</button>
        </article>)}
      </div>}
    </div>
    {hasMore&&<div className="load-more"><button className="btn btn-secondary" type="button" disabled={busyMore} onClick={()=>void more()}>{busyMore?l.loading:l.more}</button></div>}
    <div className="directory-next"><LockKeyhole size={18}/><span>{kind==="leads"?l.next:l.nextAccounts}</span></div>
  </section>;
}
