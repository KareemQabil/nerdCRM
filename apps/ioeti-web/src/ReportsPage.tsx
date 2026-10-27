import { useCallback, useEffect, useState } from "react";
import { BarChart3, CircleAlert, Download, LockKeyhole } from "lucide-react";
import { ApiError, getBusinessLines, type BusinessLine } from "./api";
import { download, getAreasReport, getSalesReport, toCsv, type AreasReport, type SalesReport } from "./reportsApi";
import type { Language } from "./preferences";
import "./insights.css";

const strings = {
  ar: {
    title:"التقارير",sub:"أرقام محسوبة على الخادم من السجلات الفعلية التي تملك صلاحية قراءتها فقط. ما لا تملك صلاحيته لا يظهر.",
    from:"من",to:"إلى",line:"خط العمل",all:"الكل",csv:"تصدير CSV",
    pipeline:"خط المبيعات حسب المرحلة",stage:"المرحلة",count:"العدد",amount:"القيمة المتوقعة (لكل عملة)",open:"مفتوحة",closed:"مغلقة",
    amountNote:"القيم المتوقعة التي يسجلها مندوبو المبيعات، لكل عملة على حدة؛ ليست إيرادًا ولا تُجمع عبر العملات.",
    leads:"العملاء المحتملون حسب المصدر",source:"المصدر",noSource:"بدون مصدر",total:"الإجمالي",converted:"تم تحويلهم",lost:"خسارة",rate:"نسبة التحويل",
    campaigns:"الحملات",campaign:"الحملة",attributed:"عملاء محتملون مرتبطون",followUps:"متابعاتي",planned:"مخططة",overdue:"متأخرة",done:"تمت آخر 30 يومًا",
    areas:"السجلات في كل قسم",notPermitted:"لا تظهر الأقسام التي لا تملك صلاحية قراءتها.",empty:"لا توجد بيانات في هذه الفترة",
    keys:{TRAINING_ENROLLMENTS:"تسجيلات التدريب",CERTIFICATION_CYCLES:"دورات الاعتماد",JOB_ORDERS:"طلبات التوظيف",APPLICATIONS:"طلبات المرشحين",PLACEMENTS:"التعيينات",HANDOVERS:"طلبات التسليم",ENGAGEMENTS:"المشروعات التنفيذية",FUNDING_OPPORTUNITIES:"فرص التمويل"},
    errors:{BEFORE_START:"تاريخ النهاية قبل البداية.",TOO_LONG:"أقصى فترة خمس سنوات.",FORMAT:"تاريخ غير صحيح.",denied:"ليست لديك صلاحية.",failed:"تعذّر تحميل التقرير."},
  },
  en: {
    title:"Reports",sub:"Figures computed on the server from the real records you may read. What you may not read is left out.",
    from:"From",to:"To",line:"Business line",all:"All",csv:"Export CSV",
    pipeline:"Pipeline by stage",stage:"Stage",count:"Count",amount:"Expected value (per currency)",open:"Open",closed:"Closed",
    amountNote:"Expected values entered by salespeople, per currency; not revenue, and never added across currencies.",
    leads:"Leads by source",source:"Source",noSource:"No source",total:"Total",converted:"Converted",lost:"Lost",rate:"Conversion",
    campaigns:"Campaigns",campaign:"Campaign",attributed:"Attributed leads",followUps:"My follow-ups",planned:"Planned",overdue:"Overdue",done:"Done, last 30 days",
    areas:"Records in each area",notPermitted:"Areas you may not read are not shown.",empty:"No data in this period",
    keys:{TRAINING_ENROLLMENTS:"Training enrolments",CERTIFICATION_CYCLES:"Certification cycles",JOB_ORDERS:"Job orders",APPLICATIONS:"Candidate applications",PLACEMENTS:"Placements",HANDOVERS:"Handovers",ENGAGEMENTS:"Engagements",FUNDING_OPPORTUNITIES:"Funding opportunities"},
    errors:{BEFORE_START:"The end is before the start.",TOO_LONG:"Use at most five years.",FORMAT:"Invalid date.",denied:"You do not have permission.",failed:"The report could not be loaded."},
  },
} as const;
type Labels = typeof strings.ar | typeof strings.en;

function message(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.errors.failed;
  const code = error.fields[0]?.code;
  if (code && (l.errors as Record<string, string>)[code]) return (l.errors as Record<string, string>)[code];
  if (error.statusCode === 403) return l.errors.denied;
  return l.errors.failed;
}
const num = (v: number) => v.toLocaleString("en-US");
const money = (v: string | number) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (part: number, whole: number) => whole === 0 ? "—" : `${Math.round(part * 100 / whole)}%`;

export function ReportsPage({language}:{language:Language}){
  const l=strings[language];
  const ar=language==="ar";
  const [from,setFrom]=useState("");
  const [to,setTo]=useState("");
  const [line,setLine]=useState("");
  const [lines,setLines]=useState<BusinessLine[]>([]);
  const [sales,setSales]=useState<SalesReport|null>(null);
  const [areas,setAreas]=useState<AreasReport|null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{void getBusinessLines().then(setLines).catch(()=>{});},[]);
  const load=useCallback(async()=>{
    setError("");
    try{
      const [s,a]=await Promise.all([getSalesReport(from,to,line||undefined),getAreasReport(from,to)]);
      setSales(s);setAreas(a);
    }catch(e){setError(message(e,l));}
  },[from,to,line,l]);
  useEffect(()=>{void load();},[load]);
  const maxCount=Math.max(1,...(sales?.pipeline??[]).map(r=>r.count));
  const suffix=`${from||"start"}_${to||"today"}`;
  return <section className="page-enter rp-page">
    <div className="page-title"><span className="eyebrow"><BarChart3 size={14}/> IOETI</span><h1>{l.title}</h1><p>{l.sub}</p></div>
    <div className="mk-filters">
      <label><span>{l.from}</span><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
      <label><span>{l.to}</span><input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
      <label><span>{l.line}</span><select value={line} onChange={e=>setLine(e.target.value)}><option value="">{l.all}</option>
        {lines.map(b=><option key={b.code} value={b.code}>{ar?b.nameAr:b.nameEn}</option>)}</select></label>
    </div>
    {error&&<p className="mk-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    {sales?.pipeline&&<section className="rp-card" aria-labelledby="rp-pipeline">
      <div className="rp-head"><h2 id="rp-pipeline">{l.pipeline}</h2>
        <button type="button" className="btn btn-secondary" disabled={sales.pipeline.length===0} onClick={()=>download(`pipeline_${suffix}.csv`,toCsv([l.line,l.stage,l.count,l.amount],
          sales.pipeline!.map(r=>[r.businessLineCode,r.stage,r.count,r.amounts.map(a=>`${money(a.amount)} ${a.currency??""}`).join(" | ")])))}><Download size={15}/>{l.csv}</button></div>
      {sales.pipeline.length===0?<p className="wf-muted">{l.empty}</p>:<div className="rp-scroll"><table className="rp-table">
        <thead><tr><th>{l.line}</th><th>{l.stage}</th><th>{l.count}</th><th>{l.amount}</th></tr></thead>
        <tbody>{sales.pipeline.map((r,i)=><tr key={i}><td>{r.businessLineCode??"—"}</td><td>{r.stage??"—"}{r.open===false?<small className="mk-sub">{l.closed}</small>:null}</td>
          <td><span className="rp-bar" style={{inlineSize:`${Math.round(r.count*100/maxCount)}%`}} aria-hidden="true"/>{num(r.count)}</td>
          <td dir="ltr">{r.amounts.length===0?"—":r.amounts.map(a=><div key={a.currency??"-"}>{money(a.amount)} {a.currency??""}</div>)}</td></tr>)}</tbody></table></div>}
      <p className="wf-muted">{l.amountNote}</p>
    </section>}
    {sales?.leads&&<section className="rp-card" aria-labelledby="rp-leads">
      <div className="rp-head"><h2 id="rp-leads">{l.leads}</h2>
        <button type="button" className="btn btn-secondary" disabled={sales.leads.bySource.length===0} onClick={()=>download(`leads_${suffix}.csv`,toCsv([l.source,l.total,l.open,l.converted,l.lost],
          sales.leads!.bySource.map(r=>[r.source??l.noSource,r.total,r.open,r.converted,r.lost])))}><Download size={15}/>{l.csv}</button></div>
      <ul className="wf-cards"><li><div><strong>{num(sales.leads.total)}</strong><span>{l.total}</span></div></li><li><div><strong>{num(sales.leads.open)}</strong><span>{l.open}</span></div></li>
        <li><div><strong>{num(sales.leads.converted)}</strong><span>{l.converted}</span></div></li><li><div><strong>{num(sales.leads.lost)}</strong><span>{l.lost}</span></div></li>
        <li><div><strong>{pct(sales.leads.converted,sales.leads.total)}</strong><span>{l.rate}</span></div></li></ul>
      {sales.leads.bySource.length>0&&<div className="rp-scroll"><table className="rp-table"><thead><tr><th>{l.source}</th><th>{l.total}</th><th>{l.open}</th><th>{l.converted}</th><th>{l.lost}</th><th>{l.rate}</th></tr></thead>
        <tbody>{sales.leads.bySource.map((r,i)=><tr key={i}><td>{r.source??l.noSource}</td><td>{num(r.total)}</td><td>{num(r.open)}</td><td>{num(r.converted)}</td><td>{num(r.lost)}</td><td>{pct(r.converted,r.total)}</td></tr>)}</tbody></table></div>}
    </section>}
    {sales?.campaigns&&<section className="rp-card" aria-labelledby="rp-campaigns"><h2 id="rp-campaigns">{l.campaigns}</h2>
      {sales.campaigns.length===0?<p className="wf-muted">{l.empty}</p>:<div className="rp-scroll"><table className="rp-table"><thead><tr><th>{l.campaign}</th><th>{l.attributed}</th></tr></thead>
        <tbody>{sales.campaigns.map(c=><tr key={c.id}><td>{c.name}</td><td>{num(c.leads)}</td></tr>)}</tbody></table></div>}
    </section>}
    {sales?.followUps&&<section className="rp-card" aria-labelledby="rp-followups"><h2 id="rp-followups">{l.followUps}</h2>
      <ul className="wf-cards"><li><div><strong>{num(sales.followUps.planned)}</strong><span>{l.planned}</span></div></li>
        <li><div><strong>{num(sales.followUps.overdue)}</strong><span>{l.overdue}</span></div></li>
        <li><div><strong>{num(sales.followUps.doneLast30Days)}</strong><span>{l.done}</span></div></li></ul>
    </section>}
    {areas&&<section className="rp-card" aria-labelledby="rp-areas"><h2 id="rp-areas">{l.areas}</h2>
      {areas.areas.length===0?<p className="wf-muted">{l.notPermitted}</p>:
      <ul className="wf-cards">{areas.areas.map(a=><li key={a.key}><div><strong>{num(a.count)}</strong><span>{(l.keys as Record<string,string>)[a.key]??a.key}</span></div></li>)}</ul>}
      <p className="wf-muted"><LockKeyhole size={13}/> {l.notPermitted}</p>
    </section>}
  </section>;
}
