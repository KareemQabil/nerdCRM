import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft, ArrowRight, Building2, CalendarClock, CheckCircle2, CircleAlert, CircleDashed, ClipboardCheck, Flag, Plus, RotateCcw, Save,
  ShieldAlert, ShieldCheck, Target, TriangleAlert, UserRound, XCircle,
} from "lucide-react";
import { ApiError } from "./api";
import { Dialog } from "./Dialog";
import { searchEverything, wallClock } from "./dailyApi";
import {
  actOn, addAction, checkEffectiveness, getIssue, getIssues, getQualityOptions, getQualityPeople, moveIssue, planIssue, raiseIssue,
  type Choice, type CorrectiveAction, type Gravity, type QualityDetail, type QualityIssue, type QualityOptions,
} from "./qualityApi";
import type { Language } from "./preferences";
import "./daily.css";
import "./quality.css";

const L = {
  ar: {
    eyebrow: "التنفيذ", title: "الجودة والإجراءات التصحيحية",
    hint: "سجّل أي مشكلة جودة: اتعرفت منين، خطورتها، وإيه اللي حصل. حدد مسؤول الخطة والإجراءات ومواعيدها، وقيّم الفعالية قبل القفل. مفيش أي رسالة بتتبعت لعميل أو مورد.",
    raise: "تسجيل مشكلة", open: "مفتوحة", closed: "مقفولة", all: "الكل", mine: "اللي عليّا", loading: "جاري التحميل…", empty: "مفيش مشاكل هنا.",
    stats: { open: "مفتوحة", critical: "حرجة مفتوحة", overdue: "إجراءات متأخرة", unchecked: "مقفولة من غير تقييم فعالية" },
    gravity: { CRITICAL: "حرجة", MAJOR: "رئيسية", MINOR: "ثانوية" } as Record<string, string>,
    kind: { OPEN: "مفتوحة", CLOSED: "مقفولة", CANCELLED: "ملغاة" } as Record<string, string>,
    origin: { INTERNAL: "داخلي", CUSTOMER: "عميل", SUPPLIER: "مورد" } as Record<string, string>,
    eff: { NOT_CHECKED: "الفعالية لسه متقيّمتش", EFFECTIVE: "الإجراءات فعّالة", NOT_EFFECTIVE: "الإجراءات مش فعّالة" } as Record<string, string>,
    setupTitle: "إعداد الجودة لسه ناقص",
    setupText: "مينفعش تتسجل مشكلة جودة قبل ما مسؤول النظام يحدد اختيارات نظام الجودة بتاع الشركة:",
    missing: { COMPANY: "الشركة النشطة", STATUSES: "حالة مفتوحة واحدة على الأقل", DETECTIONS: "مصدر اكتشاف", ISSUE_TYPES: "نوع مشكلة" } as Record<string, string>,
    setupLink: "افتح إعداد الجودة", back: "الرجوع لسجل الجودة",
    facts: { found: "اتعرفت من", type: "النوع", account: "الحساب", project: "المشروع", raised: "سجّلها", owner: "مسؤول الخطة", due: "آخر موعد", progress: "التقدم" },
    you: "أنت", none: "—", status: "الحالة", moveTo: "نقل إلى", details: "اللي حصل",
    plan: "الخطة", planEdit: "تعديل الخطة", objective: "الهدف", criteria: "إزاي هنحكم على الفعالية", earliest: "أقرب موعد", latest: "آخر موعد",
    noPlan: "لسه مفيش هدف أو معيار فعالية.",
    actions: "الإجراءات التصحيحية", noActions: "لسه مفيش إجراءات.", addAction: "إضافة إجراء", actionTitle: "الإجراء", actionOwner: "مين هيعمله",
    actionDue: "الموعد", actionType: "النوع", noType: "بدون نوع", choose: "اختر…", done: "تم", reopen: "إعادة فتح", cancelAction: "إلغاء الإجراء",
    overdue: "متأخر", doneOn: "اتعمل", actionStatus: { OPEN: "مفتوح", DONE: "تم", CANCELLED: "ملغي" } as Record<string, string>,
    doneTitle: "الإجراء اتعمل؟", outcome: "اللي اتعمل (اختياري)",
    effectiveness: "تقييم الفعالية", check: "قيّم الفعالية", effective: "فعّالة: المشكلة متكررتش والمعيار اتحقق", notEffective: "مش فعّالة: محتاجة إجراءات تانية",
    checked: "اللي اتراجع", checkedBy: "قيّمها",
    closeTitle: "نقل المشكلة؟", closeWarnOpen: (n: number) => `فيه ${n} إجراء لسه مفتوح.`, closeWarnEff: "الفعالية لسه متقيّمتش.",
    closeHint: "ده تنبيه بس؛ القرار لصاحب الصلاحية.",
    raiseTitle: "تسجيل مشكلة جودة", issueTitle: "عنوان المشكلة", issueDetails: "إيه اللي حصل؟", detection: "اتعرفت منين", issueType: "نوع المشكلة",
    gravityLabel: "الخطورة", accountLabel: "الحساب", accountSearch: "اكتب اسم الحساب…", accountRequired: "مطلوب للمصدر ده", noTypes: "مفيش أنواع",
    save: "حفظ", saving: "جاري الحفظ…", cancel: "إلغاء", keep: "رجوع", confirm: "تأكيد",
    errors: { SETUP_REQUIRED: "إعداد الجودة ناقص؛ مسؤول النظام يكمّله من لوحة الإدارة ← إعداد الجودة.",
      NUMBERING_REQUIRED: "ترقيم مشاكل الجودة مش متظبط؛ مسؤول النظام يظبطه من لوحة الإدارة ← الترقيم.",
      NOT_CONSISTENT: "بيانات المشكلة مش متسقة مع مصدر الاكتشاف.", REQUIRED: "حقل مطلوب ناقص.", UNAVAILABLE: "اختيار غير متاح.",
      BEFORE_START: "آخر موعد لازم يكون بعد أقرب موعد.", STATUS_NOT_ALLOWED: "الإجراء ده مش متاح في حالته الحالية.", TOO_LONG: "النص طويل.",
      conflict: "المشكلة اتغيرت من مكان تاني؛ اتحدّثت.", forbidden: "مش مسموح لك بالإجراء ده.", notFound: "المشكلة مش موجودة أو مش متاحة لك.", failed: "تعذّر تنفيذ الطلب." },
  },
  en: {
    eyebrow: "Delivery", title: "Quality & corrective actions",
    hint: "Record any quality issue: where it was found, how grave it is and what happened. Set the plan owner, the actions and their dates, and judge effectiveness before closing. Nothing is sent to a client or supplier.",
    raise: "Raise an issue", open: "Open", closed: "Closed", all: "All", mine: "Mine to do", loading: "Loading…", empty: "No issues here.",
    stats: { open: "Open", critical: "Critical open", overdue: "Overdue actions", unchecked: "Closed without an effectiveness check" },
    gravity: { CRITICAL: "Critical", MAJOR: "Major", MINOR: "Minor" } as Record<string, string>,
    kind: { OPEN: "Open", CLOSED: "Closed", CANCELLED: "Cancelled" } as Record<string, string>,
    origin: { INTERNAL: "Internal", CUSTOMER: "Client", SUPPLIER: "Supplier" } as Record<string, string>,
    eff: { NOT_CHECKED: "Effectiveness not checked yet", EFFECTIVE: "Actions effective", NOT_EFFECTIVE: "Actions not effective" } as Record<string, string>,
    setupTitle: "The quality set-up is not complete",
    setupText: "No quality issue can be raised until an administrator sets your company's quality-system choices:",
    missing: { COMPANY: "the active company", STATUSES: "at least one open status", DETECTIONS: "a detection source", ISSUE_TYPES: "an issue type" } as Record<string, string>,
    setupLink: "Open the quality set-up", back: "Back to the quality register",
    facts: { found: "Found by", type: "Type", account: "Account", project: "Engagement", raised: "Raised by", owner: "Plan owner", due: "Latest date", progress: "Progress" },
    you: "you", none: "—", status: "Status", moveTo: "Move to", details: "What happened",
    plan: "Plan", planEdit: "Edit the plan", objective: "Objective", criteria: "How effectiveness will be judged", earliest: "Earliest date", latest: "Latest date",
    noPlan: "No objective or effectiveness criterion yet.",
    actions: "Corrective actions", noActions: "No actions yet.", addAction: "Add an action", actionTitle: "Action", actionOwner: "Who does it",
    actionDue: "Due", actionType: "Type", noType: "No type", choose: "Choose…", done: "Done", reopen: "Reopen", cancelAction: "Cancel action",
    overdue: "Overdue", doneOn: "Done", actionStatus: { OPEN: "Open", DONE: "Done", CANCELLED: "Cancelled" } as Record<string, string>,
    doneTitle: "Is the action done?", outcome: "What was done (optional)",
    effectiveness: "Effectiveness", check: "Judge effectiveness", effective: "Effective: the issue did not recur and the criterion is met", notEffective: "Not effective: more actions are needed",
    checked: "What was checked", checkedBy: "Judged by",
    closeTitle: "Move the issue?", closeWarnOpen: (n: number) => `${n} action(s) are still open.`, closeWarnEff: "Effectiveness has not been judged yet.",
    closeHint: "This is a reminder only; the decision is the person's with the right.",
    raiseTitle: "Raise a quality issue", issueTitle: "Issue title", issueDetails: "What happened?", detection: "Found by", issueType: "Issue type",
    gravityLabel: "Gravity", accountLabel: "Account", accountSearch: "Type the account name…", accountRequired: "Required for this source", noTypes: "No types",
    save: "Save", saving: "Saving…", cancel: "Cancel", keep: "Back", confirm: "Confirm",
    errors: { SETUP_REQUIRED: "The quality set-up is incomplete; an administrator completes it in the admin console → Quality set-up.",
      NUMBERING_REQUIRED: "Quality issue numbering is not set up; an administrator sets it in the admin console → Numbering.",
      NOT_CONSISTENT: "The issue's details do not match its detection source.", REQUIRED: "A required field is missing.", UNAVAILABLE: "This choice is not available.",
      BEFORE_START: "The latest date must be after the earliest.", STATUS_NOT_ALLOWED: "This is not available in the action's status.", TOO_LONG: "The text is too long.",
      conflict: "The issue changed elsewhere; it was refreshed.", forbidden: "You are not allowed to do this.", notFound: "The issue does not exist or is not available to you.", failed: "The request failed." },
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
const routeId = (hash: string) => { const m = hash.match(/^#\/quality\/(\d+)$/); return m ? Number(m[1]) : null; };
const day = (value: string | null, ar: boolean) => value ? new Date(value + "T00:00:00").toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;

export function QualityPage({ language, administrator }: { language: Language; administrator?: boolean }) {
  const [id, setId] = useState(() => routeId(window.location.hash));
  useEffect(() => {
    const sync = () => setId(routeId(window.location.hash));
    window.addEventListener("hashchange", sync); window.addEventListener("popstate", sync);
    return () => { window.removeEventListener("hashchange", sync); window.removeEventListener("popstate", sync); };
  }, []);
  return id ? <IssueRecord key={id} id={id} language={language}/> : <Register language={language} administrator={administrator}/>;
}

function Register({ language, administrator }: { language: Language; administrator?: boolean }) {
  const l = L[language], ar = language === "ar";
  const [state, setState] = useState<"open" | "closed" | "all">("open");
  const [mine, setMine] = useState(false);
  const [rows, setRows] = useState<QualityIssue[] | null>(null);
  const [options, setOptions] = useState<QualityOptions | null>(null);
  const [error, setError] = useState("");
  const [raising, setRaising] = useState(false);
  useEffect(() => { void getQualityOptions().then(setOptions).catch(() => setOptions(null)); }, []);
  useEffect(() => { setRows(null); setError(""); getIssues(state, mine).then(setRows).catch(e => { setRows([]); setError(problem(e, l)); }); }, [state, mine, l]);
  const stats = useMemo(() => {
    const r = rows ?? [];
    return { open: r.filter(x => x.statusKind === "OPEN").length, critical: r.filter(x => x.statusKind === "OPEN" && x.gravity === "CRITICAL").length,
      overdue: r.reduce((n, x) => n + x.overdueActions, 0), unchecked: r.filter(x => x.statusKind === "CLOSED" && x.effectiveness === "NOT_CHECKED").length };
  }, [rows]);
  const ready = options?.ready ?? false;
  return <section className="page-enter quality-page">
    <div className="page-head">
      <div className="page-title"><span className="eyebrow">{l.eyebrow}</span><h1>{l.title}</h1><p>{l.hint}</p></div>
      <div className="page-head-actions"><button type="button" className="btn btn-primary" disabled={!ready} onClick={() => setRaising(true)}><Plus size={16}/>{l.raise}</button></div>
    </div>
    {options && !options.ready && <div className="quality-setup" role="note">
      <TriangleAlert size={18}/>
      <div><strong>{l.setupTitle}</strong><p>{l.setupText}</p><ul>{options.missing.map(m => <li key={m}>{l.missing[m]}</li>)}</ul>
        {administrator && <a className="btn btn-secondary btn-small" href="#/admin/quality">{l.setupLink}</a>}</div>
    </div>}
    <div className="quality-filters">
      <div className="segmented" role="group">
        {(["open", "closed", "all"] as const).map(s => <button key={s} type="button" className={state === s ? "chosen" : ""} aria-pressed={state === s} onClick={() => setState(s)}>{l[s]}</button>)}
      </div>
      <label className="quality-mine"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)}/>{l.mine}</label>
    </div>
    {rows && rows.length > 0 && <dl className="quality-stats">
      {state !== "closed" && <div><dt>{l.stats.open}</dt><dd>{stats.open}</dd></div>}
      {state !== "closed" && <div className={stats.critical ? "is-alert" : ""}><dt>{l.stats.critical}</dt><dd>{stats.critical}</dd></div>}
      <div className={stats.overdue ? "is-alert" : ""}><dt>{l.stats.overdue}</dt><dd>{stats.overdue}</dd></div>
      {state !== "open" && <div className={stats.unchecked ? "is-warn" : ""}><dt>{l.stats.unchecked}</dt><dd>{stats.unchecked}</dd></div>}
    </dl>}
    {error && <div className="error-banner" role="alert"><CircleAlert size={17}/><span>{error}</span></div>}
    {rows === null ? <div className="empty-state" role="status">{l.loading}</div>
      : rows.length === 0 ? !error && <div className="empty-state"><ShieldCheck size={28}/><span>{l.empty}</span></div>
      : <ul className="quality-list">{rows.map(q => <li key={q.id}><IssueCard q={q} l={l} ar={ar}/></li>)}</ul>}
    {raising && options && <RaiseDialog l={l} options={options} onClose={() => setRaising(false)}
      onSaved={d => { setRaising(false); window.location.hash = "#/quality/" + d.issue.id; }}/>}
  </section>;
}

function IssueCard({ q, l, ar }: { q: QualityIssue; l: Labels; ar: boolean }) {
  return <a className={"quality-card is-" + (q.gravity ?? "minor").toLowerCase() + " is-" + q.statusKind.toLowerCase()} href={"#/quality/" + q.id}>
    <span className="quality-card-top">
      {q.gravity && <span className={"quality-gravity is-" + q.gravity.toLowerCase()}>{l.gravity[q.gravity]}</span>}
      <span className={"quality-status is-" + q.statusKind.toLowerCase()}>{q.statusName}</span>
      <span className="quality-ref" dir="ltr">{q.reference}</span>
    </span>
    <strong>{q.title ?? q.reference}</strong>
    <span className="quality-card-meta">
      {q.detection && <span><Flag size={12}/>{q.detection}</span>}
      {q.accountName && <span><Building2 size={12}/>{q.accountName}</span>}
      {q.ownerName && <span><UserRound size={12}/>{q.mine ? l.you : q.ownerName}</span>}
      {q.dueDate && <span><CalendarClock size={12}/>{day(q.dueDate, ar)}</span>}
    </span>
    <span className="quality-card-bottom">
      <span className="quality-progress" aria-label={`${l.facts.progress}: ${q.progress}%`}><span style={{ inlineSize: q.progress + "%" }}/></span>
      <small>{q.progress}%</small>
      {q.overdueActions > 0 && <span className="quality-overdue"><TriangleAlert size={12}/>{q.overdueActions} {l.overdue}</span>}
      {q.statusKind === "CLOSED" && <span className={"quality-eff is-" + q.effectiveness.toLowerCase()}>{l.eff[q.effectiveness]}</span>}
    </span>
  </a>;
}

function IssueRecord({ id, language }: { id: number; language: Language }) {
  const l = L[language], ar = language === "ar";
  const [data, setData] = useState<QualityDetail | null>(null);
  const [options, setOptions] = useState<QualityOptions | null>(null);
  const [people, setPeople] = useState<Choice[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialogState] = useState<null | { kind: "plan" } | { kind: "effectiveness" } | { kind: "move"; status: Choice } | { kind: "done"; action: CorrectiveAction }>(null);
  const setDialog = (next: typeof dialog) => { setError(""); setDialogState(next); };
  const load = useCallback(() => getIssue(id).then(setData).catch(e => setError(problem(e, l))), [id, l]);
  useEffect(() => { void load(); void getQualityOptions().then(setOptions).catch(() => setOptions(null)); }, [load]);
  useEffect(() => { void getQualityPeople().then(setPeople).catch(() => setPeople([])); }, []);
  const Back = ar ? ArrowRight : ArrowLeft;
  async function run(action: () => Promise<QualityDetail>): Promise<boolean> {
    setBusy(true); setError("");
    try { setData(await action()); setDialog(null); return true; }
    catch (e) { setError(problem(e, l)); if (e instanceof ApiError && e.statusCode === 409) void load(); return false; }
    finally { setBusy(false); }
  }
  const q = data?.issue;
  const when = (value: string | null) => wallClock(value)?.toLocaleString(ar ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) ?? l.none;
  const openActions = data?.actions.filter(a => a.status === "OPEN").length ?? 0;
  return <article className="page-enter quality-record">
    <div className="record-context-bar"><a className="record-back" href="#/quality"><Back size={17}/>{l.back}</a></div>
    {error && !dialog && <div className="error-banner" role="alert"><CircleAlert size={17}/><span>{error}</span></div>}
    {!q || !data ? (!error && <div className="empty-state" role="status">{l.loading}</div>) : <>
      <header className={"quality-hero is-" + (q.gravity ?? "minor").toLowerCase()}>
        <div className="quality-card-top">
          {q.gravity && <span className={"quality-gravity is-" + q.gravity.toLowerCase()}><ShieldAlert size={13}/>{l.gravity[q.gravity]}</span>}
          <span className={"quality-status is-" + q.statusKind.toLowerCase()}>{q.statusName}</span>
          <span className="quality-ref" dir="ltr">{q.reference}</span>
        </div>
        <h1>{q.title ?? q.reference}</h1>
        {data.details && <p className="quality-details">{data.details}</p>}
        <dl className="visit-facts">
          <div><dt><Flag size={14}/>{l.facts.found}</dt><dd>{q.detection ?? l.none}{q.origin && <small> · {l.origin[q.origin]}</small>}</dd></div>
          {q.issueType && <div><dt>{l.facts.type}</dt><dd>{q.issueType}</dd></div>}
          {q.accountId && <div><dt><Building2 size={14}/>{l.facts.account}</dt><dd><a href={"#/accounts/" + q.accountId}>{q.accountName}</a></dd></div>}
          {q.projectName && <div><dt>{l.facts.project}</dt><dd>{q.projectName}</dd></div>}
          <div><dt><UserRound size={14}/>{l.facts.raised}</dt><dd>{q.raisedByName ?? l.none}<small> · {when(q.raisedAt)}</small></dd></div>
        </dl>
        {options && options.statuses.length > 0 && <div className="quality-move" role="group" aria-label={l.moveTo}>
          <span>{l.moveTo}:</span>
          {options.statuses.filter(s => s.id !== q.statusId).map(s => <button key={s.id} type="button" className={"btn btn-small btn-secondary quality-move-" + (s.kind ?? "open").toLowerCase()}
            disabled={busy} onClick={() => setDialog({ kind: "move", status: s })}>{s.name}</button>)}
        </div>}
      </header>

      <div className="quality-grid">
        <section className="record-content-card quality-plan" aria-labelledby="quality-plan-title">
          <div className="quality-section-head"><h2 id="quality-plan-title"><Target size={17}/>{l.plan}</h2>
            <button type="button" className="btn btn-small btn-secondary" disabled={busy} onClick={() => setDialog({ kind: "plan" })}>{l.planEdit}</button></div>
          <dl className="quality-plan-facts">
            <div><dt>{l.facts.owner}</dt><dd>{q.mine ? l.you : q.ownerName ?? l.none}</dd></div>
            <div><dt>{l.earliest}</dt><dd>{day(data.earliest, ar) ?? l.none}</dd></div>
            <div><dt>{l.latest}</dt><dd>{day(q.dueDate, ar) ?? l.none}</dd></div>
            <div><dt>{l.facts.progress}</dt><dd><span className="quality-progress is-wide"><span style={{ inlineSize: q.progress + "%" }}/></span> {q.progress}%</dd></div>
          </dl>
          {data.objective || data.criteria ? <>
            {data.objective && <div className="quality-text"><strong>{l.objective}</strong><p>{data.objective}</p></div>}
            {data.criteria && <div className="quality-text"><strong>{l.criteria}</strong><p>{data.criteria}</p></div>}
          </> : <p className="activity-empty">{l.noPlan}</p>}
        </section>

        <section className={"record-content-card quality-effectiveness is-" + q.effectiveness.toLowerCase()} aria-labelledby="quality-eff-title">
          <div className="quality-section-head"><h2 id="quality-eff-title"><ClipboardCheck size={17}/>{l.effectiveness}</h2>
            <button type="button" className="btn btn-small btn-secondary" disabled={busy} onClick={() => setDialog({ kind: "effectiveness" })}>{l.check}</button></div>
          <p className={"quality-eff is-" + q.effectiveness.toLowerCase()}>
            {q.effectiveness === "EFFECTIVE" ? <CheckCircle2 size={16}/> : q.effectiveness === "NOT_EFFECTIVE" ? <XCircle size={16}/> : <CircleDashed size={16}/>}{l.eff[q.effectiveness]}</p>
          {data.check && <div className="quality-text"><strong>{l.checked}</strong><p>{data.check}</p><small>{l.checkedBy}: {data.checkedByName} · {when(data.checkedAt)}</small></div>}
        </section>
      </div>

      <section className="record-content-card quality-actions" aria-labelledby="quality-actions-title">
        <h2 id="quality-actions-title"><CheckCircle2 size={17}/>{l.actions}</h2>
        {data.actions.length === 0 ? <p className="activity-empty">{l.noActions}</p>
          : <ol className="quality-action-list">{data.actions.map(a => <li key={a.id} className={"quality-action is-" + a.status.toLowerCase() + (a.overdue ? " is-overdue" : "")}>
            <div className="quality-action-main">
              <strong>{a.title}</strong>
              <span className="quality-card-meta">
                <span><UserRound size={12}/>{a.mine ? l.you : a.ownerName}</span>
                {a.due && <span className={a.overdue ? "quality-overdue" : ""}><CalendarClock size={12}/>{day(a.due, ar)}{a.overdue && ` · ${l.overdue}`}</span>}
                {a.type && <span>{a.type}</span>}
                <span className={"quality-action-status is-" + a.status.toLowerCase()}>{l.actionStatus[a.status]}</span>
              </span>
              {a.status === "DONE" && <small className="quality-done">{l.doneOn} {when(a.doneAt)}{a.outcome && ` — ${a.outcome}`}</small>}
            </div>
            <div className="quality-action-buttons">
              {a.status === "OPEN" ? <>
                <button type="button" className="btn btn-small btn-primary" disabled={busy} onClick={() => setDialog({ kind: "done", action: a })}><CheckCircle2 size={14}/>{l.done}</button>
                <button type="button" className="icon-button" aria-label={`${l.cancelAction}: ${a.title}`} disabled={busy}
                  onClick={() => void run(() => actOn(q.id, a, "cancel"))}><XCircle size={15}/></button>
              </> : <button type="button" className="btn btn-small btn-secondary" disabled={busy} onClick={() => void run(() => actOn(q.id, a, "reopen"))}><RotateCcw size={14}/>{l.reopen}</button>}
            </div>
          </li>)}</ol>}
        <AddActionForm l={l} q={q} people={people} types={options?.actionTypes ?? []} busy={busy}
          onAdd={input => run(() => addAction(q.id, q.version, input))}/>
      </section>

      {dialog?.kind === "plan" && <PlanDialog l={l} data={data} people={people} onClose={() => setDialog(null)}
        onSave={input => run(() => planIssue(q.id, q.version, input))} busy={busy} error={error}/>}
      {dialog?.kind === "effectiveness" && <EffectivenessDialog l={l} busy={busy} error={error} onClose={() => setDialog(null)}
        onSave={(effective, check) => run(() => checkEffectiveness(q.id, q.version, effective, check))}/>}
      {dialog?.kind === "done" && <DoneDialog l={l} action={dialog.action} busy={busy} error={error} onClose={() => setDialog(null)}
        onSave={outcome => run(() => actOn(q.id, dialog.action, "done", outcome))}/>}
      {dialog?.kind === "move" && <Dialog title={l.closeTitle} kicker={q.title ?? ""} busy={busy} onClose={() => setDialog(null)}
        footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setDialog(null)}>{l.keep}</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => moveIssue(q.id, q.version, dialog.status.id))}>{l.moveTo}: {dialog.status.name}</button></>}>
        {dialog.status.kind === "CLOSED" && (openActions > 0 || q.effectiveness === "NOT_CHECKED") ? <div className="quality-warn" role="note">
          <TriangleAlert size={16}/><div>{openActions > 0 && <p>{l.closeWarnOpen(openActions)}</p>}{q.effectiveness === "NOT_CHECKED" && <p>{l.closeWarnEff}</p>}<small>{l.closeHint}</small></div>
        </div> : <p>{q.statusName} → {dialog.status.name}</p>}
        {error && <p className="daily-error" role="alert"><CircleAlert size={15}/>{error}</p>}
      </Dialog>}
    </>}
  </article>;
}

function AddActionForm({ l, q, people, types, busy, onAdd }: {
  l: Labels; q: QualityIssue; people: Choice[]; types: Choice[]; busy: boolean;
  onAdd: (input: { title: string; ownerId: number; due?: string; typeId?: number }) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [type, setType] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !owner) return;
    if (await onAdd({ title: title.trim(), ownerId: Number(owner), due: due || undefined, typeId: type ? Number(type) : undefined })) { setTitle(""); setDue(""); setType(""); }
  }
  if (q.statusKind !== "OPEN") return null;
  return <form className="quality-add-action" onSubmit={e => void submit(e)} aria-label={l.addAction}>
    <input value={title} maxLength={300} placeholder={l.actionTitle} aria-label={l.actionTitle} onChange={e => setTitle(e.target.value)}/>
    <select value={owner} aria-label={l.actionOwner} onChange={e => setOwner(e.target.value)}><option value="">{l.actionOwner}…</option>
      {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    <input type="date" value={due} aria-label={l.actionDue} onChange={e => setDue(e.target.value)}/>
    {types.length > 0 && <select value={type} aria-label={l.actionType} onChange={e => setType(e.target.value)}><option value="">{l.noType}</option>
      {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
    <button type="submit" className="btn btn-primary" disabled={busy || !title.trim() || !owner}><Plus size={16}/>{l.addAction}</button>
  </form>;
}

function PlanDialog({ l, data, people, busy, error, onClose, onSave }: {
  l: Labels; data: QualityDetail; people: Choice[]; busy: boolean; error: string; onClose: () => void;
  onSave: (input: { ownerId: number; objective?: string; criteria?: string; earliest?: string; latest?: string }) => Promise<boolean>;
}) {
  const [owner, setOwner] = useState(data.issue.ownerId ? String(data.issue.ownerId) : "");
  const [objective, setObjective] = useState(data.objective ?? "");
  const [criteria, setCriteria] = useState(data.criteria ?? "");
  const [earliest, setEarliest] = useState(data.earliest ?? "");
  const [latest, setLatest] = useState(data.issue.dueDate ?? "");
  return <Dialog title={l.planEdit} kicker={data.issue.title ?? ""} busy={busy} onClose={onClose} wide
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="quality-plan-form" className="btn btn-primary" disabled={busy || !owner}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="quality-plan-form" className="daily-form daily-form-two" onSubmit={e => { e.preventDefault();
      void onSave({ ownerId: Number(owner), objective: objective.trim() || undefined, criteria: criteria.trim() || undefined, earliest: earliest || undefined, latest: latest || undefined }); }}>
      <label className="daily-span"><span>{l.facts.owner}</span><select value={owner} required onChange={e => setOwner(e.target.value)}><option value="">{l.choose}</option>
        {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="daily-span"><span>{l.objective}</span><textarea value={objective} rows={2} maxLength={4000} onChange={e => setObjective(e.target.value)}/></label>
      <label className="daily-span"><span>{l.criteria}</span><textarea value={criteria} rows={2} maxLength={4000} onChange={e => setCriteria(e.target.value)}/></label>
      <label><span>{l.earliest}</span><input type="date" value={earliest} onChange={e => setEarliest(e.target.value)}/></label>
      <label><span>{l.latest}</span><input type="date" value={latest} min={earliest || undefined} onChange={e => setLatest(e.target.value)}/></label>
      {error && <p className="daily-error daily-span" role="alert"><CircleAlert size={15}/>{error}</p>}
    </form>
  </Dialog>;
}

function EffectivenessDialog({ l, busy, error, onClose, onSave }: {
  l: Labels; busy: boolean; error: string; onClose: () => void; onSave: (effective: boolean, check: string) => Promise<boolean>;
}) {
  const [effective, setEffective] = useState<boolean | null>(null);
  const [check, setCheck] = useState("");
  return <Dialog title={l.check} busy={busy} onClose={onClose}
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="quality-eff-form" className="btn btn-primary" disabled={busy || effective === null || !check.trim()}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="quality-eff-form" className="daily-form" onSubmit={e => { e.preventDefault(); if (effective !== null) void onSave(effective, check.trim()); }}>
      <fieldset className="quality-choice"><legend>{l.effectiveness}</legend>
        <label><input type="radio" name="effective" checked={effective === true} onChange={() => setEffective(true)}/>{l.effective}</label>
        <label><input type="radio" name="effective" checked={effective === false} onChange={() => setEffective(false)}/>{l.notEffective}</label>
      </fieldset>
      <label><span>{l.checked}</span><textarea value={check} required rows={3} maxLength={4000} onChange={e => setCheck(e.target.value)}/></label>
      {error && <p className="daily-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    </form>
  </Dialog>;
}

function DoneDialog({ l, action, busy, error, onClose, onSave }: {
  l: Labels; action: CorrectiveAction; busy: boolean; error: string; onClose: () => void; onSave: (outcome?: string) => Promise<boolean>;
}) {
  const [outcome, setOutcome] = useState("");
  return <Dialog title={l.doneTitle} kicker={action.title} busy={busy} onClose={onClose}
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="quality-done-form" className="btn btn-primary" disabled={busy}><CheckCircle2 size={16}/>{l.done}</button></>}>
    <form id="quality-done-form" className="daily-form" onSubmit={e => { e.preventDefault(); void onSave(outcome.trim() || undefined); }}>
      <label><span>{l.outcome}</span><textarea value={outcome} rows={3} maxLength={4000} onChange={e => setOutcome(e.target.value)}/></label>
      {error && <p className="daily-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    </form>
  </Dialog>;
}

function RaiseDialog({ l, options, onClose, onSaved }: { l: Labels; options: QualityOptions; onClose: () => void; onSaved: (d: QualityDetail) => void }) {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [detection, setDetection] = useState(options.detections[0] ? String(options.detections[0].id) : "");
  const [issueType, setIssueType] = useState(options.issueTypes[0] ? String(options.issueTypes[0].id) : "");
  const [gravity, setGravity] = useState<Gravity>("MAJOR");
  const [account, setAccount] = useState<{ id: number; name: string } | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: number; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const origin = options.detections.find(d => String(d.id) === detection)?.kind;
  const needsAccount = origin === "CUSTOMER" || origin === "SUPPLIER";
  useEffect(() => {
    if (account || q.trim().length < 2) { setHits([]); return; }
    const t = window.setTimeout(() => void searchEverything(q.trim())
      .then(rows => setHits(rows.filter(r => r.type === "ACCOUNT").map(r => ({ id: r.id, name: r.title })))).catch(() => setHits([])), 250);
    return () => window.clearTimeout(t);
  }, [q, account]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      onSaved(await raiseIssue({ title: title.trim(), details: details.trim() || undefined, detectionId: Number(detection), issueTypeId: Number(issueType), gravity,
        accountId: account?.id }));
    } catch (failure) { setError(problem(failure, l)); }
    finally { setBusy(false); }
  }
  return <Dialog title={l.raiseTitle} kicker={l.title} busy={busy} onClose={onClose} wide
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="quality-raise-form" className="btn btn-primary"
        disabled={busy || !title.trim() || !detection || !issueType || (needsAccount && !account)}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="quality-raise-form" className="daily-form daily-form-two" onSubmit={e => void submit(e)}>
      <label className="daily-span"><span>{l.issueTitle}</span><input value={title} required maxLength={255} onChange={e => setTitle(e.target.value)}/></label>
      <label className="daily-span"><span>{l.issueDetails}</span><textarea value={details} rows={3} maxLength={4000} onChange={e => setDetails(e.target.value)}/></label>
      <fieldset className="daily-span quality-choice quality-gravity-pick"><legend>{l.gravityLabel}</legend>
        {(["CRITICAL", "MAJOR", "MINOR"] as Gravity[]).map(g => <label key={g} className={"is-" + g.toLowerCase()}>
          <input type="radio" name="gravity" checked={gravity === g} onChange={() => setGravity(g)}/>{l.gravity[g]}</label>)}
      </fieldset>
      <label><span>{l.detection}</span><select value={detection} required onChange={e => { setDetection(e.target.value); }}>
        {options.detections.map(d => <option key={d.id} value={d.id}>{d.name}{d.kind ? ` · ${l.origin[d.kind]}` : ""}</option>)}</select></label>
      <label><span>{l.issueType}</span><select value={issueType} required onChange={e => setIssueType(e.target.value)}>
        {options.issueTypes.length === 0 && <option value="">{l.noTypes}</option>}
        {options.issueTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <div className="daily-span visit-account-pick"><span>{l.accountLabel}{needsAccount && <small className="quality-required"> · {l.accountRequired}</small>}</span>
        {account ? <span className="chip">{account.name}<button type="button" aria-label={`× ${account.name}`} onClick={() => { setAccount(null); setQ(""); }}>×</button></span>
          : <><input value={q} placeholder={l.accountSearch} aria-label={l.accountLabel} onChange={e => setQ(e.target.value)}/>
            {hits.length > 0 && <ul role="listbox" aria-label={l.accountLabel}>{hits.map(h => <li key={h.id} role="option" aria-selected={false}>
              <button type="button" onClick={() => setAccount(h)}><Building2 size={14}/>{h.name}</button></li>)}</ul>}</>}
      </div>
      {error && <p className="daily-error daily-span" role="alert"><CircleAlert size={15}/>{error}</p>}
    </form>
  </Dialog>;
}
