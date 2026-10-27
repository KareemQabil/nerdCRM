import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CalendarClock, CheckCircle2, CircleAlert, ClipboardList, NotebookPen, PhoneCall, Save, UsersRound } from "lucide-react";
import { getActivities, localDateTime, logActivity, problem, wallClock, type Activity, type ActivityKind, type RecordType } from "./dailyApi";
import type { Language } from "./preferences";
import "./daily.css";

const KINDS: ActivityKind[] = ["CALL", "MEETING", "TASK", "NOTE"];
const ICONS = { CALL: PhoneCall, MEETING: UsersRound, TASK: ClipboardList, NOTE: NotebookPen } as const;
const L = {
  ar: {
    title: "الأنشطة", hint: "سجّل اللي حصل أو خطط للخطوة الجاية. المخطط بيظهر في أجندتك.",
    kinds: { CALL: "مكالمة", MEETING: "اجتماع", TASK: "مهمة", NOTE: "ملاحظة" },
    done: "حصل", planned: "مخطط", subject: "الموضوع", at: "الوقت", outcome: "النتيجة (اختياري)",
    outcomeHint: "تُحفظ على النشاط ولا تُعرض في القوائم.", save: "تسجيل", saving: "جاري التسجيل…",
    empty: "لا توجد أنشطة بعد. ابدأ بتسجيل أول مكالمة أو اجتماع.", by: "بواسطة", you: "أنت",
    status: { PLANNED: "مخطط", DONE: "تم", CANCELED: "ملغي" }, outcomeSaved: "نتيجة مسجلة", loading: "جاري التحميل…",
    placeholder: { CALL: "مثال: مكالمة تعريفية بالخدمة", MEETING: "مثال: اجتماع مراجعة العرض", TASK: "مثال: تجهيز عرض السعر", NOTE: "مثال: يفضلون التواصل صباحًا" },
  },
  en: {
    title: "Activities", hint: "Log what happened or plan the next step. Planned items appear in your agenda.",
    kinds: { CALL: "Call", MEETING: "Meeting", TASK: "Task", NOTE: "Note" },
    done: "Done", planned: "Planned", subject: "Subject", at: "When", outcome: "Outcome (optional)",
    outcomeHint: "Kept on the activity; never shown in lists.", save: "Log it", saving: "Saving…",
    empty: "No activities yet. Start by logging the first call or meeting.", by: "by", you: "you",
    status: { PLANNED: "Planned", DONE: "Done", CANCELED: "Cancelled" }, outcomeSaved: "Outcome recorded", loading: "Loading…",
    placeholder: { CALL: "e.g. Introductory call", MEETING: "e.g. Proposal review meeting", TASK: "e.g. Prepare the quotation", NOTE: "e.g. Prefers morning calls" },
  },
} as const;

function defaultTime(planned: boolean): string {
  const now = new Date();
  if (!planned) return localDateTime(now);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 10, 0);
  return localDateTime(tomorrow);
}

/** The activity timeline of one lead, account or opportunity, with a quick composer. Logging moves the
 * record's version, so the parent reloads the record through onChanged. */
export function ActivityPanel({ record, recordId, version, language, onChanged }: {
  record: RecordType; recordId: number; version: number | null | undefined; language: Language; onChanged?: () => void | Promise<void>;
}) {
  const l = L[language], ar = language === "ar";
  const [items, setItems] = useState<Activity[] | null>(null);
  const [kind, setKind] = useState<ActivityKind>("CALL");
  const [planned, setPlanned] = useState(false);
  const [subject, setSubject] = useState("");
  const [at, setAt] = useState(() => defaultTime(false));
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // a failed background read is shown quietly in place; only a refused change is announced
  const [loadError, setLoadError] = useState("");
  const load = useCallback(() => getActivities(record, recordId).then(rows => { setItems(rows); setLoadError(""); })
    .catch(e => { setItems([]); setLoadError(problem(e, ar)); }), [record, recordId, ar]);
  useEffect(() => { void load(); }, [load]);
  const note = kind === "NOTE";
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || version == null) return;
    setBusy(true); setError("");
    try {
      await logActivity({ record, recordId, version, kind, subject: subject.trim(), at: note ? undefined : at,
        outcome: !planned && outcome.trim() ? outcome.trim() : undefined, planned: !note && planned });
      setSubject(""); setOutcome(""); setAt(defaultTime(planned));
      await Promise.all([load(), onChanged?.()]);
    } catch (failure) { setError(problem(failure, ar)); }
    finally { setBusy(false); }
  }
  const format = (value: string | null) => wallClock(value)?.toLocaleString(ar ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) ?? "—";
  return <section className="activity-panel" aria-labelledby={`activity-${record}-${recordId}`}>
    <div className="activity-head"><div><h2 id={`activity-${record}-${recordId}`}><CalendarClock size={18}/>{l.title}</h2><p>{l.hint}</p></div></div>
    {version != null && <form className="activity-composer" onSubmit={e => void submit(e)}>
      <div className="activity-kinds" role="group" aria-label={l.title}>
        {KINDS.map(k => { const Icon = ICONS[k]; return <button key={k} type="button" className={kind === k ? "chosen" : ""} aria-pressed={kind === k}
          onClick={() => setKind(k)}><Icon size={15}/>{l.kinds[k]}</button>; })}
      </div>
      {!note && <div className="segmented activity-when" role="group">
        <button type="button" className={!planned ? "chosen" : ""} aria-pressed={!planned} onClick={() => { setPlanned(false); setAt(defaultTime(false)); }}>{l.done}</button>
        <button type="button" className={planned ? "chosen" : ""} aria-pressed={planned} onClick={() => { setPlanned(true); setAt(defaultTime(true)); }}>{l.planned}</button>
      </div>}
      <div className="activity-fields">
        <label><span>{l.subject}</span><input value={subject} required maxLength={255} placeholder={l.placeholder[kind]} onChange={e => setSubject(e.target.value)}/></label>
        {!note && <label><span>{l.at}</span><input type="datetime-local" value={at} required onChange={e => setAt(e.target.value)}/></label>}
      </div>
      {!planned && <label className="activity-outcome"><span>{l.outcome}</span><textarea value={outcome} maxLength={4000} rows={2} onChange={e => setOutcome(e.target.value)}/>
        <small>{l.outcomeHint}</small></label>}
      {error && <p className="daily-error" role="alert"><CircleAlert size={15}/>{error}</p>}
      <div className="activity-actions"><button type="submit" className="btn btn-primary" disabled={busy || !subject.trim()}><Save size={16}/>{busy ? l.saving : l.save}</button></div>
    </form>}
    {items === null ? <p className="activity-empty" role="status">{l.loading}</p>
      : loadError ? <p className="activity-empty"><CircleAlert size={14}/> {loadError}</p>
      : items.length === 0 ? <p className="activity-empty">{l.empty}</p>
      : <ol className="activity-list">{items.map(item => { const Icon = ICONS[item.kind] ?? NotebookPen; return <li key={item.id} className={"activity-item is-" + item.status.toLowerCase()}>
        <span className="activity-icon"><Icon size={16}/></span>
        <div className="activity-body"><strong>{item.subject}</strong>
          <small>{l.kinds[item.kind]} · {format(item.at)} · {l.by} {item.mine ? l.you : item.ownerName || "—"}</small></div>
        <span className="activity-badges">
          {item.outcomeRecorded && <span className="activity-badge is-outcome"><CheckCircle2 size={13}/>{l.outcomeSaved}</span>}
          <span className={"activity-badge is-" + item.status.toLowerCase()}>{l.status[item.status]}</span>
        </span>
      </li>; })}</ol>}
  </section>;
}
