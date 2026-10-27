import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarClock, CircleAlert, CircleCheck, CircleDashed, History, Plus, Save, Scale, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import { ApiError, getBusinessLines, type BusinessLine } from "./api";
import { Dialog } from "./Dialog";
import {
  appointOwner, dismissOwner, getPolicies, getPolicy, getPolicyOwners, getPolicyPeople, retirePolicy, setPolicy,
  type Person, type PolicyDetail, type PolicyField, type PolicyOverview, type PolicySummary, type PolicyValue,
} from "./policiesApi";
import type { Language } from "./preferences";
import "./policies.css";

const AREAS = ["FINANCE", "SALES", "LEADS", "CERTIFICATION", "TRAINING", "RECRUITMENT", "PRIVACY", "CHANNELS"] as const;
const DATA_TYPES = ["LEADS", "CANDIDATES", "TRAINEES", "DONORS", "CONTACTS"];
const L = {
  ar: {
    eyebrow: "الإدارة", title: "السياسات وقواعد العمل",
    intro: "كل قاعدة عمل قراركم انتم: الضرايب، حدود الموافقة، الصلاحيات، المواعيد… مفيش قيم جاهزة. أي عملية محتاجة سياسة مش مضبوطة بتترفض لحد ما مالك السياسات يحددها. كل تغيير له تاريخ سريان وسبب، ومتسجل.",
    areas: { FINANCE: "المالية", SALES: "المبيعات والموافقات", LEADS: "الـ leads ومواعيد العمل", CERTIFICATION: "شهادات الأيزو", TRAINING: "التدريب",
      RECRUITMENT: "التوظيف", PRIVACY: "الخصوصية والاحتفاظ", CHANNELS: "القنوات الخارجية" } as Record<string, string>,
    set: "مضبوطة", notSet: "مش مضبوطة — العمليات اللي محتاجاها مرفوضة", inForce: (n: number) => n === 1 ? "قيمة سارية" : `${n} قيم سارية`,
    scopes: { NONE: "على مستوى الشركة", BUSINESS_LINE: "لكل خط أعمال", SCHEME: "لكل معيار أيزو", COURSE: "لكل كورس", CLIENT_AGREEMENT: "لكل عميل",
      LEAD_SOURCE: "لكل مصدر", DATA_TYPE: "لكل نوع بيانات" } as Record<string, string>,
    defaultScope: "القيمة العامة", values: "القيم السارية", none: "لسه مفيش قيمة.", since: "سارية من", next: "من", nextUnset: "هتتلغي من",
    history: "السجل", by: "بواسطة", reason: "السبب", unset: "اتلغت",
    edit: "تحديد قيمة", scope: "تنطبق على", scopeHint: { SCHEME: "اكتب المعيار، مثلًا ISO 9001:2015", COURSE: "رقم الكورس", CLIENT_AGREEMENT: "رقم حساب العميل",
      LEAD_SOURCE: "اسم المصدر" } as Record<string, string>,
    allLines: "قيمة عامة (لكل الخطوط اللي مالهاش قيمة خاصة)", choose: "اختار…", effective: "سارية من", reasonLabel: "سبب التغيير",
    save: "حفظ", saving: "جاري الحفظ…", cancel: "إلغاء", retire: "إلغاء القيمة", retireTitle: "إلغاء القيمة؟",
    retireText: "من التاريخ ده العمليات اللي محتاجة السياسة دي هترجع تترفض لحد ما قيمة جديدة تتحدد.",
    addRow: "إضافة", removeRow: "حذف", addDate: "إضافة تاريخ", yes: "نعم",
    readOnly: "انت تقدر تشوف السياسات بس. التعديل لمالكي السياسات.",
    owners: "مالكو السياسات", ownersHint: "هما بس اللي يقدروا يغيّروا قواعد العمل أو يعيّنوا مالك تاني. الأدمن التقني مش منهم إلا لو اتعيّن.",
    noOwners: "مفيش مالك سياسات لسه", noOwnersHint: "كأدمن، تقدر تعيّن أول مالك. بعد كده التعيين لمالكي السياسات بس.",
    appoint: "تعيين", dismiss: "إزالة", you: "أنت", person: "الشخص",
    errors: { POLICY_NOT_SET: "السياسة دي مش مضبوطة في التاريخ ده.", REQUIRED: "حقل مطلوب ناقص.", RANGE: "قيمة خارج الحدود.", FORMAT: "صيغة غير صحيحة.",
      ORDER: "رتّب المستويات من أصغر خصم لأكبر خصم.", PAST: "التغيير ما ينفعش يسري من تاريخ فات.", BEFORE_START: "النهاية لازم تكون بعد البداية.",
      UNAVAILABLE: "اختيار غير متاح.", TOO_LONG: "النص طويل.", TOO_MANY: "عدد كبير زيادة.", LAST_OWNER: "لازم يفضل مالك سياسات واحد على الأقل.",
      forbidden: "التعديل لمالكي السياسات بس.", failed: "تعذّر تنفيذ الطلب." } as Record<string, string>,
  },
  en: {
    eyebrow: "Administration", title: "Policies & business rules",
    intro: "Every business rule is your decision: taxes, approval limits, response times… none are shipped. Anything that needs a policy that is not set is refused until a policy owner sets it. Every change has an effective date and a reason, and is logged.",
    areas: { FINANCE: "Finance", SALES: "Sales & approvals", LEADS: "Leads & working hours", CERTIFICATION: "ISO certification", TRAINING: "Training",
      RECRUITMENT: "Recruitment", PRIVACY: "Privacy & retention", CHANNELS: "External channels" } as Record<string, string>,
    set: "Set", notSet: "Not set — anything that needs it is refused", inForce: (n: number) => n === 1 ? "1 value in force" : `${n} values in force`,
    scopes: { NONE: "Company-wide", BUSINESS_LINE: "Per business line", SCHEME: "Per ISO scheme", COURSE: "Per course", CLIENT_AGREEMENT: "Per client",
      LEAD_SOURCE: "Per source", DATA_TYPE: "Per data type" } as Record<string, string>,
    defaultScope: "Default value", values: "Values in force", none: "No value yet.", since: "In force since", next: "From", nextUnset: "Unset from",
    history: "History", by: "by", reason: "Reason", unset: "unset",
    edit: "Set a value", scope: "Applies to", scopeHint: { SCHEME: "Type the scheme, e.g. ISO 9001:2015", COURSE: "Course number", CLIENT_AGREEMENT: "Client account number",
      LEAD_SOURCE: "Source name" } as Record<string, string>,
    allLines: "Default (every line without its own value)", choose: "Choose…", effective: "Effective from", reasonLabel: "Reason for the change",
    save: "Save", saving: "Saving…", cancel: "Cancel", retire: "Unset", retireTitle: "Unset this value?",
    retireText: "From that date, anything that needs this policy is refused again until a new value is set.",
    addRow: "Add", removeRow: "Remove", addDate: "Add date", yes: "Yes",
    readOnly: "You can read policies; only policy owners change them.",
    owners: "Policy owners", ownersHint: "Only they change business rules or appoint another owner. Technical administrators are not owners unless appointed.",
    noOwners: "No policy owner yet", noOwnersHint: "As an administrator you may appoint the first owner; after that only policy owners appoint.",
    appoint: "Appoint", dismiss: "Remove", you: "you", person: "Person",
    errors: { POLICY_NOT_SET: "This policy is not set on that date.", REQUIRED: "A required field is missing.", RANGE: "A value is out of range.", FORMAT: "A value has the wrong format.",
      ORDER: "List the tiers from the smallest discount to the largest.", PAST: "A change cannot take effect in the past.", BEFORE_START: "The end must be after the start.",
      UNAVAILABLE: "This choice is not available.", TOO_LONG: "The text is too long.", TOO_MANY: "Too many items.", LAST_OWNER: "At least one policy owner must remain.",
      forbidden: "Only policy owners can change this.", failed: "The request failed." } as Record<string, string>,
  },
};
/** Readable names for the options policies offer. */
const OPTIONS: Record<string, [string, string]> = {
  NONE: ["من غير موافقة", "No approval"], SALES_MANAGER: ["مدير المبيعات", "Sales manager"], GM: ["المدير العام", "General manager"], FINANCE: ["المالية", "Finance"],
  ACTIVE_CONTRACT: ["عقد مفعّل", "Active contract"], ACCEPTED_QUOTE: ["عرض مقبول بدليل", "Accepted quotation with evidence"],
  PUBLIC_API: ["مصدر عام مع تعديل يدوي", "Public source, manual override"], MANUAL_ONLY: ["يدوي فقط", "Manual only"],
  INDEPENDENT_REVIEWER: ["مراجع مستقل", "Independent reviewer"], COMMITTEE: ["لجنة", "Committee"],
  NOT_ASKED: ["مش مطلوب", "Not asked"], OPTIONAL: ["اختياري", "Optional"], REQUIRED: ["مطلوب", "Required"],
  START_DATE: ["تاريخ بدء العمل", "Start date"], OFFER_ACCEPTED: ["قبول العرض", "Offer accepted"],
  REPLACE: ["استبدال المرشح", "Replace the candidate"], PARTIAL_REFUND: ["استرداد جزئي", "Partial refund"],
  SAT: ["السبت", "Sat"], SUN: ["الأحد", "Sun"], MON: ["الاثنين", "Mon"], TUE: ["الثلاثاء", "Tue"], WED: ["الأربعاء", "Wed"], THU: ["الخميس", "Thu"], FRI: ["الجمعة", "Fri"],
  LEADS: ["الـ leads", "Leads"], CANDIDATES: ["المرشحين", "Candidates"], TRAINEES: ["المتدربين", "Trainees"], DONORS: ["المتبرعين", "Donors"], CONTACTS: ["جهات الاتصال", "Contacts"],
  LEAD_FORMS: ["نماذج الـ leads العامة", "Public lead forms"], CERTIFICATE_CHECK: ["التحقق من الشهادات", "Certificate check"],
  CLIENT_PORTAL: ["بوابة العملاء", "Client portal"], COURSE_SIGNUP: ["التسجيل في الكورسات", "Course sign-up"], EMAIL: ["البريد", "E-mail"],
  WHATSAPP: ["واتساب", "WhatsApp"], E_SIGNATURE: ["التوقيع الإلكتروني", "E-signature"], PAYMENTS: ["الدفع أونلاين", "Online payments"],
};
type Labels = typeof L.ar;
const opt = (value: string, ar: boolean) => OPTIONS[value]?.[ar ? 0 : 1] ?? value;
const today = () => new Date().toISOString().slice(0, 10);

function problem(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.errors.failed;
  const code = error.fields?.[0]?.code ?? error.code ?? "";
  if (code && l.errors[code]) return l.errors[code];
  if (error.statusCode === 403) return l.errors.forbidden;
  return l.errors.failed;
}

/** The owners' business rules: every rule a value set from a date, with its history; refused until set. */
export function PoliciesPage({ language, administrator }: { language: Language; administrator?: boolean }) {
  const l = L[language], ar = language === "ar";
  const [overview, setOverview] = useState<PolicyOverview | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { const o = await getPolicies(); setOverview(o); setSelected(s => s ?? o.policies[0]?.key ?? null); }
    catch (e) { setError(problem(e, l)); }
  }, [l]);
  useEffect(() => { void load(); }, [load]);
  const grouped = useMemo(() => AREAS.map(area => ({ area, rows: (overview?.policies ?? []).filter(p => p.area === area) })).filter(g => g.rows.length), [overview]);
  return <section className="page-enter policies-page">
    <div className="page-head"><div className="page-title"><span className="eyebrow">{l.eyebrow}</span><h1>{l.title}</h1><p>{l.intro}</p></div></div>
    {error && <div className="error-banner" role="alert"><CircleAlert size={17}/><span>{error}</span></div>}
    {overview && !overview.canEdit && !overview.noOwners && <p className="daily-note"><ShieldCheck size={15}/>{l.readOnly}</p>}
    <Owners l={l} administrator={!!administrator} overview={overview} onChanged={load}/>
    {overview && <div className="policies-layout">
      <nav className="policies-list" aria-label={l.title}>
        {grouped.map(g => <div key={g.area} className="policies-group">
          <h2>{l.areas[g.area] ?? g.area}</h2>
          <ul>{g.rows.map(p => <li key={p.key}><PolicyRow p={p} l={l} ar={ar} chosen={selected === p.key} onOpen={() => setSelected(p.key)}/></li>)}</ul>
        </div>)}
      </nav>
      {selected && <PolicyPanel key={selected} policyKey={selected} l={l} ar={ar} onChanged={load}/>}
    </div>}
  </section>;
}

function PolicyRow({ p, l, ar, chosen, onOpen }: { p: PolicySummary; l: Labels; ar: boolean; chosen: boolean; onOpen: () => void }) {
  const set = p.inForce > 0;
  return <button type="button" className={"policies-row" + (chosen ? " is-chosen" : "") + (set ? " is-set" : " is-unset")} aria-current={chosen ? "true" : undefined}
    onClick={onOpen}>
    <span className="policies-row-head"><strong>{ar ? p.titleAr : p.titleEn}</strong><code dir="ltr">{p.decision}</code></span>
    <span className="policies-row-status">{set ? <CircleCheck size={14}/> : <CircleDashed size={14}/>}{set ? l.inForce(p.inForce) : l.notSet}</span>
  </button>;
}

function PolicyPanel({ policyKey, l, ar, onChanged }: { policyKey: string; l: Labels; ar: boolean; onChanged: () => void }) {
  const [d, setD] = useState<PolicyDetail | null>(null);
  const [editing, setEditing] = useState<PolicyValue | null | "new">(null);
  const [retiring, setRetiring] = useState<PolicyValue | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { getPolicy(policyKey).then(setD).catch(e => setError(problem(e, l))); }, [policyKey, l]);
  if (!d) return <section className="data-panel policies-panel" aria-busy="true">{error && <p className="admin-list-error" role="alert">{error}</p>}</section>;
  const saved = (next: PolicyDetail) => { setD(next); setEditing(null); setRetiring(null); onChanged(); };
  return <section className="data-panel policies-panel" aria-labelledby="policy-title">
    <div className="policies-panel-head">
      <div><span className="policies-decision">{d.decision} · {l.scopes[d.scope]}</span><h2 id="policy-title"><Scale size={18}/>{ar ? d.titleAr : d.titleEn}</h2>
        <p>{ar ? d.helpAr : d.helpEn}</p></div>
      {d.canEdit && <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}><Plus size={16}/>{l.edit}</button>}
    </div>
    <h3>{l.values}</h3>
    {d.values.length === 0 ? <p className="activity-empty">{l.none}</p>
      : <ul className="policies-values">{d.values.map(v => <li key={v.scope ?? ""} className={v.value ? "is-set" : "is-unset"}>
        <div className="policies-value-head"><strong>{v.scope ?? l.defaultScope}</strong>
          {d.canEdit && <span className="admin-list-actions">
            <button type="button" className="btn btn-small btn-secondary" onClick={() => setEditing(v)}>{l.edit}</button>
            {v.value && <button type="button" className="icon-button" aria-label={`${l.retire}: ${v.scope ?? l.defaultScope}`} onClick={() => setRetiring(v)}><Trash2 size={15}/></button>}
          </span>}</div>
        {v.value ? <><ValueSummary fields={d.fields} value={v.value} ar={ar}/><small><CalendarClock size={12}/>{l.since} {v.since}</small></> : <p className="activity-empty">{l.none}</p>}
        {v.nextFrom && <p className="policies-next"><CalendarClock size={13}/>{v.nextUnsets ? `${l.nextUnset} ${v.nextFrom}` : `${l.next} ${v.nextFrom}:`}
          {v.nextValue && <ValueSummary fields={d.fields} value={v.nextValue} ar={ar}/>}</p>}
      </li>)}</ul>}
    {d.versions.length > 0 && <details className="policies-history"><summary><History size={15}/>{l.history} ({d.versions.length})</summary>
      <ol>{d.versions.map(v => <li key={v.id}>
        <span><strong>{v.scope ?? l.defaultScope}</strong> · {l.since} {v.effectiveFrom}{v.retired && ` · ${l.unset}`}</span>
        {v.value && <ValueSummary fields={d.fields} value={v.value} ar={ar}/>}
        <small>{l.by} {v.authorName} · {l.reason}: {v.reason}</small>
      </li>)}</ol></details>}
    {editing && <EditDialog d={d} l={l} ar={ar} start={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={saved}/>}
    {retiring && <RetireDialog d={d} l={l} value={retiring} onClose={() => setRetiring(null)} onSaved={saved}/>}
  </section>;
}

function ValueSummary({ fields, value, ar }: { fields: PolicyField[]; value: Record<string, unknown>; ar: boolean }) {
  return <dl className="policies-summary">{fields.filter(f => value[f.name] !== undefined).map(f => <div key={f.name}>
    <dt>{ar ? f.titleAr : f.titleEn}</dt><dd><FieldValue field={f} value={value[f.name]} ar={ar}/></dd></div>)}</dl>;
}

function FieldValue({ field, value, ar }: { field: PolicyField; value: unknown; ar: boolean }) {
  if (field.kind === "LIST" && Array.isArray(value)) return <ol className="policies-items">{value.map((item, i) => <li key={i}>
    {field.items.filter(f => (item as Record<string, unknown>)[f.name] !== undefined).map(f =>
      <span key={f.name}>{ar ? f.titleAr : f.titleEn}: <FieldValue field={f} value={(item as Record<string, unknown>)[f.name]} ar={ar}/></span>)}</li>)}</ol>;
  if (Array.isArray(value)) return <>{value.map(v => opt(String(v), ar)).join("، ")}</>;
  if (field.kind === "PERCENT") return <bdi>{String(value)}%</bdi>;
  if (field.kind === "BOOLEAN") return <>{value ? "✓" : "—"}</>;
  if (field.kind === "CHOICE") return <>{opt(String(value), ar)}</>;
  return <bdi>{String(value)}</bdi>;
}

function EditDialog({ d, l, ar, start, onClose, onSaved }: {
  d: PolicyDetail; l: Labels; ar: boolean; start: PolicyValue | null; onClose: () => void; onSaved: (d: PolicyDetail) => void;
}) {
  const [scope, setScope] = useState(start?.scope ?? "");
  const [value, setValue] = useState<Record<string, unknown>>(() => ({ ...(start?.value ?? {}) }));
  const [from, setFrom] = useState(today());
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<BusinessLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (d.scope === "BUSINESS_LINE") void getBusinessLines().then(setLines).catch(() => setLines([])); }, [d.scope]);
  const needsScope = d.scope !== "NONE" && !d.allowsDefault;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try { onSaved(await setPolicy(d.key, { scope: scope || undefined, value, effectiveFrom: from, reason: reason.trim() })); }
    catch (failure) { setError(problem(failure, l)); }
    finally { setBusy(false); }
  }
  return <Dialog title={l.edit} kicker={ar ? d.titleAr : d.titleEn} busy={busy} onClose={onClose} wide
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="policy-form" className="btn btn-primary" disabled={busy || !reason.trim() || (needsScope && !scope)}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="policy-form" className="daily-form policies-form" onSubmit={e => void submit(e)}>
      {d.scope !== "NONE" && <label><span>{l.scope}</span>
        {d.scope === "BUSINESS_LINE" ? <select value={scope} onChange={e => setScope(e.target.value)} disabled={!!start}>
            {d.allowsDefault ? <option value="">{l.allLines}</option> : <option value="">{l.choose}</option>}
            {lines.map(b => <option key={b.code} value={b.code}>{ar ? b.nameAr : b.nameEn} ({b.code})</option>)}</select>
          : d.scope === "DATA_TYPE" ? <select value={scope} onChange={e => setScope(e.target.value)} disabled={!!start}><option value="">{l.choose}</option>
            {DATA_TYPES.map(t => <option key={t} value={t}>{opt(t, ar)}</option>)}</select>
          : <input value={scope} onChange={e => setScope(e.target.value)} placeholder={d.allowsDefault ? l.allLines : l.scopeHint[d.scope] ?? ""} disabled={!!start}/>}
      </label>}
      {d.fields.map(f => <FieldInput key={f.name} field={f} ar={ar} l={l} value={value[f.name]} onChange={v => setValue(x => ({ ...x, [f.name]: v }))}/>)}
      <label><span>{l.effective}</span><input type="date" value={from} min={today()} required onChange={e => setFrom(e.target.value)}/></label>
      <label><span>{l.reasonLabel}</span><textarea value={reason} rows={2} maxLength={500} required onChange={e => setReason(e.target.value)}/></label>
      {error && <p className="daily-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    </form>
  </Dialog>;
}

/** One field of a policy value, by its kind. */
function FieldInput({ field, value, onChange, ar, l }: { field: PolicyField; value: unknown; onChange: (v: unknown) => void; ar: boolean; l: Labels }) {
  const title = (ar ? field.titleAr : field.titleEn) + (field.required ? "" : ar ? " (اختياري)" : " (optional)");
  switch (field.kind) {
    case "PERCENT": case "DECIMAL": case "INTEGER":
      return <label><span>{title}</span><span className="policies-number"><input type="number" inputMode="decimal" value={value === undefined || value === null ? "" : String(value)}
        step={field.kind === "INTEGER" ? 1 : 0.01} min={field.kind === "PERCENT" ? 0 : field.min ?? undefined} max={field.kind === "PERCENT" ? 100 : field.max ?? undefined}
        onChange={e => onChange(e.target.value === "" ? undefined : Number(e.target.value))}/>{field.kind === "PERCENT" && <span>%</span>}</span></label>;
    case "BOOLEAN":
      return <label className="policies-check"><input type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)}/>{title}</label>;
    case "CHOICE":
      return <label><span>{title}</span><select value={String(value ?? "")} onChange={e => onChange(e.target.value || undefined)}>
        <option value="">{l.choose}</option>{field.options.map(o => <option key={o} value={o}>{opt(o, ar)}</option>)}</select></label>;
    case "MULTI_CHOICE": {
      const chosen = Array.isArray(value) ? value as string[] : [];
      return <fieldset className="quality-choice"><legend>{title}</legend>{field.options.map(o => <label key={o}>
        <input type="checkbox" checked={chosen.includes(o)} onChange={e => onChange(e.target.checked ? [...chosen, o] : chosen.filter(x => x !== o))}/>{opt(o, ar)}</label>)}</fieldset>;
    }
    case "TIME":
      return <label><span>{title}</span><input type="time" value={String(value ?? "")} onChange={e => onChange(e.target.value || undefined)}/></label>;
    case "DATE_LIST": {
      const dates = Array.isArray(value) ? value as string[] : [];
      return <fieldset className="policies-dates"><legend>{title}</legend>
        <ul>{dates.map(x => <li key={x} className="chip"><bdi>{x}</bdi><button type="button" aria-label={`${l.removeRow}: ${x}`} onClick={() => onChange(dates.filter(y => y !== x))}><X size={12}/></button></li>)}</ul>
        <input type="date" aria-label={l.addDate} onChange={e => { if (e.target.value && !dates.includes(e.target.value)) onChange([...dates, e.target.value].sort()); e.target.value = ""; }}/>
      </fieldset>;
    }
    case "LIST": {
      const rows = Array.isArray(value) ? value as Record<string, unknown>[] : [];
      return <fieldset className="policies-list-field"><legend>{title}</legend>
        {rows.map((row, i) => <div key={i} className="policies-list-row">
          <span className="policies-list-index">{i + 1}</span>
          {field.items.map(item => <FieldInput key={item.name} field={item} ar={ar} l={l} value={row[item.name]}
            onChange={v => onChange(rows.map((r, j) => j === i ? { ...r, [item.name]: v } : r))}/>)}
          <button type="button" className="icon-button" aria-label={`${l.removeRow} ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}><Trash2 size={15}/></button>
        </div>)}
        {(field.max === null || rows.length < field.max) && <button type="button" className="btn btn-small btn-secondary" onClick={() => onChange([...rows, {}])}><Plus size={14}/>{l.addRow}</button>}
      </fieldset>;
    }
    default:
      return <label><span>{title}</span><input value={String(value ?? "")} maxLength={field.max ?? undefined} onChange={e => onChange(e.target.value)}/></label>;
  }
}

function RetireDialog({ d, l, value, onClose, onSaved }: { d: PolicyDetail; l: Labels; value: PolicyValue; onClose: () => void; onSaved: (d: PolicyDetail) => void }) {
  const [from, setFrom] = useState(today());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true); setError("");
    try { onSaved(await retirePolicy(d.key, { scope: value.scope ?? undefined, effectiveFrom: from, reason: reason.trim() })); }
    catch (failure) { setError(problem(failure, l)); }
    finally { setBusy(false); }
  }
  return <Dialog title={l.retireTitle} description={l.retireText} kicker={value.scope ?? l.defaultScope} busy={busy} onClose={onClose}
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="button" className="btn btn-primary admin-danger" disabled={busy || !reason.trim()} onClick={() => void submit()}><Trash2 size={16}/>{l.retire}</button></>}>
    <div className="daily-form">
      <label><span>{l.effective}</span><input type="date" value={from} min={today()} onChange={e => setFrom(e.target.value)}/></label>
      <label><span>{l.reasonLabel}</span><textarea value={reason} rows={2} maxLength={500} onChange={e => setReason(e.target.value)}/></label>
      {error && <p className="daily-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    </div>
  </Dialog>;
}

function Owners({ l, administrator, overview, onChanged }: { l: Labels; administrator: boolean; overview: PolicyOverview | null; onChanged: () => void }) {
  const [owners, setOwners] = useState<Person[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [pick, setPick] = useState("");
  const [error, setError] = useState("");
  const canAppoint = !!overview && (overview.canEdit || (overview.noOwners && administrator));
  useEffect(() => { void getPolicyOwners().then(setOwners).catch(() => setOwners([])); }, [overview]);
  useEffect(() => { if (canAppoint) void getPolicyPeople().then(setPeople).catch(() => setPeople([])); }, [canAppoint]);
  async function run(action: () => Promise<Person[]>) {
    setError("");
    try { setOwners(await action()); setPick(""); onChanged(); } catch (e) { setError(problem(e, l)); }
  }
  if (!overview) return null;
  return <section className={"data-panel policies-owners" + (overview.noOwners ? " is-empty" : "")} aria-labelledby="policy-owners">
    <h2 id="policy-owners"><UserRound size={17}/>{overview.noOwners ? l.noOwners : l.owners}</h2>
    <p>{overview.noOwners ? l.noOwnersHint : l.ownersHint}</p>
    {owners.length > 0 && <ul className="policies-owner-list">{owners.map(o => <li key={o.id} className="chip">{o.me ? `${o.name} (${l.you})` : o.name}
      {overview.canEdit && <button type="button" aria-label={`${l.dismiss}: ${o.name}`} onClick={() => void run(() => dismissOwner(o.id))}><X size={12}/></button>}</li>)}</ul>}
    {canAppoint && <form className="admin-list-add" onSubmit={e => { e.preventDefault(); if (pick) void run(() => appointOwner(Number(pick))); }}>
      <select value={pick} aria-label={l.person} onChange={e => setPick(e.target.value)}><option value="">{l.choose}</option>
        {people.filter(p => !owners.some(o => o.id === p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <button type="submit" className="btn btn-primary" disabled={!pick}><Plus size={16}/>{l.appoint}</button>
    </form>}
    {error && <p className="admin-list-error" role="alert"><CircleAlert size={15}/>{error}</p>}
  </section>;
}
