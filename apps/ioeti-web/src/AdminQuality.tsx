import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { Check, CircleAlert, GitBranch, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { ApiError } from "./api";
import {
  addMethodBranch, addQualityValue, changeQualityValue, deleteMethodBranch, deleteQualityValue, getPeople, getQualityValues,
  type QualityExtra, type QualityList, type QualityValue,
} from "./adminApi";
import { Dialog } from "./Dialog";
import "./admin.css";

type Language = "ar" | "en";
type Ref = { id: number; name: string };
const GROUPS: { key: "issues" | "analysis"; lists: QualityList[] }[] = [
  { key: "issues", lists: ["statuses", "detections", "issue-types", "action-types"] },
  { key: "analysis", lists: ["methods", "causes", "processes"] },
];
const KIND_OPTIONS: Partial<Record<QualityList, string[]>> = { statuses: ["OPEN", "CLOSED", "CANCELLED"], detections: ["INTERNAL", "CUSTOMER", "SUPPLIER"] };
const L = {
  ar: {
    title: "إعداد الجودة",
    intro: "دي اختيارات نظام الجودة بتاع الشركة. مفيش قيم جاهزة: لحد ما تضيف حالة مفتوحة ومصدر اكتشاف ونوع مشكلة، محدش هيقدر يسجّل مشكلة جودة. وتحليل الأسباب محتاج طريقة تحليل بفروعها وأسبابها وعملية واحدة على الأقل.",
    groups: { issues: "تسجيل المشاكل", analysis: "تحليل الأسباب" },
    lists: { statuses: "الحالات", detections: "مصادر الاكتشاف", "issue-types": "أنواع المشاكل", "action-types": "أنواع الإجراءات",
      methods: "طرق التحليل", causes: "الأسباب", processes: "العمليات" },
    hints: {
      statuses: "المراحل اللي المشكلة بتمر بيها. أول حالة مفتوحة (بالترتيب) هي اللي المشكلة الجديدة بتبدأ بيها.",
      detections: "المشكلة اتعرفت منين. لو المصدر عميل أو مورد، لازم يتحدد الحساب عند التسجيل.",
      "issue-types": "تصنيف المشكلة نفسها: تأخير، خطأ في تقرير، شكوى من مدرب… خاصة بشركتك.",
      "action-types": "تصنيف الإجراءات التصحيحية (اختياري عند إضافة إجراء).",
      methods: "طريقة التحليل اللي شركتك بتستخدمها، وفروعها (فئات الأسباب) زي مخطط عظمة السمكة: الأفراد، الطريقة، المعدات…",
      causes: "الأسباب المعروفة، كل سبب تحت فرع من فروع طريقة تحليل.",
      processes: "عمليات الشركة اللي ممكن السبب يكون نشأ فيها، ولكل عملية مسؤول.",
    },
    placeholder: { statuses: "مثال: قيد التحليل", detections: "مثال: شكوى عميل", "issue-types": "مثال: تأخير تسليم تقرير", "action-types": "مثال: تعديل إجراء عمل",
      methods: "مثال: عظمة السمكة", causes: "مثال: غياب قالب موحد", processes: "مثال: إعداد التقارير" },
    kinds: { OPEN: "مفتوحة", CLOSED: "مقفولة", CANCELLED: "ملغاة", INTERNAL: "داخلي", CUSTOMER: "عميل", SUPPLIER: "مورد" } as Record<string, string>,
    kindLabel: { statuses: "نوع الحالة", detections: "المصدر" } as Record<string, string>,
    branch: "الفرع", chooseBranch: "اختار الفرع…", owner: "المسؤول", chooseOwner: "اختار المسؤول…",
    branches: "الفروع", addBranch: "إضافة فرع", branchPlaceholder: "مثال: الأفراد", noBranches: "لسه مفيش فروع؛ ضيف فرع عشان تقدر تضيف أسباب تحتها.",
    noMethods: "ضيف طريقة تحليل بفروعها الأول، وبعدين الأسباب تحت فروعها.",
    causesIn: (n: number) => n === 0 ? "مفيش أسباب" : n === 1 ? "سبب واحد" : `${n} أسباب`,
    removeBranch: "حذف الفرع", branchInUse: "الفرع ده تحته أسباب؛ انقلها أو احذفها الأول.",
    add: "إضافة", save: "حفظ", cancel: "إلغاء", rename: "إعادة تسمية", remove: "حذف", loading: "جاري التحميل…", empty: "لسه مفيش قيم.",
    uses: (n: number) => n === 0 ? "غير مستخدم" : n === 1 ? "مستخدم مرة" : `مستخدم ${n} مرات`,
    inUse: "مستخدم في سجلات؛ غيّر اسمه بدل ما تحذفه.", confirmTitle: "حذف القيمة؟", confirmText: (n: string) => `"${n}" هتختفي من القائمة. مفيش سجلات بتستخدمها.`,
    errors: { DUPLICATE: "الاسم ده موجود في القائمة.", REQUIRED: "اكمل البيانات المطلوبة.", TOO_LONG: "الاسم طويل.", IN_USE: "القيمة مستخدمة؛ غيّر اسمها بدل الحذف.",
      COMPANY_REQUIRED: "اختار الشركة النشطة الأول من إعداداتك؛ القيم دي تابعة لشركة.", UNAVAILABLE: "اختيار غير متاح.",
      conflict: "القائمة اتغيرت من مكان تاني؛ اتحدّثت.", forbidden: "لمسؤولي النظام بس.", failed: "تعذّر تنفيذ الطلب." },
  },
  en: {
    title: "Quality set-up",
    intro: "These are your company's quality-system choices. None are shipped: until you add an open status, a detection source and an issue type, nobody can raise a quality issue. Root-cause analysis needs an analysis method with branches and causes, and at least one process.",
    groups: { issues: "Raising issues", analysis: "Root-cause analysis" },
    lists: { statuses: "Statuses", detections: "Detection sources", "issue-types": "Issue types", "action-types": "Action types",
      methods: "Analysis methods", causes: "Causes", processes: "Processes" },
    hints: {
      statuses: "The stages an issue goes through. The first open status (in order) is where a new issue starts.",
      detections: "Where the issue was found. For a client or supplier source, the account is required when raising.",
      "issue-types": "What kind of issue it is: a delay, a report error, a complaint about a trainer… your company's own.",
      "action-types": "How corrective actions are grouped (optional when adding an action).",
      methods: "The analysis method your company uses and its branches (cause categories), as on a fishbone diagram: people, method, equipment…",
      causes: "Known causes, each under a branch of an analysis method.",
      processes: "Your company's processes where a cause can arise, each with an owner.",
    },
    placeholder: { statuses: "e.g. Under analysis", detections: "e.g. Client complaint", "issue-types": "e.g. Late report delivery", "action-types": "e.g. Procedure change",
      methods: "e.g. Fishbone", causes: "e.g. No standard template", processes: "e.g. Report preparation" },
    kinds: { OPEN: "Open", CLOSED: "Closed", CANCELLED: "Cancelled", INTERNAL: "Internal", CUSTOMER: "Client", SUPPLIER: "Supplier" } as Record<string, string>,
    kindLabel: { statuses: "Status kind", detections: "Source" } as Record<string, string>,
    branch: "Branch", chooseBranch: "Choose the branch…", owner: "Owner", chooseOwner: "Choose the owner…",
    branches: "Branches", addBranch: "Add branch", branchPlaceholder: "e.g. People", noBranches: "No branches yet; add one to put causes under it.",
    noMethods: "Add an analysis method with its branches first, then causes under its branches.",
    causesIn: (n: number) => n === 0 ? "No causes" : n === 1 ? "1 cause" : `${n} causes`,
    removeBranch: "Remove branch", branchInUse: "This branch has causes; move or delete them first.",
    add: "Add", save: "Save", cancel: "Cancel", rename: "Rename", remove: "Delete", loading: "Loading…", empty: "No values yet.",
    uses: (n: number) => n === 0 ? "Not used" : n === 1 ? "Used once" : `Used ${n} times`,
    inUse: "Used by records; rename it instead of deleting it.", confirmTitle: "Delete this value?", confirmText: (n: string) => `"${n}" leaves the list. No record uses it.`,
    errors: { DUPLICATE: "This name is already in the list.", REQUIRED: "Complete the required details.", TOO_LONG: "The name is too long.", IN_USE: "This value is in use; rename it instead.",
      COMPANY_REQUIRED: "Choose your active company first in your settings; these values belong to a company.", UNAVAILABLE: "This choice is not available.",
      conflict: "The list changed elsewhere; it was refreshed.", forbidden: "Administrators only.", failed: "The request failed." },
  },
};
type Labels = typeof L.ar;

function problem(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.errors.failed;
  const code = error.fields?.[0]?.code ?? error.code ?? "";
  if (code in l.errors) return (l.errors as Record<string, string>)[code];
  if (error.statusCode === 409) return l.errors.conflict;
  if (error.statusCode === 403) return l.errors.forbidden;
  return l.errors.failed;
}

/** The company's quality set-up, managed by administrators; nothing is shipped. */
export function AdminQuality({ language }: { language: Language }) {
  const l = L[language], ar = language === "ar";
  const [which, setWhich] = useState<QualityList>("statuses");
  const [rows, setRows] = useState<QualityValue[] | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [ref, setRef] = useState("");
  const [methods, setMethods] = useState<QualityValue[]>([]);
  const [people, setPeople] = useState<Ref[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removing, setRemoving] = useState<QualityValue | null>(null);
  const options = KIND_OPTIONS[which];
  const load = useCallback(async (list: QualityList) => {
    try {
      setRows(await getQualityValues(list));
      // causes go under a method's branch; processes have an owner
      if (list === "causes") setMethods(await getQualityValues("methods"));
      if (list === "processes") setPeople((await getPeople({ status: "active" })).map(p => ({ id: p.id, name: p.name })));
    } catch (e) { setRows([]); setError(problem(e, l)); }
  }, [l]);
  useEffect(() => { setRows(null); setError(""); setNotice(""); setName(""); setRef(""); setKind(KIND_OPTIONS[which]?.[0] ?? ""); void load(which); }, [which, load]);
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true); setError(""); setNotice("");
    try { await action(); return true; }
    catch (e) { setError(problem(e, l)); if (e instanceof ApiError && e.statusCode === 409) void load(which); return false; }
    finally { setBusy(false); }
  }
  const extra = (): QualityExtra => which === "causes" ? { branchId: Number(ref) } : which === "processes" ? { ownerId: Number(ref) } : options ? { kind } : {};
  const needsRef = which === "causes" || which === "processes";
  function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || (needsRef && !ref)) return;
    void run(async () => { const saved = await addQualityValue(which, name.trim(), extra()); await load(which); setName(""); setNotice(`✓ ${saved.name}`); });
  }
  const withBranches = methods.filter(m => (m.branches ?? []).length > 0);
  return <div className="admin-lists">
    <p className="daily-note admin-quality-intro"><ShieldCheck size={15}/>{l.intro}</p>
    <div className="admin-quality-groups">
      {GROUPS.map(g => <div key={g.key} className="admin-quality-group">
        <span className="admin-quality-group-label" id={`admin-quality-${g.key}`}>{l.groups[g.key]}</span>
        <div className="segmented" role="tablist" aria-labelledby={`admin-quality-${g.key}`}>
          {g.lists.map(k => <button key={k} type="button" role="tab" aria-selected={which === k} className={which === k ? "chosen" : ""} onClick={() => setWhich(k)}>{l.lists[k]}</button>)}
        </div>
      </div>)}
    </div>
    <section className="data-panel admin-list-panel" aria-labelledby="admin-quality-title">
      <div className="admin-list-head">
        <div><h2 id="admin-quality-title"><ShieldCheck size={18}/>{l.lists[which]}</h2><p>{l.hints[which]}</p></div>
        <form className="admin-list-add" onSubmit={add}>
          <input value={name} maxLength={255} placeholder={l.placeholder[which]} aria-label={l.lists[which]} onChange={e => setName(e.target.value)}/>
          {options && <select value={kind} aria-label={l.kindLabel[which]} onChange={e => setKind(e.target.value)}>
            {options.map(o => <option key={o} value={o}>{l.kinds[o]}</option>)}</select>}
          {which === "causes" && <select value={ref} aria-label={l.branch} onChange={e => setRef(e.target.value)}>
            <option value="">{l.chooseBranch}</option>
            {withBranches.map(m => <optgroup key={m.id} label={m.name}>{(m.branches ?? []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>)}
          </select>}
          {which === "processes" && <select value={ref} aria-label={l.owner} onChange={e => setRef(e.target.value)}>
            <option value="">{l.chooseOwner}</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>}
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || (needsRef && !ref)}><Plus size={16}/>{l.add}</button>
        </form>
      </div>
      {which === "causes" && rows !== null && withBranches.length === 0 && <p className="daily-note"><GitBranch size={14}/>{l.noMethods}</p>}
      {error && <p className="admin-list-error" role="alert"><CircleAlert size={15}/>{error}</p>}
      {notice && <p className="admin-list-notice" role="status">{notice}</p>}
      {rows === null ? <p className="admin-list-empty" role="status">{l.loading}</p>
        : rows.length === 0 ? <p className="admin-list-empty">{l.empty}</p>
        : <ol className="admin-list-rows">{rows.map(row => <Row key={row.id} row={row} which={which} l={l} ar={ar} options={options} busy={busy}
            methods={withBranches} people={people}
            onChange={(v, n, x) => run(async () => { await changeQualityValue(which, v.id, v.version, n, x); await load(which); })}
            onBranch={(action) => run(async () => { await action(); await load(which); })}
            onRemove={setRemoving}/>)}</ol>}
    </section>
    {removing && <Dialog title={l.confirmTitle} description={l.confirmText(removing.name)} kicker={l.lists[which]} busy={busy} onClose={() => setRemoving(null)}
      footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setRemoving(null)}>{l.cancel}</button>
        <button type="button" className="btn btn-primary admin-danger" disabled={busy}
          onClick={() => void run(async () => { setRows(await deleteQualityValue(which, removing.id, removing.version)); setRemoving(null); })}>
          <Trash2 size={16}/>{l.remove}</button></>}>
      {error && <p className="admin-list-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    </Dialog>}
  </div>;
}

function Row({ row, which, l, ar, options, busy, methods, people, onChange, onBranch, onRemove }: {
  row: QualityValue; which: QualityList; l: Labels; ar: boolean; options?: string[]; busy: boolean; methods: QualityValue[]; people: Ref[];
  onChange: (row: QualityValue, name: string, extra?: QualityExtra) => Promise<boolean>;
  onBranch: (action: () => Promise<unknown>) => Promise<boolean>; onRemove: (row: QualityValue) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.name);
  async function save() {
    if (!value.trim() || value.trim() === row.name) { setEditing(false); setValue(row.name); return; }
    if (await onChange(row, value.trim(), row.kind ? { kind: row.kind } : undefined)) setEditing(false);
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); void save(); }
    if (e.key === "Escape") { e.preventDefault(); setEditing(false); setValue(row.name); }
  }
  return <li className={"admin-list-row" + (which === "methods" ? " admin-quality-method" : "")}>
    <div className="admin-quality-row-main">
      {editing
        ? <input className="admin-list-edit" autoFocus value={value} maxLength={255} aria-label={l.rename} onChange={e => setValue(e.target.value)} onKeyDown={onKey}/>
        : <strong className="admin-list-name">{row.name}</strong>}
      <span className="admin-list-meta">
        {options && row.kind && <select className={"admin-quality-kind is-" + row.kind.toLowerCase()} value={row.kind} disabled={busy}
          aria-label={`${ar ? "النوع" : "Kind"}: ${row.name}`} onChange={e => void onChange(row, row.name, { kind: e.target.value })}>
          {options.map(o => <option key={o} value={o}>{l.kinds[o]}</option>)}</select>}
        {which === "causes" && <select className="admin-quality-kind" value={row.branchId ?? ""} disabled={busy} aria-label={`${l.branch}: ${row.name}`}
          onChange={e => void onChange(row, row.name, { branchId: Number(e.target.value) })}>
          {row.branchId && !methods.some(m => m.branches?.some(b => b.id === row.branchId)) && <option value={row.branchId}>{row.branchName}</option>}
          {methods.map(m => <optgroup key={m.id} label={m.name}>{(m.branches ?? []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>)}
        </select>}
        {which === "processes" && <select className="admin-quality-kind" value={row.ownerId ?? ""} disabled={busy} aria-label={`${l.owner}: ${row.name}`}
          onChange={e => void onChange(row, row.name, { ownerId: Number(e.target.value) })}>
          {row.ownerId && !people.some(p => p.id === row.ownerId) && <option value={row.ownerId}>{row.ownerName}</option>}
          {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>}
        {row.code && <code dir="ltr" className="admin-numbering-example">{row.code}</code>}
        <span className={"admin-badge" + (row.uses ? "" : " is-quiet")}>{l.uses(row.uses)}</span>
      </span>
      <span className="admin-list-actions">
        {editing ? <>
          <button type="button" className="icon-button" aria-label={l.save} disabled={busy} onClick={() => void save()}><Check size={16}/></button>
          <button type="button" className="icon-button" aria-label={l.cancel} onClick={() => { setEditing(false); setValue(row.name); }}><X size={16}/></button>
        </> : <>
          <button type="button" className="icon-button" aria-label={`${l.rename}: ${row.name}`} disabled={busy} onClick={() => setEditing(true)}><Pencil size={15}/></button>
          <button type="button" className="icon-button" aria-label={`${l.remove}: ${row.name}`} disabled={busy || row.uses > 0}
            title={row.uses ? l.inUse : undefined} onClick={() => onRemove(row)}><Trash2 size={15}/></button>
        </>}
      </span>
    </div>
    {which === "methods" && <Branches method={row} l={l} busy={busy} onBranch={onBranch}/>}
  </li>;
}

/** A method's branches (cause categories) in order, added and removed with the method's version. */
function Branches({ method, l, busy, onBranch }: { method: QualityValue; l: Labels; busy: boolean; onBranch: (action: () => Promise<unknown>) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const branches = method.branches ?? [];
  function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    void onBranch(() => addMethodBranch(method, name.trim())).then(done => { if (done) setName(""); });
  }
  return <div className="admin-quality-branches">
    <span className="admin-quality-group-label"><GitBranch size={13}/>{l.branches}</span>
    {branches.length === 0 ? <p className="admin-quality-branch-empty">{l.noBranches}</p>
      : <ul aria-label={`${l.branches}: ${method.name}`}>{branches.map(b => <li key={b.id} className="admin-quality-branch">
          <span>{b.name}</span><small>{l.causesIn(b.causes)}</small>
          <button type="button" className="icon-button" aria-label={`${l.removeBranch}: ${b.name}`} disabled={busy || b.causes > 0}
            title={b.causes > 0 ? l.branchInUse : undefined} onClick={() => void onBranch(() => deleteMethodBranch(method, b.id))}><X size={14}/></button>
        </li>)}</ul>}
    <form className="admin-quality-branch-add" onSubmit={add}>
      <input value={name} maxLength={255} placeholder={l.branchPlaceholder} aria-label={`${l.addBranch}: ${method.name}`} onChange={e => setName(e.target.value)}/>
      <button type="submit" className="btn btn-small btn-secondary" disabled={busy || !name.trim()}><Plus size={14}/>{l.addBranch}</button>
    </form>
  </div>;
}
