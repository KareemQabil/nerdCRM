import { CalendarDays, ChevronLeft, ChevronRight, CircleHelp, UserRound } from "lucide-react";
import type { Language } from "./preferences";
import { demoConfigs, type DemoArea, type DemoRecord } from "./demoBusiness";

/**
 * Fictional-only pipeline renderer. Cards are navigation, never writes:
 * authoritative stage changes must go through a permission-checked server command
 * when the domain APIs become available. This component is imported only from
 * the lazy demo workspace and has no Axelor/network dependencies.
 */
type Props = {
 area: DemoArea;
 language: Language;
 rows: DemoRecord[];
 onOpen: (id: number) => void;
};

function amount(value: number | null, language: Language) {
 return value === null ? null : new Intl.NumberFormat(language === "ar" ? "ar-EG" : "en-EG", {
  maximumFractionDigits: 0,
 }).format(value) + " EGP";
}
function day(value: string, language: Language) {
 return new Intl.DateTimeFormat(language === "ar" ? "ar-EG" : "en-GB", {
  day: "numeric", month: "short", timeZone: "UTC",
 }).format(new Date(value + "T12:00:00Z"));
}

export function DemoPipelineBoard({area, language, rows, onOpen}: Props) {
 const rtl = language === "ar";
 const config = demoConfigs[area];
 const Forward = rtl ? ChevronLeft : ChevronRight;
 return <div className="demo-pipeline-board" data-testid="demo-pipeline-board"
  role="region" aria-label={rtl ? "لوحة مراحل السيناريوهات الخيالية" : "Fictional scenario stage board"}>
  <div className="demo-board-scroller">
   {config.stages.map((stage, index) => {
    const cards = rows.filter(row => row.stage === index);
    const headingId = `demo-stage-${area}-${index}`;
    return <section key={index} className="demo-board-column" aria-labelledby={headingId}>
     <header className="demo-board-column-header">
      <div><span className="demo-board-index">{String(index + 1).padStart(2, "0")}</span>
       <h3 id={headingId}>{stage[language]}</h3></div>
      <span className="demo-board-count" aria-label={rtl ? `${cards.length} سجل` : `${cards.length} records`}>{cards.length}</span>
     </header>
     <div className="demo-board-cards">
      {cards.length === 0 ? <p className="demo-board-empty"><CircleHelp size={17}/>
        {rtl ? "لا توجد سجلات تطابق الفلتر" : "No matching records"}</p>
       : cards.map(row => <button key={row.id} type="button" className="demo-board-card"
        onClick={() => onOpen(row.id)}
        aria-label={`${rtl ? row.titleAr : row.titleEn} · DEMO-${row.id} · ${stage[language]}`}>
        <span className="demo-board-card-top"><span dir="ltr" className="demo-board-ref">DEMO-{row.id}</span>
         <Forward size={17} aria-hidden="true"/></span>
        <strong>{rtl ? row.titleAr : row.titleEn}</strong>
        <span className="demo-board-org">{row.company}</span>
        <span className="demo-board-card-meta"><UserRound size={14} aria-hidden="true"/>{row.owner}</span>
        <span className="demo-board-card-foot"><span><CalendarDays size={14} aria-hidden="true"/>{day(row.due,language)}</span>
         {amount(row.value,language) && <b dir="ltr">{amount(row.value,language)}</b>}</span>
       </button>)}
     </div>
    </section>;
   })}
  </div>
  <p className="demo-board-disclaimer">
   {rtl ? "تجربة عرض وفتح ملفات فقط؛ الانتقال بين المراحل يتم من داخل الملف وبعد تأكيد المحاكاة."
        : "View and open only. Simulated stage changes require opening a record and confirming the action."}
  </p>
 </div>;
}
