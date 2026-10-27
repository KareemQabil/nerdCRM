import { useEffect, useState, type FormEvent } from "react";
import { CircleAlert, Hash, Pencil, Save, TriangleAlert } from "lucide-react";
import { ApiError } from "./api";
import { getNumbering, setNumbering, type NumberingRow } from "./adminApi";
import { Dialog } from "./Dialog";
import "./admin.css";

type Language = "ar" | "en";
const L = {
  ar: {
    title: "الترقيم", hint: "إزاي بتترقم السجلات اللي المنصة بتنشئها. بعض الأنواع جاية جاهزة؛ الزيارات الميدانية محتاجة تظبطها قبل أول زيارة.",
    names: { partner: "الحسابات", opportunity: "الفرص", saleOrder: "عروض الأسعار", customerContract: "العقود", project: "المشروعات", intervention: "الزيارات الميدانية", qualityImprovement: "تحسينات الجودة" } as Record<string, string>,
    missing: "مش متظبط", next: "الرقم الجاي", set: "ظبط الترقيم", change: "تعديل", prefix: "البادئة", digits: "عدد الأرقام",
    prefixHint: "حروف وأرقام و - _ / (و %YY للسنة). مثال: VIS- أو QI%YY-", example: "الشكل", save: "حفظ", saving: "جاري الحفظ…", cancel: "إلغاء",
    blocked: "مفيش زيارات هتتسجل لحد ما الترقيم ده يتظبط.", loading: "جاري التحميل…",
    errors: { FORMAT: "البادئة مش صحيحة.", RANGE: "عدد الأرقام من 1 لـ 10.", conflict: "الترقيم اتغير من مكان تاني؛ اتحدّث.", forbidden: "لمسؤولي النظام بس.", failed: "تعذّر تنفيذ الطلب." },
  },
  en: {
    title: "Numbering", hint: "How the records the platform creates are numbered. Some types come ready; field visits need it set up before the first visit.",
    names: { partner: "Accounts", opportunity: "Opportunities", saleOrder: "Quotations", customerContract: "Contracts", project: "Engagements", intervention: "Field visits", qualityImprovement: "Quality improvements" } as Record<string, string>,
    missing: "Not set up", next: "Next number", set: "Set up numbering", change: "Change", prefix: "Prefix", digits: "Digits",
    prefixHint: "Letters, digits and - _ / (and %YY for the year). For example VIS- or QI%YY-", example: "Looks like", save: "Save", saving: "Saving…", cancel: "Cancel",
    blocked: "No visit can be recorded until this numbering is set up.", loading: "Loading…",
    errors: { FORMAT: "The prefix is not valid.", RANGE: "Use 1 to 10 digits.", conflict: "The numbering changed elsewhere; it was refreshed.", forbidden: "Administrators only.", failed: "The request failed." },
  },
};
type Labels = typeof L.ar;
function problem(e: unknown, l: Labels) {
  if (!(e instanceof ApiError)) return l.errors.failed;
  const code = e.fields?.[0]?.code ?? "";
  if (code in l.errors) return (l.errors as Record<string, string>)[code];
  if (e.statusCode === 409) return l.errors.conflict;
  if (e.statusCode === 403) return l.errors.forbidden;
  return l.errors.failed;
}

export function AdminNumbering({ language }: { language: Language }) {
  const l = L[language];
  const [rows, setRows] = useState<NumberingRow[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<NumberingRow | null>(null);
  const load = () => getNumbering().then(setRows).catch(e => { setRows([]); setError(problem(e, l)); });
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <section className="data-panel admin-list-panel" aria-labelledby="admin-numbering-title">
    <div className="admin-list-head"><div><h2 id="admin-numbering-title"><Hash size={18}/>{l.title}</h2><p>{l.hint}</p></div></div>
    {error && <p className="admin-list-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    {rows === null ? <p className="admin-list-empty" role="status">{l.loading}</p> :
      <ol className="admin-list-rows">{rows.map(r => <li key={r.code} className={"admin-list-row" + (r.configured ? "" : " is-missing")}>
        <strong className="admin-list-name">{l.names[r.code] ?? r.name}</strong>
        <span className="admin-list-meta">
          {r.configured ? <><code dir="ltr" className="admin-numbering-example">{r.example}</code><span className="admin-badge is-quiet">{l.next}: {r.nextNumber}</span></>
            : <span className="admin-badge is-admin"><TriangleAlert size={13}/>{l.missing}</span>}
        </span>
        <span className="admin-list-actions">
          <button type="button" className={"btn btn-small " + (r.configured ? "btn-secondary" : "btn-primary")} aria-label={`${r.configured ? l.change : l.set}: ${l.names[r.code] ?? r.name}`}
            onClick={() => setEditing(r)}>{r.configured ? <Pencil size={14}/> : <Hash size={14}/>}{r.configured ? l.change : l.set}</button>
        </span>
      </li>)}</ol>}
    {rows?.some(r => r.code === "intervention" && !r.configured) && <p className="daily-note"><TriangleAlert size={14}/>{l.blocked}</p>}
    {editing && <NumberingDialog l={l} row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }}/>}
  </section>;
}

function NumberingDialog({ l, row, onClose, onSaved }: { l: Labels; row: NumberingRow; onClose: () => void; onSaved: () => void }) {
  const [prefix, setPrefix] = useState(row.prefix ?? "");
  const [digits, setDigits] = useState(row.digits ?? 4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const year = String(new Date().getFullYear() % 100);
  const example = prefix.replace("%YYYY", String(new Date().getFullYear())).replace("%YY", year) + String(row.nextNumber ?? 1).padStart(digits, "0");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try { await setNumbering(row.code, row.version, prefix.trim(), digits); onSaved(); }
    catch (failure) { setError(problem(failure, l)); }
    finally { setBusy(false); }
  }
  return <Dialog title={row.configured ? l.change : l.set} kicker={l.names[row.code] ?? row.name} busy={busy} onClose={onClose}
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="numbering-form" className="btn btn-primary" disabled={busy || !prefix.trim()}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="numbering-form" className="admin-form admin-form-two" onSubmit={e => void submit(e)}>
      <label><span>{l.prefix}</span><input value={prefix} dir="ltr" required maxLength={12} placeholder="VIS-" onChange={e => setPrefix(e.target.value)}/><small>{l.prefixHint}</small></label>
      <label><span>{l.digits}</span><input type="number" min={1} max={10} value={digits} onChange={e => setDigits(Number(e.target.value) || 1)}/></label>
      <p className="admin-span admin-numbering-preview">{l.example}: <code dir="ltr">{example}</code></p>
      {error && <p className="admin-list-error admin-span" role="alert"><CircleAlert size={15}/>{error}</p>}
    </form>
  </Dialog>;
}
