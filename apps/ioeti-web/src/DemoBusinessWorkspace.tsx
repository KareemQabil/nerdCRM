import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import {
 ArrowLeft, ArrowRight, BadgeCheck, CalendarDays, Check, CheckCircle2,
 ChevronLeft, ChevronRight, CircleHelp, ClipboardList, Clock3, FileText, Filter,
 GitBranch, Layers3, LockKeyhole, MessageSquarePlus, Plus, Search, ShieldAlert,
 Sparkles, UsersRound, Workflow, X
} from "lucide-react";
import type { Language } from "./preferences";
import { DEMO_MODE } from "./demo";
import { DEMO_AREAS, demoBusinessStore, demoConfigs, type DemoArea, type DemoRecord } from "./demoBusiness";

type Props={area:DemoArea;language:Language;onNavigateArea:(area:DemoArea,id?:number)=>void};
type DialogKind="create"|"advance"|"note";
const en={
  mock:"Fictional interactive preview",notBackend:"Changes exist only in memory, reset when the page reloads.",
  source:"Mapped foundation",search:"Search fictional records",all:"All stages",new:"New scenario",
  records:"Records",stage:"Stage",owner:"Owner",value:"Sample amount",due:"Target date",
  actions:"Actions",details:"Open full record",back:"Back to register",prev:"Previous",next:"Next",
  operations:"Workstream",progress:"Workflow progression",stageHint:"Each action is a simulation. Production transitions require server-side permissions, approvals and evidence.",
  step:"Step",linked:"Related records",relatedHint:"Jump between fictional records in other modules. No real account or private information is used.",
  activity:"Activity and evidence",activityHint:"Local demo notes and transitions; not a compliance audit trail.",
  overview:"Overview",timeline:"Timeline",relationships:"Relationships",reference:"Reference",
  update:"Simulate next stage",addNote:"Add demo note",history:"Recent activity",none:"No sample records match the filters",
  blocked:"This is a UI simulation only. No emails, invoices, certificates, or approvals are actually issued.",
  createTitle:"Create a fictional record",name:"Record title",company:"Organization (fictional)",amount:"Sample value (optional)",
  titleRequired:"Enter at least 3 characters in each field",note:"Review note",noteHint:"Explain your demo decision (at least 8 characters).",
  confirm:"I understand this action is a simulation without any external effect.",
  save:"Save in this preview",cancel:"Cancel",advance:"Continue simulated workflow",
  added:"Sample record created",changed:"Sample stage updated",noted:"Note recorded in preview",
  error:"Couldn't update the preview",complete:"The scenario reached its last demo stage",
  noRelations:"No linked fictional records in this scenario",noActivity:"No demo activity yet",
  detail:"Workspace",status:"Current state",mockBanner:"PUBLIC DEMO · NOT AN OFFICIAL IOETI RECORD",
  nextAction:"Next simulated action",notImplemented:"Backend contract pending",
  rowCount:"sample records",journey:"Operating journey",scope:"No production data connected",
  allAreas:"Explore adjacent workstreams",
  see:"Open",
};
const ar:typeof en={
 mock:"معاينة تشغيلية ببيانات خيالية",notBackend:"التغييرات هنا في الذاكرة فقط، وتختفي عند تحديث الصفحة.",
 source:"أساس الكود المُعاد استخدامه",search:"ابحث في السجلات التجريبية",all:"كل المراحل",new:"سيناريو جديد",
 records:"السجلات",stage:"المرحلة",owner:"المسؤول",value:"قيمة تجريبية",due:"تاريخ مستهدف",
 actions:"الإجراءات",details:"افتح الملف الكامل",back:"الرجوع للسجل",prev:"السابق",next:"التالي",
 operations:"سير العمل",progress:"مراحل الرحلة",stageHint:"كل إجراء هنا محاكاة فقط؛ التنفيذ الحقيقي يحتاج صلاحيات وموافقات ومستندات مثبتة في الخادم.",
 step:"الخطوة",linked:"السجلات المرتبطة",relatedHint:"تقدر تتنقل بين سجلات خيالية مرتبطة بموديولات تانية؛ لا توجد بيانات عميل حقيقية.",
 activity:"الأنشطة والأدلة",activityHint:"ملاحظات وتحولات محلية؛ ليست سجل تدقيق قانونيًا أو تشغيليًا معتمدًا.",
 overview:"نظرة عامة",timeline:"الأنشطة",relationships:"العلاقات",reference:"المرجع",
 update:"محاكاة المرحلة التالية",addNote:"أضف ملاحظة تجريبية",history:"آخر الأنشطة",none:"لا توجد سيناريوهات مطابقة للبحث",
 blocked:"دي محاكاة واجهة فقط. مش هيتم إرسال رسائل أو إصدار فواتير أو شهادات أو اعتماد أي قرار.",
 createTitle:"إنشاء سجل تجريبي",name:"عنوان السجل",company:"الجهة (خيالية)",amount:"قيمة تجريبية (اختياري)",
 titleRequired:"اكتب على الأقل 3 حروف في كل حقل",note:"ملاحظة المراجعة",noteHint:"اكتب سببًا واضحًا للمحاكاة لا يقل عن 8 حروف.",
 confirm:"أفهم أن الإجراء ده محاكاة ولا ينتج عنه أي تأثير خارجي.",
 save:"احفظ داخل المعاينة",cancel:"إلغاء",advance:"اكمل الرحلة التجريبية",
 added:"اتضاف السيناريو التجريبي",changed:"اتحدثت المرحلة التجريبية",noted:"اتسجلت ملاحظتك داخل المعاينة",
 error:"تعذر تحديث المعاينة",complete:"وصل السيناريو لآخر مرحلة في المحاكاة",
 noRelations:"لا توجد سجلات خيالية مرتبطة بهذا السيناريو",noActivity:"لسه مفيش أنشطة تجريبية",
 detail:"ملف التشغيل",status:"الحالة الحالية",mockBanner:"DEMO عام · ليس سجلًا رسميًا في IOETI",
 nextAction:"الإجراء التجريبي التالي",notImplemented:"عقد الـBackend لم ينفذ بعد",
 rowCount:"سجلًا تجريبيًا",journey:"رحلة التشغيل",scope:"غير متصل ببيانات إنتاج حقيقية",
 allAreas:"استعرض مسارات العمل المرتبطة",
 see:"افتح",
};
function money(value:number|null,language:Language){
 if(value===null)return "—";
 return new Intl.NumberFormat(language==="ar"?"ar-EG":"en-EG",{maximumFractionDigits:0}).format(value)+" EGP";
}
function stageOf(row:DemoRecord,language:Language){const s=demoConfigs[row.area].stages[row.stage];return s[language];}
function formatDate(value:string,language:Language){
 return new Intl.DateTimeFormat(language==="ar"?"ar-EG":"en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(value+"T12:00:00Z"));
}
export default function DemoBusinessWorkspace({area,language,onNavigateArea}:Props){
 // No sample data is rendered into a real connected session.
 if(!DEMO_MODE)return null;
 return <DemoBusinessInner area={area} language={language} onNavigateArea={onNavigateArea}/>;
}
function DemoBusinessInner({area,language,onNavigateArea}:Props){
 useSyncExternalStore(demoBusinessStore.subscribe,demoBusinessStore.getRevision);
 const [selectedId,setSelectedId]=useState<number|null>(null);
 const [query,setQuery]=useState("");
 const [stageFilter,setStageFilter]=useState("all");
 const [tab,setTab]=useState<"overview"|"timeline"|"relationships">("overview");
 const [dialog,setDialog]=useState<DialogKind|null>(null);
 const [title,setTitle]=useState(""),[company,setCompany]=useState(""),[amount,setAmount]=useState("");
 const [note,setNote]=useState(""),[confirmed,setConfirmed]=useState(false);
 const [error,setError]=useState(""),[notice,setNotice]=useState("");
 const titleRef=useRef<HTMLHeadingElement>(null),dialogRef=useRef<HTMLElement>(null),returnRef=useRef<HTMLButtonElement|null>(null);
 const strings=language==="ar"?ar:en,config=demoConfigs[area],rtl=language==="ar";
 const Back=rtl?ArrowRight:ArrowLeft,Forward=rtl?ArrowLeft:ArrowRight;
 const root=DEMO_AREAS.includes(area) ? (["certification","learning","recruiting","fundraising"].includes(area)
  ? "#/"+({certification:"certification",learning:"training",recruiting:"recruitment",fundraising:"fundraising"} as Record<string,string>)[area]
  : area === "admin" ? "#/settings" : "#/demo/"+area):"#/demo/quotes";
 const all=demoBusinessStore.list(area);
 const visible=useMemo(()=>all.filter(row=>{
  if(stageFilter!=="all" && row.stage!==Number(stageFilter))return false;
  const term=query.trim().toLocaleLowerCase();
  return !term||[row.titleAr,row.titleEn,row.company,row.owner,String(row.id)].some(v=>v.toLocaleLowerCase().includes(term));
 }),[area,query,stageFilter,all.length,demoBusinessStore.getRevision()]);
 const record=selectedId===null?null:demoBusinessStore.get(area,selectedId);
 const selectedIndex=record?visible.findIndex(row=>row.id===record.id):-1;
 const countByStage=config.stages.map((_,i)=>all.filter(row=>row.stage===i).length);
 function sync(){
  const path=window.location.hash;
  const suffix=path.startsWith(root+"/")?path.slice(root.length+1):"";
  const id=/^\d+$/.test(suffix)?Number(suffix):null;
  setSelectedId(id);setTab("overview");
 }
 useEffect(()=>{
  sync();
  window.addEventListener("hashchange",sync);window.addEventListener("popstate",sync);
  return()=>{window.removeEventListener("hashchange",sync);window.removeEventListener("popstate",sync);};
 },[area,root]);
 useEffect(()=>{titleRef.current?.focus();},[selectedId,area]);
 useEffect(()=>{
  if(!dialog)return;
  const first=dialogRef.current?.querySelector<HTMLElement>("input:not([disabled]),textarea:not([disabled]),button:not([disabled])");
  first?.focus();
  return()=>returnRef.current?.focus();
 },[dialog]);
 const open=(id:number)=>{
  setError("");setNotice("");setSelectedId(id);setTab("overview");
  window.history.pushState({ioetiDemo:true,area,id},"",root+"/"+id);
  window.scrollTo({top:0,behavior:"instant"});
 };
 const back=()=>{
  setSelectedId(null);setError("");setNotice("");
  if(window.history.state?.ioetiDemo)window.history.back();
  else window.history.replaceState(null,"",root);
 };
 function openDialog(next:DialogKind,button:HTMLButtonElement){
  returnRef.current=button;setError("");setNote("");setConfirmed(false);
  setTitle("");setCompany("");setAmount("");setDialog(next);
 }
 function keydown(e:KeyboardEvent<HTMLElement>){
  if(e.key==="Escape"){e.stopPropagation();setDialog(null);return;}
  if(e.key!=="Tab"||!dialogRef.current)return;
  const nodes=Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled])'))
   .filter(x=>x.getClientRects().length>0);
  if(!nodes.length)return;
  const first=nodes[0],last=nodes[nodes.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
 }
 function save(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setError("");
  try{
   if(dialog==="create"){
    if(title.trim().length<3||company.trim().length<3)throw Error(strings.titleRequired);
    if(amount.trim()&&(!Number.isFinite(Number(amount))||Number(amount)<0))throw Error(strings.error);
    const made=demoBusinessStore.create(area,title,company,amount.trim()?Number(amount):null);
    setDialog(null);setNotice(strings.added);open(made.id);
   }else if(record&&dialog==="advance"){
    if(!confirmed)throw Error(strings.confirm);
    demoBusinessStore.transition(area,record.id,record.version,note);
    setDialog(null);setNotice(strings.changed);
   }else if(record&&dialog==="note"){
    demoBusinessStore.comment(area,record.id,record.version,note);
    setDialog(null);setNotice(strings.noted);setTab("timeline");
   }
  }catch(ex){setError(ex instanceof Error?ex.message:strings.error);}
 }
 const pageHeader=<div className="demo-workspace-heading">
   <div><span className="eyebrow"><Sparkles size={15}/>{strings.mock} · {config.source}</span>
    <h1 ref={titleRef} tabIndex={-1}>{config[language]}</h1>
    <p>{config[language==="ar"?"subtitleAr":"subtitleEn"]}</p></div>
   <span className="demo-isolation-chip"><LockKeyhole size={15}/>{strings.scope}</span>
 </div>;
 return <section className="page-enter demo-business" aria-label={config[language]}>
  {record?<div className="demo-detail-view">
    <div className="record-context-bar">
      <button type="button" className="record-back" onClick={back}><Back size={17}/>{strings.back}</button>
      <span className="record-context-separator">/</span><span className="record-current">{record[language==="ar"?"titleAr":"titleEn"]}</span>
    </div>
    <div className="demo-record-hero">
      <div><span className="eyebrow"><BadgeCheck size={16}/>{strings.mockBanner}</span>
        <h1 tabIndex={-1} ref={titleRef}>{record[language==="ar"?"titleAr":"titleEn"]}</h1>
        <div className="demo-meta-line"><span>{record.company}</span><span dir="ltr">DEMO-{record.id}</span><span>{stageOf(record,language)}</span></div>
        <p>{record[language==="ar"?"descriptionAr":"descriptionEn"]}</p>
      </div>
      <div className="demo-hero-actionstack">
        <button type="button" className="btn btn-primary" disabled={record.stage>=config.stages.length-1} onClick={e=>openDialog("advance",e.currentTarget)}><Workflow size={17}/>{strings.update}</button>
        <button type="button" className="btn btn-secondary" onClick={e=>openDialog("note",e.currentTarget)}><MessageSquarePlus size={17}/>{strings.addNote}</button>
        <div className="record-paging">
          <button className="btn btn-secondary" type="button" disabled={selectedIndex<=0} onClick={()=>open(visible[selectedIndex-1].id)}>{rtl?<ChevronRight size={15}/>:<ChevronLeft size={15}/>} {strings.prev}</button>
          <button className="btn btn-secondary" type="button" disabled={selectedIndex<0||selectedIndex>=visible.length-1} onClick={()=>open(visible[selectedIndex+1].id)}>{strings.next} {rtl?<ChevronLeft size={15}/>:<ChevronRight size={15}/>}</button>
        </div>
      </div>
    </div>
    <div className="demo-record-tabs" role="tablist" aria-label={strings.detail}>
      {(["overview","timeline","relationships"] as const).map(key=><button key={key} role="tab" aria-selected={tab===key} onClick={()=>setTab(key)} className={tab===key?"active":""} type="button">
        {key==="overview"?strings.overview:key==="timeline"?strings.timeline:strings.relationships}
      </button>)}
    </div>
    {notice&&<div role="status" className="demo-notice"><CheckCircle2 size={17}/>{notice}</div>}
    <div className="demo-tab-panel" role="tabpanel">
      {tab==="overview"&&<>
        <div className="demo-detail-grid">
          <div className="demo-panel">
            <div className="demo-section-heading"><span className="record-section-icon"><Workflow size={20}/></span><div><h2>{strings.progress}</h2><p>{strings.stageHint}</p></div></div>
            <ol className="demo-vertical-timeline">{config.stages.map((step,i)=><li key={i} className={i<record.stage?"done":i===record.stage?"current":""}>
              <span className="demo-timeline-bullet">{i<record.stage?<Check size={15}/>:String(i+1).padStart(2,"0")}</span>
              <div><strong>{step[language]}</strong><small>{i<record.stage?(rtl?"مرحلة تجريبية سابقة":"Simulated previous stage"):i===record.stage?strings.status:strings.notImplemented}</small></div>
            </li>)}</ol>
          </div>
          <div className="demo-panel">
            <div className="demo-section-heading"><span className="record-section-icon"><ClipboardList size={20}/></span><div><h2>{strings.overview}</h2><p>{strings.notBackend}</p></div></div>
            <dl className="demo-record-facts">
             <div><dt>{strings.reference}</dt><dd dir="ltr">DEMO-{record.id}</dd></div>
             <div><dt>{strings.stage}</dt><dd>{stageOf(record,language)}</dd></div>
             <div><dt>{strings.owner}</dt><dd>{record.owner}</dd></div>
             <div><dt>{strings.due}</dt><dd>{formatDate(record.due,language)}</dd></div>
             <div><dt>{strings.value}</dt><dd dir="ltr">{money(record.value,language)}</dd></div>
             <div><dt>Version</dt><dd dir="ltr">v{record.version}</dd></div>
            </dl>
            <div className="demo-security-note"><ShieldAlert size={17}/><span>{config[language==="ar"?"safeguardsAr":"safeguardsEn"]}</span></div>
          </div>
        </div>
      </>}
      {tab==="timeline"&&<div className="demo-panel demo-wide-panel">
        <div className="demo-section-heading"><span className="record-section-icon"><Clock3 size={20}/></span><div><h2>{strings.activity}</h2><p>{strings.activityHint}</p></div></div>
        {record.activities.length===0?<p>{strings.noActivity}</p>:<ol className="demo-activity-feed">{record.activities.map(x=><li key={x.key}><span className="demo-activity-dot"/><div><strong>{language==="ar"?x.ar:x.en}</strong><small>{x.author} · {formatDate(x.date,language)}</small></div></li>)}</ol>}
      </div>}
      {tab==="relationships"&&<div className="demo-panel demo-wide-panel">
        <div className="demo-section-heading"><span className="record-section-icon"><GitBranch size={20}/></span><div><h2>{strings.linked}</h2><p>{strings.relatedHint}</p></div></div>
        {record.links.length===0?<p>{strings.noRelations}</p>:<div className="demo-relations">
          {record.links.map(link=>{
            const other=demoBusinessStore.get(link.area,link.id);
            if(!other)return null;
            return <button type="button" key={link.area+link.id} className="demo-relation" onClick={()=>onNavigateArea(link.area,link.id)}>
              <span className="record-section-icon"><Layers3 size={20}/></span><span><small>{demoConfigs[link.area][language]} · DEMO-{other.id}</small><strong>{language==="ar"?other.titleAr:other.titleEn}</strong><small>{stageOf(other,language)}</small></span><Forward size={18}/>
            </button>;
          })}
        </div>}
      </div>}
    </div>
    <section className="demo-related-overview">
      <div className="section-top"><div><span className="eyebrow">{strings.journey}</span><h2>{strings.allAreas}</h2></div></div>
      <div className="demo-crosslinks">{record.links.map(link=><button key={link.area+link.id} type="button" onClick={()=>onNavigateArea(link.area,link.id)}><span>{demoConfigs[link.area][language]}</span><Forward size={15}/></button>)}</div>
    </section>
  </div>:<>
   {pageHeader}
   <div className="demo-summary-grid">
     <div className="demo-summary-card"><UsersRound size={21}/><span>{strings.records}</span><strong>{all.length}</strong></div>
     <div className="demo-summary-card"><GitBranch size={21}/><span>{strings.progress}</span><strong>{config.stages.length}</strong></div>
     <div className="demo-summary-card"><Clock3 size={21}/><span>{strings.notImplemented}</span><strong>{all.filter(x=>x.stage<config.stages.length-1).length}</strong></div>
   </div>
   <div className="demo-overview-flow" aria-label={strings.journey}>
    {config.stages.map((step,i)=><button key={i} type="button" onClick={()=>setStageFilter(stageFilter===String(i)?"all":String(i))} className={"demo-flow-step"+(stageFilter===String(i)?" chosen":"")}>
      <span>{String(i+1).padStart(2,"0")}</span><strong>{step[language]}</strong><small>{countByStage[i]} {strings.rowCount}</small>
    </button>)}
   </div>
   <div className="demo-toolbar">
    <label className="search-field"><Search size={18}/><span className="sr-only">{strings.search}</span>
      <input aria-label={strings.search} value={query} onChange={e=>setQuery(e.target.value)} placeholder={strings.search}/></label>
    <label className="demo-filter-label"><Filter size={15}/><span className="sr-only">{strings.stage}</span>
      <select aria-label={strings.stage} value={stageFilter} onChange={e=>setStageFilter(e.target.value)}><option value="all">{strings.all}</option>
        {config.stages.map((step,i)=><option key={i} value={i}>{step[language]}</option>)}</select></label>
    <button className="btn btn-primary" type="button" onClick={e=>openDialog("create",e.currentTarget)}><Plus size={17}/>{strings.new}</button>
   </div>
   <div className="demo-data-panel">
    <div className="demo-data-head"><strong>{strings.records}</strong><span>{visible.length} {strings.rowCount}</span></div>
    {visible.length===0?<div className="empty-state">{strings.none}</div>:<div className="demo-record-list">{visible.map(row=><button key={row.id} type="button" className="demo-record-row" onClick={()=>open(row.id)}>
     <span className="demo-record-monogram"><FileText size={20}/></span>
     <span className="demo-record-primary"><strong>{row[language==="ar"?"titleAr":"titleEn"]}</strong><small>{row.company} · DEMO-{row.id}</small></span>
     <span className="demo-record-stage">{stageOf(row,language)}</span>
     <span className="demo-record-value" dir="ltr">{money(row.value,language)}</span>
     <span className="demo-record-date"><CalendarDays size={14}/>{formatDate(row.due,language)}</span><Forward size={17} className="demo-record-arrow"/>
    </button>)}</div>}
   </div>
   <p className="scope-note"><LockKeyhole size={15}/>{strings.notBackend}</p>
  </>}
  {dialog&&<div className="demo-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setDialog(null);}}>
    <section className="demo-action-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="demo-dialog-title" onKeyDown={keydown}>
      <div className="demo-dialog-heading"><div><span className="eyebrow">{strings.mock}</span>
        <h2 id="demo-dialog-title">{dialog==="create"?strings.createTitle:dialog==="advance"?config[language==="ar"?"actionAr":"actionEn"]:strings.addNote}</h2>
      </div><button type="button" className="icon-button" aria-label={strings.cancel} onClick={()=>setDialog(null)}><X size={18}/></button></div>
      <form onSubmit={save} className="demo-dialog-form">
       {dialog==="create"?<>
         <label>{strings.name}<input required minLength={3} value={title} onChange={e=>setTitle(e.target.value)} /></label>
         <label>{strings.company}<input required minLength={3} value={company} onChange={e=>setCompany(e.target.value)}/></label>
         <label>{strings.amount}<input type="number" min={0} step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
        </>:<>
         {dialog==="advance"&&<div className="demo-decision-review"><span className="eyebrow">{strings.nextAction}</span><strong>{config.stages[Math.min(config.stages.length-1,(record?.stage||0)+1)][language]}</strong><p>{config[language==="ar"?"safeguardsAr":"safeguardsEn"]}</p></div>}
         <label>{strings.note}<textarea rows={4} required minLength={dialog==="advance"?8:3} value={note} onChange={e=>setNote(e.target.value)} placeholder={strings.noteHint}/></label>
         {dialog==="advance"&&<label className="demo-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>{strings.confirm}</span></label>}
        </>}
       {error&&<div className="error-banner" role="alert"><CircleHelp size={16}/>{error}</div>}
       <p className="demo-dialog-caution"><ShieldAlert size={16}/>{strings.blocked}</p>
       <div className="demo-dialog-actions"><button type="button" className="btn btn-secondary" onClick={()=>setDialog(null)}>{strings.cancel}</button>
         <button type="submit" className="btn btn-primary" disabled={dialog==="advance"&&!confirmed}>{dialog==="advance"?strings.advance:strings.save}</button></div>
      </form>
    </section>
  </div>}
 </section>;
}
