import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { Check, CircleAlert, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { ApiError } from "./api";
import { addQualityValue, changeQualityValue, deleteQualityValue, getQualityValues, type QualityList, type QualityValue } from "./adminApi";
import { Dialog } from "./Dialog";
import "./admin.css";

type Language = "ar" | "en";
const LISTS: QualityList[] = ["statuses", "detections", "issue-types", "action-types"];
const KIND_OPTIONS: Partial<Record<QualityList, string[]>> = { statuses: ["OPEN", "CLOSED", "CANCELLED"], detections: ["INTERNAL", "CUSTOMER", "SUPPLIER"] };
const L = {
  ar: {
    title: "إعداد الجودة",
    intro: "دي اختيارات نظام الجودة بتاع الشركة. مفيش قيم جاهزة: لحد ما تضيف حالة مفتوحة ومصدر اكتشاف ونوع مشكلة، محدش هيقدر يسجّل مشكلة جودة.",
    lists: { statuses: "الحالات", detections: "مصادر الاكتشاف", "issue-types": "أنواع المشاكل", "action-types": "أنواع الإجراءات" },
    hints: {
      statuses: "المراحل اللي المشكلة بتمر بيها. أول حالة مفتوحة (بالترتيب) هي اللي المشكلة الجديدة بتبدأ بيها.",
      detections: "المشكلة اتعرفت منين. لو المصدر عميل أو مورد، لازم يتحدد الحساب عند التسجيل.",
      "issue-types": "تصنيف المشكلة نفسها: تأخير، خطأ في تقرير، شكوى من مدرب… خاصة بشركتك.",
      "action-types": "تصنيف الإجراءات التصحيحية (اختياري عند إضافة إجراء).",
    },
    placeholder: { statuses: "مثال: قيد التحليل", detections: "مثال: شكوى عميل", "issue-types": "مثال: تأخير تسليم تقرير", "action-types": "مثال: تعديل إجراء عمل" },
    kinds: { OPEN: "مفتوحة", CLOSED: "مقفولة", CANCELLED: "ملغاة", INTERNAL: "داخلي", CUSTOMER: "عميل", SUPPLIER: "مورد" } as Record<string, string>,
    kindLabel: { statuses: "نوع الحالة", detections: "المصدر" } as Record<string, string>,
    add: "إضافة", save: "حفظ", cancel: "إلغاء", rename: "إعادة تسمية", remove: "حذف", loading: "جاري التحميل…", empty: "لسه مفيش قيم.",
    uses: (n: number) => n === 0 ? "غير مستخدم" : n === 1 ? "مستخدم مرة" : `مستخدم ${n} مرات`,
    inUse: "مستخدم في سجلات؛ غيّر اسمه بدل ما تحذفه.", confirmTitle: "حذف القيمة؟", confirmText: (n: string) => `"${n}" هتختفي من القائمة. مفيش سجلات بتستخدمها.`,
    errors: { DUPLICATE: "الاسم ده موجود في القائمة.", REQUIRED: "اكتب اسم.", TOO_LONG: "الاسم طويل.", IN_USE: "القيمة مستخدمة؛ غيّر اسمها بدل الحذف.",
      COMPANY_REQUIRED: "اختار الشركة النشطة الأول من إعداداتك؛ أنواع المشاكل والإجراءات تابعة لشركة.", UNAVAILABLE: "اختيار غير متاح.",
      conflict: "القائمة اتغيرت من مكان تاني؛ اتحدّثت.", forbidden: "لمسؤولي النظام بس.", failed: "تعذّر تنفيذ الطلب." },
  },
  en: {
    title: "Quality set-up",
    intro: "These are your company's quality-system choices. None are shipped: until you add an open status, a detection source and an issue type, nobody can raise a quality issue.",
    lists: { statuses: "Statuses", detections: "Detection sources", "issue-types": "Issue types", "action-types": "Action types" },
    hints: {
      statuses: "The stages an issue goes through. The first open status (in order) is where a new issue starts.",
      detections: "Where the issue was found. For a client or supplier source, the account is required when raising.",
      "issue-types": "What kind of issue it is: a delay, a report error, a complaint about a trainer… your company's own.",
      "action-types": "How corrective actions are grouped (optional when adding an action).",
    },
    placeholder: { statuses: "e.g. Under analysis", detections: "e.g. Client complaint", "issue-types": "e.g. Late report delivery", "action-types": "e.g. Procedure change" },
    kinds: { OPEN: "Open", CLOSED: "Closed", CANCELLED: "Cancelled", INTERNAL: "Internal", CUSTOMER: "Client", SUPPLIER: "Supplier" } as Record<string, string>,
    kindLabel: { statuses: "Status kind", detections: "Source" } as Record<string, string>,
    add: "Add", save: "Save", cancel: "Cancel", rename: "Rename", remove: "Delete", loading: "Loading…", empty: "No values yet.",
    uses: (n: number) => n === 0 ? "Not used" : n === 1 ? "Used once" : `Used ${n} times`,
    inUse: "Used by records; rename it instead of deleting it.", confirmTitle: "Delete this value?", confirmText: (n: string) => `"${n}" leaves the list. No record uses it.`,
    errors: { DUPLICATE: "This name is already in the list.", REQUIRED: "Type a name.", TOO_LONG: "The name is too long.", IN_USE: "This value is in use; rename it instead.",
      COMPANY_REQUIRED: "Choose your active company first in your settings; issue and action types belong to a company.", UNAVAILABLE: "This choice is not available.",
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removing, setRemoving] = useState<QualityValue | null>(null);
  const options = KIND_OPTIONS[which];
  const load = useCallback(async (list: QualityList) => {
    try { setRows(await getQualityValues(list)); } catch (e) { setRows([]); setError(problem(e, l)); }
  }, [l]);
  useEffect(() => { setRows(null); setError(""); setNotice(""); setName(""); setKind(KIND_OPTIONS[which]?.[0] ?? ""); void load(which); }, [which, load]);
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true); setError(""); setNotice("");
    try { await action(); return true; }
    catch (e) { setError(problem(e, l)); if (e instanceof ApiError && e.statusCode === 409) void load(which); return false; }
    finally { setBusy(false); }
  }
  function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    void run(async () => { const saved = await addQualityValue(which, name.trim(), options ? kind : undefined); await load(which); setName(""); setNotice(`✓ ${saved.name}`); });
  }
  return <div className="admin-lists">
    <p className="daily-note admin-quality-intro"><ShieldCheck size={15}/>{l.intro}</p>
    <div className="segmented" role="tablist" aria-label={l.title}>
      {LISTS.map(k => <button key={k} type="button" role="tab" aria-selected={which === k} className={which === k ? "chosen" : ""} onClick={() => setWhich(k)}>{l.lists[k]}</button>)}
    </div>
    <section className="data-panel admin-list-panel" aria-labelledby="admin-quality-title">
      <div className="admin-list-head">
        <div><h2 id="admin-quality-title"><ShieldCheck size={18}/>{l.lists[which]}</h2><p>{l.hints[which]}</p></div>
        <form className="admin-list-add" onSubmit={add}>
          <input value={name} maxLength={255} placeholder={l.placeholder[which]} aria-label={l.lists[which]} onChange={e => setName(e.target.value)}/>
          {options && <select value={kind} aria-label={l.kindLabel[which]} onChange={e => setKind(e.target.value)}>
            {options.map(o => <option key={o} value={o}>{l.kinds[o]}</option>)}</select>}
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}><Plus size={16}/>{l.add}</button>
        </form>
      </div>
      {error && <p className="admin-list-error" role="alert"><CircleAlert size={15}/>{error}</p>}
      {notice && <p className="admin-list-notice" role="status">{notice}</p>}
      {rows === null ? <p className="admin-list-empty" role="status">{l.loading}</p>
        : rows.length === 0 ? <p className="admin-list-empty">{l.empty}</p>
        : <ol className="admin-list-rows">{rows.map(row => <Row key={row.id} row={row} l={l} ar={ar} options={options} busy={busy}
            onChange={(v, n, k) => run(async () => { await changeQualityValue(which, v.id, v.version, n, k); await load(which); })}
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

function Row({ row, l, ar, options, busy, onChange, onRemove }: {
  row: QualityValue; l: Labels; ar: boolean; options?: string[]; busy: boolean;
  onChange: (row: QualityValue, name: string, kind?: string) => Promise<boolean>; onRemove: (row: QualityValue) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.name);
  async function save() {
    if (!value.trim() || value.trim() === row.name) { setEditing(false); setValue(row.name); return; }
    if (await onChange(row, value.trim(), row.kind ?? undefined)) setEditing(false);
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); void save(); }
    if (e.key === "Escape") { e.preventDefault(); setEditing(false); setValue(row.name); }
  }
  return <li className="admin-list-row">
    {editing
      ? <input className="admin-list-edit" autoFocus value={value} maxLength={255} aria-label={l.rename} onChange={e => setValue(e.target.value)} onKeyDown={onKey}/>
      : <strong className="admin-list-name">{row.name}</strong>}
    <span className="admin-list-meta">
      {options && row.kind && <select className={"admin-quality-kind is-" + row.kind.toLowerCase()} value={row.kind} disabled={busy}
        aria-label={`${ar ? "النوع" : "Kind"}: ${row.name}`} onChange={e => void onChange(row, row.name, e.target.value)}>
        {options.map(o => <option key={o} value={o}>{l.kinds[o]}</option>)}</select>}
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
  </li>;
}
