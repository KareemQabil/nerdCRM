import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Archive, CircleDashed, EyeOff, History, ShieldCheck } from "lucide-react";
import { ApiError } from "./api";
import { DataTable, tableLabels, type Column } from "./DataTable";
import { Dialog } from "./Dialog";
import { day } from "./format";
import {
  anonymizeRecord, getRetention, getRetentionDecisions, getRetentionQueue, keepRecord,
  type DataType, type DueRecord, type RetentionDecision, type RetentionOverview, type RetentionQueue,
} from "./retentionApi";
import type { Language } from "./preferences";
import "./admin.css";
import "./policies.css";
import { ErrorBanner, PageHeader } from "./ui";

const L = {
  ar: {
    eyebrow: "الإدارة", title: "مراجعة الاحتفاظ بالبيانات",
    intro: "لما مدة الاحتفاظ بنوع بيانات تخلص من آخر نشاط على السجل، السجل بيظهر هنا للمراجعة. مفيش حذف ولا تعديل تلقائي: انت بتقرر لكل سجل — تحتفظ بيه بسبب لحد تاريخ، أو تجهّله.",
    types: { LEADS: "الـ leads", CANDIDATES: "المرشحين", TRAINEES: "المتدربين", DONORS: "المتبرعين", CONTACTS: "جهات الاتصال" } as Record<DataType, string>,
    notSet: "المدة مش مضبوطة", notSetHint: "مالك السياسات يحددها من صفحة السياسات (مدة الاحتفاظ بالبيانات).",
    months: (n: number) => n === 1 ? "شهر واحد" : n === 2 ? "شهرين" : n <= 10 ? `${n} شهور` : `${n} شهر`,
    due: (n: number) => n === 0 ? "مفيش سجلات للمراجعة" : n === 1 ? "سجل واحد للمراجعة" : `${n} سجلات للمراجعة`,
    queue: "السجلات المستحقة للمراجعة", empty: "مفيش سجلات مستحقة للمراجعة دلوقتي.",
    name: "السجل", last: "آخر نشاط", dueSince: "مستحق من", actions: "القرار", shown: (shown: number, total: number) => `بيظهر ${shown} من ${total}`,
    keep: "احتفاظ", anonymize: "تجهيل", keepTitle: "الاحتفاظ بالسجل",
    keepText: "السجل هيختفي من القائمة لحد تاريخ المراجعة الجاية، وبعدها يرجع لو لسه مستحق.",
    reason: "السبب", again: "راجعه تاني يوم", againHint: (max: string) => `بعد النهارده، ولحد ${max} بالكتير (مدة احتفاظ واحدة كمان).`,
    anonTitle: "تجهيل السجل",
    anonText: "بيانات الشخص بتتمسح وبيتكتب مكانها \"Anonymized\": الاسم والتليفونات والبريد والملاحظات، وكمان النسخ اللي في سجل التغييرات والمتابعات والرسائل والإشعارات. السجل نفسه وتاريخه في الشغل بيفضلوا. الخطوة دي ما ترجعش.",
    confirm: "فاهم إن التجهيل ما يرجعش", retry: "حاول تاني", save: "تأكيد", saving: "جاري الحفظ…", cancel: "إلغاء",
    onlyKeep: "السجلات دي مشتركة مع الفواتير والشهادات، فبتتحفظ بس لحد ما يتقرر المحاسبة محتاجة تحتفظ بإيه.",
    log: "سجل القرارات", noLog: "لسه مفيش قرارات.", kept: (d: string) => `احتفاظ لحد ${d}`, anonymized: "اتجهّل", by: "بواسطة", record: "سجل رقم",
    saved: { KEEP: "اتسجل الاحتفاظ.", ANONYMIZED: "السجل اتجهّل." },
    errors: { NOT_DUE: "السجل ده مش مستحق للمراجعة (لسه في مدته، أو محتفظ بيه، أو متجهّل).", FILES_FILED: "فيه مستندات مرفوعة على السجل ده؛ ينفع تحتفظ بيه، بس ما ينفعش يتجهّل.",
      ANONYMIZE_NOT_AVAILABLE: "النوع ده بيتحفظ بس، ما بيتجهّلش.", POLICY_NOT_SET: "مدة الاحتفاظ للنوع ده مش مضبوطة.", REQUIRED: "اكتب السبب واختار التاريخ.",
      PAST: "اختار تاريخ بعد النهارده.", RANGE: "أقصى حاجة مدة احتفاظ واحدة كمان.", FORMAT: "تاريخ غير صحيح.", TOO_LONG: "السبب طويل (500 حرف بالكتير).",
      forbidden: "المراجعة لمالكي السياسات بس.", failed: "تعذّر تنفيذ الطلب." } as Record<string, string>,
  },
  en: {
    eyebrow: "Administration", title: "Retention review",
    intro: "When a data type's retention period has passed since a record's last activity, the record is listed here for review. Nothing is removed or changed automatically: you decide for each record — keep it, with a reason, until a date, or anonymize it.",
    types: { LEADS: "Leads", CANDIDATES: "Candidates", TRAINEES: "Trainees", DONORS: "Donors", CONTACTS: "Contacts" } as Record<DataType, string>,
    notSet: "Period not set", notSetHint: "A policy owner sets it under Policies (Data retention).",
    months: (n: number) => n === 1 ? "1 month" : `${n} months`,
    due: (n: number) => n === 0 ? "Nothing to review" : n === 1 ? "1 record to review" : `${n} records to review`,
    queue: "Records due for review", empty: "No records are due for review now.",
    name: "Record", last: "Last activity", dueSince: "Due since", actions: "Decision", shown: (shown: number, total: number) => `Showing ${shown} of ${total}`,
    keep: "Keep", anonymize: "Anonymize", keepTitle: "Keep this record",
    keepText: "The record leaves the list until the review date, and comes back then if it is still due.",
    reason: "Reason", again: "Review again on", againHint: (max: string) => `After today, and by ${max} at the latest (one more retention period).`,
    anonTitle: "Anonymize this record",
    anonText: "The person's details are overwritten with \"Anonymized\": name, phones, e-mail and notes, and the copies in the change history, follow-ups, drafted messages and notices. The record itself and its business history stay. This cannot be undone.",
    confirm: "I understand anonymizing cannot be undone", retry: "Try again", save: "Confirm", saving: "Saving…", cancel: "Cancel",
    onlyKeep: "These records are shared with invoices and certificates, so they can only be kept until it is decided what accounting must keep.",
    log: "Decision log", noLog: "No decisions yet.", kept: (d: string) => `Kept until ${d}`, anonymized: "Anonymized", by: "by", record: "Record",
    saved: { KEEP: "The record is kept.", ANONYMIZED: "The record is anonymized." },
    errors: { NOT_DUE: "This record is not due for review (still within its period, kept, or anonymized).", FILES_FILED: "Documents are filed on this record; it can be kept, not anonymized.",
      ANONYMIZE_NOT_AVAILABLE: "Records of this type can only be kept.", POLICY_NOT_SET: "The retention period for this type is not set.", REQUIRED: "Give a reason and choose a date.",
      PAST: "Choose a date after today.", RANGE: "At most one more retention period.", FORMAT: "The date is not valid.", TOO_LONG: "The reason is too long (500 characters at most).",
      forbidden: "Only policy owners review retention.", failed: "The request failed." } as Record<string, string>,
  },
};
type Labels = typeof L.ar;

function problem(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.errors.failed;
  const code = error.fields?.[0]?.code ?? error.code ?? "";
  if (code && l.errors[code]) return l.errors[code];
  if (error.statusCode === 403) return l.errors.forbidden;
  return l.errors.failed;
}

const shift = (iso: string, months: number, days = 0) => {
  const d = new Date(iso + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** D-07: the records past their retention period, for a policy owner to keep or anonymize; nothing happens on its own. */
export function RetentionPage({ language }: { language: Language }) {
  const l = L[language], ar = language === "ar";
  const [overview, setOverview] = useState<RetentionOverview | null>(null);
  const [chosen, setChosen] = useState<DataType | null>(null);
  const [queue, setQueue] = useState<RetentionQueue | null>(null);
  const [log, setLog] = useState<RetentionDecision[]>([]);
  const [deciding, setDeciding] = useState<{ row: DueRecord; kind: "KEEP" | "ANONYMIZED" } | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const [o, d] = await Promise.all([getRetention(), getRetentionDecisions()]);
      setOverview(o); setLog(d);
      setChosen(c => c ?? o.types.find(t => t.set && (t.due ?? 0) > 0)?.dataType ?? o.types.find(t => t.set)?.dataType ?? null);
    } catch (e) { setError(problem(e, l)); }
  }, [l]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setQueue(null);
    if (chosen && overview?.types.find(t => t.dataType === chosen)?.set) void getRetentionQueue(chosen).then(setQueue).catch(e => setError(problem(e, l)));
  }, [chosen, overview, l]);
  const type = overview?.types.find(t => t.dataType === chosen) ?? null;
  const columns: Column<DueRecord>[] = [
    { key: "name", header: l.name, cell: r => <bdi>{r.label}</bdi>, sortValue: r => r.label },
    { key: "last", header: l.last, cell: r => day(r.lastActivityOn, ar), sortValue: r => r.lastActivityOn },
    { key: "due", header: l.dueSince, cell: r => day(r.dueSince, ar), sortValue: r => r.dueSince },
    { key: "actions", header: l.actions, cell: r => <span className="admin-list-actions">
      <button type="button" className="btn btn-small btn-secondary" onClick={() => { setNotice(""); setDeciding({ row: r, kind: "KEEP" }); }}>
        <Archive size={14}/>{l.keep}<span className="sr-only">: {r.label}</span></button>
      {queue?.canAnonymize && <button type="button" className="btn btn-small btn-danger" onClick={() => { setNotice(""); setDeciding({ row: r, kind: "ANONYMIZED" }); }}>
        <EyeOff size={14}/>{l.anonymize}<span className="sr-only">: {r.label}</span></button>}
    </span> },
  ];
  return <section className="page-enter policies-page retention-page">
    <PageHeader eyebrow={l.eyebrow} title={l.title} description={l.intro}/>
    {error && <ErrorBanner message={error} onRetry={() => void load()} retryLabel={l.retry}/>}
    {notice && <p className="daily-note" role="status"><ShieldCheck size={15}/>{notice}</p>}
    {overview && <div className="retention-types" role="group" aria-label={l.title}>
      {overview.types.map(t => <button key={t.dataType} type="button" aria-pressed={chosen === t.dataType}
        className={"retention-type" + (chosen === t.dataType ? " is-chosen" : "") + (t.set ? (t.due ? " is-due" : " is-clear") : " is-unset")}
        onClick={() => setChosen(t.dataType)}>
        <strong>{l.types[t.dataType]}</strong>
        {t.set ? <><span>{l.months(t.months ?? 0)}</span><span className="retention-due">{l.due(t.due ?? 0)}</span></>
          : <span className="retention-due"><CircleDashed size={13}/>{l.notSet}</span>}
      </button>)}
    </div>}
    {type && !type.set && <section className="data-panel policies-panel"><p className="activity-empty">{l.notSet}. {l.notSetHint}</p></section>}
    {type?.set && queue && <section className="data-panel policies-panel" aria-labelledby="retention-queue">
      <div className="policies-panel-head"><div><h2 id="retention-queue">{l.queue}: {l.types[queue.dataType]}</h2>
        <p>{l.months(queue.months)} · {l.shown(queue.rows.length, queue.total)}</p>
        {!queue.canAnonymize && <p>{l.onlyKeep}</p>}</div></div>
      {queue.rows.length === 0 ? <p className="activity-empty">{l.empty}</p>
        : <DataTable id="retention-queue" caption={l.queue} columns={columns} rows={queue.rows} rowKey={r => r.id} labels={tableLabels(ar)}/>}
    </section>}
    <details className="data-panel policies-panel policies-history" open={log.length > 0 && log.length < 6}>
      <summary><History size={15}/>{l.log} ({log.length})</summary>
      {log.length === 0 ? <p className="activity-empty">{l.noLog}</p> : <ol>{log.map(d => <li key={d.id}>
        <span><strong>{l.types[d.dataType]} · {l.record} {d.recordId}</strong> · {d.decision === "KEEP" ? l.kept(day(d.reviewAgainOn, ar)) : l.anonymized}</span>
        <small>{l.reason}: {d.reason} · {l.by} {d.decidedBy} · {day(d.decidedAt, ar)}</small>
      </li>)}</ol>}
    </details>
    {deciding && overview && type?.months && <DecideDialog l={l} kind={deciding.kind} row={deciding.row} type={type.dataType} today={overview.today}
      months={type.months} onClose={() => setDeciding(null)}
      onDone={kind => { setDeciding(null); setNotice(l.saved[kind]); void load(); if (chosen) void getRetentionQueue(chosen).then(setQueue).catch(() => undefined); }}/>}
  </section>;
}

function DecideDialog({ l, kind, row, type, today, months, onClose, onDone }: {
  l: Labels; kind: "KEEP" | "ANONYMIZED"; row: DueRecord; type: DataType; today: string; months: number; onClose: () => void;
  onDone: (kind: "KEEP" | "ANONYMIZED") => void;
}) {
  const [reason, setReason] = useState("");
  const [again, setAgain] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const max = shift(today, months);
  const keep = kind === "KEEP";
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      if (keep) await keepRecord(type, row.id, reason.trim(), again);
      else await anonymizeRecord(type, row.id, reason.trim());
      onDone(kind);
    } catch (failure) { setError(problem(failure, l)); }
    finally { setBusy(false); }
  }
  const ready = reason.trim() && (keep ? !!again : understood);
  return <Dialog title={keep ? l.keepTitle : l.anonTitle} kicker={row.label} description={keep ? l.keepText : l.anonText} busy={busy} onClose={onClose}
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="retention-form" className={"btn " + (keep ? "btn-primary" : "btn-danger")} disabled={busy || !ready}>
        {keep ? <Archive size={16}/> : <EyeOff size={16}/>}{busy ? l.saving : l.save}</button></>}>
    <form id="retention-form" className="daily-form" onSubmit={e => void submit(e)}>
      <label><span>{l.reason}</span><textarea value={reason} maxLength={500} rows={3} onChange={e => setReason(e.target.value)} required/></label>
      {keep && <label><span>{l.again}</span><input type="date" value={again} min={shift(today, 0, 1)} max={max}
        onChange={e => setAgain(e.target.value)} required/><small>{l.againHint(max)}</small></label>}
      {!keep && <label className="policies-check"><input type="checkbox" checked={understood} onChange={e => setUnderstood(e.target.checked)}/>{l.confirm}</label>}
      {error && <p className="admin-list-error" role="alert">{error}</p>}
    </form>
  </Dialog>;
}
