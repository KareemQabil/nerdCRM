import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, CircleAlert, ClipboardList, Clock3, ExternalLink, GraduationCap, MapPin,
  NotebookPen, PhoneCall, RefreshCw, ShieldAlert, ShieldCheck, UserRoundSearch, UsersRound, X,
} from "lucide-react";
import { getAccount, getLead, getOpportunity } from "./api";
import {
  cancelActivity, finishActivity, getAgenda, getCalendarPeople, getOverdue, localDate, moveActivity, planItem, problem, recordHref, searchEverything, wallClock,
  type ActivityKind, type AgendaItem, type CalendarPerson, type RecordType, type SearchHit,
} from "./dailyApi";
import { Dialog } from "./Dialog";
import type { Language } from "./preferences";
import "./daily.css";
import { PageHeader } from "./ui";

/**
 * The calendar: the person's own items across the platform (follow-ups and activities, training sessions they
 * coordinate, audits, interviews, field visits, corrective actions falling due) in a month, week, day or list
 * view, and a teammate's activities when the server allows it. The person's own planned activities can be created
 * on a free slot, dragged to another time, finished or cancelled; everything else opens on its own record.
 * Every change goes through the server, which checks it again.
 */
type View = "month" | "week" | "day" | "list";
type ItemType = AgendaItem["type"];
const TYPES: ItemType[] = ["ACTIVITY", "SESSION", "AUDIT", "INTERVIEW", "VISIT", "ACTION"];
const KINDS: ActivityKind[] = ["CALL", "MEETING", "TASK", "NOTE"];
const HOUR = 48; // px per hour in the day and week grids
const SNAP = 15; // minutes
const STORE = "ioeti.calendar.v1";

const L = {
  ar: {
    eyebrow: "مساحة العمل", title: "التقويم",
    hint: "كل اللي عليك في مكان واحد: المتابعات والاجتماعات، الزيارات، الجلسات التدريبية، التدقيقات، المقابلات والإجراءات المستحقة. دوس على وقت فاضي عشان تضيف، واسحب مواعيدك عشان تغيّرها.",
    today: "النهارده", previous: "السابق", next: "التالي", refresh: "تحديث", newItem: "موعد جديد",
    views: { month: "شهر", week: "أسبوع", day: "يوم", list: "قائمة" } as Record<View, string>,
    whose: "تقويم مين", mine: "تقويمي", readOnly: "بتشوف مواعيد زميل: للقراءة بس.",
    empty: "مفيش حاجة في الفترة دي.", emptyHint: "دوس على «موعد جديد» أو على أي وقت فاضي في عرض الأسبوع.",
    loading: "جاري التحميل…", open: "فتح السجل", allDay: "طوال اليوم", more: (n: number) => `+${n} كمان`,
    types: { ACTIVITY: "نشاط", SESSION: "جلسة تدريب", AUDIT: "زيارة تدقيق", INTERVIEW: "مقابلة توظيف", VISIT: "زيارة ميدانية", ACTION: "إجراء تصحيحي مستحق" } as Record<ItemType, string>,
    kinds: { CALL: "مكالمة", MEETING: "اجتماع", TASK: "مهمة", NOTE: "ملاحظة" } as Record<ActivityKind, string>,
    show: "إظهار", status: "الحالة", audit: "تدقيق مخطط", done: "تم", overdue: "متأخر", planned: "مخطط", cancelled: "اتلغى",
    when: "الميعاد", length: "المدة", minutes: (n: number) => n < 60 ? `${n} دقيقة` : n % 60 === 0 ? (n === 60 ? "ساعة" : `${n / 60} ساعات`) : `${Math.floor(n / 60)} ساعة و${n % 60} دقيقة`,
    subject: "العنوان", kind: "النوع", date: "اليوم", time: "الساعة", link: "مرتبط بـ (اختياري)", linkHint: "اكتب حرفين من اسم lead أو حساب أو فرصة",
    personal: "موعد شخصي (مش مرتبط بسجل)", unlink: "إلغاء الربط",
    create: "إضافة", creating: "جاري الإضافة…", cancel: "إلغاء", close: "إغلاق",
    pastNote: "الميعاد ده فات، فهيتسجل إنه حصل.",
    markDone: "تم", outcome: "حصل إيه؟ (اختياري، مش بيتعرض تاني)", reschedule: "تغيير الميعاد", save: "حفظ", cancelItem: "إلغاء الموعد",
    cancelConfirm: "تلغي الموعد ده؟ بيفضل في السجل كملغي.", moved: "اتنقل الموعد.", finished: "اتسجل إنه تم.", cancelledNote: "اتلغى الموعد.", added: "اتضاف الموعد.",
    dragHint: "اسحب مواعيدك المخططة لوقت تاني، أو افتحها وغيّر الميعاد.", overdueTitle: (n: number) => `${n} ${n === 1 ? "موعد فات ميعاده" : "مواعيد فات ميعادها"} ومتعلّمتش إنها تمت`,
    snooze: "بكرة 10 الصبح", snoozeWeek: "الأسبوع الجاي", snoozed: "اتأجل الموعد.", keys: "اختصارات: T النهارده · ← → السابق/التالي · M/W/D/L العروض",
    week0: 6,
  },
  en: {
    eyebrow: "Workspace", title: "Calendar",
    hint: "Everything on your plate in one place: follow-ups and meetings, visits, training sessions, audits, interviews and actions falling due. Click a free time to add; drag your items to change them.",
    today: "Today", previous: "Previous", next: "Next", refresh: "Refresh", newItem: "New item",
    views: { month: "Month", week: "Week", day: "Day", list: "List" } as Record<View, string>,
    whose: "Whose calendar", mine: "My calendar", readOnly: "You are looking at a colleague's items: read only.",
    empty: "Nothing in this period.", emptyHint: "Click “New item”, or a free time in the week view.",
    loading: "Loading…", open: "Open record", allDay: "All day", more: (n: number) => `+${n} more`,
    types: { ACTIVITY: "Activity", SESSION: "Training session", AUDIT: "Audit visit", INTERVIEW: "Interview", VISIT: "Field visit", ACTION: "Corrective action due" } as Record<ItemType, string>,
    kinds: { CALL: "Call", MEETING: "Meeting", TASK: "Task", NOTE: "Note" } as Record<ActivityKind, string>,
    show: "Show", status: "Status", audit: "Planned audit", done: "Done", overdue: "Overdue", planned: "Planned", cancelled: "Cancelled",
    when: "When", length: "Length", minutes: (n: number) => n < 60 ? `${n} min` : n % 60 === 0 ? `${n / 60} h` : `${Math.floor(n / 60)} h ${n % 60} min`,
    subject: "Title", kind: "Type", date: "Day", time: "Time", link: "Linked to (optional)", linkHint: "Type two letters of a lead, account or opportunity",
    personal: "Personal item (not linked to a record)", unlink: "Unlink",
    create: "Add", creating: "Adding…", cancel: "Cancel", close: "Close",
    pastNote: "This time has passed, so it is recorded as having happened.",
    markDone: "Done", outcome: "What came of it? (optional, never shown again)", reschedule: "Reschedule", save: "Save", cancelItem: "Cancel item",
    cancelConfirm: "Cancel this item? It stays in the history as cancelled.", moved: "Moved.", finished: "Marked done.", cancelledNote: "Cancelled.", added: "Added.",
    dragHint: "Drag your planned items to another time, or open one and reschedule it.", overdueTitle: (n: number) => `${n} planned ${n === 1 ? "item is" : "items are"} past their time and not marked done`,
    snooze: "Tomorrow 10:00", snoozeWeek: "Next week", snoozed: "Postponed.", keys: "Shortcuts: T today · ← → previous/next · M/W/D/L views",
    week0: 6,
  },
};
type Labels = typeof L.ar;

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
/** The week starts on Saturday (the Egyptian calendar week). */
const startOfWeek = (d: Date, week0: number) => addDays(startOfDay(d), -((d.getDay() - week0 + 7) % 7));
const iso = (d: Date) => `${localDate(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const allDay = (i: AgendaItem) => i.type === "AUDIT" || i.type === "ACTION";
const startOf = (i: AgendaItem) => wallClock(i.at);
const endOf = (i: AgendaItem) => wallClock(i.endsAt) ?? (startOf(i) ? new Date(startOf(i)!.getTime() + 30 * 60000) : null);

function readView(): View {
  try { const v = localStorage.getItem(STORE); return v === "month" || v === "day" || v === "list" ? v : "week"; } catch { return "week"; }
}

/** Places overlapping items side by side: each gets a lane and the number of lanes in its cluster. */
function lanes(items: AgendaItem[]): Map<AgendaItem, { lane: number; of: number }> {
  const out = new Map<AgendaItem, { lane: number; of: number }>();
  const sorted = [...items].sort((a, b) => (startOf(a)?.getTime() ?? 0) - (startOf(b)?.getTime() ?? 0));
  let cluster: AgendaItem[] = [], ends: number[] = [], clusterEnd = 0;
  const flush = () => { const of = Math.max(1, ends.length); cluster.forEach(i => out.set(i, { lane: out.get(i)!.lane, of })); cluster = []; ends = []; };
  for (const item of sorted) {
    const s = startOf(item)?.getTime() ?? 0, e = Math.max(endOf(item)?.getTime() ?? s, s + 15 * 60000);
    if (cluster.length && s >= clusterEnd) flush();
    let lane = ends.findIndex(end => end <= s);
    if (lane < 0) { lane = ends.length; ends.push(e); } else ends[lane] = e;
    out.set(item, { lane, of: 1 });
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return out;
}

export function AgendaPage({ language }: { language: Language }) {
  const l = L[language], ar = language === "ar";
  // Latin digits throughout, like the amounts elsewhere, so times, dates and day numbers read the same way
  const locale = ar ? "ar-EG-u-nu-latn" : "en-GB";
  const [view, setViewState] = useState<View>(readView);
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [items, setItems] = useState<AgendaItem[] | null>(null);
  const [late, setLate] = useState<AgendaItem[]>([]);
  const [people, setPeople] = useState<CalendarPerson[]>([]);
  const [person, setPerson] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<ItemType>>(new Set());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [opened, setOpened] = useState<AgendaItem | null>(null);
  const [creating, setCreating] = useState<Date | null>(null);
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(STORE, v); } catch { /* per-viewer convenience only */ } };

  const [from, to] = useMemo((): [Date, Date] => {
    if (view === "day") return [anchor, anchor];
    if (view === "month") { const first = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1), l.week0); return [first, addDays(first, 41)]; }
    const s = startOfWeek(anchor, l.week0);
    return [s, addDays(s, view === "list" ? 13 : 6)];
  }, [view, anchor, l.week0]);
  const own = person === null || people.find(p => p.id === person)?.me === true;
  const load = useCallback(() => {
    setError("");
    if (own) void getOverdue().then(setLate).catch(() => setLate([])); else setLate([]);
    return getAgenda(localDate(from), localDate(to), own ? null : person).then(setItems).catch(e => { setItems([]); setError(problem(e, ar)); });
  }, [from.getTime(), to.getTime(), person, own, ar]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setItems(null); void load(); }, [load]);
  useEffect(() => { void getCalendarPeople().then(setPeople).catch(() => setPeople([])); }, []);

  const step = (dir: 1 | -1) => setAnchor(a => view === "day" ? addDays(a, dir) : view === "month" ? new Date(a.getFullYear(), a.getMonth() + dir, 1)
    : addDays(a, dir * (view === "list" ? 14 : 7)));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || opened || creating || (t && (t.closest("input, textarea, select, [contenteditable=true]")))) return;
      const k = e.key.toLowerCase();
      if (k === "t") setAnchor(startOfDay(new Date()));
      else if (k === "m") setView("month"); else if (k === "w") setView("week"); else if (k === "d") setView("day"); else if (k === "l") setView("list");
      else if (e.key === "ArrowLeft") step(ar ? 1 : -1); else if (e.key === "ArrowRight") step(ar ? -1 : 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const shown = useMemo(() => (items ?? []).filter(i => !hidden.has(i.type)), [items, hidden]);
  const byDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const item of shown) { const key = item.at ? item.at.slice(0, 10) : ""; map.set(key, [...(map.get(key) ?? []), item]); }
    return map;
  }, [shown]);
  const counts = useMemo(() => { const c = new Map<ItemType, number>(); (items ?? []).forEach(i => c.set(i.type, (c.get(i.type) ?? 0) + 1)); return c; }, [items]);

  async function move(item: AgendaItem, at: Date) {
    if (!item.movable || item.version == null) return;
    const before = items;
    const length = (endOf(item)?.getTime() ?? 0) - (startOf(item)?.getTime() ?? 0);
    setItems(xs => (xs ?? []).map(x => x === item ? { ...x, at: iso(at), endsAt: iso(new Date(at.getTime() + Math.max(length, 15 * 60000))) } : x));
    try { await moveActivity(item.id, item.version, iso(at)); setNotice(l.moved); await load(); }
    catch (e) { setItems(before); setError(problem(e, ar)); }
  }

  const Prev = ar ? ChevronRight : ChevronLeft, Next = ar ? ChevronLeft : ChevronRight;
  const range = view === "month" ? anchor.toLocaleDateString(locale, { month: "long", year: "numeric" })
    : view === "day" ? anchor.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : `${from.toLocaleDateString(locale, { day: "numeric", month: "short" })} – ${to.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}`;
  return <section className="page-enter agenda-page calendar-page">
    <PageHeader eyebrow={l.eyebrow} title={<><CalendarDays size={24}/>{l.title}</>} description={l.hint}
      actions={own ? <button type="button" className="btn btn-primary" onClick={() => setCreating(nextSlot(view === "day" ? anchor : new Date()))}><CalendarPlus size={17}/>{l.newItem}</button> : undefined}/>
    <div className="agenda-toolbar">
      <div className="agenda-nav">
        <button type="button" className="icon-button" aria-label={l.previous} onClick={() => step(-1)}><Prev size={18}/></button>
        <button type="button" className="btn btn-secondary" onClick={() => setAnchor(startOfDay(new Date()))}>{l.today}</button>
        <button type="button" className="icon-button" aria-label={l.next} onClick={() => step(1)}><Next size={18}/></button>
        <strong className="agenda-range" aria-live="polite">{range}</strong>
      </div>
      <div className="segmented" role="group" aria-label={l.title}>{(["month", "week", "day", "list"] as View[]).map(v =>
        <button key={v} type="button" className={view === v ? "chosen" : ""} aria-pressed={view === v} onClick={() => setView(v)}>{l.views[v]}</button>)}</div>
      {people.length > 1 && <label className="calendar-person"><span className="sr-only">{l.whose}</span>
        <select value={person ?? ""} onChange={e => setPerson(e.target.value ? Number(e.target.value) : null)} aria-label={l.whose}>
          {people.map(p => <option key={p.id} value={p.me ? "" : p.id}>{p.me ? l.mine : p.name}</option>)}</select></label>}
      <button type="button" className="icon-button" aria-label={l.refresh} onClick={() => void load()}><RefreshCw size={18}/></button>
    </div>
    <div className="calendar-legend" role="group" aria-label={l.show}>{TYPES.map(t => <button key={t} type="button" aria-pressed={!hidden.has(t)}
      className={"calendar-chip type-" + t.toLowerCase() + (hidden.has(t) ? " is-off" : "")}
      onClick={() => setHidden(h => { const n = new Set(h); if (n.has(t)) n.delete(t); else n.add(t); return n; })}>
      <i aria-hidden="true"/>{l.types[t]}{counts.get(t) ? <b dir="ltr">{counts.get(t)}</b> : null}</button>)}</div>
    {own && late.length > 0 && <section className="calendar-late" aria-label={l.overdue}>
      <strong><CircleAlert size={16}/>{l.overdueTitle(late.length)}</strong>
      <div>{late.slice(0, 8).map(i => <ItemChip key={"late" + i.id} item={i} l={l} locale={locale} compact late onOpen={setOpened}/>)}
        {late.length > 8 && <span className="calendar-muted">{l.more(late.length - 8)}</span>}</div>
    </section>}
    {!own && <p className="daily-note" role="note"><UsersRound size={15}/>{l.readOnly}</p>}
    {notice && <p className="daily-note" role="status"><Check size={15}/>{notice}</p>}
    {error && <div className="error-banner" role="alert"><CircleAlert size={17}/><span>{error}</span><button type="button" className="btn btn-secondary" onClick={() => void load()}>{l.refresh}</button></div>}
    {items === null ? <div className="empty-state" role="status">{l.loading}</div>
      : view === "month" ? <MonthGrid l={l} locale={locale} from={from} anchor={anchor} byDay={byDay} own={own}
          onDay={d => { setAnchor(d); setView("day"); }} onOpen={setOpened} onCreate={d => setCreating(d)}/>
      : view === "list" ? <ListView l={l} locale={locale} from={from} to={to} byDay={byDay} onOpen={setOpened}/>
      : <TimeGrid l={l} locale={locale} days={Array.from({ length: view === "day" ? 1 : 7 }, (_, i) => addDays(from, i))} byDay={byDay} own={own}
          onOpen={setOpened} onCreate={d => setCreating(d)} onMove={(i, d) => void move(i, d)}/>}
    {own && view !== "list" && view !== "month" && <p className="calendar-foot">{l.dragHint} · <span>{l.keys}</span></p>}
    {opened && <ItemDialog l={l} locale={locale} item={opened} onClose={() => setOpened(null)}
      onChanged={msg => { setOpened(null); setNotice(msg); void load(); }}/>}
    {creating && <CreateDialog l={l} start={creating} onClose={() => setCreating(null)} onCreated={() => { setCreating(null); setNotice(l.added); void load(); }}/>}
  </section>;
}

/** The next quarter hour from now, or 09:00 on a future day. */
function nextSlot(day: Date): Date {
  const now = new Date();
  if (startOfDay(day).getTime() !== startOfDay(now).getTime()) return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0);
  const m = Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / SNAP) * SNAP;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(m / 60), m % 60);
}

function ItemChip({ item, l, locale, compact, late, onOpen }: { item: AgendaItem; l: Labels; locale: string; compact?: boolean; late?: boolean; onOpen: (i: AgendaItem) => void }) {
  const Icon = icon(item);
  const s = startOf(item);
  const title = item.title || (item.type === "AUDIT" ? l.audit : l.types[item.type]);
  return <button type="button" className={"calendar-item type-" + item.type.toLowerCase() + (item.status === "DONE" ? " is-done" : "") + (overdue(item) ? " is-overdue" : "") + (compact ? " is-compact" : "")}
    onClick={() => onOpen(item)} title={title}>
    <Icon size={13} aria-hidden="true"/>{!allDay(item) && s && <time>{late ? s.toLocaleDateString(locale, { day: "numeric", month: "short" }) + " " : ""}{s.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</time>}<span>{title}</span>
  </button>;
}

function MonthGrid({ l, locale, from, anchor, byDay, own, onDay, onOpen, onCreate }: {
  l: Labels; locale: string; from: Date; anchor: Date; byDay: Map<string, AgendaItem[]>; own: boolean;
  onDay: (d: Date) => void; onOpen: (i: AgendaItem) => void; onCreate: (d: Date) => void;
}) {
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  const todayKey = localDate(new Date());
  return <div className="calendar-month" role="grid" aria-label={anchor.toLocaleDateString(locale, { month: "long", year: "numeric" })}>
    <div className="calendar-month-head" role="row">{days.slice(0, 7).map(d => <span key={d.getDay()} role="columnheader">{d.toLocaleDateString(locale, { weekday: "short" })}</span>)}</div>
    {Array.from({ length: 6 }, (_, w) => <div key={w} className="calendar-month-week" role="row">{days.slice(w * 7, w * 7 + 7).map(d => {
      const key = localDate(d), list = byDay.get(key) ?? [];
      return <div key={key} role="gridcell" className={"calendar-month-day" + (d.getMonth() !== anchor.getMonth() ? " is-outside" : "") + (key === todayKey ? " is-today" : "")}
        onDoubleClick={() => own && onCreate(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0))}>
        <button type="button" className="calendar-month-date" onClick={() => onDay(d)} aria-label={d.toLocaleDateString(locale, { dateStyle: "full" })}>{d.getDate()}</button>
        <div className="calendar-month-items">{list.slice(0, 3).map(i => <ItemChip key={i.type + i.id} item={i} l={l} locale={locale} compact onOpen={onOpen}/>)}
          {list.length > 3 && <button type="button" className="calendar-more" onClick={() => onDay(d)}>{l.more(list.length - 3)}</button>}</div>
      </div>; })}</div>)}
  </div>;
}

function ListView({ l, locale, from, to, byDay, onOpen }: {
  l: Labels; locale: string; from: Date; to: Date; byDay: Map<string, AgendaItem[]>; onOpen: (i: AgendaItem) => void;
}) {
  const days: Date[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if ((byDay.get(localDate(d))?.length ?? 0) > 0) days.push(d);
  const todayKey = localDate(new Date());
  if (!days.length) return <div className="empty-state agenda-empty"><CalendarDays size={30}/><strong>{l.empty}</strong><span>{l.emptyHint}</span></div>;
  return <div className="agenda-days">{days.map(d => { const key = localDate(d); return <section key={key} className={"agenda-day" + (key === todayKey ? " is-today" : "")}
    aria-label={d.toLocaleDateString(locale, { dateStyle: "full" })}>
    <header><b>{d.getDate()}</b><span>{d.toLocaleDateString(locale, { weekday: "long", month: "long" })}</span>{key === todayKey && <em>{l.today}</em>}</header>
    <ol>{(byDay.get(key) ?? []).map(item => {
      const Icon = icon(item), href = recordHref(item.recordType, item.recordId), s = startOf(item);
      const late = overdue(item);
      const title = item.title || (item.type === "AUDIT" ? l.audit : l.types[item.type]);
      return <li key={item.type + item.id} className={"agenda-item type-" + item.type.toLowerCase() + " is-" + item.type.toLowerCase() + (item.status === "DONE" ? " is-done" : "") + (late ? " is-overdue" : "")}>
        <time>{allDay(item) ? l.allDay : s?.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) ?? ""}</time>
        <span className="agenda-icon"><Icon size={16}/></span>
        <button type="button" className="agenda-item-main" onClick={() => onOpen(item)}><strong>{title}</strong>
          <small>{item.type === "ACTIVITY" && item.kind ? l.kinds[item.kind] : l.types[item.type]}{item.status === "DONE" ? " · " + l.done : late ? " · " + l.overdue : ""}</small></button>
        {href && <a className="text-action" href={href}>{l.open}</a>}
      </li>; })}</ol>
  </section>; })}</div>;
}

/** The day and week grids: hours down the side, one column per day, items placed by time; your own planned items can be dragged. */
function TimeGrid({ l, locale, days, byDay, own, onOpen, onCreate, onMove }: {
  l: Labels; locale: string; days: Date[]; byDay: Map<string, AgendaItem[]>; own: boolean;
  onOpen: (i: AgendaItem) => void; onCreate: (d: Date) => void; onMove: (i: AgendaItem, d: Date) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [drag, setDrag] = useState<{ item: AgendaItem; dx: number; dy: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number; grabMinutes: number; moved: boolean } | null>(null);
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 60000); return () => window.clearInterval(t); }, []);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 7 * HOUR; }, []);
  const todayKey = localDate(now);
  const allDayItems = days.map(d => (byDay.get(localDate(d)) ?? []).filter(allDay));
  const hasAllDay = allDayItems.some(x => x.length > 0);

  /** The time under the pointer: the slot clicked (rounded down), or for a drop the nearest quarter hour to where the item's top lands. */
  const slotAt = (clientX: number, clientY: number, grabMinutes?: number): Date | null => {
    // the dragged item itself is under the pointer, so look through it for the day column actually there
    const el = document.elementsFromPoint(clientX, clientY).find((x): x is HTMLElement => x instanceof HTMLElement && x.classList.contains("calendar-col"));
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const raw = (clientY - rect.top) / HOUR * 60;
    const minutes = grabMinutes == null ? Math.floor(raw / SNAP) * SNAP : Math.round((raw - grabMinutes) / SNAP) * SNAP;
    const [y, m, d] = el.dataset.day!.split("-").map(Number);
    return new Date(y, m - 1, d, 0, Math.max(0, Math.min(24 * 60 - SNAP, minutes)));
  };
  function down(e: ReactPointerEvent, item: AgendaItem) {
    if (!own || !item.movable || e.button !== 0) return;
    const s = startOf(item)!;
    const col = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-day]")!.getBoundingClientRect();
    dragStart.current = { x: e.clientX, y: e.clientY, grabMinutes: (e.clientY - col.top) / HOUR * 60 - (s.getHours() * 60 + s.getMinutes()), moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function moveP(e: ReactPointerEvent, item: AgendaItem) {
    const st = dragStart.current;
    if (!st) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.moved && Math.hypot(dx, dy) < 6) return;
    st.moved = true;
    setDrag({ item, dx, dy });
  }
  function up(e: ReactPointerEvent, item: AgendaItem) {
    const st = dragStart.current;
    dragStart.current = null;
    setDrag(null);
    if (!st) return;
    if (!st.moved) { onOpen(item); return; }
    const target = slotAt(e.clientX, e.clientY, st.grabMinutes);
    if (target && target.getTime() !== startOf(item)?.getTime()) onMove(item, target);
  }

  return <div className={"calendar-grid" + (days.length === 1 ? " is-day" : "")} style={{ ["--days" as string]: days.length }}>
    <div className="calendar-grid-head"><span/>{days.map(d => { const key = localDate(d); return <span key={key} className={key === todayKey ? "is-today" : ""}>
      <small>{d.toLocaleDateString(locale, { weekday: "short" })}</small><b dir="ltr">{d.getDate()}</b></span>; })}</div>
    {hasAllDay && <div className="calendar-allday"><span>{l.allDay}</span>{allDayItems.map((list, i) => <div key={i}>{list.map(item =>
      <ItemChip key={item.type + item.id} item={item} l={l} locale={locale} compact onOpen={onOpen}/>)}</div>)}</div>}
    <div className="calendar-scroll" ref={scroller}>
      <div className="calendar-body" style={{ blockSize: 24 * HOUR }}>
        <div className="calendar-hours" aria-hidden="true">{Array.from({ length: 24 }, (_, h) => <span key={h} style={{ insetBlockStart: h * HOUR }}>
          {new Date(2000, 0, 1, h).toLocaleTimeString(locale, { hour: "numeric" })}</span>)}</div>
        {days.map(d => {
          const key = localDate(d);
          const timed = (byDay.get(key) ?? []).filter(i => !allDay(i));
          const placed = lanes(timed);
          return <div key={key} className={"calendar-col" + (key === todayKey ? " is-today" : "")} data-day={key}
            onClick={e => { if (!own || (e.target as HTMLElement).closest(".calendar-event")) return; const at = slotAt(e.clientX, e.clientY); if (at) onCreate(at); }}>
            {key === todayKey && <div className="calendar-now" style={{ insetBlockStart: (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR }} aria-hidden="true"/>}
            {timed.map(item => {
              const s = startOf(item)!, e = endOf(item)!;
              const top = (s.getHours() * 60 + s.getMinutes()) / 60 * HOUR;
              const height = Math.max(22, (e.getTime() - s.getTime()) / 3600000 * HOUR - 2);
              const { lane, of } = placed.get(item) ?? { lane: 0, of: 1 };
              const Icon = icon(item);
              const dragging = drag?.item === item;
              const title = item.title || l.types[item.type];
              return <button key={item.type + item.id} type="button"
                className={"calendar-event type-" + item.type.toLowerCase() + (item.status === "DONE" ? " is-done" : "") + (overdue(item) ? " is-overdue" : "") + (item.movable && own ? " is-movable" : "") + (dragging ? " is-dragging" : "")}
                style={{ insetBlockStart: top, blockSize: height, zIndex: 2 + lane, insetInlineStart: `calc(${lane} * 100% / ${of})`,
                  // overlapping items cascade: each but the last reaches into the next lane, so titles stay readable in a narrow week column
                  inlineSize: lane < of - 1 ? `calc(100% / ${of} * 1.7 - 4px)` : `calc(100% / ${of} - 4px)`,
                  transform: dragging ? `translate(${drag!.dx}px, ${drag!.dy}px)` : undefined }}
                onPointerDown={ev => down(ev, item)} onPointerMove={ev => moveP(ev, item)} onPointerUp={ev => up(ev, item)}
                onPointerCancel={() => { dragStart.current = null; setDrag(null); }}
                onClick={ev => { ev.stopPropagation(); if (!(own && item.movable)) onOpen(item); }}
                onKeyDown={ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onOpen(item); } }}
                aria-label={`${title}, ${s.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`}>
                <span className="calendar-event-time"><Icon size={12} aria-hidden="true"/>{s.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</span>
                <span className="calendar-event-title">{title}</span>
              </button>;
            })}
          </div>;
        })}
      </div>
    </div>
  </div>;
}

/** A planned activity whose time has passed, or a corrective action still open after its due day. */
function overdue(item: AgendaItem) {
  const s = startOf(item)?.getTime();
  if (s == null) return false;
  return (item.type === "ACTIVITY" && item.status === "PLANNED" && s < Date.now())
    || (item.type === "ACTION" && item.status === "OPEN" && s < startOfDay(new Date()).getTime());
}

function statusText(item: AgendaItem, l: Labels) {
  if (item.status === "DONE") return l.done;
  if (item.status === "CANCELLED") return l.cancelled;
  if (overdue(item)) return l.overdue;
  return item.type === "ACTIVITY" ? l.planned : "";
}

/** 10:00 a number of days from today, for postponing an item in one click. */
const snooze = (days: number) => `${localDate(addDays(new Date(), days))}T10:00`;

/** One item: what and when, the record it belongs to, and for your own planned activity: done, reschedule or cancel. */
function ItemDialog({ l, locale, item, onClose, onChanged }: { l: Labels; locale: string; item: AgendaItem; onClose: () => void; onChanged: (msg: string) => void }) {
  const s = startOf(item), e = endOf(item);
  const href = recordHref(item.recordType, item.recordId);
  const editable = !!item.movable && item.status === "PLANNED" && item.version != null;
  const [mode, setMode] = useState<"" | "done" | "move" | "cancel">("");
  const [outcome, setOutcome] = useState("");
  const [date, setDate] = useState(s ? localDate(s) : localDate(new Date()));
  const [time, setTime] = useState(s ? s.toTimeString().slice(0, 5) : "09:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const title = item.title || (item.type === "AUDIT" ? l.audit : l.types[item.type]);
  const Icon = icon(item);
  async function run(action: () => Promise<unknown>, msg: string) {
    setBusy(true); setError("");
    try { await action(); onChanged(msg); } catch (err) { setError(problem(err, locale.startsWith("ar"))); } finally { setBusy(false); }
  }
  return <Dialog title={title} kicker={item.type === "ACTIVITY" && item.kind ? l.kinds[item.kind] : l.types[item.type]} busy={busy} onClose={onClose}
    footer={<>{href && <a className="btn btn-secondary" href={href} onClick={onClose}><ExternalLink size={15}/>{l.open}</a>}
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.close}</button></>}>
    <dl className="calendar-facts">
      <div><dt>{l.when}</dt><dd><Icon size={14} aria-hidden="true"/> {allDay(item) ? `${s?.toLocaleDateString(locale, { dateStyle: "full" })} · ${l.allDay}`
        : `${s?.toLocaleDateString(locale, { dateStyle: "full" })} · ${s?.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}${e ? " – " + e.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : ""}`}</dd></div>
      {statusText(item, l) && <div><dt>{l.status}</dt><dd>{statusText(item, l)}</dd></div>}
    </dl>
    {editable && mode === "" && <div className="calendar-actions">
      <button type="button" className="btn btn-primary" onClick={() => setMode("done")}><Check size={15}/>{l.markDone}</button>
      <button type="button" className="btn btn-secondary" onClick={() => setMode("move")}><Clock3 size={15}/>{l.reschedule}</button>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run(() => moveActivity(item.id, item.version!, snooze(1)), l.snoozed)}>{l.snooze}</button>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run(() => moveActivity(item.id, item.version!, snooze(7)), l.snoozed)}>{l.snoozeWeek}</button>
      <button type="button" className="btn btn-danger-quiet" onClick={() => setMode("cancel")}><X size={15}/>{l.cancelItem}</button>
    </div>}
    {mode === "done" && <form className="daily-form" onSubmit={ev => { ev.preventDefault(); void run(() => finishActivity(item.id, item.version!, outcome.trim()), l.finished); }}>
      <label><span>{l.outcome}</span><textarea rows={3} maxLength={4000} value={outcome} onChange={ev => setOutcome(ev.target.value)}/></label>
      <div className="calendar-actions"><button type="submit" className="btn btn-primary" disabled={busy}><Check size={15}/>{l.markDone}</button>
        <button type="button" className="btn btn-secondary" onClick={() => setMode("")}>{l.cancel}</button></div></form>}
    {mode === "move" && <form className="daily-form daily-form-two" onSubmit={ev => { ev.preventDefault(); void run(() => moveActivity(item.id, item.version!, `${date}T${time}`), l.moved); }}>
      <label><span>{l.date}</span><input type="date" value={date} required onChange={ev => setDate(ev.target.value)}/></label>
      <label><span>{l.time}</span><input type="time" value={time} step={900} required onChange={ev => setTime(ev.target.value)}/></label>
      <div className="calendar-actions daily-span"><button type="submit" className="btn btn-primary" disabled={busy}>{l.save}</button>
        <button type="button" className="btn btn-secondary" onClick={() => setMode("")}>{l.cancel}</button></div></form>}
    {mode === "cancel" && <div><p>{l.cancelConfirm}</p><div className="calendar-actions">
      <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run(() => cancelActivity(item.id, item.version!), l.cancelledNote)}>{l.cancelItem}</button>
      <button type="button" className="btn btn-secondary" onClick={() => setMode("")}>{l.cancel}</button></div></div>}
    {error && <p className="daily-error" role="alert"><CircleAlert size={15}/>{error}</p>}
  </Dialog>;
}

/** A new item on a free time: a title, a type, its length, and optionally the lead, account or opportunity it is about. */
function CreateDialog({ l, start, onClose, onCreated }: { l: Labels; start: Date; onClose: () => void; onCreated: () => void }) {
  const ar = l === L.ar;
  const [subject, setSubject] = useState("");
  const [kind, setKind] = useState<ActivityKind>("MEETING");
  const [date, setDate] = useState(localDate(start));
  const [time, setTime] = useState(`${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`);
  const [minutes, setMinutes] = useState(30);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [link, setLink] = useState<SearchHit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (link || query.trim().length < 2) { setHits([]); return; }
    const t = window.setTimeout(() => void searchEverything(query.trim())
      .then(rows => setHits(rows.filter(r => r.type === "LEAD" || r.type === "ACCOUNT" || r.type === "OPPORTUNITY").slice(0, 6))).catch(() => setHits([])), 250);
    return () => window.clearTimeout(t);
  }, [query, link]);
  const at = new Date(`${date}T${time}`);
  const past = at.getTime() < Date.now() - 10 * 60000;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      let version: number | undefined;
      if (link) {
        const rec = link.type === "LEAD" ? await getLead(link.id) : link.type === "ACCOUNT" ? await getAccount(link.id) : await getOpportunity(link.id);
        version = (rec as { version?: number }).version;
      }
      await planItem({ record: link?.type as RecordType | undefined, recordId: link?.id, version, kind, subject: subject.trim(), at: `${date}T${time}`, minutes, planned: !past });
      onCreated();
    } catch (err) { setError(problem(err, ar)); } finally { setBusy(false); }
  }
  return <Dialog title={l.newItem} busy={busy} onClose={onClose}
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="calendar-new" className="btn btn-primary" disabled={busy || !subject.trim()}><CalendarPlus size={15}/>{busy ? l.creating : l.create}</button></>}>
    <form id="calendar-new" className="daily-form daily-form-two" onSubmit={e => void submit(e)}>
      <label className="daily-span"><span>{l.subject}</span><input value={subject} maxLength={255} required autoFocus onChange={e => setSubject(e.target.value)}/></label>
      <fieldset className="daily-span calendar-kinds"><legend>{l.kind}</legend>{KINDS.map(k => <label key={k} className={kind === k ? "is-on" : ""}>
        <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)}/>{l.kinds[k]}</label>)}</fieldset>
      <label><span>{l.date}</span><input type="date" value={date} required onChange={e => setDate(e.target.value)}/></label>
      <label><span>{l.time}</span><input type="time" value={time} step={900} required onChange={e => setTime(e.target.value)}/></label>
      <label className="daily-span"><span>{l.length}</span><select value={minutes} onChange={e => setMinutes(Number(e.target.value))}>
        {[15, 30, 45, 60, 90, 120, 180, 240].map(m => <option key={m} value={m}>{l.minutes(m)}</option>)}</select></label>
      <div className="daily-span calendar-link">
        <label><span>{l.link}</span>{link ? <span className="calendar-linked"><b>{link.title}</b><button type="button" className="text-action" onClick={() => { setLink(null); setQuery(""); }}>{l.unlink}</button></span>
          : <input value={query} placeholder={l.linkHint} onChange={e => setQuery(e.target.value)}/>}</label>
        {!link && hits.length > 0 && <ul className="calendar-hits">{hits.map(h => <li key={h.type + h.id}><button type="button" onClick={() => setLink(h)}>
          <b>{h.title}</b><small>{h.subtitle ?? h.type}</small></button></li>)}</ul>}
        {!link && <small className="calendar-muted">{l.personal}</small>}
      </div>
      {past && <p className="daily-note daily-span">{l.pastNote}</p>}
      {error && <p className="daily-error daily-span" role="alert"><CircleAlert size={15}/>{error}</p>}
    </form>
  </Dialog>;
}
