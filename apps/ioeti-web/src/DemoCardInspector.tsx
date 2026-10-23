import { useEffect, useRef, useState, type FormEvent, type TouchEvent } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, CircleDot, FileText, Link2, MessageSquarePlus, ShieldCheck, UserRound, X } from "lucide-react";
import type { Language } from "./preferences";
import { demoBusinessStore, demoConfigs, type DemoArea, type DemoRecord } from "./demoBusiness";

type Props = {
  record: DemoRecord;
  language: Language;
  siblings: DemoRecord[];
  onSelect: (id: number) => void;
  onOpen: (id: number) => void;
  onClose: () => void;
  onNavigateArea: (area: DemoArea, id?: number) => void;
};
/** A contextual work surface beside the board, not a full-page modal or a fake wizard. */
export function DemoCardInspector({record,language,siblings,onSelect,onOpen,onClose,onNavigateArea}:Props) {
  const rtl=language==="ar";
  const config=demoConfigs[record.area];
  const headingRef=useRef<HTMLHeadingElement>(null);
  const touchRef=useRef<{x:number;y:number}|null>(null);
  const [intent,setIntent]=useState<"advance"|"note"|null>(null);
  const [rationale,setRationale]=useState("");
  const [confirmed,setConfirmed]=useState(false);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const [expanded,setExpanded]=useState<"links"|"activity"|null>(null);
  const stage=config.stages[record.stage];
  const final=record.stage===config.stages.length-1;
  const nextStage=config.stages[Math.min(record.stage+1,config.stages.length-1)];
  const index=siblings.findIndex(item=>item.id===record.id);
  const Forward=rtl?ArrowLeft:ArrowRight;
  const Previous=rtl?ChevronRight:ChevronLeft;
  const Next=rtl?ChevronLeft:ChevronRight;

  useEffect(()=>{headingRef.current?.focus();},[record.id]);
  useEffect(()=>{
    const handle=(event:KeyboardEvent)=>{
      if(event.key!=="Escape")return;
      if(intent){event.preventDefault();setIntent(null);return;}
      event.preventDefault();onClose();
    };
    document.addEventListener("keydown",handle);
    return()=>document.removeEventListener("keydown",handle);
  },[intent,onClose]);

  function changeIntent(next:"advance"|"note") {
    setIntent(next);setRationale("");setConfirmed(false);setError("");setSuccess("");
  }
  function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setError("");
    try{
      if(intent==="advance"){
        if(!confirmed)throw Error(rtl?"أكد أن الخطوة محاكاة فقط.":"Confirm this is a fictional simulation.");
        demoBusinessStore.transition(record.area,record.id,record.version,rationale);
        setSuccess(rtl?"تم تحديث الكارت داخل الديمو فقط.":"Card updated in the fictional preview.");
      } else if(intent==="note") {
        demoBusinessStore.comment(record.area,record.id,record.version,rationale);
        setSuccess(rtl?"اتضافت الملاحظة للكارت التجريبي.":"Note added to the preview card.");
      }
      setIntent(null);setRationale("");setConfirmed(false);
    }catch(failure){setError(failure instanceof Error?failure.message:(rtl?"تعذر الحفظ.":"Could not save."));}
  }
  function go(direction:-1|1){
    const next=siblings[index+direction];
    if(next){setIntent(null);setError("");setSuccess("");setExpanded(null);onSelect(next.id);}
  }
  function beginTouch(event:TouchEvent<HTMLElement>) {
    if(event.touches.length!==1 || intent)return;
    touchRef.current={x:event.touches[0].clientX,y:event.touches[0].clientY};
  }
  function finishTouch(event:TouchEvent<HTMLElement>) {
    if(!touchRef.current || !event.changedTouches.length)return;
    const dx=event.changedTouches[0].clientX-touchRef.current.x;
    const dy=event.changedTouches[0].clientY-touchRef.current.y;
    touchRef.current=null;
    // Horizontal gestures only on the header, never on text input or scrolling content.
    if(Math.abs(dx)>78&&Math.abs(dx)>Math.abs(dy)*1.65)go((rtl?dx>0:dx<0)?1:-1);
  }
  return <aside className="spatial-inspector" aria-labelledby="spatial-card-title" data-testid="spatial-card-inspector">
    <div className="spatial-inspector-top" onTouchStart={beginTouch} onTouchEnd={finishTouch}>
      <div className="spatial-inspector-overline"><CircleDot size={15}/>
        <span>{rtl?"الكارت اللي بتشتغل عليه":"YOUR ACTIVE CARD"}</span>
        <span className="spatial-fictional">{rtl?"تجريبي":"DEMO"}</span>
      </div>
      <button type="button" className="spatial-close" onClick={onClose} aria-label={rtl?"أغلق مساحة الكارت":"Close card workspace"}><X size={20}/></button>
      <div className="spatial-inspector-identity">
        <div className="spatial-inspector-avatar" aria-hidden="true">{record.company.trim().slice(0,2).toUpperCase()}</div>
        <div><span className="spatial-inspector-client">{record.company}</span>
          <h2 id="spatial-card-title" tabIndex={-1} ref={headingRef}>{rtl?record.titleAr:record.titleEn}</h2>
        </div>
      </div>
      <div className="spatial-inspector-badges">
        <span className="spatial-stage-badge"><span aria-hidden="true"/>{stage[language]}</span>
        <span dir="ltr">DEMO-{record.id}</span>
      </div>
    </div>

    <div className="spatial-inspector-scroll">
      <section className="spatial-main-action" aria-labelledby="spatial-action-title">
        <div className="spatial-section-heading">
          <span className="spatial-eyebrow">{rtl?"الخطوة التالية":"NEXT MEANINGFUL ACTION"}</span>
          <h3 id="spatial-action-title">{final?(rtl?"المرحلة التجريبية مكتملة":"Sample stage complete"):nextStage[language]}</h3>
          <p>{rtl?config.safeguardsAr:config.safeguardsEn}</p>
        </div>
        {!intent&&<div className="spatial-action-row">
          <button className="spatial-primary-action" type="button" disabled={final} onClick={()=>changeIntent("advance")}>
            <Forward size={17}/>{final?(rtl?"آخر مرحلة":"Last stage"):(rtl?"انتقل للمرحلة التالية":"Move to next stage")}
          </button>
          <button className="spatial-secondary-action" type="button" onClick={()=>changeIntent("note")}><MessageSquarePlus size={17}/>{rtl?"ملاحظة":"Note"}</button>
        </div>}
        {intent&&<form className="spatial-action-form" onSubmit={save}>
          <label>{intent==="advance"?(rtl?"سبب النقل للمرحلة الجديدة":"Reason for this stage change"):(rtl?"اكتب ملاحظة":"Add a note")}
            <textarea autoFocus rows={3} minLength={intent==="advance"?8:3} required value={rationale}
              onChange={event=>setRationale(event.target.value)} placeholder={rtl?"اكتب قرارًا واضحًا ومختصرًا...":"Write a clear, concise decision..."} />
          </label>
          {intent==="advance"&&<label className="spatial-confirm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>
            <span>{rtl?"فاهم إن النقل تجريبي ومش بيعتمد أي إجراء رسمي.":"I understand this is fictional, not an official approval."}</span></label>}
          {error&&<p role="alert" className="spatial-action-error">{error}</p>}
          <div className="spatial-action-row">
            <button type="submit" className="spatial-primary-action" disabled={intent==="advance"&&!confirmed}>
              <CheckCircle2 size={16}/>{rtl?"حفظ التغيير":"Save change"}
            </button>
            <button type="button" className="spatial-secondary-action" onClick={()=>setIntent(null)}>{rtl?"إلغاء":"Cancel"}</button>
          </div>
        </form>}
        {success&&<div className="spatial-success" role="status"><CheckCircle2 size={16}/>{success}</div>}
      </section>

      <div className="spatial-details-divider"><span>{rtl?"المعلومات اللي تهمك دلوقتي":"THE ESSENTIAL CONTEXT"}</span></div>
      <dl className="spatial-facts">
        <div><dt><UserRound size={15}/>{rtl?"المسؤول":"Owner"}</dt><dd>{record.owner}</dd></div>
        <div><dt><CalendarDays size={15}/>{rtl?"الموعد":"Due date"}</dt><dd>{record.due}</dd></div>
        <div><dt><FileText size={15}/>{rtl?"نسخة السجل":"Version"}</dt><dd dir="ltr">v{record.version}</dd></div>
        {record.value!==null&&<div><dt>{rtl?"القيمة التجريبية":"Sample value"}</dt><dd dir="ltr">{new Intl.NumberFormat("en-EG").format(record.value)} EGP</dd></div>}
      </dl>

      <div className="spatial-context-folds">
        <section className="spatial-fold">
          <button type="button" aria-expanded={expanded==="links"} onClick={()=>setExpanded(x=>x==="links"?null:"links")}>
            <Link2 size={17}/><span>{rtl?"ملفات مرتبطة":"Related records"}</span><b>{record.links.length}</b><Forward size={15}/>
          </button>
          {expanded==="links"&&<div className="spatial-fold-content">
            {record.links.length?record.links.map(link=><button type="button" key={link.area+":"+link.id}
              onClick={()=>onNavigateArea(link.area,link.id)}>
              <span>{demoConfigs[link.area][language]}</span>
              <small dir="ltr">DEMO-{link.id}</small><Forward size={14}/>
            </button>):<p>{rtl?"لا يوجد ملف مرتبط بهذا الكارت.":"No linked records for this card."}</p>}
          </div>}
        </section>
        <section className="spatial-fold">
          <button type="button" aria-expanded={expanded==="activity"} onClick={()=>setExpanded(x=>x==="activity"?null:"activity")}>
            <MessageSquarePlus size={17}/><span>{rtl?"التحديثات والملاحظات":"Updates and notes"}</span><b>{record.activities.length}</b><Forward size={15}/>
          </button>
          {expanded==="activity"&&<ol className="spatial-activity">
            {record.activities.length?record.activities.slice(0,5).map(activity=><li key={activity.key}>
              <strong>{rtl?activity.ar:activity.en}</strong><small>{activity.author} · {activity.date}</small>
            </li>):<li>{rtl?"لا توجد تحديثات بعد.":"No updates yet."}</li>}
          </ol>}
        </section>
      </div>
      <p className="spatial-privacy"><ShieldCheck size={17}/>{rtl?"البيانات خيالية والتعديلات في الذاكرة فقط. افتح الملف الكامل للتفاصيل الأخرى.":"Fictional records, in-memory changes only. Open the full record for additional context."}</p>
    </div>

    <footer className="spatial-footer">
      <div className="spatial-paging" role="group" aria-label={rtl?"التنقل بين الكروت":"Navigate cards"}>
        <button type="button" onClick={()=>go(-1)} disabled={index<=0} aria-label={rtl?"الكارت السابق":"Previous card"}><Previous size={19}/></button>
        <span dir="ltr">{Math.max(0,index+1)} / {siblings.length}</span>
        <button type="button" onClick={()=>go(1)} disabled={index<0||index>=siblings.length-1}
          aria-label={rtl?"الكارت التالي":"Next card"}><Next size={19}/></button>
      </div>
      <button type="button" className="spatial-open-record" onClick={()=>onOpen(record.id)}>
        {rtl?"افتح الملف الكامل":"Open full record"}<Forward size={17}/>
      </button>
    </footer>
  </aside>;
}
