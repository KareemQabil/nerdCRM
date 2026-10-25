import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, CircleAlert, FileSignature, LockKeyhole, Send } from "lucide-react";
import { ApiError, type Contract, type Quote } from "./api";
import { getDocuments, revisionUrl, type RecordDocument } from "./contentApi";
import { DocumentsPanel } from "./DocumentsPanel";
import { requestHandover } from "./operationsApi";
import { acceptQuote, activateContract } from "./workspaceApi";
import type { Language } from "./preferences";

/**
 * D-11 (signed 2026-10-25): binding commitments on uploaded evidence. The client's acceptance of a finalized quotation
 * (a signed copy or a purchase order filed on the quotation) confirms the order; a contract is activated on its signed
 * copy, filed on the contract, by the role the business line's signatory policy names. Evidence is chosen from the
 * documents filed on the record; the server pins the revision and checks everything again.
 */
const strings = {
  ar: {
    acceptTitle:"قبول العميل",acceptHint:"ارفع العرض الموقّع أو أمر الشراء في المستندات تحت، وبعدين سجّل القبول. تسجيله بيأكد أمر البيع في Axelor.",
    kind:"القبول بـ",kinds:{SIGNED_QUOTE:"عرض سعر موقّع",PURCHASE_ORDER:"أمر شراء"},reference:"رقم أمر الشراء",acceptedOn:"تاريخ القبول",
    evidence:"المستند الدليل",chooseEvidence:"اختار مستند",noEvidence:"لسه مفيش مستندات على السجل ده؛ ارفع الدليل الأول.",
    record:"سجّل القبول",recording:"جار التسجيل...",
    accepted:(kind:string,on:string,by:string)=>`العميل قبل (${kind}) في ${on}، سجّله ${by}.`,po:"أمر شراء رقم",
    activationTitle:"التوقيع والتفعيل",activationHint:"ارفع نسخة العقد الموقّعة في المستندات تحت، وبعدين فعّل العقد.",
    signedOn:"تاريخ التوقيع",startOn:"تاريخ البدء (اختياري)",activate:"فعّل العقد",activating:"جار التفعيل...",
    signed:(on:string,by:string,at:string)=>`اتوقّع في ${on}، وفعّله ${by} في ${at}.`,activeBefore:"العقد ساري (اتفعّل قبل قرار D-11).",
    policyNotSet:"مالك السياسات لسه ما حددش مين يفعّل عقود خط الأعمال ده (D-11).",
    notSignatory:(role:string)=>`عقود خط الأعمال ده بيفعّلها ${role}. تقدر ترفع النسخة الموقّعة وهو يفعّل.`,
    roles:{SALES_MANAGER:"مدير المبيعات",GM:"المدير العام"},
    handover:"اطلب التسليم لفريق التنفيذ",handoverDone:"اتبعت طلب التسليم لفريق التنفيذ.",openOperations:"فتح التشغيل",
    document:"المستند",revision:"إصدار",
    errors:{QUOTE_NOT_FINALIZED:"العرض لازم يكون نهائي.",QUOTE_EXPIRED:"العرض ما كانش ساري في التاريخ ده.",CONTRACT_NOT_DRAFT:"العقد مش مسودة.",
      NOT_SIGNATORY:"العقود دي بيفعّلها دور تاني.",POLICY_NOT_SET:"سياسة لازمة لسه مش متحددة.",HANDOVER_EXISTS:"فيه طلب تسليم مفتوح أو مقبول للعقد ده.",
      CHECKLIST_NOT_CONFIGURED:"خط الأعمال ده مالوش قائمة تسليم لسه.",documentId:"اختار مستند مرفوع على السجل ده.",reference:"اكتب رقم أمر الشراء.",
      acceptedOn:"تاريخ القبول بين تاريخ اعتماد العرض والنهارده.",signedOn:"تاريخ التوقيع مينفعش يكون في المستقبل.",startOn:"تاريخ البدء بين تاريخ التوقيع والنهارده.",
      conflict:"السجل اتغير من مكان تاني؛ حدّثنا البيانات، جرّب تاني.",denied:"مالكش صلاحية للإجراء ده.",failed:"تعذّر تنفيذ الطلب."},
  },
  en: {
    acceptTitle:"Client acceptance",acceptHint:"File the signed quotation or purchase order under Documents below, then record the acceptance. Recording it confirms the sales order in Axelor.",
    kind:"Accepted with",kinds:{SIGNED_QUOTE:"Signed quotation",PURCHASE_ORDER:"Purchase order"},reference:"Purchase order number",acceptedOn:"Accepted on",
    evidence:"Evidence document",chooseEvidence:"Choose a document",noEvidence:"No documents on this record yet; file the evidence first.",
    record:"Record acceptance",recording:"Recording...",
    accepted:(kind:string,on:string,by:string)=>`The client accepted (${kind}) on ${on}; recorded by ${by}.`,po:"Purchase order",
    activationTitle:"Signature and activation",activationHint:"File the signed copy of the contract under Documents below, then activate it.",
    signedOn:"Signed on",startOn:"Starts on (optional)",activate:"Activate contract",activating:"Activating...",
    signed:(on:string,by:string,at:string)=>`Signed on ${on}; activated by ${by} on ${at}.`,activeBefore:"The contract is active (activated before D-11).",
    policyNotSet:"The policy owners have not set who activates this business line's contracts yet (D-11).",
    notSignatory:(role:string)=>`This business line's contracts are activated by the ${role}. You can file the signed copy for them.`,
    roles:{SALES_MANAGER:"sales manager",GM:"general manager"},
    handover:"Request handover to operations",handoverDone:"Handover requested from operations.",openOperations:"Open operations",
    document:"Document",revision:"revision",
    errors:{QUOTE_NOT_FINALIZED:"The quotation has to be finalized.",QUOTE_EXPIRED:"The quotation was not valid on that date.",CONTRACT_NOT_DRAFT:"The contract is not a draft.",
      NOT_SIGNATORY:"Another role activates these contracts.",POLICY_NOT_SET:"A required policy is not set yet.",HANDOVER_EXISTS:"This contract already has an open or accepted handover.",
      CHECKLIST_NOT_CONFIGURED:"This business line has no handover checklist yet.",documentId:"Choose a document filed on this record.",reference:"Give the purchase order number.",
      acceptedOn:"The acceptance date is between the finalizing date and today.",signedOn:"The signature date cannot be in the future.",startOn:"The start date is between the signature date and today.",
      conflict:"The record changed elsewhere; the data is refreshed, try again.",denied:"You do not have permission for this action.",failed:"The request failed."},
  },
} as const;
type Labels = typeof strings.ar | typeof strings.en;

function message(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.errors.failed;
  const errors = l.errors as Record<string, string>;
  const field = error.fields[0]?.field;
  if (field && errors[field]) return errors[field];
  if (error.code && errors[error.code]) return errors[error.code];
  if (error.statusCode === 409) return l.errors.conflict;
  if (error.statusCode === 403 || error.statusCode === 404) return l.errors.denied;
  return l.errors.failed;
}
const today = () => new Date().toISOString().slice(0, 10);
const stamp = (value: string | null | undefined) => value ? value.replace("T", " ").slice(0, 16) : "—";

function useEvidence(subject: "QUOTE" | "CONTRACT", subjectId: number) {
  const [docs, setDocs] = useState<RecordDocument[]>([]);
  const load = useCallback(() => { void getDocuments(subject, subjectId).then(setDocs).catch(() => setDocs([])); }, [subject, subjectId]);
  useEffect(load, [load]);
  return { docs: docs.filter(d => !d.archived && d.currentRevision != null), reload: load };
}

function EvidenceLink({ documentId, revision, l }: { documentId: number | null | undefined; revision: number | null | undefined; l: Labels }) {
  if (documentId == null || revision == null) return null;
  return <a className="text-action" href={revisionUrl(documentId, revision)} target="_blank" rel="noopener noreferrer">
    {l.document} #{documentId} · {l.revision} {revision}</a>;
}

/** A finalized quotation: record the client's acceptance on its evidence; once accepted, what it was accepted on. */
export function QuoteAcceptance({ quote, language, onChanged }: { quote: Quote; language: Language; onChanged: () => void }) {
  const l = strings[language];
  const accepted = quote.approval?.acceptance ?? null;
  const open = quote.status === "FINALIZED" && !quote.approval?.expired;
  const { docs, reload } = useEvidence("QUOTE", quote.id);
  const [kind, setKind] = useState<"SIGNED_QUOTE" | "PURCHASE_ORDER">("SIGNED_QUOTE");
  const [reference, setReference] = useState("");
  const [acceptedOn, setAcceptedOn] = useState(today());
  const [documentId, setDocumentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!accepted && !open) return null;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try { await acceptQuote(quote, { kind, reference, acceptedOn, documentId: Number(documentId) }); onChanged(); }
    catch (err) { setError(message(err, l)); if (err instanceof ApiError && err.statusCode === 409) onChanged(); }
    finally { setBusy(false); }
  }
  return <div className="commitment" aria-labelledby={`accept-${quote.id}`}>
    <h3 id={`accept-${quote.id}`}><BadgeCheck size={17}/>{l.acceptTitle}</h3>
    {accepted ? <p className="quote-approval-note is-ok" role="status">
      {l.accepted(l.kinds[accepted.kind as keyof Labels["kinds"]] ?? accepted.kind, accepted.acceptedOn, accepted.recordedBy ?? "—")}
      {accepted.reference ? ` · ${l.po} ${accepted.reference}` : ""} <EvidenceLink documentId={accepted.documentId} revision={accepted.documentRevision} l={l}/></p>
    : <>
      <p className="wf-muted">{l.acceptHint}</p>
      {error && <div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
      <form className="commitment-form" onSubmit={submit} aria-label={l.acceptTitle}>
        <label><span>{l.kind}</span><select value={kind} onChange={e => setKind(e.target.value as typeof kind)}>
          {(Object.keys(l.kinds) as (keyof Labels["kinds"])[]).map(k => <option key={k} value={k}>{l.kinds[k]}</option>)}</select></label>
        {kind === "PURCHASE_ORDER" && <label><span>{l.reference}</span><input value={reference} maxLength={100} required onChange={e => setReference(e.target.value)}/></label>}
        <label><span>{l.acceptedOn}</span><input type="date" value={acceptedOn} max={today()} required onChange={e => setAcceptedOn(e.target.value)}/></label>
        <label><span>{l.evidence}</span><select value={documentId} required onChange={e => setDocumentId(e.target.value)}>
          <option value="">{docs.length ? l.chooseEvidence : l.noEvidence}</option>
          {docs.map(d => <option key={d.id} value={d.id}>{d.title} · {l.revision} {d.currentRevision}</option>)}</select></label>
        <button type="submit" className="btn btn-primary" disabled={busy || !documentId}><Send size={15}/>{busy ? l.recording : l.record}</button>
      </form>
      <DocumentsPanel subject="QUOTE" subjectId={quote.id} language={language} onChanged={reload} defaultKind="EVIDENCE"/>
    </>}
  </div>;
}

/** A contract's signature and activation (D-11), and the handover request to operations once it is active. */
export function ContractActivation({ contract, language, onChanged }: { contract: Contract; language: Language; onChanged: () => void }) {
  const l = strings[language];
  const a = contract.activation ?? null;
  const { docs, reload } = useEvidence("CONTRACT", contract.id);
  const [signedOn, setSignedOn] = useState(today());
  const [startOn, setStartOn] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [handedOver, setHandedOver] = useState(false);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); onChanged(); }
    catch (err) { setError(message(err, l)); if (err instanceof ApiError && err.statusCode === 409) onChanged(); }
    finally { setBusy(false); }
  }
  const role = (code: string | null | undefined) => code ? ((l.roles as Record<string, string>)[code] ?? code) : "—";
  const active = a?.status === "SIGNED" || a?.status === "ACTIVE";
  return <div className="commitment" aria-labelledby={`activation-${contract.id}`}>
    <h3 id={`activation-${contract.id}`}><FileSignature size={17}/>{l.activationTitle}</h3>
    {error && <div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {a?.status === "SIGNED" && <p className="quote-approval-note is-ok" role="status">
      {l.signed(a.signedOn ?? "—", a.activatedBy ?? "—", stamp(a.activatedAt))} <EvidenceLink documentId={a.documentId} revision={a.documentRevision} l={l}/></p>}
    {a?.status === "ACTIVE" && <p className="quote-approval-note is-ok" role="status">{l.activeBefore}</p>}
    {active && contract.status === "ACTIVE" && (handedOver
      ? <p className="wf-ok">{l.handoverDone} · <a href="#/operations">{l.openOperations}</a></p>
      : <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run(async () => { await requestHandover(contract.id); setHandedOver(true); })}>{l.handover}</button>)}
    {!active && contract.status === "DRAFT" && <>
      {a?.status === "POLICY_NOT_SET" && <p className="record-security-note"><LockKeyhole size={15}/>{l.policyNotSet}</p>}
      {a?.status === "NOT_SIGNATORY" && <p className="record-security-note"><LockKeyhole size={15}/>{l.notSignatory(role(a.signatory))}</p>}
      {a?.status === "READY" && <>
        <p className="wf-muted">{l.activationHint}</p>
        <form className="commitment-form" aria-label={l.activationTitle}
          onSubmit={e => { e.preventDefault(); void run(() => activateContract(contract, { signedOn, startOn: startOn || undefined, documentId: Number(documentId) })); }}>
          <label><span>{l.signedOn}</span><input type="date" value={signedOn} max={today()} required onChange={e => setSignedOn(e.target.value)}/></label>
          <label><span>{l.startOn}</span><input type="date" value={startOn} min={signedOn} max={today()} onChange={e => setStartOn(e.target.value)}/></label>
          <label><span>{l.evidence}</span><select value={documentId} required onChange={e => setDocumentId(e.target.value)}>
            <option value="">{docs.length ? l.chooseEvidence : l.noEvidence}</option>
            {docs.map(d => <option key={d.id} value={d.id}>{d.title} · {l.revision} {d.currentRevision}</option>)}</select></label>
          <button type="submit" className="btn btn-primary" disabled={busy || !documentId}><FileSignature size={15}/>{busy ? l.activating : l.activate}</button>
        </form>
      </>}
      <DocumentsPanel subject="CONTRACT" subjectId={contract.id} language={language} onChanged={reload} defaultKind="CONTRACT"/>
    </>}
  </div>;
}
