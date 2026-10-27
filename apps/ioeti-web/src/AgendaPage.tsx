import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays, ChevronLeft, ChevronRight, CircleAlert, ClipboardList, GraduationCap, MapPin, NotebookPen, PhoneCall, RefreshCw,
  ShieldAlert, ShieldCheck, UserRoundSearch, UsersRound,
} from "lucide-react";
import { getAgenda, localDate, problem, recordHref, wallClock, type AgendaItem } from "./dailyApi";
import type { Language } from "./preferences";
import "./daily.css";

const L = {
  ar: {
    eyebrow: "مساحة العمل", title: "أجندتي", hint: "كل اللي عليك في مكان واحد: المتابعات والاجتماعات، الزيارات الميدانية، الجلسات التدريبية اللي بتنسقها، زيارات التدقيق، ومقابلات التوظيف.",
    today: "اليوم", week: "أسبوع", twoWeeks: "أسبوعين", previous: "السابق", next: "التالي", refresh: "تحديث",
    empty: "مفيش حاجة في الفترة دي.", emptyHint: "خطط لمتابعة من صفحة أي عميل محتمل أو حساب أو فرصة وهتظهر هنا.",
    loading: "جاري التحميل…", open: "فتح", allDay: "طوال اليوم",
    types: { ACTIVITY: "نشاط", SESSION: "جلسة تدريب", AUDIT: "زيارة تدقيق", INTERVIEW: "مقابلة توظيف", VISIT: "زيارة ميدانية", ACTION: "إجراء تصحيحي مستحق" },
    kinds: { CALL: "مكالمة", MEETING: "اجتماع", TASK: "مهمة", NOTE: "ملاحظة" },
    audit: "تدقيق مخطط", done: "تم", overdue: "متأخر", total: "عنصر",
  },
  en: {
    eyebrow: "Workspace", title: "My agenda", hint: "Everything on your plate in one place: follow-ups and meetings, field visits, training sessions you coordinate, audit visits and recruitment interviews.",
    today: "Today", week: "Week", twoWeeks: "Two weeks", previous: "Previous", next: "Next", refresh: "Refresh",
    empty: "Nothing in this period.", emptyHint: "Plan a follow-up from any lead, account or opportunity and it shows up here.",
    loading: "Loading…", open: "Open", allDay: "All day",
    types: { ACTIVITY: "Activity", SESSION: "Training session", AUDIT: "Audit visit", INTERVIEW: "Interview", VISIT: "Field visit", ACTION: "Corrective action due" },
    kinds: { CALL: "Call", MEETING: "Meeting", TASK: "Task", NOTE: "Note" },
    audit: "Planned audit", done: "Done", overdue: "Overdue", total: "items",
  },
} as const;

function icon(item: AgendaItem) {
  if (item.type === "SESSION") return GraduationCap;
  if (item.type === "AUDIT") return ShieldCheck;
  if (item.type === "INTERVIEW") return UserRoundSearch;
  if (item.type === "VISIT") return MapPin;
  if (item.type === "ACTION") return ShieldAlert;
  return item.kind === "CALL" ? PhoneCall : item.kind === "MEETING" ? UsersRound : item.kind === "TASK" ? ClipboardList : NotebookPen;
}
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** The caller's own agenda across domains; only what the server lets them read. */
export function AgendaPage({ language }: { language: Language }) {
  const l = L[language], ar = language === "ar";
  const [span, setSpan] = useState<7 | 14>(7);
  const [start, setStart] = useState(() => startOfDay(new Date()));
  const [items, setItems] = useState<AgendaItem[] | null>(null);
  const [error, setError] = useState("");
  const end = addDays(start, span - 1);
  const load = useCallback(() => {
    setError("");
    return getAgenda(localDate(start), localDate(end)).then(setItems).catch(e => { setItems([]); setError(problem(e, ar)); });
  }, [start, end.getTime(), ar]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setItems(null); void load(); }, [load]);
  const days = useMemo(() => Array.from({ length: span }, (_, i) => addDays(start, i)), [start, span]);
  const byDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const item of items ?? []) {
      const key = item.at ? item.at.slice(0, 10) : "";
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [items]);
  const locale = ar ? "ar-EG" : "en-GB";
  const todayKey = localDate(new Date());
  const now = Date.now();
  const Prev = ar ? ChevronRight : ChevronLeft, Next = ar ? ChevronLeft : ChevronRight;
  const busyDays = days.filter(d => (byDay.get(localDate(d))?.length ?? 0) > 0);
  return <section className="page-enter agenda-page">
    <div className="page-head"><div className="page-title"><span className="eyebrow">{l.eyebrow}</span><h1><CalendarDays size={24}/>{l.title}</h1><p>{l.hint}</p></div></div>
    <div className="agenda-toolbar">
      <div className="agenda-nav">
        <button type="button" className="icon-button" aria-label={l.previous} onClick={() => setStart(addDays(start, -span))}><Prev size={18}/></button>
        <button type="button" className="btn btn-secondary" onClick={() => setStart(startOfDay(new Date()))}>{l.today}</button>
        <button type="button" className="icon-button" aria-label={l.next} onClick={() => setStart(addDays(start, span))}><Next size={18}/></button>
        <strong className="agenda-range">{start.toLocaleDateString(locale, { day: "numeric", month: "short" })} – {end.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}</strong>
      </div>
      <div className="segmented" role="group">
        <button type="button" className={span === 7 ? "chosen" : ""} aria-pressed={span === 7} onClick={() => setSpan(7)}>{l.week}</button>
        <button type="button" className={span === 14 ? "chosen" : ""} aria-pressed={span === 14} onClick={() => setSpan(14)}>{l.twoWeeks}</button>
      </div>
      <button type="button" className="icon-button" aria-label={l.refresh} onClick={() => void load()}><RefreshCw size={18}/></button>
    </div>
    <div className="agenda-strip" aria-hidden="true">{days.map(d => { const key = localDate(d), count = byDay.get(key)?.length ?? 0;
      return <span key={key} className={"agenda-strip-day" + (key === todayKey ? " is-today" : "") + (count ? " has-items" : "")}>
        <small>{d.toLocaleDateString(locale, { weekday: "short" })}</small><b>{d.getDate()}</b>{count > 0 && <i>{count}</i>}</span>; })}</div>
    {error && <div className="error-banner" role="alert"><CircleAlert size={17}/><span>{error}</span><button type="button" className="btn btn-secondary" onClick={() => void load()}>{l.refresh}</button></div>}
    {items === null ? <div className="empty-state" role="status">{l.loading}</div>
      : busyDays.length === 0 ? <div className="empty-state agenda-empty"><CalendarDays size={30}/><strong>{l.empty}</strong><span>{l.emptyHint}</span></div>
      : <div className="agenda-days">{busyDays.map(d => { const key = localDate(d); return <section key={key} className={"agenda-day" + (key === todayKey ? " is-today" : "")} aria-label={d.toLocaleDateString(locale, { dateStyle: "full" })}>
        <header><b>{d.getDate()}</b><span>{d.toLocaleDateString(locale, { weekday: "long", month: "long" })}</span>{key === todayKey && <em>{l.today}</em>}</header>
        <ol>{(byDay.get(key) ?? []).map(item => {
          const Icon = icon(item), href = recordHref(item.recordType, item.recordId);
          const time = item.type === "AUDIT" || item.type === "ACTION" ? l.allDay : wallClock(item.at)?.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) ?? "";
          const overdue = (item.type === "ACTIVITY" && item.status === "PLANNED" && (wallClock(item.at)?.getTime() ?? now) < now)
            || (item.type === "ACTION" && item.status === "OPEN" && (wallClock(item.at)?.getTime() ?? now) < startOfDay(new Date(now)).getTime());
          const title = item.title || (item.type === "AUDIT" ? l.audit : l.types[item.type]);
          return <li key={item.type + item.id} className={"agenda-item is-" + item.type.toLowerCase() + (item.status === "DONE" ? " is-done" : "") + (overdue ? " is-overdue" : "")}>
            <time>{time}</time>
            <span className="agenda-icon"><Icon size={16}/></span>
            <div><strong>{title}</strong><small>{item.type === "ACTIVITY" && item.kind ? l.kinds[item.kind] : l.types[item.type]}
              {item.status === "DONE" ? " · " + l.done : overdue ? " · " + l.overdue : ""}</small></div>
            {href && <a className="text-action" href={href}>{l.open}</a>}
          </li>; })}</ol>
      </section>; })}</div>}
  </section>;
}
