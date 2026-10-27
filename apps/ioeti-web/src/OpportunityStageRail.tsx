import { useEffect, useState, type FormEvent } from "react";
import { Check, CircleAlert, Gauge, LockKeyhole, Pencil, RotateCcw, Save, XCircle } from "lucide-react";
import { Dialog } from "./Dialog";
import {
  getOpportunityStages, loseOpportunity, moveOpportunity, planOpportunity, problem, reopenOpportunity, wallClock,
  type OpportunityPlan, type OpportunityStage,
} from "./dailyApi";
import { wrapped } from "./api";
import { stageLabel } from "./labels";
import type { Language } from "./preferences";
import "./daily.css";
import { amount as formatAmount } from "./format";

type Reason = { id: number; name: string };
const L = {
  ar: {
    title: "مسار الفرصة", hint: "اضغط على أي مرحلة مفتوحة لنقل الفرصة إليها.",
    move: "نقل إلى", current: "المرحلة الحالية", won: "الفوز محتاج دليل التزام حسب خط الأعمال (D-11): عقد متفعّل بدليل توقيع، أو قبول عميل مسجّل بدليله.", markWon: "تسجيل كمكسوبة", isWon: "مكسوبة",
    lose: "تسجيل كخاسرة", reopen: "إعادة فتح", lost: "خاسرة", reason: "سبب الخسارة", choose: "اختر سببًا…",
    noReasons: "لم تُضف أسباب خسارة بعد. مسؤول النظام هو اللي يضيفها؛ لحد كده مش هينفع تتسجل الفرصة كخاسرة.",
    note: "ملاحظة (اختياري)", loseTitle: "تسجيل الفرصة كخاسرة", loseHint: "السبب بيساعد الفريق يفهم ليه بنخسر صفقات. تقدر تعيد فتحها بعدين.",
    cancel: "إلغاء", save: "حفظ", saving: "جاري الحفظ…",
    plan: "تقدير الصفقة", planHint: "تقدير البائع للصفقة، مش إيراد محقق.", amount: "القيمة المتوقعة", currency: "العملة",
    close: "تاريخ الإغلاق المتوقع", probability: "احتمال الفوز", edit: "تعديل التقدير", notSet: "غير محدد",
    weighted: "القيمة المرجحة", estimateOnly: "تقدير فقط",
  },
  en: {
    title: "Opportunity path", hint: "Select any open stage to move the opportunity there.",
    move: "Move to", current: "Current stage", won: "Won needs the evidence of commitment the business line sets (D-11): a contract activated on signature evidence, or a client acceptance recorded with its evidence.", markWon: "Mark won", isWon: "Won",
    lose: "Mark lost", reopen: "Reopen", lost: "Lost", reason: "Lost reason", choose: "Choose a reason…",
    noReasons: "No lost reasons are set up yet. An administrator adds them; until then an opportunity cannot be marked lost.",
    note: "Note (optional)", loseTitle: "Mark the opportunity lost", loseHint: "The reason helps the team learn why deals are lost. You can reopen it later.",
    cancel: "Cancel", save: "Save", saving: "Saving…",
    plan: "Deal estimate", planHint: "The salesperson's estimate, not revenue earned.", amount: "Expected amount", currency: "Currency",
    close: "Expected close date", probability: "Win probability", edit: "Edit estimate", notSet: "Not set",
    weighted: "Weighted value", estimateOnly: "Estimate only",
  },
} as const;

/** The stage path of one opportunity: open stages are one tap away, lost needs a reason, and won needs the evidence of
 * commitment the business line sets (D-11), which the server checks. */
export function OpportunityStageRail({ record, language, onChanged }: {
  record: OpportunityPlan; language: Language; onChanged: (next: OpportunityPlan) => void;
}) {
  const l = L[language], ar = language === "ar";
  const [stages, setStages] = useState<OpportunityStage[]>([]);
  const [busy, setBusy] = useState<number | "reopen" | null>(null);
  const [error, setError] = useState("");
  const [losing, setLosing] = useState(false);
  const [loadError, setLoadError] = useState("");
  useEffect(() => { void getOpportunityStages().then(setStages).catch(e => setLoadError(problem(e, ar))); }, [ar]);
  const lost = record.stageKind === "LOST";
  const isWon = record.stageKind === "WON";
  const currentIndex = stages.findIndex(s => s.id === record.stageId);
  async function run(key: number | "reopen", action: () => Promise<OpportunityPlan>) {
    setBusy(key); setError("");
    try { onChanged(await action()); }
    catch (failure) { setError(problem(failure, ar)); }
    finally { setBusy(null); }
  }
  const open = stages.filter(s => s.kind === "OPEN");
  const won = stages.find(s => s.kind === "WON");
  return <section className="stage-rail-card" aria-labelledby="stage-rail-title">
    <div className="stage-rail-head">
      <div><h2 id="stage-rail-title">{l.title}</h2><p>{lost ? `${l.lost}${record.lostReason ? " · " + record.lostReason : ""}` : isWon ? l.isWon : l.hint}</p></div>
      <div className="stage-rail-actions">
        {lost ? <button type="button" className="btn btn-secondary" disabled={busy !== null}
          onClick={() => void run("reopen", () => reopenOpportunity(record.id, record.version))}><RotateCcw size={16}/>{l.reopen}</button>
          : !isWon && <button type="button" className="btn btn-secondary stage-lose" disabled={busy !== null} onClick={() => setLosing(true)}><XCircle size={16}/>{l.lose}</button>}
      </div>
    </div>
    <ol className={"stage-rail" + (lost ? " is-lost" : "")}>
      {open.map(stage => {
        const index = stages.indexOf(stage);
        const state = stage.id === record.stageId ? "current" : currentIndex >= 0 && index < currentIndex ? "passed" : "ahead";
        const label = stageLabel(stage.name, language);
        return <li key={stage.id} className={"stage-step is-" + state}>
          <button type="button" disabled={lost || isWon || busy !== null || state === "current"} aria-current={state === "current" ? "step" : undefined}
            aria-label={state === "current" ? `${l.current}: ${label}` : `${l.move} ${label}`}
            onClick={() => void run(stage.id, () => moveOpportunity(record.id, record.version, stage.id))}>
            <span className="stage-dot">{state === "passed" ? <Check size={13}/> : busy === stage.id ? "…" : index + 1}</span>
            <span className="stage-name">{label}</span>
          </button>
        </li>;
      })}
      {won && <li className={"stage-step " + (isWon ? "is-current" : "is-ahead")} title={l.won}>
        <button type="button" disabled={lost || isWon || busy !== null} aria-current={isWon ? "step" : undefined}
          aria-label={isWon ? `${l.current}: ${stageLabel(won.name, language)}` : l.markWon}
          onClick={() => void run(won.id, () => moveOpportunity(record.id, record.version, won.id))}>
          <span className="stage-dot">{isWon ? <Check size={13}/> : busy === won.id ? "…" : <LockKeyhole size={12}/>}</span>
          <span className="stage-name">{stageLabel(won.name, language)}</span>
        </button>
      </li>}
    </ol>
    {won && !lost && !isWon && <p className="daily-note"><LockKeyhole size={14}/>{l.won}</p>}
    {loadError && <p className="daily-note"><CircleAlert size={14}/>{loadError}</p>}
    {error && <p className="daily-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    {losing && <LoseDialog record={record} language={language} onClose={() => setLosing(false)} onSaved={next => { setLosing(false); onChanged(next); }}/>}
  </section>;
}

function LoseDialog({ record, language, onClose, onSaved }: {
  record: OpportunityPlan; language: Language; onClose: () => void; onSaved: (next: OpportunityPlan) => void;
}) {
  const l = L[language], ar = language === "ar";
  const [reasons, setReasons] = useState<Reason[] | null>(null);
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void wrapped<Reason[]>("/ws/ioeti/opportunities/lost-reasons").then(r => setReasons(Array.isArray(r) ? r : [])).catch(e => setError(problem(e, ar))); }, [ar]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try { onSaved(await loseOpportunity(record.id, record.version, Number(reasonId), note.trim())); }
    catch (failure) { setError(problem(failure, ar)); }
    finally { setBusy(false); }
  }
  return <Dialog title={l.loseTitle} description={l.loseHint} kicker={record.name} busy={busy} onClose={onClose}
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="lose-form" className="btn btn-primary" disabled={busy || !reasonId}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="lose-form" className="daily-form" onSubmit={e => void submit(e)}>
      {reasons?.length === 0 && <p className="daily-note" role="status"><CircleAlert size={14}/>{l.noReasons}</p>}
      <div className="reason-chips" role="radiogroup" aria-label={l.reason}>
        {(reasons ?? []).map(r => <label key={r.id} className={"reason-chip" + (String(r.id) === reasonId ? " chosen" : "")}>
          <input type="radio" name="lost-reason" value={r.id} checked={String(r.id) === reasonId} onChange={() => setReasonId(String(r.id))}/>{r.name}</label>)}
      </div>
      <label><span>{l.note}</span><textarea value={note} maxLength={1000} rows={3} onChange={e => setNote(e.target.value)}/></label>
      {error && <p className="daily-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    </form>
  </Dialog>;
}

/** The salesperson's estimate: amount, currency, expected close date and probability. Never revenue. */
export function OpportunityPlanCard({ record, language, onChanged }: {
  record: OpportunityPlan; language: Language; onChanged: (next: OpportunityPlan) => void;
}) {
  const l = L[language], ar = language === "ar";
  const [editing, setEditing] = useState(false);
  const amount = record.amount == null ? null : Number(record.amount);
  const probability = record.probability == null ? null : Number(record.probability);
  const money = (value: number) => formatAmount(value, record.currencyCode);
  const date = wallClock(record.expectedCloseDate)?.toLocaleDateString(ar ? "ar-EG" : "en-GB", { dateStyle: "medium" }) ?? null;
  const facts: [string, string][] = [
    [l.amount, amount != null && amount > 0 ? money(amount) : l.notSet],
    [l.close, date ?? l.notSet],
    [l.probability, probability != null && probability > 0 ? `${probability}%` : l.notSet],
  ];
  return <section className="plan-card" aria-labelledby="plan-card-title">
    <div className="plan-head"><div><h2 id="plan-card-title"><Gauge size={18}/>{l.plan}</h2><p>{l.planHint}</p></div>
      {record.stageKind !== "LOST" && <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}><Pencil size={15}/>{l.edit}</button>}</div>
    <dl className="plan-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    {amount != null && amount > 0 && probability != null && probability > 0 && <p className="plan-weighted">
      <span>{l.weighted}</span><strong>{money(Math.round(amount * probability) / 100)}</strong><small>{l.estimateOnly}</small></p>}
    {probability != null && probability > 0 && <div className="plan-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={probability} aria-label={l.probability}>
      <span style={{ inlineSize: `${Math.min(100, probability)}%` }}/></div>}
    {editing && <PlanDialog record={record} language={language} onClose={() => setEditing(false)} onSaved={next => { setEditing(false); onChanged(next); }}/>}
  </section>;
}

function PlanDialog({ record, language, onClose, onSaved }: {
  record: OpportunityPlan; language: Language; onClose: () => void; onSaved: (next: OpportunityPlan) => void;
}) {
  const l = L[language], ar = language === "ar";
  const [amount, setAmount] = useState(record.amount == null || Number(record.amount) === 0 ? "" : String(record.amount));
  const [currency, setCurrency] = useState(record.currencyCode ?? "EGP");
  const [close, setClose] = useState(record.expectedCloseDate?.slice(0, 10) ?? "");
  const [probability, setProbability] = useState(record.probability == null ? 0 : Number(record.probability));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      onSaved(await planOpportunity(record.id, record.version, {
        amount: amount.trim() || "0", currencyCode: currency.trim().toUpperCase() || null, expectedCloseDate: close || null, probability: String(probability),
      }));
    } catch (failure) { setError(problem(failure, ar)); }
    finally { setBusy(false); }
  }
  return <Dialog title={l.plan} description={l.planHint} kicker={record.name} busy={busy} onClose={onClose}
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="plan-form" className="btn btn-primary" disabled={busy}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="plan-form" className="daily-form daily-form-two" onSubmit={e => void submit(e)}>
      <label><span>{l.amount}</span><input value={amount} inputMode="decimal" dir="ltr" pattern="\d{1,12}(\.\d{1,2})?" placeholder="150000" onChange={e => setAmount(e.target.value)}/></label>
      <label><span>{l.currency}</span><input value={currency} dir="ltr" maxLength={3} pattern="[A-Za-z]{3}" onChange={e => setCurrency(e.target.value)}/></label>
      <label className="daily-span"><span>{l.close}</span><input type="date" value={close} onChange={e => setClose(e.target.value)}/></label>
      <label className="daily-span plan-slider"><span>{l.probability}: <strong>{probability}%</strong></span>
        <input type="range" min={0} max={100} step={5} value={probability} onChange={e => setProbability(Number(e.target.value))}/></label>
      {error && <p className="daily-error daily-span" role="alert"><CircleAlert size={15}/>{error}</p>}
    </form>
  </Dialog>;
}
