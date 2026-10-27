import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { subscribeFeedback, type FeedbackNotice } from "./feedback";
import { usePreferences } from "./preferences";

/** Toast shelf is deliberately independent of modules; no raw server messages, no silent failures. */
export function FeedbackCenter() {
  const [notices, setNotices] = useState<FeedbackNotice[]>([]);
  const timers = useRef<Map<number, number>>(new Map());
  const {language} = usePreferences();
  useEffect(() => {
    const unsubscribe = subscribeFeedback(notice => {
      setNotices(existing => [...existing.filter(item => item.code !== notice.code), notice].slice(-3));
      const timer = window.setTimeout(() => {
        setNotices(items => items.filter(item => item.id !== notice.id));
        timers.current.delete(notice.id);
      }, notice.kind === "error" ? 10000 : 5500);
      timers.current.set(notice.id, timer);
    });
    return () => {
      unsubscribe();
      timers.current.forEach(timer => window.clearTimeout(timer));
      timers.current.clear();
    };
  }, []);
  function dismiss(id: number) {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
    setNotices(items => items.filter(item => item.id !== id));
  }
  if (notices.length === 0) return null;
  return <div className="ioeti-feedback-stack" aria-label={language === "ar" ? "تنبيهات النظام" : "System notifications"}>
    {notices.map(item => {
      const Icon = item.kind === "success" ? CheckCircle2 : item.kind === "error" ? AlertCircle : Info;
      return <div key={item.id} className={"ioeti-feedback ioeti-feedback-" + item.kind}
        role="status"
        aria-live={item.kind === "error" ? "assertive" : "polite"}
        aria-atomic="true">
        <Icon size={20} aria-hidden="true"/>
        <div className="ioeti-feedback-body">
          <strong>{language === "ar" ? item.kind === "success" ? "تم بنجاح" : item.kind === "error" ? "تعذر إتمام الإجراء" : "معلومة" : item.kind === "success" ? "Success" : item.kind === "error" ? "Action not completed" : "Information"}</strong>
          <p>{language === "ar" ? item.ar : item.en}</p>
          {/* a reference for support on a failure only; a success needs no code */}
          {item.kind === "error" && item.code && <small className="ioeti-feedback-ref">{language === "ar" ? "مرجع للدعم: " : "Support reference: "}<code dir="ltr">{item.code}</code></small>}
        </div>
        <button type="button" className="ioeti-feedback-close"
          aria-label={language === "ar" ? "إغلاق التنبيه" : "Dismiss notification"}
          onClick={() => dismiss(item.id)}><X size={17}/></button>
      </div>;
    })}
  </div>;
}
