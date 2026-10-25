import { useCallback, useEffect, useState } from "react";
import { Building2, CalendarClock, CircleAlert, FileClock, LockKeyhole, ReceiptText, Send, TriangleAlert, Undo2, Wallet } from "lucide-react";
import { ApiError } from "./api";
import {
  cancelRequest, getFinanceQueue, getFinanceSummary, getUpcomingMilestones, issueInvoice, requestMilestoneInvoice,
  type FinanceRequest, type FinanceSummary, type UpcomingMilestone,
} from "./financeApi";
import { FxPanel } from "./FxPanel";
import type { Language } from "./preferences";
import "./daily.css";
import "./finance.css";

const L = {
  ar: {
    eyebrow: "المالية", title: "الفواتير والتحصيل",
    hint: "طلبات الفوترة اللي المبيعات رفعتها من الطلبات المؤكدة، والأقساط اللي جاي معادها، والأرقام الفعلية لكل عملة.",
    held: "إصدار الفواتير في الحسابات لسه جاي (D-06)، والفاتورة الإلكترونية مش في النسخة الأولى. مفيش أي دفعة بتتسجل كمحصّلة من هنا.",
    inBase: (c: string) => c === "EGP" ? "بالجنيه" : `بالـ ${c}`, fx: { POLICY_NOT_SET: "مصدر أسعار الصرف مش محدد", NO_RATE: "مفيش سعر صرف", FX_STALE: "سعر الصرف قديم" } as Record<string, string>,
    rateUsed: (rate: string, d: string) => `بسعر ${rate} (${d})`, total: (c: string) => c === "EGP" ? "الإجمالي بالجنيه" : `الإجمالي بالـ ${c}`, totalMissing: "الإجمالي بالجنيه مش متاح لحد ما كل العملات يبقى ليها سعر صرف ساري.",
    summary: "الأرقام لكل عملة", booked: "طلبات مؤكدة (قبل الضريبة)", requested: "مطلوب فوترته (قبل الضريبة)", invoiced: "فواتير صادرة (من الحسابات)", collected: "محصّل (من الحسابات)",
    notPermitted: "مش ضمن صلاحياتك", noMoney: "لسه مفيش أرقام.",
    queue: "طلبات الفوترة", open: "مفتوحة", cancelled: "ملغاة", all: "الكل", emptyQueue: "مفيش طلبات هنا.",
    upcoming: "أقساط جاي معادها", within: (n: number) => `خلال ${n} يوم`, emptyUpcoming: "مفيش أقساط مستحقة من غير طلب فوترة في الفترة دي.",
    order: "الطلب", due: "الاستحقاق", amount: "المبلغ قبل الضريبة", by: "طلبها", age: (n: number) => n === 0 ? "النهارده" : `من ${n} يوم`,
    overdue: "فات معاده", daysLeft: (n: number) => n === 0 ? "النهارده" : n < 0 ? `متأخر ${-n} يوم` : `بعد ${n} يوم`,
    request: "اطلب الفوترة", issue: "إصدار الفاتورة", cancel: "إلغاء الطلب", you: "أنت", loading: "جاري التحميل…",
    requestedOk: "اتطلبت الفوترة.", cancelledOk: "الطلب اتلغى.",
    errors: { BLOCKED_BY_POLICY: "إصدار الفاتورة موقوف لحد اعتماد سياسة المالية والضرائب (D-06). مفيش فاتورة اتعملت.",
      ORDER_NOT_CONFIRMED: "الطلب لازم يكون مؤكد.", ALREADY_INVOICED: "القسط ده اتفوتر قبل كده.", INVOICE_REQUEST_EXISTS: "فيه طلب فوترة مفتوح للقسط ده.",
      conflict: "البيانات اتغيرت من مكان تاني؛ اتحدّثت.", forbidden: "مش مسموح لك بالإجراء ده.", failed: "تعذّر تنفيذ الطلب." },
  },
  en: {
    eyebrow: "Finance", title: "Invoices & collection",
    hint: "The invoice requests sales raised from confirmed orders, the milestones coming due, and the real figures per currency.",
    held: "Issuing invoices in accounting comes next (D-06); e-invoicing is not in V1. No payment is recorded as received from here.",
    inBase: (c: string) => `in ${c}`, fx: { POLICY_NOT_SET: "No exchange-rate source set", NO_RATE: "No exchange rate", FX_STALE: "Exchange rate too old" } as Record<string, string>,
    rateUsed: (rate: string, d: string) => `at ${rate} (${d})`, total: (c: string) => `Total in ${c}`, totalMissing: "The total in EGP waits until every currency has a current exchange rate.",
    summary: "Figures per currency", booked: "Confirmed orders (before tax)", requested: "Requested for invoicing (before tax)", invoiced: "Invoices issued (from accounting)", collected: "Collected (from accounting)",
    notPermitted: "Not in your access", noMoney: "No figures yet.",
    queue: "Invoice requests", open: "Open", cancelled: "Cancelled", all: "All", emptyQueue: "No requests here.",
    upcoming: "Milestones coming due", within: (n: number) => `Within ${n} days`, emptyUpcoming: "No milestone falls due without an invoice request in this period.",
    order: "Order", due: "Due", amount: "Amount before tax", by: "Requested by", age: (n: number) => n === 0 ? "today" : `${n} days ago`,
    overdue: "Past due", daysLeft: (n: number) => n === 0 ? "today" : n < 0 ? `${-n} days late` : `in ${n} days`,
    request: "Request invoicing", issue: "Issue invoice", cancel: "Cancel request", you: "you", loading: "Loading…",
    requestedOk: "Invoicing requested.", cancelledOk: "The request was cancelled.",
    errors: { BLOCKED_BY_POLICY: "Issuing the invoice waits for the finance and tax policy (D-06). No invoice was created.",
      ORDER_NOT_CONFIRMED: "The order must be confirmed.", ALREADY_INVOICED: "This milestone is already invoiced.", INVOICE_REQUEST_EXISTS: "This milestone already has an open invoice request.",
      conflict: "The data changed elsewhere; it was refreshed.", forbidden: "You are not allowed to do this.", failed: "The request failed." },
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

export function FinancePage({ language }: { language: Language }) {
  const l = L[language], ar = language === "ar";
  const [state, setState] = useState<"open" | "cancelled" | "all">("open");
  const [within, setWithin] = useState(30);
  const [queue, setQueue] = useState<FinanceRequest[] | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingMilestone[] | null>(null);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [queueError, setQueueError] = useState("");
  const [upcomingError, setUpcomingError] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const money = (value: number | null, currency: string) => value == null ? "—"
    : new Intl.NumberFormat(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 2 }).format(value) + " " + currency;
  const day = (value: string | null) => value ? new Date(value + "T00:00:00").toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
  const loadQueue = useCallback(() => getFinanceQueue(state).then(r => { setQueue(r); setQueueError(""); }).catch(e => { setQueue([]); setQueueError(problem(e, l)); }), [state, l]);
  const loadUpcoming = useCallback(() => getUpcomingMilestones(within).then(r => { setUpcoming(r); setUpcomingError(""); }).catch(e => { setUpcoming([]); setUpcomingError(problem(e, l)); }), [within, l]);
  const loadSummary = useCallback(() => getFinanceSummary().then(setSummary).catch(() => setSummary(null)), []);
  useEffect(() => { setQueue(null); void loadQueue(); }, [loadQueue]);
  useEffect(() => { setUpcoming(null); void loadUpcoming(); }, [loadUpcoming]);
  useEffect(() => { void loadSummary(); }, [loadSummary]);
  async function act(action: () => Promise<unknown>, ok?: string) {
    setBusy(true); setMessage(null);
    try { await action(); if (ok) setMessage({ kind: "ok", text: ok }); await Promise.all([loadQueue(), loadUpcoming(), loadSummary()]); }
    catch (e) { setMessage({ kind: "error", text: problem(e, l) }); if (e instanceof ApiError && e.statusCode === 409) await Promise.all([loadQueue(), loadUpcoming()]); }
    finally { setBusy(false); }
  }
  return <section className="page-enter finance-page">
    <div className="page-head"><div className="page-title"><span className="eyebrow">{l.eyebrow}</span><h1>{l.title}</h1><p>{l.hint}</p></div></div>
    <div className="finance-held" role="note"><LockKeyhole size={16}/><span>{l.held}</span><span className="system-map-decision" dir="ltr">D-06</span></div>
    {message && <div className={message.kind === "error" ? "error-banner" : "finance-ok"} role={message.kind === "error" ? "alert" : "status"}>
      {message.kind === "error" ? <CircleAlert size={17}/> : <Send size={16}/>}<span>{message.text}</span></div>}

    <section className="data-panel finance-summary" aria-labelledby="finance-summary-title">
      <h2 id="finance-summary-title"><Wallet size={17}/>{l.summary}</h2>
      {summary === null ? <p className="activity-empty">{l.loading}</p> : summary.rows.length === 0 ? <p className="activity-empty">{l.noMoney}</p>
        : summary.rows.map(r => <div key={r.currency} className="finance-currency"><dl className="finance-money" aria-label={r.currency}>
          <div><dt>{l.booked}</dt><dd>{summary.ordersPermitted ? money(r.booked, r.currency) : <small>{l.notPermitted}</small>}</dd></div>
          <div><dt>{l.requested}</dt><dd>{summary.requestsPermitted ? money(r.requested, r.currency) : <small>{l.notPermitted}</small>}</dd></div>
          <div><dt>{l.invoiced}</dt><dd>{summary.invoicesPermitted ? money(r.invoiced, r.currency) : <small>{l.notPermitted}</small>}</dd></div>
          <div><dt>{l.collected}</dt><dd>{summary.invoicesPermitted ? money(r.collected, r.currency) : <small>{l.notPermitted}</small>}</dd></div>
        </dl>
          {r.fxStatus && r.fxStatus !== "BASE" && summary.baseCurrency && <p className="finance-fx">
            {r.fxStatus === "OK" ? <>{l.inBase(summary.baseCurrency)}: {money(r.bookedInBase ?? null, summary.baseCurrency)} · {l.rateUsed(new Intl.NumberFormat(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 6 }).format(r.rate ?? 0), day(r.rateDate ?? null))}</>
              : <><TriangleAlert size={13}/>{l.fx[r.fxStatus]}</>}</p>}
        </div>)}
      {summary && summary.rows.length > 1 && summary.baseCurrency && (summary.totalInBase
        ? <dl className="finance-money finance-total" aria-label={l.total(summary.baseCurrency)}>
          <div><dt>{l.total(summary.baseCurrency)} · {l.booked}</dt><dd>{summary.ordersPermitted ? money(summary.totalInBase.booked, summary.baseCurrency) : <small>{l.notPermitted}</small>}</dd></div>
          <div><dt>{l.requested}</dt><dd>{summary.requestsPermitted ? money(summary.totalInBase.requested, summary.baseCurrency) : <small>{l.notPermitted}</small>}</dd></div>
          <div><dt>{l.invoiced}</dt><dd>{summary.invoicesPermitted ? money(summary.totalInBase.invoiced, summary.baseCurrency) : <small>{l.notPermitted}</small>}</dd></div>
          <div><dt>{l.collected}</dt><dd>{summary.invoicesPermitted ? money(summary.totalInBase.collected, summary.baseCurrency) : <small>{l.notPermitted}</small>}</dd></div>
        </dl> : <p className="finance-fx"><TriangleAlert size={13}/>{l.totalMissing}</p>)}
    </section>
    <FxPanel language={language} onChanged={() => void loadSummary()}/>

    <section className="data-panel" aria-labelledby="finance-queue-title">
      <div className="finance-head"><h2 id="finance-queue-title"><ReceiptText size={17}/>{l.queue}</h2>
        <div className="segmented" role="group">
          {(["open", "cancelled", "all"] as const).map(s => <button key={s} type="button" className={state === s ? "chosen" : ""} aria-pressed={state === s} onClick={() => setState(s)}>{l[s]}</button>)}
        </div></div>
      {queueError && <p className="daily-error"><CircleAlert size={15}/>{queueError}</p>}
      {queue === null ? <p className="activity-empty">{l.loading}</p> : queue.length === 0 ? !queueError && <p className="activity-empty">{l.emptyQueue}</p>
        : <ul className="finance-list">{queue.map(r => <li key={r.id} className={"finance-row" + (r.overdue ? " is-overdue" : "") + (r.status === "CANCELLED" ? " is-cancelled" : "")}>
          <div className="finance-main">
            <strong>{r.milestoneTitle ?? r.orderReference}</strong>
            <span className="finance-meta">
              <span dir="ltr">{r.orderReference}</span>
              {r.accountName && <span><Building2 size={12}/><a href={"#/accounts/" + r.accountId}>{r.accountName}</a></span>}
              <span><CalendarClock size={12}/>{l.due}: {day(r.dueDate)}{r.overdue && <b className="finance-late"> · {l.overdue}</b>}</span>
              <span><FileClock size={12}/>{l.by}: {r.mine ? l.you : r.requestedBy}{r.ageDays != null && ` · ${l.age(r.ageDays)}`}</span>
            </span>
          </div>
          <span className="finance-amount">{money(r.amountBeforeTax, r.currency)}</span>
          {r.status === "REQUESTED" ? <div className="finance-actions">
            <button type="button" className="btn btn-small btn-secondary finance-held-action" disabled={busy} onClick={() => void act(() => issueInvoice(r))}><LockKeyhole size={14}/>{l.issue}</button>
            <button type="button" className="icon-button" aria-label={`${l.cancel}: ${r.milestoneTitle ?? ""}`} disabled={busy}
              onClick={() => void act(() => cancelRequest(r), l.cancelledOk)}><Undo2 size={15}/></button>
          </div> : <span className="finance-status">{l.cancelled}</span>}
        </li>)}</ul>}
    </section>

    <section className="data-panel" aria-labelledby="finance-upcoming-title">
      <div className="finance-head"><h2 id="finance-upcoming-title"><CalendarClock size={17}/>{l.upcoming}</h2>
        <div className="segmented" role="group">
          {[7, 30, 90].map(n => <button key={n} type="button" className={within === n ? "chosen" : ""} aria-pressed={within === n} onClick={() => setWithin(n)}>{l.within(n)}</button>)}
        </div></div>
      {upcomingError && <p className="daily-error"><CircleAlert size={15}/>{upcomingError}</p>}
      {upcoming === null ? <p className="activity-empty">{l.loading}</p> : upcoming.length === 0 ? !upcomingError && <p className="activity-empty">{l.emptyUpcoming}</p>
        : <ul className="finance-list">{upcoming.map(m => <li key={m.id} className={"finance-row" + (m.overdue ? " is-overdue" : "")}>
          <div className="finance-main">
            <strong>{m.title ?? m.orderReference}</strong>
            <span className="finance-meta">
              <span dir="ltr">{m.orderReference}</span>
              {m.accountName && <span><Building2 size={12}/><a href={"#/accounts/" + m.accountId}>{m.accountName}</a></span>}
              <span className={m.overdue ? "finance-late" : ""}>{m.overdue && <TriangleAlert size={12}/>}{day(m.dueDate)} · {l.daysLeft(m.daysLeft)}</span>
            </span>
          </div>
          <span className="finance-amount">{money(m.amountBeforeTax, m.currency)}</span>
          <div className="finance-actions"><button type="button" className="btn btn-small btn-secondary" disabled={busy}
            onClick={() => void act(() => requestMilestoneInvoice(m), l.requestedOk)}><Send size={14}/>{l.request}</button></div>
        </li>)}</ul>}
    </section>
  </section>;
}
