import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CalendarRange, CircleAlert, LockKeyhole, Megaphone, Pencil, Plus, Save, Search, UserRound } from "lucide-react";
import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { ApiError } from "./api";
import { Dialog } from "./Dialog";
import {
  CAMPAIGN_NEXT, CAMPAIGN_STAGES, addCampaign, changeCampaign, getCampaign, getCampaignTypes, getCampaigns, moveCampaign,
  type Campaign, type CampaignInput, type CampaignLead, type CampaignStage,
} from "./campaignApi";
import { wallClock } from "./dailyApi";
import type { Language } from "./preferences";
import "./daily.css";
import "./campaigns.css";
import { ErrorBanner, PageHeader } from "./ui";

const L = {
  ar: {
    eyebrow: "التسويق", title: "الحملات", hint: "خطط حملاتك وتابعها من المسودة لحد النهاية. النتايج من السجلات الحقيقية: العملاء المحتملين المنسوبين للحملة، اللي اتحولوا، والفرص.",
    add: "حملة جديدة", search: "ابحث باسم الحملة", loading: "جاري التحميل…", empty: "مفيش حملات في المرحلة دي",
    stages: { DRAFT: "مسودة", PLANNED: "مخططة", STARTED: "شغالة", SUSPENDED: "موقوفة مؤقتًا", ENDED: "انتهت" },
    picked: (n: string) => `اتمسكت حملة ${n}.`, over: (n: string, s: string) => `${n} فوق عمود ${s}.`, outside: "خارج الأعمدة.", cancelled: "اتلغى النقل.",
    moveTo: "نقل إلى", leads: "عملاء محتملون", converted: "اتحولوا", opportunities: "فرص", noSend: "الإرسال للعملاء من الحملة (بريد، واتساب، إعلانات) مستني قرار \u2066D-10\u2069.",
    notAllowed: (a: string, b: string) => `مينفعش الحملة تنتقل من "${a}" لـ"${b}".`, moved: (n: string, s: string) => `"${n}" بقت ${s}.`,
    back: "الرجوع للحملات", edit: "تعديل", results: "النتايج", resultsHint: "داخل صلاحياتك فقط، ومن غير أي تكلفة أو إيراد متخيل.",
    attributed: "العملاء المحتملون المنسوبون", noLeads: "مفيش عملاء محتملين منسوبين للحملة لسه. بتتنسب من صفحة العميل المحتمل أو عند تسجيله.",
    period: "الفترة", type: "النوع", owner: "المسؤول", summary: "الوصف", none: "—", convertedTag: "اتحول", stage: "المرحلة",
    newTitle: "حملة جديدة", editTitle: "تعديل الحملة", name: "اسم الحملة", typeLabel: "نوع الحملة", noType: "بدون نوع",
    start: "من", end: "إلى", summaryLabel: "وصف مختصر (اختياري)", save: "حفظ", saving: "جاري الحفظ…", cancel: "إلغاء",
    errors: { REQUIRED: "الاسم مطلوب.", BEFORE_START: "تاريخ النهاية قبل البداية.", STAGE_NOT_ALLOWED: "الانتقال ده مش مسموح.", conflict: "الحملة اتعدلت من مكان تاني؛ اتحدّثت.",
      forbidden: "مش مسموح لك بالإجراء ده.", failed: "تعذّر تنفيذ الطلب.", notFound: "الحملة مش موجودة أو مش متاحة لك." },
  },
  en: {
    eyebrow: "Marketing", title: "Campaigns", hint: "Plan your campaigns and follow them from draft to end. Results come from real records: the leads attributed to a campaign, those converted, and the opportunities.",
    add: "New campaign", search: "Search by campaign name", loading: "Loading…", empty: "No campaigns at this stage",
    stages: { DRAFT: "Draft", PLANNED: "Planned", STARTED: "Running", SUSPENDED: "Paused", ENDED: "Ended" },
    picked: (n: string) => `Picked up ${n}.`, over: (n: string, s: string) => `${n} over ${s}.`, outside: "Outside the columns.", cancelled: "Move cancelled.",
    moveTo: "Move to", leads: "leads", converted: "converted", opportunities: "opportunities", noSend: "Sending to customers from a campaign (e-mail, WhatsApp, ads) waits for decision \u2066D-10\u2069.",
    notAllowed: (a: string, b: string) => `A campaign cannot go from "${a}" to "${b}".`, moved: (n: string, s: string) => `"${n}" is now ${s}.`,
    back: "Back to campaigns", edit: "Edit", results: "Results", resultsHint: "Within your permissions only, with no invented cost or revenue.",
    attributed: "Attributed leads", noLeads: "No leads are attributed to this campaign yet. Attribute them from a lead's page or at intake.",
    period: "Period", type: "Type", owner: "Owner", summary: "Summary", none: "—", convertedTag: "Converted", stage: "Stage",
    newTitle: "New campaign", editTitle: "Edit campaign", name: "Campaign name", typeLabel: "Campaign type", noType: "No type",
    start: "From", end: "To", summaryLabel: "Short summary (optional)", save: "Save", saving: "Saving…", cancel: "Cancel",
    errors: { REQUIRED: "The name is required.", BEFORE_START: "The end date is before the start date.", STAGE_NOT_ALLOWED: "That move is not allowed.", conflict: "The campaign changed elsewhere; it was refreshed.",
      forbidden: "You are not allowed to do this.", failed: "The request failed.", notFound: "The campaign does not exist or is not available to you." },
  },
};
type Labels = typeof L.ar;

function problem(error: unknown, l: Labels): string {
  if (!(error instanceof ApiError)) return l.errors.failed;
  const code = error.fields?.[0]?.code ?? error.code ?? "";
  if (code in l.errors) return (l.errors as Record<string, string>)[code];
  if (error.statusCode === 409) return l.errors.conflict;
  if (error.statusCode === 403) return l.errors.forbidden;
  if (error.statusCode === 404) return l.errors.notFound;
  return l.errors.failed;
}

function routeId(hash: string): number | null {
  const m = hash.match(/^#\/campaigns\/(\d+)$/);
  return m ? Number(m[1]) : null;
}

export function CampaignsPage({ language }: { language: Language }) {
  const [id, setId] = useState(() => routeId(window.location.hash));
  useEffect(() => {
    const sync = () => setId(routeId(window.location.hash));
    window.addEventListener("hashchange", sync); window.addEventListener("popstate", sync);
    return () => { window.removeEventListener("hashchange", sync); window.removeEventListener("popstate", sync); };
  }, []);
  return id ? <CampaignRecord key={id} id={id} language={language}/> : <CampaignBoard language={language}/>;
}

function CampaignBoard({ language }: { language: Language }) {
  const l = L[language];
  const [rows, setRows] = useState<Campaign[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  const load = useCallback((search: string) => getCampaigns(search).then(setRows).catch(e => { setRows([]); setError(problem(e, l)); }), [l]);
  useEffect(() => { const t = window.setTimeout(() => void load(q), 250); return () => window.clearTimeout(t); }, [q, load]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }));
  async function move(campaign: Campaign, to: CampaignStage) {
    setError(""); setNotice("");
    if (campaign.stage === to) return;
    if (!CAMPAIGN_NEXT[campaign.stage].includes(to)) { setError(l.notAllowed(l.stages[campaign.stage], l.stages[to])); return; }
    const before = rows;
    setRows(current => current?.map(c => c.id === campaign.id ? { ...c, stage: to } : c) ?? null); // shown at once, undone if refused
    try {
      const saved = await moveCampaign(campaign.id, campaign.version, to);
      setRows(current => current?.map(c => c.id === saved.id ? saved : c) ?? null);
      setNotice(l.moved(saved.name, l.stages[saved.stage]));
    } catch (e) {
      setRows(before); setError(problem(e, l));
      if (e instanceof ApiError && e.statusCode === 409) void load(q);
    }
  }
  const nameOf = (id: string | number) => rows?.find(c => c.id === id)?.name ?? "";
  function onDragEnd(event: DragEndEvent) {
    const campaign = rows?.find(c => c.id === event.active.id);
    const to = event.over?.id as CampaignStage | undefined;
    if (campaign && to) void move(campaign, to);
  }
  return <section className="page-enter campaigns-page">
    <PageHeader eyebrow={l.eyebrow} title={l.title} description={l.hint} actions={<><button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16}/>{l.add}</button></>}/>
    <div className="campaigns-toolbar">
      <label className="search-field"><Search size={18}/><span className="sr-only">{l.search}</span><input value={q} maxLength={100} placeholder={l.search} onChange={e => setQ(e.target.value)}/></label>
    </div>
    <p className="daily-note"><LockKeyhole size={14}/>{l.noSend}</p>
    {error && <ErrorBanner message={error}/>}
    {notice && <p className="campaigns-notice" role="status">{notice}</p>}
    {rows === null ? <div className="empty-state" role="status">{l.loading}</div> :
      <DndContext sensors={sensors} onDragEnd={onDragEnd} accessibility={{ announcements: {
        onDragStart: ({ active }) => l.picked(nameOf(active.id)),
        onDragOver: ({ active, over }) => over ? l.over(nameOf(active.id), l.stages[over.id as CampaignStage]) : l.outside,
        onDragEnd: ({ active, over }) => over ? l.over(nameOf(active.id), l.stages[over.id as CampaignStage]) : l.cancelled,
        onDragCancel: () => l.cancelled,
      } }}>
        <div className="campaign-board">{CAMPAIGN_STAGES.map(stage => <Column key={stage} stage={stage} l={l} rows={rows.filter(c => c.stage === stage)} onMove={move}/>)}</div>
      </DndContext>}
    {adding && <CampaignDialog l={l} onClose={() => setAdding(false)} onSaved={c => { setAdding(false); window.location.hash = "#/campaigns/" + c.id; }}/>}
  </section>;
}

function Column({ stage, l, rows, onMove }: { stage: CampaignStage; l: Labels; rows: Campaign[]; onMove: (c: Campaign, to: CampaignStage) => void }) {
  const { setNodeRef, isOver, active } = useDroppable({ id: stage });
  const dragged = active?.data.current as Campaign | undefined;
  const accepts = dragged ? dragged.stage === stage || CAMPAIGN_NEXT[dragged.stage].includes(stage) : true;
  return <section ref={setNodeRef} className={"campaign-column is-" + stage.toLowerCase() + (isOver ? (accepts ? " is-over" : " is-refused") : "") + (dragged && !accepts ? " is-dim" : "")}
    aria-label={l.stages[stage]}>
    <header><span>{l.stages[stage]}</span><b>{rows.length}</b></header>
    {rows.length === 0 ? <p className="campaign-empty">{l.empty}</p> : <ul>{rows.map(c => <CampaignCard key={c.id} c={c} l={l} onMove={onMove}/>)}</ul>}
  </section>;
}

function CampaignCard({ c, l, onMove }: { c: Campaign; l: Labels; onMove: (c: Campaign, to: CampaignStage) => void }) {
  // dragging is for pointer and touch; the "move to" picker is the keyboard and screen-reader path
  const { listeners, setNodeRef, transform, isDragging } = useDraggable({ id: c.id, data: c });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return <li ref={setNodeRef} style={style} className={"campaign-card" + (isDragging ? " is-dragging" : "")} {...listeners}>
    <a href={"#/campaigns/" + c.id} className="campaign-card-name" onPointerDown={e => e.stopPropagation()}>{c.name}</a>
    {c.type && <span className="campaign-type">{c.type}</span>}
    <div className="campaign-figures"><span><b>{c.leads}</b> {l.leads}</span><span><b>{c.converted}</b> {l.converted}</span><span><b>{c.opportunities}</b> {l.opportunities}</span></div>
    {CAMPAIGN_NEXT[c.stage].length > 0 && <select className="campaign-move" aria-label={`${l.moveTo}: ${c.name}`} value="" onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
      onChange={e => e.target.value && onMove(c, e.target.value as CampaignStage)}>
      <option value="">{l.moveTo}…</option>
      {CAMPAIGN_NEXT[c.stage].map(s => <option key={s} value={s}>{l.stages[s]}</option>)}
    </select>}
  </li>;
}

function CampaignRecord({ id, language }: { id: number; language: Language }) {
  const l = L[language], ar = language === "ar";
  const [data, setData] = useState<{ campaign: Campaign; leads: CampaignLead[] } | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => getCampaign(id).then(setData).catch(e => setError(problem(e, l))), [id, l]);
  useEffect(() => { void load(); }, [load]);
  const Back = ar ? ArrowRight : ArrowLeft;
  const date = (v: string | null) => wallClock(v)?.toLocaleDateString(ar ? "ar-EG" : "en-GB", { dateStyle: "medium" }) ?? l.none;
  const c = data?.campaign;
  const bars = useMemo(() => c ? [[l.leads, c.leads], [l.converted, c.converted], [l.opportunities, c.opportunities]] as [string, number][] : [], [c, l]);
  async function move(to: CampaignStage) {
    if (!c) return;
    setBusy(true); setError("");
    try { const saved = await moveCampaign(c.id, c.version, to); setData(d => d ? { ...d, campaign: saved } : d); }
    catch (e) { setError(problem(e, l)); if (e instanceof ApiError && e.statusCode === 409) void load(); }
    finally { setBusy(false); }
  }
  return <article className="page-enter campaign-record">
    <div className="record-context-bar"><a className="record-back" href="#/campaigns"><Back size={17}/>{l.back}</a></div>
    {error && <ErrorBanner message={error}/>}
    {!c ? (!error && <div className="empty-state" role="status">{l.loading}</div>) : <>
      <header className="campaign-hero">
        <div className="campaign-hero-icon"><Megaphone size={28}/></div>
        <div className="campaign-hero-main">
          <span className={"campaign-stage-pill is-" + c.stage.toLowerCase()}>{l.stages[c.stage]}</span>
          <h1>{c.name}</h1>
          <dl className="campaign-facts">
            <div><dt><CalendarRange size={14}/>{l.period}</dt><dd>{c.startDate || c.endDate ? `${date(c.startDate)} – ${date(c.endDate)}` : l.none}</dd></div>
            <div><dt>{l.type}</dt><dd>{c.type ?? l.none}</dd></div>
            <div><dt><UserRound size={14}/>{l.owner}</dt><dd>{c.ownerName ?? l.none}</dd></div>
          </dl>
        </div>
        <div className="campaign-hero-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}><Pencil size={15}/>{l.edit}</button>
          {CAMPAIGN_NEXT[c.stage].map(s => <button key={s} type="button" className="btn btn-primary" disabled={busy} onClick={() => void move(s)}>{l.moveTo} {l.stages[s]}</button>)}
        </div>
      </header>
      {c.summary && <p className="campaign-summary">{c.summary}</p>}
      <div className="campaign-record-grid">
        <section className="record-content-card campaign-results" aria-labelledby="campaign-results-title">
          <h2 id="campaign-results-title">{l.results}</h2><p className="daily-note">{l.resultsHint}</p>
          <ol className="campaign-funnel">{bars.map(([label, value]) => <li key={label}>
            <span>{label}</span><div className="campaign-bar"><i style={{ inlineSize: `${bars[0][1] ? Math.max(4, (value / bars[0][1]) * 100) : 0}%` }}/></div><b>{value}</b></li>)}</ol>
        </section>
        <section className="record-content-card campaign-leads" aria-labelledby="campaign-leads-title">
          <h2 id="campaign-leads-title">{l.attributed}</h2>
          {data.leads.length === 0 ? <p className="activity-empty">{l.noLeads}</p> : <ul>{data.leads.map(lead => <li key={lead.id}>
            <a href={"#/leads/" + lead.id}>{lead.name}</a>
            <span className={"campaign-lead-tag" + (lead.converted ? " is-converted" : "")}>{lead.converted ? l.convertedTag : lead.stage ?? l.none}</span>
          </li>)}</ul>}
        </section>
      </div>
      <p className="daily-note"><LockKeyhole size={14}/>{l.noSend}</p>
      {editing && <CampaignDialog l={l} campaign={c} onClose={() => setEditing(false)} onSaved={saved => { setEditing(false); setData(d => d ? { ...d, campaign: saved } : d); }}/>}
    </>}
  </article>;
}

function CampaignDialog({ l, campaign, onClose, onSaved }: { l: Labels; campaign?: Campaign; onClose: () => void; onSaved: (c: Campaign) => void }) {
  const [name, setName] = useState(campaign?.name ?? "");
  const [typeId, setTypeId] = useState(campaign?.typeId ? String(campaign.typeId) : "");
  const [start, setStart] = useState(campaign?.startDate?.slice(0, 10) ?? "");
  const [end, setEnd] = useState(campaign?.endDate?.slice(0, 10) ?? "");
  const [summary, setSummary] = useState(campaign?.summary ?? "");
  const [types, setTypes] = useState<{ id: number; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void getCampaignTypes().then(setTypes).catch(() => setTypes([])); }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const input: CampaignInput = { name: name.trim(), typeId: typeId ? Number(typeId) : "", startDate: start, endDate: end, summary: summary.trim() };
    try { onSaved(campaign ? await changeCampaign(campaign.id, campaign.version, input) : await addCampaign(input)); }
    catch (failure) { setError(problem(failure, l)); }
    finally { setBusy(false); }
  }
  return <Dialog title={campaign ? l.editTitle : l.newTitle} kicker={l.title} busy={busy} onClose={onClose} wide
    footer={<><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{l.cancel}</button>
      <button type="submit" form="campaign-form" className="btn btn-primary" disabled={busy}><Save size={16}/>{busy ? l.saving : l.save}</button></>}>
    <form id="campaign-form" className="daily-form daily-form-two" onSubmit={e => void submit(e)}>
      <label className="daily-span"><span>{l.name}</span><input value={name} required maxLength={255} onChange={e => setName(e.target.value)}/></label>
      <label className="daily-span"><span>{l.typeLabel}</span><select value={typeId} onChange={e => setTypeId(e.target.value)}><option value="">{l.noType}</option>
        {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label><span>{l.start}</span><input type="date" value={start} onChange={e => setStart(e.target.value)}/></label>
      <label><span>{l.end}</span><input type="date" value={end} min={start || undefined} onChange={e => setEnd(e.target.value)}/></label>
      <label className="daily-span"><span>{l.summaryLabel}</span><textarea value={summary} maxLength={4000} rows={3} onChange={e => setSummary(e.target.value)}/></label>
      {error && <p className="daily-error daily-span" role="alert"><CircleAlert size={15}/>{error}</p>}
    </form>
  </Dialog>;
}
