import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Banknote, Building2, CalendarClock, CircleAlert, FileMinus, FileText, Save, TriangleAlert } from "lucide-react";
import { ApiError } from "./api";
import { Dialog } from "./Dialog";
import { getInvoiceReadiness, getInvoices, issueCreditNote, recordPayment, type FinanceInvoice } from "./financeApi";
import type { Language } from "./preferences";
import { amount, day as dayOf } from "./format";

const L = {
  ar: {
    title: "الفواتير الصادرة والتحصيل", due: "عليها فلوس", paid: "مدفوعة", all: "الكل", empty: "مفيش فواتير هنا.", loading: "جاري التحميل…",
    status: { DUE: "مستحقة", PARTLY_PAID: "مدفوعة جزئيًا", PAID: "مدفوعة" } as Record<string, string>,
    total: "الإجمالي", paidAmount: "اتدفع", remaining: "الباقي", credited: "إشعارات دائنة (قبل الضريبة)", dueOn: "تستحق", overdue: "متأخرة",
    record: "سجّل دفعة", credit: "إشعار دائن", payments: "الدفعات", creditNotes: "الإشعارات الدائنة", by: "سجّلها",
    payTitle: "تسجيل دفعة وصلت", payText: "سجّل بس الفلوس اللي وصلت فعلًا، بتاريخها ومرجع البنك أو الإيصال. الحسابات بتقيّدها وتسويها مع الفاتورة.",
    amount: "المبلغ", date: "تاريخ الوصول", reference: "مرجع البنك أو الإيصال",
    creditTitle: "إشعار دائن", creditText: "نسبة من الفاتورة (من كل سطر) بسبب واضح. بيتقيد في الحسابات ويتخصم من الفاتورة.",
    percent: "النسبة من الفاتورة %", reason: "السبب", save: "حفظ", saving: "جاري الحفظ…", cancel: "إلغاء",
    recordedOk: "اتسجلت الدفعة.", creditedOk: "اتعمل الإشعار الدائن.",
    missingTitle: "مش ممكن لسه. الناقص:",
    missing: { PAYMENT_MODE: "طريقة السداد على الفاتورة", PAYMENT_JOURNAL: "يومية البنك لطريقة السداد", PAYMENT_ACCOUNT: "حساب البنك لطريقة السداد",
      JOURNAL_SEQUENCE: "ترقيم اليومية", OPEN_PERIOD: "فترة مالية مفتوحة", JOURNAL_ACCOUNT: "اليومية لازم تسمح بالحساب", ACCOUNT_INACTIVE: "الحساب لازم يكون مفعّل",
      ACCOUNT_CONFIG: "إعداد الحسابات للشركة", CREDIT_NOTE_JOURNAL: "يومية الإشعارات الدائنة", CREDIT_NOTE_SEQUENCE: "ترقيم الإشعارات الدائنة",
      REFUND_PAYMENT_MODE: "طريقة رد الفلوس للعميل", RECONCILE_SEQUENCE: "ترقيم التسويات في الحسابات" } as Record<string, string>,
    errors: { RANGE: "راجع المبلغ أو النسبة أو التاريخ.", REQUIRED: "اكتب المرجع أو السبب.", ALREADY_PAID: "الفاتورة مدفوعة بالكامل.",
      INVOICE_STATE: "الفاتورة دي مش صادرة.", conflict: "الفاتورة اتغيرت من مكان تاني؛ اتحدّثت.", forbidden: "مش مسموح لك بالإجراء ده.", failed: "تعذّر تنفيذ الطلب." } as Record<string, string>,
  },
  en: {
    title: "Issued invoices & collection", due: "With money due", paid: "Paid", all: "All", empty: "No invoices here.", loading: "Loading…",
    status: { DUE: "Due", PARTLY_PAID: "Partly paid", PAID: "Paid" } as Record<string, string>,
    total: "Total", paidAmount: "Paid", remaining: "Remaining", credited: "Credit notes (before tax)", dueOn: "due", overdue: "Overdue",
    record: "Record a payment", credit: "Credit note", payments: "Payments", creditNotes: "Credit notes", by: "recorded by",
    payTitle: "Record a payment received", payText: "Record only money that has actually arrived, with its date and the bank or receipt reference. Accounting posts it and reconciles it with the invoice.",
    amount: "Amount", date: "Received on", reference: "Bank or receipt reference",
    creditTitle: "Credit note", creditText: "A share of the invoice (of each line) for a stated reason. It is posted and offset against the invoice.",
    percent: "Share of the invoice %", reason: "Reason", save: "Save", saving: "Saving…", cancel: "Cancel",
    recordedOk: "Payment recorded.", creditedOk: "Credit note issued.",
    missingTitle: "Not possible yet. Missing:",
    missing: { PAYMENT_MODE: "The payment mode on the invoice", PAYMENT_JOURNAL: "The bank journal of the payment mode", PAYMENT_ACCOUNT: "The bank account of the payment mode",
      JOURNAL_SEQUENCE: "The journal's numbering", OPEN_PERIOD: "An open fiscal period", JOURNAL_ACCOUNT: "The journal must allow the account", ACCOUNT_INACTIVE: "The account must be active",
      ACCOUNT_CONFIG: "The company's accounting configuration", CREDIT_NOTE_JOURNAL: "The credit-note journal", CREDIT_NOTE_SEQUENCE: "Credit-note numbering",
      REFUND_PAYMENT_MODE: "How money is refunded to the client", RECONCILE_SEQUENCE: "Numbering for reconciliations" } as Record<string, string>,
    errors: { RANGE: "Check the amount, share or date.", REQUIRED: "Give the reference or the reason.", ALREADY_PAID: "The invoice is fully paid.",
      INVOICE_STATE: "This invoice is not issued.", conflict: "The invoice changed elsewhere; it was refreshed.", forbidden: "You are not allowed to do this.", failed: "The request failed." } as Record<string, string>,
  },
};
type Labels = typeof L.ar;
type Message = { kind: "error" | "ok"; text: string; items?: string[] };

function problem(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.errors.failed;
  const code = error.code && error.code in l.errors ? error.code : error.fields?.[0]?.code ?? "";
  if (code in l.errors) return l.errors[code];
  if (error.statusCode === 409) return l.errors.conflict;
  if (error.statusCode === 403) return l.errors.forbidden;
  return l.errors.failed;
}

const today = () => new Date().toISOString().slice(0, 10);

/** D-06: issued invoices with what finance recorded as paid, what is still due and the credit notes; finance records and credits. */
export function InvoicesPanel({ language, onChanged }: { language: Language; onChanged?: () => void }) {
  const l = L[language], ar = language === "ar";
  const [state, setState] = useState<"due" | "paid" | "all">("due");
  const [rows, setRows] = useState<FinanceInvoice[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [dialog, setDialog] = useState<{ kind: "pay" | "credit"; invoice: FinanceInvoice } | null>(null);
  const load = useCallback(() => getInvoices(state).then(setRows).catch(e => {
    if (e instanceof ApiError && (e.statusCode === 403 || e.statusCode === 404)) setHidden(true); // no native read on invoices
    else { setRows([]); setMessage({ kind: "error", text: problem(e, l) }); }
  }), [state, l]);
  useEffect(() => { setRows(null); void load(); }, [load]);
  if (hidden) return null;
  const money = (value: number | null, currency: string) => amount(value, currency);
  const day = (value: string | null) => dayOf(value, ar);
  async function done(text: string) {
    setDialog(null); setMessage({ kind: "ok", text });
    await load(); onChanged?.();
  }
  return <section className="data-panel" aria-labelledby="finance-invoices-title">
    <div className="finance-head"><h2 id="finance-invoices-title"><FileText size={17}/>{l.title}</h2>
      <div className="segmented" role="group">
        {(["due", "paid", "all"] as const).map(s => <button key={s} type="button" className={state === s ? "chosen" : ""} aria-pressed={state === s} onClick={() => setState(s)}>{l[s]}</button>)}
      </div></div>
    {message && <p className={message.kind === "error" ? "daily-error" : "fx-ok"} role={message.kind === "error" ? "alert" : "status"}>
      {message.kind === "error" && <CircleAlert size={15}/>}{message.text}
      {message.items && <ul className="finance-missing">{message.items.map(i => <li key={i}>{i}</li>)}</ul>}</p>}
    {rows === null ? <p className="activity-empty">{l.loading}</p> : rows.length === 0 ? <p className="activity-empty">{l.empty}</p>
      : <ul className="finance-list">{rows.map(i => <li key={i.id} className={"finance-row finance-invoice-row" + (i.overdue ? " is-overdue" : "") + (i.status === "PAID" ? " is-paid" : "")}>
        <div className="finance-main">
          <strong dir="ltr">{i.number}</strong>
          <span className="finance-meta">
            {i.accountName && <span><Building2 size={12}/><a href={"#/accounts/" + i.accountId}>{i.accountName}</a></span>}
            <span><CalendarClock size={12}/>{l.dueOn} {day(i.dueDate)}{i.overdue && <b className="finance-late"> · {l.overdue}</b>}</span>
            <span className="finance-chip">{l.status[i.status]}</span>
          </span>
          <dl className="finance-figures">
            <div><dt>{l.total}</dt><dd>{money(i.totalWithTax, i.currency)}</dd></div>
            <div><dt>{l.paidAmount}</dt><dd>{money(i.paid, i.currency)}</dd></div>
            <div><dt>{l.remaining}</dt><dd>{money(i.remaining, i.currency)}</dd></div>
            {i.credited > 0 && <div><dt>{l.credited}</dt><dd>{money(i.credited, i.currency)}</dd></div>}
          </dl>
          {(i.payments.length > 0 || i.refunds.length > 0) && <details className="fx-history"><summary>{l.payments} / {l.creditNotes}</summary><ol>
            {i.payments.map(p => <li key={"p" + p.id}><span>{money(p.amount, i.currency)} · {day(p.date)}</span>
              <small dir="auto">{p.reference}{p.recordedBy && ` · ${l.by} ${p.recordedBy}`}</small></li>)}
            {i.refunds.map(c => <li key={"c" + c.id}><span><FileMinus size={12}/> <b dir="ltr">{c.number}</b> · {money(c.totalWithTax, i.currency)} · {day(c.date)}</span>
              {c.reason && <small>{c.reason}</small>}</li>)}
          </ol></details>}
        </div>
        <div className="finance-actions">
          {i.canRecordPayment && <button type="button" className="btn btn-small btn-primary" onClick={() => setDialog({ kind: "pay", invoice: i })}><Banknote size={14}/>{l.record}</button>}
          {i.canCredit && <button type="button" className="btn btn-small btn-secondary" onClick={() => setDialog({ kind: "credit", invoice: i })}><FileMinus size={14}/>{l.credit}</button>}
        </div>
      </li>)}</ul>}
    {dialog?.kind === "pay" && <PaymentDialog invoice={dialog.invoice} l={l} onClose={() => setDialog(null)} onDone={() => void done(l.recordedOk)}
      onBlocked={m => { setDialog(null); setMessage(m); }}/>}
    {dialog?.kind === "credit" && <CreditDialog invoice={dialog.invoice} l={l} onClose={() => setDialog(null)} onDone={() => void done(l.creditedOk)}
      onBlocked={m => { setDialog(null); setMessage(m); }}/>}
  </section>;
}

/** On ACCOUNTING_NOT_READY the dialog closes and the panel lists what is missing, from the readiness view. */
async function blocked(e: unknown, invoice: FinanceInvoice, purpose: "payment" | "credit", l: Labels): Promise<Message | null> {
  if (!(e instanceof ApiError) || e.code !== "ACCOUNTING_NOT_READY") return null;
  const ready = await getInvoiceReadiness(invoice, purpose).catch(() => null);
  return { kind: "error", text: l.missingTitle, items: (ready?.missing ?? []).map(m => (l.missing[m.code] ?? m.code) + (m.detail ? ` (${m.detail})` : "")) };
}

function PaymentDialog({ invoice, l, onClose, onDone, onBlocked }: {
  invoice: FinanceInvoice; l: Labels; onClose: () => void; onDone: () => void; onBlocked: (m: Message) => void;
}) {
  const [amount, setAmount] = useState(String(invoice.remaining));
  const [date, setDate] = useState(today());
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try { await recordPayment(invoice, { amount: Number(amount), paymentDate: date, reference: reference.trim() }); onDone(); }
    catch (failure) { const m = await blocked(failure, invoice, "payment", l); if (m) onBlocked(m); else setError(problem(failure, l)); }
    finally { setBusy(false); }
  }
  return <Dialog title={l.payTitle} description={l.payText} kicker={invoice.number ?? ""} busy={busy} onClose={onClose}
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="pay-form" className="btn btn-primary" disabled={busy || !amount || !reference.trim()}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="pay-form" className="daily-form" onSubmit={e => void submit(e)}>
      <label><span>{l.amount} ({invoice.currency})</span><input type="number" inputMode="decimal" min="0.01" step="0.01" max={invoice.remaining} required dir="ltr"
        value={amount} onChange={e => setAmount(e.target.value)}/></label>
      <label><span>{l.date}</span><input type="date" value={date} min={invoice.invoiceDate ?? undefined} max={today()} required onChange={e => setDate(e.target.value)}/></label>
      <label><span>{l.reference}</span><input value={reference} maxLength={120} required dir="auto" onChange={e => setReference(e.target.value)}/></label>
      {error && <p className="daily-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    </form>
  </Dialog>;
}

function CreditDialog({ invoice, l, onClose, onDone, onBlocked }: {
  invoice: FinanceInvoice; l: Labels; onClose: () => void; onDone: () => void; onBlocked: (m: Message) => void;
}) {
  const [percent, setPercent] = useState("100");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try { await issueCreditNote(invoice, { percent: Number(percent), reason: reason.trim() }); onDone(); }
    catch (failure) { const m = await blocked(failure, invoice, "credit", l); if (m) onBlocked(m); else setError(problem(failure, l)); }
    finally { setBusy(false); }
  }
  return <Dialog title={l.creditTitle} description={l.creditText} kicker={invoice.number ?? ""} busy={busy} onClose={onClose}
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="credit-form" className="btn btn-primary" disabled={busy || !percent || !reason.trim()}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="credit-form" className="daily-form" onSubmit={e => void submit(e)}>
      <label><span>{l.percent}</span><input type="number" inputMode="decimal" min="0.01" max="100" step="0.01" required dir="ltr" value={percent} onChange={e => setPercent(e.target.value)}/></label>
      <label><span>{l.reason}</span><textarea value={reason} rows={2} maxLength={500} required onChange={e => setReason(e.target.value)}/></label>
      {invoice.credited > 0 && <p className="fx-note"><TriangleAlert size={15}/>{l.credited}: {invoice.credited} {invoice.currency}</p>}
      {error && <p className="daily-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    </form>
  </Dialog>;
}
