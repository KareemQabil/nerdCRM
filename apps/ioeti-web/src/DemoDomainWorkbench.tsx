import { useState } from "react";
import {
  BadgeCheck, Check, CheckCircle2, ClipboardCheck, FileCheck2, FileText,
  GitBranch, LockKeyhole, Plus, ShieldAlert, UserRound, Wallet, Workflow
} from "lucide-react";
import { DEMO_AREAS, demoBusinessStore, demoConfigs, type DemoArea, type DemoRecord } from "./demoBusiness";
import type { Language } from "./preferences";

/** Interactive UX-only controls. They never invoke a server or produce an official document. */
export function DemoDomainWorkbench({area,record,language}:{area:DemoArea;record:DemoRecord;language:Language}){
 const rtl=language==="ar";
 const [units,setUnits]=useState(2),[discount,setDiscount]=useState(0);
 const [checks,setChecks]=useState<Record<string,boolean>>({});
 const [attendees,setAttendees]=useState(6),[present,setPresent]=useState<Record<number,boolean>>({});
 const [shortlist,setShortlist]=useState<Record<number,boolean>>({});
 const [consent,setConsent]=useState(false);
 const [receipt,setReceipt]=useState(0),[receiptInput,setReceiptInput]=useState("1000");
 const [dryRuns,setDryRuns]=useState(0);
 const [role,setRole]=useState("sales");
 const [reportArea,setReportArea]=useState<DemoArea>("quotes");
 const [documentTab,setDocumentTab]=useState(0);
 const title=rtl?"تجربة عملية داخل الملف":"Interactive record workbench";
 const warning=rtl?"المخرجات هنا شكلية للتجربة فقط، ولن تُحفظ أو تُرسل أو تُعتمد في النظام الحقيقي.":"Simulation only. No real data, outbound message, financial entry or certification is created.";
 const stages=demoConfigs[area].stages;
 const format=(amount:number)=>new Intl.NumberFormat("en-EG",{maximumFractionDigits:0}).format(amount)+" EGP";
 const inputNumber=(value:number,onChange:(x:number)=>void,max?:number)=><input type="number" min={0} max={max} value={value}
     onChange={e=>onChange(Math.max(0,Math.min(max??Number.MAX_SAFE_INTEGER,Number(e.target.value)||0)))}/>;
 const fields=(...rows:[string,string][])=>rows.map(([k,v])=><div className="demo-workbench-stat" key={k}><span>{k}</span><strong>{v}</strong></div>);
 const heading=<div className="demo-workbench-heading"><div className="record-section-icon"><Workflow size={21}/></div>
    <div><span className="eyebrow">{rtl?"مساحة محاكاة":"SIMULATION LAB"}</span><h3>{title}</h3></div>
    <span className="demo-workbench-flag"><LockKeyhole size={13}/>{rtl?"غير متصل":"Offline mock"}</span>
  </div>;
 let body:React.ReactNode=null;
 if(area==="quotes"||area==="catalog"){
   const base=area==="quotes"?4200:2500;
   const subtotal=units*base;
   const amount=Math.round(subtotal*(1-discount/100));
   body=<div className="demo-workbench-columns">
     <div className="demo-workbench-card">
       <h4><FileText size={17}/>{rtl?"مُكوّن عرض السعر":"Pricing composition"}</h4>
       <label>{rtl?"وحدات الخدمة":"Service units"}{inputNumber(units,setUnits,100)}</label>
       <label>{rtl?"نسبة الخصم التجريبية":"Simulated discount (%)"}{inputNumber(discount,setDiscount,25)}</label>
       <p>{rtl?"الحساب للشرح فقط؛ مش مربوط بقواعد الضريبة أو اعتماد خصومات Axelor.":"For UX only; not connected to Axelor tax or discount approval rules."}</p>
     </div>
     <div className="demo-workbench-card">
       <h4><Wallet size={17}/>{rtl?"ملخص تسعير توضيحي":"Illustrative price breakdown"}</h4>
       <div className="demo-workbench-stats">
         {fields(rtl?"إجمالي السطور":"Line subtotal",format(subtotal))}
         {fields(rtl?"الخصم":"Discount",format(subtotal-amount))}
         {fields(rtl?"الإجمالي بعد الخصم":"After discount",format(amount))}
       </div>
       <span className="demo-workbench-warning">{rtl?"الضرائب والموافقات والإصدارات: API قيد التنفيذ":"Tax, approvals and versions: backend integration pending"}</span>
     </div>
   </div>;
 }else if(area==="certification"||area==="visits"||area==="quality"){
   const questions=area==="certification"?
   (rtl?["توثيق نطاق العميل","التحقق من كفاءة المدقق","إقرار عدم تعارض المصالح","أدلة Stage 1","أدلة Stage 2 / CAPA","مراجعة فنية مستقلة"]:["Client scope documented","Auditor competence checked","Conflict-of-interest declaration","Stage 1 evidence","Stage 2 / CAPA evidence","Independent technical review"]):
   (rtl?["نطاق المهمة","المواعيد والمسؤوليات","مراجعة قوائم التحقق","الأدلة المرفقة","التحقق المستقل"]:["Task scope","Schedule and ownership","Checklist review","Evidence attached","Independent verification"]);
   const completed=questions.filter((_,i)=>checks[String(i)]).length;
   body=<div className="demo-workbench-columns">
     <div className="demo-workbench-card">
      <h4><ClipboardCheck size={17}/>{rtl?"قائمة تحقق تجريبية":"Fictional audit checklist"}</h4>
      <div className="demo-checks">{questions.map((q,i)=><label key={q}><input type="checkbox" checked={Boolean(checks[String(i)])} onChange={e=>setChecks(old=>({...old,[String(i)]:e.target.checked}))}/><span>{q}</span></label>)}</div>
     </div>
     <div className="demo-workbench-card">
      <h4><ShieldAlert size={17}/>{rtl?"بوابة المراجعة":"Review gate"}</h4>
      <div className="demo-workbench-stats">
       {fields(rtl?"تم التحقق":"Checked",completed+"/"+questions.length)}
       {fields(rtl?"الحالة":"Preview readiness",completed===questions.length?(rtl?"جاهز للعرض فقط":"Preview ready"):(rtl?"غير مكتمل":"Incomplete"))}
      </div>
      <p>{rtl?"حتى لو اكتملت القائمة، إصدار الشهادة قرار مستقل يحتاج صلاحيات وقواعد اعتماد حقيقية.":"Completion does not authorize certification. The independent decision needs real review policies."}</p>
     </div>
   </div>;
 }else if(area==="learning"){
   const capacity=12;
   const n=Array.from({length:attendees},(_,i)=>i+1);
   const attended=n.filter(i=>present[i]).length;
   body=<div className="demo-workbench-columns">
     <div className="demo-workbench-card">
       <h4><UserRound size={17}/>{rtl?"كشف حضور افتراضي":"Fictional attendance register"}</h4>
       <div className="demo-attendees">{n.map(i=><label key={i}><span>{rtl?"متدرب تجريبي":"Sample learner"} {String(i).padStart(2,"0")}</span>
          <input type="checkbox" checked={Boolean(present[i])} onChange={e=>setPresent(old=>({...old,[i]:e.target.checked}))}/></label>)}</div>
       <button className="btn btn-secondary" type="button" disabled={attendees>=capacity} onClick={()=>setAttendees(x=>Math.min(capacity,x+1))}><Plus size={16}/>{rtl?"مقعد افتراضي إضافي":"Add fictional seat"}</button>
     </div>
     <div className="demo-workbench-card"><h4><BadgeCheck size={17}/>{rtl?"التسجيل والحضور":"Cohort capacity"}</h4>
       <div className="demo-workbench-stats">
       {fields(rtl?"المسجلون":"Enrolled",attendees+"/"+capacity)}
       {fields(rtl?"الحاضرون":"Attended",String(attended))}
       {fields(rtl?"الحضور":"Attendance",Math.round(attended/attendees*100)+"%")}
       </div><p>{rtl?"لا يتم إصدار شهادات اجتياز أو دفع رسوم؛ الحضور مجرد محاكاة لتصميم الـMatrix.":"No enrollment fees, assessment pass or valid certificate; the matrix is a UX prototype."}</p>
     </div>
   </div>;
 }else if(area==="recruiting"){
   const candidates=[1,2,3,4];
   body=<div className="demo-workbench-columns">
     <div className="demo-workbench-card"><h4><UserRound size={17}/>{rtl?"القائمة المختصرة":"Fictional shortlist"}</h4>
       <label className="demo-workbench-consent"><input type="checkbox" checked={consent} onChange={e=>{setConsent(e.target.checked);if(!e.target.checked)setShortlist({});}}/>
         <span>{rtl?"أوافق على محاكاة وجود موافقة مشاركة البيانات — وليست موافقة قانونية فعلية":"Simulate explicit candidate-sharing consent; not actual legal consent"}</span></label>
       <div className="demo-attendees">{candidates.map(i=><label key={i}><span>{rtl?"مرشح افتراضي":"Sample candidate"} {String.fromCharCode(64+i)}</span>
         <input disabled={!consent} type="checkbox" checked={Boolean(shortlist[i])} onChange={e=>setShortlist(old=>({...old,[i]:e.target.checked}))}/></label>)}</div>
     </div>
     <div className="demo-workbench-card"><h4><ShieldAlert size={17}/>{rtl?"مراجعة الخصوصية":"Privacy gate"}</h4>
       <div className="demo-workbench-stats">
       {fields(rtl?"مرشحون في القائمة":"Shortlisted",String(candidates.filter(i=>shortlist[i]).length))}
       {fields(rtl?"حالة المحاكاة":"Consent simulation",consent?(rtl?"مُفعلة مؤقتًا":"Temporarily enabled"):(rtl?"متوقفة":"Blocked"))}
       </div><p>{rtl?"السير الذاتية والراتب لا تظهر في الديمو. الخادم الحقيقي لازم يمنع المشاركة دون إذن موثق.":"No CV or salary data is present. Real sharing must require server-verified lawful consent."}</p>
     </div>
   </div>;
 }else if(area==="fundraising"||area==="finance"){
   const pledged=Math.max(0,record.value||75000);
   const remaining=Math.max(0,pledged-receipt);
   body=<div className="demo-workbench-columns">
    <div className="demo-workbench-card"><h4><Wallet size={17}/>{rtl?"تعهد مقابل مبلغ محصل":"Commitment versus collected"}</h4>
      <label>{rtl?"مبلغ محصل للمحاكاة (EGP)":"Fictional receipt (EGP)"}<input type="number" value={receiptInput} min={0} step="100" onChange={e=>setReceiptInput(e.target.value)}/></label>
      <button className="btn btn-secondary" type="button" disabled={!Number.isFinite(Number(receiptInput))||Number(receiptInput)<=0||Number(receiptInput)>remaining}
        onClick={()=>{setReceipt(old=>Math.min(pledged,old+Number(receiptInput)));setReceiptInput("");}}>
        <Check size={16}/>{rtl?"سجل تحصيلًا تجريبيًا":"Record fictional receipt"}</button>
      <p>{rtl?"بدون ربط بنكي، وبدون فاتورة أو إيصال رسمي.":"No bank reconciliation, invoice or real donation receipt."}</p>
    </div>
    <div className="demo-workbench-card"><h4><GitBranch size={17}/>{rtl?"الفصل المحاسبي":"Separate financial states"}</h4>
     <div className="demo-workbench-stats">
       {fields(rtl?"التعهد أو القيمة المستحقة":"Committed / due",format(pledged))}
       {fields(rtl?"محصل تجريبيًا":"Simulated collected",format(receipt))}
       {fields(rtl?"متبقي غير محصل":"Not collected",format(remaining))}
     </div><span className="demo-workbench-warning">{rtl?"القيمة المستحقة ليست إيرادًا نقديًا محققًا":"Commitments are NOT settled cash"}</span>
    </div>
   </div>;
 }else if(area==="automations"){
   body=<div className="demo-workbench-columns">
     <div className="demo-workbench-card"><h4><Workflow size={17}/>{rtl?"معاينة الـRule":"Rule design preview"}</h4>
       <div className="demo-rule-pipeline">{[rtl?"حدث يبدأ القاعدة":"Event trigger",rtl?"فحص الشروط":"Condition check",rtl?"انتظار الموافقة":"Approval gate",rtl?"إنشاء إجراء داخلي":"Internal task"].map((x,i)=><span key={i}>{x}</span>)}</div>
       <button className="btn btn-secondary" type="button" onClick={()=>setDryRuns(n=>n+1)}><Check size={16}/>{rtl?"اختبار جاف (Dry Run)":"Run dry simulation"}</button>
     </div>
     <div className="demo-workbench-card"><h4><FileCheck2 size={17}/>{rtl?"نتائج تجريبية":"Simulated evaluation"}</h4>
       <div className="demo-workbench-stats">{fields(rtl?"مرات الاختبار":"Dry runs",String(dryRuns))}
        {fields(rtl?"رسائل أو Jobs أُرسلت":"Real jobs or messages","0")}</div>
       <p>{rtl?"لا يتم إنشاء Schedule أو Notification على الخادم.":"No actual scheduled jobs or notifications are executed."}</p>
     </div>
   </div>;
 }else if(area==="reports"){
   const series=demoBusinessStore.list(reportArea);
   const counts=demoConfigs[reportArea].stages.map((s,i)=>({...s,count:series.filter(x=>x.stage===i).length}));
   body=<div className="demo-workbench-columns">
     <div className="demo-workbench-card"><h4><GitBranch size={17}/>{rtl?"البيانات القابلة للتصفية":"Source-based fictional breakdown"}</h4>
       <label>{rtl?"المجال":"Domain"}<select value={reportArea} onChange={e=>setReportArea(e.target.value as DemoArea)}>
        {DEMO_AREAS.map(x=><option value={x} key={x}>{demoConfigs[x][language]}</option>)}</select></label>
       <div className="demo-chart">{counts.map((x,i)=><div key={i}>
        <span>{x[language]}</span><div className="demo-chart-track"><i style={{width:(x.count/Math.max(1,series.length)*100)+"%"}}/></div><strong>{x.count}</strong>
       </div>)}</div>
     </div>
     <div className="demo-workbench-card"><h4><ShieldAlert size={17}/>{rtl?"موثوقية المقاييس":"Metric boundaries"}</h4>
      <div className="demo-workbench-stats">{fields(rtl?"عناصر العينة":"Sample rows",String(series.length))}
       {fields(rtl?"الحقول الخاصة":"Real sensitive fields","0")}</div>
      <p>{rtl?"لا تُمثل القيم تحصيلًا أو إيرادات معتمدة. أي تقرير حقيقي سيستخدم API مع صلاحيات صفوف وحقول.":"No reported figure is booked/collected revenue. Real metrics require ACL-filtered backend projections."}</p>
     </div>
   </div>;
 }else if(area==="admin"){
   const roles={sales:rtl?"المبيعات":"Sales",operations:rtl?"التشغيل":"Operations",finance:rtl?"المالية":"Finance",management:rtl?"الإدارة":"Management"};
   body=<div className="demo-workbench-columns">
    <div className="demo-workbench-card"><h4><LockKeyhole size={17}/>{rtl?"معاينة الدور الفعّال":"Effective-role preview"}</h4>
      <label>{rtl?"اختر دورًا افتراضيًا":"Preview a role"}<select value={role} onChange={e=>setRole(e.target.value)}>{Object.entries(roles).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <div className="demo-rule-pipeline">{(role==="sales"?[rtl?"قراءة Leads":"Read leads",rtl?"اقتراح عروض":"Propose quotes"]:role==="finance"?[rtl?"فحص مستحقات":"Review invoices",rtl?"التحقق من التحصيل":"Verify collection"]:role==="operations"?[rtl?"قبول التسليم":"Accept handover",rtl?"جدولة زيارة":"Schedule visit"]:[rtl?"مراجعة الطلبات":"Review requests",rtl?"توزيع الفرق":"Assign teams"]).map((x,i)=><span key={i}>{x}</span>)}</div>
    </div>
    <div className="demo-workbench-card"><h4><ShieldAlert size={17}/>{rtl?"حدود التحكم":"Policy limitation"}</h4>
     <p>{rtl?"تبديل الدور ده بيغير الـPreview المعروضة هنا فقط. مش بيعدل المستخدم الحالي أو صلاحيات Axelor ولا يحمي API.":"This role selector only changes the preview text. It does not update the current user, grant rights or secure any API."}</p>
    </div>
   </div>;
 }else if(area==="documents"){
   const docs=[rtl?"العقد المسودة":"Draft agreement",rtl?"قائمة مراجعة التدقيق":"Audit checklist",rtl?"محضر مراجعة داخلي":"Internal review record"];
   body=<div className="demo-workbench-columns">
    <div className="demo-workbench-card"><h4><FileText size={17}/>{rtl?"أقسام المستندات":"Document sections"}</h4>
      <div className="demo-document-tabs">{docs.map((x,i)=><button className={documentTab===i?"active":""} key={i} type="button" onClick={()=>setDocumentTab(i)}><FileText size={16}/>{x}</button>)}</div>
    </div>
    <div className="demo-workbench-card"><h4><FileCheck2 size={17}/>{rtl?"معاينة المحتوى":"Template preview"}</h4>
      <div className="demo-paper-preview"><strong>IOETI · DEMO</strong><span>{docs[documentTab]}</span><p>{rtl?"محتوى تخيلي بدون ملفات مرفقة أو بيانات عميل شخصية.":"Fictional placeholder only, with no customer files or private content."}</p></div>
     <p>{rtl?"لا يوجد رابط تنزيل حقيقي أو توقيع إلكتروني.":"No actual download link or electronic signature."}</p>
    </div>
   </div>;
 }else{
   body=<div className="demo-workbench-card"><h4><CheckCircle2 size={17}/>{rtl?"مراجعة التقدم":"Delivery review"}</h4>
      <div className="demo-workbench-stats">{fields(rtl?"المرحلة الحالية":"Current stage",stages[record.stage][language])}
       {fields(rtl?"نسخة السجل":"Version","v"+record.version)}</div>
      <p>{rtl?"هذه مساحة توضيحية؛ الإجراء الرسمي يحتاج موافقات وصلاحيات وعلاقات مثبتة.":"Actual execution requires approved policies, linked records and backend authorization."}</p>
   </div>;
 }
 return <section className="demo-workbench" aria-label={title}>
   {heading}
   {body}
   <p className="demo-workbench-foot"><ShieldAlert size={15}/>{warning}</p>
 </section>;
}
