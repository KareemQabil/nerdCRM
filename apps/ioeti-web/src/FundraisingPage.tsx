import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, CircleAlert, CircleDashed, FileLock2, HandCoins, History,
  LockKeyhole, Plus, RefreshCw, Search, UserRound, Wallet,
} from "lucide-react";
import { ApiError, getAccounts, type AccountSummary } from "./api";
import {
  addDeliverable, advanceDeliverable, approveOpportunity, archiveOpportunity, cancelInstallment, createDonor, createOpportunity,
  getCampaigns, getCollections, getCollectionStatus, getCommitment, getDeliverables, getDonor, getDonors, getInstallments,
  getOpportunities, getOpportunity, getOverview, getTimeline, moveOpportunity, recordActivity, recordCollection, renewOpportunity,
  saveSensitive, scheduleInstallment, voidCollection,
  type Campaign, type CollectionRecord, type CollectionState, type Commitment, type Deliverable, type Donor, type DonorType,
  type Installment, type InstallmentStatus, type Money, type MoneyTotals, type Opportunity, type Overview, type Stage, type TimelineEvent,
} from "./fundraisingApi";
import type { Language } from "./preferences";
import "./fundraising.css";
import { amount } from "./format";
import { ErrorBanner, PageHeader } from "./ui";

const strings = {
  ar: {
    title:"التمويل والشراكات",desc:"المانحون والمنح والتعهدات وجداول السداد والتحصيل الفعلي والإشراف على العلاقة، ضمن صلاحياتك.",
    tabs:{overview:"نظرة عامة",donors:"المانحون",pipeline:"المنح والتعهدات",collections:"حالة التحصيل"},
    loading:"جار التحميل...",retry:"إعادة المحاولة",search:"بحث",open:"فتح",back:"العودة إلى التمويل",save:"حفظ",cancel:"إلغاء",empty:"لا يوجد",
    money:{proposed:"مقترح",committed:"ملتزم به",scheduled:"مجدول",collected:"محصّل فعليًا",outstanding:"متبقٍ للتحصيل",restrictedCommitted:"ملتزم مقيّد",unscheduled:"غير مجدول"},
    moneyNote:"المبالغ منفصلة ولا تُجمع معًا: التعهد ليس تحصيلًا، ولا تُجمع العملات المختلفة.",noMoney:"لا توجد مبالغ مسجلة بعد",
    stages:{IDENTIFIED:"محدد",PROPOSAL:"إعداد المقترح",SUBMITTED:"مقدم للمانح",APPROVED:"معتمد",DECLINED:"مرفوض",WITHDRAWN:"مسحوب"},
    attention:"تحتاج متابعة (متأخرة أو مستحقة خلال 30 يومًا)",noAttention:"لا توجد أقساط تحتاج متابعة",
    states:{DUE:"مستحق",PARTIAL:"محصل جزئيًا",OVERDUE:"متأخر",COLLECTED:"محصّل",CANCELLED:"ملغى"},allStates:"كل الحالات",
    donors:"المانحون",newDonor:"مانح جديد",searchDonors:"ابحث باسم المانح",noDonors:"لا يوجد مانحون",account:"الحساب",chooseAccount:"اختر الحساب",
    donorType:"نوع المانح",types:{INDIVIDUAL:"فرد",FOUNDATION:"مؤسسة",CORPORATE:"شركة",GOVERNMENT:"جهة حكومية",MULTILATERAL:"جهة دولية"},
    anonymous:"طلب عدم ذكر اسمه",anonymousDonor:"مانح مجهول الاسم",manager:"مسؤول العلاقة",openOpps:"فرص مفتوحة",
    sensitiveTitle:"بيانات المانح الحساسة",onFile:"مسجلة (لا تُعرض)",notOnFile:"غير مسجلة",
    sensitiveNote:"القدرة المتوقعة على العطاء وتفضيل التواصل وملاحظة العلاقة تُسجل ولا تُعرض. قراءتها متوقفة حتى اعتماد D-05 وD-07.",
    capacity:"القدرة المتوقعة على العطاء",preference:"تفضيل التواصل",note:"ملاحظة العلاقة",saveSensitive:"تسجيل البيانات الحساسة",
    opportunities:"فرص التمويل",newOpp:"فرصة تمويل جديدة",reference:"المرجع",oppTitle:"العنوان",purpose:"البرنامج أو الغرض",kind:"النوع",
    kinds:{GRANT:"منحة",DONATION:"تبرع",SPONSORSHIP:"رعاية"},proposed:"المبلغ المقترح",currency:"العملة",deadline:"الموعد النهائي",
    campaign:"الحملة",noCampaign:"بدون حملة",searchOpps:"ابحث بالمرجع أو العنوان",allCampaigns:"كل الحملات",noOpps:"لا توجد فرص تمويل",
    stewardship:"الإشراف على العلاقة",activity:"النشاط",activities:{THANK_YOU:"شكر",IMPACT_REPORT:"تقرير أثر",MEETING:"اجتماع",VISIT:"زيارة",CALL:"مكالمة"},
    occurredOn:"التاريخ",subject:"الموضوع",record:"تسجيل",timeline:"السجل الزمني",
    events:{OPPORTUNITY_OPENED:"فُتحت فرصة",OPPORTUNITY_ARCHIVED:"أُرشفت فرصة",COMMITMENT_APPROVED:"اعتمد المانح التزامًا",COLLECTION_RECORDED:"سُجل تحصيل",COLLECTION_VOIDED:"أُلغي تحصيل",DELIVERABLE_SUBMITTED:"سُلم التزام للمانح",THANK_YOU:"شكر",IMPACT_REPORT:"تقرير أثر",MEETING:"اجتماع",VISIT:"زيارة",CALL:"مكالمة"},
    toProposal:"بدء إعداد المقترح",toSubmitted:"تسجيل التقديم للمانح",decline:"رفض المانح",withdraw:"سحب",archive:"أرشفة",renew:"فتح تجديد",renewRef:"مرجع التجديد",
    approveTitle:"اعتماد المانح (التزام وليس تحصيلًا)",committedAmount:"المبلغ الملتزم به",approvedOn:"تاريخ الاعتماد",periodEnd:"نهاية فترة المنحة",
    restricted:"تمويل مقيّد بغرض",restrictionPurpose:"الغرض المقيّد",agreement:"مرجع الاتفاقية",approve:"تسجيل الاعتماد",
    commitment:"الالتزام",schedule:"جدول السداد",number:"القسط",dueDate:"تاريخ الاستحقاق",amount:"المبلغ",addInstallment:"إضافة قسط",
    cancelInstallment:"إلغاء القسط",collections:"التحصيلات",receivedOn:"تاريخ الاستلام",bankReference:"مرجع التحويل البنكي",
    recordCollection:"تسجيل تحصيل",collectionNote:"مرجع التحويل يُستخدم لمنع التكرار ولا يُعرض بعد الحفظ.",voided:"ملغى",recorded:"مسجل",
    voidAction:"إلغاء التحصيل",reasons:{DUPLICATE_ENTRY:"إدخال مكرر",WRONG_AMOUNT:"مبلغ خاطئ",PAYMENT_RETURNED:"دفعة مرتجعة"},
    deliverables:"التزامات المنحة",deliverable:"الالتزام",addDeliverable:"إضافة التزام",submitDeliverable:"تسليم",acceptDeliverable:"قبول المانح",
    dstates:{PENDING:"قيد التنفيذ",SUBMITTED:"مُسلّم",ACCEPTED:"مقبول"},
    receipt:"إصدار إيصال تبرع",post:"ترحيل للحسابات",invoice:"إصدار فاتورة",allocate:"توزيع الأموال المقيدة",
    blockedNote:"الإيصالات متوقفة حتى D-05، والترحيل والفواتير حتى D-06، وتوزيع الأموال المقيدة حتى D-05 وD-06.",
    renewalOf:"تجديد لـ",archived:"مؤرشفة",readonly:"عرض فقط: مسؤول العلاقة وحده يعدّل هذا السجل.",
    errors:{STAGE_TRANSITION:"هذا الانتقال غير مسموح من المرحلة الحالية.",ALREADY_DONOR:"لهذا الحساب ملف مانح بالفعل.",ALREADY_COMMITTED:"لهذه الفرصة التزام مسجل بالفعل.",HAS_COMMITMENT:"لا تُؤرشف فرصة لها التزام.",SCHEDULE_EXCEEDS_COMMITMENT:"مجموع الأقساط سيتجاوز المبلغ الملتزم به.",OVER_COLLECTION:"المبلغ أكبر من المتبقي على هذا القسط.",DUPLICATE_COLLECTION:"هذا التحويل مسجل بالفعل.",INSTALLMENT_STATE:"هذا القسط ملغى.",HAS_COLLECTIONS:"لا يُلغى قسط عليه تحصيلات.",ALREADY_VOIDED:"هذا التحصيل ملغى بالفعل.",DELIVERABLE_STATE:"الالتزام يُسلّم أولًا ثم يُقبل.",BLOCKED_BY_POLICY:"متوقف حتى اعتماد السياسة.",conflict:"تم تعديل البيانات من مكان آخر؛ حدّثناها، أعد المحاولة.",invalid:"راجع الحقول المطلوبة وقيمها.",denied:"ليست لديك صلاحية لهذا الإجراء.",failed:"تعذّر تنفيذ الطلب."},
  },
  en: {
    title:"Fundraising and partnerships",desc:"Donors, grants, pledges, payment schedules, actual collections and stewardship, within your permissions.",
    tabs:{overview:"Overview",donors:"Donors",pipeline:"Grants and pledges",collections:"Collection status"},
    loading:"Loading...",retry:"Retry",search:"Search",open:"Open",back:"Back to fundraising",save:"Save",cancel:"Cancel",empty:"None",
    money:{proposed:"Proposed",committed:"Committed",scheduled:"Scheduled",collected:"Actually collected",outstanding:"Still to collect",restrictedCommitted:"Restricted commitments",unscheduled:"Not scheduled"},
    moneyNote:"Amounts are kept apart and never added together: a pledge is not collected money, and currencies are never mixed.",noMoney:"No amounts recorded yet",
    stages:{IDENTIFIED:"Identified",PROPOSAL:"Proposal",SUBMITTED:"Submitted",APPROVED:"Approved",DECLINED:"Declined",WITHDRAWN:"Withdrawn"},
    attention:"Needs attention (overdue or due within 30 days)",noAttention:"No installments need attention",
    states:{DUE:"Due",PARTIAL:"Partly collected",OVERDUE:"Overdue",COLLECTED:"Collected",CANCELLED:"Cancelled"},allStates:"All statuses",
    donors:"Donors",newDonor:"New donor",searchDonors:"Search by donor name",noDonors:"No donors",account:"Account",chooseAccount:"Choose an account",
    donorType:"Donor type",types:{INDIVIDUAL:"Individual",FOUNDATION:"Foundation",CORPORATE:"Corporate",GOVERNMENT:"Government",MULTILATERAL:"Multilateral"},
    anonymous:"Asked to stay anonymous",anonymousDonor:"Anonymous donor",manager:"Relationship manager",openOpps:"Open opportunities",
    sensitiveTitle:"Sensitive donor data",onFile:"On file (not shown)",notOnFile:"Not on file",
    sensitiveNote:"Giving capacity, contact preference and relationship note are recorded but never shown. Reading them waits for D-05 and D-07.",
    capacity:"Estimated giving capacity",preference:"Contact preference",note:"Relationship note",saveSensitive:"Record sensitive data",
    opportunities:"Funding opportunities",newOpp:"New funding opportunity",reference:"Reference",oppTitle:"Title",purpose:"Programme or purpose",kind:"Kind",
    kinds:{GRANT:"Grant",DONATION:"Donation",SPONSORSHIP:"Sponsorship"},proposed:"Proposed amount",currency:"Currency",deadline:"Deadline",
    campaign:"Campaign",noCampaign:"No campaign",searchOpps:"Search by reference or title",allCampaigns:"All campaigns",noOpps:"No funding opportunities",
    stewardship:"Stewardship",activity:"Activity",activities:{THANK_YOU:"Thank-you",IMPACT_REPORT:"Impact report",MEETING:"Meeting",VISIT:"Visit",CALL:"Call"},
    occurredOn:"Date",subject:"Subject",record:"Record",timeline:"Timeline",
    events:{OPPORTUNITY_OPENED:"Opportunity opened",OPPORTUNITY_ARCHIVED:"Opportunity archived",COMMITMENT_APPROVED:"Donor approved a commitment",COLLECTION_RECORDED:"Collection recorded",COLLECTION_VOIDED:"Collection voided",DELIVERABLE_SUBMITTED:"Deliverable submitted",THANK_YOU:"Thank-you",IMPACT_REPORT:"Impact report",MEETING:"Meeting",VISIT:"Visit",CALL:"Call"},
    toProposal:"Start the proposal",toSubmitted:"Record submission to the donor",decline:"Donor declined",withdraw:"Withdraw",archive:"Archive",renew:"Open a renewal",renewRef:"Renewal reference",
    approveTitle:"Donor approval (a commitment, not a collection)",committedAmount:"Committed amount",approvedOn:"Approved on",periodEnd:"Grant period end",
    restricted:"Restricted to a purpose",restrictionPurpose:"Restricted purpose",agreement:"Agreement reference",approve:"Record approval",
    commitment:"Commitment",schedule:"Payment schedule",number:"Installment",dueDate:"Due date",amount:"Amount",addInstallment:"Add installment",
    cancelInstallment:"Cancel installment",collections:"Collections",receivedOn:"Received on",bankReference:"Bank transfer reference",
    recordCollection:"Record collection",collectionNote:"The transfer reference prevents duplicates and is not shown after saving.",voided:"Voided",recorded:"Recorded",
    voidAction:"Void collection",reasons:{DUPLICATE_ENTRY:"Duplicate entry",WRONG_AMOUNT:"Wrong amount",PAYMENT_RETURNED:"Payment returned"},
    deliverables:"Grant deliverables",deliverable:"Deliverable",addDeliverable:"Add deliverable",submitDeliverable:"Submit",acceptDeliverable:"Donor accepted",
    dstates:{PENDING:"Pending",SUBMITTED:"Submitted",ACCEPTED:"Accepted"},
    receipt:"Issue donation receipt",post:"Post to accounting",invoice:"Issue invoice",allocate:"Allocate restricted funds",
    blockedNote:"Receipts wait for D-05; posting and invoices for D-06; restricted-fund allocation for D-05 and D-06.",
    renewalOf:"Renewal of",archived:"Archived",readonly:"Read only: only the relationship manager changes this record.",
    errors:{STAGE_TRANSITION:"This change is not allowed from the current stage.",ALREADY_DONOR:"This account already has a donor profile.",ALREADY_COMMITTED:"This opportunity already has a commitment.",HAS_COMMITMENT:"An opportunity with a commitment cannot be archived.",SCHEDULE_EXCEEDS_COMMITMENT:"The installments would exceed the committed amount.",OVER_COLLECTION:"This is more than is still due on the installment.",DUPLICATE_COLLECTION:"This transfer is already recorded.",INSTALLMENT_STATE:"This installment is cancelled.",HAS_COLLECTIONS:"An installment with collections cannot be cancelled.",ALREADY_VOIDED:"This collection is already voided.",DELIVERABLE_STATE:"A deliverable is submitted, then accepted.",BLOCKED_BY_POLICY:"Blocked until the policy is signed.",conflict:"The data changed elsewhere; it is refreshed, try again.",invalid:"Check the required fields and their values.",denied:"You do not have permission for this action.",failed:"The request failed."},
  },
} as const;
type Labels = typeof strings.ar | typeof strings.en;
const BOARD: Stage[] = ["IDENTIFIED","PROPOSAL","SUBMITTED","APPROVED"];
const MONEY_KEYS = ["proposed","committed","scheduled","collected","outstanding","restrictedCommitted"] as const;

function message(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.errors.failed;
  const known = error.code && (l.errors as Record<string, string>)[error.code];
  if (known) return known;
  if (error.statusCode === 409) return l.errors.conflict;
  if (error.statusCode === 422 && error.fields.length) return l.errors.invalid;
  if (error.statusCode === 403 || error.statusCode === 404) return l.errors.denied;
  return l.errors.failed;
}
const today = () => new Date().toISOString().slice(0, 10);
function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/fundraising\/?/, "").split("/").filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const sync = () => setRoute(read());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return route;
}
function useAction(l: Labels, after: () => Promise<unknown>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = useCallback(async (action: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true); setError("");
    try { await action(); await after(); return true; }
    catch (e) { setError(message(e, l)); void after().catch(() => undefined); return false; }
    finally { setBusy(false); }
  }, [busy, l, after]);
  return { busy, error, run };
}
/** Amounts use Latin digits and the ISO code in both languages, like the other real-mode money fields. */
function useMoney(_language: Language) {
  return useCallback((value: Money | null | undefined, currency: string) =>
    value === null || value === undefined ? "—"
      : amount(value, currency), []);
}
const donorLabel = (name: string | null, l: Labels) => name ?? l.anonymousDonor;

/** Fundraising workspace (real mode). */
export function FundraisingPage({language}:{language:Language}){
  const l=strings[language];
  const route=useRoute();
  const Back=language==="ar"?ArrowRight:ArrowLeft;
  if(route[0]==="donors"&&/^\d+$/.test(route[1]||""))return <DonorRecord key={route[1]} donorId={Number(route[1])} l={l} language={language} Back={Back}/>;
  if(route[0]==="opportunities"&&/^\d+$/.test(route[1]||""))return <OpportunityRecord key={route[1]} oppId={Number(route[1])} l={l} language={language} Back={Back}/>;
  const tab=(["donors","pipeline","collections"] as const).find(t=>t===route[0])??"overview";
  return <section className="page-enter fund-page">
    <PageHeader className="directory-head" eyebrow={language==="ar"?"التنفيذ والخدمات":"Delivery & services"} title={l.title} description={l.desc}/>
    <div className="demo-record-tabs fund-tabs" role="tablist" aria-label={l.title}>
      {(["overview","donors","pipeline","collections"] as const).map(t=><button key={t} type="button" role="tab" aria-selected={tab===t} className={tab===t?"active":""}
        onClick={()=>{window.location.hash=t==="overview"?"#/fundraising":"#/fundraising/"+t;}}>{l.tabs[t]}</button>)}
    </div>
    {tab==="overview"&&<OverviewView l={l} language={language}/>}
    {tab==="donors"&&<DonorsRegister l={l}/>}
    {tab==="pipeline"&&<Pipeline l={l} language={language}/>}
    {tab==="collections"&&<CollectionsView l={l} language={language}/>}
  </section>;
}

function Retry({error,onRetry,l}:{error:string;onRetry:()=>void;l:Labels}){
  return <div className="error-banner" role="alert"><CircleAlert size={17}/><span>{error}</span><button type="button" className="btn btn-secondary" onClick={onRetry}><RefreshCw size={15}/>{l.retry}</button></div>;
}

function MoneyStrip({totals,l,language,keys=MONEY_KEYS}:{totals:MoneyTotals[];l:Labels;language:Language;keys?:readonly (typeof MONEY_KEYS[number])[]}){
  const fmt=useMoney(language);
  if(totals.length===0)return <p className="fund-muted">{l.noMoney}</p>;
  return <>{totals.map(t=><dl key={t.currency} className="fund-money" aria-label={t.currency}>
    {keys.map(k=><div key={k} className={"fund-money-"+k}><dt>{l.money[k]}</dt><dd dir="ltr">{fmt(t[k],t.currency)}</dd></div>)}
  </dl>)}<p className="fund-note"><CircleAlert size={14}/>{l.moneyNote}</p></>;
}

function StatusList({rows,l,language}:{rows:InstallmentStatus[];l:Labels;language:Language}){
  const fmt=useMoney(language);
  return <div className="table-scroll"><table className="fund-table"><thead><tr><th>{l.reference}</th><th>{l.donors}</th><th>{l.number}</th><th>{l.dueDate}</th><th>{l.amount}</th><th>{l.money.collected}</th><th>{l.states.DUE}</th></tr></thead>
    <tbody>{rows.map(r=><tr key={r.id}><td><a href={"#/fundraising/opportunities/"+r.commitmentId+"?commitment"} onClick={e=>{e.preventDefault();void getCommitment(r.commitmentId).then(c=>{window.location.hash="#/fundraising/opportunities/"+c.opportunityId;});}} dir="ltr">{r.reference}</a></td>
      <td>{donorLabel(r.donorName,l)}</td><td>{r.sequence}</td><td dir="ltr">{r.dueDate}</td><td dir="ltr">{fmt(r.amount,r.currency)}</td><td dir="ltr">{fmt(r.collected,r.currency)}</td>
      <td><span className={"fund-state fund-state-"+r.status.toLowerCase()}>{l.states[r.status]}</span></td></tr>)}</tbody></table></div>;
}

function OverviewView({l,language}:{l:Labels;language:Language}){
  const [data,setData]=useState<Overview|null>(null);const [error,setError]=useState("");
  const load=useCallback(()=>getOverview().then(d=>{setData(d);setError("");}),[]);
  useEffect(()=>{void load().catch(e=>setError(message(e,l)));},[load,l]);
  if(error)return <Retry error={error} l={l} onRetry={()=>void load().catch(e=>setError(message(e,l)))}/>;
  if(!data)return <div className="empty-state" role="status">{l.loading}</div>;
  return <div className="fund-overview">
    <section className="record-content-card" aria-labelledby="fund-money-title">
      <div className="record-section-header"><div className="record-section-icon"><Wallet size={20}/></div><div><h2 id="fund-money-title">{l.commitment}</h2></div></div>
      <MoneyStrip totals={data.totals} l={l} language={language}/>
    </section>
    <section className="record-content-card" aria-labelledby="fund-stage-title">
      <div className="record-section-header"><div className="record-section-icon"><HandCoins size={20}/></div><div><h2 id="fund-stage-title">{l.opportunities}</h2></div></div>
      <ul className="fund-stage-strip">{(Object.keys(l.stages) as Stage[]).map(s=><li key={s}><span>{l.stages[s]}</span><strong>{data.stages[s]??0}</strong></li>)}</ul>
    </section>
    <section className="record-content-card" aria-labelledby="fund-att-title">
      <div className="record-section-header"><div className="record-section-icon"><CalendarClock size={20}/></div><div><h2 id="fund-att-title">{l.attention}</h2></div></div>
      {data.attention.length===0?<p className="fund-muted">{l.noAttention}</p>:<StatusList rows={data.attention} l={l} language={language}/>}
    </section>
  </div>;
}

function DonorsRegister({l}:{l:Labels}){
  const [rows,setRows]=useState<Donor[]|null>(null);const [q,setQ]=useState("");const [applied,setApplied]=useState("");
  const [error,setError]=useState("");const [creating,setCreating]=useState(false);
  const [accounts,setAccounts]=useState<AccountSummary[]>([]);const [partnerId,setPartnerId]=useState("");
  const [type,setType]=useState<DonorType>("FOUNDATION");const [anonymous,setAnonymous]=useState(false);const [busy,setBusy]=useState(false);const [formError,setFormError]=useState("");
  const load=useCallback(()=>getDonors(applied||undefined).then(r=>{setRows(r);setError("");}),[applied]);
  useEffect(()=>{setRows(null);void load().catch(e=>{setRows([]);setError(message(e,l));});},[load,l]);
  useEffect(()=>{if(creating)void getAccounts(0,50).then(setAccounts).catch(()=>setAccounts([]));},[creating]);
  return <>
    <form className="list-toolbar fund-toolbar" role="search" onSubmit={e=>{e.preventDefault();setApplied(q.trim());}}>
      <label className="search-field"><Search size={18}/><span className="sr-only">{l.searchDonors}</span><input value={q} maxLength={100} placeholder={l.searchDonors} onChange={e=>setQ(e.target.value)}/></label>
      <button type="submit" className="btn btn-secondary"><Search size={16}/>{l.search}</button>
      <button type="button" className="btn btn-primary" onClick={()=>setCreating(c=>!c)}><Plus size={16}/>{l.newDonor}</button>
    </form>
    {creating&&<form className="record-content-card opportunity-form fund-form" onSubmit={e=>{e.preventDefault();if(busy)return;setBusy(true);setFormError("");
      createDonor({partnerId:Number(partnerId),donorType:type,...(anonymous?{anonymous}:{})}).then(d=>{window.location.hash="#/fundraising/donors/"+d.id;})
        .catch(err=>setFormError(message(err,l))).finally(()=>setBusy(false));}}>
      {formError&&<div className="login-error" role="alert"><CircleAlert size={17}/>{formError}</div>}
      <label><span>{l.account}</span><select required value={partnerId} onChange={e=>setPartnerId(e.target.value)}><option value="">{l.chooseAccount}</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label><span>{l.donorType}</span><select value={type} onChange={e=>setType(e.target.value as DonorType)}>{(Object.keys(l.types) as DonorType[]).map(t=><option key={t} value={t}>{l.types[t]}</option>)}</select></label>
      <label className="fund-check"><input type="checkbox" checked={anonymous} onChange={e=>setAnonymous(e.target.checked)}/><span>{l.anonymous}</span></label>
      <div className="lead-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{l.save}</button><button type="button" className="btn btn-secondary" onClick={()=>setCreating(false)}>{l.cancel}</button></div>
    </form>}
    {error&&<Retry error={error} l={l} onRetry={()=>void load().catch(e=>setError(message(e,l)))}/>}
    <div className="data-panel"><div className="data-panel-heading"><strong>{l.donors}</strong><span>{rows?.length??0}</span></div>
      {rows===null?<div className="empty-state" role="status">{l.loading}</div>:rows.length===0?<div className="empty-state"><CircleDashed size={26}/>{l.noDonors}</div>
      :<div className="directory-items">{rows.map(d=><article className="directory-item fund-row" key={d.id}>
        <div className="line-monogram">{(d.name??"؟").slice(0,1)}</div>
        <div className="directory-record"><strong>{donorLabel(d.name,l)}</strong><small>{l.types[d.donorType]} · {l.manager}: {d.managerName??"—"}</small></div>
        <span className="fund-count" title={l.openOpps}>{d.openOpportunities}</span>
        <a className="text-action" href={"#/fundraising/donors/"+d.id}>{l.open}</a>
      </article>)}</div>}
    </div>
  </>;
}

function OpportunityForm({l,donorId,onCreated}:{l:Labels;donorId:number;onCreated:(o:Opportunity)=>void}){
  const [campaigns,setCampaigns]=useState<Campaign[]>([]);
  const [reference,setReference]=useState("");const [title,setTitle]=useState("");const [purpose,setPurpose]=useState("");const [kind,setKind]=useState("GRANT");
  const [amount,setAmount]=useState("");const [currency,setCurrency]=useState("EGP");const [deadline,setDeadline]=useState("");const [campaignId,setCampaignId]=useState("");
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  useEffect(()=>{void getCampaigns().then(setCampaigns).catch(()=>setCampaigns([]));},[]);
  return <form className="opportunity-form fund-form" onSubmit={e=>{e.preventDefault();if(busy)return;setBusy(true);setError("");
    createOpportunity({reference,donorId,title,kind,currencyCode:currency,...(purpose?{purpose}:{}),...(amount?{proposedAmount:amount}:{}),...(deadline?{deadline}:{}),...(campaignId?{campaignId:Number(campaignId)}:{})})
      .then(onCreated).catch(err=>setError(message(err,l))).finally(()=>setBusy(false));}}>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    <label><span>{l.reference}</span><input required dir="ltr" maxLength={30} value={reference} onChange={e=>setReference(e.target.value)}/></label>
    <label><span>{l.oppTitle}</span><input required maxLength={255} value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label><span>{l.purpose}</span><input maxLength={255} value={purpose} onChange={e=>setPurpose(e.target.value)}/></label>
    <label><span>{l.kind}</span><select value={kind} onChange={e=>setKind(e.target.value)}>{(Object.keys(l.kinds) as (keyof Labels["kinds"])[]).map(k=><option key={k} value={k}>{l.kinds[k]}</option>)}</select></label>
    <label><span>{l.proposed}</span><input inputMode="decimal" dir="ltr" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
    <label><span>{l.currency}</span><input required dir="ltr" maxLength={3} pattern="[A-Z]{3}" value={currency} onChange={e=>setCurrency(e.target.value.toUpperCase())}/></label>
    <label><span>{l.deadline}</span><input type="date" value={deadline} onChange={e=>setDeadline(e.target.value)}/></label>
    <label><span>{l.campaign}</span><select value={campaignId} onChange={e=>setCampaignId(e.target.value)}><option value="">{l.noCampaign}</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <button type="submit" className="btn btn-primary" disabled={busy}><Plus size={16}/>{l.newOpp}</button>
  </form>;
}

function DonorRecord({donorId,l,language,Back}:{donorId:number;l:Labels;language:Language;Back:typeof ArrowLeft}){
  const [donor,setDonor]=useState<Donor|null>(null);const [totals,setTotals]=useState<MoneyTotals[]>([]);
  const [opps,setOpps]=useState<Opportunity[]>([]);const [events,setEvents]=useState<TimelineEvent[]>([]);const [loadError,setLoadError]=useState("");
  const [capacity,setCapacity]=useState("");const [preference,setPreference]=useState("");const [note,setNote]=useState("");
  const [kind,setKind]=useState("THANK_YOU");const [on,setOn]=useState(today());const [subject,setSubject]=useState("");const [adding,setAdding]=useState(false);
  const reload=useCallback(async()=>{
    const [d,o,t]=await Promise.all([getDonor(donorId),getOpportunities({donorId}),getTimeline(donorId)]);
    setDonor(d.donor);setTotals(d.totals);setOpps(o);setEvents(t);
  },[donorId]);
  useEffect(()=>{void reload().catch(e=>setLoadError(message(e,l)));},[reload,l]);
  const {busy,error,run}=useAction(l,reload);
  if(loadError)return <section className="page-enter"><a className="record-back" href="#/fundraising/donors"><Back size={17}/>{l.back}</a><ErrorBanner message={loadError}/></section>;
  if(!donor)return <div className="empty-state" role="status">{l.loading}</div>;
  const editable=donor.managedByMe;
  return <article className="record-workspace page-enter fund-record" aria-labelledby="donor-title">
    <div className="record-context-bar"><a className="record-back" href="#/fundraising/donors"><Back size={17}/>{l.back}</a><span className="record-context-separator">/</span><span className="record-current">{donorLabel(donor.name,l)}</span></div>
    <div className="record-hero"><div className="record-hero-main"><span className="eyebrow"><span className="record-eyebrow-dot"/>{l.donors} · {l.types[donor.donorType]}</span>
      <div className="record-hero-heading"><div className="record-identity-icon"><UserRound size={30}/></div><div><h1 id="donor-title">{donorLabel(donor.name,l)}</h1>
        <div className="record-tags">{donor.anonymous&&<span className="record-ref">{l.anonymous}</span>}<span className="record-ref">{l.manager}: {donor.managerName??"—"}</span>
          {donor.partnerId!=null&&<a className="record-ref" href={"#/accounts/"+donor.partnerId}>{l.account}</a>}</div></div></div></div></div>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {!editable&&<p className="record-security-note"><LockKeyhole size={15}/>{l.readonly}</p>}
    <section className="record-content-card" aria-labelledby="donor-money"><div className="record-section-header"><div className="record-section-icon"><Wallet size={20}/></div><div><h2 id="donor-money">{l.commitment}</h2></div></div>
      <MoneyStrip totals={totals} l={l} language={language}/></section>
    <div className="record-content-grid">
      <section className="record-content-card" aria-labelledby="donor-opps"><div className="record-section-header"><div className="record-section-icon"><HandCoins size={20}/></div><div><h2 id="donor-opps">{l.opportunities}</h2></div></div>
        {opps.length===0?<p className="fund-muted">{l.noOpps}</p>:<ul className="fund-list">{opps.map(o=><li key={o.id}><span><a href={"#/fundraising/opportunities/"+o.id}><strong dir="ltr">{o.reference}</strong></a> · {o.title}</span>
          <span className={"fund-stage fund-stage-"+o.stage.toLowerCase()}>{l.stages[o.stage]}</span></li>)}</ul>}
        {editable&&(adding?<OpportunityForm l={l} donorId={donor.id} onCreated={o=>{window.location.hash="#/fundraising/opportunities/"+o.id;}}/>
          :<button type="button" className="btn btn-secondary" onClick={()=>setAdding(true)}><Plus size={16}/>{l.newOpp}</button>)}
      </section>
      <section className="record-content-card fund-sensitive" aria-labelledby="donor-sens"><div className="record-section-header"><div className="record-section-icon"><FileLock2 size={20}/></div><div><h2 id="donor-sens">{l.sensitiveTitle}</h2><p>{donor.sensitiveOnFile?l.onFile:l.notOnFile}</p></div></div>
        <p className="record-security-note"><LockKeyhole size={15}/>{l.sensitiveNote}</p>
        {editable&&<form className="opportunity-form fund-form" autoComplete="off" onSubmit={e=>{e.preventDefault();void run(async()=>{
            await saveSensitive(donor.id,donor.version,{...(capacity?{givingCapacity:capacity}:{}),...(preference?{contactPreference:preference}:{}),...(note?{relationshipNote:note}:{})});
            setCapacity("");setPreference("");setNote("");});}}>
          <label><span>{l.capacity}</span><input inputMode="decimal" dir="ltr" value={capacity} onChange={e=>setCapacity(e.target.value)}/></label>
          <label><span>{l.preference}</span><input maxLength={255} value={preference} onChange={e=>setPreference(e.target.value)}/></label>
          <label className="fund-wide"><span>{l.note}</span><textarea rows={2} maxLength={4000} value={note} onChange={e=>setNote(e.target.value)}/></label>
          <button type="submit" className="btn btn-secondary" disabled={busy}>{l.saveSensitive}</button></form>}
      </section>
    </div>
    <section className="record-content-card" aria-labelledby="donor-stew"><div className="record-section-header"><div className="record-section-icon"><History size={20}/></div><div><h2 id="donor-stew">{l.stewardship}</h2></div></div>
      {editable&&<form className="opportunity-form fund-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await recordActivity(donor.id,donor.version,{kind,occurredOn:on,subject});setSubject("");});}}>
        <label><span>{l.activity}</span><select value={kind} onChange={e=>setKind(e.target.value)}>{(Object.keys(l.activities) as (keyof Labels["activities"])[]).map(k=><option key={k} value={k}>{l.activities[k]}</option>)}</select></label>
        <label><span>{l.occurredOn}</span><input type="date" required max={today()} value={on} onChange={e=>setOn(e.target.value)}/></label>
        <label><span>{l.subject}</span><input required maxLength={120} value={subject} onChange={e=>setSubject(e.target.value)}/></label>
        <button type="submit" className="btn btn-secondary" disabled={busy}><Plus size={16}/>{l.record}</button></form>}
      <h3 className="fund-sub-title">{l.timeline}</h3>
      {events.length===0?<p className="fund-muted">{l.empty}</p>:<ol className="fund-timeline">{events.map((e,i)=><li key={i}><span className="fund-timeline-dot"/>
        <div><strong>{(l.events as Record<string,string>)[e.kind]??e.kind}</strong>{e.label?<> · <span>{e.label}</span></>:null}<small dir="ltr">{e.at.replace("T"," ").slice(0,16)}{e.actorName?` · ${e.actorName}`:""}</small></div></li>)}</ol>}
    </section>
  </article>;
}

function Pipeline({l,language}:{l:Labels;language:Language}){
  const fmt=useMoney(language);
  const [rows,setRows]=useState<Opportunity[]|null>(null);const [campaigns,setCampaigns]=useState<Campaign[]>([]);
  const [q,setQ]=useState("");const [applied,setApplied]=useState("");const [campaignId,setCampaignId]=useState("");const [error,setError]=useState("");
  const load=useCallback(()=>getOpportunities({...(applied?{q:applied}:{}),...(campaignId?{campaignId:Number(campaignId)}:{})}).then(r=>{setRows(r);setError("");}),[applied,campaignId]);
  useEffect(()=>{setRows(null);void load().catch(e=>{setRows([]);setError(message(e,l));});},[load,l]);
  useEffect(()=>{void getCampaigns().then(setCampaigns).catch(()=>setCampaigns([]));},[]);
  const closed=(rows??[]).filter(o=>o.stage==="DECLINED"||o.stage==="WITHDRAWN");
  return <>
    <form className="list-toolbar fund-toolbar" role="search" onSubmit={e=>{e.preventDefault();setApplied(q.trim());}}>
      <label className="search-field"><Search size={18}/><span className="sr-only">{l.searchOpps}</span><input value={q} maxLength={100} placeholder={l.searchOpps} onChange={e=>setQ(e.target.value)}/></label>
      <label className="fund-filter"><span className="sr-only">{l.campaign}</span><select aria-label={l.allCampaigns} value={campaignId} onChange={e=>setCampaignId(e.target.value)}><option value="">{l.allCampaigns}</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <button type="submit" className="btn btn-secondary"><Search size={16}/>{l.search}</button>
    </form>
    {error&&<Retry error={error} l={l} onRetry={()=>void load().catch(e=>setError(message(e,l)))}/>}
    {rows===null?<div className="empty-state" role="status">{l.loading}</div>:rows.length===0?<div className="empty-state"><CircleDashed size={26}/>{l.noOpps}</div>
    :<div className="fund-board" role="list">{BOARD.map(stage=>{const items=rows.filter(o=>o.stage===stage);
      return <section key={stage} className="fund-column" role="listitem" aria-label={l.stages[stage]}><h3>{l.stages[stage]} <span>{items.length}</span></h3>
        {items.length===0?<p className="fund-muted">{l.empty}</p>:items.map(o=><a key={o.id} className="fund-card" href={"#/fundraising/opportunities/"+o.id}>
          <strong>{o.title}</strong><small>{donorLabel(o.donorName,l)} · <span dir="ltr">{o.reference}</span></small>
          <span dir="ltr" className="fund-card-amount">{fmt(o.proposedAmount,o.currency)}</span>{o.campaignName&&<small>{o.campaignName}</small>}</a>)}
      </section>;})}</div>}
    {closed.length>0&&<p className="fund-muted">{closed.map(o=>`${o.reference} (${l.stages[o.stage]})`).join(" · ")}</p>}
  </>;
}

function CollectionsView({l,language}:{l:Labels;language:Language}){
  const [status,setStatus]=useState<CollectionState|"">("");const [rows,setRows]=useState<InstallmentStatus[]|null>(null);const [error,setError]=useState("");
  const load=useCallback(()=>getCollectionStatus(status||undefined).then(r=>{setRows(r);setError("");}),[status]);
  useEffect(()=>{setRows(null);void load().catch(e=>{setRows([]);setError(message(e,l));});},[load,l]);
  return <>
    <div className="list-toolbar fund-toolbar"><label className="fund-filter"><span className="sr-only">{l.allStates}</span>
      <select aria-label={l.allStates} value={status} onChange={e=>setStatus(e.target.value as CollectionState|"")}><option value="">{l.allStates}</option>
        {(Object.keys(l.states) as CollectionState[]).map(s=><option key={s} value={s}>{l.states[s]}</option>)}</select></label></div>
    {error&&<Retry error={error} l={l} onRetry={()=>void load().catch(e=>setError(message(e,l)))}/>}
    <div className="data-panel"><div className="data-panel-heading"><strong>{l.tabs.collections}</strong><span>{rows?.length??0}</span></div>
      {rows===null?<div className="empty-state" role="status">{l.loading}</div>:rows.length===0?<div className="empty-state"><CircleDashed size={26}/>{l.empty}</div>
      :<StatusList rows={rows} l={l} language={language}/>}</div>
  </>;
}

function OpportunityRecord({oppId,l,language,Back}:{oppId:number;l:Labels;language:Language;Back:typeof ArrowLeft}){
  const fmt=useMoney(language);
  const [opp,setOpp]=useState<Opportunity|null>(null);const [commitment,setCommitment]=useState<Commitment|null>(null);
  const [installments,setInstallments]=useState<Installment[]>([]);const [deliverables,setDeliverables]=useState<Deliverable[]>([]);const [loadError,setLoadError]=useState("");
  const [amount,setAmount]=useState("");const [approvedOn,setApprovedOn]=useState(today());const [periodEnd,setPeriodEnd]=useState("");
  const [restricted,setRestricted]=useState(false);const [purpose,setPurpose]=useState("");const [agreement,setAgreement]=useState("");
  const [due,setDue]=useState("");const [instAmount,setInstAmount]=useState("");const [dTitle,setDTitle]=useState("");const [dDue,setDDue]=useState("");const [renewRef,setRenewRef]=useState("");
  const reload=useCallback(async()=>{
    const o=await getOpportunity(oppId);setOpp(o);
    if(o.commitmentId!=null){const [c,i,d]=await Promise.all([getCommitment(o.commitmentId),getInstallments(o.commitmentId),getDeliverables(o.commitmentId)]);setCommitment(c);setInstallments(i);setDeliverables(d);}
    else{setCommitment(null);setInstallments([]);setDeliverables([]);}
  },[oppId]);
  useEffect(()=>{void reload().catch(e=>setLoadError(message(e,l)));},[reload,l]);
  const {busy,error,run}=useAction(l,reload);
  if(loadError)return <section className="page-enter"><a className="record-back" href="#/fundraising/pipeline"><Back size={17}/>{l.back}</a><ErrorBanner message={loadError}/></section>;
  if(!opp)return <div className="empty-state" role="status">{l.loading}</div>;
  const editable=opp.managedByMe;
  const open=["IDENTIFIED","PROPOSAL","SUBMITTED"].includes(opp.stage);
  return <article className="record-workspace page-enter fund-record" aria-labelledby="opp-title">
    <div className="record-context-bar"><a className="record-back" href="#/fundraising/pipeline"><Back size={17}/>{l.back}</a><span className="record-context-separator">/</span><span className="record-current" dir="ltr">{opp.reference}</span></div>
    <div className="record-hero"><div className="record-hero-main">
      <span className="eyebrow"><span className="record-eyebrow-dot"/>{l.kinds[opp.kind]} · <a href={"#/fundraising/donors/"+opp.donorId}>{donorLabel(opp.donorName,l)}</a></span>
      <div className="record-hero-heading"><div className="record-identity-icon"><HandCoins size={30}/></div>
        <div><h1 id="opp-title">{opp.title}</h1><div className="record-tags"><span className={"fund-stage fund-stage-"+opp.stage.toLowerCase()}>{l.stages[opp.stage]}</span>
          <span className="record-ref" dir="ltr">{opp.reference}</span>{opp.campaignName&&<span className="record-ref">{l.campaign}: {opp.campaignName}</span>}
          {opp.renewalOf&&<span className="record-ref">{l.renewalOf} <span dir="ltr">{opp.renewalOf}</span></span>}{opp.archived&&<span className="record-ref">{l.archived}</span>}</div></div></div>
      {opp.purpose&&<p className="record-hero-description">{opp.purpose}</p>}
    </div><div className="record-hero-actions">
      <dl className="fund-kpis"><div><dt>{l.proposed}</dt><dd dir="ltr">{fmt(opp.proposedAmount,opp.currency)}</dd></div>{opp.deadline&&<div><dt>{l.deadline}</dt><dd dir="ltr">{opp.deadline}</dd></div>}</dl>
      {editable&&<div className="lead-actions">
        {opp.stage==="IDENTIFIED"&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void run(()=>moveOpportunity(opp.id,opp.version,"PROPOSAL"))}>{l.toProposal}</button>}
        {opp.stage==="PROPOSAL"&&<button type="button" className="btn btn-primary" disabled={busy} onClick={()=>void run(()=>moveOpportunity(opp.id,opp.version,"SUBMITTED"))}>{l.toSubmitted}</button>}
        {open&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void run(()=>moveOpportunity(opp.id,opp.version,"DECLINED"))}>{l.decline}</button>}
        {open&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void run(()=>moveOpportunity(opp.id,opp.version,"WITHDRAWN"))}>{l.withdraw}</button>}
        {opp.commitmentId==null&&!opp.archived&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void run(()=>archiveOpportunity(opp.id,opp.version))}>{l.archive}</button>}
      </div>}
    </div></div>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {!editable&&<p className="record-security-note"><LockKeyhole size={15}/>{l.readonly}</p>}
    {editable&&opp.stage==="SUBMITTED"&&<section className="record-content-card" aria-labelledby="approve-title">
      <div className="record-section-header"><div className="record-section-icon"><CheckCircle2 size={20}/></div><div><h2 id="approve-title">{l.approveTitle}</h2></div></div>
      <form className="opportunity-form fund-form" onSubmit={e=>{e.preventDefault();void run(()=>approveOpportunity(opp.id,opp.version,{committedAmount:amount,approvedOn,restricted,
          ...(periodEnd?{periodEnd}:{}),...(restricted?{restrictionPurpose:purpose}:{}),...(agreement?{agreementReference:agreement}:{})}));}}>
        <label><span>{l.committedAmount}</span><input required inputMode="decimal" dir="ltr" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
        <label><span>{l.approvedOn}</span><input type="date" required max={today()} value={approvedOn} onChange={e=>setApprovedOn(e.target.value)}/></label>
        <label><span>{l.periodEnd}</span><input type="date" value={periodEnd} onChange={e=>setPeriodEnd(e.target.value)}/></label>
        <label><span>{l.agreement}</span><input dir="ltr" maxLength={60} value={agreement} onChange={e=>setAgreement(e.target.value)}/></label>
        <label className="fund-check"><input type="checkbox" checked={restricted} onChange={e=>setRestricted(e.target.checked)}/><span>{l.restricted}</span></label>
        {restricted&&<label><span>{l.restrictionPurpose}</span><input required maxLength={255} value={purpose} onChange={e=>setPurpose(e.target.value)}/></label>}
        <button type="submit" className="btn btn-primary" disabled={busy}>{l.approve}</button></form>
    </section>}
    {commitment&&<>
      <section className="record-content-card" aria-labelledby="commit-title">
        <div className="record-section-header"><div className="record-section-icon"><Wallet size={20}/></div><div><h2 id="commit-title">{l.commitment}</h2>
          <p><span dir="ltr">{commitment.approvedOn}</span>{commitment.periodEnd?<> → <span dir="ltr">{commitment.periodEnd}</span></>:null}{commitment.agreementReference?<> · <span dir="ltr">{commitment.agreementReference}</span></>:null}</p></div></div>
        <dl className="fund-money" aria-label={commitment.currency}>
          {(["committed","scheduled","unscheduled","collected","outstanding"] as const).map(k=><div key={k} className={"fund-money-"+k}><dt>{l.money[k]}</dt><dd dir="ltr">{fmt(commitment[k],commitment.currency)}</dd></div>)}
        </dl>
        {commitment.restricted&&<p className="fund-restricted"><LockKeyhole size={14}/>{l.restricted}: {commitment.restrictionPurpose}</p>}
        <p className="fund-note"><CircleAlert size={14}/>{l.moneyNote}</p>
        <div className="lead-actions">
          {(["allocate","invoice","receipt","post"] as const).map(k=><button key={k} type="button" className="btn btn-secondary" disabled aria-describedby="fund-blocked-note">{l[k]}</button>)}
        </div>
        <p className="record-security-note" id="fund-blocked-note"><LockKeyhole size={15}/>{l.blockedNote}</p>
      </section>
      <section className="record-content-card" aria-labelledby="sched-title">
        <div className="record-section-header"><div className="record-section-icon"><CalendarClock size={20}/></div><div><h2 id="sched-title">{l.schedule}</h2></div></div>
        {installments.length===0?<p className="fund-muted">{l.empty}</p>:<div className="fund-installments">{installments.map(i=>
          <InstallmentRow key={i.id} installment={i} currency={commitment.currency} editable={editable} l={l} language={language} run={run} busy={busy}/>)}</div>}
        {editable&&<form className="opportunity-form fund-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await scheduleInstallment(commitment.id,commitment.version,due,instAmount);setDue("");setInstAmount("");});}}>
          <label><span>{l.dueDate}</span><input type="date" required value={due} onChange={e=>setDue(e.target.value)}/></label>
          <label><span>{l.amount}</span><input required inputMode="decimal" dir="ltr" value={instAmount} onChange={e=>setInstAmount(e.target.value)}/></label>
          <button type="submit" className="btn btn-secondary" disabled={busy}><Plus size={16}/>{l.addInstallment}</button></form>}
      </section>
      <section className="record-content-card" aria-labelledby="deliv-title">
        <div className="record-section-header"><div className="record-section-icon"><CheckCircle2 size={20}/></div><div><h2 id="deliv-title">{l.deliverables}</h2></div></div>
        {deliverables.length===0?<p className="fund-muted">{l.empty}</p>:<ul className="fund-list">{deliverables.map(d=><li key={d.id}>
          <span><strong>{d.title}</strong> · <span dir="ltr">{d.dueDate}</span> · {l.dstates[d.status]}</span>
          {editable&&d.status!=="ACCEPTED"&&<button type="button" className="text-action" disabled={busy} onClick={()=>void run(()=>advanceDeliverable(d.id,d.version,d.status==="PENDING"?"SUBMITTED":"ACCEPTED"))}>
            {d.status==="PENDING"?l.submitDeliverable:l.acceptDeliverable}</button>}</li>)}</ul>}
        {editable&&<form className="opportunity-form fund-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await addDeliverable(commitment.id,commitment.version,dTitle,dDue);setDTitle("");setDDue("");});}}>
          <label><span>{l.deliverable}</span><input required maxLength={255} value={dTitle} onChange={e=>setDTitle(e.target.value)}/></label>
          <label><span>{l.dueDate}</span><input type="date" required value={dDue} onChange={e=>setDDue(e.target.value)}/></label>
          <button type="submit" className="btn btn-secondary" disabled={busy}><Plus size={16}/>{l.addDeliverable}</button></form>}
      </section>
    </>}
    {editable&&opp.stage==="APPROVED"&&<form className="record-content-card opportunity-form fund-form" onSubmit={e=>{e.preventDefault();void run(async()=>{const r=await renewOpportunity(opp.id,opp.version,renewRef);window.location.hash="#/fundraising/opportunities/"+r.id;});}}>
      <label><span>{l.renewRef}</span><input required dir="ltr" maxLength={30} value={renewRef} onChange={e=>setRenewRef(e.target.value)}/></label>
      <button type="submit" className="btn btn-secondary" disabled={busy}><Plus size={16}/>{l.renew}</button></form>}
  </article>;
}

function InstallmentRow({installment,currency,editable,l,language,run,busy}:{installment:Installment;currency:string;editable:boolean;l:Labels;language:Language;run:(a:()=>Promise<unknown>)=>Promise<boolean>;busy:boolean}){
  const fmt=useMoney(language);
  const [open,setOpen]=useState(false);const [rows,setRows]=useState<CollectionRecord[]>([]);
  const [amount,setAmount]=useState("");const [received,setReceived]=useState(today());const [reference,setReference]=useState("");
  const load=useCallback(()=>getCollections(installment.id).then(setRows).catch(()=>setRows([])),[installment.id]);
  useEffect(()=>{if(open)void load();},[open,load]);
  const act=(a:()=>Promise<unknown>)=>void run(a).then(()=>load());
  return <div className={"fund-installment fund-installment-"+installment.status.toLowerCase()}>
    <button type="button" className="fund-installment-head" aria-expanded={open} onClick={()=>setOpen(o=>!o)}>
      <span>{l.number} {installment.sequence}</span><span dir="ltr">{installment.dueDate}</span><span dir="ltr">{fmt(installment.amount,currency)}</span>
      <span dir="ltr">{fmt(installment.collected,currency)}</span><span className={"fund-state fund-state-"+installment.status.toLowerCase()}>{l.states[installment.status]}</span></button>
    {open&&<div className="fund-installment-body">
      <h4>{l.collections}</h4>
      {rows.length===0?<p className="fund-muted">{l.empty}</p>:<ul className="fund-list">{rows.map(k=><li key={k.id} className={k.status==="VOIDED"?"is-voided":""}>
        <span><span dir="ltr">{fmt(k.amount,currency)}</span> · <span dir="ltr">{k.receivedOn}</span> · {k.status==="VOIDED"?`${l.voided}${k.voidReason?` (${(l.reasons as Record<string,string>)[k.voidReason]})`:""}`:l.recorded}{k.recordedBy?` · ${k.recordedBy}`:""}</span>
        {editable&&k.status==="RECORDED"&&<span className="lead-actions">{(Object.keys(l.reasons) as (keyof Labels["reasons"])[]).slice(0,3).map(r=>
          <button key={r} type="button" className="text-action" disabled={busy} onClick={()=>act(()=>voidCollection(k.id,k.version,r))}>{l.voidAction}: {l.reasons[r]}</button>)}</span>}
      </li>)}</ul>}
      {editable&&installment.status!=="CANCELLED"&&installment.status!=="COLLECTED"&&<form className="opportunity-form fund-form" autoComplete="off" onSubmit={e=>{e.preventDefault();act(async()=>{
          await recordCollection(installment.id,installment.version,{amount,receivedOn:received,bankReference:reference});setAmount("");setReference("");});}}>
        <label><span>{l.amount}</span><input required inputMode="decimal" dir="ltr" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
        <label><span>{l.receivedOn}</span><input type="date" required max={today()} value={received} onChange={e=>setReceived(e.target.value)}/></label>
        <label><span>{l.bankReference}</span><input required dir="ltr" maxLength={60} value={reference} onChange={e=>setReference(e.target.value)}/></label>
        <button type="submit" className="btn btn-primary" disabled={busy}>{l.recordCollection}</button>
        <p className="fund-hint">{l.collectionNote}</p></form>}
      {editable&&installment.status!=="CANCELLED"&&Number(installment.collected)===0&&<button type="button" className="btn btn-secondary" disabled={busy}
        onClick={()=>act(()=>cancelInstallment(installment.id,installment.version))}>{l.cancelInstallment}</button>}
    </div>}
  </div>;
}
