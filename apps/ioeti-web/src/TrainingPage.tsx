import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Award, Ban, CalendarClock, CircleAlert, CircleCheck, FileText, GraduationCap, IdCard, LockKeyhole, Plus, Printer, ReceiptText,
  Scale, Undo2, UserMinus, UsersRound,
} from "lucide-react";
import {
  ApiError, cancelEnrollment, createTrainingCohort, createTrainingCourse, getAccountContacts,
  getAccounts, getCohortEnrollments, getCohortSessions, getSessionAttendance, getTrainingCohort,
  getTrainingCohorts, getTrainingCourses, recordAttendance, scheduleSession, setCohortState,
  type AccountSummary, type AttendanceStatus, type ContactSummary, type TrainingAttendance, type TrainingCohort,
  type TrainingCourse, type TrainingEnrollment, type TrainingSession,
} from "./api";
import { Dialog } from "./Dialog";
import { amount, day, quantity } from "./format";
import type { Language } from "./preferences";
import {
  approveRefund, cancelCohort, enrollTraineeWithId, getCancellation, getCertificate, getCohortCancellation, getCohortRefunds,
  getCohortRules, getEligibility, getInvoiceChoices, getRefunds, issueAllCertificates, issueCertificate, issueRefundCreditNote,
  identityProvided, linkInvoice, recordNationalId, recordScore, rejectRefund, requestRefund, revokeCertificate,
  type Cancellation, type Certificate, type CohortCancellation, type CohortRules, type Eligibility, type EligibilityReason,
  type InvoiceChoice, type Refund,
} from "./trainingApi";
import { PageHeader } from "./ui";
import "./training.css";

const strings = {
  ar: {
    title:"التدريب الخارجي",desc:"الدورات والدفعات والتسجيل والحضور والشهادات والاسترداد، ضمن صلاحياتك.",
    cohorts:"الدفعات",noCohorts:"لا توجد دفعات متاحة لك بعد",loading:"جار التحميل...",
    planned:"مخططة",open:"مفتوحة للتسجيل",closed:"مغلقة",cancelledCohort:"ملغاة",seats:"المقاعد",confirmed:"مؤكد",waitlisted:"قائمة الانتظار",
    seatsLeft:"مقاعد متاحة",newCohort:"دفعة جديدة",newCourse:"دورة جديدة",course:"الدورة",chooseCourse:"اختر دورة",
    code:"الرمز",name:"الاسم",nameAr:"الاسم بالعربية",hours:"عدد الساعات",capacity:"السعة",minSeats:"الحد الأدنى",
    start:"تاريخ البدء",end:"تاريخ الانتهاء",location:"المكان",save:"حفظ",cancel:"رجوع",
    openCohort:"فتح التسجيل",closeCohort:"إغلاق التسجيل",cancelCohort:"إلغاء الدفعة",
    trainees:"المتدربون",noTrainees:"لا يوجد متدربون بعد",sponsor:"الجهة الراعية",chooseSponsor:"اختر الجهة",
    trainee:"المتدرب",chooseTrainee:"اختر جهة الاتصال",enroll:"تسجيل",position:"الحالة",cancelEnrollment:"إلغاء التسجيل",cancelledRow:"ملغي",
    sessions:"الجلسات",noSessions:"لا توجد جلسات بعد",sessionTitle:"عنوان الجلسة",startsAt:"الموعد",minutes:"المدة بالدقائق",
    addSession:"إضافة جلسة",present:"حاضر",absent:"غائب",excused:"معتذر",attendance:"الحضور",
    notOpen:"الدفعة ليست مفتوحة للتسجيل.",already:"هذا المتدرب مسجل بالفعل في الدفعة.",changed:"البيانات اتعدلت من مكان تاني؛ حدّثناها، جرّب تاني.",
    invalid:"راجع الحقول المطلوبة وقيمها.",denied:"ليست لديك صلاحية لهذا الإجراء.",failed:"تعذّر تنفيذ الطلب.",
    state:"حالة الدفعة لا تسمح بهذا الإجراء.",onlyCoordinator:"منسّق الدفعة فقط يمكنه تعديلها.",
    // D-03
    rules:"قواعد الدورة",criteria:"شروط الشهادة",minAttendance:"أقل حضور",passMark:"درجة النجاح",noPassMark:"من غير تقييم",
    identity:"الرقم القومي",identityNotAsked:"مش مطلوب",identityOptional:"اختياري",identityRequired:"إجباري",
    refundSteps:"الاسترداد عند الإلغاء",stepLine:(d:number,p:string)=>`قبل البداية بـ ${d} يوم أو أكتر: ${p}%`,cohortRefund:(p:string)=>`لو إحنا لغينا الدفعة: ${p}%`,
    notSet:"لسه متحددتش",ownerSets:"صاحب السياسات بيحددها من صفحة السياسات.",
    criteriaMissing:"شروط الشهادة للدورة دي (training.certificate) لسه متحددتش، فمفيش شهادات تطلع لحد ما صاحب السياسات يحددها.",
    identityMissing:"جمع الرقم القومي للدورة دي (training.national-id) لسه متحددش، فمش بنسجّل أرقام قومية.",
    cancellationMissing:"سياسة الإلغاء والاسترداد (training.cancellation) لسه متحددتش: التسجيل اللي اتدفع مينفعش يتلغي لحد ما تتحدد.",
    nationalId:"الرقم القومي",nationalIdHint:"14 رقم، بيتخزن كبيانات محظورة ومش بيظهر تاني.",onFile:"متسجّل",notOnFile:"مش متسجّل",recordId:"تسجيل الرقم القومي",
    certificates:"الشهادات والتقييم",eligible:"مستوفي الشروط",issue:"إصدار شهادة",issueAll:"إصدار لكل المستوفين",print:"طباعة",revoke:"سحب الشهادة",
    sessionsAttended:(p:number,s:number)=>`${p} من ${s}`,score:"الدرجة",saveScore:"حفظ الدرجة",serial:"رقم الشهادة",issuedOn:"تاريخ الإصدار",
    reasons:{NOT_CONFIRMED:"مش مؤكد في الدفعة",NO_SESSIONS:"الدفعة مفيهاش جلسات",ATTENDANCE_BELOW:"الحضور أقل من المطلوب",SCORE_MISSING:"الدرجة لسه متسجلتش",SCORE_BELOW:"الدرجة أقل من درجة النجاح",POLICY_NOT_SET:"الشروط لسه متحددتش"} as Record<EligibilityReason,string>,
    bulkDone:(n:number,k:number)=>`طلعت ${n} شهادة${k?`، و${k} متدرب مش مستوفي الشروط`:""}.`,
    revokeTitle:"سحب الشهادة",revokeReason:"سبب السحب",revokeNote:"السبب بيتسجل ومش بيظهر تاني لأي حد.",revokedTag:"مسحوبة",
    certTitle:"شهادة إتمام تدريب",certifies:"تشهد IOETI بأن",completed:"أتم بنجاح الدورة التدريبية",held:"المنعقدة",hoursLabel:"ساعة تدريبية",
    // money
    money:"الفاتورة والاسترداد",invoice:"الفاتورة",linkInvoice:"ربط الفاتورة",linkHint:"اختار فاتورة صادرة للمتدرب أو للجهة الراعية، والجزء اللي يخص التسجيل ده (شامل الضريبة).",
    noInvoices:"مفيش فواتير صادرة للمتدرب أو للجهة الراعية تقدر تشوفها.",share:"نصيب التسجيل",received:"المحصّل",unlinked:"غير مربوط",
    noFee:"مفيش فاتورة مربوطة بالتسجيل ده.",paid:"المدفوع للتسجيل",requestRefund:"طلب الاسترداد",
    cancelTitle:"إلغاء التسجيل",cancelConfirm:"تأكيد الإلغاء",cohortCancelTitle:"إلغاء الدفعة",cohortCancelConfirm:"تأكيد إلغاء الدفعة",
    outcome:{
      REFUND:(a:string,p:string,d:number|null)=>`هيتطلب استرداد ${a} (${p}% من المدفوع${d!=null?`، الإلغاء قبل البداية بـ ${d} يوم`:""}). المالية بتراجع الطلب وتصدر إشعار دائن.`,
      NO_REFUND_DUE:(d:number|null)=>`حسب سياسة الإلغاء مفيش استرداد${d!=null?` (الإلغاء قبل البداية بـ ${d} يوم)`:""}.`,
      NOT_INVOICED:"مفيش فاتورة مربوطة بالتسجيل ده، فمش هيتطلب استرداد دلوقتي. لو المتدرب دفع، المالية تربط الفاتورة وبعدها تطلب الاسترداد.",
      NOTHING_PAID:"مفيش فلوس اتحصّلت على فاتورة التسجيل ده، فمفيش استرداد.",
      POLICY_NOT_SET:"مينفعش نلغي دلوقتي: المتدرب دفع، وسياسة الإلغاء والاسترداد (training.cancellation) لسه متحددتش. صاحب السياسات بيحددها من صفحة السياسات.",
      START_DATE_MISSING:"مينفعش نحسب الاسترداد: الدفعة ملهاش تاريخ بداية.",
      ALREADY_REQUESTED:"الاسترداد اتطلب قبل كده.",
    },
    cohortOutcome:(n:number,r:number,t:string)=>`هيتلغي ${n} تسجيل، وهيتطلب ${r} استرداد بإجمالي ${t}. المالية بتراجع كل طلب وتصدر إشعار دائن.`,
    cohortNoRefund:(n:number)=>`هيتلغي ${n} تسجيل. مفيش استرداد مطلوب (مفيش مدفوعات).`,
    cohortBlockedPolicy:"مينفعش نلغي الدفعة: فيه متدربين دفعوا، والسياسة مش محددة فيها نسبة الاسترداد لما إحنا نلغي الدفعة. صاحب السياسات بيحددها من صفحة السياسات.",
    cohortBlockedCerts:(n:number)=>`مينفعش نلغي الدفعة: اتصدر لها ${n} شهادة. اسحب الشهادات الأول.`,
    refunds:"طلبات الاسترداد",noRefunds:"مفيش طلبات استرداد",refundQueue:"استرداد التدريب",
    refundStatus:{REQUESTED:"مستني المالية",CREDITED:"اتصرف بإشعار دائن",REJECTED:"اترفض"},
    cause:{ENROLMENT_CANCELLED:"إلغاء تسجيل",COHORT_CANCELLED:"إلغاء الدفعة"},
    approve:"اعتماد وإصدار إشعار دائن",reject:"رفض",approveTitle:"اعتماد الاسترداد",rejectTitle:"رفض الاسترداد",rejectReason:"سبب الرفض",
    approveNote:(p:string,n:string)=>`هيطلع إشعار دائن بـ ${p}% من الفاتورة ${n} من خلال المالية (نفس خطوات الإشعارات الدائنة)، وبعدها الطلب يتسجل إنه اتصرف.`,
    pendingCredit:"فيه إشعار دائن اتعمل للطلب ده ولسه ماتسجلش عليه؛ الاعتماد هيسجّله من غير إشعار جديد.",
    creditNo:"الإشعار الدائن",refundAmount:"مبلغ الاسترداد",invoiceTotal:"إجمالي الفاتورة",requestedOn:"اتطلب",
    errors:{
      POLICY_NOT_SET:"السياسة المطلوبة لسه متحددتش؛ صاحب السياسات بيحددها من صفحة السياسات.",NUMBERING_NOT_SET:"ترقيم شهادات التدريب لسه متحددش؛ المسؤول بيظبطه من الترقيم.",
      ALREADY_CERTIFIED:"المتدرب ده معاه شهادة بالفعل.",CERTIFICATES_ISSUED:"اتصدر للدفعة شهادات؛ اسحبها الأول.",COHORT_STATE:"حالة الدفعة لا تسمح بهذا الإجراء.",
      INVOICE_REQUIRED:"مفيش فاتورة مربوطة؛ المالية تربط الفاتورة الأول.",NOTHING_PAID:"مفيش مدفوعات على الفاتورة.",NO_REFUND_DUE:"السياسة مش بتدي استرداد للإلغاء ده.",
      ALREADY_REQUESTED:"الاسترداد اتطلب قبل كده.",ALREADY_LINKED:"التسجيل مربوط بفاتورة بالفعل.",ACCOUNTING_NOT_READY:"إعداد الحسابات مش مكتمل للإشعار الدائن:",
      CREDIT_NOTE_REJECTED:"الحسابات رفضت الإشعار الدائن.",REFUND_STATE:"الطلب ده اتقرر قبل كده.",CREDIT_NOTE_USED:"الإشعار الدائن ده مستخدم لطلب تاني.",
      START_DATE_MISSING:"الدفعة ملهاش تاريخ بداية.",NOT_ASSESSED:"الدورة دي ملهاش درجة نجاح، فمفيش درجات.",ALREADY_REVOKED:"الشهادة مسحوبة بالفعل.",
      REFUND_EXISTS:"فيه طلب استرداد على الربط ده.",NOT_CANCELLED:"التسجيل لازم يتلغي الأول.",ALREADY_CANCELLED:"التسجيل ده ملغي بالفعل.",
    } as Record<string,string>,
    fields:{nationalId:{FORMAT:"الرقم القومي لازم يكون 14 رقم صحيح.",NOT_ASKED:"الدورة دي مش بتطلب رقم قومي؛ سيبه فاضي.",REQUIRED:"الدورة دي بتطلب الرقم القومي للمتدرب."},
      score:{RANGE:"الدرجة من 0 لـ 100.",REQUIRED:"اكتب الدرجة."},invoiceId:{PARTNER_MISMATCH:"الفاتورة لازم تكون للمتدرب أو للجهة الراعية.",INVOICE_STATE:"اختار فاتورة صادرة.",UNAVAILABLE:"اختار فاتورة تقدر تشوفها."},
      amount:{RANGE:"المبلغ لازم يكون أكبر من صفر ومش أكتر من الجزء غير المربوط من الفاتورة."},reason:{REQUIRED:"اكتب السبب.",TOO_LONG:"السبب طويل؛ 500 حرف بالكتير."},
      creditInvoiceId:{CREDIT_NOTE_MISMATCH:"الإشعار الدائن مش مطابق للطلب (الفاتورة أو المبلغ).",UNAVAILABLE:"الإشعار الدائن مش متاح."}} as Record<string,Record<string,string>>,
  },
  en: {
    title:"External training",desc:"Courses, cohorts, enrolment, attendance, certificates and refunds, within your permissions.",
    cohorts:"Cohorts",noCohorts:"No cohorts available to you yet",loading:"Loading...",
    planned:"Planned",open:"Open for enrolment",closed:"Closed",cancelledCohort:"Cancelled",seats:"Seats",confirmed:"Confirmed",waitlisted:"Waitlist",
    seatsLeft:"Seats left",newCohort:"New cohort",newCourse:"New course",course:"Course",chooseCourse:"Choose a course",
    code:"Code",name:"Name",nameAr:"Arabic name",hours:"Hours",capacity:"Capacity",minSeats:"Minimum seats",
    start:"Start date",end:"End date",location:"Location",save:"Save",cancel:"Back",
    openCohort:"Open enrolment",closeCohort:"Close enrolment",cancelCohort:"Cancel cohort",
    trainees:"Trainees",noTrainees:"No trainees yet",sponsor:"Sponsoring account",chooseSponsor:"Choose an account",
    trainee:"Trainee",chooseTrainee:"Choose a contact",enroll:"Enrol",position:"Status",cancelEnrollment:"Cancel enrolment",cancelledRow:"Cancelled",
    sessions:"Sessions",noSessions:"No sessions yet",sessionTitle:"Session title",startsAt:"Starts at",minutes:"Minutes",
    addSession:"Add session",present:"Present",absent:"Absent",excused:"Excused",attendance:"Attendance",
    notOpen:"This cohort is not open for enrolment.",already:"This trainee is already enrolled in the cohort.",changed:"The data changed elsewhere; it is refreshed, try again.",
    invalid:"Check the required fields and their values.",denied:"You do not have permission for this action.",failed:"The request failed.",
    state:"The cohort's state does not allow this action.",onlyCoordinator:"Only the cohort's coordinator can change it.",
    rules:"Course rules",criteria:"Certificate criteria",minAttendance:"Minimum attendance",passMark:"Pass mark",noPassMark:"Not assessed",
    identity:"National ID",identityNotAsked:"Not asked",identityOptional:"Optional",identityRequired:"Required",
    refundSteps:"Refund on cancellation",stepLine:(d:number,p:string)=>`${d} or more days before the start: ${p}%`,cohortRefund:(p:string)=>`When we cancel the cohort: ${p}%`,
    notSet:"Not set yet",ownerSets:"A policy owner sets it under Policies.",
    criteriaMissing:"This course's certificate criteria (training.certificate) are not set, so no certificate can be issued until a policy owner sets them.",
    identityMissing:"National ID collection for this course (training.national-id) is not set, so no national IDs are recorded.",
    cancellationMissing:"The cancellation and refund policy (training.cancellation) is not set: a paid enrolment cannot be cancelled until it is.",
    nationalId:"National ID",nationalIdHint:"14 digits, stored as restricted data and never shown again.",onFile:"On file",notOnFile:"Not on file",recordId:"Record national ID",
    certificates:"Certificates and assessment",eligible:"Meets the criteria",issue:"Issue certificate",issueAll:"Issue to all who qualify",print:"Print",revoke:"Revoke",
    sessionsAttended:(p:number,s:number)=>`${p} of ${s}`,score:"Score",saveScore:"Save score",serial:"Certificate no.",issuedOn:"Issued on",
    reasons:{NOT_CONFIRMED:"Not confirmed in the cohort",NO_SESSIONS:"The cohort has no sessions",ATTENDANCE_BELOW:"Attendance below the minimum",SCORE_MISSING:"No score recorded",SCORE_BELOW:"Score below the pass mark",POLICY_NOT_SET:"Criteria not set"} as Record<EligibilityReason,string>,
    bulkDone:(n:number,k:number)=>`${n} certificate(s) issued${k?`; ${k} trainee(s) do not meet the criteria`:""}.`,
    revokeTitle:"Revoke certificate",revokeReason:"Reason",revokeNote:"The reason is kept and never shown again.",revokedTag:"Revoked",
    certTitle:"Certificate of completion",certifies:"IOETI certifies that",completed:"has successfully completed the training course",held:"held",hoursLabel:"training hours",
    money:"Invoice and refund",invoice:"Invoice",linkInvoice:"Link invoice",linkHint:"Choose an issued invoice of the trainee or the sponsoring account, and this enrolment's share (including tax).",
    noInvoices:"No issued invoices of the trainee or the sponsoring account that you can see.",share:"Enrolment's share",received:"Received",unlinked:"Not linked",
    noFee:"No invoice is linked to this enrolment.",paid:"Paid for the enrolment",requestRefund:"Request refund",
    cancelTitle:"Cancel enrolment",cancelConfirm:"Confirm cancellation",cohortCancelTitle:"Cancel cohort",cohortCancelConfirm:"Confirm cohort cancellation",
    outcome:{
      REFUND:(a:string,p:string,d:number|null)=>`A refund of ${a} will be requested (${p}% of what was paid${d!=null?`, cancelled ${d} days before the start`:""}). Finance reviews it and issues a credit note.`,
      NO_REFUND_DUE:(d:number|null)=>`The cancellation policy gives no refund${d!=null?` (cancelled ${d} days before the start)`:""}.`,
      NOT_INVOICED:"No invoice is linked to this enrolment, so no refund is requested now. If the trainee paid, finance links the invoice and the refund is requested then.",
      NOTHING_PAID:"Nothing was received on this enrolment's invoice, so there is no refund.",
      POLICY_NOT_SET:"This cannot be cancelled now: the trainee paid and the cancellation and refund policy (training.cancellation) is not set. A policy owner sets it under Policies.",
      START_DATE_MISSING:"The refund cannot be computed: the cohort has no start date.",
      ALREADY_REQUESTED:"The refund was already requested.",
    },
    cohortOutcome:(n:number,r:number,t:string)=>`${n} enrolment(s) will be cancelled and ${r} refund(s) requested, ${t} in total. Finance reviews each and issues a credit note.`,
    cohortNoRefund:(n:number)=>`${n} enrolment(s) will be cancelled. No refund is due (nothing was paid).`,
    cohortBlockedPolicy:"The cohort cannot be cancelled: trainees paid and the policy does not say what is refunded when we cancel a cohort. A policy owner sets it under Policies.",
    cohortBlockedCerts:(n:number)=>`The cohort cannot be cancelled: ${n} certificate(s) were issued. Revoke them first.`,
    refunds:"Refund requests",noRefunds:"No refund requests",refundQueue:"Training refunds",
    refundStatus:{REQUESTED:"Awaiting finance",CREDITED:"Credited",REJECTED:"Rejected"},
    cause:{ENROLMENT_CANCELLED:"Enrolment cancelled",COHORT_CANCELLED:"Cohort cancelled"},
    approve:"Approve and issue credit note",reject:"Reject",approveTitle:"Approve refund",rejectTitle:"Reject refund",rejectReason:"Reason",
    approveNote:(p:string,n:string)=>`A credit note for ${p}% of invoice ${n} is issued through finance (the usual credit-note step), then the refund is recorded as credited.`,
    pendingCredit:"A credit note was already issued for this request but not recorded on it; approving records it without a new one.",
    creditNo:"Credit note",refundAmount:"Refund",invoiceTotal:"Invoice total",requestedOn:"Requested",
    errors:{
      POLICY_NOT_SET:"The policy this needs is not set; a policy owner sets it under Policies.",NUMBERING_NOT_SET:"Training certificates have no numbering yet; an administrator sets it under Numbering.",
      ALREADY_CERTIFIED:"This trainee already holds a certificate.",CERTIFICATES_ISSUED:"Certificates were issued for this cohort; revoke them first.",COHORT_STATE:"The cohort's state does not allow this action.",
      INVOICE_REQUIRED:"No invoice is linked; finance links the invoice first.",NOTHING_PAID:"Nothing was received on the invoice.",NO_REFUND_DUE:"The policy gives no refund for this cancellation.",
      ALREADY_REQUESTED:"The refund was already requested.",ALREADY_LINKED:"This enrolment is already linked to an invoice.",ACCOUNTING_NOT_READY:"The accounting set-up is incomplete for the credit note:",
      CREDIT_NOTE_REJECTED:"Accounting rejected the credit note.",REFUND_STATE:"This request was already decided.",CREDIT_NOTE_USED:"This credit note already settles another request.",
      START_DATE_MISSING:"The cohort has no start date.",NOT_ASSESSED:"This course has no pass mark, so no scores are recorded.",ALREADY_REVOKED:"The certificate is already revoked.",
      REFUND_EXISTS:"A refund was requested on this link.",NOT_CANCELLED:"Cancel the enrolment first.",ALREADY_CANCELLED:"This enrolment is already cancelled.",
    } as Record<string,string>,
    fields:{nationalId:{FORMAT:"The national ID must be 14 valid digits.",NOT_ASKED:"This course does not ask for a national ID; leave it empty.",REQUIRED:"This course requires the trainee's national ID."},
      score:{RANGE:"The score is from 0 to 100.",REQUIRED:"Enter the score."},invoiceId:{PARTNER_MISMATCH:"The invoice must be the trainee's or the sponsoring account's.",INVOICE_STATE:"Choose an issued invoice.",UNAVAILABLE:"Choose an invoice you can see."},
      amount:{RANGE:"The amount must be above zero and at most the part of the invoice not linked yet."},reason:{REQUIRED:"Enter the reason.",TOO_LONG:"The reason is too long; 500 characters at most."},
      creditInvoiceId:{CREDIT_NOTE_MISMATCH:"The credit note does not match the request (invoice or amount).",UNAVAILABLE:"The credit note is not available."}} as Record<string,Record<string,string>>,
  },
};
type Labels = typeof strings.ar;

function message(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.failed;
  if (error.code === "COHORT_NOT_OPEN") return l.notOpen;
  if (error.code === "ALREADY_ENROLLED") return l.already;
  if (error.code === "NOT_ELIGIBLE") return l.reasons[error.fields[0]?.code as EligibilityReason] || l.failed;
  if (error.code === "ACCOUNTING_NOT_READY") return `${l.errors.ACCOUNTING_NOT_READY} ${error.fields.map(f => f.code).join("، ")}`;
  if (error.code && l.errors[error.code]) return l.errors[error.code];
  if (error.statusCode === 409) return l.changed;
  if (error.statusCode === 422 && error.fields.length) {
    const f = error.fields[0];
    return l.fields[f.field]?.[f.code] || l.invalid;
  }
  if (error.statusCode === 403 || error.statusCode === 404) return l.denied;
  return l.failed;
}
const pct = (v: number | null | undefined) => v == null ? "—" : quantity(v);

/** External training workspace (real mode). Each list is filtered by the server with the caller's permissions. */
export function TrainingPage({language}:{language:Language}){
  const l=strings[language];
  const [cohorts,setCohorts]=useState<TrainingCohort[]|null>(null);
  const [courses,setCourses]=useState<TrainingCourse[]>([]);
  const [selected,setSelected]=useState<TrainingCohort|null>(null);
  const [form,setForm]=useState<"cohort"|"course"|null>(null);
  const [view,setView]=useState<"cohorts"|"refunds">("cohorts");
  const [refundsVisible,setRefundsVisible]=useState(false);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>{
    const [c,k]=await Promise.all([getTrainingCohorts(),getTrainingCourses()]);
    setCohorts(c);setCourses(k);
  },[]);
  useEffect(()=>{void load().catch(e=>{setCohorts([]);setError(message(e,l));});},[load,l]);
  // the refund queue is shown to whoever may read refunds (finance, coordinators); the server decides
  useEffect(()=>{void getRefunds("REQUESTED").then(()=>setRefundsVisible(true)).catch(()=>setRefundsVisible(false));},[]);
  async function run(action:()=>Promise<unknown>){
    if(busy)return;
    setBusy(true);setError("");
    try{await action();}
    catch(e){setError(message(e,l));}
    finally{setBusy(false);}
  }
  const status=(c:TrainingCohort)=>c.status==="OPEN"?l.open:c.status==="CLOSED"?l.closed:(c.status as string)==="CANCELLED"?l.cancelledCohort:l.planned;
  return <section className="page-enter training-page">
    <PageHeader className="directory-head" eyebrow={language==="ar"?"التنفيذ والخدمات":"Delivery & services"} title={l.title} description={l.desc}
      actions={refundsVisible?<div className="segmented" role="group" aria-label={l.title}>
        <button type="button" className={view==="cohorts"?"chosen":""} aria-pressed={view==="cohorts"} onClick={()=>setView("cohorts")}><GraduationCap size={15}/>{l.cohorts}</button>
        <button type="button" className={view==="refunds"?"chosen":""} aria-pressed={view==="refunds"} onClick={()=>setView("refunds")}><Undo2 size={15}/>{l.refunds}</button>
      </div>:undefined}/>
    {view==="refunds"?<RefundQueue l={l} language={language}/>:<>
    <div className="training-toolbar">
      <button type="button" className="btn btn-primary" onClick={()=>setForm(form==="cohort"?null:"cohort")}><Plus size={16}/>{l.newCohort}</button>
      <button type="button" className="btn btn-secondary" onClick={()=>setForm(form==="course"?null:"course")}><Plus size={16}/>{l.newCourse}</button>
    </div>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {form==="course"&&<CourseForm l={l} busy={busy} onCancel={()=>setForm(null)} onSave={body=>run(async()=>{await createTrainingCourse(body);setForm(null);await load();})}/>}
    {form==="cohort"&&<CohortForm l={l} busy={busy} courses={courses.filter(c=>c.active)} onCancel={()=>setForm(null)}
      onSave={body=>run(async()=>{const created=await createTrainingCohort(body);setForm(null);await load();setSelected(created);})}/>}
    <div className="training-layout">
      <div className="data-panel"><div className="data-panel-heading"><strong>{l.cohorts}</strong><span>{cohorts?.length??0}</span></div>
        {cohorts===null?<div className="empty-state" role="status">{l.loading}</div>
        :cohorts.length===0?<div className="empty-state">{l.noCohorts}</div>
        :<div className="directory-items">{cohorts.map(c=><button type="button" key={c.id}
          className={"directory-item training-cohort-row"+(selected?.id===c.id?" is-selected":"")} aria-pressed={selected?.id===c.id} onClick={()=>setSelected(c)}>
          <div className="line-monogram">{c.code.slice(0,2)}</div>
          <div className="directory-record"><strong>{(language==="ar"&&courses.find(k=>k.id===c.courseId)?.nameAr)||c.courseName}</strong><small><span dir="ltr">{c.code}</span> · {status(c)}</small></div>
          <span className="training-seats" dir="ltr">{c.confirmed}/{c.capacity}{c.waitlisted?` +${c.waitlisted}`:""}</span>
        </button>)}</div>}
      </div>
      {!selected&&cohorts!==null&&cohorts.length>0&&<div className="data-panel detail-placeholder" aria-hidden="true">
        <GraduationCap size={30}/><strong>{language==="ar"?"اختر دفعة من القائمة":"Choose a cohort"}</strong>
        <span>{language==="ar"?"لترى المقاعد والجلسات والحضور والشهادات والاسترداد.":"to see seats, sessions, attendance, certificates and refunds."}</span></div>}
      {selected&&<CohortDetail key={selected.id} cohortId={selected.id} l={l} language={language} statusLabel={status}
        onChanged={updated=>{setSelected(updated);setCohorts(cur=>(cur||[]).map(c=>c.id===updated.id?updated:c));}}/>}
    </div></>}
  </section>;
}

function CourseForm({l,busy,onSave,onCancel}:{l:Labels;busy:boolean;onCancel:()=>void;
  onSave:(body:{code:string;name:string;nameAr?:string;durationHours?:number})=>void}){
  const [code,setCode]=useState("");const [name,setName]=useState("");const [nameAr,setNameAr]=useState("");const [hours,setHours]=useState("");
  return <form className="record-content-card opportunity-form training-form" onSubmit={e=>{e.preventDefault();
    onSave({code,name,...(nameAr?{nameAr}:{}),...(hours?{durationHours:Number(hours)}:{})});}}>
    <label><span>{l.code}</span><input required dir="ltr" value={code} onChange={e=>setCode(e.target.value)}/></label>
    <label><span>{l.name}</span><input required value={name} onChange={e=>setName(e.target.value)}/></label>
    <label><span>{l.nameAr}</span><input dir="rtl" value={nameAr} onChange={e=>setNameAr(e.target.value)}/></label>
    <label><span>{l.hours}</span><input type="number" min="1" max="2000" value={hours} onChange={e=>setHours(e.target.value)}/></label>
    <div className="lead-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{l.save}</button>
      <button type="button" className="btn btn-secondary" onClick={onCancel}>{l.cancel}</button></div>
  </form>;
}

function CohortForm({l,busy,courses,onSave,onCancel}:{l:Labels;busy:boolean;courses:TrainingCourse[];onCancel:()=>void;
  onSave:(body:{courseId:number;code:string;capacity:number;minSeats?:number;startDate?:string;endDate?:string;location?:string})=>void}){
  const [courseId,setCourseId]=useState("");const [code,setCode]=useState("");const [capacity,setCapacity]=useState("20");
  const [minSeats,setMinSeats]=useState("");const [start,setStart]=useState("");const [end,setEnd]=useState("");const [location,setLocation]=useState("");
  return <form className="record-content-card opportunity-form training-form" onSubmit={e=>{e.preventDefault();
    onSave({courseId:Number(courseId),code,capacity:Number(capacity),...(minSeats?{minSeats:Number(minSeats)}:{}),
      ...(start?{startDate:start}:{}),...(end?{endDate:end}:{}),...(location?{location}:{})});}}>
    <label><span>{l.course}</span><select required value={courseId} onChange={e=>setCourseId(e.target.value)}>
      <option value="">{l.chooseCourse}</option>{courses.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label><span>{l.code}</span><input required dir="ltr" value={code} onChange={e=>setCode(e.target.value)}/></label>
    <label><span>{l.capacity}</span><input required type="number" min="1" max="500" value={capacity} onChange={e=>setCapacity(e.target.value)}/></label>
    <label><span>{l.minSeats}</span><input type="number" min="0" max={capacity} value={minSeats} onChange={e=>setMinSeats(e.target.value)}/></label>
    <label><span>{l.start}</span><input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label>
    <label><span>{l.end}</span><input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label>
    <label><span>{l.location}</span><input value={location} onChange={e=>setLocation(e.target.value)}/></label>
    <div className="lead-actions"><button type="submit" className="btn btn-primary" disabled={busy||!courseId}>{l.save}</button>
      <button type="button" className="btn btn-secondary" onClick={onCancel}>{l.cancel}</button></div>
  </form>;
}

type Modal =
  | { kind: "cancel"; enrollment: TrainingEnrollment }
  | { kind: "cohortCancel" }
  | { kind: "money"; enrollment: TrainingEnrollment }
  | { kind: "identity"; enrollment: TrainingEnrollment }
  | { kind: "revoke"; certificateId: number; version: number; trainee: string | null }
  | { kind: "print"; certificateId: number }
  | { kind: "approve"; refund: Refund }
  | { kind: "reject"; refund: Refund };

function CohortDetail({cohortId,l,language,statusLabel,onChanged}:{cohortId:number;l:Labels;language:Language;statusLabel:(c:TrainingCohort)=>string;
  onChanged:(c:TrainingCohort)=>void}){
  const [cohort,setCohort]=useState<TrainingCohort|null>(null);
  const [enrollments,setEnrollments]=useState<TrainingEnrollment[]>([]);
  const [sessions,setSessions]=useState<TrainingSession[]>([]);
  const [rules,setRules]=useState<CohortRules|null>(null);
  const [eligibility,setEligibility]=useState<Eligibility|null>(null);
  const [refunds,setRefunds]=useState<Refund[]|null>(null);
  const [accounts,setAccounts]=useState<AccountSummary[]>([]);
  const [contacts,setContacts]=useState<ContactSummary[]>([]);
  const [sponsor,setSponsor]=useState("");const [trainee,setTrainee]=useState("");const [nationalId,setNationalId]=useState("");
  const [title,setTitle]=useState("");const [startsAt,setStartsAt]=useState("");const [minutes,setMinutes]=useState("");
  const [activeSession,setActiveSession]=useState<number|null>(null);
  const [attendance,setAttendance]=useState<TrainingAttendance[]>([]);
  const [modal,setModal]=useState<Modal|null>(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [notice,setNotice]=useState("");
  const reload=useCallback(async()=>{
    const [c,e,s]=await Promise.all([getTrainingCohort(cohortId),getCohortEnrollments(cohortId),getCohortSessions(cohortId)]);
    setCohort(c);setEnrollments(e);setSessions(s);onChanged(c);
    // D-03 panels are optional: each one stays hidden when the caller may not read it
    await Promise.all([
      getCohortRules(cohortId).then(setRules).catch(()=>setRules(null)),
      getEligibility(cohortId).then(setEligibility).catch(()=>setEligibility(null)),
      getCohortRefunds(cohortId).then(setRefunds).catch(()=>setRefunds(null)),
    ]);
    return s;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[cohortId]);
  useEffect(()=>{void reload().catch(e=>setError(message(e,l)));void getAccounts(0,50).then(setAccounts).catch(()=>setAccounts([]));},[reload,l]);
  useEffect(()=>{setTrainee("");setContacts([]);if(sponsor)void getAccountContacts(Number(sponsor)).then(setContacts).catch(()=>setContacts([]));},[sponsor]);
  useEffect(()=>{setAttendance([]);if(activeSession!=null)void getSessionAttendance(activeSession).then(setAttendance).catch(()=>setAttendance([]));},[activeSession]);
  async function run(action:()=>Promise<unknown>){
    if(busy)return false;
    setBusy(true);setError("");setNotice("");
    try{await action();await reload();return true;}
    catch(e){setError(message(e,l));void reload().catch(()=>undefined);return false;}
    finally{setBusy(false);}
  }
  if(!cohort)return <div className="record-content-card"><div className="empty-state" role="status">{l.loading}</div></div>;
  const cancelled=(cohort.status as string)==="CANCELLED";
  const editable=cohort.coordinatedByMe&&!cancelled;
  const confirmed=enrollments.filter(e=>e.status==="CONFIRMED");
  const waiting=enrollments.filter(e=>e.status==="WAITLISTED");
  const gone=enrollments.filter(e=>e.status==="CANCELLED");
  const session=sessions.find(s=>s.id===activeSession)||null;
  const asksId=rules?.identityCollection==="OPTIONAL"||rules?.identityCollection==="REQUIRED";
  const mark=(enrollmentId:number,status:AttendanceStatus)=>void run(async()=>{
    const fresh=(await getCohortSessions(cohort.id)).find(s=>s.id===activeSession);
    if(!fresh)return;
    await recordAttendance(fresh.id,fresh.version,enrollmentId,status);
    setAttendance(await getSessionAttendance(fresh.id));
  });
  const close=()=>setModal(null);
  const done=async(action:()=>Promise<unknown>)=>{if(await run(action))close();};
  return <div className="training-detail">
    <section className="record-content-card" aria-labelledby="cohort-title">
      <div className="record-section-header"><div className="record-section-icon"><UsersRound size={20}/></div><div>
        <h2 id="cohort-title">{cohort.courseName} · <span dir="ltr">{cohort.code}</span></h2>
        <p>{statusLabel(cohort)}{cohort.location?` · ${cohort.location}`:""}{cohort.startDate?` · `:""}<span dir="ltr">{cohort.startDate}{cohort.endDate?` → ${cohort.endDate}`:""}</span></p>
      </div></div>
      <dl className="record-properties training-counts">
        <div><dt>{l.seats}</dt><dd>{cohort.capacity}</dd></div>
        <div><dt>{l.confirmed}</dt><dd>{cohort.confirmed}</dd></div>
        <div><dt>{l.waitlisted}</dt><dd>{cohort.waitlisted}</dd></div>
        <div><dt>{l.seatsLeft}</dt><dd>{cohort.seatsLeft}</dd></div>
      </dl>
      {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
      {notice&&<div className="training-notice" role="status"><CircleCheck size={17}/>{notice}</div>}
      <div className="lead-actions">
        {editable&&cohort.status==="PLANNED"&&<button type="button" className="btn btn-primary" disabled={busy} onClick={()=>void run(()=>setCohortState(cohort.id,cohort.version,"open"))}>{l.openCohort}</button>}
        {editable&&cohort.status==="OPEN"&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void run(()=>setCohortState(cohort.id,cohort.version,"close"))}>{l.closeCohort}</button>}
        {editable&&<button type="button" className="btn btn-danger-quiet" disabled={busy} onClick={()=>setModal({kind:"cohortCancel"})}><Ban size={16}/>{l.cancelCohort}</button>}
      </div>
      {!cohort.coordinatedByMe&&<p className="record-security-note"><LockKeyhole size={15}/>{l.onlyCoordinator}</p>}
    </section>

    {rules&&<RulesCard l={l} rules={rules}/>}

    <section className="record-content-card" aria-labelledby="trainees-title">
      <div className="record-section-header"><div className="record-section-icon"><GraduationCap size={20}/></div><div><h2 id="trainees-title">{l.trainees}</h2></div></div>
      {enrollments.length===0?<div className="empty-state">{l.noTrainees}</div>
      :<div className="table-scroll"><table><thead><tr><th>{l.trainee}</th><th>{l.sponsor}</th><th>{l.position}</th>
        {asksId&&<th>{l.identity}</th>}<th><span className="sr-only">{l.money}</span></th></tr></thead>
        <tbody>{[...confirmed,...waiting,...gone].map(e=><tr key={e.id} className={e.status==="CANCELLED"?"training-row-cancelled":undefined}>
          <td><strong>{e.traineeName||"—"}</strong></td><td>{e.clientName||"—"}</td>
          <td>{e.status==="CONFIRMED"?<span className="record-status-tag">{l.confirmed}</span>
            :e.status==="WAITLISTED"?<span className="training-waitlist">{l.waitlisted} #{e.waitlistPosition}</span>
            :<span className="status-pill">{l.cancelledRow}</span>}</td>
          {asksId&&<td><span className={"training-id "+(identityProvided(e)?"is-on":"is-off")}><IdCard size={14}/>{identityProvided(e)?l.onFile:l.notOnFile}</span>
            {editable&&e.status!=="CANCELLED"&&<button type="button" className="text-action" disabled={busy} onClick={()=>setModal({kind:"identity",enrollment:e})}>{l.recordId}</button>}</td>}
          <td><div className="training-row-actions">
            <button type="button" className="text-action" onClick={()=>setModal({kind:"money",enrollment:e})}><ReceiptText size={15}/>{l.money}</button>
            {editable&&e.status!=="CANCELLED"&&<button type="button" className="text-action" disabled={busy} onClick={()=>setModal({kind:"cancel",enrollment:e})}><UserMinus size={15}/>{l.cancelEnrollment}</button>}
          </div></td>
        </tr>)}</tbody></table></div>}
      {editable&&cohort.status==="OPEN"&&<form className="opportunity-form training-form" onSubmit={ev=>{ev.preventDefault();
        void run(async()=>{await enrollTraineeWithId(cohort.id,cohort.version,Number(trainee),sponsor?Number(sponsor):undefined,asksId&&nationalId?nationalId:undefined);setTrainee("");setNationalId("");});}}>
        <label><span>{l.sponsor}</span><select value={sponsor} onChange={e=>setSponsor(e.target.value)}>
          <option value="">{l.chooseSponsor}</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label><span>{l.trainee}</span><select required value={trainee} onChange={e=>setTrainee(e.target.value)}>
          <option value="">{l.chooseTrainee}</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        {asksId&&<label><span>{l.nationalId}{rules?.identityCollection==="REQUIRED"?" *":""}</span>
          <input dir="ltr" inputMode="numeric" autoComplete="off" maxLength={20} required={rules?.identityCollection==="REQUIRED"}
            value={nationalId} onChange={e=>setNationalId(e.target.value)} aria-describedby="training-id-hint"/></label>}
        <button type="submit" className="btn btn-primary" disabled={busy||!trainee}><Plus size={16}/>{l.enroll}</button>
        {asksId&&<small id="training-id-hint" className="training-hint"><LockKeyhole size={13}/>{l.nationalIdHint}</small>}
      </form>}
    </section>

    {eligibility&&<CertificatesCard l={l} language={language} eligibility={eligibility} editable={editable} busy={busy}
      onScore={(row,score)=>void run(()=>recordScore(row.enrollmentId,row.version,score))}
      onIssue={row=>void run(()=>issueCertificate(row.enrollmentId,row.version))}
      onIssueAll={()=>void run(async()=>{const fresh=await getTrainingCohort(cohort.id);const r=await issueAllCertificates(cohort.id,fresh.version);
        setTimeout(()=>setNotice(l.bulkDone(r.issued.length,r.skipped.length)),0);})}
      onPrint={id=>setModal({kind:"print",certificateId:id})}
      onRevoke={row=>row.certificateId&&setModal({kind:"revoke",certificateId:row.certificateId,version:row.certificateVersion??0,trainee:row.traineeName})}/>}

    <section className="record-content-card" aria-labelledby="sessions-title">
      <div className="record-section-header"><div className="record-section-icon"><CalendarClock size={20}/></div><div><h2 id="sessions-title">{l.sessions}</h2></div></div>
      {sessions.length===0?<div className="empty-state">{l.noSessions}</div>
      :<div className="segmented training-sessions" role="group" aria-label={l.sessions}>{sessions.map(s=><button key={s.id} type="button"
        className={activeSession===s.id?"chosen":""} aria-pressed={activeSession===s.id} onClick={()=>setActiveSession(s.id)}>
        {s.title} · <span dir="ltr">{s.startsAt.replace("T"," ").slice(0,16)}</span></button>)}</div>}
      {session&&<div className="table-scroll"><table aria-label={l.attendance}><thead><tr><th>{l.trainee}</th><th>{l.attendance}</th></tr></thead>
        <tbody>{confirmed.map(e=>{const current=attendance.find(a=>a.enrollmentId===e.id)?.status;
          return <tr key={e.id}><td>{e.traineeName||"—"}</td><td><div className="segmented" role="group" aria-label={(e.traineeName||"")+" "+l.attendance}>
            {(["PRESENT","ABSENT","EXCUSED"] as AttendanceStatus[]).map(st=><button key={st} type="button" disabled={busy||!editable}
              className={current===st?"chosen":""} aria-pressed={current===st} onClick={()=>mark(e.id,st)}>
              {st==="PRESENT"?l.present:st==="ABSENT"?l.absent:l.excused}</button>)}
          </div></td></tr>;})}</tbody></table></div>}
      {editable&&<form className="opportunity-form training-form" onSubmit={ev=>{ev.preventDefault();
        void run(async()=>{await scheduleSession(cohort.id,cohort.version,title,startsAt,minutes?Number(minutes):undefined);setTitle("");setStartsAt("");setMinutes("");});}}>
        <label><span>{l.sessionTitle}</span><input required value={title} onChange={e=>setTitle(e.target.value)}/></label>
        <label><span>{l.startsAt}</span><input required type="datetime-local" value={startsAt} onChange={e=>setStartsAt(e.target.value)}/></label>
        <label><span>{l.minutes}</span><input type="number" min="15" max="720" value={minutes} onChange={e=>setMinutes(e.target.value)}/></label>
        <button type="submit" className="btn btn-secondary" disabled={busy}><Plus size={16}/>{l.addSession}</button>
      </form>}
    </section>

    {refunds&&refunds.length>0&&<section className="record-content-card" aria-labelledby="refunds-title">
      <div className="record-section-header"><div className="record-section-icon"><Undo2 size={20}/></div><div><h2 id="refunds-title">{l.refunds}</h2></div></div>
      <RefundTable l={l} language={language} refunds={refunds} busy={busy} onApprove={r=>setModal({kind:"approve",refund:r})} onReject={r=>setModal({kind:"reject",refund:r})}/>
    </section>}

    {modal?.kind==="cancel"&&<CancelEnrollmentDialog l={l} enrollment={modal.enrollment} busy={busy} onClose={close}
      onConfirm={version=>done(()=>cancelEnrollment(modal.enrollment.id,version))}/>}
    {modal?.kind==="cohortCancel"&&<CohortCancelDialog l={l} cohort={cohort} busy={busy} onClose={close}
      onConfirm={version=>done(()=>cancelCohort(cohort.id,version))}/>}
    {modal?.kind==="money"&&<MoneyDialog l={l} language={language} enrollment={modal.enrollment} editable={editable} busy={busy} onClose={close}
      onLink={(invoiceId,share)=>done(()=>linkInvoice(modal.enrollment.id,invoiceId,share))}
      onRequest={version=>done(()=>requestRefund(modal.enrollment.id,version))}/>}
    {modal?.kind==="identity"&&<IdentityDialog l={l} busy={busy} trainee={modal.enrollment.traineeName} required={rules?.identityCollection==="REQUIRED"} onClose={close}
      onSave={value=>done(()=>recordNationalId(modal.enrollment.id,modal.enrollment.version,value))}/>}
    {modal?.kind==="revoke"&&<ReasonDialog l={l} busy={busy} title={l.revokeTitle} label={l.revokeReason} note={l.revokeNote} kicker={modal.trainee||""} confirm={l.revoke}
      onClose={close} onSave={reason=>done(()=>revokeCertificate(modal.certificateId,modal.version,reason))}/>}
    {modal?.kind==="print"&&<CertificatePrint l={l} language={language} certificateId={modal.certificateId} onClose={close}/>}
    {modal?.kind==="approve"&&<ApproveDialog l={l} language={language} refund={modal.refund} onClose={close} onDone={()=>{close();void reload();}}/>}
    {modal?.kind==="reject"&&<ReasonDialog l={l} busy={busy} title={l.rejectTitle} label={l.rejectReason} kicker={modal.refund.traineeName||""} confirm={l.reject}
      onClose={close} onSave={reason=>done(()=>rejectRefund(modal.refund,reason))}/>}
  </div>;
}

function RulesCard({l,rules}:{l:Labels;rules:CohortRules}){
  const id=rules.identityCollection;
  return <section className="record-content-card training-rules" aria-labelledby="rules-title">
    <div className="record-section-header"><div className="record-section-icon"><Scale size={20}/></div><div><h2 id="rules-title">{l.rules}</h2></div></div>
    <dl className="record-properties training-rule-grid">
      <div><dt>{l.criteria}</dt><dd>{rules.criteriaSet?<>{l.minAttendance} {pct(rules.minAttendancePercent)}% · {rules.passMark!=null?`${l.passMark} ${pct(rules.passMark)}`:l.noPassMark}</>
        :<span className="training-missing">{l.notSet}</span>}</dd></div>
      <div><dt>{l.identity}</dt><dd>{id?(id==="NOT_ASKED"?l.identityNotAsked:id==="OPTIONAL"?l.identityOptional:l.identityRequired):<span className="training-missing">{l.notSet}</span>}</dd></div>
      <div><dt>{l.refundSteps}</dt><dd>{rules.cancellationSet?<ul className="training-steps">
        {[...(rules.refundSteps||[])].sort((a,b)=>b.daysBeforeStart-a.daysBeforeStart).map(s=><li key={s.daysBeforeStart}>{l.stepLine(s.daysBeforeStart,pct(s.refundPercent))}</li>)}
        {rules.cohortCancelledRefundPercent!=null&&<li>{l.cohortRefund(pct(rules.cohortCancelledRefundPercent))}</li>}</ul>
        :<span className="training-missing">{l.notSet}</span>}</dd></div>
    </dl>
    {(!rules.criteriaSet||!id||!rules.cancellationSet)&&<ul className="training-policy-gaps">
      {!rules.criteriaSet&&<li><CircleAlert size={15}/>{l.criteriaMissing}</li>}
      {!id&&<li><CircleAlert size={15}/>{l.identityMissing}</li>}
      {!rules.cancellationSet&&<li><CircleAlert size={15}/>{l.cancellationMissing}</li>}
    </ul>}
  </section>;
}

function CertificatesCard({l,language,eligibility,editable,busy,onScore,onIssue,onIssueAll,onPrint,onRevoke}:{l:Labels;language:Language;eligibility:Eligibility;
  editable:boolean;busy:boolean;onScore:(row:Eligibility["rows"][number],score:number)=>void;onIssue:(row:Eligibility["rows"][number])=>void;onIssueAll:()=>void;
  onPrint:(id:number)=>void;onRevoke:(row:Eligibility["rows"][number])=>void}){
  const [scores,setScores]=useState<Record<number,string>>({});
  const can=eligibility.canIssue&&editable;
  const ready=eligibility.rows.filter(r=>r.eligible&&!r.certificateId).length;
  const assessed=eligibility.passMark!=null;
  return <section className="record-content-card" aria-labelledby="certs-title">
    <div className="record-section-header"><div className="record-section-icon"><Award size={20}/></div><div><h2 id="certs-title">{l.certificates}</h2>
      <p>{eligibility.criteriaSet?<>{l.minAttendance} {pct(eligibility.minAttendancePercent)}%{assessed?` · ${l.passMark} ${pct(eligibility.passMark)}`:""}</>:l.criteriaMissing}</p></div>
      {can&&eligibility.criteriaSet&&<button type="button" className="btn btn-primary training-head-action" disabled={busy||ready===0} onClick={onIssueAll}><Award size={16}/>{l.issueAll} ({ready})</button>}
    </div>
    {eligibility.rows.length===0?<div className="empty-state">{l.noTrainees}</div>
    :<div className="table-scroll"><table aria-label={l.certificates}><thead><tr><th>{l.trainee}</th><th>{l.attendance}</th>{assessed&&<th>{l.score}</th>}<th>{l.eligible}</th><th>{l.serial}</th></tr></thead>
      <tbody>{eligibility.rows.map(r=><tr key={r.enrollmentId}>
        <td><strong>{r.traineeName||"—"}</strong></td>
        <td><span dir="ltr">{pct(r.attendancePercent)}%</span> <small className="training-muted">({l.sessionsAttended(r.sessionsPresent,eligibility.sessions)})</small></td>
        {assessed&&<td>{can&&!r.certificateId?<form className="training-score" onSubmit={e=>{e.preventDefault();const v=scores[r.enrollmentId];if(v!==undefined&&v!=="")onScore(r,Number(v));}}>
            <input type="number" min="0" max="100" step="0.01" dir="ltr" aria-label={`${l.score} ${r.traineeName||""}`}
              value={scores[r.enrollmentId]??(r.score!=null?String(r.score):"")} onChange={e=>setScores(s=>({...s,[r.enrollmentId]:e.target.value}))}/>
            <button type="submit" className="text-action" disabled={busy}>{l.saveScore}</button></form>
          :<span dir="ltr">{r.score!=null?quantity(r.score):"—"}</span>}</td>}
        <td>{r.eligible?<span className="record-status-tag"><CircleCheck size={13}/>{l.eligible}</span>
          :<span className="training-reason">{r.reason?l.reasons[r.reason]:"—"}</span>}</td>
        <td>{r.certificateId?<div className="training-row-actions"><span dir="ltr" className="training-serial">{r.certificateSerial}</span>
            <small className="training-muted">{day(r.certificateIssued,language==="ar")}</small>
            <button type="button" className="text-action" onClick={()=>onPrint(r.certificateId!)}><Printer size={15}/>{l.print}</button>
            {can&&<button type="button" className="text-action" disabled={busy} onClick={()=>onRevoke(r)}>{l.revoke}</button>}</div>
          :can&&r.eligible?<button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={()=>onIssue(r)}><Award size={15}/>{l.issue}</button>:"—"}</td>
      </tr>)}</tbody></table></div>}
  </section>;
}

function Explain({children,tone}:{children:ReactNode;tone:"ok"|"warn"|"block"}){
  return <div className={"training-explain is-"+tone} role="status">{tone==="block"?<Ban size={17}/>:tone==="warn"?<CircleAlert size={17}/>:<CircleCheck size={17}/>}<p>{children}</p></div>;
}

function outcomeText(l:Labels,c:Cancellation){
  const o=l.outcome;
  switch(c.outcome){
    case "REFUND":return o.REFUND(amount(c.refundAmount,c.currency),pct(c.refundPercent),c.daysBeforeStart);
    case "NO_REFUND_DUE":return o.NO_REFUND_DUE(c.daysBeforeStart);
    default:return o[c.outcome];
  }
}

function CancelEnrollmentDialog({l,enrollment,busy,onClose,onConfirm}:{l:Labels;enrollment:TrainingEnrollment;busy:boolean;onClose:()=>void;onConfirm:(version:number)=>void}){
  const [preview,setPreview]=useState<Cancellation|null>(null);const [error,setError]=useState("");
  useEffect(()=>{void getCancellation(enrollment.id).then(setPreview).catch(e=>setError(message(e,l)));},[enrollment.id,l]);
  const blocked=preview?.outcome==="POLICY_NOT_SET"||preview?.outcome==="START_DATE_MISSING";
  return <Dialog title={l.cancelTitle} kicker={enrollment.traineeName||""} busy={busy} onClose={onClose} footer={<>
    <button type="button" className="btn btn-danger" disabled={busy||!preview||blocked} onClick={()=>preview&&onConfirm(preview.version)}>{l.cancelConfirm}</button>
    <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button></>}>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {!preview&&!error&&<div className="empty-state" role="status">{l.loading}</div>}
    {preview&&<>
      {preview.fee&&<dl className="record-properties training-money">
        <div><dt>{l.invoice}</dt><dd dir="ltr">{preview.fee.invoiceNumber||"—"}</dd></div>
        <div><dt>{l.paid}</dt><dd dir="ltr">{amount(preview.paid,preview.currency)}</dd></div>
        {preview.outcome==="REFUND"&&<div><dt>{l.refundAmount}</dt><dd dir="ltr"><strong>{amount(preview.refundAmount,preview.currency)}</strong></dd></div>}
      </dl>}
      <Explain tone={blocked?"block":preview.outcome==="REFUND"?"ok":"warn"}>{outcomeText(l,preview)}</Explain>
    </>}
  </Dialog>;
}

function CohortCancelDialog({l,cohort,busy,onClose,onConfirm}:{l:Labels;cohort:TrainingCohort;busy:boolean;onClose:()=>void;onConfirm:(version:number)=>void}){
  const [preview,setPreview]=useState<CohortCancellation|null>(null);const [error,setError]=useState("");
  useEffect(()=>{void getCohortCancellation(cohort.id).then(setPreview).catch(e=>setError(message(e,l)));},[cohort.id,l]);
  const blocked=!!preview&&(preview.outcome==="POLICY_NOT_SET"||preview.certificatesIssued>0);
  return <Dialog title={l.cohortCancelTitle} kicker={cohort.code} busy={busy} onClose={onClose} footer={<>
    <button type="button" className="btn btn-danger" disabled={busy||!preview||blocked} onClick={()=>preview&&onConfirm(preview.version)}>{l.cohortCancelConfirm}</button>
    <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button></>}>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {!preview&&!error&&<div className="empty-state" role="status">{l.loading}</div>}
    {preview&&(preview.certificatesIssued>0?<Explain tone="block">{l.cohortBlockedCerts(preview.certificatesIssued)}</Explain>
      :preview.outcome==="POLICY_NOT_SET"?<Explain tone="block">{l.cohortBlockedPolicy}</Explain>
      :preview.outcome==="REFUND"?<Explain tone="ok">{l.cohortOutcome(preview.enrollments,preview.refunds,amount(preview.refundTotal,preview.currency))}</Explain>
      :<Explain tone="warn">{l.cohortNoRefund(preview.enrollments)}</Explain>)}
  </Dialog>;
}

function MoneyDialog({l,language,enrollment,editable,busy,onClose,onLink,onRequest}:{l:Labels;language:Language;enrollment:TrainingEnrollment;editable:boolean;busy:boolean;
  onClose:()=>void;onLink:(invoiceId:number,share?:number)=>void;onRequest:(version:number)=>void}){
  const [info,setInfo]=useState<Cancellation|null>(null);const [choices,setChoices]=useState<InvoiceChoice[]|null>(null);
  const [chosen,setChosen]=useState<number|null>(null);const [share,setShare]=useState("");const [error,setError]=useState("");
  useEffect(()=>{void getCancellation(enrollment.id).then(c=>{setInfo(c);if(!c.fee&&c.canLinkInvoice)void getInvoiceChoices(enrollment.id).then(setChoices).catch(()=>setChoices([]));})
    .catch(e=>setError(message(e,l)));},[enrollment.id,l]);
  const pick=choices?.find(c=>c.id===chosen);
  const r=info?.refund;
  return <Dialog title={l.money} kicker={enrollment.traineeName||""} busy={busy} onClose={onClose} wide footer={<>
    {info&&!info.fee&&info.canLinkInvoice&&<button type="button" className="btn btn-primary" disabled={busy||!chosen}
      onClick={()=>chosen&&onLink(chosen,share?Number(share):undefined)}>{l.linkInvoice}</button>}
    {info&&editable&&info.status==="CANCELLED"&&!r&&info.fee&&info.outcome==="REFUND"&&<button type="button" className="btn btn-primary" disabled={busy}
      onClick={()=>onRequest(info.version)}>{l.requestRefund}</button>}
    <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button></>}>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {!info&&!error&&<div className="empty-state" role="status">{l.loading}</div>}
    {info&&(info.fee?<dl className="record-properties training-money">
        <div><dt>{l.invoice}</dt><dd dir="ltr">{info.fee.invoiceNumber||"—"}</dd></div>
        <div><dt>{l.share}</dt><dd dir="ltr">{amount(info.fee.amount,info.fee.currency)}</dd></div>
        <div><dt>{l.paid}</dt><dd dir="ltr">{amount(info.fee.paid,info.fee.currency)}</dd></div>
      </dl>:<p className="training-muted">{l.noFee}</p>)}
    {info&&!info.fee&&info.canLinkInvoice&&<fieldset className="training-invoices"><legend>{l.linkInvoice}</legend><p className="training-hint">{l.linkHint}</p>
      {choices===null?<div className="empty-state" role="status">{l.loading}</div>:choices.length===0?<div className="empty-state">{l.noInvoices}</div>
      :choices.map(c=><label key={c.id} className={"training-invoice"+(chosen===c.id?" is-chosen":"")}>
        <input type="radio" name="training-invoice" checked={chosen===c.id} disabled={c.unlinked<=0} onChange={()=>{setChosen(c.id);setShare(String(c.unlinked));}}/>
        <span dir="ltr"><strong>{c.number||"—"}</strong> · {day(c.date,language==="ar")}</span>
        <span>{amount(c.totalWithTax,c.currency)} · {l.received} {amount(c.received,c.currency)} · {l.unlinked} {amount(c.unlinked,c.currency)}</span>
      </label>)}
      {pick&&<label className="training-share"><span>{l.share} ({pick.currency})</span>
        <input type="number" min="0.01" step="0.01" max={pick.unlinked} dir="ltr" value={share} onChange={e=>setShare(e.target.value)}/></label>}
    </fieldset>}
    {info&&info.status==="CANCELLED"&&!r&&<Explain tone={info.outcome==="REFUND"?"ok":"warn"}>{outcomeText(l,info)}</Explain>}
    {r&&<div className="training-refund-summary"><FileText size={16}/><span>{l.refundStatus[r.status]} · <span dir="ltr">{amount(r.amount,r.currency)}</span>
      {r.creditNumber&&<> · {l.creditNo} <span dir="ltr">{r.creditNumber}</span></>}{r.rejectReason&&<> · {r.rejectReason}</>}</span></div>}
  </Dialog>;
}

function IdentityDialog({l,busy,trainee,required,onClose,onSave}:{l:Labels;busy:boolean;trainee:string|null;required:boolean;onClose:()=>void;onSave:(value:string)=>void}){
  const [value,setValue]=useState("");
  return <Dialog title={l.recordId} kicker={trainee||""} busy={busy} onClose={onClose} footer={<>
    <button type="button" className="btn btn-primary" disabled={busy||!value.trim()} onClick={()=>onSave(value)}>{l.save}</button>
    <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button></>}>
    <label className="training-field"><span>{l.nationalId}{required?" *":""}</span>
      <input dir="ltr" inputMode="numeric" autoComplete="off" maxLength={20} value={value} onChange={e=>setValue(e.target.value)}/></label>
    <p className="training-hint"><LockKeyhole size={13}/>{l.nationalIdHint}</p>
  </Dialog>;
}

function ReasonDialog({l,busy,title,label,note,kicker,confirm,onClose,onSave}:{l:Labels;busy:boolean;title:string;label:string;note?:string;kicker:string;confirm:string;
  onClose:()=>void;onSave:(reason:string)=>void}){
  const [reason,setReason]=useState("");
  return <Dialog title={title} kicker={kicker} busy={busy} onClose={onClose} footer={<>
    <button type="button" className="btn btn-danger" disabled={busy||!reason.trim()} onClick={()=>onSave(reason)}>{confirm}</button>
    <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button></>}>
    <label className="training-field"><span>{label}</span><textarea rows={3} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    {note&&<p className="training-hint"><LockKeyhole size={13}/>{note}</p>}
  </Dialog>;
}

function CertificatePrint({l,language,certificateId,onClose}:{l:Labels;language:Language;certificateId:number;onClose:()=>void}){
  const [c,setC]=useState<Certificate|null>(null);const [error,setError]=useState("");
  useEffect(()=>{void getCertificate(certificateId).then(setC).catch(e=>setError(message(e,l)));},[certificateId,l]);
  const ar=language==="ar";
  return <Dialog title={l.certTitle} kicker={c?.serial||""} onClose={onClose} wide footer={<>
    <button type="button" className="btn btn-primary" disabled={!c} onClick={()=>window.print()}><Printer size={16}/>{l.print}</button>
    <button type="button" className="btn btn-secondary" onClick={onClose}>{l.cancel}</button></>}>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {c&&<article className={"training-certificate"+(c.status==="REVOKED"?" is-revoked":"")} aria-label={l.certTitle}>
      <Award size={40} aria-hidden="true"/>
      <h3>{l.certTitle}</h3>
      <p>{l.certifies}</p>
      <p className="training-certificate-name">{c.traineeName}</p>
      <p>{l.completed}</p>
      <p className="training-certificate-course">{(ar&&c.courseNameAr)||c.courseName}</p>
      <p>{l.held} <span dir="ltr">{c.cohortCode}</span>{c.startDate?<> · {day(c.startDate,ar)}{c.endDate?<> – {day(c.endDate,ar)}</>:null}</>:null}
        {c.durationHours?<> · {c.durationHours} {l.hoursLabel}</>:null}</p>
      <footer><span>{l.serial}: <strong dir="ltr">{c.serial}</strong></span><span>{l.issuedOn}: {day(c.issueDate,ar)}</span></footer>
      {c.status==="REVOKED"&&<div className="training-revoked-stamp">{l.revokedTag}</div>}
    </article>}
  </Dialog>;
}

function RefundTable({l,language,refunds,busy,onApprove,onReject}:{l:Labels;language:Language;refunds:Refund[];busy:boolean;
  onApprove:(r:Refund)=>void;onReject:(r:Refund)=>void}){
  return <div className="table-scroll"><table aria-label={l.refunds}><thead><tr><th>{l.trainee}</th><th>{l.invoice}</th><th>{l.paid}</th><th>{l.refundAmount}</th>
    <th>{l.position}</th><th><span className="sr-only">{l.approve}</span></th></tr></thead>
    <tbody>{refunds.map(r=><tr key={r.id}>
      <td><strong>{r.traineeName||"—"}</strong><small className="training-muted"> · <span dir="ltr">{r.cohortCode}</span> · {l.cause[r.cause]}</small></td>
      <td dir="ltr">{r.invoiceNumber||"—"}</td>
      <td dir="ltr">{amount(r.paidAmount,r.currency)}</td>
      <td><span dir="ltr"><strong>{amount(r.amount,r.currency)}</strong></span> <small className="training-muted">({pct(r.refundPercent)}%{r.daysBeforeStart!=null?` · ${r.daysBeforeStart}d`:""})</small></td>
      <td><span className={"training-refund-status is-"+r.status.toLowerCase()}>{l.refundStatus[r.status]}</span>
        {r.creditNumber&&<small className="training-muted"> · <span dir="ltr">{r.creditNumber}</span></small>}
        <small className="training-muted"> · {l.requestedOn} {day(r.requestedAt,language==="ar")}</small></td>
      <td>{r.canDecide&&<div className="training-row-actions">
        <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={()=>onApprove(r)}>{l.approve}</button>
        <button type="button" className="text-action" disabled={busy} onClick={()=>onReject(r)}>{l.reject}</button></div>}</td>
    </tr>)}</tbody></table></div>;
}

/** Finance's two steps in one action: the credit note through the D-06 service, then the refund records it. */
function ApproveDialog({l,language,refund,onClose,onDone}:{l:Labels;language:Language;refund:Refund;onClose:()=>void;onDone:()=>void}){
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [creditId,setCreditId]=useState<number|null>(refund.pendingCreditId);
  async function approve(){
    if(busy)return;
    setBusy(true);setError("");
    try{
      const id=creditId??await issueRefundCreditNote(refund);
      setCreditId(id);
      await approveRefund(refund,id);
      onDone();
    }catch(e){setError(message(e,l));}
    finally{setBusy(false);}
  }
  return <Dialog title={l.approveTitle} kicker={refund.traineeName||""} busy={busy} onClose={onClose} footer={<>
    <button type="button" className="btn btn-primary" disabled={busy} onClick={()=>void approve()}><ReceiptText size={16}/>{l.approve}</button>
    <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button></>}>
    <dl className="record-properties training-money">
      <div><dt>{l.invoice}</dt><dd dir="ltr">{refund.invoiceNumber||"—"}</dd></div>
      <div><dt>{l.invoiceTotal}</dt><dd dir="ltr">{amount(refund.invoiceTotal,refund.currency)}</dd></div>
      <div><dt>{l.paid}</dt><dd dir="ltr">{amount(refund.paidAmount,refund.currency)}</dd></div>
      <div><dt>{l.refundAmount}</dt><dd dir="ltr"><strong>{amount(refund.amount,refund.currency)}</strong> ({pct(refund.refundPercent)}%)</dd></div>
      <div><dt>{l.requestedOn}</dt><dd>{day(refund.requestedAt,language==="ar")}{refund.requestedBy?` · ${refund.requestedBy}`:""}</dd></div>
    </dl>
    {creditId?<Explain tone="warn">{l.pendingCredit}</Explain>:<Explain tone="ok">{l.approveNote(pct(refund.creditPercent),refund.invoiceNumber||"")}</Explain>}
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
  </Dialog>;
}

/** The refund requests the caller may read; finance decides each one. */
function RefundQueue({l,language}:{l:Labels;language:Language}){
  const [status,setStatus]=useState<"REQUESTED"|"ALL">("REQUESTED");
  const [rows,setRows]=useState<Refund[]|null>(null);const [error,setError]=useState("");
  const [modal,setModal]=useState<{kind:"approve"|"reject";refund:Refund}|null>(null);const [busy,setBusy]=useState(false);
  const load=useCallback(()=>getRefunds(status).then(setRows).catch(e=>{setRows([]);setError(message(e,l));}),[status,l]);
  useEffect(()=>{void load();},[load]);
  return <section className="record-content-card training-queue" aria-labelledby="refund-queue-title">
    <div className="record-section-header"><div className="record-section-icon"><Undo2 size={20}/></div><div><h2 id="refund-queue-title">{l.refundQueue}</h2></div>
      <div className="segmented training-head-action" role="group" aria-label={l.refundQueue}>
        <button type="button" className={status==="REQUESTED"?"chosen":""} aria-pressed={status==="REQUESTED"} onClick={()=>setStatus("REQUESTED")}>{l.refundStatus.REQUESTED}</button>
        <button type="button" className={status==="ALL"?"chosen":""} aria-pressed={status==="ALL"} onClick={()=>setStatus("ALL")}>{language==="ar"?"الكل":"All"}</button>
      </div></div>
    {error&&<div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {rows===null?<div className="empty-state" role="status">{l.loading}</div>:rows.length===0?<div className="empty-state">{l.noRefunds}</div>
      :<RefundTable l={l} language={language} refunds={rows} busy={busy} onApprove={r=>setModal({kind:"approve",refund:r})} onReject={r=>setModal({kind:"reject",refund:r})}/>}
    {modal?.kind==="approve"&&<ApproveDialog l={l} language={language} refund={modal.refund} onClose={()=>setModal(null)} onDone={()=>{setModal(null);void load();}}/>}
    {modal?.kind==="reject"&&<ReasonDialog l={l} busy={busy} title={l.rejectTitle} label={l.rejectReason} kicker={modal.refund.traineeName||""} confirm={l.reject}
      onClose={()=>setModal(null)} onSave={reason=>{setBusy(true);setError("");void rejectRefund(modal.refund,reason).then(()=>{setModal(null);return load();})
        .catch(e=>setError(message(e,l))).finally(()=>setBusy(false));}}/>}
  </section>;
}
