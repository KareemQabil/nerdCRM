import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, BarChart3, Bell, BellRing, ClipboardCheck, ClipboardList, Inbox, UserPlus, UsersRound } from "lucide-react";
import { ApiError } from "./api";
import { getFollowUps, type FollowUp } from "./marketingApi";
import { getHandovers, type Handover } from "./operationsApi";
import { getPendingReviews, type Review } from "./workspaceApi";
import { getAreasReport, getSalesReport, type AreasReport, type SalesReport } from "./reportsApi";
import { stageLabel } from "./labels";
import type { Language } from "./preferences";

/**
 * The live home page: the signed-in person's own work first, then the pipeline and activity they may
 * read. Every figure comes from the server. A section the person has no right to is left out (403),
 * never shown as zero; a section that failed to load says so.
 */
type Section<T> = { state: "loading" } | { state: "hidden" } | { state: "failed" } | { state: "ready"; value: T };
type Props = { language: Language; name: string | null; unread: number; onNavigate: (page: string) => void };

const strings = {
  ar: {
    hello: "مرحبًا", day: "عملك اليوم", dayHint: "ما ينتظرك أنت، مرتّبًا حسب الأولوية.",
    newLead: "عميل محتمل جديد", openInbox: "الإشعارات", openLeads: "العملاء المحتملون", openOps: "التسليم والتشغيل",
    unread: "إشعارات غير مقروءة", reviews: "مراجعات بانتظارك", overdue: "متابعات متأخرة", planned: "متابعات مخطّطة", handovers: "طلبات تسليم بانتظار المراجعة",
    pipeline: "خط المبيعات المفتوح", pipelineHint: "عدد الفرص المفتوحة في كل مرحلة، والقيمة المتوقعة لكل عملة على حدة.",
    leads: "العملاء المحتملون", total: "الإجمالي", open: "مفتوحة", converted: "تم تحويلهم", lost: "مفقودة",
    areas: "نشاط الخدمات", areasHint: "السجلات التي يمكنك رؤيتها في كل مجال.", none: "لا توجد فرص مفتوحة بعد.",
    failed: "تعذّر تحميل هذا الجزء الآن.", loading: "جار التحميل...", view: "عرض", nothing: "لا شيء ينتظرك الآن.",
    keys: { TRAINING_ENROLLMENTS: "تسجيلات التدريب", CERTIFICATION_CYCLES: "دورات الاعتماد", JOB_ORDERS: "طلبات التوظيف",
      APPLICATIONS: "طلبات المرشحين", PLACEMENTS: "التعيينات", HANDOVERS: "طلبات التسليم", ENGAGEMENTS: "المشروعات التنفيذية",
      FUNDING_OPPORTUNITIES: "فرص التمويل", FIELD_VISITS: "الزيارات الميدانية", QUALITY_ISSUES: "مشاكل الجودة" } as Record<string, string>,
  },
  en: {
    hello: "Hello", day: "Your work today", dayHint: "What is waiting for you, most urgent first.",
    newLead: "New lead", openInbox: "Inbox", openLeads: "Leads", openOps: "Handover & operations",
    unread: "Unread notices", reviews: "Reviews waiting for you", overdue: "Overdue follow-ups", planned: "Planned follow-ups", handovers: "Handovers awaiting review",
    pipeline: "Open sales pipeline", pipelineHint: "Open opportunities per stage, and the expected value per currency, never added together.",
    leads: "Leads", total: "Total", open: "Open", converted: "Converted", lost: "Lost",
    areas: "Service activity", areasHint: "Records you may see in each area.", none: "No open opportunities yet.",
    failed: "This section could not be loaded right now.", loading: "Loading...", view: "View", nothing: "Nothing is waiting for you.",
    keys: { TRAINING_ENROLLMENTS: "Training enrolments", CERTIFICATION_CYCLES: "Certification cycles", JOB_ORDERS: "Job orders",
      APPLICATIONS: "Candidate applications", PLACEMENTS: "Placements", HANDOVERS: "Handovers", ENGAGEMENTS: "Engagements",
      FUNDING_OPPORTUNITIES: "Funding opportunities", FIELD_VISITS: "Field visits", QUALITY_ISSUES: "Quality issues" } as Record<string, string>,
  },
} as const;

const AREA_PAGE: Record<string, string> = {
  TRAINING_ENROLLMENTS: "training", CERTIFICATION_CYCLES: "certification", JOB_ORDERS: "recruitment", APPLICATIONS: "recruitment",
  PLACEMENTS: "recruitment", HANDOVERS: "operations", ENGAGEMENTS: "operations", FUNDING_OPPORTUNITIES: "fundraising",
  FIELD_VISITS: "visits", QUALITY_ISSUES: "quality",
};

async function load<T>(call: () => Promise<T>): Promise<Section<T>> {
  try { return { state: "ready", value: await call() }; }
  catch (error) { return error instanceof ApiError && (error.statusCode === 403 || error.statusCode === 404) ? { state: "hidden" } : { state: "failed" }; }
}

export function HomeCockpit({ language, name, unread, onNavigate }: Props) {
  const ar = language === "ar";
  const l = strings[language];
  const Forward = ar ? ArrowLeft : ArrowRight;
  const [followUps, setFollowUps] = useState<Section<FollowUp[]>>({ state: "loading" });
  const [handovers, setHandovers] = useState<Section<Handover[]>>({ state: "loading" });
  const [sales, setSales] = useState<Section<SalesReport>>({ state: "loading" });
  const [areas, setAreas] = useState<Section<AreasReport>>({ state: "loading" });
  const [reviews, setReviews] = useState<Section<Review[]>>({ state: "loading" });
  useEffect(() => {
    void load(() => getFollowUps(false)).then(setFollowUps);
    void load(() => getHandovers("SUBMITTED")).then(setHandovers);
    void load(() => getSalesReport("", "")).then(setSales);
    void load(() => getAreasReport("", "")).then(setAreas);
    void load(() => getPendingReviews()).then(setReviews);
  }, []);

  const money = (amount: string | number, currency: string | null) =>
    new Intl.NumberFormat(ar ? "ar-EG" : "en-EG", { maximumFractionDigits: 0 }).format(Number(amount)) + (currency ? " " + currency : "");
  const planned = followUps.state === "ready" ? followUps.value.filter(f => f.status === "PLANNED") : [];
  const overdue = planned.filter(f => f.overdue);
  const tiles: { key: string; label: string; value: number; tone: string; page: string; icon: typeof Bell }[] = [
    { key: "unread", label: l.unread, value: unread, tone: unread ? "attention" : "calm", page: "inbox", icon: Bell },
    ...(followUps.state === "ready" ? [
      { key: "overdue", label: l.overdue, value: overdue.length, tone: overdue.length ? "danger" : "calm", page: "leads", icon: BellRing },
      { key: "planned", label: l.planned, value: planned.length, tone: "calm", page: "leads", icon: BellRing },
    ] : []),
    ...(reviews.state === "ready" && reviews.value.length > 0 ? [
      { key: "reviews", label: l.reviews, value: reviews.value.length, tone: "attention", page: "opportunities", icon: ClipboardCheck },
    ] : []),
    ...(handovers.state === "ready" ? [
      { key: "handovers", label: l.handovers, value: handovers.value.length, tone: handovers.value.length ? "attention" : "calm", page: "operations", icon: ClipboardList },
    ] : []),
  ];

  // open stages only, merged across business lines; money stays per currency
  const stages = new Map<string, { count: number; money: Map<string, number> }>();
  if (sales.state === "ready") for (const row of sales.value.pipeline ?? []) {
    if (row.open === false) continue;
    const key = row.stage ?? "—";
    const entry = stages.get(key) ?? { count: 0, money: new Map<string, number>() };
    entry.count += row.count;
    for (const a of row.amounts) if (Number(a.amount)) entry.money.set(a.currency ?? "", (entry.money.get(a.currency ?? "") ?? 0) + Number(a.amount));
    stages.set(key, entry);
  }
  const widest = Math.max(1, ...[...stages.values()].map(s => s.count));
  const funnel = sales.state === "ready" ? sales.value.leads : null;

  return <section className="page-enter cockpit">
    <div className="page-head">
      <div className="page-title">
        <span className="eyebrow">{new Intl.DateTimeFormat(ar ? "ar-EG" : "en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</span>
        <h1>{l.hello}{name ? (ar ? "، " : ", ") + name : ""}</h1><p>{l.dayHint}</p>
      </div>
      <div className="page-head-actions">
        <button type="button" className="btn btn-primary" onClick={() => onNavigate("leads")}><UserPlus size={16}/>{l.newLead}</button>
        <button type="button" className="btn btn-secondary" onClick={() => onNavigate("inbox")}><Inbox size={16}/>{l.openInbox}</button>
      </div>
    </div>

    <h2 className="cockpit-heading">{l.day}</h2>
    <div className="cockpit-tiles" role="list">
      {tiles.map(tile => <button key={tile.key} role="listitem" type="button" className={"cockpit-tile tone-" + tile.tone} onClick={() => onNavigate(tile.page)}>
        <span className="cockpit-tile-icon"><tile.icon size={19}/></span>
        <span className="cockpit-tile-value">{tile.value}</span>
        <span className="cockpit-tile-label">{tile.label}</span>
        <Forward size={16} className="cockpit-tile-go"/>
      </button>)}
    </div>
    {followUps.state === "ready" && overdue.length > 0 && <div className="data-panel cockpit-list">
      <div className="data-panel-heading"><strong>{l.overdue}</strong><span>{overdue.length}</span></div>
      {overdue.slice(0, 5).map(f => <a key={f.id} className="cockpit-row" href={f.leadId ? `#/leads/${f.leadId}` : "#/leads"}>
        <span className="cockpit-row-main"><strong>{f.subject}</strong><small>{f.leadName ?? "—"}</small></span>
        <span className="cockpit-row-meta" dir="ltr">{f.at ? new Intl.DateTimeFormat(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(f.at)) : "—"}</span>
      </a>)}
    </div>}

    {reviews.state === "ready" && reviews.value.length > 0 && <div className="data-panel cockpit-list">
      <div className="data-panel-heading"><strong>{l.reviews}</strong><span>{reviews.value.length}</span></div>
      {reviews.value.slice(0, 5).map(r => <a key={r.id} className="cockpit-row" href={r.opportunityId ? `#/opportunities/${r.opportunityId}` : "#/opportunities"}>
        <span className="cockpit-row-main"><strong dir="auto">{r.subjectReference ?? "—"}</strong><small>{r.requestedBy ?? "—"}</small></span>
        <span className="cockpit-row-meta" dir="ltr">{r.requestedAt ? new Intl.DateTimeFormat(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "short" }).format(new Date(r.requestedAt)) : "—"}</span>
      </a>)}
    </div>}

    <div className="cockpit-grid">
      {sales.state !== "hidden" && <section className="data-panel cockpit-panel" aria-labelledby="cockpit-pipeline">
        <div className="data-panel-heading"><strong id="cockpit-pipeline"><BarChart3 size={17}/>{l.pipeline}</strong>
          <button type="button" className="text-action" onClick={() => onNavigate("reports")}>{l.view}<Forward size={15}/></button></div>
        <div className="cockpit-panel-body">
          <p className="cockpit-hint">{l.pipelineHint}</p>
          {sales.state === "loading" ? <p role="status">{l.loading}</p> : sales.state === "failed" ? <p role="alert">{l.failed}</p>
            : sales.value.pipeline === null ? null : stages.size === 0 ? <p>{l.none}</p>
            : <ol className="cockpit-bars">{[...stages.entries()].map(([stage, s]) => <li key={stage}>
              <span className="cockpit-bar-label">{stageLabel(stage, language)}</span>
              <span className="cockpit-bar"><span style={{ inlineSize: `${Math.round(s.count / widest * 100)}%` }}/></span>
              <span className="cockpit-bar-count" dir="ltr">{s.count}</span>
              {s.money.size > 0 && <span className="cockpit-bar-money">{[...s.money.entries()].map(([c, v]) => money(v, c)).join(" · ")}</span>}
            </li>)}</ol>}
          {funnel && <dl className="cockpit-funnel">
            <div><dt>{l.leads} · {l.total}</dt><dd dir="ltr">{funnel.total}</dd></div>
            <div><dt>{l.open}</dt><dd dir="ltr">{funnel.open}</dd></div>
            <div><dt>{l.converted}</dt><dd dir="ltr">{funnel.converted}</dd></div>
            <div><dt>{l.lost}</dt><dd dir="ltr">{funnel.lost}</dd></div>
          </dl>}
        </div>
      </section>}
      {areas.state !== "hidden" && <section className="data-panel cockpit-panel" aria-labelledby="cockpit-areas">
        <div className="data-panel-heading"><strong id="cockpit-areas"><UsersRound size={17}/>{l.areas}</strong></div>
        <div className="cockpit-panel-body">
          <p className="cockpit-hint">{l.areasHint}</p>
          {areas.state === "loading" ? <p role="status">{l.loading}</p> : areas.state === "failed" ? <p role="alert">{l.failed}</p>
            : areas.value.areas.length === 0 ? <p>{l.nothing}</p>
            : <ul className="cockpit-areas">{areas.value.areas.map(a => <li key={a.key}>
              <button type="button" onClick={() => onNavigate(AREA_PAGE[a.key] ?? "reports")}>
                <span>{l.keys[a.key] ?? a.key}</span><strong dir="ltr">{a.count}</strong><Forward size={14}/>
              </button></li>)}</ul>}
        </div>
      </section>}
    </div>
  </section>;
}
