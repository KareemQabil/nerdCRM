import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleDashed, CircleSlash, Construction, LockKeyhole, Search, ShieldCheck } from "lucide-react";
import { ApiError, wrapped } from "./api";
import type { Language } from "./preferences";
import "./systemmap.css";

/**
 * The live system map (real mode): every business domain with what actually works in this build, what is
 * held by an open company decision (D-xx), and what is not built yet, plus a live check of whether the
 * signed-in person can reach it. Statuses come from the shipped API, not from the screens; keep them in
 * step with docs/IMPLEMENTATION_LOG.md.
 */
type Status = "live" | "partial" | "missing";
type Domain = {
  id: string; ar: string; en: string; status: Status; upstream: string; href: string | null; probe: string | null;
  works: [string, string][]; held: [string, string, string][]; next: [string, string][];
};

const DOMAINS: Domain[] = [
  { id: "leads", ar: "العملاء المحتملون", en: "Leads", status: "live", upstream: "axelor-crm", href: "#/leads", probe: "/ws/ioeti/leads?limit=1",
    works: [["التسجيل مع كشف التكرار، التعديل، التأهيل والمراحل، الخسارة وإعادة الفتح، التحويل لحساب وفرصة", "Intake with duplicate checks, edit, qualification and stages, lose/reopen, conversion to account and opportunity"],
      ["الموافقات والمصدر والحملات، المتابعات والأنشطة، البحث والعروض المحفوظة", "Consent, source and campaign attribution, follow-ups and activities, search and saved views"]],
    held: [["D-12", "التوزيع على الآخرين وأهداف زمن الاستجابة", "Routing to others and response-time targets"]], next: [] },
  { id: "accounts", ar: "حسابات العملاء", en: "Accounts & contacts", status: "live", upstream: "axelor-base", href: "#/accounts", probe: "/ws/ioeti/accounts?limit=1",
    works: [["إضافة حساب مع تنبيه التشابه، التعديل، جهات الاتصال، Account 360 والأنشطة", "Add with similar-name warning, edit, contacts, Account 360 and activities"]], held: [], next: [] },
  { id: "opportunities", ar: "الفرص التجارية", en: "Opportunities", status: "live", upstream: "axelor-crm", href: "#/opportunities", probe: "/ws/ioeti/opportunities?limit=1",
    works: [["الإنشاء حسب خط الأعمال، مسار المراحل، الخسارة بسبب وإعادة الفتح، تقدير الصفقة، الأنشطة", "Create per business line, stage path, lose with a reason and reopen, deal estimate, activities"]],
    held: [["D-11", "تسجيل الفوز (مرتبط بالعقد الموقّع)", "Marking won (tied to the signed contract)"]], next: [] },
  { id: "quotes", ar: "عروض الأسعار", en: "Quotations", status: "partial", upstream: "axelor-sale", href: "#/opportunities", probe: "/ws/ioeti/opportunities?limit=1",
    works: [["مسودة من الفرصة، بنود من الكتالوج، الإصدارات والاسترجاع، دفعات الاستحقاق، طلب مراجعة", "Draft from the opportunity, catalogue lines, versions and restore, payment milestones, review requests"]],
    held: [["D-11", "اعتماد العرض وإرساله للعميل", "Approving and sending a quotation"], ["D-06", "الضرائب على العرض", "Taxes on quotations"]], next: [] },
  { id: "catalog", ar: "كتالوج الخدمات", en: "Service catalogue", status: "live", upstream: "axelor-base / axelor-sale", href: "#/catalog", probe: "/ws/ioeti/catalog/products?limit=1",
    works: [["إضافة وتعديل الخدمات والأسعار قبل الضريبة، الإيقاف عن البيع، جاهزية الفوترة", "Add and change services and prices before tax, take off sale, invoicing readiness"]],
    held: [["D-06", "حساب الإيراد والضرائب لكل شركة (إعداد المالية)", "Revenue account and taxes per company (finance set-up)"]],
    next: [["قوائم الأسعار والباقات", "Price lists and bundles"]] },
  { id: "contracts", ar: "العقود والاتفاقيات", en: "Contracts", status: "partial", upstream: "axelor-contract", href: "#/opportunities", probe: "/ws/ioeti/opportunities?limit=1",
    works: [["مسودة عقد (فوترة أو إطاري) من الفرصة، تعبئته من العرض، طلب التجديد", "Draft contract (billing or framework), filled from the quotation, renewal request"]],
    held: [["D-11", "التوقيع والتفعيل والتسليم للتشغيل", "Signature, activation and operations handover"]], next: [] },
  { id: "finance", ar: "الفواتير والتحصيل", en: "Invoices & collection", status: "partial", upstream: "axelor-account / axelor-supplychain", href: "#/finance", probe: "/ws/ioeti/finance/queue",
    works: [["قائمة طلبات الفوترة لفريق المالية، الأقساط اللي جاي معادها من غير طلب، أرقام المؤكد والمطلوب والمفوتر والمحصّل لكل عملة من السجلات الفعلية", "Finance's queue of invoice requests, milestones coming due without a request, confirmed / requested / invoiced / collected per currency from real records"]],
    held: [["D-06", "إصدار الفاتورة، الضرائب، الفاتورة الإلكترونية، تسجيل التحصيل", "Issuing invoices, taxes, e-invoicing, recording collections"]],
    next: [["بعد اعتماد D-06: الإصدار من نظام الحسابات أو النظام الخارجي اللي هيتقرر", "After D-06: issuing from the accounting module or the external system decided"]] },
  { id: "projects", ar: "المشروعات والتسليم", en: "Projects & delivery", status: "live", upstream: "axelor-project", href: "#/operations", probe: "/ws/ioeti/operations/handovers",
    works: [["استلام الصفقة وقبولها أو رفضها أو إعادتها، المشروع والمهام والمتطلبات، المسؤول", "Handover accept / reject / rework, engagement, tasks and requirements, owner"]], held: [], next: [] },
  { id: "visits", ar: "الزيارات الميدانية", en: "Field visits", status: "live", upstream: "axelor-intervention", href: "#/visits", probe: "/ws/ioeti/visits?mine=true",
    works: [["التخطيط والتكليف والموعد، البدء والإيقاف والإنهاء والإلغاء في الموقع، سجل ملاحظات الزيارة، الأجندة", "Planning, assignment and time, start / pause / finish / cancel on site, the visit log, the agenda"]],
    held: [["D-10", "إرسال تأكيد أو تقرير للعميل", "Sending a confirmation or report to the customer"]], next: [["قوائم التحقق والصور والتوقيع", "Checklists, photos and signature"]] },
  { id: "quality", ar: "الجودة والإجراءات التصحيحية", en: "Quality & corrective actions", status: "live", upstream: "axelor-quality", href: "#/quality", probe: "/ws/ioeti/quality",
    works: [["سجل مشاكل الجودة (المصدر، الخطورة، اللي حصل)، الخطة ومسؤولها، الإجراءات التصحيحية بمواعيدها والتقدم، تقييم الفعالية، الحالات الخاصة بالشركة", "The quality issue register (source, gravity, what happened), the plan and its owner, corrective actions with due dates and progress, the effectiveness check, the company's own statuses"],
      ["مخالفات التدقيق (رئيسية/ثانوية) وإجراءاتها داخل دورة الشهادة", "Audit nonconformities (major/minor) and their actions within a certification cycle"]],
    held: [["D-10", "إبلاغ العميل أو المورد بالمشكلة أو بالإجراء", "Telling the client or supplier about the issue or the action"]],
    next: [["تحليل الأسباب الجذرية بالطريقة المعتمدة عند الشركة", "Root-cause analysis with the company's chosen method"]] },
  { id: "marketing", ar: "التسويق والحملات", en: "Marketing & campaigns", status: "live", upstream: "axelor-marketing", href: "#/campaigns", probe: "/ws/ioeti/campaigns",
    works: [["لوحة الحملات بالسحب بين المراحل، الإنشاء والتعديل، النتائج من السجلات الحقيقية (العملاء المنسوبون، التحويل، الفرص)", "Campaign board with drag between stages, create and edit, results from real records (attributed leads, conversions, opportunities)"],
      ["المصادر وأنواع الحملات من لوحة الإدارة، الإسناد، الموافقات، صندوق الرسائل المعلّقة", "Sources and campaign types from the admin console, attribution, consent, the held outbox"]],
    held: [["D-10", "الإرسال الخارجي (واتساب، بريد، إعلانات)", "External sending (WhatsApp, e-mail, ads)"]], next: [] },
  { id: "learning", ar: "التدريب الخارجي", en: "External training", status: "live", upstream: "ioeti-training", href: "#/training", probe: "/ws/ioeti/training/courses",
    works: [["البرامج والمجموعات والجلسات، التسجيل وقائمة الانتظار، الحضور", "Courses, cohorts and sessions, enrolment and waitlist, attendance"]],
    held: [["D-03", "إصدار الشهادات وإلغاء المجموعة والاسترداد", "Certificates, cohort cancellation and refunds"]], next: [] },
  { id: "recruiting", ar: "التوظيف للعملاء", en: "Client recruitment", status: "live", upstream: "ioeti-recruitment", href: "#/recruitment", probe: "/ws/ioeti/recruitment/job-orders",
    works: [["طلبات العملاء، المرشحون والموافقة، المقابلات والعروض والتعيين، دفعات الأتعاب", "Job orders, candidates and consent, interviews, offers and placements, fee milestones"]],
    held: [["D-04", "مشاركة السيرة الذاتية مع العميل وطلبات الاستبدال", "Sharing CVs with clients and replacement claims"]], next: [] },
  { id: "certification", ar: "إدارة شهادات ISO", en: "ISO certification", status: "live", upstream: "ioeti-certification", href: "#/certification", probe: "/ws/ioeti/certification/cycles",
    works: [["دورات الشهادة والمواقع والنطاق، برنامج التدقيق، كفاءة المدققين، المخالفات، الجاهزية", "Cycles, sites and scope, audit programme, auditor competence, nonconformities, readiness"]],
    held: [["D-02", "قرار الشهادة وإصدارها، تدقيقات المراقبة والتجديد", "Certification decision and certificate, surveillance and recertification audits"]], next: [] },
  { id: "fundraising", ar: "تنمية الموارد", en: "Fundraising", status: "live", upstream: "ioeti-fundraising", href: "#/fundraising", probe: "/ws/ioeti/fundraising/donors",
    works: [["المانحون والمنح والحملات، التعهدات وجداولها، التحصيلات منفصلة عن التعهدات", "Donors, grants and campaigns, pledges and schedules, collections kept apart from pledges"]],
    held: [["D-05", "الإيصالات وترحيل الأموال المقيدة", "Receipts and posting restricted funds"]], next: [] },
];

type Access = "checking" | "yes" | "no" | "unknown";
const T = {
  ar: { eyebrow: "النظام", title: "خريطة النظام", hint: "كل جزء من الشغل: إيه اللي شغال فعلًا دلوقتي، إيه اللي مستني قرار من الشركة، وإيه اللي لسه بيتبني. افتح أي جزء مباشرة.",
    live: "شغال", partial: "شغال جزئيًا", missing: "لسه بيتبني", works: "شغال دلوقتي", held: "مستني قرار الشركة", next: "جاي بعد كده",
    open: "افتح", search: "ابحث في الأجزاء", access: { checking: "بيتأكد من صلاحيتك…", yes: "متاح لك", no: "مش ضمن صلاحياتك", unknown: "" },
    counts: (l: number, p: number, m: number) => `${l} شغال · ${p} جزئي · ${m} لسه`, decision: "قرار", empty: "مفيش أجزاء بالاسم ده." },
  en: { eyebrow: "System", title: "System map", hint: "Every part of the work: what actually works now, what waits for a company decision, and what is still being built. Open any part directly.",
    live: "Live", partial: "Partly live", missing: "Being built", works: "Works now", held: "Waits for a company decision", next: "Coming next",
    open: "Open", search: "Search the map", access: { checking: "Checking your access…", yes: "You have access", no: "Not in your permissions", unknown: "" },
    counts: (l: number, p: number, m: number) => `${l} live · ${p} partly · ${m} being built`, decision: "decision", empty: "Nothing by that name." },
};
const ICON = { live: CheckCircle2, partial: CircleDashed, missing: Construction } as const;

export function SystemMap({ language }: { language: Language }) {
  const t = T[language], ar = language === "ar", i = ar ? 0 : 1;
  const [query, setQuery] = useState("");
  const [access, setAccess] = useState<Record<string, Access>>({});
  useEffect(() => {
    let live = true;
    // one light read per domain: 200 means the person can reach it, 403 that their permissions do not
    for (const d of DOMAINS) {
      if (!d.probe) continue;
      setAccess(a => ({ ...a, [d.id]: "checking" }));
      wrapped<unknown>(d.probe)
        .then(() => { if (live) setAccess(a => ({ ...a, [d.id]: "yes" })); })
        .catch(e => { if (live) setAccess(a => ({ ...a, [d.id]: e instanceof ApiError && (e.statusCode === 403 || e.statusCode === 404) ? "no" : "unknown" })); });
    }
    return () => { live = false; };
  }, []);
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return DOMAINS.filter(d => !q || [d.ar, d.en, d.upstream].join(" ").toLocaleLowerCase().includes(q));
  }, [query]);
  const count = (s: Status) => DOMAINS.filter(d => d.status === s).length;
  const Arrow = ar ? ArrowLeft : ArrowRight;
  return <section className="page-enter system-map">
    <div className="page-head"><div className="page-title"><span className="eyebrow">{t.eyebrow}</span><h1>{t.title}</h1><p>{t.hint}</p></div></div>
    <div className="system-map-bar">
      <div className="system-map-meter" aria-label={t.counts(count("live"), count("partial"), count("missing"))}>
        {(["live", "partial", "missing"] as Status[]).map(s => <span key={s} className={"is-" + s} style={{ flexGrow: count(s) }}/>)}
      </div>
      <span className="system-map-counts">{t.counts(count("live"), count("partial"), count("missing"))}</span>
      <label className="search-field"><Search size={18}/><span className="sr-only">{t.search}</span><input value={query} placeholder={t.search} onChange={e => setQuery(e.target.value)}/></label>
    </div>
    {visible.length === 0 ? <div className="empty-state">{t.empty}</div> : <ul className="system-map-grid">{visible.map(d => {
      const Icon = ICON[d.status];
      const state = access[d.id];
      return <li key={d.id} className={"system-map-card is-" + d.status}>
        <header>
          <span className={"system-map-status is-" + d.status}><Icon size={14}/>{t[d.status]}</span>
          <code dir="ltr">{d.upstream}</code>
        </header>
        <h2>{[d.ar, d.en][i]}</h2>
        {d.works.length > 0 && <div className="system-map-block is-works"><strong><CheckCircle2 size={14}/>{t.works}</strong>
          <ul>{d.works.map(w => <li key={w[1]}>{w[i]}</li>)}</ul></div>}
        {d.held.length > 0 && <div className="system-map-block is-held"><strong><LockKeyhole size={14}/>{t.held}</strong>
          <ul>{d.held.map(h => <li key={h[0] + h[2]}><span className="system-map-decision" dir="ltr">{h[0]}</span>{h[i + 1]}</li>)}</ul></div>}
        {d.next.length > 0 && <div className="system-map-block is-next"><strong><Construction size={14}/>{t.next}</strong>
          <ul>{d.next.map(n => <li key={n[1]}>{n[i]}</li>)}</ul></div>}
        <footer>
          {state && state !== "unknown" && <span className={"system-map-access is-" + state}>{state === "yes" ? <ShieldCheck size={14}/> : state === "no" ? <CircleSlash size={14}/> : null}{t.access[state]}</span>}
          {d.href && state !== "no" && <a className="btn btn-secondary btn-small" href={d.href}>{t.open}<Arrow size={15}/></a>}
        </footer>
      </li>;
    })}</ul>}
  </section>;
}
