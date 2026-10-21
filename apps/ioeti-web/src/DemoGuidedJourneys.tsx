import { useState } from "react";
import { ArrowLeft, ArrowRight, BadgeCheck, BriefcaseBusiness, GraduationCap, Handshake, Layers3, Play, ShieldCheck } from "lucide-react";
import type { Language } from "./preferences";
import { demoBusinessStore, demoConfigs, type DemoArea } from "./demoBusiness";

export type TourStep = { area: DemoArea; id: number; ar: string; en: string };
export type Tour = {
  key: string; labelAr: string; labelEn: string; descriptionAr: string; descriptionEn: string;
  steps: readonly TourStep[];
};
const TOURS: readonly Tour[] = [
  {
    key: "iso", labelAr: "من عرض السعر إلى تدقيق ISO", labelEn: "From quotation to ISO audit",
    descriptionAr: "تتبّع عرض الفندق والعقد والتسليم للتشغيل، ثم الزيارة والمراجعة. كل السجلات خيالية ومترابطة.",
    descriptionEn: "Follow a hotel quotation through its contract, operations handover and certification audit. Every record is fictional.",
    steps: [
      {area:"quotes",id:4101,ar:"عرض السعر",en:"Quotation"},
      {area:"contracts",id:5101,ar:"العقد",en:"Contract"},
      {area:"projects",id:7101,ar:"التسليم للتشغيل",en:"Operations handover"},
      {area:"visits",id:8101,ar:"الزيارة الميدانية",en:"Field visit"},
      {area:"certification",id:1101,ar:"تدقيق ISO",en:"ISO audit"},
      {area:"documents",id:13003,ar:"أدلة التدقيق",en:"Audit evidence"},
    ],
  },
  {
    key: "training", labelAr: "برنامج تدريب مؤسسي", labelEn: "Corporate training delivery",
    descriptionAr: "من طلب التدريب والعقد إلى مشروع التنفيذ والمجموعة التدريبية والاستحقاق، ببيانات تجريبية.",
    descriptionEn: "Explore a fictional training proposal, contract, delivery project, cohort and payment milestone.",
    steps: [
      {area:"quotes",id:4102,ar:"عرض التدريب",en:"Training quote"},
      {area:"contracts",id:5102,ar:"اتفاقية العميل",en:"Customer agreement"},
      {area:"projects",id:7102,ar:"مشروع التنفيذ",en:"Delivery project"},
      {area:"learning",id:9101,ar:"المجموعة التدريبية",en:"Training cohort"},
      {area:"finance",id:6102,ar:"جدول الاستحقاق",en:"Payment milestone"},
    ],
  },
  {
    key: "recruiting", labelAr: "التوظيف لصالح عميل", labelEn: "Client recruitment",
    descriptionAr: "استكشف عرض خدمة توظيف، ثم أمر توظيف لدى العميل والاستحقاق المرتبط به.",
    descriptionEn: "Review a fictional recruitment quote, client job order and associated milestone.",
    steps: [
      {area:"quotes",id:4103,ar:"عرض التوظيف",en:"Recruitment quote"},
      {area:"recruiting",id:10101,ar:"طلب توظيف العميل",en:"Client job order"},
      {area:"finance",id:6103,ar:"الاستحقاق",en:"Milestone"},
    ],
  },
  {
    key: "grants", labelAr: "الشراكات والمنح", labelEn: "Partnerships and grants",
    descriptionAr: "انتقل من حملة الشراكات إلى ملف المنحة ثم تقرير التعهدات مقابل التحصيل، دون معاملات مالية حقيقية.",
    descriptionEn: "Follow a partnership campaign to a grant and a pledge-versus-collection report, with no real money movement.",
    steps: [
      {area:"marketing",id:8303,ar:"حملة الشراكات",en:"Partnership campaign"},
      {area:"fundraising",id:1202,ar:"ملف المنحة",en:"Grant record"},
      {area:"reports",id:13203,ar:"تقرير التحصيل",en:"Collection report"},
    ],
  },
];

/** Standalone walkthrough of already-linked fictional records, never connected to Axelor. */
export function DemoGuidedJourneys({
  language, onOpen,
}: { language: Language; onOpen: (area: DemoArea, id?: number) => void }) {
  const [selected, setSelected] = useState("iso");
  const rtl = language === "ar";
  const tour = TOURS.find(item => item.key === selected) ?? TOURS[0];
  const icon = [BadgeCheck, GraduationCap, BriefcaseBusiness, Handshake];
  const first = tour.steps[0];
  const Forward = rtl ? ArrowLeft : ArrowRight;
  return <section className="demo-tour" aria-labelledby="demo-tour-title">
    <div className="demo-tour-head">
      <div>
        <span className="eyebrow"><Layers3 size={14}/>{rtl ? "رحلات تفاعلية · بيانات خيالية" : "GUIDED JOURNEYS · FICTIONAL DATA"}</span>
        <h3 id="demo-tour-title">{rtl ? "جرّب النظام كرحلة عمل كاملة" : "Explore an end-to-end business journey"}</h3>
        <p>{rtl ? "اختار سيناريو واتنقّل بين سجلاته المرتبطة بدل ما تستكشف كل موديول لوحده." : "Choose a scenario and follow related records instead of opening isolated modules."}</p>
      </div>
      <span className="demo-tour-private"><ShieldCheck size={15}/>{rtl ? "معاينة فقط" : "Preview only"}</span>
    </div>
    <div className="demo-tour-switch" role="group" aria-label={rtl ? "اختيار رحلة تجريبية" : "Choose a guided journey"}>
      {TOURS.map((item,index) => {
        const Icon = icon[index];
        return <button key={item.key} type="button" className={selected === item.key ? "is-selected" : ""}
          aria-pressed={selected === item.key} onClick={() => setSelected(item.key)}>
          <Icon size={16}/>{rtl ? item.labelAr : item.labelEn}
        </button>;
      })}
    </div>
    <div className="demo-tour-detail">
      <div className="demo-tour-detail-head">
        <p>{rtl ? tour.descriptionAr : tour.descriptionEn}</p>
        <div className="demo-tour-actions">
        <button type="button" className="btn btn-primary" onClick={() => onOpen(first.area,first.id)}>
          <Play size={15} fill="currentColor"/>{rtl ? "ابدأ الرحلة" : "Start journey"}<Forward size={15}/>
        </button>
        </div>
      </div>
      <ol className="demo-tour-steps" aria-label={rtl ? "خطوات الرحلة" : "Journey steps"}>
        {tour.steps.map((step,index) => {
          const record = demoBusinessStore.get(step.area,step.id);
          const stage = record ? demoConfigs[step.area].stages[record.stage]?.[language] : undefined;
          return <li key={step.area + ":" + step.id}>
            <button type="button" onClick={() => onOpen(step.area,step.id)} disabled={!record}
              aria-label={(rtl ? "افتح " : "Open ") + (rtl ? step.ar : step.en)}>
              <span className="demo-tour-step-index">{String(index + 1).padStart(2,"0")}</span>
              <span className="demo-tour-step-main">
                <strong>{rtl ? step.ar : step.en}</strong>
                <small>{record ? (rtl ? record.titleAr : record.titleEn) : (rtl ? "السجل غير متاح" : "Record unavailable")}</small>
                {stage && <em>{stage}</em>}
              </span>
              <Forward size={16}/>
            </button>
          </li>;
        })}
      </ol>
    </div>
    <p className="demo-tour-footnote">{rtl
      ? "الخطوات دي روابط بين سجلات افتراضية موجودة بالفعل؛ حالات المراجعة والمبالغ لا تمثل بيانات IOETI الحقيقية."
      : "These are linked fictional records. Stages, reviews and amounts are not real IOETI business data."}</p>
  </section>;
}
