import { useSyncExternalStore } from "react";
import { ArrowLeft, ArrowRight, BarChart3, BriefcaseBusiness, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, GitBranch, ShieldAlert, Sparkles } from "lucide-react";
import type { Language } from "./preferences";
import { DemoGuidedJourneys } from "./DemoGuidedJourneys";
import { DEMO_AREAS, demoBusinessStore, demoConfigs, type DemoArea } from "./demoBusiness";

/** Summary of fictional in-memory scenarios only, not live revenue or activity. */
export default function DemoExecutiveOverview({language,onOpen}:{language:Language;onOpen:(area:DemoArea,id?:number)=>void}){
 useSyncExternalStore(demoBusinessStore.subscribe,demoBusinessStore.getRevision);
 const rtl=language==="ar",Forward=rtl?ChevronLeft:ChevronRight;
 const rows=DEMO_AREAS.flatMap(area=>demoBusinessStore.list(area));
 const underway=rows.filter(r=>r.stage>0&&r.stage<demoConfigs[r.area].stages.length-1);
 const needsReview=rows.filter(r=>r.stage===demoConfigs[r.area].stages.length-2);
 const focus=[
  ...rows.filter(r=>r.area==="certification"&&r.stage>=1),
  ...rows.filter(r=>r.area==="contracts"&&r.stage>=2),
  ...rows.filter(r=>r.area==="learning"&&r.stage>=2),
  ...rows.filter(r=>r.area==="fundraising"&&r.stage>=2),
  ...rows.filter(r=>r.area==="recruiting"&&r.stage>=2)
 ].slice(0,6);
 const lanes:DemoArea[]=["certification","learning","recruiting","fundraising","quotes","contracts","reports","admin","automations","documents"];
 return <section className="demo-executive" aria-label={rtl?"لوحة التحكم التجريبية":"Fictional dashboard"}>
   <div className="demo-exec-head">
     <div><span className="eyebrow"><Sparkles size={15}/>{rtl?"PREVIEW · سيناريوهات افتراضية":"PREVIEW · Fictional scenarios"}</span>
      <h1>{rtl?"مساحة عمل اليوم — ديمو تفاعلي":"Today's workbench — interactive demo"}</h1>
      <p>{rtl?"نظرة تشغيلية مترابطة بين الموديولات، بأرقام خيالية للتجربة فقط. لا توجد بيانات أو عمليات إنتاج حقيقية.":"Connected operating context with simulated data only. No real operations or production metrics."}</p></div>
      <span className="demo-isolation-chip"><ShieldAlert size={15}/>{rtl?"بيانات عامة خيالية":"Fictional public data"}</span>
   </div>
   <DemoGuidedJourneys language={language} onOpen={onOpen}/>
   <div className="demo-exec-metrics">
     {[
       {icon:BriefcaseBusiness,v:rows.length,label:rtl?"ملفات تجريبية":"Fictional records"},
       {icon:GitBranch,v:DEMO_AREAS.length,label:rtl?"مجالات أعمال":"Business workstreams"},
       {icon:CalendarClock,v:underway.length,label:rtl?"سيناريوهات قيد التقدم":"In-progress scenarios"},
       {icon:CheckCircle2,v:needsReview.length,label:rtl?"تحتاج خطوة مراجعة":"Near final review"}
     ].map((x,i)=><div className="demo-exec-metric" key={i}><x.icon size={20}/><strong>{x.v}</strong><span>{x.label}</span></div>)}
   </div>
   <div className="demo-exec-grid">
    <section className="demo-exec-focus">
      <div className="demo-exec-section-head"><div><span className="eyebrow">{rtl?"الاهتمام الآن":"Focus"}</span><h3>{rtl?"ملفات محتاجة متابعة":"Items to review next"}</h3></div><BarChart3 size={18}/></div>
      {focus.map(row=><button className="demo-focus-row" type="button" key={row.area+row.id} onClick={()=>onOpen(row.area,row.id)}>
       <span className="demo-focus-number">{String(row.id).slice(-2)}</span>
       <span><strong>{rtl?row.titleAr:row.titleEn}</strong>
          <small>{demoConfigs[row.area][language]} · {row.company}</small></span>
       <span className="demo-focus-status">{demoConfigs[row.area].stages[row.stage][language]}</span>
       <Forward size={17}/>
      </button>)}
    </section>
    <section className="demo-exec-areas">
     <div className="demo-exec-section-head"><div><span className="eyebrow">{rtl?"استكشف":"Explore"}</span><h3>{rtl?"رحلات الأعمال":"Operating workstreams"}</h3></div><GitBranch size={18}/></div>
     <div className="demo-exec-lanes">
       {lanes.map(area=>{
        const config=demoConfigs[area],group=demoBusinessStore.list(area),fraction=group.reduce((acc,r)=>acc+r.stage/(config.stages.length-1),0)/Math.max(1,group.length);
        return <button className="demo-exec-lane" key={area} type="button" onClick={()=>onOpen(area)}>
         <span className="demo-exec-lane-head"><strong>{config[language]}</strong><span>{group.length}</span></span>
         <span className="demo-exec-track"><i style={{width:Math.round(fraction*100)+"%"}}/></span>
         <span className="demo-exec-lane-foot"><small>{rtl?"تقدم سيناريوهات المعاينة":"Scenario progress only"}</small>{rtl?<ArrowLeft size={15}/>:<ArrowRight size={15}/>}</span>
        </button>;
       })}
     </div>
    </section>
   </div>
 </section>;
}
