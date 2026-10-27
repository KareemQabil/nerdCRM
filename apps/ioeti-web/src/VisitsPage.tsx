import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft, ArrowRight, Building2, CalendarClock, CheckCircle2, CircleAlert, Clock3, MapPin, Pause, Play, Plus, Save, Send, UserRound, XCircle,
} from "lucide-react";
import { ApiError } from "./api";
import { Dialog } from "./Dialog";
import { localDateTime, searchEverything, wallClock } from "./dailyApi";
import {
  VISIT_ACTIONS, addVisit, addVisitNote, getVisit, getVisitPeople, getVisitTypes, getVisits, planVisit, runVisit,
  type Option, type Visit, type VisitCommand, type VisitNote,
} from "./visitApi";
import type { Language } from "./preferences";
import { VisitChecklist } from "./VisitChecklist";
import { DocumentsPanel } from "./DocumentsPanel";
import "./daily.css";
import "./visits.css";
import { ErrorBanner, PageHeader } from "./ui";

const L = {
  ar: {
    eyebrow: "التنفيذ", title: "الزيارات الميدانية", hint: "خطط الزيارة، حدد مين رايح وإمتى، وسجّل اللي حصل في الموقع. مفيش أي رسالة بتتبعت للعميل.",
    add: "زيارة جديدة", mine: "زياراتي", all: "كل الزيارات", loading: "جاري التحميل…",
    groups: { today: "النهارده", upcoming: "جاية", toPlan: "محتاجة تخطيط", active: "شغالة دلوقتي", done: "خلصت أو اتلغت" },
    empty: "مفيش زيارات هنا.", status: { TO_PLAN: "محتاجة تخطيط", PLANNED: "مخططة", STARTED: "بدأت", SUSPENDED: "متوقفة مؤقتًا", FINISHED: "خلصت", CANCELLED: "اتلغت" },
    actions: { start: "ابدأ الزيارة", resume: "كمّل الزيارة", suspend: "إيقاف مؤقت", finish: "إنهاء الزيارة", cancel: "إلغاء الزيارة", plan: "خطط / غيّر الموعد" },
    back: "الرجوع للزيارات", account: "العميل", when: "الموعد", who: "المسؤول", type: "النوع", purpose: "الغرض", spent: "الوقت في الموقع", none: "—",
    log: "سجل الزيارة", logHint: "اللي اتشاف، اللي اتفق عليه، واللي محتاج متابعة. السجل بيتضاف ومش بيتعدل.", write: "اكتب ملاحظة…", addNote: "إضافة", noNotes: "لسه مفيش ملاحظات.",
    finishBlocked: (n: number) => n === 1 ? "فاضل سؤال مطلوب في قائمة التحقق قبل إنهاء الزيارة." : `فاضل ${n} أسئلة مطلوبة في قائمة التحقق قبل إنهاء الزيارة.`,
    you: "أنت", confirmCancel: "إلغاء الزيارة؟", confirmCancelText: "الزيارة هتتلغي وهيتشال الموعد والمسؤول. مفيش رسالة هتتبعت للعميل.", keep: "رجوع",
    newTitle: "زيارة جديدة", planTitle: "خطط الزيارة", accountLabel: "الحساب", accountSearch: "اكتب اسم الحساب…", purposeLabel: "الغرض من الزيارة",
    typeLabel: "نوع الزيارة", noType: "بدون نوع", person: "مين رايح", choose: "اختر…", start: "البداية", end: "النهاية (اختياري)", later: "حدد الموعد بعدين",
    save: "حفظ", saving: "جاري الحفظ…", cancel: "إلغاء",
    errors: { NUMBERING_REQUIRED: "ترقيم الزيارات مش متظبط لسه. مسؤول النظام يظبطه من لوحة الإدارة ← الترقيم.", ADDRESS_REQUIRED: "نوع الزيارة ده محتاج عنوان العميل.",
      PAST: "مينفعش تخطط زيارة في وقت فات.", BEFORE_START: "النهاية لازم تكون بعد البداية.", REQUIRED: "حقل مطلوب ناقص.", STATUS_NOT_ALLOWED: "الإجراء ده مش متاح في حالة الزيارة دي.",
      CHECKLIST_INCOMPLETE: "جاوب أسئلة قائمة التحقق المطلوبة الأول.", UNAVAILABLE: "اختيار غير متاح.", conflict: "الزيارة اتغيرت من مكان تاني؛ اتحدّثت.", forbidden: "مش مسموح لك بالإجراء ده.",
      notFound: "الزيارة مش موجودة أو مش متاحة لك.", failed: "تعذّر تنفيذ الطلب." },
  },
  en: {
    eyebrow: "Delivery", title: "Field visits", hint: "Plan the visit, set who goes and when, and record what happened on site. Nothing is sent to the customer.",
    add: "New visit", mine: "My visits", all: "All visits", loading: "Loading…",
    groups: { today: "Today", upcoming: "Coming up", toPlan: "To plan", active: "Under way", done: "Done or cancelled" },
    empty: "No visits here.", status: { TO_PLAN: "To plan", PLANNED: "Planned", STARTED: "Started", SUSPENDED: "Paused", FINISHED: "Finished", CANCELLED: "Cancelled" },
    actions: { start: "Start visit", resume: "Resume visit", suspend: "Pause", finish: "Finish visit", cancel: "Cancel visit", plan: "Plan / reschedule" },
    back: "Back to visits", account: "Customer", when: "When", who: "Assigned to", type: "Type", purpose: "Purpose", spent: "Time on site", none: "—",
    log: "Visit log", logHint: "What was seen, what was agreed, what needs follow-up. The log is added to, never edited.", write: "Write a note…", addNote: "Add", noNotes: "No notes yet.",
    finishBlocked: (n: number) => n === 1 ? "One required checklist question is left before the visit can finish." : `${n} required checklist questions are left before the visit can finish.`,
    you: "you", confirmCancel: "Cancel this visit?", confirmCancelText: "The visit is cancelled and its time and assignee are cleared. Nothing is sent to the customer.", keep: "Back",
    newTitle: "New visit", planTitle: "Plan the visit", accountLabel: "Account", accountSearch: "Type the account name…", purposeLabel: "Purpose of the visit",
    typeLabel: "Visit type", noType: "No type", person: "Who goes", choose: "Choose…", start: "Start", end: "End (optional)", later: "Set the time later",
    save: "Save", saving: "Saving…", cancel: "Cancel",
    errors: { NUMBERING_REQUIRED: "Visit numbering is not set up yet. An administrator sets it in the admin console → Numbering.", ADDRESS_REQUIRED: "This visit type needs the customer's address.",
      PAST: "A visit cannot be planned in the past.", BEFORE_START: "The end must be after the start.", REQUIRED: "A required field is missing.", STATUS_NOT_ALLOWED: "This action is not available for the visit's status.",
      CHECKLIST_INCOMPLETE: "Answer the required checklist questions first.", UNAVAILABLE: "This choice is not available.", conflict: "The visit changed elsewhere; it was refreshed.", forbidden: "You are not allowed to do this.",
      notFound: "The visit does not exist or is not available to you.", failed: "The request failed." },
  },
};
type Labels = typeof L.ar;

function problem(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.errors.failed;
  const code = error.code && error.code in l.errors ? error.code : error.fields?.[0]?.code ?? "";
  if (code in l.errors) return (l.errors as Record<string, string>)[code];
  if (error.statusCode === 409) return l.errors.conflict;
  if (error.statusCode === 403) return l.errors.forbidden;
  if (error.statusCode === 404) return l.errors.notFound;
  return l.errors.failed;
}
const routeId = (hash: string) => { const m = hash.match(/^#\/visits\/(\d+)$/); return m ? Number(m[1]) : null; };

export function VisitsPage({ language }: { language: Language }) {
  const [id, setId] = useState(() => routeId(window.location.hash));
  useEffect(() => {
    const sync = () => setId(routeId(window.location.hash));
    window.addEventListener("hashchange", sync); window.addEventListener("popstate", sync);
    return () => { window.removeEventListener("hashchange", sync); window.removeEventListener("popstate", sync); };
  }, []);
  return id ? <VisitRecord key={id} id={id} language={language}/> : <VisitList language={language}/>;
}

function VisitList({ language }: { language: Language }) {
  const l = L[language], ar = language === "ar";
  const [mine, setMine] = useState(true);
  const [rows, setRows] = useState<Visit[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  useEffect(() => { setRows(null); getVisits(mine).then(setRows).catch(e => { setRows([]); setError(problem(e, l)); }); }, [mine, l]);
  const groups = useMemo(() => {
    const today = new Date(); const key = (d: Date | null) => d ? d.toDateString() : "";
    const g = { active: [] as Visit[], today: [] as Visit[], upcoming: [] as Visit[], toPlan: [] as Visit[], done: [] as Visit[] };
    for (const v of rows ?? []) {
      const at = wallClock(v.plannedStart);
      if (v.status === "STARTED" || v.status === "SUSPENDED") g.active.push(v);
      else if (v.status === "FINISHED" || v.status === "CANCELLED") g.done.push(v);
      else if (v.status === "TO_PLAN" || !at) g.toPlan.push(v);
      else if (key(at) === key(today)) g.today.push(v);
      else g.upcoming.push(v);
    }
    return g;
  }, [rows]);
  return <section className="page-enter visits-page">
    <PageHeader eyebrow={l.eyebrow} title={l.title} description={l.hint} actions={<><button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16}/>{l.add}</button></>}/>
    <div className="segmented" role="group">
      <button type="button" className={mine ? "chosen" : ""} aria-pressed={mine} onClick={() => setMine(true)}>{l.mine}</button>
      <button type="button" className={!mine ? "chosen" : ""} aria-pressed={!mine} onClick={() => setMine(false)}>{l.all}</button>
    </div>
    {error && <ErrorBanner message={error}/>}
    {rows === null ? <div className="empty-state" role="status">{l.loading}</div> :
      (["active", "today", "upcoming", "toPlan", "done"] as const).map(g => groups[g].length > 0 && <section key={g} className={"visit-group is-" + g} aria-label={l.groups[g]}>
        <h2>{l.groups[g]}<b>{groups[g].length}</b></h2>
        <ul>{groups[g].map(v => <li key={v.id}><VisitCard v={v} l={l} ar={ar}/></li>)}</ul>
      </section>)}
    {rows !== null && rows.length === 0 && !error && <div className="empty-state"><MapPin size={28}/><span>{l.empty}</span></div>}
    {adding && <NewVisitDialog language={language} onClose={() => setAdding(false)} onSaved={v => { setAdding(false); window.location.hash = "#/visits/" + v.id; }}/>}
  </section>;
}

function VisitCard({ v, l, ar }: { v: Visit; l: Labels; ar: boolean }) {
  const at = wallClock(v.plannedStart);
  return <a className={"visit-card is-" + v.status.toLowerCase()} href={"#/visits/" + v.id}>
    <span className="visit-time">{at ? <><b>{at.toLocaleTimeString(ar ? "ar-EG" : "en-GB", { hour: "2-digit", minute: "2-digit" })}</b>
      <small>{at.toLocaleDateString(ar ? "ar-EG" : "en-GB", { weekday: "short", day: "numeric", month: "short" })}</small></> : <Clock3 size={18}/>}</span>
    <span className="visit-main"><strong>{v.accountName ?? v.reference ?? "—"}</strong><small>{v.purpose ?? ""}</small></span>
    <span className="visit-side"><span className={"visit-status is-" + v.status.toLowerCase()}>{l.status[v.status]}</span>
      {v.assigneeName && <small><UserRound size={12}/>{v.mine ? l.you : v.assigneeName}</small>}</span>
  </a>;
}

function VisitRecord({ id, language }: { id: number; language: Language }) {
  const l = L[language], ar = language === "ar";
  const [data, setData] = useState<{ visit: Visit; log: VisitNote[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [dialog, setDialog] = useState<"plan" | "cancel" | null>(null);
  const [requiredOpen, setRequiredOpen] = useState(0);
  const load = useCallback(() => getVisit(id).then(setData).catch(e => setError(problem(e, l))), [id, l]);
  useEffect(() => { void load(); }, [load]);
  const Back = ar ? ArrowRight : ArrowLeft;
  const v = data?.visit;
  const when = (value: string | null) => wallClock(value)?.toLocaleString(ar ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) ?? l.none;
  async function act(command: VisitCommand) {
    if (!v) return;
    setBusy(true); setError("");
    try { const saved = await runVisit(v.id, v.version, command); setData(d => d ? { ...d, visit: saved } : d); setDialog(null); }
    catch (e) { setError(problem(e, l)); if (e instanceof ApiError && e.statusCode === 409) void load(); }
    finally { setBusy(false); }
  }
  async function note(e: FormEvent) {
    e.preventDefault();
    if (!v || !text.trim()) return;
    setBusy(true); setError("");
    try { await addVisitNote(v.id, v.version, text.trim()); setText(""); await load(); }
    catch (failure) { setError(problem(failure, l)); }
    finally { setBusy(false); }
  }
  const actions = v ? VISIT_ACTIONS[v.status] : [];
  const minutes = v?.durationSeconds ? Math.round(v.durationSeconds / 60) : null;
  return <article className="page-enter visit-record">
    <div className="record-context-bar"><a className="record-back" href="#/visits"><Back size={17}/>{l.back}</a></div>
    {error && <ErrorBanner message={error}/>}
    {!v ? (!error && <div className="empty-state" role="status">{l.loading}</div>) : <>
      <header className={"visit-hero is-" + v.status.toLowerCase()}>
        <div className="visit-hero-top"><span className={"visit-status is-" + v.status.toLowerCase()}>{l.status[v.status]}</span>
          <span className="visit-ref" dir="ltr">{v.reference}</span></div>
        <h1>{v.accountName ?? v.reference}</h1>
        {v.purpose && <p>{v.purpose}</p>}
        <dl className="visit-facts">
          <div><dt><CalendarClock size={14}/>{l.when}</dt><dd>{when(v.plannedStart)}</dd></div>
          <div><dt><UserRound size={14}/>{l.who}</dt><dd>{v.mine ? l.you : v.assigneeName ?? l.none}</dd></div>
          {v.type && <div><dt>{l.type}</dt><dd>{v.type}</dd></div>}
          {minutes != null && <div><dt><Clock3 size={14}/>{l.spent}</dt><dd>{minutes} {ar ? "دقيقة" : "min"}</dd></div>}
          {v.accountId && <div><dt><Building2 size={14}/>{l.account}</dt><dd><a href={"#/accounts/" + v.accountId}>{v.accountName}</a></dd></div>}
        </dl>
        {actions.length > 0 && <div className="visit-actions">
          {actions.includes("start") && <button type="button" className="btn btn-primary visit-big" disabled={busy} onClick={() => void act("start")}><Play size={18}/>{v.status === "SUSPENDED" ? l.actions.resume : l.actions.start}</button>}
          {actions.includes("finish") && <button type="button" className="btn btn-primary visit-big is-finish" disabled={busy} onClick={() => void act("finish")}
            aria-describedby={requiredOpen ? "visit-finish-blocked" : undefined}><CheckCircle2 size={18}/>{l.actions.finish}</button>}
          {actions.includes("suspend") && <button type="button" className="btn btn-secondary visit-big" disabled={busy} onClick={() => void act("suspend")}><Pause size={18}/>{l.actions.suspend}</button>}
          {actions.includes("plan") && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setDialog("plan")}><CalendarClock size={16}/>{l.actions.plan}</button>}
          {actions.includes("cancel") && <button type="button" className="btn btn-secondary visit-cancel" disabled={busy} onClick={() => setDialog("cancel")}><XCircle size={16}/>{l.actions.cancel}</button>}
        </div>}
      </header>
      {actions.includes("finish") && requiredOpen > 0 && <p id="visit-finish-blocked" className="daily-note visit-finish-blocked"><CircleAlert size={14}/>{l.finishBlocked(requiredOpen)}</p>}
      <VisitChecklist visit={v} language={language} onChanged={c => setRequiredOpen(c.generated ? c.requiredOpen : 0)}/>
      <section className="record-content-card visit-log" aria-labelledby="visit-log-title">
        <h2 id="visit-log-title">{l.log}</h2><p className="daily-note">{l.logHint}</p>
        {v.status !== "CANCELLED" && <form className="visit-note-form" onSubmit={e => void note(e)}>
          <textarea value={text} rows={2} maxLength={4000} placeholder={l.write} aria-label={l.write} onChange={e => setText(e.target.value)}/>
          <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}><Send size={16}/>{l.addNote}</button>
        </form>}
        {data.log.length === 0 ? <p className="activity-empty">{l.noNotes}</p> :
          <ol className="visit-notes">{data.log.map(n => <li key={n.id}><p>{n.text}</p><small>{when(n.at)} · {n.mine ? l.you : n.authorName}</small></li>)}</ol>}
      </section>
      <section className="record-content-card"><DocumentsPanel subject="VISIT" subjectId={v.id} language={language}/></section>
      {dialog === "plan" && <PlanDialog l={l} visit={v} onClose={() => setDialog(null)} onSaved={saved => { setDialog(null); setData(d => d ? { ...d, visit: saved } : d); }}/>}
      {dialog === "cancel" && <Dialog title={l.confirmCancel} description={l.confirmCancelText} kicker={v.accountName ?? ""} busy={busy} onClose={() => setDialog(null)}
        footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setDialog(null)}>{l.keep}</button>
          <button type="button" className="btn btn-primary admin-danger" disabled={busy} onClick={() => void act("cancel")}><XCircle size={16}/>{l.actions.cancel}</button></>}>{null}</Dialog>}
    </>}
  </article>;
}

function tomorrowAtTen() { const d = new Date(); return localDateTime(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 10, 0)); }

function PlanDialog({ l, visit, onClose, onSaved }: { l: Labels; visit: Visit; onClose: () => void; onSaved: (v: Visit) => void }) {
  const [people, setPeople] = useState<Option[]>([]);
  const [person, setPerson] = useState(visit.assigneeId ? String(visit.assigneeId) : "");
  const [start, setStart] = useState(visit.plannedStart?.slice(0, 16) ?? tomorrowAtTen());
  const [end, setEnd] = useState(visit.plannedEnd?.slice(0, 16) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void getVisitPeople().then(setPeople).catch(() => setPeople([])); }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try { onSaved(await planVisit(visit.id, visit.version, Number(person), start, end)); }
    catch (failure) { setError(problem(failure, l)); }
    finally { setBusy(false); }
  }
  return <Dialog title={l.planTitle} kicker={visit.accountName ?? ""} busy={busy} onClose={onClose}
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="plan-visit-form" className="btn btn-primary" disabled={busy || !person}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="plan-visit-form" className="daily-form daily-form-two" onSubmit={e => void submit(e)}>
      <label className="daily-span"><span>{l.person}</span><select value={person} required onChange={e => setPerson(e.target.value)}><option value="">{l.choose}</option>
        {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label><span>{l.start}</span><input type="datetime-local" value={start} required onChange={e => setStart(e.target.value)}/></label>
      <label><span>{l.end}</span><input type="datetime-local" value={end} min={start} onChange={e => setEnd(e.target.value)}/></label>
      {error && <p className="daily-error daily-span" role="alert"><CircleAlert size={15}/>{error}</p>}
    </form>
  </Dialog>;
}

/** Plan a new visit; used from the visits page and from an account's page (account preset). */
export function NewVisitDialog({ language, account, onClose, onSaved }: {
  language: Language; account?: { id: number; name: string }; onClose: () => void; onSaved: (v: Visit) => void;
}) {
  const l = L[language];
  const [chosen, setChosen] = useState<{ id: number; name: string } | null>(account ?? null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: number; name: string }[]>([]);
  const [purpose, setPurpose] = useState("");
  const [types, setTypes] = useState<Option[]>([]);
  const [typeId, setTypeId] = useState("");
  const [people, setPeople] = useState<Option[]>([]);
  const [person, setPerson] = useState("");
  const [later, setLater] = useState(false);
  const [start, setStart] = useState(tomorrowAtTen());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void getVisitTypes().then(setTypes).catch(() => setTypes([]));
    void getVisitPeople().then(setPeople).catch(() => setPeople([]));
  }, []);
  useEffect(() => {
    if (chosen || q.trim().length < 2) { setHits([]); return; }
    const t = window.setTimeout(() => void searchEverything(q.trim())
      .then(rows => setHits(rows.filter(r => r.type === "ACCOUNT").map(r => ({ id: r.id, name: r.title })))).catch(() => setHits([])), 250);
    return () => window.clearTimeout(t);
  }, [q, chosen]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    setBusy(true); setError("");
    try {
      onSaved(await addVisit({ accountId: chosen.id, purpose: purpose.trim(), typeId: typeId ? Number(typeId) : undefined,
        ...(later || !person ? {} : { assignedToId: Number(person), start }) }));
    } catch (failure) { setError(problem(failure, l)); }
    finally { setBusy(false); }
  }
  return <Dialog title={l.newTitle} kicker={l.title} busy={busy} onClose={onClose} wide
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="new-visit-form" className="btn btn-primary" disabled={busy || !chosen}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="new-visit-form" className="daily-form daily-form-two" onSubmit={e => void submit(e)}>
      <div className="daily-span visit-account-pick"><span>{l.accountLabel}</span>
        {chosen ? <span className="chip">{chosen.name}{!account && <button type="button" aria-label={`× ${chosen.name}`} onClick={() => { setChosen(null); setQ(""); }}>×</button>}</span>
          : <><input value={q} placeholder={l.accountSearch} aria-label={l.accountLabel} onChange={e => setQ(e.target.value)}/>
            {hits.length > 0 && <ul role="listbox" aria-label={l.accountLabel}>{hits.map(h => <li key={h.id} role="option" aria-selected={false}>
              <button type="button" onClick={() => setChosen(h)}><Building2 size={14}/>{h.name}</button></li>)}</ul>}</>}
      </div>
      <label className="daily-span"><span>{l.purposeLabel}</span><textarea value={purpose} required maxLength={4000} rows={2} onChange={e => setPurpose(e.target.value)}/></label>
      <label><span>{l.typeLabel}</span><select value={typeId} onChange={e => setTypeId(e.target.value)}><option value="">{l.noType}</option>
        {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label><span>{l.person}</span><select value={person} disabled={later} onChange={e => setPerson(e.target.value)}><option value="">{l.choose}</option>
        {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {!later && person && <label><span>{l.start}</span><input type="datetime-local" value={start} required onChange={e => setStart(e.target.value)}/></label>}
      <label className="daily-confirm-plain"><input type="checkbox" checked={later} onChange={e => setLater(e.target.checked)}/>{l.later}</label>
      {error && <p className="daily-error daily-span" role="alert"><CircleAlert size={15}/>{error}</p>}
    </form>
  </Dialog>;
}
