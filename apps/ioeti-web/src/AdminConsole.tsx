import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft, ArrowRight, CircleAlert, Copy, History, KeyRound, Layers3, LockKeyhole, Plus, RefreshCw, Save, Search,
  ShieldCheck, UserCheck, UserPlus, UserX, UsersRound,
} from "lucide-react";
import { ApiError } from "./api";
import {
  activatePerson, addLine, addPerson, addTeam, changeLine, changePerson, changeTeam, deactivatePerson, getAdminLines, getChanges,
  getLineMembers, getPeople, getPerson, getProfile, getProfiles, getTeams, getRoleCatalog, createProfile, setProfileRight, makeTemporaryPassword, setLineMembers, setTemporaryPassword,
  type AdminChange, type AdminLine, type AdminTeam, type AdminUser, type AdminUserDetail, type PersonRef, type Profile, type ProfileAccess, type RoleCatalog, type RecordTypeInfo, type RightChange, type Scope,
} from "./adminApi";
import { ChipPicker, Dialog, copyText } from "./Dialog";
import { AdminLists } from "./AdminLists";
import { AdminNumbering } from "./AdminNumbering";
import { AdminQuality } from "./AdminQuality";
import "./admin.css";
import { PageHeader } from "./ui";

type Language = "ar" | "en";
type Tab = "people" | "teams" | "lines" | "lists" | "quality" | "numbering" | "profiles" | "changes";
const TABS: Tab[] = ["people", "teams", "lines", "lists", "quality", "numbering", "profiles", "changes"];

const L = {
  ar: {
    area: "الإدارة", title: "لوحة الإدارة", hint: "الأشخاص، والوصول، والفرق، وخطوط الأعمال، وسجل كل تغيير. كل حاجة هنا بتتعمل من المنصة وبتتسجل.",
    tabs: { people: "الأشخاص", teams: "الفرق", lines: "خطوط الأعمال", lists: "القوائم", quality: "إعداد الجودة", numbering: "الترقيم", profiles: "ملفات الصلاحيات", changes: "سجل التغييرات" },
    addPerson: "إضافة شخص", addTeam: "إضافة فريق", addLine: "إضافة خط أعمال", search: "ابحث بالاسم أو اسم الدخول",
    all: "الكل", active: "نشط", inactive: "موقوف", allLines: "كل الخطوط", person: "الشخص", login: "اسم الدخول", profile: "ملف الصلاحيات",
    lines: "خطوط الأعمال", teams: "الفرق", status: "الحالة", open: "فتح", mustChange: "سيغيّر كلمة المرور", admin: "مسؤول نظام",
    noProfile: "بدون ملف", noPeople: "لا يوجد أشخاص بهذا البحث.", name: "الاسم الكامل", email: "البريد الإلكتروني (اختياري)",
    emailHint: "يُحفظ ولا يُعرض بعد الحفظ.", language: "لغة الواجهة", temp: "كلمة مرور مؤقتة", regenerate: "كلمة جديدة", copy: "نسخ",
    copied: "اتنسخت", tempHint: "انسخها وأرسلها للشخص بطريقة آمنة. هيُطلب منه يغيّرها عند أول دخول، ومش هتظهر تاني بعد ما تقفل النافذة.",
    choose: "اختر…", none: "لا شيء", save: "حفظ", cancel: "إلغاء", close: "إغلاق", saving: "جاري الحفظ…", created: "الحساب جاهز",
    createdHint: "ابعت اسم الدخول وكلمة المرور المؤقتة للشخص. عند أول دخول هيختار كلمة مرور خاصة بيه.",
    adminWarning: "ملف مسؤول النظام بيدّي صلاحية كاملة على المنصة، ومنها لوحة الإدارة.",
    back: "كل الأشخاص", edit: "تعديل البيانات", deactivate: "إيقاف الحساب", activate: "تفعيل الحساب", reset: "كلمة مرور مؤقتة جديدة",
    deactivateHint: "الشخص مش هيقدر يدخل، وأي جلسة مفتوحة له هتتقفل مع أول طلب. سجلاته بتفضل زي ما هي.",
    activateHint: "الشخص هيقدر يدخل تاني بنفس كلمة المرور.", resetHint: "كلمة المرور الحالية هتتلغي، والشخص هيختار واحدة جديدة عند الدخول.",
    access: "الوصول", accessHint: "اللي ملف الصلاحيات بيسمح بيه، لكل نوع سجل. الشرط معناه إن القاعدة مقصورة على سجلات معيّنة (زي سجلاته هو).",
    read: "قراءة", write: "تعديل", create: "إنشاء", remove: "حذف", conditional: "بشرط", fullAccess: "صلاحية كاملة على المنصة.",
    noRules: "الملف ده مفيهوش قواعد.", history: "سجل التغييرات", noHistory: "مفيش تغييرات مسجلة.",
    d07: "D-07: كل ملف بيبدأ من قالب وظيفة ومن غير أي صلاحيات، وبعدين تدّيه اللي محتاجه بس. مالك السياسات بيتعيّن من صفحة السياسات، مش من هنا.",
    newProfile: "ملف جديد", template: "القالب", profileCode: "رمز الملف", profileName: "اسم الملف", createProfile: "إنشاء الملف",
    profileCreated: "اتعمل الملف من غير صلاحيات. ادّيه اللي محتاجه من الجدول.", role: "الدور", scope: "النطاق",
    scopes: { OWN: "سجلاته", TEAM: "فريقه", LINE: "خطوط أعماله", ALL: "الكل" } as Record<string, string>,
    areas: { SALES: "المبيعات", FINANCE: "المالية", DELIVERY: "التنفيذ", CERTIFICATION: "الشهادات", TRAINING: "التدريب", RECRUITMENT: "التوظيف", FUNDRAISING: "تنمية الموارد", CONTENT: "المعرفة", ADMIN: "الإدارة" } as Record<string, string>,
    restricted: "بيانات مقيدة", managedElsewhere: "متضبطة من مكان تاني", adminFixed: "ملف المديرين ثابت ومش بيتعدّل من هنا.",
    readFirst: "اللي بيعدّل لازم يقدر يقرأ الأول.", savedRight: "اتحفظت الصلاحية.", rightOf: (x: string) => "صلاحيات " + x,
    people: "شخص", rules: "قاعدة", team: "الفريق", members: "الأعضاء", noMembers: "مفيش أعضاء", addMember: "أضف عضو…", noTeams: "مفيش فرق لسه.",
    teamName: "اسم الفريق", editTeam: "تعديل الفريق", lineCode: "الرمز", nameAr: "الاسم بالعربي", nameEn: "الاسم بالإنجليزي",
    order: "الترتيب", purpose: "الغرض", responsibleTeam: "الفريق المسؤول", manager: "مدير الخط", editLine: "تعديل خط الأعمال",
    lineMembers: "أعضاء الخط", membersHint: "الأعضاء يقدروا يشتغلوا على سجلات الخط ده حسب ملفات صلاحياتهم.",
    setup: "قيد الإعداد", suspended: "موقوف", lineStatus: { 1: "قيد الإعداد", 2: "نشط", 3: "موقوف" } as Record<number, string>,
    filterAll: "الكل", filterPeople: "الأشخاص", filterTeams: "الفرق", filterLines: "خطوط الأعمال", more: "تحميل المزيد", by: "بواسطة",
    forbidden: "لوحة الإدارة لمسؤولي النظام بس.", failed: "تعذّر التحميل. حاول تاني.", conflict: "السجل اتغيّر من مكان تاني. حدّث الصفحة وحاول تاني.",
    selfLock: "مينفعش توقف حسابك أو تشيل صلاحية الإدارة عن نفسك.", selfPassword: "غيّر كلمة مرورك من الإعدادات.",
    duplicate: "القيمة دي مستخدمة قبل كده.", required: "الحقل ده مطلوب.", format: "الصيغة مش صحيحة.", weak: "كلمة المرور ضعيفة: استخدم حروف كبيرة وصغيرة وأرقام.",
    tooShort: "كلمة المرور لازم تكون 12 حرف على الأقل.", lockedNote: "الحسابات الموقوفة مش بتقدر تدخل.",
    actions: {
      USER_CREATED: "إضافة شخص", USER_UPDATED: "تعديل بيانات", USER_DEACTIVATED: "إيقاف حساب", USER_ACTIVATED: "تفعيل حساب",
      USER_PASSWORD_RESET: "كلمة مرور مؤقتة", TEAM_CREATED: "إضافة فريق", TEAM_UPDATED: "تعديل فريق", LINE_CREATED: "إضافة خط أعمال",
      LINE_UPDATED: "تعديل خط أعمال", LINE_MEMBERS: "أعضاء خط أعمال", PROFILE_CREATED: "إنشاء ملف صلاحيات", PROFILE_RIGHT_SET: "تعديل صلاحية",
      LOST_REASON_ADDED: "إضافة سبب خسارة", LOST_REASON_RENAMED: "تسمية سبب خسارة", LOST_REASON_DELETED: "حذف سبب خسارة",
      SOURCE_ADDED: "إضافة مصدر", SOURCE_RENAMED: "تسمية مصدر", SOURCE_DELETED: "حذف مصدر",
      OPPORTUNITY_STAGE_ADDED: "إضافة مرحلة", OPPORTUNITY_STAGE_RENAMED: "تسمية مرحلة", OPPORTUNITY_STAGE_DELETED: "حذف مرحلة",
      OPPORTUNITY_STAGE_ORDERED: "ترتيب المراحل", NUMBERING_SET: "ضبط الترقيم", CAMPAIGN_TYPE_ADDED: "إضافة نوع حملة", CAMPAIGN_TYPE_RENAMED: "تسمية نوع حملة", CAMPAIGN_TYPE_DELETED: "حذف نوع حملة",
      QI_STATUS_ADDED: "إضافة حالة جودة", QI_STATUS_CHANGED: "تعديل حالة جودة", QI_STATUS_DELETED: "حذف حالة جودة",
      QI_DETECTION_ADDED: "إضافة مصدر اكتشاف", QI_DETECTION_CHANGED: "تعديل مصدر اكتشاف", QI_DETECTION_DELETED: "حذف مصدر اكتشاف",
      QI_ISSUE_TYPE_ADDED: "إضافة نوع مشكلة", QI_ISSUE_TYPE_CHANGED: "تعديل نوع مشكلة", QI_ISSUE_TYPE_DELETED: "حذف نوع مشكلة",
      QI_ACTION_TYPE_ADDED: "إضافة نوع إجراء", QI_ACTION_TYPE_CHANGED: "تعديل نوع إجراء", QI_ACTION_TYPE_DELETED: "حذف نوع إجراء",
      QI_METHOD_ADDED: "إضافة طريقة تحليل", QI_METHOD_CHANGED: "تعديل طريقة تحليل", QI_METHOD_DELETED: "حذف طريقة تحليل",
      QI_METHOD_BRANCH_ADDED: "إضافة فرع لطريقة تحليل", QI_METHOD_BRANCH_DELETED: "حذف فرع من طريقة تحليل",
      QI_CAUSE_ADDED: "إضافة سبب", QI_CAUSE_CHANGED: "تعديل سبب", QI_CAUSE_DELETED: "حذف سبب",
      QI_PROCESS_ADDED: "إضافة عملية", QI_PROCESS_CHANGED: "تعديل عملية", QI_PROCESS_DELETED: "حذف عملية",
    } as Record<string, string>,
  },
  en: {
    area: "Administration", title: "Admin console", hint: "People, access, teams, business lines and a record of every change, all from the platform.",
    tabs: { people: "People", teams: "Teams", lines: "Business lines", lists: "Lists", quality: "Quality set-up", numbering: "Numbering", profiles: "Access profiles", changes: "Change log" },
    addPerson: "Add person", addTeam: "Add team", addLine: "Add business line", search: "Search by name or sign-in name",
    all: "All", active: "Active", inactive: "Deactivated", allLines: "All lines", person: "Person", login: "Sign-in name", profile: "Access profile",
    lines: "Business lines", teams: "Teams", status: "Status", open: "Open", mustChange: "Will change password", admin: "Administrator",
    noProfile: "No profile", noPeople: "Nobody matches this search.", name: "Full name", email: "E-mail (optional)",
    emailHint: "Stored, never shown after saving.", language: "Interface language", temp: "Temporary password", regenerate: "New one", copy: "Copy",
    copied: "Copied", tempHint: "Copy it and give it to the person safely. They must change it at the first sign-in; it is not shown again.",
    choose: "Choose…", none: "None", save: "Save", cancel: "Cancel", close: "Close", saving: "Saving…", created: "The account is ready",
    createdHint: "Give the person the sign-in name and the temporary password. They choose their own at the first sign-in.",
    adminWarning: "The administrator profile gives full access to the platform, including this console.",
    back: "All people", edit: "Edit details", deactivate: "Deactivate", activate: "Activate", reset: "New temporary password",
    deactivateHint: "The person can no longer sign in and any open session ends at its next request. Their records stay.",
    activateHint: "The person can sign in again with the same password.", resetHint: "The current password stops working; the person chooses a new one at sign-in.",
    access: "Access", accessHint: "What the profile allows per record type. Conditional means the rule covers some records only (for example their own).",
    read: "Read", write: "Edit", create: "Create", remove: "Delete", conditional: "Conditional", fullAccess: "Full access to the platform.",
    noRules: "This profile has no rules.", history: "Change log", noHistory: "No changes recorded.",
    d07: "D-07: every profile starts from a job template with no rights; give it only what it needs. The policy owner is appointed under Policies, not here.",
    newProfile: "New profile", template: "Template", profileCode: "Profile code", profileName: "Profile name", createProfile: "Create profile",
    profileCreated: "The profile was created with no rights. Grant what it needs in the table.", role: "Role", scope: "Scope",
    scopes: { OWN: "Their own", TEAM: "Their teams", LINE: "Their business lines", ALL: "All" } as Record<string, string>,
    areas: { SALES: "Sales", FINANCE: "Finance", DELIVERY: "Delivery", CERTIFICATION: "Certification", TRAINING: "Training", RECRUITMENT: "Recruitment", FUNDRAISING: "Fundraising", CONTENT: "Knowledge", ADMIN: "Administration" } as Record<string, string>,
    restricted: "Restricted data", managedElsewhere: "Managed elsewhere", adminFixed: "The administrators' profile is fixed and not edited here.",
    readFirst: "A profile that changes records must be able to read them.", savedRight: "Right saved.", rightOf: (x: string) => "Rights for " + x,
    people: "people", rules: "rules", team: "Team", members: "Members", noMembers: "No members", addMember: "Add a member…", noTeams: "No teams yet.",
    teamName: "Team name", editTeam: "Edit team", lineCode: "Code", nameAr: "Arabic name", nameEn: "English name",
    order: "Order", purpose: "Purpose", responsibleTeam: "Responsible team", manager: "Line manager", editLine: "Edit business line",
    lineMembers: "Line members", membersHint: "Members work on this line's records within their access profiles.",
    setup: "In set-up", suspended: "Suspended", lineStatus: { 1: "In set-up", 2: "Active", 3: "Suspended" } as Record<number, string>,
    filterAll: "All", filterPeople: "People", filterTeams: "Teams", filterLines: "Business lines", more: "Load more", by: "by",
    forbidden: "The admin console is for administrators only.", failed: "Could not load. Try again.", conflict: "The record changed elsewhere. Refresh and try again.",
    selfLock: "You cannot deactivate yourself or remove your own administrator profile.", selfPassword: "Change your own password from Settings.",
    duplicate: "This value is already used.", required: "This field is required.", format: "The format is not valid.", weak: "Weak password: mix capital and lower-case letters and digits.",
    tooShort: "Use at least 12 characters.", lockedNote: "Deactivated accounts cannot sign in.",
    actions: {
      USER_CREATED: "Person added", USER_UPDATED: "Details changed", USER_DEACTIVATED: "Deactivated", USER_ACTIVATED: "Activated",
      USER_PASSWORD_RESET: "Temporary password", TEAM_CREATED: "Team added", TEAM_UPDATED: "Team changed", LINE_CREATED: "Line added",
      LINE_UPDATED: "Line changed", LINE_MEMBERS: "Line members", PROFILE_CREATED: "Profile created", PROFILE_RIGHT_SET: "Right changed",
      LOST_REASON_ADDED: "Lost reason added", LOST_REASON_RENAMED: "Lost reason renamed", LOST_REASON_DELETED: "Lost reason deleted",
      SOURCE_ADDED: "Source added", SOURCE_RENAMED: "Source renamed", SOURCE_DELETED: "Source deleted",
      OPPORTUNITY_STAGE_ADDED: "Stage added", OPPORTUNITY_STAGE_RENAMED: "Stage renamed", OPPORTUNITY_STAGE_DELETED: "Stage deleted",
      OPPORTUNITY_STAGE_ORDERED: "Stages reordered", NUMBERING_SET: "Numbering set", CAMPAIGN_TYPE_ADDED: "Campaign type added", CAMPAIGN_TYPE_RENAMED: "Campaign type renamed", CAMPAIGN_TYPE_DELETED: "Campaign type deleted",
      QI_STATUS_ADDED: "Quality status added", QI_STATUS_CHANGED: "Quality status changed", QI_STATUS_DELETED: "Quality status deleted",
      QI_DETECTION_ADDED: "Detection source added", QI_DETECTION_CHANGED: "Detection source changed", QI_DETECTION_DELETED: "Detection source deleted",
      QI_ISSUE_TYPE_ADDED: "Issue type added", QI_ISSUE_TYPE_CHANGED: "Issue type changed", QI_ISSUE_TYPE_DELETED: "Issue type deleted",
      QI_ACTION_TYPE_ADDED: "Action type added", QI_ACTION_TYPE_CHANGED: "Action type changed", QI_ACTION_TYPE_DELETED: "Action type deleted",
      QI_METHOD_ADDED: "Analysis method added", QI_METHOD_CHANGED: "Analysis method changed", QI_METHOD_DELETED: "Analysis method deleted",
      QI_METHOD_BRANCH_ADDED: "Method branch added", QI_METHOD_BRANCH_DELETED: "Method branch removed",
      QI_CAUSE_ADDED: "Cause added", QI_CAUSE_CHANGED: "Cause changed", QI_CAUSE_DELETED: "Cause deleted",
      QI_PROCESS_ADDED: "Process added", QI_PROCESS_CHANGED: "Process changed", QI_PROCESS_DELETED: "Process deleted",
    } as Record<string, string>,
  },
};
type Labels = typeof L.ar;

/** Where a record type of the profile rules belongs, in words people recognise. */
const AREAS: Record<string, [string, string]> = {
  Lead: ["العملاء المحتملون", "Leads"], Event: ["المتابعات والأنشطة", "Follow-ups and activities"], Opportunity: ["الفرص التجارية", "Opportunities"],
  Partner: ["الحسابات وجهات الاتصال", "Accounts and contacts"], SaleOrder: ["عروض الأسعار", "Quotations"], SaleOrderLine: ["سطور عروض الأسعار", "Quotation lines"],
  Timetable: ["مراحل الدفع", "Payment milestones"], Contract: ["العقود", "Contracts"], ContractLine: ["سطور العقود", "Contract lines"],
  Product: ["كتالوج الخدمات", "Service catalogue"], BusinessLine: ["خطوط الأعمال", "Business lines"], Source: ["مصادر العملاء", "Lead sources"],
  Campaign: ["الحملات", "Campaigns"], KnowledgeArticle: ["قاعدة المعرفة", "Knowledge base"], KnowledgeCategory: ["تصنيفات المعرفة", "Knowledge categories"],
  Project: ["المشروعات", "Projects"], ProjectTask: ["المهام", "Tasks"], Team: ["الفرق", "Teams"], HandoverRequest: ["طلبات التسليم", "Handovers"],
  HandoverItem: ["قوائم التسليم", "Handover checklists"], HandoverEvent: ["سجل التسليم", "Handover history"], HandoverRequirement: ["متطلبات التسليم", "Handover requirements"],
  ApprovalRequest: ["المراجعات", "Reviews"], ApprovalEvent: ["سجل المراجعات", "Review history"], InvoiceRequest: ["طلبات الفوترة", "Invoice requests"],
  CertificationCycle: ["دورات الاعتماد", "Certification cycles"], CertificationAudit: ["المراجعات الميدانية", "Audits"], Nonconformity: ["عدم المطابقات", "Nonconformities"],
  AuditorQualification: ["أهلية المراجعين", "Auditor qualifications"], TrainingCourse: ["الدورات", "Courses"], TrainingCohort: ["الدفعات", "Cohorts"],
  TrainingEnrollment: ["التسجيلات", "Enrolments"], TrainingSession: ["الجلسات", "Sessions"], TrainingAttendance: ["الحضور", "Attendance"],
  ClientJobOrder: ["طلبات التوظيف", "Job orders"], Candidate: ["المرشحون", "Candidates"], CandidatePrivate: ["بيانات المرشح الخاصة", "Candidate private data"],
  CandidateConsent: ["موافقات المرشحين", "Candidate consents"], CandidateApplication: ["طلبات المرشحين", "Applications"], CandidateInterview: ["المقابلات", "Interviews"],
  Placement: ["التعيينات", "Placements"], Donor: ["المانحون", "Donors"], FundingOpportunity: ["فرص التمويل", "Funding opportunities"],
  FundingCommitment: ["التعهدات", "Commitments"], FundingInstallment: ["الأقساط", "Installments"], FundingCollection: ["التحصيلات", "Collections"],
  DonorStewardship: ["المتابعة مع المانحين", "Donor stewardship"],
};
function areaOf(object: string, ar: boolean) {
  const short = object.split(".").pop() || object;
  const match = AREAS[short];
  return match ? match[ar ? 0 : 1] : short;
}

/** Turns the stored change summary ("name; language=ar→en") into readable words. */
function readableChanges(text: string | null, ar: boolean): string {
  if (!text) return "";
  const words: Record<string, [string, string]> = {
    created: ["إنشاء", "created"], name: ["الاسم", "name"], "email set": ["إضافة بريد", "e-mail added"], "email changed": ["تغيير البريد", "e-mail changed"],
    "email removed": ["حذف البريد", "e-mail removed"], language: ["اللغة", "language"], profile: ["ملف الصلاحيات", "profile"],
    businessLines: ["خطوط الأعمال", "business lines"], teams: ["الفرق", "teams"], members: ["الأعضاء", "members"],
    "temporary password set": ["كلمة مرور مؤقتة", "temporary password"], "change required at next sign-in": ["تغيير إلزامي عند الدخول", "change required at sign-in"],
    active: ["نشط", "active"], inactive: ["موقوف", "deactivated"], status: ["الحالة", "status"], nameEn: ["الاسم الإنجليزي", "English name"],
    nameAr: ["الاسم العربي", "Arabic name"], sequence: ["الترتيب", "order"], description: ["الغرض", "purpose"], responsibleTeam: ["الفريق المسؤول", "responsible team"],
    manager: ["المدير", "manager"], code: ["الرمز", "code"], deleted: ["حذف", "deleted"], order: ["الترتيب", "order"], prefix: ["البادئة", "prefix"], padding: ["عدد الأرقام", "digits"],
  };
  return text.split("; ").map(part => {
    const [key, value] = part.split("=");
    const word = words[key]?.[ar ? 0 : 1] ?? key;
    return value === undefined ? word : `${word}: ${value.replace(/[[\]]/g, "")}`;
  }).join(" · ");
}

function errorText(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.failed;
  if (error.statusCode === 403) return l.forbidden;
  if (error.statusCode === 409) return l.conflict;
  if (error.code === "SELF_LOCKOUT") return l.selfLock;
  if (error.code === "SELF_PASSWORD") return l.selfPassword;
  if (error.code === "ADMIN_PROFILE_FIXED") return l.adminFixed;
  if (error.code === "RIGHT_MANAGED_ELSEWHERE") return l.managedElsewhere;
  if (error.fields?.[0]?.field === "read") return l.readFirst;
  if (error.fields?.[0]?.code === "TAKEN") return l.duplicate;
  const field = error.fields?.[0];
  if (field) {
    const map: Record<string, string> = { DUPLICATE: l.duplicate, REQUIRED: l.required, FORMAT: l.format, WEAK: l.weak, TOO_SHORT: l.tooShort };
    return map[field.code] || l.failed;
  }
  return l.failed;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("");
}

function parseRoute(hash: string): { tab: Tab; personId: number | null } {
  const m = hash.match(/^#\/admin(?:\/([a-z]+))?(?:\/(\d+))?/);
  const tab = (TABS.includes(m?.[1] as Tab) ? m?.[1] : "people") as Tab;
  return { tab, personId: tab === "people" && m?.[2] ? Number(m[2]) : null };
}

export function AdminConsole({ language, routeHash, myCode }: { language: Language; routeHash: string; myCode: string | null }) {
  const ar = language === "ar";
  const l = L[language];
  const { tab, personId } = parseRoute(routeHash);
  const go = (next: string) => { if (window.location.hash !== next) { window.history.pushState(null, "", next); window.dispatchEvent(new PopStateEvent("popstate")); } };
  // shared reference data for pickers
  const [lines, setLines] = useState<AdminLine[]>([]);
  const [teams, setTeams] = useState<AdminTeam[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [people, setPeople] = useState<AdminUser[]>([]);
  const [loadError, setLoadError] = useState("");
  async function loadShared() {
    try {
      const [ls, ts, ps, us] = await Promise.all([getAdminLines(), getTeams(), getProfiles(), getPeople({ status: "active" })]);
      setLines(ls); setTeams(ts); setProfiles(ps); setPeople(us); setLoadError("");
    } catch (error) { setLoadError(errorText(error, l)); }
  }
  useEffect(() => { void loadShared(); /* once per mount */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <section className="page-enter admin-console" data-area="admin">
    <PageHeader eyebrow={l.area} title={l.title} description={l.hint}/>
    <div className="segmented admin-tabs" role="tablist" aria-label={l.title}>
      {TABS.map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "chosen" : ""} onClick={() => go("#/admin/" + t)}>{l.tabs[t]}</button>)}
    </div>
    {loadError && <div className="login-error" role="alert"><CircleAlert size={17}/>{loadError}</div>}
    {tab === "people" && personId == null && <PeopleTab l={l} ar={ar} lines={lines} teams={teams} profiles={profiles} onOpen={id => go("#/admin/people/" + id)} onChanged={() => void loadShared()}/>}
    {tab === "people" && personId != null && <PersonPage key={personId} id={personId} l={l} ar={ar} lines={lines} teams={teams} profiles={profiles} myCode={myCode}
      onBack={() => go("#/admin/people")} onChanged={() => void loadShared()}/>}
    {tab === "teams" && <TeamsTab l={l} people={people} teams={teams} onChanged={() => void loadShared()}/>}
    {tab === "lines" && <LinesTab l={l} ar={ar} lines={lines} teams={teams} people={people} onChanged={() => void loadShared()}/>}
    {tab === "lists" && <AdminLists language={language}/>}
    {tab === "quality" && <AdminQuality language={language}/>}
    {tab === "numbering" && <AdminNumbering language={language}/>}
    {tab === "profiles" && <ProfilesTab l={l} ar={ar} profiles={profiles} onChanged={() => void loadShared()}/>}
    {tab === "changes" && <ChangesTab l={l} ar={ar}/>}
  </section>;
}

// --- people -------------------------------------------------------------------------------------------

function PeopleTab({ l, ar, lines, teams, profiles, onOpen, onChanged }: {
  l: Labels; ar: boolean; lines: AdminLine[]; teams: AdminTeam[]; profiles: Profile[]; onOpen: (id: number) => void; onChanged: () => void;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | "active" | "inactive">("");
  const [line, setLine] = useState("");
  const [rows, setRows] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  async function load() {
    try { setRows(await getPeople({ q: q.trim(), status, line })); setError(""); }
    catch (e) { setError(errorText(e, l)); setRows([]); }
  }
  useEffect(() => { const timer = window.setTimeout(() => void load(), 200); return () => window.clearTimeout(timer); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, line]);
  const lineName = (code: string) => { const found = lines.find(x => x.code === code); return found ? (ar ? found.nameAr : found.nameEn) : code; };
  return <>
    <div className="admin-toolbar">
      <label className="admin-search"><Search size={16}/><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={l.search} aria-label={l.search}/></label>
      <div className="segmented" role="group" aria-label={l.status}>
        {([["", l.all], ["active", l.active], ["inactive", l.inactive]] as const).map(([value, label]) =>
          <button key={value} type="button" className={status === value ? "chosen" : ""} aria-pressed={status === value} onClick={() => setStatus(value)}>{label}</button>)}
      </div>
      <select aria-label={l.lines} value={line} onChange={e => setLine(e.target.value)}><option value="">{l.allLines}</option>
        {lines.map(x => <option key={x.code} value={x.code}>{ar ? x.nameAr : x.nameEn}</option>)}</select>
      <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><UserPlus size={16}/>{l.addPerson}</button>
    </div>
    {error && <div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {rows === null ? <div className="admin-skeleton" aria-busy="true"><span/><span/><span/></div>
      : rows.length === 0 ? <div className="empty-state"><UsersRound size={28}/>{l.noPeople}</div>
      : <div className="table-scroll data-panel"><table className="admin-table"><thead><tr><th>{l.person}</th><th>{l.profile}</th><th>{l.lines}</th><th>{l.teams}</th><th>{l.status}</th><th><span className="sr-only">{l.open}</span></th></tr></thead>
        <tbody>{rows.map(u => <tr key={u.id} className={u.active ? "" : "is-muted"} onClick={() => onOpen(u.id)}>
          <td><div className="admin-person"><span className="admin-avatar" aria-hidden="true">{initials(u.name)}</span><span><strong>{u.name}</strong><small dir="ltr">{u.code}</small></span></div></td>
          <td>{u.profileName ? <span className={"admin-badge" + (u.administrator ? " is-admin" : "")}>{u.administrator && <ShieldCheck size={13}/>}{u.profileName}</span> : <span className="admin-muted">{l.noProfile}</span>}</td>
          <td><div className="admin-chips">{u.businessLines.map(code => <span key={code} className="chip chip-quiet">{lineName(code)}</span>)}</div></td>
          <td>{u.teams.map(t => t.name).join("، ") || <span className="admin-muted">—</span>}</td>
          <td><span className={"status-pill " + (u.active ? "status-2" : "status-3")}><span className="status-dot"/>{u.active ? l.active : l.inactive}</span>
            {u.mustChangePassword && <span className="admin-flag"><KeyRound size={12}/>{l.mustChange}</span>}</td>
          <td><button type="button" className="btn btn-secondary btn-small" onClick={e => { e.stopPropagation(); onOpen(u.id); }}>{l.open}{ar ? <ArrowLeft size={14}/> : <ArrowRight size={14}/>}</button></td>
        </tr>)}</tbody></table></div>}
    {adding && <AddPersonDialog l={l} ar={ar} lines={lines} teams={teams} profiles={profiles} onClose={() => setAdding(false)} onSaved={() => { void load(); onChanged(); }}/>}
  </>;
}

function AddPersonDialog({ l, ar, lines, teams, profiles, onClose, onSaved }: {
  l: Labels; ar: boolean; lines: AdminLine[]; teams: AdminTeam[]; profiles: Profile[]; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [language, setLanguage] = useState<"ar" | "en">("ar");
  const [profileCode, setProfileCode] = useState("");
  const [chosenLines, setChosenLines] = useState<AdminLine[]>([]);
  const [chosenTeams, setChosenTeams] = useState<AdminTeam[]>([]);
  const [password, setPassword] = useState(() => makeTemporaryPassword());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<AdminUser | null>(null);
  const [copied, setCopied] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const chosenProfile = profiles.find(p => p.code === profileCode);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const saved = await addPerson({ code: code.trim(), name: name.trim(), email: email.trim() || undefined, language, temporaryPassword: password,
        profileCode: profileCode || undefined, businessLines: chosenLines.map(x => x.code), teamIds: chosenTeams.map(x => x.id) });
      setDone(saved); onSaved();
    } catch (failure) { setError(errorText(failure, l)); }
    finally { setBusy(false); }
  }
  async function copy() { setCopied(await copyText(password, passwordRef.current)); }
  if (done) return <Dialog title={l.created} description={l.createdHint} kicker={l.tabs.people} onClose={onClose}
    footer={<button type="button" className="btn btn-primary" onClick={onClose}>{l.close}</button>}>
    <dl className="admin-credentials"><div><dt>{l.login}</dt><dd dir="ltr">{done.code}</dd></div>
      <div><dt>{l.temp}</dt><dd><input ref={passwordRef} readOnly value={password} dir="ltr" aria-label={l.temp}/>
        <button type="button" className="btn btn-secondary btn-small" onClick={() => void copy()}><Copy size={14}/>{copied ? l.copied : l.copy}</button></dd></div></dl>
    <p className="admin-note"><LockKeyhole size={14}/>{l.tempHint}</p>
  </Dialog>;
  return <Dialog title={l.addPerson} kicker={l.tabs.people} busy={busy} onClose={onClose} wide
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="admin-add-person" className="btn btn-primary" disabled={busy}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="admin-add-person" className="admin-form" onSubmit={e => void submit(e)}>
      <label><span>{l.name}</span><input value={name} onChange={e => setName(e.target.value)} required maxLength={255}/></label>
      <label><span>{l.login}</span><input value={code} onChange={e => setCode(e.target.value.toLowerCase())} required minLength={3} maxLength={60} dir="ltr" pattern="[a-z0-9][a-z0-9._\-]{2,59}" autoComplete="off" placeholder="sara.mansour"/></label>
      <label><span>{l.email}</span><input type="email" value={email} onChange={e => setEmail(e.target.value)} dir="ltr" autoComplete="off"/><small>{l.emailHint}</small></label>
      <div className="admin-field"><span>{l.language}</span><div className="segmented">
        <button type="button" className={language === "ar" ? "chosen" : ""} aria-pressed={language === "ar"} onClick={() => setLanguage("ar")}>العربية</button>
        <button type="button" className={language === "en" ? "chosen" : ""} aria-pressed={language === "en"} onClick={() => setLanguage("en")}>English</button></div></div>
      <label><span>{l.profile}</span><select value={profileCode} onChange={e => setProfileCode(e.target.value)}><option value="">{l.noProfile}</option>
        {profiles.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}</select></label>
      {chosenProfile?.administrator && <p className="admin-warning" role="status"><ShieldCheck size={15}/>{l.adminWarning}</p>}
      <ChipPicker label={l.lines} items={lines} selected={chosenLines} keyOf={x => x.code} labelOf={x => ar ? x.nameAr : x.nameEn} onChange={setChosenLines} placeholder={l.choose} emptyText={l.none}/>
      <ChipPicker label={l.teams} items={teams} selected={chosenTeams} keyOf={x => x.id} labelOf={x => x.name} onChange={setChosenTeams} placeholder={l.choose} emptyText={l.none}/>
      <div className="admin-field"><span>{l.temp}</span><div className="admin-password">
        <input ref={passwordRef} value={password} onChange={e => setPassword(e.target.value)} dir="ltr" minLength={12} required aria-label={l.temp}/>
        <button type="button" className="btn btn-secondary btn-small" onClick={() => setPassword(makeTemporaryPassword())}><RefreshCw size={14}/>{l.regenerate}</button>
        <button type="button" className="btn btn-secondary btn-small" onClick={() => void copy()}><Copy size={14}/>{copied ? l.copied : l.copy}</button></div>
        <small>{l.tempHint}</small></div>
      {error && <div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    </form>
  </Dialog>;
}

function PersonPage({ id, l, ar, lines, teams, profiles, myCode, onBack, onChanged }: {
  id: number; l: Labels; ar: boolean; lines: AdminLine[]; teams: AdminTeam[]; profiles: Profile[]; myCode: string | null; onBack: () => void; onChanged: () => void;
}) {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [history, setHistory] = useState<AdminChange[] | null>(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<null | "edit" | "status" | "password">(null);
  async function load() {
    try {
      const [d, h] = await Promise.all([getPerson(id), getChanges({ subject: "USER", subjectId: id, limit: 30 })]);
      setDetail(d); setHistory(h); setError("");
    } catch (e) { setError(errorText(e, l)); }
  }
  useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!detail) return <div className="admin-person-page">{error ? <div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div> : <div className="admin-skeleton" aria-busy="true"><span/><span/></div>}</div>;
  const u = detail.user;
  const me = myCode === u.code;
  const lineName = (code: string) => { const found = lines.find(x => x.code === code); return found ? (ar ? found.nameAr : found.nameEn) : code; };
  const refresh = () => { void load(); onChanged(); };
  return <div className="admin-person-page">
    <button type="button" className="record-back" onClick={onBack}>{ar ? <ArrowRight size={17}/> : <ArrowLeft size={17}/>} {l.back}</button>
    <div className="admin-hero data-panel">
      <span className="admin-avatar admin-avatar-large" aria-hidden="true">{initials(u.name)}</span>
      <div className="admin-hero-text"><h2>{u.name}</h2><span dir="ltr" className="admin-muted">{u.code}</span>
        <div className="admin-hero-tags"><span className={"status-pill " + (u.active ? "status-2" : "status-3")}><span className="status-dot"/>{u.active ? l.active : l.inactive}</span>
          {u.administrator && <span className="admin-badge is-admin"><ShieldCheck size={13}/>{l.admin}</span>}
          {u.mustChangePassword && <span className="admin-flag"><KeyRound size={12}/>{l.mustChange}</span>}</div></div>
      <div className="admin-hero-actions">
        <button type="button" className="btn btn-primary" onClick={() => setDialog("edit")}>{l.edit}</button>
        {!me && <button type="button" className="btn btn-secondary" onClick={() => setDialog("password")}><KeyRound size={15}/>{l.reset}</button>}
        {!me && <button type="button" className={"btn " + (u.active ? "btn-danger-quiet" : "btn-secondary")} onClick={() => setDialog("status")}>
          {u.active ? <UserX size={15}/> : <UserCheck size={15}/>}{u.active ? l.deactivate : l.activate}</button>}
      </div>
    </div>
    <div className="admin-grid">
      <div className="data-panel admin-section"><h3>{l.lines}</h3>
        <div className="admin-chips">{u.businessLines.length ? u.businessLines.map(code => <span key={code} className="chip chip-quiet"><Layers3 size={12}/>{lineName(code)}</span>) : <span className="admin-muted">{l.none}</span>}</div>
        <h3>{l.teams}</h3>
        <div className="admin-chips">{u.teams.length ? u.teams.map(t => <span key={t.id} className="chip chip-quiet"><UsersRound size={12}/>{t.name}</span>) : <span className="admin-muted">{l.none}</span>}</div>
        <h3>{l.language}</h3><p>{u.language === "en" ? "English" : "العربية"}</p>
      </div>
      <div className="data-panel admin-section"><h3>{l.access} · {u.profileName || l.noProfile}</h3><p className="admin-muted">{l.accessHint}</p>
        <RightsTable access={detail.access} l={l} ar={ar}/></div>
    </div>
    <div className="data-panel admin-section"><h3><History size={16}/>{l.history}</h3><Timeline rows={history} l={l} ar={ar}/></div>
    {dialog === "edit" && <EditPersonDialog u={u} l={l} ar={ar} lines={lines} teams={teams} profiles={profiles} me={me} onClose={() => setDialog(null)} onSaved={refresh}/>}
    {dialog === "status" && <StatusDialog u={u} l={l} onClose={() => setDialog(null)} onSaved={refresh}/>}
    {dialog === "password" && <PasswordDialog u={u} l={l} onClose={() => setDialog(null)} onSaved={refresh}/>}
  </div>;
}

function EditPersonDialog({ u, l, ar, lines, teams, profiles, me, onClose, onSaved }: {
  u: AdminUser; l: Labels; ar: boolean; lines: AdminLine[]; teams: AdminTeam[]; profiles: Profile[]; me: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(u.name);
  const [email, setEmail] = useState("");
  const [language, setLanguage] = useState(u.language === "en" ? "en" : "ar");
  const [profileCode, setProfileCode] = useState(u.profileCode || "");
  const [chosenLines, setChosenLines] = useState(lines.filter(x => u.businessLines.includes(x.code)));
  const [chosenTeams, setChosenTeams] = useState(teams.filter(t => u.teams.some(x => x.id === t.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosenProfile = profiles.find(p => p.code === profileCode);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      await changePerson(u.id, { version: u.version, name: name.trim(), language, ...(email.trim() ? { email: email.trim() } : {}),
        ...(profileCode !== (u.profileCode || "") ? { profileCode } : {}), businessLines: chosenLines.map(x => x.code), teamIds: chosenTeams.map(x => x.id) });
      onSaved(); onClose();
    } catch (failure) { setError(errorText(failure, l)); }
    finally { setBusy(false); }
  }
  return <Dialog title={l.edit} kicker={u.name} busy={busy} onClose={onClose} wide
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="admin-edit-person" className="btn btn-primary" disabled={busy}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="admin-edit-person" className="admin-form" onSubmit={e => void submit(e)}>
      <label><span>{l.name}</span><input value={name} onChange={e => setName(e.target.value)} required maxLength={255}/></label>
      <label><span>{l.email}</span><input type="email" value={email} onChange={e => setEmail(e.target.value)} dir="ltr" placeholder={u.contactOnFile ? "••••••" : ""} autoComplete="off"/><small>{l.emailHint}</small></label>
      <div className="admin-field"><span>{l.language}</span><div className="segmented">
        <button type="button" className={language === "ar" ? "chosen" : ""} aria-pressed={language === "ar"} onClick={() => setLanguage("ar")}>العربية</button>
        <button type="button" className={language === "en" ? "chosen" : ""} aria-pressed={language === "en"} onClick={() => setLanguage("en")}>English</button></div></div>
      <label><span>{l.profile}</span><select value={profileCode} onChange={e => setProfileCode(e.target.value)} disabled={me && u.administrator}>
        <option value="">{l.noProfile}</option>{profiles.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}</select></label>
      {chosenProfile?.administrator && !u.administrator && <p className="admin-warning" role="status"><ShieldCheck size={15}/>{l.adminWarning}</p>}
      <ChipPicker label={l.lines} items={lines} selected={chosenLines} keyOf={x => x.code} labelOf={x => ar ? x.nameAr : x.nameEn} onChange={setChosenLines} placeholder={l.choose} emptyText={l.none}/>
      <ChipPicker label={l.teams} items={teams} selected={chosenTeams} keyOf={x => x.id} labelOf={x => x.name} onChange={setChosenTeams} placeholder={l.choose} emptyText={l.none}/>
      {error && <div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    </form>
  </Dialog>;
}

function StatusDialog({ u, l, onClose, onSaved }: { u: AdminUser; l: Labels; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function confirm() {
    setBusy(true); setError("");
    try { await (u.active ? deactivatePerson(u.id, u.version) : activatePerson(u.id, u.version)); onSaved(); onClose(); }
    catch (failure) { setError(errorText(failure, l)); }
    finally { setBusy(false); }
  }
  return <Dialog title={u.active ? l.deactivate : l.activate} description={u.active ? l.deactivateHint : l.activateHint} kicker={u.name} busy={busy} onClose={onClose}
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="button" className={"btn " + (u.active ? "btn-danger" : "btn-primary")} disabled={busy} onClick={() => void confirm()}>{busy ? l.saving : u.active ? l.deactivate : l.activate}</button></>}>
    {error && <div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
  </Dialog>;
}

function PasswordDialog({ u, l, onClose, onSaved }: { u: AdminUser; l: Labels; onClose: () => void; onSaved: () => void }) {
  const [password, setPassword] = useState(() => makeTemporaryPassword());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  async function confirm() {
    setBusy(true); setError("");
    try { await setTemporaryPassword(u.id, u.version, password); setDone(true); onSaved(); }
    catch (failure) { setError(errorText(failure, l)); }
    finally { setBusy(false); }
  }
  return <Dialog title={done ? l.created : l.reset} description={done ? l.createdHint : l.resetHint} kicker={u.name} busy={busy} onClose={onClose}
    footer={done ? <button type="button" className="btn btn-primary" onClick={onClose}>{l.close}</button>
      : <><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void confirm()}><KeyRound size={15}/>{busy ? l.saving : l.save}</button></>}>
    <div className="admin-password">
      <input ref={ref} value={password} onChange={e => setPassword(e.target.value)} readOnly={done} dir="ltr" aria-label={l.temp}/>
      {!done && <button type="button" className="btn btn-secondary btn-small" onClick={() => setPassword(makeTemporaryPassword())}><RefreshCw size={14}/>{l.regenerate}</button>}
      <button type="button" className="btn btn-secondary btn-small" onClick={async () => setCopied(await copyText(password, ref.current))}><Copy size={14}/>{copied ? l.copied : l.copy}</button>
    </div>
    <p className="admin-note"><LockKeyhole size={14}/>{l.tempHint}</p>
    {error && <div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
  </Dialog>;
}

function RightsTable({ access, l, ar }: { access: ProfileAccess; l: Labels; ar: boolean }) {
  if (access.administrator) return <p className="admin-warning"><ShieldCheck size={15}/>{l.fullAccess}</p>;
  if (!access.rights.length) return <p className="admin-muted">{l.noRules}</p>;
  const mark = (on: boolean) => <span className={"admin-mark" + (on ? " is-on" : "")} aria-label={on ? "✓" : "—"}>{on ? "✓" : "—"}</span>;
  return <div className="table-scroll"><table className="admin-table admin-rights"><thead><tr><th>{l.access}</th><th>{l.read}</th><th>{l.write}</th><th>{l.create}</th><th>{l.remove}</th><th>{l.conditional}</th></tr></thead>
    <tbody>{access.rights.map((r, i) => <tr key={r.object + i}><td>{areaOf(r.object, ar)}</td><td>{mark(r.read)}</td><td>{mark(r.write)}</td><td>{mark(r.create)}</td><td>{mark(r.remove)}</td><td>{r.conditional ? l.conditional : ""}</td></tr>)}</tbody></table></div>;
}

function Timeline({ rows, l, ar }: { rows: AdminChange[] | null; l: Labels; ar: boolean }) {
  if (rows === null) return <div className="admin-skeleton" aria-busy="true"><span/></div>;
  if (!rows.length) return <p className="admin-muted">{l.noHistory}</p>;
  const when = new Intl.DateTimeFormat(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return <ol className="admin-timeline">{rows.map(e => <li key={e.id}>
    <span className="admin-timeline-dot" aria-hidden="true"/>
    <div><strong>{l.actions[e.action] || e.action}</strong>{e.subjectLabel && <span className="admin-muted"> · <bdi>{e.subjectLabel}</bdi></span>}
      <p>{readableChanges(e.changes, ar)}</p>
      <small>{e.actorName ? `${l.by} ${e.actorName} · ` : ""}{when.format(new Date(e.createdAt))}</small></div>
  </li>)}</ol>;
}

// --- teams --------------------------------------------------------------------------------------------

function TeamsTab({ l, people, teams, onChanged }: { l: Labels; people: AdminUser[]; teams: AdminTeam[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<AdminTeam | "new" | null>(null);
  return <>
    <div className="admin-toolbar"><span className="admin-muted">{teams.length} {l.tabs.teams}</span>
      <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}><Plus size={16}/>{l.addTeam}</button></div>
    {teams.length === 0 ? <div className="empty-state"><UsersRound size={28}/>{l.noTeams}</div>
      : <div className="admin-cards">{teams.map(t => <button key={t.id} type="button" className="data-panel admin-card" onClick={() => setEditing(t)}>
        <strong>{t.name}</strong><span className="admin-muted">{t.members.length} {l.members}</span>
        <div className="admin-faces">{t.members.slice(0, 6).map(m => <span key={m.id} className="admin-avatar" title={m.name}>{initials(m.name)}</span>)}
          {t.members.length > 6 && <span className="admin-avatar admin-more">+{t.members.length - 6}</span>}</div>
      </button>)}</div>}
    {editing && <TeamDialog team={editing === "new" ? null : editing} l={l} people={people} onClose={() => setEditing(null)} onSaved={onChanged}/>}
  </>;
}

function TeamDialog({ team, l, people, onClose, onSaved }: { team: AdminTeam | null; l: Labels; people: AdminUser[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(team?.name || "");
  const pool = useMemo(() => {
    const extra = (team?.members || []).filter(m => !people.some(p => p.id === m.id)).map(m => ({ id: m.id, name: m.name }));
    return [...people.map(p => ({ id: p.id, name: p.name })), ...extra];
  }, [people, team]);
  const [members, setMembers] = useState(pool.filter(p => team?.members.some(m => m.id === p.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      if (team) await changeTeam(team.id, team.version, name.trim(), members.map(m => m.id));
      else await addTeam(name.trim(), members.map(m => m.id));
      onSaved(); onClose();
    } catch (failure) { setError(errorText(failure, l)); }
    finally { setBusy(false); }
  }
  return <Dialog title={team ? l.editTeam : l.addTeam} kicker={l.tabs.teams} busy={busy} onClose={onClose}
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="admin-team" className="btn btn-primary" disabled={busy}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="admin-team" className="admin-form" onSubmit={e => void submit(e)}>
      <label><span>{l.teamName}</span><input value={name} onChange={e => setName(e.target.value)} required maxLength={255}/></label>
      <ChipPicker label={l.members} items={pool} selected={members} keyOf={x => x.id} labelOf={x => x.name} onChange={setMembers} placeholder={l.addMember} emptyText={l.noMembers}/>
      {error && <div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    </form>
  </Dialog>;
}

// --- business lines -----------------------------------------------------------------------------------

function LinesTab({ l, ar, lines, teams, people, onChanged }: {
  l: Labels; ar: boolean; lines: AdminLine[]; teams: AdminTeam[]; people: AdminUser[]; onChanged: () => void;
}) {
  const [editing, setEditing] = useState<AdminLine | "new" | null>(null);
  const [membersOf, setMembersOf] = useState<AdminLine | null>(null);
  return <>
    <div className="admin-toolbar"><span className="admin-muted">{lines.length} {l.tabs.lines}</span>
      <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}><Plus size={16}/>{l.addLine}</button></div>
    <div className="table-scroll data-panel"><table className="admin-table admin-static"><thead><tr><th>{l.lines}</th><th>{l.lineCode}</th><th>{l.status}</th><th>{l.responsibleTeam}</th><th>{l.manager}</th><th>{l.members}</th><th><span className="sr-only">{l.open}</span></th></tr></thead>
      <tbody>{lines.map(x => <tr key={x.code}>
        <td><strong>{ar ? x.nameAr : x.nameEn}</strong><small className="admin-muted admin-block">{ar ? x.nameEn : x.nameAr}</small></td>
        <td dir="ltr">{x.code}</td>
        <td><span className={"status-pill status-" + x.status}><span className="status-dot"/>{l.lineStatus[x.status]}</span></td>
        <td>{x.responsibleTeam?.name || <span className="admin-muted">—</span>}</td>
        <td>{x.manager?.name || <span className="admin-muted">—</span>}</td>
        <td><button type="button" className="btn btn-secondary btn-small" onClick={() => setMembersOf(x)}><UsersRound size={14}/>{x.members}</button></td>
        <td><button type="button" className="btn btn-secondary btn-small" onClick={() => setEditing(x)}>{l.edit}</button></td>
      </tr>)}</tbody></table></div>
    {editing && <LineDialog line={editing === "new" ? null : editing} l={l} teams={teams} people={people} onClose={() => setEditing(null)} onSaved={onChanged}/>}
    {membersOf && <LineMembersDialog line={membersOf} l={l} ar={ar} people={people} onClose={() => setMembersOf(null)} onSaved={onChanged}/>}
  </>;
}

function LineDialog({ line, l, teams, people, onClose, onSaved }: {
  line: AdminLine | null; l: Labels; teams: AdminTeam[]; people: AdminUser[]; onClose: () => void; onSaved: () => void;
}) {
  const [code, setCode] = useState(line?.code || "");
  const [nameAr, setNameAr] = useState(line?.nameAr || "");
  const [nameEn, setNameEn] = useState(line?.nameEn || "");
  const [status, setStatus] = useState<number>(line?.status || 1);
  const [sequence, setSequence] = useState(line?.sequence == null ? "" : String(line.sequence));
  const [purpose, setPurpose] = useState(line?.purpose || "");
  const [teamId, setTeamId] = useState(line?.responsibleTeam?.id ? String(line.responsibleTeam.id) : "");
  const [managerId, setManagerId] = useState(line?.manager?.id ? String(line.manager.id) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    const input = { nameAr: nameAr.trim(), nameEn: nameEn.trim(), status, sequence: sequence === "" ? null : Number(sequence), purpose: purpose.trim(),
      responsibleTeamId: teamId ? Number(teamId) : 0, managerId: managerId ? Number(managerId) : 0 };
    try {
      if (line) await changeLine(line.code, { ...input, version: line.version });
      else await addLine({ ...input, code: code.trim().toUpperCase(), status: undefined });
      onSaved(); onClose();
    } catch (failure) { setError(errorText(failure, l)); }
    finally { setBusy(false); }
  }
  return <Dialog title={line ? l.editLine : l.addLine} kicker={l.tabs.lines} busy={busy} onClose={onClose} wide
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="admin-line" className="btn btn-primary" disabled={busy}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="admin-line" className="admin-form admin-form-two" onSubmit={e => void submit(e)}>
      <label><span>{l.lineCode}</span><input value={code} onChange={e => setCode(e.target.value.toUpperCase())} required readOnly={!!line} dir="ltr" pattern="[A-Z0-9_]{2,20}" maxLength={20} placeholder="ISO45001"/></label>
      <label><span>{l.order}</span><input type="number" value={sequence} onChange={e => setSequence(e.target.value)} min={0} max={9999}/></label>
      <label><span>{l.nameAr}</span><input value={nameAr} onChange={e => setNameAr(e.target.value)} required maxLength={255}/></label>
      <label><span>{l.nameEn}</span><input value={nameEn} onChange={e => setNameEn(e.target.value)} required maxLength={255} dir="ltr"/></label>
      {line && <label><span>{l.status}</span><select value={status} onChange={e => setStatus(Number(e.target.value))}>
        {[1, 2, 3].map(s => <option key={s} value={s}>{l.lineStatus[s]}</option>)}</select></label>}
      <label><span>{l.responsibleTeam}</span><select value={teamId} onChange={e => setTeamId(e.target.value)}><option value="">{l.none}</option>
        {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label><span>{l.manager}</span><select value={managerId} onChange={e => setManagerId(e.target.value)}><option value="">{l.none}</option>
        {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="admin-span"><span>{l.purpose}</span><textarea value={purpose} onChange={e => setPurpose(e.target.value)} maxLength={4000} rows={3}/></label>
      {error && <div className="login-error admin-span" role="alert"><CircleAlert size={17}/>{error}</div>}
    </form>
  </Dialog>;
}

function LineMembersDialog({ line, l, ar, people, onClose, onSaved }: {
  line: AdminLine; l: Labels; ar: boolean; people: AdminUser[]; onClose: () => void; onSaved: () => void;
}) {
  const [members, setMembers] = useState<PersonRef[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { getLineMembers(line.code).then(setMembers).catch(e => setError(errorText(e, l))); }, [line.code, l]);
  const pool: PersonRef[] = useMemo(() => {
    const active = people.map(p => ({ id: p.id, code: p.code, name: p.name, active: p.active }));
    return [...active, ...(members || []).filter(m => !active.some(a => a.id === m.id))];
  }, [people, members]);
  async function save() {
    if (!members) return;
    setBusy(true); setError("");
    try { await setLineMembers(line.code, members.map(m => m.id)); onSaved(); onClose(); }
    catch (failure) { setError(errorText(failure, l)); }
    finally { setBusy(false); }
  }
  return <Dialog title={`${l.lineMembers} · ${ar ? line.nameAr : line.nameEn}`} description={l.membersHint} kicker={l.tabs.lines} busy={busy} onClose={onClose}
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="button" className="btn btn-primary" disabled={busy || !members} onClick={() => void save()}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    {members === null ? <div className="admin-skeleton" aria-busy="true"><span/></div>
      : <ChipPicker label={l.members} items={pool} selected={members} keyOf={x => x.id} labelOf={x => x.name} onChange={setMembers} placeholder={l.addMember} emptyText={l.noMembers}/>}
    {error && <div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
  </Dialog>;
}

// --- profiles and change log --------------------------------------------------------------------------

function ProfilesTab({ l, ar, profiles, onChanged }: { l: Labels; ar: boolean; profiles: Profile[]; onChanged: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [access, setAccess] = useState<ProfileAccess | null>(null);
  const [catalog, setCatalog] = useState<RoleCatalog | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { getRoleCatalog().then(setCatalog).catch(e => setError(errorText(e, l))); }, [l]);
  useEffect(() => {
    if (!code) { setAccess(null); return; }
    setAccess(null);
    getProfile(code).then(setAccess).catch(e => setError(errorText(e, l)));
  }, [code, l]);
  return <>
    <div className="admin-toolbar"><p className="admin-muted admin-d07"><LockKeyhole size={15}/>{l.d07}</p>
      <button type="button" className="btn btn-primary" disabled={!catalog} onClick={() => setAdding(true)}><Plus size={16}/>{l.newProfile}</button></div>
    <div className="admin-split">
      <ul className="admin-list data-panel" role="listbox" aria-label={l.tabs.profiles}>
        {profiles.map(p => <li key={p.code}><button type="button" role="option" aria-selected={code === p.code} className={code === p.code ? "is-chosen" : ""} onClick={() => { setCode(p.code); setNotice(""); setError(""); }}>
          <span><strong>{p.name}</strong><small dir="ltr" className="admin-muted">{p.code}</small></span>
          <span className="admin-muted">{p.people} {l.people} · {p.administrator ? l.admin : `${p.rules} ${l.rules}`}</span></button></li>)}
      </ul>
      <div className="data-panel admin-section">
        {error && <div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
        {notice && <p className="admin-saved" role="status">{notice}</p>}
        {!code ? <p className="admin-muted">{l.accessHint}</p> : !access ? <div className="admin-skeleton" aria-busy="true"><span/><span/></div>
          : <><h3>{access.name}</h3>
            {!!access.roles?.length && <p className="admin-muted">{l.role}: {access.roles.map(r => <code key={r} dir="ltr" className="admin-role">{r}</code>)}</p>}
            {access.administrator || !catalog ? <RightsTable access={access} l={l} ar={ar}/>
              : <RightsEditor access={access} catalog={catalog} l={l} ar={ar} onSaved={next => { setAccess(next); setError(""); setNotice(l.savedRight); onChanged(); }}
                  onError={e => { setNotice(""); setError(errorText(e, l)); if (code) void getProfile(code).then(setAccess); }}/>}</>}
      </div>
    </div>
    {adding && catalog && <NewProfileDialog l={l} ar={ar} catalog={catalog} onClose={() => setAdding(false)}
      onSaved={created => { setAdding(false); onChanged(); setCode(created.code); setNotice(l.profileCreated); }}/>}
  </>;
}

function NewProfileDialog({ l, ar, catalog, onClose, onSaved }: { l: Labels; ar: boolean; catalog: RoleCatalog; onClose: () => void; onSaved: (p: ProfileAccess) => void }) {
  const [template, setTemplate] = useState(catalog.templates[0]?.code ?? "");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { onSaved(await createProfile(code, name, template)); }
    catch (reason) { setError(errorText(reason, l)); }
    finally { setBusy(false); }
  }
  return <Dialog title={l.newProfile} kicker={l.tabs.profiles} description={l.d07} busy={busy} onClose={onClose}
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="admin-new-profile" className="btn btn-primary" disabled={busy}><Save size={16}/>{busy ? l.saving : l.createProfile}</button></>}>
    <form id="admin-new-profile" className="admin-form" onSubmit={e => void submit(e)}>
      <label><span>{l.template}</span><select value={template} onChange={e => setTemplate(e.target.value)} required>
        {catalog.templates.map(t => <option key={t.code} value={t.code}>{ar ? t.nameAr : t.nameEn} · {t.role}</option>)}</select></label>
      <label><span>{l.profileName}</span><input value={name} onChange={e => setName(e.target.value)} required maxLength={100}/></label>
      <label><span>{l.profileCode}</span><input value={code} onChange={e => setCode(e.target.value.toLowerCase())} required minLength={3} maxLength={40}
        pattern="[a-z][a-z0-9\-]{2,39}" dir="ltr" autoComplete="off" placeholder="sales-cairo"/></label>
      {error && <div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    </form>
  </Dialog>;
}

/** The rights matrix: every record type of the catalogue, grouped by area; a change saves at once with the profile's version. */
function RightsEditor({ access, catalog, l, ar, onSaved, onError }: {
  access: ProfileAccess; catalog: RoleCatalog; l: Labels; ar: boolean; onSaved: (next: ProfileAccess) => void; onError: (e: unknown) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const byKey = new Map(access.rights.filter(r => r.key).map(r => [r.key as string, r]));
  async function change(type: RecordTypeInfo, next: RightChange) {
    if (access.version == null || !access.code) return;
    setBusy(type.key);
    try { onSaved(await setProfileRight(access.code, access.version, next)); }
    catch (e) { onError(e); }
    finally { setBusy(null); }
  }
  const areas = [...new Set(catalog.recordTypes.map(t => t.area))];
  return <div className="table-scroll"><table className="admin-table admin-rights-editor" aria-label={l.rightOf(access.name ?? "")}>
    <thead><tr><th>{l.access}</th><th>{l.read}</th><th>{l.write}</th><th>{l.create}</th><th>{l.remove}</th><th>{l.scope}</th></tr></thead>
    {areas.map(area => <tbody key={area}>
      <tr className="admin-rights-area"><th colSpan={6}>{l.areas[area] ?? area}</th></tr>
      {catalog.recordTypes.filter(t => t.area === area).map(type => {
        const right = byKey.get(type.key);
        const foreign = access.rights.find(r => r.key === type.key && !r.managed);
        const current: RightChange = { object: type.key, read: !!right?.read, write: !!right?.write, create: !!right?.create, remove: !!right?.remove,
          scope: (right?.scope as Scope) ?? (type.scopes.includes("OWN") ? "OWN" : "ALL") };
        const label = ar ? type.nameAr : type.nameEn;
        const box = (field: "read" | "write" | "create" | "remove", name: string) => <td><input type="checkbox" aria-label={`${name} · ${label}`}
          checked={current[field]} disabled={!!foreign || busy !== null}
          onChange={e => {
            const next = { ...current, [field]: e.target.checked };
            // reading is the base of every other action
            if (field === "read" && !e.target.checked) { next.write = next.create = next.remove = false; }
            if (field !== "read" && e.target.checked) next.read = true;
            void change(type, next);
          }}/></td>;
        return <tr key={type.key} aria-busy={busy === type.key || undefined}>
          <td><span className="admin-rights-name">{label}</span>{type.restricted && <span className="admin-badge is-restricted"><LockKeyhole size={12}/>{l.restricted}</span>}
            {foreign && <span className="admin-badge">{l.managedElsewhere}</span>}</td>
          {box("read", l.read)}{box("write", l.write)}{box("create", l.create)}{box("remove", l.remove)}
          <td>{type.scopes.length > 1
            ? <select aria-label={`${l.scope} · ${label}`} value={current.scope} disabled={!!foreign || busy !== null || !current.read}
                onChange={e => void change(type, { ...current, scope: e.target.value as Scope })}>
                {type.scopes.map(sc => <option key={sc} value={sc}>{l.scopes[sc] ?? sc}</option>)}</select>
            : <span className="admin-muted">{l.scopes.ALL}</span>}</td>
        </tr>;
      })}
    </tbody>)}
  </table></div>;
}

function ChangesTab({ l, ar }: { l: Labels; ar: boolean }) {
  const [subject, setSubject] = useState("");
  const [rows, setRows] = useState<AdminChange[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  async function load(offset = 0) {
    try {
      const page = await getChanges({ subject: subject || undefined, limit: 50, offset });
      setRows(prev => offset ? [...(prev || []), ...page] : page); setMore(page.length === 50); setError("");
    } catch (e) { setError(errorText(e, l)); setRows([]); }
  }
  useEffect(() => { setRows(null); void load(0); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject]);
  return <>
    <div className="admin-toolbar"><div className="segmented" role="group" aria-label={l.tabs.changes}>
      {([["", l.filterAll], ["USER", l.filterPeople], ["TEAM", l.filterTeams], ["BUSINESS_LINE", l.filterLines]] as const).map(([value, label]) =>
        <button key={value} type="button" className={subject === value ? "chosen" : ""} aria-pressed={subject === value} onClick={() => setSubject(value)}>{label}</button>)}
    </div></div>
    {error && <div className="login-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    <div className="data-panel admin-section"><Timeline rows={rows} l={l} ar={ar}/>
      {more && <button type="button" className="btn btn-secondary" onClick={() => void load(rows?.length || 0)}>{l.more}</button>}</div>
  </>;
}
