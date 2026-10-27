import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BellRing, Building2, CircleAlert, Layers3, LockKeyhole, RefreshCw, Search, UserPlus, UserRound } from "lucide-react";
import { ApiError, getAccount, getAccounts, getLead, getLeads, type AccountSummary, type LeadSummary } from "./api";
import { DEMO_MODE } from "./demo";
import { stageLabel } from "./labels";
import type { Language } from "./preferences";
import { RecordWorkspace } from "./RecordWorkspace";
import { LeadConvertPage } from "./LeadConvertPage";
import { FollowUpQueue, LeadFilterBar, LeadIntakePanel } from "./LeadTools";
import { searchLeads, type LeadQuery } from "./marketingApi";
import { AccountDialog } from "./RecordDialogs";
import { PageHeader } from "./ui";
import { problem } from "./dailyApi";

type Kind = "leads" | "accounts";
type Row = LeadSummary | AccountSummary;
type Props = { kind: Kind; language: Language };
const strings = {
  ar: {
    leads:"العملاء المحتملون",accounts:"دليل حسابات العملاء",
    leadsSub:"سجّل العملاء المحتملين، أهّلهم وتابعهم، ثم حوّلهم إلى حساب وفرصة تجارية.",
    accountsSub:"الشركات العميلة والمحتملة. افتح أي حساب لترى الفرص وجهات الاتصال والعقود والمبالغ في مكان واحد.",
    search:"ابحث في السجلات المحمّلة...",record:"السجل",organization:"الجهة",status:"الحالة",reference:"المرجع",
    active:"عميل",prospect:"محتمل",empty:"لا توجد نتائج",loading:"جار تحميل البيانات المسموح بها...",
    more:"تحميل المزيد",refresh:"تحديث",details:"عرض التفاصيل",close:"إغلاق",unavailable:"تعذّر جلب السجلات",
    offline:"معلومات النطاق قيد التوصيل بالـBackend",readOnly:"بيانات حية ضمن نطاق صلاحياتك",
    demo:"هذه السجلات خيالية للمعاينة فقط",noPermission:"ليس لديك صلاحية قراءة هذا الموديول.",
    source:"المصدر", leadSource:"المبيعات", accountSource:"المبيعات",
    serverSearch:"ابحث بالاسم أو الجهة أو البريد أو الهاتف...",newLead:"عميل محتمل جديد",newAccount:"حساب جديد",list:"القائمة",followUps:"المتابعات",
    next:"تأهيل العملاء المحتملين وتحويلهم من صفحة كل عميل محتمل؛ التوزيع على الآخرين وأهداف زمن الاستجابة بانتظار D-07 وD-12", nextAccounts:"Account 360: الفرص وجهات الاتصال داخل صفحة الحساب",
  },
  en: {
    leads:"Lead inbox",accounts:"Account directory",
    leadsSub:"Record leads, qualify and follow them up, then convert them into an account and an opportunity.",
    accountsSub:"Customer and prospect companies. Open an account to see its opportunities, contacts, contracts and money in one place.",
    search:"Search loaded records...",record:"Record",organization:"Organization",status:"Status",reference:"Reference",
    active:"Customer",prospect:"Prospect",empty:"No results",loading:"Loading authorized records...",
    more:"Load more",refresh:"Refresh",details:"Details",close:"Close",unavailable:"Could not load records",
    offline:"Backend domain connection is in progress",readOnly:"Live data within your permissions",
    demo:"All records are fictional and for visual review only",noPermission:"No permission to read this module.",
    source:"Source",leadSource:"Sales",accountSource:"Sales",
    serverSearch:"Search name, organization, e-mail or phone...",newLead:"New lead",newAccount:"New account",list:"List",followUps:"Follow-ups",
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
  // live leads: filtered on the server (Arabic-normalized search), saved views, intake and follow-ups
  const liveLeads=kind==="leads"&&!DEMO_MODE;
  const [query,setQuery]=useState<LeadQuery>({});
  const [tab,setTab]=useState<"list"|"followUps">("list");
  const [intake,setIntake]=useState(false);
  const [addingAccount,setAddingAccount]=useState(false);
  useEffect(()=>{
    if(!liveLeads)return;
    const timer=window.setTimeout(()=>setQuery(current=>(current.q??"")===filter?current:{...current,q:filter}),300);
    return()=>window.clearTimeout(timer);
  },[filter,liveLeads]);
  const focusReturn=useRef<HTMLElement|null>(null);
  const listScroll=useRef(0);
  const returningFromDetail=useRef(false);
  const load = useCallback(async () => {
    setLoading(true);setError("");
    try {
      const result=liveLeads?await searchLeads(query,0,25):kind==="leads"?await getLeads(0,25):await getAccounts(0,25);
      setItems(result);
      setHasMore(result.length===25);
    } catch(e) {
      if(e instanceof ApiError && e.statusCode===403)setError(l.noPermission);
      else setError(problem(e,ar));
      setItems([]);setHasMore(false);
    } finally{setLoading(false);}
  },[kind,liveLeads,query,l.noPermission,l.unavailable]);
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
        .catch(error=>{if(mine===generation){setSelected(null);setError(problem(error,ar));}})
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
    if(!query||liveLeads)return true;
    const haystack=isLead(item)?[item.name,item.organization,item.stage]:[item.name,item.reference];
    return haystack.some(value=>(value||"").toLocaleLowerCase().includes(query));
  }),[filter,items,liveLeads]);

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
    }catch(e){setError(problem(e,ar));}
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
      const result=liveLeads?await searchLeads(query,items.length,25):kind==="leads"?await getLeads(items.length,25):await getAccounts(items.length,25);
      setItems(current=>[...current,...result.filter(row=>!current.some(c=>c.id===row.id))]);
      setHasMore(result.length===25);
    }catch(e){setError(problem(e,ar));}
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
    <PageHeader className="directory-head" eyebrow={kind==="leads"?l.leadSource:l.accountSource} title={kind==="leads"?l.leads:l.accounts}
      description={kind==="leads"?l.leadsSub:l.accountsSub} actions={<>
        {kind==="accounts"&&!DEMO_MODE&&<button type="button" className="btn btn-primary" onClick={()=>setAddingAccount(true)}><Building2 size={16}/>{l.newAccount}</button>}
        {liveLeads&&<button type="button" className="btn btn-primary" aria-expanded={intake} onClick={()=>setIntake(open=>!open)}><UserPlus size={16}/>{l.newLead}</button>}
      </>}/>
    {DEMO_MODE&&<div className="directory-topline"><div className="directory-illustration"><Layers3 size={17}/><span>{l.demo}</span></div></div>}
    {liveLeads&&<div className="segmented page-tabs" role="group">
      <button type="button" className={tab==="list"?"chosen":""} aria-pressed={tab==="list"} onClick={()=>setTab("list")}><UserRound size={15}/>{l.list}</button>
      <button type="button" className={tab==="followUps"?"chosen":""} aria-pressed={tab==="followUps"} onClick={()=>setTab("followUps")}><BellRing size={15}/>{l.followUps}</button>
    </div>}
    {liveLeads&&intake&&<LeadIntakePanel language={language} onClose={()=>setIntake(false)}
      onRecorded={lead=>{setIntake(false);void load();window.location.hash="#/leads/"+lead.id;}}/>}
    {liveLeads&&tab==="followUps"?<FollowUpQueue language={language}/>:<>
    <div className="list-toolbar">
      <label className="search-field"><Search size={18}/><span className="sr-only">{liveLeads?l.serverSearch:l.search}</span><input value={filter} placeholder={liveLeads?l.serverSearch:l.search} onChange={e=>setFilter(e.target.value)}/></label>
      <button type="button" className="icon-button" aria-label={l.refresh} onClick={()=>void load()}><RefreshCw size={18}/></button>
    </div>
    {liveLeads&&<LeadFilterBar query={query} language={language} onChange={next=>{setQuery(next);setFilter(next.q??"");}}/>}
    {error&&<div className="error-banner" role="alert"><CircleAlert size={17}/><span>{error}</span><button className="btn btn-secondary" type="button" onClick={()=>void load()}>{l.refresh}</button></div>}
    <div className="data-panel">
      <div className="data-panel-heading"><strong>{kind==="leads"?l.leads:l.accounts}</strong><span>{visible.length} {ar?"سجل":"records"} · {DEMO_MODE?l.demo:l.readOnly}</span></div>
      {loading?<div className="empty-state" role="status">{l.loading}</div>:visible.length===0?<div className="empty-state">{l.empty}</div>:
      <div className="directory-items">
        {visible.map(item=><article className="directory-item" key={item.id}>
          <div className="line-monogram">{item.name.trim().slice(0,1).toLocaleUpperCase()}</div>
          <div className="directory-record"><strong>{item.name}</strong><small>{isLead(item)?item.organization||"—":item.reference||"—"}</small></div>
          <div className="directory-state">{isLead(item)?stageLabel(item.stage,language):(item.customer?l.active:l.prospect)}</div>
          <button className="text-action" disabled={detailLoading} type="button" onClick={e=>void showRecord(item,e.currentTarget)}>{l.details}{ar?<ArrowLeft size={16}/>:<ArrowRight size={16}/>}</button>
        </article>)}
      </div>}
    </div>
    </>}
    {hasMore&&!(liveLeads&&tab==="followUps")&&<div className="load-more"><button className="btn btn-secondary" type="button" disabled={busyMore} onClick={()=>void more()}>{busyMore?l.loading:l.more}</button></div>}
    {addingAccount&&<AccountDialog language={language} onClose={()=>setAddingAccount(false)}
      onSaved={account=>{setAddingAccount(false);void load();window.location.hash="#/accounts/"+account.id;}}/>}
    <div className="directory-next"><LockKeyhole size={18}/><span>{kind==="leads"?l.next:l.nextAccounts}</span></div>
  </section>;
}
