import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { Building2, CalendarClock, CircleAlert, GripVertical, Trophy, UserRound, XCircle } from "lucide-react";
import { getPipelineBoard, type BoardCard } from "./api";
import { getOpportunityStages, moveOpportunity, problem, type OpportunityStage } from "./dailyApi";
import { amount, day } from "./format";
import { stageLabel } from "./labels";
import type { Language } from "./preferences";

/**
 * The pipeline as a board: one column per open stage, then won and lost (last 30 days). Cards move between open stages by
 * dragging, or by the keyboard with the card's own stage list; the server checks the move and the version as always.
 * Won and lost are not set by dropping: they need the line's evidence (D-11) or a lost reason, so the card opens its record
 * where those steps are.
 */
const L = {
  ar: {
    all: "كل الخطوط", mine: "فرصي بس", search: "دوّر في اللوحة", empty: "مفيش فرص هنا.", total: "الإجمالي", won: "مكسوبة (آخر 30 يوم)", lost: "خسرانة (آخر 30 يوم)",
    move: "نقل إلى", moved: "اتنقلت الفرصة.", closeHere: "المكسب والخسارة بيتسجلوا من صفحة الفرصة (فيها الدليل أو السبب). فتحتها لك.", late: "ميعاد الإغلاق فات",
    dropHint: "اسحب الكارت لمرحلة تانية، أو اختار المرحلة من القائمة اللي على الكارت.", loading: "جاري التحميل…", owner: "المسؤول", count: (n: number) => `${n} فرصة`,
  },
  en: {
    all: "All lines", mine: "Mine only", search: "Search the board", empty: "No opportunities here.", total: "Total", won: "Won (last 30 days)", lost: "Lost (last 30 days)",
    move: "Move to", moved: "Moved.", closeHere: "Won and lost are recorded on the opportunity (with its evidence or reason); it is open for you.", late: "Close date passed",
    dropHint: "Drag a card to another stage, or pick the stage from the card's own list.", loading: "Loading…", owner: "Owner", count: (n: number) => `${n} opportunities`,
  },
};

export function PipelineBoard({ language, onOpen }: { language: Language; onOpen: (id: number) => void }) {
  const l = L[language], ar = language === "ar";
  const [cards, setCards] = useState<BoardCard[] | null>(null);
  const [stages, setStages] = useState<OpportunityStage[]>([]);
  const [line, setLine] = useState("");
  const [mine, setMine] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | string | null>(null);
  const load = useCallback(() => Promise.all([getPipelineBoard(), getOpportunityStages()])
    .then(([c, s]) => { setCards(c); setStages(s); }).catch(e => { setCards([]); setError(problem(e, ar)); }), [ar]);
  useEffect(() => { void load(); }, [load]);

  const lines = useMemo(() => {
    const m = new Map<string, string>();
    (cards ?? []).forEach(c => { if (c.opportunity.businessLineCode) m.set(c.opportunity.businessLineCode, (ar ? c.opportunity.businessLineNameAr : c.opportunity.businessLineNameEn) ?? c.opportunity.businessLineCode); });
    return [...m];
  }, [cards, ar]);
  const shown = (cards ?? []).filter(c => (!line || c.opportunity.businessLineCode === line) && (!mine || c.mine)
    && (!query.trim() || [c.opportunity.name, c.accountName ?? "", c.opportunity.reference ?? ""].some(v => v.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))));
  const open = stages.filter(s => s.kind === "OPEN");
  const columns: { key: string; title: string; stage?: OpportunityStage; kind: string; cards: BoardCard[] }[] = [
    ...open.map(s => ({ key: "s" + s.id, title: stageLabel(s.name, language), stage: s, kind: "OPEN", cards: shown.filter(c => c.opportunity.stageId === s.id) })),
    { key: "won", title: l.won, kind: "WON", cards: shown.filter(c => c.opportunity.stageKind === "WON") },
    { key: "lost", title: l.lost, kind: "LOST", cards: shown.filter(c => c.opportunity.stageKind === "LOST") },
  ];

  async function move(card: BoardCard, target: { stage?: OpportunityStage; kind: string }) {
    setError(""); setNotice("");
    if (target.kind !== "OPEN" || !target.stage) { setNotice(l.closeHere); onOpen(card.opportunity.id); return; }
    if (card.opportunity.stageId === target.stage.id) return;
    const before = cards;
    const stage = target.stage;
    setCards(cs => (cs ?? []).map(c => c === card ? { ...c, opportunity: { ...c.opportunity, stageId: stage.id, stage: stage.name, stageKind: stage.kind } } : c));
    try { await moveOpportunity(card.opportunity.id, card.opportunity.version, stage.id); setNotice(l.moved); await load(); }
    catch (e) { setCards(before); setError(problem(e, ar)); }
  }
  const onDrop = (e: DragEvent, column: { stage?: OpportunityStage; kind: string }) => {
    e.preventDefault(); setOver(null);
    const id = Number(e.dataTransfer.getData("text/plain")) || dragging;
    const card = (cards ?? []).find(c => c.opportunity.id === id);
    setDragging(null);
    if (card) void move(card, column);
  };

  const totals = (list: BoardCard[]) => {
    const m = new Map<string, number>();
    list.forEach(c => { const n = Number(c.opportunity.amount); if (n > 0) m.set(c.opportunity.currencyCode ?? "", (m.get(c.opportunity.currencyCode ?? "") ?? 0) + n); });
    return [...m].map(([cur, n]) => amount(n, cur || null, true));
  };
  const today = new Date().toISOString().slice(0, 10);
  return <div className="pipeline-board-wrap">
    <div className="pipeline-filters">
      <input className="pipeline-search" value={query} placeholder={l.search} aria-label={l.search} onChange={e => setQuery(e.target.value)}/>
      <select value={line} aria-label={l.all} onChange={e => setLine(e.target.value)}><option value="">{l.all}</option>{lines.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select>
      <label className="pipeline-mine"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)}/>{l.mine}</label>
      <small>{l.dropHint}</small>
    </div>
    {notice && <p className="daily-note" role="status">{notice}</p>}
    {error && <p className="daily-error" role="alert"><CircleAlert size={15}/>{error}</p>}
    {cards === null ? <div className="empty-state" role="status">{l.loading}</div> :
    <div className="pipeline-board" role="list" aria-label={ar ? "لوحة الفرص" : "Pipeline board"}>
      {columns.map(col => { const sum = totals(col.cards); return <section key={col.key} role="listitem" aria-label={col.title}
        className={"pipeline-column kind-" + col.kind.toLowerCase() + (over === col.key ? " is-over" : "")}
        onDragOver={e => { if (dragging != null) { e.preventDefault(); setOver(col.key); } }} onDragLeave={() => setOver(o => o === col.key ? null : o)}
        onDrop={e => onDrop(e, col)}>
        <header>
          {col.kind === "WON" ? <Trophy size={15}/> : col.kind === "LOST" ? <XCircle size={15}/> : null}
          <strong>{col.title}</strong><span className="pipeline-count">{col.cards.length}</span>
          {sum.length > 0 && <span className="pipeline-sum" dir="ltr">{sum.join(" · ")}</span>}
        </header>
        <ol>{col.cards.map(c => { const o = c.opportunity; const late = col.kind === "OPEN" && o.expectedCloseDate != null && o.expectedCloseDate < today;
          return <li key={o.id} className={"pipeline-card" + (dragging === o.id ? " is-dragging" : "")} draggable={col.kind === "OPEN"}
            onDragStart={e => { setDragging(o.id); e.dataTransfer.setData("text/plain", String(o.id)); e.dataTransfer.effectAllowed = "move"; }}
            onDragEnd={() => { setDragging(null); setOver(null); }}>
            <div className="pipeline-card-top">
              {col.kind === "OPEN" && <GripVertical size={14} className="pipeline-grip" aria-hidden="true"/>}
              <button type="button" className="pipeline-card-name" onClick={() => onOpen(o.id)}>{o.name}</button>
            </div>
            {c.accountName && <span className="pipeline-meta"><Building2 size={13}/>{c.accountName}</span>}
            <div className="pipeline-card-facts">
              {Number(o.amount) > 0 && <b dir="ltr">{amount(o.amount, o.currencyCode, true)}</b>}
              {o.expectedCloseDate && <span className={late ? "is-late" : ""} title={late ? l.late : undefined}><CalendarClock size={13}/>{day(o.expectedCloseDate, ar)}</span>}
              {!c.mine && c.ownerName && <span title={l.owner}><UserRound size={13}/>{c.ownerName}</span>}
            </div>
            {col.kind === "OPEN" && <label className="pipeline-move"><span className="sr-only">{l.move}</span>
              <select aria-label={`${l.move}: ${o.name}`} value="" onChange={e => {
                const target = columns.find(x => x.key === e.target.value);
                if (target) void move(c, target);
              }}><option value="">{l.move}…</option>{columns.filter(x => x.key !== col.key).map(x => <option key={x.key} value={x.key}>{x.title}</option>)}</select></label>}
          </li>; })}
          {col.cards.length === 0 && <li className="pipeline-empty">{l.empty}</li>}
        </ol>
      </section>; })}
    </div>}
  </div>;
}
