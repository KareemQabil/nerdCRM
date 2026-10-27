import { useCallback, useEffect, useState } from "react";
import { CircleAlert, FileClock, History, LockKeyhole, Receipt, RefreshCcw, RotateCcw, Send, Undo2 } from "lucide-react";
import { ApiError, type Contract, type MilestonePlan, type Quote } from "./api";
import {
  cancelInvoiceRequest, getAccountSummary, getInvoiceRequests, getQuoteVersions, getReviews, renewContract, requestInvoice,
  requestChanges, requestReview, restoreQuoteVersion, saveQuoteVersion, withdrawReview,
  type AccountSummary360, type InvoiceRequest, type QuoteVersion, type Review, type ReviewReason,
} from "./workspaceApi";
import type { Language } from "./preferences";
import "./workflow.css";

const strings = {
  ar: {
    versions:"إصدارات العرض",current:"الإصدار الحالي",saveVersion:"حفظ كإصدار",restore:"استعادة",noVersions:"لا توجد إصدارات محفوظة",lines:"بنود",
    review:"المراجعة",requestReview:"طلب مراجعة",withdraw:"سحب الطلب",noReview:"لم تُطلب مراجعة بعد",
    status:{PENDING:"بانتظار المراجعة",CHANGES_REQUESTED:"مطلوب تعديل",WITHDRAWN:"مسحوب"},
    events:{REQUESTED:"طُلبت المراجعة",CHANGES_REQUESTED:"طُلب تعديل",WITHDRAWN:"سُحب الطلب"},
    reasons:{PRICING:"التسعير",SCOPE:"النطاق",TERMS:"الشروط",DOCUMENTS:"المستندات",OTHER:"سبب آخر"},
    reviewerTitle:"مراجعتك",reviewerHint:"أعِده لصاحبه مع سبب واضح، وسيصله إشعار داخل النظام.",reasonLabel:"سبب الإعادة",sendBack:"إعادة للتعديل",
    approve:"اعتماد",reject:"رفض",decisionNote:"قرار الاعتماد أو الرفض متوقف حتى اعتماد مصفوفة الموافقات (D-11).",
    forVersion:"للإصدار",invoiceRequests:"طلبات الفوترة",requestInvoice:"طلب فاتورة",cancel:"إلغاء الطلب",issue:"إصدار الفاتورة",
    requested:"مطلوب",cancelled:"ملغى",noRequests:"لا توجد طلبات فوترة",
    invoiceNote:"الطلب يُبلغ المالية فقط؛ إصدار الفاتورة في حسابات Axelor لسه جاي (D-06).",
    renew:"فتح فرصة تجديد",renewed:"فُتحت فرصة التجديد",openOpportunity:"فتح الفرصة",renewNote:"التجديد متاح لعقد ساري أو منتهٍ فقط.",
    summary:"الحساب عبر كل الأقسام",money:"المبالغ (قبل الضريبة)",moneyNote:"المراحل منفصلة ولا تُجمع؛ ما لا تملك صلاحية رؤيته يظهر \"—\".",
    sections:{OPPORTUNITIES:"الفرص",QUOTES:"عروض الأسعار",CONTRACTS:"العقود",HANDOVERS:"طلبات التسليم",ENGAGEMENTS:"المشروعات التنفيذية",CERTIFICATION_CYCLES:"دورات الاعتماد",TRAINING_ENROLLMENTS:"تسجيلات التدريب",JOB_ORDERS:"طلبات التوظيف",DONOR_PROFILE:"ملف المانح",FIELD_VISITS:"الزيارات الميدانية",QUALITY_ISSUES:"مشاكل الجودة"},
    stages:{quotedDraft:"عروض مسودة",bookedActive:"عقود سارية",invoiceRequested:"مطلوب فوترته",invoiced:"مُفوتر",collected:"محصّل"},
    loading:"جار التحميل...",
    errors:{NO_LINES:"أضف بندًا واحدًا على الأقل أولًا.",QUOTE_NOT_DRAFT:"عرض السعر ليس مسودة.",VERSION_UNKNOWN:"هذا الإصدار غير موجود.",REVIEW_PENDING:"توجد مراجعة قائمة بالفعل.",REVIEW_STATE:"لا يمكن تغيير هذه المراجعة الآن.",CONTRACT_NOT_DRAFT:"العقد ليس مسودة.",ORDER_NOT_CONFIRMED:"الفوترة متاحة لطلب بيع مؤكد فقط؛ تأكيد الطلب متوقف حتى اعتماد السياسات.",INVOICE_REQUEST_EXISTS:"توجد طلب فوترة مفتوح لهذه الدفعة.",ALREADY_INVOICED:"هذه الدفعة مُفوترة بالفعل.",REQUEST_STATE:"الطلب ملغى بالفعل.",CONTRACT_NOT_ACTIVE:"التجديد متاح لعقد ساري أو منتهٍ فقط.",RENEWAL_EXISTS:"لهذا العقد فرصة تجديد بالفعل.",BLOCKED_BY_POLICY:"متوقف حتى اعتماد السياسة.",conflict:"تم تعديل البيانات من مكان آخر؛ حدّثناها، أعد المحاولة.",denied:"ليست لديك صلاحية لهذا الإجراء.",failed:"تعذّر تنفيذ الطلب."},
  },
  en: {
    versions:"Quotation versions",current:"Current version",saveVersion:"Save as a version",restore:"Restore",noVersions:"No saved versions",lines:"lines",
    review:"Review",requestReview:"Request review",withdraw:"Withdraw",noReview:"No review requested yet",
    status:{PENDING:"Awaiting review",CHANGES_REQUESTED:"Changes requested",WITHDRAWN:"Withdrawn"},
    events:{REQUESTED:"Review requested",CHANGES_REQUESTED:"Changes requested",WITHDRAWN:"Withdrawn"},
    reasons:{PRICING:"Pricing",SCOPE:"Scope",TERMS:"Terms",DOCUMENTS:"Documents",OTHER:"Other"},
    reviewerTitle:"Your review",reviewerHint:"Send it back to its owner with a clear reason; they are told in the app.",reasonLabel:"Reason",sendBack:"Send back for changes",
    approve:"Approve",reject:"Reject",decisionNote:"Approving or rejecting waits for the approval matrix (D-11).",
    forVersion:"for version",invoiceRequests:"Invoice requests",requestInvoice:"Request invoice",cancel:"Cancel request",issue:"Issue invoice",
    requested:"Requested",cancelled:"Cancelled",noRequests:"No invoice requests",
    invoiceNote:"A request only informs finance; issuing the invoice in Axelor accounting comes next (D-06).",
    renew:"Open a renewal opportunity",renewed:"Renewal opportunity opened",openOpportunity:"Open the opportunity",renewNote:"Renewal is available for an active or closed contract only.",
    summary:"The account across every area",money:"Amounts (before tax)",moneyNote:"Stages are kept apart and never added; what you may not see shows \"—\".",
    sections:{OPPORTUNITIES:"Opportunities",QUOTES:"Quotations",CONTRACTS:"Contracts",HANDOVERS:"Handovers",ENGAGEMENTS:"Engagements",CERTIFICATION_CYCLES:"Certification cycles",TRAINING_ENROLLMENTS:"Training enrolments",JOB_ORDERS:"Job orders",DONOR_PROFILE:"Donor profile",FIELD_VISITS:"Field visits",QUALITY_ISSUES:"Quality issues"},
    stages:{quotedDraft:"Draft quotations",bookedActive:"Active contracts",invoiceRequested:"Invoice requested",invoiced:"Invoiced",collected:"Collected"},
    loading:"Loading...",
    errors:{NO_LINES:"Add at least one line first.",QUOTE_NOT_DRAFT:"The quotation is not a draft.",VERSION_UNKNOWN:"This version does not exist.",REVIEW_PENDING:"A review is already pending.",REVIEW_STATE:"This review cannot change now.",CONTRACT_NOT_DRAFT:"The contract is not a draft.",ORDER_NOT_CONFIRMED:"Invoicing is for a confirmed order only; confirming orders waits for the policies.",INVOICE_REQUEST_EXISTS:"This milestone already has an open invoice request.",ALREADY_INVOICED:"This milestone is already invoiced.",REQUEST_STATE:"The request is already cancelled.",CONTRACT_NOT_ACTIVE:"Renewal is available for an active or closed contract only.",RENEWAL_EXISTS:"This contract already has a renewal opportunity.",BLOCKED_BY_POLICY:"Blocked until the policy is signed.",conflict:"The data changed elsewhere; it is refreshed, try again.",denied:"You do not have permission for this action.",failed:"The request failed."},
  },
} as const;
type Labels = typeof strings.ar | typeof strings.en;

function message(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.errors.failed;
  const known = error.code && (l.errors as Record<string, string>)[error.code];
  if (known) return known;
  if (error.statusCode === 409) return l.errors.conflict;
  if (error.statusCode === 403 || error.statusCode === 404) return l.errors.denied;
  return l.errors.failed;
}
const amount = (value: string | number | null | undefined, currency: string | null) =>
  value === null || value === undefined ? "—" : `${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency ?? ""}`;
const stamp = (value: string | null) => value ? value.replace("T", " ").slice(0, 16) : "—";

function useRun(l: Labels, after: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = useCallback(async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(message(e, l)); } finally { setBusy(false); after(); }
  }, [busy, l, after]);
  return { busy, error, run };
}

function ReviewBox({ reviews, subject, version, editable, l, run, busy }: {
  reviews: Review[]; subject: { quoteId?: number; contractId?: number }; version: number; editable: boolean; l: Labels;
  run: (a: () => Promise<unknown>) => Promise<void>; busy: boolean;
}) {
  const latest = reviews[0] ?? null;
  return <div className="wf-block">
    <h4><History size={16}/>{l.review}</h4>
    {!latest ? <p className="wf-muted">{l.noReview}</p> : <div className="wf-review">
      <span className={"wf-status wf-status-" + latest.status.toLowerCase()}>{l.status[latest.status]}</span>
      {latest.quoteVersionNumber != null && <span className="wf-muted">{l.forVersion} {latest.quoteVersionNumber}</span>}
      {latest.reason && <span className="wf-muted">· {l.reasons[latest.reason]}</span>}
      <ol className="wf-trail">{reviews.flatMap(r => r.events.map((e, i) => <li key={r.id + ":" + i}>
        <strong>{l.events[e.kind]}</strong>{e.reason ? ` · ${l.reasons[e.reason]}` : ""}<small>{e.actorName ?? "—"} · <span dir="ltr">{stamp(e.at)}</span></small></li>))}</ol>
    </div>}
    {editable && <div className="lead-actions">
      {(!latest || latest.status !== "PENDING") && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run(() => requestReview(subject, version))}><Send size={15}/>{l.requestReview}</button>}
      {latest?.status === "PENDING" && latest.requestedByMe && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run(() => withdrawReview(latest.id, latest.version))}><Undo2 size={15}/>{l.withdraw}</button>}
      <button type="button" className="btn btn-secondary" disabled aria-describedby="wf-decision-note">{l.approve}</button>
      <button type="button" className="btn btn-secondary" disabled aria-describedby="wf-decision-note">{l.reject}</button>
    </div>}
    {latest?.status === "PENDING" && !latest.requestedByMe && <ReviewerActions review={latest} l={l} run={run} busy={busy}/>}
    <p className="record-security-note" id="wf-decision-note"><LockKeyhole size={15}/>{l.decisionNote}</p>
  </div>;
}

/** What a reviewer can do today: send the record back with a reason. Approval itself waits for D-11. */
function ReviewerActions({ review, l, run, busy }: { review: Review; l: Labels; run: (a: () => Promise<unknown>) => Promise<void>; busy: boolean }) {
  const [reason, setReason] = useState<ReviewReason>("PRICING");
  return <form className="wf-reviewer" onSubmit={e => { e.preventDefault(); void run(() => requestChanges(review.id, review.version, reason)); }}>
    <strong>{l.reviewerTitle}</strong><p className="wf-muted">{l.reviewerHint}</p>
    <div className="lead-actions">
      <label className="wf-inline-field">{l.reasonLabel}
        <select value={reason} onChange={e => setReason(e.target.value as ReviewReason)}>
          {(Object.keys(l.reasons) as ReviewReason[]).map(r => <option key={r} value={r}>{l.reasons[r]}</option>)}
        </select></label>
      <button type="submit" className="btn btn-primary" disabled={busy}><Undo2 size={15}/>{l.sendBack}</button>
    </div>
  </form>;
}

/** Versions and review of a quotation; the quotation reloads after every change. */
export function QuoteWorkflow({ quote, language, onChanged }: { quote: Quote & { versionNumber?: number | null }; language: Language; onChanged: () => void }) {
  const l = strings[language];
  const [versions, setVersions] = useState<QuoteVersion[] | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const load = useCallback(() => {
    void getQuoteVersions(quote.id).then(setVersions).catch(() => setVersions([]));
    void getReviews({ quoteId: quote.id }).then(setReviews).catch(() => setReviews([]));
  }, [quote.id]);
  useEffect(load, [load, quote.version]);
  const { busy, error, run } = useRun(l, () => { load(); onChanged(); });
  const draft = quote.status === "DRAFT";
  return <section className="wf-panel" aria-label={l.versions}>
    {error && <div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    <div className="wf-block">
      <h4><FileClock size={16}/>{l.versions} <span className="wf-muted">· {l.current}: {quote.versionNumber ?? 1}</span></h4>
      {versions === null ? <p className="wf-muted">{l.loading}</p> : versions.length === 0 ? <p className="wf-muted">{l.noVersions}</p>
        : <ul className="wf-list">{versions.map(v => <li key={v.number}><span><strong>{v.number}</strong> · <span dir="ltr">{stamp(v.savedAt)}</span> · {v.lines} {l.lines} · <span dir="ltr">{amount(v.totalBeforeTax, quote.currency)}</span></span>
          {draft && <button type="button" className="text-action" disabled={busy} onClick={() => void run(() => restoreQuoteVersion(quote.id, v.number, quote.version))}><RotateCcw size={14}/>{l.restore}</button>}</li>)}</ul>}
      {draft && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run(() => saveQuoteVersion(quote.id, quote.version))}><FileClock size={15}/>{l.saveVersion}</button>}
    </div>
    <ReviewBox reviews={reviews} subject={{ quoteId: quote.id }} version={quote.version} editable={draft} l={l} run={run} busy={busy}/>
  </section>;
}

/** Review and renewal of a contract. */
export function ContractWorkflow({ contract, language, onChanged }: { contract: Contract; language: Language; onChanged: () => void }) {
  const l = strings[language];
  const [reviews, setReviews] = useState<Review[]>([]);
  const [renewal, setRenewal] = useState<number | null>(null);
  const load = useCallback(() => { void getReviews({ contractId: contract.id }).then(setReviews).catch(() => setReviews([])); }, [contract.id]);
  useEffect(load, [load, contract.version]);
  const { busy, error, run } = useRun(l, () => { load(); onChanged(); });
  const renewable = contract.status === "ACTIVE" || contract.status === "CLOSED";
  return <section className="wf-panel" aria-label={l.review}>
    {error && <div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    <ReviewBox reviews={reviews} subject={{ contractId: contract.id }} version={contract.version} editable={contract.status === "DRAFT"} l={l} run={run} busy={busy}/>
    <div className="wf-block">
      {renewal != null ? <p className="wf-ok"><RefreshCcw size={15}/>{l.renewed} · <a href={"#/opportunities/" + renewal}>{l.openOpportunity}</a></p>
        : <button type="button" className="btn btn-secondary" disabled={busy || !renewable} aria-describedby="wf-renew-note"
          onClick={() => void run(async () => { const r = await renewContract(contract.id, contract.version); setRenewal(r.opportunityId); })}><RefreshCcw size={15}/>{l.renew}</button>}
      {!renewable && <small id="wf-renew-note" className="wf-muted">{l.renewNote}</small>}
    </div>
  </section>;
}

/** Invoice requests for the milestones of an order; issuing the invoice is D-06. */
export function InvoiceRequests({ plan, language, onChanged }: { plan: MilestonePlan; language: Language; onChanged: () => void }) {
  const l = strings[language];
  const [rows, setRows] = useState<InvoiceRequest[]>([]);
  const load = useCallback(() => { void getInvoiceRequests(plan.quoteId).then(setRows).catch(() => setRows([])); }, [plan.quoteId]);
  useEffect(load, [load, plan.quoteVersion]);
  const { busy, error, run } = useRun(l, () => { load(); onChanged(); });
  const open = new Set(rows.filter(r => r.status === "REQUESTED").map(r => r.milestoneId));
  return <div className="wf-block" aria-label={l.invoiceRequests}>
    <h4><Receipt size={16}/>{l.invoiceRequests}</h4>
    {error && <div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {plan.milestones.length > 0 && <div className="lead-actions">{plan.milestones.filter(m => !open.has(m.id)).map(m =>
      <button key={m.id} type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run(() => requestInvoice(m.id, plan.quoteVersion))}>
        <Receipt size={15}/>{l.requestInvoice}: {m.title}</button>)}</div>}
    {rows.length === 0 ? <p className="wf-muted">{l.noRequests}</p> : <ul className="wf-list">{rows.map(r => <li key={r.id}>
      <span><strong>{r.milestoneTitle}</strong> · <span dir="ltr">{amount(r.amountBeforeTax, r.currency)}</span> · {r.status === "REQUESTED" ? l.requested : l.cancelled} · {r.requestedBy ?? "—"}</span>
      {r.status === "REQUESTED" && <span className="lead-actions">
        <button type="button" className="text-action" disabled={busy} onClick={() => void run(() => cancelInvoiceRequest(r.id, r.version))}>{l.cancel}</button>
        <button type="button" className="text-action" disabled aria-describedby="wf-invoice-note">{l.issue}</button></span>}</li>)}</ul>}
    <p className="record-security-note" id="wf-invoice-note"><LockKeyhole size={15}/>{l.invoiceNote}</p>
  </div>;
}

/** Account 360 summary: only the areas the caller may read, money stages kept apart. */
export function AccountSummary({ accountId, language }: { accountId: number; language: Language }) {
  const l = strings[language];
  const [data, setData] = useState<AccountSummary360 | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { let live = true; setData(null); setFailed(false);
    getAccountSummary(accountId).then(d => { if (live) setData(d); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; }; }, [accountId]);
  if (failed) return null;
  if (!data) return <div className="empty-state" role="status">{l.loading}</div>;
  const links: Record<string, string> = { OPPORTUNITIES: "#/opportunities", HANDOVERS: "#/operations", ENGAGEMENTS: "#/operations/engagements",
    CERTIFICATION_CYCLES: "#/certification", TRAINING_ENROLLMENTS: "#/training", JOB_ORDERS: "#/recruitment", DONOR_PROFILE: "#/fundraising/donors",
    FIELD_VISITS: "#/visits", QUALITY_ISSUES: "#/quality" };
  return <section className="wf-summary" aria-label={l.summary}>
    <h3>{l.summary}</h3>
    <ul className="wf-cards">{data.sections.map(s => <li key={s.key}>
      {links[s.key] ? <a href={links[s.key]}><strong>{s.count}</strong><span>{(l.sections as Record<string, string>)[s.key] ?? s.key}</span></a>
        : <div><strong>{s.count}</strong><span>{(l.sections as Record<string, string>)[s.key] ?? s.key}</span></div>}</li>)}</ul>
    {data.money.length > 0 && <><h4>{l.money}</h4><div className="table-scroll"><table className="quote-lines wf-money">
      <thead><tr><th>{l.money}</th>{(Object.keys(l.stages) as (keyof Labels["stages"])[]).map(k => <th key={k}>{l.stages[k]}</th>)}</tr></thead>
      <tbody>{data.money.map(m => <tr key={m.currency}><td dir="ltr">{m.currency}</td>
        {(Object.keys(l.stages) as (keyof Labels["stages"])[]).map(k => <td key={k} dir="ltr">{amount(m[k], null)}</td>)}</tr>)}</tbody>
    </table></div><p className="wf-muted">{l.moneyNote}</p></>}
  </section>;
}
