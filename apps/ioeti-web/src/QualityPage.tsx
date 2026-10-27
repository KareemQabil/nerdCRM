import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft, ArrowRight, Building2, CalendarClock, CheckCircle2, CircleAlert, CircleDashed, ClipboardCheck, Flag, GitBranch, Plus, RotateCcw, Save,
  Search, ShieldAlert, ShieldCheck, Target, Trash2, TriangleAlert, UserRound, XCircle,
} from "lucide-react";
import { ApiError } from "./api";
import { Dialog } from "./Dialog";
import { DocumentsPanel } from "./DocumentsPanel";
import { searchEverything, wallClock } from "./dailyApi";
import {
  actOn, addAction, addCause, checkEffectiveness, chooseMethod, getIssue, getIssues, getQualityOptions, getQualityPeople, moveIssue, planIssue, raiseIssue,
  removeCause, type Choice, type CorrectiveAction, type Gravity, type QualityDetail, type QualityIssue, type QualityOptions, type Responsible, type RootCauseBranch,
} from "./qualityApi";
import type { Language } from "./preferences";
import "./daily.css";
import "./quality.css";
import { ErrorBanner, PageHeader } from "./ui";

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
    rca: "تحليل الأسباب الجذرية", rcaHint: "حدد طريقة التحليل، وسجّل الأسباب تحت فروعها: السبب، العملية اللي نشأ فيها، ومين المسؤول عنه، واللي اتلاقى.",
    method: "طريقة التحليل", chooseMethodHint: "اختار طريقة التحليل الأول.", methodLocked: "الطريقة متثبتة لأن فيه أسباب متسجلة؛ امسحها الأول لو عايز تغيّرها.",
    noCauses: "لسه مفيش أسباب في الفرع ده.", addCause: "إضافة سبب", addCauseIn: (b: string) => `إضافة سبب في "${b}"`, cause: "السبب", process: "العملية",
    responsible: "منسوب إلى", resp: { INTERNAL: "المؤسسة", CUSTOMER: "العميل", SUPPLIER: "المورد" } as Record<string, string>,
    respHint: "الأسباب الداخلية بتتنسب للمؤسسة مش لشخص بالاسم: التحليل عن العملية، مش عن الأفراد.",
    finding: "اللي اتلاقى", findingHint: "إيه الدليل أو الملاحظة اللي بتأكد السبب؟", removeCause: "حذف السبب", causesBy: "سجّل الأسباب",
    rcaSetupTitle: "إعداد تحليل الأسباب لسه ناقص", rcaSetupText: "مسؤول النظام يكمّل من إعداد الجودة ← تحليل الأسباب:",
    rcaMissing: { COMPANY: "الشركة النشطة", METHODS: "طريقة تحليل بفروع وأسباب تحتها", PROCESSES: "عملية واحدة على الأقل",
      COMPANY_PARTY: "سجل الشركة كطرف (لازم للأسباب الداخلية)" } as Record<string, string>,
    evidence: "الأدلة والمستندات",
    errors: { SETUP_REQUIRED: "إعداد الجودة ناقص؛ مسؤول النظام يكمّله من لوحة الإدارة ← إعداد الجودة.",
      METHOD_REQUIRED: "اختار طريقة التحليل الأول.", HAS_CAUSES: "فيه أسباب متسجلة بالطريقة دي؛ امسحها الأول.",
      NO_CUSTOMER: "المشكلة دي مش مرتبطة بعميل.", NO_SUPPLIER: "المشكلة دي مش مرتبطة بمورد.",
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
    rca: "Root-cause analysis", rcaHint: "Choose the analysis method and record causes under its branches: the cause, the process it arose in, who it is attributed to, and what was found.",
    method: "Analysis method", chooseMethodHint: "Choose the analysis method first.", methodLocked: "The method is fixed because causes are recorded; remove them first to change it.",
    noCauses: "No causes in this branch yet.", addCause: "Add a cause", addCauseIn: (b: string) => `Add a cause under "${b}"`, cause: "Cause", process: "Process",
    responsible: "Attributed to", resp: { INTERNAL: "The organisation", CUSTOMER: "The client", SUPPLIER: "The supplier" } as Record<string, string>,
    respHint: "Internal causes are attributed to the organisation, not a named person: the analysis is about the process, not individuals.",
    finding: "What was found", findingHint: "What evidence or observation confirms the cause?", removeCause: "Remove cause", causesBy: "Causes recorded by",
    rcaSetupTitle: "The root-cause set-up is not complete", rcaSetupText: "An administrator completes it under Quality set-up → Root-cause analysis:",
    rcaMissing: { COMPANY: "the active company", METHODS: "an analysis method with branches and causes", PROCESSES: "at least one process",
      COMPANY_PARTY: "the company's party record (needed for internal causes)" } as Record<string, string>,
    evidence: "Evidence & documents",
    errors: { SETUP_REQUIRED: "The quality set-up is incomplete; an administrator completes it in the admin console → Quality set-up.",
      METHOD_REQUIRED: "Choose the analysis method first.", HAS_CAUSES: "Causes are recorded with this method; remove them first.",
      NO_CUSTOMER: "This issue is not linked to a client.", NO_SUPPLIER: "This issue is not linked to a supplier.",
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
    <PageHeader eyebrow={l.eyebrow} title={l.title} description={l.hint} actions={<><button type="button" className="btn btn-primary" disabled={!ready} onClick={() => setRaising(true)}><Plus size={16}/>{l.raise}</button></>}/>
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
    {error && <ErrorBanner message={error}/>}
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
  const [dialog, setDialogState] = useState<null | { kind: "plan" } | { kind: "effectiveness" } | { kind: "move"; status: Choice } | { kind: "done"; action: CorrectiveAction }
    | { kind: "cause"; branch: RootCauseBranch }>(null);
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
    {error && !dialog && <ErrorBanner message={error}/>}
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

      <RootCauseSection l={l} data={data} options={options} busy={busy} when={when}
        onMethod={methodId => void run(() => chooseMethod(q.id, q.version, methodId))}
        onAdd={branch => setDialog({ kind: "cause", branch })}
        onRemove={causeId => void run(() => removeCause(q.id, q.version, causeId))}/>

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

      <section className="record-content-card" aria-label={l.evidence}><DocumentsPanel subject="QUALITY_ISSUE" subjectId={q.id} language={language}/></section>

      {dialog?.kind === "plan" && <PlanDialog l={l} data={data} people={people} onClose={() => setDialog(null)}
        onSave={input => run(() => planIssue(q.id, q.version, input))} busy={busy} error={error}/>}
      {dialog?.kind === "effectiveness" && <EffectivenessDialog l={l} busy={busy} error={error} onClose={() => setDialog(null)}
        onSave={(effective, check) => run(() => checkEffectiveness(q.id, q.version, effective, check))}/>}
      {dialog?.kind === "cause" && <CauseDialog l={l} q={q} branch={dialog.branch} processes={options?.processes ?? []} busy={busy} error={error}
        onClose={() => setDialog(null)} onSave={input => run(() => addCause(q.id, q.version, input))}/>}
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

/**
 * Root-cause analysis on the company's own method: its branches side by side (as on a cause-and-effect diagram), each with the
 * causes recorded under it. The method is fixed once causes are recorded; nothing here is a scoring rule.
 */
function RootCauseSection({ l, data, options, busy, when, onMethod, onAdd, onRemove }: {
  l: Labels; data: QualityDetail; options: QualityOptions | null; busy: boolean; when: (value: string | null) => string;
  onMethod: (methodId: number | null) => void; onAdd: (branch: RootCauseBranch) => void; onRemove: (causeId: number) => void;
}) {
  const q = data.issue, rc = data.rootCause;
  const open = q.statusKind === "OPEN";
  const locked = rc.causes.length > 0;
  const methods = options?.methods ?? [];
  return <section className="record-content-card quality-rca" aria-labelledby="quality-rca-title">
    <div className="quality-section-head"><h2 id="quality-rca-title"><Search size={17}/>{l.rca}</h2></div>
    <p className="quality-rca-hint">{l.rcaHint}</p>
    {options && !options.analysisReady && <div className="quality-setup is-compact" role="note"><TriangleAlert size={16}/>
      <div><strong>{l.rcaSetupTitle}</strong><p>{l.rcaSetupText}</p><ul>{options.analysisMissing.map(m => <li key={m}>{l.rcaMissing[m]}</li>)}</ul></div></div>}
    {(methods.length > 0 || rc.methodId) && <div className="quality-rca-method" role="radiogroup" aria-label={l.method}>
      <span>{l.method}:</span>
      {rc.methodId && !methods.some(m => m.id === rc.methodId) && <button type="button" role="radio" aria-checked className="quality-rca-chip is-chosen" disabled>{rc.methodName}</button>}
      {methods.map(m => <button key={m.id} type="button" role="radio" aria-checked={rc.methodId === m.id}
        className={"quality-rca-chip" + (rc.methodId === m.id ? " is-chosen" : "")} disabled={busy || !open || (locked && rc.methodId !== m.id)}
        onClick={() => rc.methodId !== m.id && onMethod(m.id)}><GitBranch size={13}/>{m.name}</button>)}
      {locked && <small className="quality-rca-locked">{l.methodLocked}</small>}
    </div>}
    {!rc.methodId ? (methods.length > 0 && <p className="activity-empty">{l.chooseMethodHint}</p>)
      : <div className="quality-fishbone">
        {rc.branches.map(b => {
          const recorded = rc.causes.filter(c => c.branch === b.name);
          return <div key={b.id} className="quality-bone" aria-labelledby={`quality-bone-${b.id}`} role="group">
            <h3 id={`quality-bone-${b.id}`}><GitBranch size={14}/>{b.name}<small>{recorded.length}</small></h3>
            {recorded.length === 0 ? <p className="quality-bone-empty">{l.noCauses}</p>
              : <ul>{recorded.map(c => <li key={c.id} className={"quality-cause is-" + c.responsible.toLowerCase()}>
                <div className="quality-cause-head"><strong>{c.cause}</strong>
                  {open && <button type="button" className="icon-button" aria-label={`${l.removeCause}: ${c.cause}`} disabled={busy} onClick={() => onRemove(c.id)}><Trash2 size={14}/></button>}</div>
                <span className="quality-card-meta">
                  {c.process && <span>{l.process}: {c.process}</span>}
                  <span className={"quality-resp is-" + c.responsible.toLowerCase()}>{l.resp[c.responsible]}{c.responsibleName && ` · ${c.responsibleName}`}</span>
                </span>
                {c.finding && <p>{c.finding}</p>}
              </li>)}</ul>}
            {open && b.causes.length > 0 && <button type="button" className="btn btn-small btn-secondary quality-bone-add" disabled={busy || !options?.processes.length}
              aria-label={l.addCauseIn(b.name)} onClick={() => onAdd(b)}><Plus size={14}/>{l.addCause}</button>}
          </div>;
        })}
      </div>}
    {rc.writtenByName && <small className="quality-rca-by">{l.causesBy}: {rc.writtenByName} · {when(rc.writtenAt)}</small>}
  </section>;
}

function CauseDialog({ l, q, branch, processes, busy, error, onClose, onSave }: {
  l: Labels; q: QualityIssue; branch: RootCauseBranch; processes: Choice[]; busy: boolean; error: string; onClose: () => void;
  onSave: (input: { causeId: number; processId: number; responsible: Responsible; finding: string }) => Promise<boolean>;
}) {
  const [cause, setCause] = useState(branch.causes.length === 1 ? String(branch.causes[0].id) : "");
  const [process, setProcess] = useState(processes.length === 1 ? String(processes[0].id) : "");
  const external: Responsible | null = q.origin === "CUSTOMER" ? "CUSTOMER" : q.origin === "SUPPLIER" ? "SUPPLIER" : null;
  const [responsible, setResponsible] = useState<Responsible>("INTERNAL");
  const [finding, setFinding] = useState("");
  const choices: Responsible[] = external ? ["INTERNAL", external] : ["INTERNAL"];
  return <Dialog title={l.addCauseIn(branch.name)} kicker={q.title ?? ""} busy={busy} onClose={onClose} wide
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="quality-cause-form" className="btn btn-primary" disabled={busy || !cause || !process || !finding.trim()}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="quality-cause-form" className="daily-form daily-form-two" onSubmit={e => { e.preventDefault();
      void onSave({ causeId: Number(cause), processId: Number(process), responsible, finding: finding.trim() }); }}>
      <label><span>{l.cause}</span><select value={cause} required onChange={e => setCause(e.target.value)}><option value="">{l.choose}</option>
        {branch.causes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label><span>{l.process}</span><select value={process} required onChange={e => setProcess(e.target.value)}><option value="">{l.choose}</option>
        {processes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <fieldset className="daily-span quality-choice"><legend>{l.responsible}</legend>
        {choices.map(r => <label key={r}><input type="radio" name="responsible" checked={responsible === r} onChange={() => setResponsible(r)}/>
          {l.resp[r]}{r !== "INTERNAL" && q.accountName ? ` · ${q.accountName}` : ""}</label>)}
        <small>{l.respHint}</small>
      </fieldset>
      <label className="daily-span"><span>{l.finding}</span><textarea value={finding} required rows={3} maxLength={4000} placeholder={l.findingHint}
        onChange={e => setFinding(e.target.value)}/></label>
      {error && <p className="daily-error daily-span" role="alert"><CircleAlert size={15}/>{error}</p>}
    </form>
  </Dialog>;
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
