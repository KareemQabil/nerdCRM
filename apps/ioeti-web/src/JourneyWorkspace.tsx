import { useState, type ReactNode } from "react";
import {
  ArrowLeft, ArrowRight, BadgeCheck, BookOpenCheck, Building2, Check,
  ClipboardCheck, Compass, CreditCard, GraduationCap, HeartHandshake,
  Layers3, ListTodo, Map, PanelTop, Route, Search, ShieldCheck,
  Sparkles, UsersRound, Workflow
} from "lucide-react";
import type { Language } from "./preferences";
export type Page = "home" | "businessLines" | "opportunities" | "leads" | "accounts" | "capabilities" | "design" | "atlas";
export type PhaseId = "attract" | "understand" | "propose" | "fulfill" | "retain" | "operate";
export type JourneyItem = {
  key: string; ar: string; en: string; descAr: string; descEn: string;
  page?: Page; availability: "connected" | "mapped"; icon: typeof Search;
};
export type Phase = { id: PhaseId; ar: string; en: string; questionAr: string; questionEn: string; icon: typeof Search; items: JourneyItem[] };

export const phases: Phase[] = [
  { id:"attract",ar:"اجذب",en:"Attract",questionAr:"من أين تأتي الفرص؟",questionEn:"Where does demand start?",icon:Sparkles,items:[
    {key:"leads",ar:"صندوق العملاء المحتملين",en:"Lead inbox",descAr:"استعرض الطلبات وأسباب التواصل ومصدرها",descEn:"Review prospective inquiries and qualification",page:"leads",availability:"connected",icon:UsersRound},
    {key:"campaigns",ar:"الحملات والتسويق",en:"Campaigns",descAr:"المستهدفون والمصادر ونسب التحويل",descEn:"Targets, sources and attribution",availability:"mapped",icon:Sparkles},
    {key:"sources",ar:"القنوات والإحالات",en:"Channels & referrals",descAr:"استقبال وتوحيد بيانات المصادر",descEn:"Intake and dedup across channels",availability:"mapped",icon:Search},
  ]},
  { id:"understand",ar:"افهم",en:"Understand",questionAr:"من العميل، وما احتياجه؟",questionEn:"Who needs what, and why?",icon:Building2,items:[
    {key:"accounts",ar:"الحسابات والعلاقات",en:"Accounts & relationships",descAr:"الشركات والاتصالات والجهات التابعة",descEn:"Companies, contacts and hierarchy",page:"accounts",availability:"connected",icon:Building2},
    {key:"opportunities",ar:"الفرص التجارية",en:"Opportunities",descAr:"الاحتياج والحالة وصاحب الفرصة",descEn:"Need, stage and accountable owner",page:"opportunities",availability:"connected",icon:Workflow},
    {key:"qualify",ar:"التأهيل والتوزيع",en:"Qualification & routing",descAr:"الأهلية والـSLA وتوجيه الحالات",descEn:"Fit, SLA and assignment",availability:"mapped",icon:ClipboardCheck},
  ]},
  { id:"propose",ar:"اعرض",en:"Propose",questionAr:"كيف تتحول الفرصة لاتفاق؟",questionEn:"How does a deal become an agreement?",icon:Layers3,items:[
    {key:"catalog",ar:"كتالوج الخدمات",en:"Service catalog",descAr:"الخدمات والبرامج وباقات الأسعار",descEn:"Services, delivery models and pricing",availability:"mapped",icon:Layers3},
    {key:"quotation",ar:"عروض الأسعار والموافقات",en:"Quotes & approvals",descAr:"نسخ العروض والصلاحيات والخصم",descEn:"Quote versions, approvals and discounts",availability:"mapped",icon:BookOpenCheck},
    {key:"contracts",ar:"العقود والاتفاقيات",en:"Contracts & MOUs",descAr:"المراجعة والتوقيع والتجديد",descEn:"Legal review, sign-off and renewal",availability:"mapped",icon:ClipboardCheck},
  ]},
  { id:"fulfill",ar:"نفّذ",en:"Deliver",questionAr:"كيف ننفّذ الخدمة بلا فقد تفاصيل؟",questionEn:"How do we deliver with traceability?",icon:Route,items:[
    {key:"handover",ar:"تسليم المبيعات للتنفيذ",en:"Handover & engagement",descAr:"العقد والمدفوعات وخطة التسليم",descEn:"Contracts, milestones and execution plan",availability:"mapped",icon:ListTodo},
    {key:"iso",ar:"التدقيق وشهادات ISO",en:"ISO certification",descAr:"Stage 1/2 وقرار الشهادة والمراقبة",descEn:"Stage 1/2, independent decision and surveillance",availability:"mapped",icon:BadgeCheck},
    {key:"training",ar:"التدريب الخارجي",en:"External training",descAr:"المجموعات والحضور والتقييم والشهادات",descEn:"Cohorts, attendance, assessments and certificates",availability:"mapped",icon:GraduationCap},
    {key:"recruitment",ar:"التوظيف للعملاء",en:"Client recruitment",descAr:"طلبات التوظيف والترشيحات والتعيين",descEn:"Job orders, submissions and placement",availability:"mapped",icon:UsersRound},
  ]},
  { id:"retain",ar:"نمِّ",en:"Grow",questionAr:"كيف نضمن الاستمرارية والتحصيل؟",questionEn:"How do we sustain and expand?",icon:HeartHandshake,items:[
    {key:"finance",ar:"الفواتير والتحصيل",en:"Billing & collections",descAr:"استحقاقات ومدفوعات وتسويات",descEn:"Invoices, milestones and receipts",availability:"mapped",icon:CreditCard},
    {key:"renewals",ar:"التجديد والمراقبة",en:"Renewals & surveillance",descAr:"شهادات وعقود وفرص التجديد",descEn:"Certificate and contract renewals",availability:"mapped",icon:BadgeCheck},
    {key:"fundraising",ar:"المانحون وتنمية الموارد",en:"Fundraising",descAr:"المنح والتعهدات والحملات والإيصالات",descEn:"Grants, pledges, campaigns and receipts",availability:"mapped",icon:HeartHandshake},
  ]},
  { id:"operate",ar:"تحكّم",en:"Govern",questionAr:"كيف نضمن جودة القرار وحماية البيانات؟",questionEn:"How do we govern safely?",icon:ShieldCheck,items:[
    {key:"lines",ar:"خطوط الأعمال",en:"Business lines",descAr:"الأنشطة والتوزيع والمسؤوليات",descEn:"Capabilities, lines and ownership",page:"businessLines",availability:"connected",icon:Layers3},
    {key:"map",ar:"خريطة ما هو موجود والناقص",en:"Source & gap map",descAr:"من كود Axelor إلى رحلة المستخدم",descEn:"Source inventory to real user journeys",page:"atlas",availability:"connected",icon:Map},
    {key:"ux",ar:"تجربة العرض والثيمات",en:"Experience settings",descAr:"المظهر والكثافة واتجاه اللغة",descEn:"Theme, density and language",page:"design",availability:"connected",icon:PanelTop},
    {key:"security",ar:"الفرق والصلاحيات والأتمتة",en:"Roles, audit & automation",descAr:"صلاحيات وعمليات وجدولة وتتبّع",descEn:"Permissions, workflow and auditability",availability:"mapped",icon:ShieldCheck},
  ]},
];

export function JourneyNav({ language, active, onSelect, mobileOpen, onToggle }: {
  language:Language; active:PhaseId; onSelect:(phase:PhaseId)=>void; mobileOpen:boolean; onToggle:()=>void;
}) {
  const ar=language==="ar";
  return <div className="journey-nav-wrap">
    <div className="journey-nav-heading"><span><Compass size={16}/>{ar?"رحلة العمل":"Your work journey"}</span>
      <button type="button" className="journey-mobile-toggle" aria-label={ar?"التنقل":"Navigation"} aria-expanded={mobileOpen} onClick={onToggle}><Route size={17}/>{ar?"المراحل":"Phases"}</button>
    </div>
    <nav className={"journey-nav"+(mobileOpen?" journey-mobile-open":"")} aria-label={ar?"مراحل العمل":"Work phases"}>
      {phases.map((phase,index)=>{
        const Icon=phase.icon;
        return <button type="button" key={phase.id} className={"journey-step"+(active===phase.id?" journey-step-active":"")} aria-current={active===phase.id?"step":undefined} onClick={()=>onSelect(phase.id)}>
          <span className="journey-step-count">{String(index+1).padStart(2,"0")}</span><Icon size={18}/>
          <span>{ar?phase.ar:phase.en}</span>
        </button>;
      })}
    </nav>
  </div>;
}

export function JourneyHome({ language, active, onSelect, onOpen, children }: {
  language:Language; active:PhaseId; onSelect:(phase:PhaseId)=>void; onOpen:(page:Page)=>void; children?:ReactNode
}) {
  const ar=language==="ar";
  const [expanded,setExpanded]=useState(false);
  const phase=phases.find(x=>x.id===active)||phases[0];
  const idx=phases.findIndex(x=>x.id===active);
  const Arrow=ar?ArrowLeft:ArrowRight;
  return <section className="journey-home page-enter">
    <div className="journey-intro">
      <div className="journey-intro-copy"><span className="eyebrow"><Route size={14}/>{ar?"نظام رحلة الأعمال · IOETI":"IOETI · Journey-led operating system"}</span>
        <h1>{ar?"ابدأ من النتيجة، مش من الموديول.":"Start with the outcome, not the module."}</h1>
        <p>{ar?"اختر المرحلة التي تعمل عليها، ثم افتح المهمة المناسبة. كل خطوة توضح ما هو متصل بالفعل وما زال يحتاج بناءً على Axelor.":"Pick the moment in the business journey. Each step clearly distinguishes connected workflows from source-mapped plans."}</p>
      </div>
      <div className="journey-intro-orbit" aria-hidden="true"><div className="journey-orbit-ring"/><Compass size={47}/></div>
    </div>

    <div className="journey-focus">
      <div className="journey-focus-top">
        <span className="eyebrow">{ar?"المرحلة الحالية":"Selected stage"} · {String(idx+1).padStart(2,"0")} / 06</span>
        <button className="journey-text-switch" type="button" onClick={()=>setExpanded(v=>!v)}>{expanded?(ar?"إخفاء جميع المراحل":"Hide all stages"):(ar?"استعرض الرحلة كاملة":"Explore full journey")}<Arrow size={16}/></button>
      </div>
      <div className="journey-focus-title"><span className="journey-focus-number">0{idx+1}</span><div><h2>{ar?phase.questionAr:phase.questionEn}</h2><p>{ar?"حدّد المهمة، وستظهر المعلومات التي تحتاجها في موضعها الصحيح.":"Choose the work to do; relevant information appears in context."}</p></div></div>
      <div className="journey-task-grid">
        {phase.items.map((item)=>{
          const Icon=item.icon;
          return <div key={item.key} className={"journey-task"+(item.availability==="mapped"?" journey-task-planned":"")}>
            <div className="journey-task-head"><span className="journey-task-icon"><Icon size={23}/></span><span className={"journey-task-status "+(item.availability==="connected"?"ready":"planned")}>{item.availability==="connected"?(ar?"واجهة متصلة":"UI implemented"):(ar?"مخطط من المصدر":"Source mapped")}</span></div>
            <h3>{ar?item.ar:item.en}</h3><p>{ar?item.descAr:item.descEn}</p>
            {item.page?<button className="journey-task-action" type="button" onClick={()=>onOpen(item.page!)}>{ar?"افتح مساحة العمل":"Open workspace"}<Arrow size={17}/></button>:<button className="journey-task-action" type="button" onClick={()=>onOpen("atlas")}>{ar?"اعرف الموجود والناقص":"See source & gaps"}<Arrow size={17}/></button>}
          </div>;
        })}
      </div>
      {idx<phases.length-1&&<button className="journey-next" type="button" onClick={()=>onSelect(phases[idx+1].id)}><span>{ar?"المرحلة التالية":"Up next"} <strong>{ar?phases[idx+1].ar:phases[idx+1].en}</strong></span><Arrow size={18}/></button>}
    </div>

    {expanded&&<div className="journey-expanded"><h2>{ar?"كل مراحل العمل":"All stages"}</h2><div>{phases.map((p,i)=>{const I=p.icon;return <button type="button" key={p.id} onClick={()=>{onSelect(p.id);setExpanded(false)}}><I size={20}/><span>0{i+1}</span><strong>{ar?p.ar:p.en}</strong><small>{ar?p.questionAr:p.questionEn}</small><Arrow size={16}/></button>})}</div></div>}
    {children}
  </section>;
}
