import { useEffect, useRef, useState, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, CircleDot, ExternalLink, Focus, ShieldCheck, X } from "lucide-react";
import type { Language } from "./preferences";
import { demoBusinessStore, demoConfigs, type DemoArea } from "./demoBusiness";
import type { Tour } from "./DemoGuidedJourneys";

/**
 * A deliberately isolated, one-job-at-a-time journey.
 * This modal is entirely preview data; it never reads Axelor or changes a real record.
 * It is portaled outside #root so the rest of the app can become inert.
 */
export function DemoMissionFocus({
  language, tour, onOpen, onClose,
}: {
  language: Language;
  tour: Tour;
  onOpen: (area: DemoArea, id?: number) => void;
  onClose: () => void;
}) {
  const rtl = language === "ar";
  const [index, setIndex] = useState(0);
  const step = tour.steps[index];
  const record = demoBusinessStore.get(step.area, step.id);
  const stage = record && demoConfigs[step.area].stages[record.stage]?.[language];
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const Forward = rtl ? ArrowLeft : ArrowRight;

  useEffect(() => {
    const root = document.getElementById("root");
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousInert = root?.inert ?? false;
    const previousOverflow = document.body.style.overflow;
    if (root) root.inert = true;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== "Tab") return;
      const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      if (buttons.length === 0) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      if (root) root.inert = previousInert;
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  function move(direction: -1 | 1) {
    setIndex(current => Math.max(0, Math.min(tour.steps.length - 1, current + direction)));
  }
  function touchStart(event: TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 1) return;
    touch.current = {x: event.touches[0].clientX, y: event.touches[0].clientY};
  }
  function touchEnd(event: TouchEvent<HTMLDivElement>) {
    if (!touch.current || !event.changedTouches.length) return;
    const deltaX = event.changedTouches[0].clientX - touch.current.x;
    const deltaY = event.changedTouches[0].clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(deltaX) >= 72 && Math.abs(deltaX) > Math.abs(deltaY) * 1.65) {
      // Swipe toward the reading direction's forward edge to advance. Buttons work without gestures.
      move((rtl ? deltaX > 0 : deltaX < 0) ? 1 : -1);
    }
  }
  function openRecord() {
    onClose();
    onOpen(step.area, step.id);
  }

  return createPortal(
    <div className="mission-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
      data-testid="demo-mission-overlay">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="mission-title" aria-describedby="mission-description"
        className="mission-dialog" dir={rtl ? "rtl" : "ltr"}>
        <div className="mission-topbar">
          <span className="mission-mode"><Focus size={16}/>{rtl ? "وضع التركيز" : "Focus mode"}<span className="mission-demo-flag">{rtl ? "محاكاة" : "Simulation"}</span></span>
          <span className="mission-step-counter" aria-live="polite">{rtl ? "الخطوة" : "Step"} {index + 1} / {tour.steps.length}</span>
          <button ref={closeRef} type="button" className="mission-close" onClick={onClose}
            aria-label={rtl ? "إغلاق وضع التركيز" : "Close focus mode"}><X size={19}/></button>
        </div>

        <div className="mission-progress" role="progressbar"
          aria-label={rtl ? "تقدم الرحلة" : "Journey progress"} aria-valuenow={index + 1}
          aria-valuemin={0} aria-valuemax={tour.steps.length}>
          <span style={{width: ((index + 1) / tour.steps.length * 100) + "%"}}/>
        </div>

        <div className="mission-layout">
          <div className="mission-work-area" onTouchStart={touchStart} onTouchEnd={touchEnd}>
            <div className="mission-illustration" aria-hidden="true">
              <div className="mission-illustration-grid"/>
              <div className="mission-orbit mission-orbit-back"/>
              <div className="mission-orbit mission-orbit-front">
                <span className="mission-center"><CircleDot size={40} strokeWidth={1.4}/></span>
              </div>
              <span className="mission-orb mission-orb-first"><Check size={16}/></span>
              <span className="mission-orb mission-orb-last"><Forward size={17}/></span>
            </div>
            <div className="mission-copy" key={step.area + ":" + step.id}>
              <span className="mission-eyebrow">{rtl ? "المهمة الحالية" : "CURRENT MISSION"} · {demoConfigs[step.area][language]}</span>
              <h2 id="mission-title">{rtl ? step.ar : step.en}</h2>
              <p id="mission-description">{record ? (rtl ? record.titleAr : record.titleEn) : (rtl ? "السجل التجريبي غير متاح" : "Sample record unavailable")}</p>
              <div className="mission-record-card">
                <span className="mission-record-label">{rtl ? "الملف الذي ستستكشفه" : "RECORD IN THIS STEP"}</span>
                <strong>{record?.company ?? (rtl ? "غير متاح" : "Unavailable")}</strong>
                <span className="mission-record-meta">
                  <span dir="ltr">DEMO-{step.id}</span>
                  {stage && <span className="mission-stage">{stage}</span>}
                </span>
                {record && <p>{rtl ? record.descriptionAr : record.descriptionEn}</p>}
              </div>
              <button type="button" className="mission-open" onClick={openRecord} disabled={!record}>
                <ExternalLink size={17}/>{rtl ? "افتح الملف واشتغل عليه" : "Open this record"}<Forward size={17}/>
              </button>
              <p className="mission-swipe-hint">{rtl ? "اسحب يمينًا أو يسارًا للتنقل، أو استخدم أزرار الخطوات" : "Swipe to move between steps, or use the navigation buttons"}</p>
            </div>
            <div className="mission-bottom">
              <button type="button" className="mission-step-button" onClick={() => move(-1)} disabled={index === 0}>
                {rtl ? <ChevronRight size={18}/> : <ChevronLeft size={18}/>}
                {rtl ? "السابق" : "Previous"}
              </button>
              <button type="button" className="mission-step-button mission-next" onClick={() => move(1)} disabled={index === tour.steps.length - 1}>
                {rtl ? "التالي" : "Next"}
                {rtl ? <ChevronLeft size={18}/> : <ChevronRight size={18}/>}
              </button>
            </div>
          </div>
          <aside className="mission-rail" aria-label={rtl ? "مراحل المهمة" : "Mission steps"}>
            <div className="mission-rail-header">
              <span>{rtl ? "رحلة واحدة. مهمة واحدة." : "ONE JOURNEY. ONE TASK."}</span>
              <h3>{rtl ? tour.labelAr : tour.labelEn}</h3>
              <p>{rtl ? tour.descriptionAr : tour.descriptionEn}</p>
            </div>
            <ol className="mission-rail-steps">
              {tour.steps.map((item, position) => (
                <li key={item.area + item.id}>
                  <button type="button" className={position === index ? "is-current" : position < index ? "is-past" : ""}
                    aria-current={position === index ? "step" : undefined}
                    onClick={() => setIndex(position)}>
                    <span className="mission-rail-index">{position < index ? <Check size={14}/> : String(position + 1).padStart(2, "0")}</span>
                    <span><strong>{rtl ? item.ar : item.en}</strong><small>{demoConfigs[item.area][language]}</small></span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="mission-rail-disclaimer"><ShieldCheck size={18}/>
              <span>{rtl ? "كل البيانات هنا خيالية، بدون تشغيل معاملات حقيقية أو إصدار شهادات أو إرسال رسائل." : "Fictional data only. No live transactions, issued certificates or sent messages."}</span>
            </div>
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}
