import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Camera, Check, CircleAlert, ClipboardList, Eraser, Info, ListChecks, PenLine, RefreshCw, TriangleAlert, X } from "lucide-react";
import { ApiError } from "./api";
import { MAX_UPLOAD_BYTES, readFile } from "./contentApi";
import {
  answerItem, answerItemFile, getChecklist, itemFile, prepareChecklist,
  type Checklist, type ChecklistAnswer, type ChecklistItem, type Visit,
} from "./visitApi";
import type { Language } from "./preferences";

const L = {
  ar: {
    title: "قائمة التحقق", hint: "أسئلة نوع الزيارة. الإجابات بتتسجل وانت في الموقع (الزيارة شغالة أو متوقفة مؤقتًا).",
    none: "نوع الزيارة ده مالوش قائمة تحقق.", notYet: "قائمة التحقق لسه متجهزتش للزيارة دي.", prepare: "جهّز قائمة التحقق", preparing: "جاري التجهيز…",
    generating: "قائمة التحقق بتتجهز… حدّث بعد شوية.", refresh: "تحديث",
    requiredLeft: (n: number) => n === 0 ? "كل الأسئلة المطلوبة اتجاوبت." : n === 1 ? "فاضل سؤال مطلوب واحد قبل إنهاء الزيارة." : `فاضل ${n} أسئلة مطلوبة قبل إنهاء الزيارة.`,
    readOnly: "الإجابات بتتعدل وانت في الموقع بس.", required: "مطلوب", save: "حفظ", clear: "مسح الإجابة", photo: "صوّر أو اختار صورة", replace: "تغيير الصورة",
    sign: "وقّع هنا", signSave: "اعتماد التوقيع", signClear: "مسح", signAgain: "توقيع جديد", yes: "اتعمل", nonConforming: "غير مطابق", native: "السؤال ده بيتجاوب من شاشات Axelor الأصلية.",
    errors: { STATUS_NOT_ALLOWED: "الإجابات بتتسجل والزيارة شغالة أو متوقفة مؤقتًا.", NOT_ACTIVE: "السؤال ده مش مطلوب مع الإجابات الحالية.", NO_CHECKLIST: "نوع الزيارة مالوش قائمة تحقق.",
      TYPE_NOT_ALLOWED: "استخدم صورة PNG أو JPEG.", TYPE_MISMATCH: "محتوى الملف مش صورة سليمة.", TOO_LARGE: "الصورة أكبر من 10 ميجا.", REQUIRED: "الإجابة ناقصة.",
      UNAVAILABLE: "اختيار غير متاح.", FORMAT: "القيمة مش بالشكل الصحيح.", conflict: "الإجابة اتغيرت من مكان تاني؛ اتحدّثت.", forbidden: "مش مسموح لك بالإجراء ده.", failed: "تعذّر تنفيذ الطلب." },
  },
  en: {
    title: "Checklist", hint: "The visit type's questions. Answers are given on site (while the visit is under way or paused).",
    none: "This visit type has no checklist.", notYet: "The checklist is not prepared for this visit yet.", prepare: "Prepare the checklist", preparing: "Preparing…",
    generating: "The checklist is being prepared… refresh in a moment.", refresh: "Refresh",
    requiredLeft: (n: number) => n === 0 ? "All required questions are answered." : n === 1 ? "One required question is left before the visit can finish." : `${n} required questions are left before the visit can finish.`,
    readOnly: "Answers are changed on site only.", required: "Required", save: "Save", clear: "Clear answer", photo: "Take or choose a photo", replace: "Replace photo",
    sign: "Sign here", signSave: "Use this signature", signClear: "Clear", signAgain: "Sign again", yes: "Done", nonConforming: "Non-conforming", native: "This question is answered in the native Axelor screens.",
    errors: { STATUS_NOT_ALLOWED: "Answers are given while the visit is under way or paused.", NOT_ACTIVE: "This question does not apply with the current answers.", NO_CHECKLIST: "This visit type has no checklist.",
      TYPE_NOT_ALLOWED: "Use a PNG or JPEG image.", TYPE_MISMATCH: "The file is not a valid image.", TOO_LARGE: "The image is larger than 10 MB.", REQUIRED: "The answer is missing.",
      UNAVAILABLE: "This choice is not available.", FORMAT: "The value is not in the right format.", conflict: "The answer changed elsewhere; it was refreshed.", forbidden: "You are not allowed to do this.", failed: "The request failed." },
  },
};
type Labels = typeof L.ar;

function problem(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.errors.failed;
  const code = error.code && error.code in l.errors ? error.code : error.fields?.[0]?.code ?? "";
  if (code in l.errors) return (l.errors as Record<string, string>)[code];
  if (error.statusCode === 409) return l.errors.conflict;
  if (error.statusCode === 403) return l.errors.forbidden;
  return l.errors.failed;
}

/** The visit's checklist; answers are saved one item at a time with the item's version. */
export function VisitChecklist({ visit, language, onChanged }: { visit: Visit; language: Language; onChanged?: (checklist: Checklist) => void }) {
  const l = L[language];
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | "prepare" | null>(null);
  // the parent's callback may change on every render; keep the latest without reloading
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const load = useCallback(() => getChecklist(visit.id).then(c => { setChecklist(c); changed.current?.(c); }).catch(e => setError(problem(e, l))), [visit.id, l]);
  // the visit's status decides whether answers can be given: reload when it changes
  useEffect(() => { void load(); }, [load, visit.status]);
  async function run(target: number | "prepare", action: () => Promise<Checklist>) {
    setBusy(target); setError("");
    try { const c = await action(); setChecklist(c); changed.current?.(c); }
    catch (e) { setError(problem(e, l)); if (e instanceof ApiError && e.statusCode === 409) void load(); }
    finally { setBusy(null); }
  }
  if (!checklist) return error ? <p className="daily-error"><CircleAlert size={15}/>{error}</p> : null;
  if (!checklist.available) return null;
  const items = checklist.sections.flatMap(s => s.items);
  return <section className="record-content-card visit-checklist" aria-labelledby="visit-checklist-title">
    <div className="visit-checklist-head">
      <h2 id="visit-checklist-title"><ListChecks size={18}/>{l.title}</h2>
      {checklist.generated && <span className={"visit-checklist-left" + (checklist.requiredOpen ? " is-open" : " is-done")} role="status">
        {checklist.requiredOpen ? <TriangleAlert size={14}/> : <Check size={14}/>}{l.requiredLeft(checklist.requiredOpen)}</span>}
    </div>
    <p className="daily-note">{l.hint}</p>
    {error && <p className="daily-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    {checklist.message && <p className="daily-note"><Info size={14}/>{checklist.message}</p>}
    {checklist.generating && <p className="daily-note"><RefreshCw size={14}/>{l.generating}
      <button type="button" className="btn btn-small btn-secondary" onClick={() => void load()}>{l.refresh}</button></p>}
    {!checklist.generated && !checklist.generating && <div className="visit-checklist-empty"><ClipboardList size={22}/><span>{l.notYet}</span>
      {(visit.status === "PLANNED" || visit.status === "STARTED" || visit.status === "SUSPENDED") &&
        <button type="button" className="btn btn-primary btn-small" disabled={busy !== null}
          onClick={() => void run("prepare", () => prepareChecklist(visit.id, visit.version))}>{busy === "prepare" ? l.preparing : l.prepare}</button>}</div>}
    {checklist.generated && !checklist.canAnswer && items.length > 0 && <p className="daily-note">{l.readOnly}</p>}
    {checklist.sections.map(section => section.items.some(i => i.active) && <div key={section.id} className="visit-checklist-section">
      {section.title && <h3>{section.title}</h3>}
      <ol>{section.items.filter(i => i.active).map(item => <li key={item.id} className={"visit-check-item" + (item.answered ? " is-answered" : "")
        + (item.required && !item.answered ? " is-required" : "") + (item.nonConforming ? " is-nonconforming" : "")}>
        <ItemControl item={item} l={l} visitId={visit.id} disabled={!checklist.canAnswer || busy !== null} busy={busy === item.id}
          answer={a => run(item.id, () => answerItem(visit.id, item, a))}
          upload={(name, content) => run(item.id, () => answerItemFile(visit.id, item, name, content))}
          fail={message => setError(message)}/>
      </li>)}</ol>
    </div>)}
  </section>;
}

function ItemControl({ item, l, visitId, disabled, busy, answer, upload, fail }: {
  item: ChecklistItem; l: Labels; visitId: number; disabled: boolean; busy: boolean;
  answer: (a: ChecklistAnswer) => Promise<void>; upload: (fileName: string, contentBase64: string) => Promise<void>; fail: (message: string) => void;
}) {
  const [text, setText] = useState(item.text ?? "");
  const [measure, setMeasure] = useState(item.measure == null ? "" : String(item.measure));
  useEffect(() => { setText(item.text ?? ""); setMeasure(item.measure == null ? "" : String(item.measure)); }, [item.text, item.measure, item.version]);
  const head = <div className="visit-check-head">
    <span className="visit-check-mark" aria-hidden>{item.answered ? <Check size={14}/> : null}</span>
    <div><strong>{item.title}</strong>{item.required && <span className="visit-check-required">{l.required}</span>}
      {item.nonConforming && <span className="visit-check-nc"><TriangleAlert size={12}/>{l.nonConforming}</span>}
      {item.hint && <small>{item.hint}</small>}</div>
  </div>;
  const clear = item.answered && !disabled && item.type !== "indication"
    ? <button type="button" className="icon-button visit-check-clear" aria-label={`${l.clear}: ${item.title ?? ""}`} disabled={busy} onClick={() => void answer({ clear: true })}><X size={15}/></button> : null;
  let control: React.ReactNode = null;
  switch (item.type) {
    case "list":
      control = <div className="visit-check-choices" role="radiogroup" aria-label={item.title ?? ""}>
        {item.choices.map(c => <button key={c.id} type="button" role="radio" aria-checked={item.choiceId === c.id} disabled={disabled}
          className={"visit-check-choice" + (item.choiceId === c.id ? " is-chosen" : "") + (c.nonConforming ? " is-nc" : "")}
          onClick={() => item.choiceId !== c.id && void answer({ choiceId: c.id })}>{c.nonConforming && <TriangleAlert size={12}/>}{c.name}</button>)}
      </div>;
      break;
    case "text":
      control = <div className="visit-check-row"><textarea value={text} rows={2} maxLength={4000} disabled={disabled} aria-label={item.title ?? ""} onChange={e => setText(e.target.value)}/>
        <button type="button" className="btn btn-small btn-primary" disabled={disabled || !text.trim() || text === (item.text ?? "")}
          onClick={() => void answer({ text: text.trim() })}>{l.save}</button></div>;
      break;
    case "date":
      control = <input type="date" value={item.date ?? ""} disabled={disabled} aria-label={item.title ?? ""} onChange={e => e.target.value && void answer({ date: e.target.value })}/>;
      break;
    case "measure":
      control = <div className="visit-check-row"><input type="number" inputMode="decimal" step="any" value={measure} disabled={disabled} aria-label={item.title ?? ""}
        onChange={e => setMeasure(e.target.value)}/>{item.unit && <span className="visit-check-unit">{item.unit}</span>}
        <button type="button" className="btn btn-small btn-primary" disabled={disabled || measure === "" || Number(measure) === item.measure}
          onClick={() => void answer({ measure: Number(measure) })}>{l.save}</button></div>;
      break;
    case "checkbox":
      control = <label className="visit-check-toggle"><input type="checkbox" checked={item.checked === true} disabled={disabled}
        onChange={e => void answer({ checked: e.target.checked })}/>{item.checkboxLabel ?? l.yes}</label>;
      break;
    case "indication":
      control = <p className="visit-check-indication"><Info size={14}/>{item.indicationText}</p>;
      break;
    case "picture":
      control = <PhotoAnswer item={item} l={l} visitId={visitId} disabled={disabled} upload={upload} fail={fail}/>;
      break;
    case "signature":
      control = <SignatureAnswer item={item} l={l} visitId={visitId} disabled={disabled} upload={upload}/>;
      break;
    default:
      control = <p className="daily-note">{l.native}</p>;
  }
  return <>{head}<div className="visit-check-answer">{control}{clear}</div></>;
}

/** Shows a stored photo or signature through the authenticated API (an object URL, revoked on change). */
function StoredImage({ item, visitId, alt }: { item: ChecklistItem; visitId: number; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!item.hasFile) { setUrl(null); return; }
    let objectUrl: string | null = null;
    let live = true;
    itemFile(visitId, item).then(b => { if (!live) return; objectUrl = URL.createObjectURL(b); setUrl(objectUrl); }).catch(() => setUrl(null));
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [item, visitId]);
  return url ? <img className="visit-check-image" src={url} alt={alt}/> : null;
}

function PhotoAnswer({ item, l, visitId, disabled, upload, fail }: {
  item: ChecklistItem; l: Labels; visitId: number; disabled: boolean; upload: (fileName: string, contentBase64: string) => Promise<void>; fail: (m: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) { fail(l.errors.TOO_LARGE); return; }
    try { await upload(file.name || "photo.jpg", await readFile(file)); } finally { if (input.current) input.current.value = ""; }
  }
  return <div className="visit-check-photo">
    <StoredImage item={item} visitId={visitId} alt={item.title ?? ""}/>
    <input ref={input} type="file" accept="image/png,image/jpeg" capture="environment" hidden disabled={disabled} onChange={e => void pick(e.target.files?.[0])}/>
    <button type="button" className="btn btn-small btn-secondary" disabled={disabled} onClick={() => input.current?.click()}>
      <Camera size={15}/>{item.hasFile ? l.replace : l.photo}</button>
  </div>;
}

/** A signature pad: pointer drawing (finger, pen or mouse) on a canvas, saved as a PNG answer. */
function SignatureAnswer({ item, l, visitId, disabled, upload }: {
  item: ChecklistItem; l: Labels; visitId: number; disabled: boolean; upload: (fileName: string, contentBase64: string) => Promise<void>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [signing, setSigning] = useState(!item.hasFile);
  const [inked, setInked] = useState(false);
  useEffect(() => { setSigning(!item.hasFile); setInked(false); }, [item.hasFile, item.version]);
  useEffect(() => {
    const c = canvas.current;
    if (!signing || !c) return;
    const ratio = window.devicePixelRatio || 1;
    const box = c.getBoundingClientRect();
    c.width = Math.round(box.width * ratio); c.height = Math.round(box.height * ratio);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111827";
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, box.width, box.height);
  }, [signing]);
  const point = (e: ReactPointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  function down(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = e.currentTarget.getContext("2d"); const [x, y] = point(e);
    ctx?.beginPath(); ctx?.moveTo(x, y);
  }
  function move(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d"); const [x, y] = point(e);
    ctx?.lineTo(x, y); ctx?.stroke(); setInked(true);
  }
  function up() { drawing.current = false; }
  function wipe() {
    const c = canvas.current; const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const box = c.getBoundingClientRect();
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, box.width, box.height); setInked(false);
  }
  async function save() {
    const data = canvas.current?.toDataURL("image/png");
    if (!data) return;
    await upload("signature.png", data.slice(data.indexOf(",") + 1));
  }
  if (!signing) return <div className="visit-check-photo">
    <StoredImage item={item} visitId={visitId} alt={item.title ?? ""}/>
    {!disabled && <button type="button" className="btn btn-small btn-secondary" onClick={() => setSigning(true)}><PenLine size={15}/>{l.signAgain}</button>}
  </div>;
  return <div className="visit-check-signature">
    <canvas ref={canvas} aria-label={`${l.sign}: ${item.title ?? ""}`} role="img" className={disabled ? "is-disabled" : ""}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up}/>
    <span className="visit-check-sign-hint">{l.sign}</span>
    <div className="visit-check-row">
      <button type="button" className="btn btn-small btn-secondary" disabled={disabled || !inked} onClick={wipe}><Eraser size={15}/>{l.signClear}</button>
      <button type="button" className="btn btn-small btn-primary" disabled={disabled || !inked} onClick={() => void save()}><Check size={15}/>{l.signSave}</button>
    </div>
  </div>;
}
