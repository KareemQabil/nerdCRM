import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeftRight, CircleAlert, History, PencilLine, RefreshCw, Save, TriangleAlert } from "lucide-react";
import { ApiError } from "./api";
import { Dialog } from "./Dialog";
import { enterFxRate, getFx, refreshFx, type FxOverview } from "./financeApi";
import type { Language } from "./preferences";

const L = {
  ar: {
    title: "أسعار الصرف للجنيه",
    noPolicy: "مالك السياسات لسه ما حددش مصدر أسعار الصرف (finance.fx)، فمفيش تحويل للجنيه لحد ما يتحدد.",
    source: { PUBLIC_API: "مصدر عام، والمالية تقدر تعدّل يدويًا", MANUAL_ONLY: "المالية بتدخل الأسعار يدويًا" },
    maxAge: (h: number) => `السعر الأقدم من ${h} ساعة ما بيتستخدمش.`,
    per: (c: string) => `1 ${c} = `, noRate: "لسه مفيش سعر", stale: "قديم، مش بيتستخدم",
    manual: "يدوي", publicSource: "المصدر العام", since: (h: number) => h < 1 ? "من أقل من ساعة" : h < 48 ? `من ${h} ساعة` : `من ${Math.round(h / 24)} يوم`,
    refresh: "حدّث من المصدر العام", refreshing: "جاري التحديث…", enter: "أدخل سعر يدوي",
    dialogTitle: "سعر صرف يدوي", dialogText: "السعر اليدوي بيكسب سعر المصدر العام في نفس اليوم. اكتب السبب.",
    currency: "العملة", rate: (base: string) => `كام ${base} للوحدة`, date: "سعر يوم", reason: "السبب", save: "حفظ", saving: "جاري الحفظ…", cancel: "إلغاء",
    history: "آخر الأسعار المسجلة", by: "بواسطة", refreshed: "اتحدثت الأسعار.", entered: "اتسجل السعر.",
    errors: { FX_MANUAL_ONLY: "السياسة بتقول الأسعار تتدخل يدويًا بس.", FX_SOURCE_UNAVAILABLE: "المصدر العام مش متاح دلوقتي؛ دخّل السعر يدويًا.",
      POLICY_NOT_SET: "مصدر أسعار الصرف لسه مش محدد.", UNAVAILABLE: "العملة دي مش في قائمة السياسة.", RANGE: "راجع السعر أو التاريخ.",
      REQUIRED: "اكتب السبب.", forbidden: "مش مسموح لك بالإجراء ده.", failed: "تعذّر تنفيذ الطلب." } as Record<string, string>,
  },
  en: {
    title: "Exchange rates to EGP",
    noPolicy: "The policy owners have not set the exchange-rate source (finance.fx) yet, so nothing is converted to EGP.",
    source: { PUBLIC_API: "Public source, finance can override by hand", MANUAL_ONLY: "Finance enters rates by hand" },
    maxAge: (h: number) => `A rate older than ${h} hours is not used.`,
    per: (c: string) => `1 ${c} = `, noRate: "No rate yet", stale: "Too old, not used",
    manual: "Manual", publicSource: "Public source", since: (h: number) => h < 1 ? "under an hour ago" : h < 48 ? `${h} hours ago` : `${Math.round(h / 24)} days ago`,
    refresh: "Fetch from the public source", refreshing: "Fetching…", enter: "Enter a rate by hand",
    dialogTitle: "Manual exchange rate", dialogText: "A manual rate wins over the public source on its date. Say why.",
    currency: "Currency", rate: (base: string) => `${base} per unit`, date: "Rate for", reason: "Reason", save: "Save", saving: "Saving…", cancel: "Cancel",
    history: "Recent rates", by: "by", refreshed: "Rates fetched.", entered: "Rate recorded.",
    errors: { FX_MANUAL_ONLY: "The policy says rates are entered by hand only.", FX_SOURCE_UNAVAILABLE: "The public source is not available; enter the rate by hand.",
      POLICY_NOT_SET: "The exchange-rate source is not set yet.", UNAVAILABLE: "This currency is not in the policy's list.", RANGE: "Check the rate or the date.",
      REQUIRED: "Give the reason.", forbidden: "You are not allowed to do this.", failed: "The request failed." } as Record<string, string>,
  },
};
type Labels = typeof L.ar;

function problem(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.errors.failed;
  const code = error.code && error.code in l.errors ? error.code : error.fields?.[0]?.code ?? "";
  if (code in l.errors) return l.errors[code];
  if (error.statusCode === 403) return l.errors.forbidden;
  return l.errors.failed;
}

const today = () => new Date().toISOString().slice(0, 10);

/** D-06: the rates amounts are converted with, where they come from and how old they are; finance fetches or overrides them. */
export function FxPanel({ language, onChanged }: { language: Language; onChanged?: () => void }) {
  const l = L[language], ar = language === "ar";
  const [fx, setFx] = useState<FxOverview | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [entering, setEntering] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const load = useCallback(() => getFx().then(setFx).catch(e => {
    if (e instanceof ApiError && (e.statusCode === 403 || e.statusCode === 404)) setHidden(true); // not in this person's access
    else setMessage({ kind: "error", text: problem(e, l) });
  }), [l]);
  useEffect(() => { void load(); }, [load]);
  if (hidden) return null;
  const rate = (value: number) => new Intl.NumberFormat(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 6 }).format(value);
  const day = (value: string) => new Date(value + "T00:00:00").toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
  async function fetchNow() {
    setBusy(true); setMessage(null);
    try { setFx(await refreshFx()); setMessage({ kind: "ok", text: l.refreshed }); onChanged?.(); }
    catch (e) { setMessage({ kind: "error", text: problem(e, l) }); }
    finally { setBusy(false); }
  }
  return <section className="data-panel fx-panel" aria-labelledby="fx-title">
    <div className="finance-head"><h2 id="fx-title"><ArrowLeftRight size={17}/>{l.title}</h2>
      {fx?.policySet && fx.canChange && <div className="fx-actions">
        {fx.source === "PUBLIC_API" && <button type="button" className="btn btn-small btn-secondary" disabled={busy} onClick={() => void fetchNow()}>
          <RefreshCw size={14}/>{busy ? l.refreshing : l.refresh}</button>}
        <button type="button" className="btn btn-small btn-secondary" disabled={busy} onClick={() => setEntering(true)}><PencilLine size={14}/>{l.enter}</button>
      </div>}
    </div>
    {message && <p className={message.kind === "error" ? "daily-error" : "fx-ok"} role={message.kind === "error" ? "alert" : "status"}>
      {message.kind === "error" && <CircleAlert size={15}/>}{message.text}</p>}
    {fx === null ? null : !fx.policySet ? <p className="fx-note"><TriangleAlert size={15}/>{l.noPolicy}</p> : <>
      <p className="fx-note">{fx.source && l.source[fx.source]}. {fx.maxAgeHours != null && l.maxAge(fx.maxAgeHours)}</p>
      <ul className="fx-list">{fx.currencies.map(c => <li key={c.currency} className={"fx-row" + (c.stale ? " is-stale" : "") + (c.rate == null ? " is-missing" : "")}>
        <strong dir="ltr">{c.currency}</strong>
        {c.rate == null ? <span className="fx-missing">{l.noRate}</span> : <>
          <span className="fx-rate" dir="ltr">{l.per(c.currency)}{rate(c.rate)} {fx.baseCurrency}</span>
          <span className="fx-meta">{c.source === "MANUAL" ? l.manual : l.publicSource} · {c.rateDate && day(c.rateDate)}{c.ageHours != null && ` · ${l.since(c.ageHours)}`}</span>
          {c.stale && <span className="fx-stale"><TriangleAlert size={13}/>{l.stale}</span>}
        </>}
      </li>)}</ul>
      {fx.history.length > 0 && <details className="fx-history"><summary><History size={14}/>{l.history}</summary>
        <ol>{fx.history.map(h => <li key={h.id}>
          <span dir="ltr">1 {h.currency} = {rate(h.rate)} {fx.baseCurrency}</span>
          <small>{day(h.rateDate)} · {h.source === "MANUAL" ? l.manual : `${l.publicSource}${h.provider ? ` (${h.provider})` : ""}`}{h.enteredBy && ` · ${l.by} ${h.enteredBy}`}</small>
          {h.reason && <small>{h.reason}</small>}
        </li>)}</ol></details>}
    </>}
    {entering && fx && <RateDialog fx={fx} l={l} onClose={() => setEntering(false)}
      onSaved={next => { setFx(next); setEntering(false); setMessage({ kind: "ok", text: l.entered }); onChanged?.(); }}/>}
  </section>;
}

function RateDialog({ fx, l, onClose, onSaved }: { fx: FxOverview; l: Labels; onClose: () => void; onSaved: (fx: FxOverview) => void }) {
  const [currency, setCurrency] = useState(fx.currencies[0]?.currency ?? "");
  const [value, setValue] = useState("");
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try { onSaved(await enterFxRate({ currency, rate: Number(value), rateDate: date, reason: reason.trim() })); }
    catch (failure) { setError(problem(failure, l)); }
    finally { setBusy(false); }
  }
  return <Dialog title={l.dialogTitle} description={l.dialogText} busy={busy} onClose={onClose}
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="fx-form" className="btn btn-primary" disabled={busy || !currency || !value || !reason.trim()}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="fx-form" className="daily-form" onSubmit={e => void submit(e)}>
      <label><span>{l.currency}</span><select value={currency} onChange={e => setCurrency(e.target.value)} required>
        {fx.currencies.map(c => <option key={c.currency} value={c.currency}>{c.currency}</option>)}</select></label>
      <label><span>{l.rate(fx.baseCurrency)}</span><input type="number" inputMode="decimal" min="0.000001" step="0.000001" required dir="ltr"
        value={value} onChange={e => setValue(e.target.value)}/></label>
      <label><span>{l.date}</span><input type="date" value={date} max={today()} required onChange={e => setDate(e.target.value)}/></label>
      <label><span>{l.reason}</span><textarea value={reason} rows={2} maxLength={500} required onChange={e => setReason(e.target.value)}/></label>
      {error && <p className="daily-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    </form>
  </Dialog>;
}
