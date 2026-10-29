import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft, ArrowRight, BadgeCheck, BriefcaseBusiness, CheckCircle2, CircleAlert, CircleDashed, ClipboardCheck, FileLock2,
  HandCoins, LockKeyhole, LogOut, Plus, RefreshCw, Search, Send, ShieldCheck, UserRound, UsersRound,
} from "lucide-react";
import { ApiError, getAccounts, type AccountSummary } from "./api";
import {
  answerOffer, attachCandidate, confirmPlacement, createCandidate, createJobOrder, getApplications, getCandidate,
  getCandidates, getConsents, getInterviews, getJobOrder, getJobOrders, getPlacement, getPlacements, moveApplication, recordConsent,
  recordExit, recordOffer, recordOutcome, recordStart, requestFee, revokeConsent, saveOfferTerms, savePrivateProfile, scheduleInterview,
  setJobOrderStatus, submitApplication,
  type Application, type Candidate, type Consent, type ConsentMethod, type ExitReason, type Interview, type JobOrder, type PlacementRecord, type Stage,
} from "./recruitmentApi";
import type { Language } from "./preferences";
import "./recruitment.css";
import { Dialog } from "./Dialog";
import { amount, day, quantity } from "./format";
import { ErrorBanner, PageHeader } from "./ui";

const strings = {
  ar: {
    title:"التوظيف للعملاء",desc:"طلبات التوظيف من العملاء والمرشحون والموافقات ومسار الترشيح والتعيينات، ضمن صلاحياتك.",
    orders:"طلبات التوظيف",candidates:"المرشحون",newOrder:"طلب توظيف جديد",newCandidate:"مرشح جديد",search:"بحث",
    searchOrders:"ابحث بالمرجع أو المسمى الوظيفي",searchCandidates:"ابحث باسم المرشح",loading:"جار التحميل...",retry:"إعادة المحاولة",
    noOrders:"لا توجد طلبات توظيف",noCandidates:"لا يوجد مرشحون",open:"فتح",back:"العودة إلى التوظيف",
    reference:"المرجع",client:"العميل",chooseClient:"اختر العميل",jobTitle:"المسمى الوظيفي",headcount:"عدد الوظائف",location:"المكان",
    requirements:"المتطلبات",save:"حفظ",cancel:"إلغاء",recruiter:"مسؤول التوظيف",active:"في المسار",placed:"تم تعيينهم",
    status:{OPEN:"مفتوح",ON_HOLD:"معلّق",FILLED:"مكتمل",CLOSED:"مغلق"},hold:"تعليق",reopen:"إعادة فتح",close:"إغلاق الطلب",
    pipeline:"مسار المرشحين",addToPipeline:"إضافة مرشح للمسار",chooseCandidate:"اختر مرشحًا",add:"إضافة",empty:"لا يوجد",
    stages:{SOURCED:"مصدر",SCREENED:"تم الفرز",SHORTLISTED:"القائمة المختصرة",SUBMITTED:"مُرشح للعميل",INTERVIEWING:"مقابلات",OFFERED:"عرض عمل",PLACED:"تم التعيين",REJECTED:"مرفوض",WITHDRAWN:"انسحب"},
    consentOk:"موافقة سارية لهذا الطلب",consentMissing:"لا توجد موافقة سارية لهذا الطلب",
    screen:"تم الفرز",shortlist:"إلى القائمة المختصرة",reject:"رفض",withdraw:"انسحاب",submit:"ترشيح للعميل",
    submitNote:"يُشارك مع العميل الملف غير المقيّد بس (الاسم والخبرة). السيرة الذاتية وبيانات التواصل بتتشارك بس من بوابة العملاء وبموافقة المرشح على الطلب ده (D-04)، والبوابة لسه مش متاحة.",
    shareCv:"مشاركة السيرة الذاتية",interviews:"مقابلات العميل",round:"الجولة",scheduledAt:"الموعد",schedule:"جدولة مقابلة",
    outcomes:{PENDING:"بانتظار النتيجة",PASSED:"اجتاز",FAILED:"لم يجتز",NO_SHOW:"لم يحضر"},passed:"اجتاز",failed:"لم يجتز",noShow:"لم يحضر",
    offer:"عرض العمل",offerDate:"تاريخ العرض",recordOffer:"تسجيل عرض العميل",accepted:"قَبِل العرض",declined:"رفض العرض",
    offerNote:"الراتب السنوي المعروض بيتسجل ومش بيتعرض لحد؛ السيستم بيستخدمه بس عشان يحسب الأتعاب.",startDate:"تاريخ بدء العمل",place:"تأكيد التعيين",
    annualSalary:"الراتب السنوي المعروض",currencyCode:"العملة",saveOfferTerms:"تسجيل الراتب المعروض",offerTermsOnFile:"الراتب المعروض متسجّل (مش بيتعرض)",offerTermsMissing:"الراتب المعروض مش متسجّل؛ الأتعاب بتتحسب منه",
    placements:"التعيينات",guarantee:"الضمان",guaranteePending:"شروط الضمان بانتظار اتفاقية العميل",fees:"أحداث الأتعاب",
    fee:{OFFER_ACCEPTED:"قبول العرض",CANDIDATE_STARTED:"بدء العمل"},recordStarted:"تسجيل بدء العمل",invoice:"طلب الأتعاب من المالية",
    feeNote:"الأتعاب والضمان والبديل ماشيين على اتفاقية العميل. افتح التعيين عشان تشوف حالتهم.",feeCol:"الأتعاب",
    placementTitle:"التعيين",backToOrder:"العودة لطلب التوظيف",feeTitle:"أتعاب التعيين",guaranteeTitle:"فترة الضمان",
    feeStatus:{REQUESTED:"اتبعت للمالية",ISSUED:"اتعملت الفاتورة",CANCELLED:"اتلغى الطلب",POLICY_NOT_SET:"اتفاقية العميل مش مضبوطة",NOT_DUE:"لسه مش مستحقة",OFFER_TERMS_MISSING:"الراتب المعروض ناقص",WAIVED_REPLACEMENT:"بديل مجاني من غير أتعاب"},
    feeWhy:{POLICY_NOT_SET:"مفيش اتفاقية توظيف (السياسة recruitment.agreement) للعميل ده ولا قيمة عامة. مالك السياسات يضبطها من صفحة السياسات، وبعدها اطلب الأتعاب.",NOT_DUE:"الاتفاقية بتطلب الفاتورة يوم استلام الشغل: سجّل بدء العمل والطلب هيتبعت للمالية لوحده.",OFFER_TERMS_MISSING:"الأتعاب نسبة من الراتب السنوي المعروض: سجّله في طلب المرشح (مش هيتعرض).",WAIVED_REPLACEMENT:"التعيين ده هو البديل المجاني اللي الاتفاقية بتديه بعد ما مرشح سابق ساب في الضمان.",REQUESTED:"المالية هتصدر الفاتورة في الحسابات. الطلب بيتعمل مرة واحدة بس لكل تعيين.",ISSUED:"المالية أصدرت الفاتورة.",CANCELLED:"المالية لغت الطلب."},
    feeAmount:"قيمة الأتعاب قبل الضريبة",feeHidden:"القيمة بتظهر للمالية بس (لأنها بتكشف الراتب)",feePercent:"النسبة من الراتب السنوي",invoiceOnLabel:"الفاتورة عند",invoiceOn:{START_DATE:"استلام الشغل",OFFER_ACCEPTED:"قبول العرض"},requestedAt:"اتطلبت يوم",
    policiesLink:"صفحة السياسات",startedOn:"بدأ الشغل يوم",notStarted:"لسه ما بدأش",
    gStatus:{TERMS_PENDING:"مستني اتفاقية العميل",NOT_STARTED:"بيبدأ مع استلام الشغل",ACTIVE:"ساري",CLOSED:"خلص",EARLY_EXIT:"ساب في الضمان",EXITED_AFTER:"ساب بعد الضمان"},
    guaranteeDays:"مدة الضمان",days:"يوم",endsOn:"آخر يوم",daysLeft:"باقي",rule:"لو ساب في الضمان",
    rules:{REPLACE:"بديل مجاني",PARTIAL_REFUND:"استرداد جزئي",NONE:"لا شيء"},
    ruleWill:{REPLACE:"طلب التوظيف هيتفتح تاني لبديل مجاني، ومفيش أتعاب على البديل.",PARTIAL_REFUND:"هيتبعت للمالية طلب إشعار دائن بنسبة {p}% من الأتعاب.",NONE:"الاتفاقية مفيهاش بديل ولا استرداد؛ هيتسجل الترك بس.",AFTER:"التاريخ ده بعد آخر يوم في الضمان: هيتسجل الترك بس من غير بديل ولا استرداد.",NO_FEE:"مفيش طلب أتعاب اتبعت للمالية، فمفيش حاجة تتسترد."},
    exitAction:"تسجيل ترك المرشح للشغل",exitTitle:"المرشح ساب الشغل",exitedOn:"ساب يوم",exitReason:"السبب",reasons:{RESIGNED:"استقال",DISMISSED:"العميل أنهى التعاقد",OTHER:"سبب تاني"},
    willHappen:"اللي هيحصل حسب اتفاقية العميل",confirmExit:"تسجيل الترك",
    outcomes2:{REPLACEMENT_OPENED:"اتفتح طلب بديل مجاني",REFUND_REQUESTED:"اتبعت للمالية طلب إشعار دائن",NO_REMEDY:"مفيش بديل ولا استرداد حسب الاتفاقية",OUTSIDE_GUARANTEE:"ساب بعد الضمان",NO_FEE_TO_REFUND:"مفيش أتعاب تتسترد"},
    refund:"الإشعار الدائن",replacementOf:"بديل مجاني لتعيين سابق",openPlacement:"فتح التعيين",termsPendingNote:"الاتفاقية لسه ما اتطبقتش على التعيين ده: لو مضبوطة دلوقتي هتتطبق وقت التسجيل، ولو مش مضبوطة التسجيل هيترفض.",
    profile:"الملف غير المقيّد",displayName:"الاسم",headline:"الدور الحالي",years:"سنوات الخبرة",
    privateTitle:"البيانات المقيّدة",privateOnFile:"مسجلة (لا تُعرض)",privateNone:"غير مسجلة",
    privateNote:"البريد والهاتف والراتب المتوقع ومرجع السيرة الذاتية تُسجل ولا تُعرض. قراءتها متوقفة حتى اعتماد D-04 وD-07.",
    email:"البريد الإلكتروني",phone:"الهاتف",salary:"الراتب المتوقع",cv:"مرجع السيرة الذاتية",savePrivate:"تسجيل البيانات المقيّدة",
    consents:"الموافقات",noConsents:"لا توجد موافقات مسجلة",jobOrder:"طلب التوظيف",chooseOrder:"اختر طلب التوظيف",method:"طريقة الموافقة",
    methods:{WRITTEN:"كتابية",EMAIL:"بريد إلكتروني",RECORDED_CALL:"مكالمة مسجلة"},givenOn:"تاريخ الموافقة",evidence:"مرجع الإثبات",
    recordConsent:"تسجيل موافقة",revoke:"سحب الموافقة",revoked:"مسحوبة",readonly:"عرض فقط: المسؤول وحده يعدّل هذا السجل.",
    errors:{POLICY_NOT_SET:"اتفاقية التوظيف للعميل ده مش مضبوطة؛ مالك السياسات يضبطها من صفحة السياسات.",FEE_NOT_DUE:"الأتعاب لسه مش مستحقة: الاتفاقية بتطلبها يوم استلام الشغل.",OFFER_TERMS_MISSING:"سجّل الراتب السنوي المعروض الأول.",FEE_WAIVED:"ده بديل مجاني ومالوش أتعاب.",FEE_REQUESTED:"الأتعاب اتطلبت بالفعل؛ الراتب المعروض مبيتغيرش بعدها.",ALREADY_EXITED:"ترك المرشح متسجّل بالفعل.",NOT_STARTED:"سجّل بدء العمل الأول.",CONSENT_REQUIRED:"سجّل موافقة المرشح على هذا الطلب قبل ترشيحه للعميل.",STAGE_TRANSITION:"هذا الانتقال غير مسموح من المرحلة الحالية.",ALREADY_IN_PIPELINE:"المرشح موجود بالفعل في مسار هذا الطلب.",ORDER_NOT_OPEN:"طلب التوظيف ليس مفتوحًا.",ORDER_STATE:"لا يمكن تغيير حالة طلب مكتمل أو مغلق.",ALREADY_PLACED:"تم تعيين هذا المرشح بالفعل.",HEADCOUNT_FILLED:"اكتملت كل وظائف هذا الطلب.",OUTCOME_RECORDED:"سُجلت نتيجة هذه المقابلة بالفعل.",CONSENT_REVOKED:"هذه الموافقة مسحوبة بالفعل.",BLOCKED_BY_POLICY:"متوقف حتى اعتماد السياسة.",conflict:"تم تعديل البيانات من مكان آخر؛ حدّثناها، أعد المحاولة.",invalid:"راجع الحقول المطلوبة وقيمها.",denied:"ليست لديك صلاحية لهذا الإجراء.",failed:"تعذّر تنفيذ الطلب."},
  },
  en: {
    title:"Client recruitment",desc:"Client job orders, candidates, consent, the submission pipeline and placements, within your permissions.",
    orders:"Job orders",candidates:"Candidates",newOrder:"New job order",newCandidate:"New candidate",search:"Search",
    searchOrders:"Search by reference or job title",searchCandidates:"Search by candidate name",loading:"Loading...",retry:"Retry",
    noOrders:"No job orders",noCandidates:"No candidates",open:"Open",back:"Back to recruitment",
    reference:"Reference",client:"Client",chooseClient:"Choose a client",jobTitle:"Job title",headcount:"Positions",location:"Location",
    requirements:"Requirements",save:"Save",cancel:"Cancel",recruiter:"Recruiter",active:"In pipeline",placed:"Placed",
    status:{OPEN:"Open",ON_HOLD:"On hold",FILLED:"Filled",CLOSED:"Closed"},hold:"Put on hold",reopen:"Reopen",close:"Close order",
    pipeline:"Candidate pipeline",addToPipeline:"Add a candidate to the pipeline",chooseCandidate:"Choose a candidate",add:"Add",empty:"None",
    stages:{SOURCED:"Sourced",SCREENED:"Screened",SHORTLISTED:"Shortlisted",SUBMITTED:"Submitted",INTERVIEWING:"Interviewing",OFFERED:"Offered",PLACED:"Placed",REJECTED:"Rejected",WITHDRAWN:"Withdrawn"},
    consentOk:"Valid consent for this job order",consentMissing:"No valid consent for this job order",
    screen:"Mark screened",shortlist:"Shortlist",reject:"Reject",withdraw:"Withdraw",submit:"Submit to client",
    submitNote:"Only the non-restricted profile (name, experience) is shared. The CV and contact details are shared only through the client portal with the candidate's consent for this job order (D-04); the portal is not available yet.",
    shareCv:"Share CV",interviews:"Client interviews",round:"Round",scheduledAt:"Scheduled at",schedule:"Schedule interview",
    outcomes:{PENDING:"Awaiting outcome",PASSED:"Passed",FAILED:"Failed",NO_SHOW:"No show"},passed:"Passed",failed:"Failed",noShow:"No show",
    offer:"Job offer",offerDate:"Offer date",recordOffer:"Record client offer",accepted:"Offer accepted",declined:"Offer declined",
    offerNote:"The offered annual salary is recorded but never shown; it is used only to compute the fee.",startDate:"Start date",place:"Confirm placement",
    annualSalary:"Offered annual salary",currencyCode:"Currency",saveOfferTerms:"Record offered salary",offerTermsOnFile:"Offered salary on file (not shown)",offerTermsMissing:"No offered salary on file; the fee is computed from it",
    placements:"Placements",guarantee:"Guarantee",guaranteePending:"Guarantee terms wait for the client agreement",fees:"Fee events",
    fee:{OFFER_ACCEPTED:"Offer accepted",CANDIDATE_STARTED:"Candidate started"},recordStarted:"Record start",invoice:"Request the fee from finance",
    feeNote:"Fees, the guarantee and replacements follow the client's agreement. Open a placement to see them.",feeCol:"Fee",
    placementTitle:"Placement",backToOrder:"Back to the job order",feeTitle:"Placement fee",guaranteeTitle:"Guarantee period",
    feeStatus:{REQUESTED:"Sent to finance",ISSUED:"Invoiced",CANCELLED:"Request cancelled",POLICY_NOT_SET:"Client agreement not set",NOT_DUE:"Not due yet",OFFER_TERMS_MISSING:"Offered salary missing",WAIVED_REPLACEMENT:"Free replacement, no fee"},
    feeWhy:{POLICY_NOT_SET:"There is no recruitment agreement (policy recruitment.agreement) for this client and no default. A policy owner sets it under Policies; then request the fee.",NOT_DUE:"The agreement invoices on the start date: record the start and the request goes to finance by itself.",OFFER_TERMS_MISSING:"The fee is a share of the offered annual salary: record it on the candidate's application (it is never shown).",WAIVED_REPLACEMENT:"This placement is the free replacement the agreement grants after an earlier candidate left within the guarantee.",REQUESTED:"Finance issues the invoice in accounting. There is one request per placement.",ISSUED:"Finance issued the invoice.",CANCELLED:"Finance cancelled the request."},
    feeAmount:"Fee before tax",feeHidden:"Shown to finance only (it reveals the salary)",feePercent:"Share of annual salary",invoiceOnLabel:"Invoiced on",invoiceOn:{START_DATE:"Start date",OFFER_ACCEPTED:"Offer accepted"},requestedAt:"Requested on",
    policiesLink:"Policies",startedOn:"Started on",notStarted:"Not started yet",
    gStatus:{TERMS_PENDING:"Waiting for the client agreement",NOT_STARTED:"Starts with the first working day",ACTIVE:"Running",CLOSED:"Ended",EARLY_EXIT:"Left within the guarantee",EXITED_AFTER:"Left after the guarantee"},
    guaranteeDays:"Guarantee",days:"days",endsOn:"Last day",daysLeft:"Left",rule:"If the candidate leaves in the guarantee",
    rules:{REPLACE:"Free replacement",PARTIAL_REFUND:"Partial refund",NONE:"Nothing"},
    ruleWill:{REPLACE:"The job order reopens for a free replacement; the replacement carries no fee.",PARTIAL_REFUND:"Finance gets a credit-note request for {p}% of the fee.",NONE:"The agreement grants no replacement or refund; only the departure is recorded.",AFTER:"That date is after the guarantee's last day: only the departure is recorded.",NO_FEE:"No fee request was sent to finance, so there is nothing to refund."},
    exitAction:"Record that the candidate left",exitTitle:"The candidate left",exitedOn:"Left on",exitReason:"Reason",reasons:{RESIGNED:"Resigned",DISMISSED:"Client ended the contract",OTHER:"Other reason"},
    willHappen:"What happens under the client agreement",confirmExit:"Record departure",
    outcomes2:{REPLACEMENT_OPENED:"Free replacement opened",REFUND_REQUESTED:"Credit-note request sent to finance",NO_REMEDY:"No replacement or refund under the agreement",OUTSIDE_GUARANTEE:"Left after the guarantee",NO_FEE_TO_REFUND:"No fee to refund"},
    refund:"Credit note",replacementOf:"Free replacement of an earlier placement",openPlacement:"Open placement",termsPendingNote:"No client agreement is applied to this placement yet: if one is set now it applies when you record; if not, recording is refused.",
    profile:"Non-restricted profile",displayName:"Name",headline:"Current role",years:"Years of experience",
    privateTitle:"Restricted data",privateOnFile:"On file (not shown)",privateNone:"Not on file",
    privateNote:"E-mail, phone, expected salary and CV reference are recorded but never shown. Reading them waits for D-04 and D-07.",
    email:"E-mail",phone:"Phone",salary:"Expected salary",cv:"CV reference",savePrivate:"Record restricted data",
    consents:"Consents",noConsents:"No consents recorded",jobOrder:"Job order",chooseOrder:"Choose a job order",method:"Method",
    methods:{WRITTEN:"Written",EMAIL:"E-mail",RECORDED_CALL:"Recorded call"},givenOn:"Given on",evidence:"Evidence reference",
    recordConsent:"Record consent",revoke:"Revoke consent",revoked:"Revoked",readonly:"Read only: only the owner changes this record.",
    errors:{POLICY_NOT_SET:"The client's recruitment agreement is not set; a policy owner sets it under Policies.",FEE_NOT_DUE:"The fee is not due yet: the agreement invoices on the start date.",OFFER_TERMS_MISSING:"Record the offered annual salary first.",FEE_WAIVED:"This is a free replacement without a fee.",FEE_REQUESTED:"The fee was already requested; the offered salary no longer changes.",ALREADY_EXITED:"The departure is already recorded.",NOT_STARTED:"Record the start first.",CONSENT_REQUIRED:"Record the candidate's consent for this job order before submitting.",STAGE_TRANSITION:"This change is not allowed from the current stage.",ALREADY_IN_PIPELINE:"The candidate is already in this job order's pipeline.",ORDER_NOT_OPEN:"The job order is not open.",ORDER_STATE:"A filled or closed job order cannot change status.",ALREADY_PLACED:"This candidate is already placed.",HEADCOUNT_FILLED:"Every position of this job order is filled.",OUTCOME_RECORDED:"This interview already has an outcome.",CONSENT_REVOKED:"This consent is already revoked.",BLOCKED_BY_POLICY:"Blocked until the policy is signed.",conflict:"The data changed elsewhere; it is refreshed, try again.",invalid:"Check the required fields and their values.",denied:"You do not have permission for this action.",failed:"The request failed."},
  },
} as const;
type Labels = typeof strings.ar | typeof strings.en;
const BOARD: Stage[] = ["SOURCED","SCREENED","SHORTLISTED","SUBMITTED","INTERVIEWING","OFFERED","PLACED"];

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
  const read = () => window.location.hash.replace(/^#\/recruitment\/?/, "").split("/").filter(Boolean);
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

/** Client recruitment workspace (real mode). */
export function RecruitmentPage({language}:{language:Language}){
  const l=strings[language];
  const route=useRoute();
  const Back=language==="ar"?ArrowRight:ArrowLeft;
  if(route[0]==="orders"&&/^\d+$/.test(route[1]||""))return <JobOrderRecord key={route[1]} orderId={Number(route[1])} l={l} Back={Back}/>;
  if(route[0]==="candidates"&&/^\d+$/.test(route[1]||""))return <CandidateRecord key={route[1]} candidateId={Number(route[1])} l={l} Back={Back}/>;
  if(route[0]==="placements"&&/^\d+$/.test(route[1]||""))return <PlacementPage key={route[1]} placementId={Number(route[1])} l={l} ar={language==="ar"} Back={Back}/>;
  const tab=route[0]==="candidates"?"candidates":"orders";
  return <section className="page-enter rec-page">
    <PageHeader className="directory-head" eyebrow={language==="ar"?"التنفيذ والخدمات":"Delivery & services"} title={l.title} description={l.desc}/>
    <div className="demo-record-tabs rec-tabs" role="tablist" aria-label={l.title}>
      <button type="button" role="tab" aria-selected={tab==="orders"} className={tab==="orders"?"active":""} onClick={()=>{window.location.hash="#/recruitment";}}>{l.orders}</button>
      <button type="button" role="tab" aria-selected={tab==="candidates"} className={tab==="candidates"?"active":""} onClick={()=>{window.location.hash="#/recruitment/candidates";}}>{l.candidates}</button>
    </div>
    {tab==="orders"?<OrdersRegister l={l}/>:<CandidatesRegister l={l}/>}
  </section>;
}

function OrdersRegister({l}:{l:Labels}){
  const [rows,setRows]=useState<JobOrder[]|null>(null);const [q,setQ]=useState("");const [applied,setApplied]=useState("");
  const [error,setError]=useState("");const [creating,setCreating]=useState(false);
  const load=useCallback(()=>getJobOrders(applied||undefined).then(setRows),[applied]);
  useEffect(()=>{setRows(null);setError("");void load().catch(e=>{setRows([]);setError(message(e,l));});},[load,l]);
  return <>
    <form className="list-toolbar rec-toolbar" role="search" onSubmit={e=>{e.preventDefault();setApplied(q.trim());}}>
      <label className="search-field"><Search size={18}/><span className="sr-only">{l.searchOrders}</span><input value={q} maxLength={100} placeholder={l.searchOrders} onChange={e=>setQ(e.target.value)}/></label>
      <button type="submit" className="btn btn-secondary"><Search size={16}/>{l.search}</button>
      <button type="button" className="btn btn-primary" onClick={()=>setCreating(c=>!c)}><Plus size={16}/>{l.newOrder}</button>
    </form>
    {creating&&<OrderForm l={l} onCancel={()=>setCreating(false)} onCreated={o=>{window.location.hash="#/recruitment/orders/"+o.id;}}/>}
    {error&&<div className="error-banner" role="alert"><CircleAlert size={17}/><span>{error}</span><button type="button" className="btn btn-secondary" onClick={()=>void load().then(()=>setError("")).catch(e=>setError(message(e,l)))}><RefreshCw size={15}/>{l.retry}</button></div>}
    <div className="data-panel"><div className="data-panel-heading"><strong>{l.orders}</strong><span>{rows?.length??0}</span></div>
      {rows===null?<div className="empty-state" role="status">{l.loading}</div>:rows.length===0?<div className="empty-state"><CircleDashed size={26}/>{l.noOrders}</div>
      :<div className="directory-items">{rows.map(o=><article className="directory-item rec-row" key={o.id}>
        <div className="line-monogram">{o.title.slice(0,1)}</div>
        <div className="directory-record"><strong>{o.title}</strong><small>{o.clientName||"—"} · <span dir="ltr">{o.reference}</span>{o.location?` · ${o.location}`:""}</small></div>
        <span className={"rec-status rec-status-"+o.status.toLowerCase()}>{l.status[o.status]}</span>
        <span className="rec-count" title={l.placed}>{o.placed}/{o.headcount}</span>
        <a className="text-action" href={"#/recruitment/orders/"+o.id}>{l.open}</a>
      </article>)}</div>}
    </div>
  </>;
}

function OrderForm({l,onCancel,onCreated}:{l:Labels;onCancel:()=>void;onCreated:(o:JobOrder)=>void}){
  const [accounts,setAccounts]=useState<AccountSummary[]>([]);
  const [reference,setReference]=useState("");const [clientId,setClientId]=useState("");const [title,setTitle]=useState("");
  const [headcount,setHeadcount]=useState("1");const [location,setLocation]=useState("");const [requirements,setRequirements]=useState("");
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  useEffect(()=>{void getAccounts(0,50).then(setAccounts).catch(()=>setAccounts([]));},[]);
  return <form className="record-content-card opportunity-form rec-form" onSubmit={e=>{e.preventDefault();if(busy)return;setBusy(true);setError("");
    createJobOrder({reference,clientId:Number(clientId),title,headcount:Number(headcount),...(location?{location}:{}),...(requirements?{requirements}:{})})
      .then(onCreated).catch(err=>setError(message(err,l))).finally(()=>setBusy(false));}}>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    <label><span>{l.reference}</span><input required dir="ltr" maxLength={30} value={reference} onChange={e=>setReference(e.target.value)}/></label>
    <label><span>{l.client}</span><select required value={clientId} onChange={e=>setClientId(e.target.value)}>
      <option value="">{l.chooseClient}</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <label><span>{l.jobTitle}</span><input required maxLength={255} value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label><span>{l.headcount}</span><input type="number" min="1" max="500" required value={headcount} onChange={e=>setHeadcount(e.target.value)}/></label>
    <label><span>{l.location}</span><input maxLength={255} value={location} onChange={e=>setLocation(e.target.value)}/></label>
    <label className="rec-wide"><span>{l.requirements}</span><textarea rows={3} maxLength={4000} value={requirements} onChange={e=>setRequirements(e.target.value)}/></label>
    <div className="lead-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{l.save}</button><button type="button" className="btn btn-secondary" onClick={onCancel}>{l.cancel}</button></div>
  </form>;
}

function JobOrderRecord({orderId,l,Back}:{orderId:number;l:Labels;Back:typeof ArrowLeft}){
  const [order,setOrder]=useState<JobOrder|null>(null);const [apps,setApps]=useState<Application[]>([]);
  const [placements,setPlacements]=useState<PlacementRecord[]>([]);const [candidates,setCandidates]=useState<Candidate[]>([]);
  const [selected,setSelected]=useState<number|null>(null);const [pick,setPick]=useState("");const [loadError,setLoadError]=useState("");
  const reload=useCallback(async()=>{
    const [o,a,p]=await Promise.all([getJobOrder(orderId),getApplications(orderId),getPlacements(orderId)]);
    setOrder(o);setApps(a);setPlacements(p);
  },[orderId]);
  useEffect(()=>{void reload().catch(e=>setLoadError(message(e,l)));void getCandidates().then(setCandidates).catch(()=>setCandidates([]));},[reload,l]);
  const {busy,error,run}=useAction(l,reload);
  if(loadError)return <section className="page-enter"><a className="record-back" href="#/recruitment"><Back size={17}/>{l.back}</a><ErrorBanner message={loadError}/></section>;
  if(!order)return <div className="empty-state" role="status">{l.loading}</div>;
  const editable=order.recruitedByMe;
  const current=apps.find(a=>a.id===selected)||null;
  return <article className="record-workspace page-enter rec-record" aria-labelledby="order-title">
    <div className="record-context-bar"><a className="record-back" href="#/recruitment"><Back size={17}/>{l.back}</a><span className="record-context-separator">/</span><span className="record-current" dir="ltr">{order.reference}</span></div>
    <div className="record-hero"><div className="record-hero-main">
      <span className="eyebrow"><span className="record-eyebrow-dot"/>{l.orders} · {order.clientName||"—"}</span>
      <div className="record-hero-heading"><div className="record-identity-icon"><BriefcaseBusiness size={30}/></div>
        <div><h1 id="order-title">{order.title}</h1><div className="record-tags"><span className={"rec-status rec-status-"+order.status.toLowerCase()}>{l.status[order.status]}</span>
          <span className="record-ref" dir="ltr">{order.reference}</span>{order.clientId!=null&&<a className="record-ref" href={"#/accounts/"+order.clientId}>{l.client}</a>}</div></div></div>
      {order.requirements&&<p className="record-hero-description">{order.requirements}</p>}
    </div><div className="record-hero-actions">
      <dl className="rec-kpis"><div><dt>{l.headcount}</dt><dd>{order.headcount}</dd></div><div><dt>{l.active}</dt><dd>{order.activeCandidates}</dd></div><div><dt>{l.placed}</dt><dd>{order.placed}</dd></div></dl>
      {editable&&(order.status==="OPEN"||order.status==="ON_HOLD")&&<div className="lead-actions">
        {order.status==="OPEN"?<button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void run(()=>setJobOrderStatus(order.id,order.version,"ON_HOLD"))}>{l.hold}</button>
        :<button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void run(()=>setJobOrderStatus(order.id,order.version,"OPEN"))}>{l.reopen}</button>}
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void run(()=>setJobOrderStatus(order.id,order.version,"CLOSED"))}>{l.close}</button></div>}
    </div></div>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {!editable&&<p className="record-security-note"><LockKeyhole size={15}/>{l.readonly}</p>}
    <section className="record-content-card" aria-labelledby="pipeline-title">
      <div className="record-section-header"><div className="record-section-icon"><UsersRound size={20}/></div><div><h2 id="pipeline-title">{l.pipeline}</h2></div></div>
      <div className="rec-board" role="list">{BOARD.map(stage=>{const items=apps.filter(a=>a.stage===stage);
        return <section key={stage} className="rec-column" role="listitem" aria-label={l.stages[stage]}><h3>{l.stages[stage]} <span>{items.length}</span></h3>
          {items.length===0?<p className="rec-muted">{l.empty}</p>:items.map(a=><button type="button" key={a.id} className={"rec-card"+(selected===a.id?" is-selected":"")}
            aria-pressed={selected===a.id} onClick={()=>setSelected(a.id)}><strong>{a.candidateName}</strong><small>{a.candidateHeadline||""}</small>
            <span className={a.consentOnFile?"rec-consent-ok":"rec-consent-missing"}>{a.consentOnFile?<CheckCircle2 size={13}/>:<CircleAlert size={13}/>}{a.consentOnFile?l.consentOk:l.consentMissing}</span></button>)}
        </section>;})}</div>
      {apps.some(a=>a.stage==="REJECTED"||a.stage==="WITHDRAWN")&&<p className="rec-muted">{apps.filter(a=>a.stage==="REJECTED"||a.stage==="WITHDRAWN").map(a=>`${a.candidateName} (${l.stages[a.stage]})`).join(" · ")}</p>}
      {editable&&order.status==="OPEN"&&<form className="opportunity-form rec-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await attachCandidate(order.id,order.version,Number(pick));setPick("");});}}>
        <label><span>{l.addToPipeline}</span><select required value={pick} onChange={e=>setPick(e.target.value)}>
          <option value="">{l.chooseCandidate}</option>{candidates.filter(c=>!apps.some(a=>a.candidateId===c.id)).map(c=><option key={c.id} value={c.id}>{c.displayName}</option>)}</select></label>
        <button type="submit" className="btn btn-secondary" disabled={busy||!pick}><Plus size={16}/>{l.add}</button></form>}
    </section>
    {current&&<ApplicationPanel key={current.id+":"+current.version} app={current} editable={editable} l={l} run={run} busy={busy}/>}
    <section className="record-content-card" aria-labelledby="placements-title">
      <div className="record-section-header"><div className="record-section-icon"><ClipboardCheck size={20}/></div><div><h2 id="placements-title">{l.placements}</h2></div></div>
      {placements.length===0?<p className="rec-muted">{l.empty}</p>:<div className="table-scroll"><table><thead><tr><th>{l.displayName}</th><th>{l.startDate}</th><th>{l.guarantee}</th><th>{l.fees}</th><th>{l.feeCol}</th><th><span className="sr-only">{l.openPlacement}</span></th></tr></thead>
        <tbody>{placements.map(p=><tr key={p.id}><td><strong>{p.candidateName}</strong></td><td dir="ltr">{p.startDate}</td>
          <td>{(l.gStatus as Record<string,string>)[p.guaranteeStatus]??l.guaranteePending}</td>
          <td>{p.feeMilestones.map(f=>l.fee[f]).join(" · ")||"—"}</td>
          <td>{(l.feeStatus as Record<string,string>)[p.invoicingStatus]??"—"}</td>
          <td className="rec-row-actions">{editable&&!p.feeMilestones.includes("CANDIDATE_STARTED")&&<button type="button" className="text-action" disabled={busy} onClick={()=>void run(()=>recordStart(p.id,p.startDate))}>{l.recordStarted}</button>}
            <a className="text-action" href={"#/recruitment/placements/"+p.id}>{l.openPlacement}</a></td></tr>)}</tbody></table></div>}
      <p className="record-security-note" id="rec-fee-note"><ShieldCheck size={15}/>{l.feeNote}</p>
    </section>
  </article>;
}

function ApplicationPanel({app,editable,l,run,busy}:{app:Application;editable:boolean;l:Labels;run:(a:()=>Promise<unknown>)=>Promise<boolean>;busy:boolean}){
  const [interviews,setInterviews]=useState<Interview[]>([]);const [round,setRound]=useState("1");const [at,setAt]=useState("");
  const [offerOn,setOfferOn]=useState(today());const [start,setStart]=useState("");
  const [salary,setSalary]=useState("");const [currency,setCurrency]=useState("EGP");
  const loadInterviews=useCallback(()=>getInterviews(app.id).then(setInterviews).catch(()=>setInterviews([])),[app.id]);
  useEffect(()=>{void loadInterviews();},[loadInterviews]);
  const act=(a:()=>Promise<unknown>)=>void run(a).then(()=>loadInterviews());
  return <section className="record-content-card rec-application" aria-labelledby="app-title">
    <div className="record-section-header"><div className="record-section-icon"><UserRound size={20}/></div><div>
      <h2 id="app-title">{app.candidateName}</h2><p>{l.stages[app.stage]} · <a href={"#/recruitment/candidates/"+app.candidateId}>{l.profile}</a></p></div></div>
    <p className={app.consentOnFile?"rec-consent-ok":"rec-consent-missing"}>{app.consentOnFile?<CheckCircle2 size={15}/>:<CircleAlert size={15}/>}{app.consentOnFile?l.consentOk:l.consentMissing}</p>
    {editable&&<div className="lead-actions">
      {app.stage==="SOURCED"&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>act(()=>moveApplication(app.id,app.version,"SCREENED"))}>{l.screen}</button>}
      {app.stage==="SCREENED"&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>act(()=>moveApplication(app.id,app.version,"SHORTLISTED"))}>{l.shortlist}</button>}
      {app.stage==="SHORTLISTED"&&<button type="button" className="btn btn-primary" disabled={busy} onClick={()=>act(()=>submitApplication(app.id,app.version))}><Send size={15}/>{l.submit}</button>}
      {!["PLACED","REJECTED","WITHDRAWN"].includes(app.stage)&&<>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>act(()=>moveApplication(app.id,app.version,"REJECTED"))}>{l.reject}</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>act(()=>moveApplication(app.id,app.version,"WITHDRAWN"))}>{l.withdraw}</button></>}
      <button type="button" className="btn btn-secondary" disabled aria-describedby="rec-submit-note"><FileLock2 size={15}/>{l.shareCv}</button>
    </div>}
    <p className="record-security-note" id="rec-submit-note"><LockKeyhole size={15}/>{l.submitNote}</p>
    {["SUBMITTED","INTERVIEWING","OFFERED","PLACED"].includes(app.stage)&&<div className="rec-sub"><h3>{l.interviews}</h3>
      {interviews.length===0?<p className="rec-muted">{l.empty}</p>:<ul className="rec-list">{interviews.map(i=><li key={i.id}>
        <span>{l.round} {i.round} · <span dir="ltr">{i.scheduledAt.replace("T"," ").slice(0,16)}</span> · <strong>{l.outcomes[i.outcome]}</strong></span>
        {editable&&i.outcome==="PENDING"&&<span className="lead-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>act(()=>recordOutcome(i.id,i.version,"PASSED"))}>{l.passed}</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>act(()=>recordOutcome(i.id,i.version,"FAILED"))}>{l.failed}</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>act(()=>recordOutcome(i.id,i.version,"NO_SHOW"))}>{l.noShow}</button></span>}
      </li>)}</ul>}
      {editable&&(app.stage==="SUBMITTED"||app.stage==="INTERVIEWING")&&<form className="opportunity-form rec-form" onSubmit={e=>{e.preventDefault();act(()=>scheduleInterview(app.id,app.version,Number(round),at));}}>
        <label><span>{l.round}</span><input type="number" min="1" max="10" required value={round} onChange={e=>setRound(e.target.value)}/></label>
        <label><span>{l.scheduledAt}</span><input type="datetime-local" required value={at} onChange={e=>setAt(e.target.value)}/></label>
        <button type="submit" className="btn btn-secondary" disabled={busy}><Plus size={16}/>{l.schedule}</button></form>}
    </div>}
    {(app.stage==="INTERVIEWING"||app.stage==="OFFERED"||app.stage==="PLACED")&&<div className="rec-sub"><h3>{l.offer}</h3>
      {app.offerDate&&<p><span dir="ltr">{app.offerDate}</span> · {app.offerStatus==="ACCEPTED"?l.accepted:app.offerStatus==="DECLINED"?l.declined:"…"}</p>}
      {editable&&app.stage==="INTERVIEWING"&&<form className="opportunity-form rec-form" autoComplete="off" onSubmit={e=>{e.preventDefault();
          act(async()=>{await recordOffer(app.id,app.version,offerOn,salary?{annualSalary:salary,currencyCode:currency}:undefined);setSalary("");});}}>
        <label><span>{l.offerDate}</span><input type="date" required value={offerOn} onChange={e=>setOfferOn(e.target.value)}/></label>
        <label><span>{l.annualSalary}</span><input inputMode="decimal" dir="ltr" value={salary} onChange={e=>setSalary(e.target.value)}/></label>
        <label><span>{l.currencyCode}</span><input dir="ltr" maxLength={3} pattern="[A-Z]{3}" value={currency} onChange={e=>setCurrency(e.target.value.toUpperCase())}/></label>
        <button type="submit" className="btn btn-secondary" disabled={busy}>{l.recordOffer}</button></form>}
      {(app.stage==="OFFERED"||app.stage==="PLACED")&&<p className={app.offerTermsOnFile?"rec-consent-ok":"rec-consent-missing"}>
        {app.offerTermsOnFile?<FileLock2 size={14}/>:<CircleAlert size={14}/>}{app.offerTermsOnFile?l.offerTermsOnFile:l.offerTermsMissing}</p>}
      {editable&&(app.stage==="OFFERED"||app.stage==="PLACED")&&!app.offerTermsOnFile&&<form className="opportunity-form rec-form" autoComplete="off"
        onSubmit={e=>{e.preventDefault();act(async()=>{await saveOfferTerms(app.id,app.version,salary,currency);setSalary("");});}}>
        <label><span>{l.annualSalary}</span><input required inputMode="decimal" dir="ltr" value={salary} onChange={e=>setSalary(e.target.value)}/></label>
        <label><span>{l.currencyCode}</span><input required dir="ltr" maxLength={3} pattern="[A-Z]{3}" value={currency} onChange={e=>setCurrency(e.target.value.toUpperCase())}/></label>
        <button type="submit" className="btn btn-secondary" disabled={busy}><FileLock2 size={15}/>{l.saveOfferTerms}</button></form>}
      {editable&&app.stage==="OFFERED"&&app.offerStatus==="PENDING"&&<div className="lead-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={()=>act(()=>answerOffer(app.id,app.version,true))}>{l.accepted}</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>act(()=>answerOffer(app.id,app.version,false))}>{l.declined}</button></div>}
      {editable&&app.stage==="OFFERED"&&app.offerStatus==="ACCEPTED"&&<form className="opportunity-form rec-form" onSubmit={e=>{e.preventDefault();act(()=>confirmPlacement(app.id,app.version,start));}}>
        <label><span>{l.startDate}</span><input type="date" required value={start} onChange={e=>setStart(e.target.value)}/></label>
        <button type="submit" className="btn btn-primary" disabled={busy}>{l.place}</button></form>}
      <p className="rec-muted">{l.offerNote}</p>
    </div>}
  </section>;
}

function CandidatesRegister({l}:{l:Labels}){
  const [rows,setRows]=useState<Candidate[]|null>(null);const [q,setQ]=useState("");const [applied,setApplied]=useState("");
  const [creating,setCreating]=useState(false);const [error,setError]=useState("");
  const [name,setName]=useState("");const [headline,setHeadline]=useState("");const [years,setYears]=useState("");const [busy,setBusy]=useState(false);
  const load=useCallback(()=>getCandidates(applied||undefined).then(setRows),[applied]);
  useEffect(()=>{setRows(null);void load().catch(e=>{setRows([]);setError(message(e,l));});},[load,l]);
  return <>
    <form className="list-toolbar rec-toolbar" role="search" onSubmit={e=>{e.preventDefault();setApplied(q.trim());}}>
      <label className="search-field"><Search size={18}/><span className="sr-only">{l.searchCandidates}</span><input value={q} maxLength={100} placeholder={l.searchCandidates} onChange={e=>setQ(e.target.value)}/></label>
      <button type="submit" className="btn btn-secondary"><Search size={16}/>{l.search}</button>
      <button type="button" className="btn btn-primary" onClick={()=>setCreating(c=>!c)}><Plus size={16}/>{l.newCandidate}</button>
    </form>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {creating&&<form className="record-content-card opportunity-form rec-form" onSubmit={e=>{e.preventDefault();if(busy)return;setBusy(true);setError("");
      createCandidate({displayName:name,...(headline?{headline}:{}),...(years?{yearsExperience:Number(years)}:{})})
        .then(c=>{window.location.hash="#/recruitment/candidates/"+c.id;}).catch(err=>setError(message(err,l))).finally(()=>setBusy(false));}}>
      <label><span>{l.displayName}</span><input required maxLength={255} value={name} onChange={e=>setName(e.target.value)}/></label>
      <label><span>{l.headline}</span><input maxLength={255} value={headline} onChange={e=>setHeadline(e.target.value)}/></label>
      <label><span>{l.years}</span><input type="number" min="0" max="60" value={years} onChange={e=>setYears(e.target.value)}/></label>
      <div className="lead-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{l.save}</button><button type="button" className="btn btn-secondary" onClick={()=>setCreating(false)}>{l.cancel}</button></div>
    </form>}
    <div className="data-panel"><div className="data-panel-heading"><strong>{l.candidates}</strong><span>{rows?.length??0}</span></div>
      {rows===null?<div className="empty-state" role="status">{l.loading}</div>:rows.length===0?<div className="empty-state"><CircleDashed size={26}/>{l.noCandidates}</div>
      :<div className="directory-items">{rows.map(c=><article className="directory-item" key={c.id}>
        <div className="line-monogram">{c.displayName.slice(0,1)}</div>
        <div className="directory-record"><strong>{c.displayName}</strong><small>{c.headline||"—"}{c.yearsExperience!=null?` · ${c.yearsExperience}`:""}</small></div>
        <span className="rec-private">{c.privateProfileOnFile?<FileLock2 size={14}/>:null}{c.privateProfileOnFile?l.privateOnFile:l.privateNone}</span>
        <a className="text-action" href={"#/recruitment/candidates/"+c.id}>{l.open}</a>
      </article>)}</div>}
    </div>
  </>;
}

function CandidateRecord({candidateId,l,Back}:{candidateId:number;l:Labels;Back:typeof ArrowLeft}){
  const [cand,setCand]=useState<Candidate|null>(null);const [consents,setConsents]=useState<Consent[]>([]);const [orders,setOrders]=useState<JobOrder[]>([]);
  const [loadError,setLoadError]=useState("");
  const [email,setEmail]=useState("");const [phone,setPhone]=useState("");const [salary,setSalary]=useState("");const [cv,setCv]=useState("");
  const [orderId,setOrderId]=useState("");const [method,setMethod]=useState<ConsentMethod>("WRITTEN");const [givenOn,setGivenOn]=useState(today());const [evidence,setEvidence]=useState("");
  const reload=useCallback(async()=>{const [c,k]=await Promise.all([getCandidate(candidateId),getConsents(candidateId)]);setCand(c);setConsents(k);},[candidateId]);
  useEffect(()=>{void reload().catch(e=>setLoadError(message(e,l)));void getJobOrders().then(setOrders).catch(()=>setOrders([]));},[reload,l]);
  const {busy,error,run}=useAction(l,reload);
  if(loadError)return <section className="page-enter"><a className="record-back" href="#/recruitment/candidates"><Back size={17}/>{l.back}</a><ErrorBanner message={loadError}/></section>;
  if(!cand)return <div className="empty-state" role="status">{l.loading}</div>;
  const editable=cand.ownedByMe;
  return <article className="record-workspace page-enter rec-record" aria-labelledby="cand-title">
    <div className="record-context-bar"><a className="record-back" href="#/recruitment/candidates"><Back size={17}/>{l.back}</a><span className="record-context-separator">/</span><span className="record-current">{cand.displayName}</span></div>
    <div className="record-hero"><div className="record-hero-main"><span className="eyebrow"><span className="record-eyebrow-dot"/>{l.candidates}</span>
      <div className="record-hero-heading"><div className="record-identity-icon"><UserRound size={30}/></div><div><h1 id="cand-title">{cand.displayName}</h1>
        <div className="record-tags"><span className="record-ref">{cand.headline||"—"}</span>{cand.yearsExperience!=null&&<span className="record-ref">{l.years}: {cand.yearsExperience}</span>}</div></div></div></div></div>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {!editable&&<p className="record-security-note"><LockKeyhole size={15}/>{l.readonly}</p>}
    <div className="record-content-grid">
      <section className="record-content-card rec-private-card" aria-labelledby="private-title">
        <div className="record-section-header"><div className="record-section-icon"><FileLock2 size={20}/></div><div><h2 id="private-title">{l.privateTitle}</h2><p>{cand.privateProfileOnFile?l.privateOnFile:l.privateNone}</p></div></div>
        <p className="record-security-note"><LockKeyhole size={15}/>{l.privateNote}</p>
        {editable&&<form className="opportunity-form rec-form" autoComplete="off" onSubmit={e=>{e.preventDefault();void run(async()=>{
            await savePrivateProfile(cand.id,cand.version,{...(email?{email}:{}),...(phone?{phone}:{}),...(salary?{expectedSalary:salary}:{}),...(cv?{cvReference:cv}:{})});
            setEmail("");setPhone("");setSalary("");setCv("");});}}>
          <label><span>{l.email}</span><input type="email" dir="ltr" maxLength={255} value={email} onChange={e=>setEmail(e.target.value)}/></label>
          <label><span>{l.phone}</span><input type="tel" dir="ltr" maxLength={20} value={phone} onChange={e=>setPhone(e.target.value)}/></label>
          <label><span>{l.salary}</span><input inputMode="decimal" dir="ltr" value={salary} onChange={e=>setSalary(e.target.value)}/></label>
          <label><span>{l.cv}</span><input dir="ltr" maxLength={255} value={cv} onChange={e=>setCv(e.target.value)}/></label>
          <button type="submit" className="btn btn-secondary" disabled={busy}>{l.savePrivate}</button></form>}
      </section>
      <section className="record-content-card" aria-labelledby="consents-title">
        <div className="record-section-header"><div className="record-section-icon"><ClipboardCheck size={20}/></div><div><h2 id="consents-title">{l.consents}</h2></div></div>
        {consents.length===0?<p className="rec-muted">{l.noConsents}</p>:<ul className="rec-list">{consents.map(c=><li key={c.id}>
          <span><strong dir="ltr">{c.jobOrderReference}</strong> · {l.methods[c.method]} · <span dir="ltr">{c.givenOn}</span>{c.revokedAt?` · ${l.revoked}`:""}</span>
          {editable&&c.active&&<button type="button" className="text-action" disabled={busy} onClick={()=>void run(()=>revokeConsent(c.id,c.version))}>{l.revoke}</button>}</li>)}</ul>}
        {editable&&<form className="opportunity-form rec-form" onSubmit={e=>{e.preventDefault();void run(()=>recordConsent(cand.id,cand.version,{jobOrderId:Number(orderId),method,givenOn,...(evidence?{evidenceReference:evidence}:{})}));}}>
          <label><span>{l.jobOrder}</span><select required value={orderId} onChange={e=>setOrderId(e.target.value)}>
            <option value="">{l.chooseOrder}</option>{orders.map(o=><option key={o.id} value={o.id}>{o.reference} · {o.title}</option>)}</select></label>
          <label><span>{l.method}</span><select value={method} onChange={e=>setMethod(e.target.value as ConsentMethod)}>
            {(["WRITTEN","EMAIL","RECORDED_CALL"] as ConsentMethod[]).map(m=><option key={m} value={m}>{l.methods[m]}</option>)}</select></label>
          <label><span>{l.givenOn}</span><input type="date" required max={today()} value={givenOn} onChange={e=>setGivenOn(e.target.value)}/></label>
          <label><span>{l.evidence}</span><input dir="ltr" maxLength={255} value={evidence} onChange={e=>setEvidence(e.target.value)}/></label>
          <button type="submit" className="btn btn-secondary" disabled={busy}><Plus size={16}/>{l.recordConsent}</button></form>}
      </section>
    </div>
  </article>;
}

/** A placement's own page (D-04): the fee request, the guarantee countdown and the early-exit action under the client agreement. */
function PlacementPage({placementId,l,ar,Back}:{placementId:number;l:Labels;ar:boolean;Back:typeof ArrowLeft}){
  const [p,setP]=useState<PlacementRecord|null>(null);const [loadError,setLoadError]=useState("");
  const [app,setApp]=useState<Application|null>(null);
  const [startOn,setStartOn]=useState("");const [salary,setSalary]=useState("");const [currency,setCurrency]=useState("EGP");
  const [exiting,setExiting]=useState(false);const [exitOn,setExitOn]=useState(today());const [reason,setReason]=useState<ExitReason>("RESIGNED");
  const reload=useCallback(async()=>{
    const next=await getPlacement(placementId);setP(next);
    if(next.jobOrderId!=null&&next.canEdit)setApp((await getApplications(next.jobOrderId)).find(a=>a.id===next.applicationId)??null);
  },[placementId]);
  useEffect(()=>{void reload().catch(e=>setLoadError(message(e,l)));},[reload,l]);
  const {busy,error,run}=useAction(l,reload);
  if(loadError)return <section className="page-enter"><a className="record-back" href="#/recruitment"><Back size={17}/>{l.back}</a><ErrorBanner message={loadError}/></section>;
  if(!p)return <div className="empty-state" role="status">{l.loading}</div>;
  const editable=p.canEdit===true;
  const fee=p.invoicingStatus as keyof typeof l.feeStatus;
  const started=p.feeMilestones.includes("CANDIDATE_STARTED");
  const requested=fee==="REQUESTED"||fee==="ISSUED"||fee==="CANCELLED";
  const exited=!!p.exitedOn;
  const total=p.guaranteeDays??0;const left=p.guaranteeDaysLeft??null;
  const within=p.guaranteeEndsOn?exitOn<=p.guaranteeEndsOn:false;
  const will=!p.replacementRule?null:!within?l.ruleWill.AFTER:p.replacementRule==="PARTIAL_REFUND"&&!requested?l.ruleWill.NO_FEE
    :l.ruleWill[p.replacementRule].replace("{p}",quantity(p.refundPercent));
  const orderHref=p.jobOrderId!=null?"#/recruitment/orders/"+p.jobOrderId:"#/recruitment";
  return <article className="record-workspace page-enter rec-record" aria-labelledby="pl-title">
    <div className="record-context-bar"><a className="record-back" href={orderHref}><Back size={17}/>{l.backToOrder}</a><span className="record-context-separator">/</span><span className="record-current">{p.candidateName}</span></div>
    <div className="record-hero"><div className="record-hero-main">
      <span className="eyebrow"><span className="record-eyebrow-dot"/>{l.placementTitle}{p.clientName?` · ${p.clientName}`:""}</span>
      <div className="record-hero-heading"><div className="record-identity-icon"><BadgeCheck size={30}/></div>
        <div><h1 id="pl-title">{p.candidateName}</h1><div className="record-tags">
          {p.jobOrderReference&&<a className="record-ref" href={orderHref} dir="ltr">{p.jobOrderReference}</a>}
          <span className="record-ref">{l.startDate}: {day(p.startDate,ar)}</span>
          <span className={"rec-status rec-guarantee-"+String(p.guaranteeStatus).toLowerCase()}>{(l.gStatus as Record<string,string>)[p.guaranteeStatus]??p.guaranteeStatus}</span>
          {p.feeWaived&&<span className="record-ref">{l.replacementOf}</span>}</div></div></div>
    </div></div>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {!editable&&<p className="record-security-note"><LockKeyhole size={15}/>{l.readonly}</p>}
    <div className="record-content-grid">
      <section className="record-content-card rec-fee-card" aria-labelledby="pl-fee">
        <div className="record-section-header"><div className="record-section-icon"><HandCoins size={20}/></div><div><h2 id="pl-fee">{l.feeTitle}</h2>
          <p><span className={"rec-status rec-fee-"+String(fee).toLowerCase()}>{l.feeStatus[fee]??fee}</span></p></div></div>
        <p className={requested||fee==="WAIVED_REPLACEMENT"?"rec-muted":"rec-why"} role={requested?undefined:"note"}>{l.feeWhy[fee]??""}
          {fee==="POLICY_NOT_SET"&&<> <a href="#/policies">{l.policiesLink}</a></>}</p>
        <dl className="rec-terms">
          {p.feePercent!=null&&<div><dt>{l.feePercent}</dt><dd dir="ltr">{quantity(p.feePercent)}%</dd></div>}
          {p.invoiceOn&&<div><dt>{l.invoiceOnLabel}</dt><dd>{l.invoiceOn[p.invoiceOn]}</dd></div>}
          {requested&&<div><dt>{l.feeAmount}</dt><dd dir="ltr">{p.feeAmount!=null?amount(p.feeAmount,p.feeCurrency):<small>{l.feeHidden}</small>}</dd></div>}
          {p.feeRequestedAt&&<div><dt>{l.requestedAt}</dt><dd>{day(p.feeRequestedAt,ar)}</dd></div>}
          {p.refundStatus&&<div><dt>{l.refund}</dt><dd>{(l.feeStatus as Record<string,string>)[p.refundStatus]??p.refundStatus}{p.refundAmount!=null?<> · <span dir="ltr">{amount(p.refundAmount,p.feeCurrency)}</span></>:null}</dd></div>}
        </dl>
        {editable&&fee==="OFFER_TERMS_MISSING"&&app&&<form className="opportunity-form rec-form" autoComplete="off"
          onSubmit={e=>{e.preventDefault();void run(async()=>{await saveOfferTerms(app.id,app.version,salary,currency);setSalary("");});}}>
          <label><span>{l.annualSalary}</span><input required inputMode="decimal" dir="ltr" value={salary} onChange={e=>setSalary(e.target.value)}/></label>
          <label><span>{l.currencyCode}</span><input required dir="ltr" maxLength={3} pattern="[A-Z]{3}" value={currency} onChange={e=>setCurrency(e.target.value.toUpperCase())}/></label>
          <button type="submit" className="btn btn-primary" disabled={busy}><FileLock2 size={15}/>{l.saveOfferTerms}</button>
          <p className="rec-hint">{l.offerNote}</p></form>}
        {editable&&(fee==="POLICY_NOT_SET"||fee==="OFFER_TERMS_MISSING")&&<div className="lead-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void run(()=>requestFee(p.id))}><RefreshCw size={15}/>{l.invoice}</button></div>}
      </section>
      <section className="record-content-card rec-guarantee-card" aria-labelledby="pl-guarantee">
        <div className="record-section-header"><div className="record-section-icon"><ShieldCheck size={20}/></div><div><h2 id="pl-guarantee">{l.guaranteeTitle}</h2>
          <p><span className={"rec-status rec-guarantee-"+String(p.guaranteeStatus).toLowerCase()}>{(l.gStatus as Record<string,string>)[p.guaranteeStatus]??p.guaranteeStatus}</span>
            {" "}{started&&p.startedOn?<>{l.startedOn} {day(p.startedOn,ar)}</>:l.notStarted}</p></div></div>
        {p.guaranteeStatus==="ACTIVE"&&left!=null&&<div className="rec-countdown" role="group" aria-label={l.daysLeft}>
          <strong dir="ltr">{left}</strong><span>{l.days} {l.daysLeft}</span>
          <div className="rec-meter" aria-hidden="true"><span style={{width:(total>0?Math.min(100,Math.round(100*(total-left)/total)):100)+"%"}}/></div></div>}
        <dl className="rec-terms">
          {p.guaranteeDays!=null&&<div><dt>{l.guaranteeDays}</dt><dd>{p.guaranteeDays} {l.days}</dd></div>}
          {p.guaranteeEndsOn&&<div><dt>{l.endsOn}</dt><dd>{day(p.guaranteeEndsOn,ar)}</dd></div>}
          {p.replacementRule&&<div><dt>{l.rule}</dt><dd>{l.rules[p.replacementRule]}{p.replacementRule==="PARTIAL_REFUND"&&p.refundPercent!=null?<span dir="ltr"> ({quantity(p.refundPercent)}%)</span>:null}</dd></div>}
          {exited&&<div><dt>{l.exitedOn}</dt><dd>{day(p.exitedOn,ar)}{p.exitReason?` · ${l.reasons[p.exitReason]}`:""}</dd></div>}
          {p.exitOutcome&&<div><dt>{l.willHappen}</dt><dd>{l.outcomes2[p.exitOutcome]}</dd></div>}
        </dl>
        {p.guaranteeStatus==="TERMS_PENDING"&&<p className="rec-why" role="note">{l.feeWhy.POLICY_NOT_SET} <a href="#/policies">{l.policiesLink}</a></p>}
        {editable&&!started&&<form className="opportunity-form rec-form" onSubmit={e=>{e.preventDefault();void run(()=>recordStart(p.id,startOn||p.startDate));}}>
          <label><span>{l.startDate}</span><input type="date" required max={today()} value={startOn||p.startDate} onChange={e=>setStartOn(e.target.value)}/></label>
          <button type="submit" className="btn btn-primary" disabled={busy}><CheckCircle2 size={15}/>{l.recordStarted}</button></form>}
        {editable&&started&&!exited&&<div className="lead-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>setExiting(true)}><LogOut size={15}/>{l.exitAction}</button></div>}
      </section>
    </div>
    {exiting&&<Dialog title={l.exitTitle} kicker={p.candidateName} busy={busy} onClose={()=>setExiting(false)}
      footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>setExiting(false)}>{l.cancel}</button>
        <button type="submit" form="rec-exit-form" className="btn btn-primary" disabled={busy}>{l.confirmExit}</button></>}>
      <form id="rec-exit-form" className="opportunity-form rec-form" onSubmit={e=>{e.preventDefault();
          void run(()=>recordExit(p.id,p.version,exitOn,reason)).then(ok=>{if(ok)setExiting(false);});}}>
        <label><span>{l.exitedOn}</span><input type="date" required min={p.startedOn??undefined} max={today()} value={exitOn} onChange={e=>setExitOn(e.target.value)}/></label>
        <label><span>{l.exitReason}</span><select value={reason} onChange={e=>setReason(e.target.value as ExitReason)}>
          {(["RESIGNED","DISMISSED","OTHER"] as ExitReason[]).map(r=><option key={r} value={r}>{l.reasons[r]}</option>)}</select></label>
      </form>
      <div className="rec-will" role="status" aria-live="polite"><strong>{l.willHappen}</strong><p>{will??l.termsPendingNote}</p></div>
      {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    </Dialog>}
  </article>;
}
