import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Check, CircleAlert, GripVertical, ListChecks, LockKeyhole, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ApiError } from "./api";
import { addListValue, deleteListValue, getListValues, orderStages, renameListValue, type ListKind, type ListValue } from "./adminApi";
import { Dialog } from "./Dialog";
import { stageLabel } from "./labels";
import "./admin.css";

type Language = "ar" | "en";
const KINDS: ListKind[] = ["lost-reasons", "sources", "opportunity-stages", "campaign-types"];
const L = {
  ar: {
    kinds: { "lost-reasons": "أسباب الخسارة", sources: "مصادر العملاء المحتملين", "opportunity-stages": "مراحل الفرص", "campaign-types": "أنواع الحملات" },
    hints: {
      "lost-reasons": "البائع بيختار منها لما يسجّل فرصة أو عميل محتمل كخاسر. من غيرها مش هينفع حد يسجّل خسارة.",
      sources: "منين جه العميل المحتمل: معرض، موقع، ترشيح… بتظهر في التسجيل والتقارير.",
      "opportunity-stages": "مسار الفرصة من أول تواصل لحد القرار. اسحب لتغيير الترتيب؛ مراحل الفوز والخسارة ثابتة في الآخر.",
      "campaign-types": "تصنيف الحملات: معرض، ندوة، بريد، تواصل اجتماعي… بتظهر عند إنشاء الحملة.",
    },
    placeholder: { "lost-reasons": "مثال: السعر أعلى من الميزانية", sources: "مثال: معرض القاهرة", "opportunity-stages": "مثال: زيارة تقييم", "campaign-types": "مثال: معرض" },
    add: "إضافة", save: "حفظ", cancel: "إلغاء", rename: "إعادة تسمية", remove: "حذف", close: "إغلاق",
    uses: (n: number) => n === 0 ? "غير مستخدم" : n === 1 ? "مستخدم مرة" : `مستخدم ${n} مرات`,
    roles: { WON: "مرحلة الفوز", LOST: "مرحلة الخسارة", DEFAULT: "مرحلة البداية", PROPOSITION: "مرحلة العرض" },
    protectedNote: "مرحلة أساسية في إعداد المبيعات: تتغير تسميتها بس، ومتتحذفش.",
    inUse: "مستخدم في سجلات؛ غيّر اسمه بدل ما تحذفه.",
    confirmTitle: "حذف القيمة؟", confirmText: (n: string) => `"${n}" هتختفي من القائمة. مفيش سجلات بتستخدمها.`,
    empty: { "lost-reasons": "لسه مفيش أسباب خسارة. ضيف أول سبب علشان الفريق يقدر يسجّل الصفقات الخاسرة.", sources: "لسه مفيش مصادر.", "opportunity-stages": "مفيش مراحل.", "campaign-types": "لسه مفيش أنواع حملات." },
    drag: "اسحب لتغيير الترتيب",
    dragHelp: "لتغيير الترتيب: اضغط مسافة على المقبض، حرّك بالأسهم لفوق أو تحت، ثم مسافة للتثبيت أو Esc للإلغاء.",
    picked: (n: string) => `اتمسكت المرحلة ${n}.`, over: (n: string, p: number) => `${n} في المكان ${p}.`,
    dropped: (n: string, p: number) => `${n} اتحطت في المكان ${p}.`, outside: "خارج القائمة.", cancelled: "اتلغى النقل.", moved: "اتحفظ الترتيب الجديد.", loading: "جاري التحميل…",
    errors: { DUPLICATE: "الاسم ده موجود في القائمة.", REQUIRED: "اكتب اسم.", TOO_LONG: "الاسم طويل.", IN_USE: "القيمة مستخدمة؛ غيّر اسمها بدل الحذف.",
      PROTECTED: "المرحلة دي أساسية ومتتحذفش.", conflict: "القائمة اتغيرت من مكان تاني؛ اتحدّثت.", forbidden: "لمسؤولي النظام بس.", failed: "تعذّر تنفيذ الطلب." },
  },
  en: {
    kinds: { "lost-reasons": "Lost reasons", sources: "Lead sources", "opportunity-stages": "Opportunity stages", "campaign-types": "Campaign types" },
    hints: {
      "lost-reasons": "Sellers pick one when they mark an opportunity or a lead lost. Without any, nobody can record a loss.",
      sources: "Where a lead came from: a fair, the website, a referral… Used at intake and in reports.",
      "opportunity-stages": "The path of an opportunity up to the decision. Drag to reorder; the won and lost stages stay last.",
      "campaign-types": "How campaigns are grouped: fair, seminar, e-mail, social… Offered when a campaign is created.",
    },
    placeholder: { "lost-reasons": "e.g. Price above budget", sources: "e.g. Cairo fair", "opportunity-stages": "e.g. Assessment visit", "campaign-types": "e.g. Fair" },
    add: "Add", save: "Save", cancel: "Cancel", rename: "Rename", remove: "Delete", close: "Close",
    uses: (n: number) => n === 0 ? "Not used" : n === 1 ? "Used once" : `Used ${n} times`,
    roles: { WON: "Won stage", LOST: "Lost stage", DEFAULT: "Starting stage", PROPOSITION: "Proposal stage" },
    protectedNote: "A core stage of the sales set-up: it can be renamed, not deleted.",
    inUse: "Used by records; rename it instead of deleting it.",
    confirmTitle: "Delete this value?", confirmText: (n: string) => `"${n}" leaves the list. No record uses it.`,
    empty: { "lost-reasons": "No lost reasons yet. Add the first one so the team can record lost deals.", sources: "No sources yet.", "opportunity-stages": "No stages.", "campaign-types": "No campaign types yet." },
    drag: "Drag to reorder",
    dragHelp: "To reorder: press Space on the handle, move with the up and down arrows, then Space to drop or Escape to cancel.",
    picked: (n: string) => `Picked up ${n}.`, over: (n: string, p: number) => `${n} at position ${p}.`,
    dropped: (n: string, p: number) => `${n} dropped at position ${p}.`, outside: "Outside the list.", cancelled: "Move cancelled.", moved: "The new order is saved.", loading: "Loading…",
    errors: { DUPLICATE: "This name is already in the list.", REQUIRED: "Type a name.", TOO_LONG: "The name is too long.", IN_USE: "This value is in use; rename it instead.",
      PROTECTED: "This stage is a core stage and cannot be deleted.", conflict: "The list changed elsewhere; it was refreshed.", forbidden: "Administrators only.", failed: "The request failed." },
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

/** Reference lists people pick from every day, managed by administrators. */
export function AdminLists({ language }: { language: Language }) {
  const l = L[language], ar = language === "ar";
  const [kind, setKind] = useState<ListKind>("lost-reasons");
  const [rows, setRows] = useState<ListValue[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removing, setRemoving] = useState<ListValue | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(async (which: ListKind) => {
    try { setRows(await getListValues(which)); } catch (e) { setRows([]); setError(problem(e, l)); }
  }, [l]);
  useEffect(() => { setRows(null); setError(""); setNotice(""); setName(""); void load(kind); }, [kind, load]);
  async function run(action: () => Promise<unknown>, after?: () => void): Promise<boolean> {
    setBusy(true); setError(""); setNotice("");
    try { await action(); after?.(); return true; }
    catch (e) { setError(problem(e, l)); if (e instanceof ApiError && e.statusCode === 409) void load(kind); return false; }
    finally { setBusy(false); }
  }
  function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    void run(async () => { const saved = await addListValue(kind, name.trim()); await load(kind); setName(""); setNotice(`✓ ${saved.name}`); },
      () => input.current?.focus());
  }
  const label = (v: ListValue) => kind === "opportunity-stages" ? stageLabel(v.name, language) : v.name;
  const open = (rows ?? []).filter(r => r.role !== "WON" && r.role !== "LOST");
  const closed = (rows ?? []).filter(r => r.role === "WON" || r.role === "LOST");

  const nameOf = (id: string | number) => { const r = open.find(x => x.id === id); return r ? label(r) : ""; };
  const positionOf = (id: string | number) => open.findIndex(x => x.id === id) + 1;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !rows) return;
    const from = open.findIndex(r => r.id === active.id), to = open.findIndex(r => r.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(open, from, to);
    const before = rows;
    setRows([...next, ...closed]); // optimistic; restored if the server refuses
    void run(async () => { setRows(await orderStages(next.map(r => r.id))); setNotice(l.moved); })
      .then(ok => { if (!ok) setRows(before); });
  }

  return <div className="admin-lists">
    <div className="segmented" role="tablist" aria-label={ar ? "القوائم" : "Lists"}>
      {KINDS.map(k => <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? "chosen" : ""} onClick={() => setKind(k)}>{l.kinds[k]}</button>)}
    </div>
    <section className="data-panel admin-list-panel" aria-labelledby="admin-list-title">
      <div className="admin-list-head">
        <div><h2 id="admin-list-title"><ListChecks size={18}/>{l.kinds[kind]}</h2><p>{l.hints[kind]}</p></div>
        <form className="admin-list-add" onSubmit={add}>
          <input ref={input} value={name} maxLength={255} placeholder={l.placeholder[kind]} aria-label={l.kinds[kind]} onChange={e => setName(e.target.value)}/>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}><Plus size={16}/>{l.add}</button>
        </form>
      </div>
      {error && <p className="admin-list-error" role="alert"><CircleAlert size={15}/>{error}</p>}
      {notice && <p className="admin-list-notice" role="status">{notice}</p>}
      {rows === null ? <p className="admin-list-empty" role="status">{l.loading}</p>
        : rows.length === 0 ? <p className="admin-list-empty">{l.empty[kind]}</p>
        : kind === "opportunity-stages"
          ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{
              screenReaderInstructions: { draggable: l.dragHelp },
              announcements: {
                onDragStart: ({ active }) => l.picked(nameOf(active.id)),
                onDragOver: ({ active, over }) => over ? l.over(nameOf(active.id), positionOf(over.id)) : l.outside,
                onDragEnd: ({ active, over }) => over ? l.dropped(nameOf(active.id), positionOf(over.id)) : l.cancelled,
                onDragCancel: () => l.cancelled,
              },
            }}>
              <SortableContext items={open.map(r => r.id)} strategy={verticalListSortingStrategy}>
                <ol className="admin-list-rows is-sortable">{open.map((row, i) => <SortableRow key={row.id} row={row} index={i} l={l} label={label(row)} busy={busy}
                  onRename={(v, n) => run(async () => { await renameListValue(kind, v.id, v.version, n); await load(kind); })}
                  onRemove={setRemoving}/>)}</ol>
              </SortableContext>
              <ol className="admin-list-rows is-fixed">{closed.map(row => <Row key={row.id} row={row} l={l} label={label(row)} busy={busy}
                onRename={(v, n) => run(async () => { await renameListValue(kind, v.id, v.version, n); await load(kind); })} onRemove={setRemoving}
                lead={<span className="admin-list-lock"><LockKeyhole size={14}/></span>}/>)}</ol>
            </DndContext>
          : <ol className="admin-list-rows">{rows.map(row => <Row key={row.id} row={row} l={l} label={label(row)} busy={busy}
              onRename={(v, n) => run(async () => { await renameListValue(kind, v.id, v.version, n); await load(kind); })} onRemove={setRemoving}/>)}</ol>}
    </section>
    {removing && <Dialog title={l.confirmTitle} description={l.confirmText(label(removing))} kicker={l.kinds[kind]} busy={busy} onClose={() => setRemoving(null)}
      footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setRemoving(null)}>{l.cancel}</button>
        <button type="button" className="btn btn-primary admin-danger" disabled={busy}
          onClick={() => void run(async () => { setRows(await deleteListValue(kind, removing.id, removing.version)); }, () => setRemoving(null))}>
          <Trash2 size={16}/>{l.remove}</button></>}>
      {error && <p className="admin-list-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    </Dialog>}
  </div>;
}

type RowProps = {
  row: ListValue; l: Labels; label: string; busy: boolean; lead?: React.ReactNode;
  onRename: (row: ListValue, name: string) => Promise<boolean>; onRemove: (row: ListValue) => void;
};

function SortableRow(props: RowProps & { index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.row.id });
  return <Row {...props} ref={setNodeRef} dragging={isDragging} style={{ transform: CSS.Transform.toString(transform), transition }}
    lead={<button type="button" className="admin-list-handle" aria-label={`${props.l.drag}: ${props.label}`} {...attributes} {...listeners}>
      <GripVertical size={16}/><span>{props.index + 1}</span></button>}/>;
}

function Row({ row, l, label, busy, lead, onRename, onRemove, ref, style, dragging }: RowProps & {
  ref?: (node: HTMLLIElement | null) => void; style?: React.CSSProperties; dragging?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.name);
  const locked = row.role !== null;
  const canRemove = !locked && row.uses === 0;
  async function save() {
    if (!value.trim() || value.trim() === row.name) { setEditing(false); setValue(row.name); return; }
    if (await onRename(row, value.trim())) setEditing(false);
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); void save(); }
    if (e.key === "Escape") { e.preventDefault(); setEditing(false); setValue(row.name); }
  }
  return <li ref={ref} style={style} className={"admin-list-row" + (dragging ? " is-dragging" : "") + (locked ? " is-locked" : "")}>
    {lead}
    {editing
      ? <input className="admin-list-edit" autoFocus value={value} maxLength={255} aria-label={l.rename} onChange={e => setValue(e.target.value)} onKeyDown={onKey}/>
      : <strong className="admin-list-name">{label}</strong>}
    <span className="admin-list-meta">
      {row.role && <span className="admin-badge is-admin" title={l.protectedNote}>{l.roles[row.role]}</span>}
      <span className={"admin-badge" + (row.uses ? "" : " is-quiet")}>{l.uses(row.uses)}</span>
    </span>
    <span className="admin-list-actions">
      {editing ? <>
        <button type="button" className="icon-button" aria-label={l.save} disabled={busy} onClick={() => void save()}><Check size={16}/></button>
        <button type="button" className="icon-button" aria-label={l.cancel} onClick={() => { setEditing(false); setValue(row.name); }}><X size={16}/></button>
      </> : <>
        <button type="button" className="icon-button" aria-label={`${l.rename}: ${label}`} disabled={busy} onClick={() => setEditing(true)}><Pencil size={15}/></button>
        <button type="button" className="icon-button" aria-label={`${l.remove}: ${label}`} disabled={busy || !canRemove}
          title={locked ? l.protectedNote : row.uses ? l.inUse : undefined} onClick={() => onRemove(row)}><Trash2 size={15}/></button>
      </>}
    </span>
  </li>;
}
