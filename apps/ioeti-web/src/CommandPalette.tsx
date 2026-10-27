import { useEffect, useRef, useState } from "react";
import { Briefcase, Building2, CornerDownLeft, MapPin, Search, ShieldAlert, UserRound, X } from "lucide-react";
import { problem, recordHref, searchEverything, type SearchHit } from "./dailyApi";
import type { Language } from "./preferences";
import "./daily.css";

const L = {
  ar: {
    placeholder: "ابحث عن عميل محتمل أو حساب أو فرصة أو زيارة أو مشكلة جودة…", hint: "اكتب حرفين على الأقل. الهمزات والتاء المربوطة مش فارقة.",
    none: "مفيش نتائج تقدر توصلها.", searching: "جاري البحث…", types: { LEAD: "عميل محتمل", ACCOUNT: "حساب", OPPORTUNITY: "فرصة", VISIT: "زيارة ميدانية", QUALITY: "مشكلة جودة" },
    keys: "↑↓ للتنقل · Enter للفتح · Esc للإغلاق", close: "إغلاق",
  },
  en: {
    placeholder: "Search leads, accounts, opportunities, visits and quality issues…", hint: "Type at least two characters. Arabic spelling variants match.",
    none: "No results you can open.", searching: "Searching…", types: { LEAD: "Lead", ACCOUNT: "Account", OPPORTUNITY: "Opportunity", VISIT: "Field visit", QUALITY: "Quality issue" },
    keys: "↑↓ to move · Enter to open · Esc to close", close: "Close",
  },
} as const;
const ICONS = { LEAD: UserRound, ACCOUNT: Building2, OPPORTUNITY: Briefcase, VISIT: MapPin, QUALITY: ShieldAlert } as const;

/** One search box for the records the caller may read (Ctrl/⌘ + K). */
export function CommandPalette({ language, onClose }: { language: Language; onClose: () => void }) {
  const l = L[language], ar = language === "ar";
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => opener?.focus?.();
  }, []);
  useEffect(() => {
    const value = q.trim();
    if (value.length < 2) { setHits([]); setError(""); setBusy(false); return; }
    let current = true;
    setBusy(true);
    const timer = window.setTimeout(() => void searchEverything(value)
      .then(rows => { if (current) { setHits(rows); setActive(0); setError(""); } })
      .catch(e => { if (current) { setHits([]); setError(problem(e, ar)); } })
      .finally(() => { if (current) setBusy(false); }), 220);
    return () => { current = false; window.clearTimeout(timer); };
  }, [q, ar]);
  function go(hit: SearchHit | undefined) {
    const href = hit && recordHref(hit.type, hit.id);
    if (!href) return;
    onClose();
    window.location.hash = href.slice(1);
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(hits.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); go(hits[active]); }
    else if (e.key === "Tab") e.preventDefault(); // the input keeps focus; arrows move through results
  }
  const listId = "palette-results";
  return <div className="drawer-overlay palette-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="palette" role="dialog" aria-modal="true" aria-label={l.placeholder} onKeyDown={onKeyDown}>
      <div className="palette-input"><Search size={19}/>
        <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder={l.placeholder} maxLength={100} role="combobox"
          aria-expanded={hits.length > 0} aria-controls={listId} aria-activedescendant={hits[active] ? `hit-${hits[active].type}-${hits[active].id}` : undefined} aria-autocomplete="list"/>
        <button type="button" className="icon-button" aria-label={l.close} onClick={onClose}><X size={17}/></button></div>
      <div className="palette-body">
        {q.trim().length < 2 ? <p className="palette-hint">{l.hint}</p>
          : busy && hits.length === 0 ? <p className="palette-hint" role="status">{l.searching}</p>
          : error ? <p className="daily-error" role="alert">{error}</p>
          : hits.length === 0 ? <p className="palette-hint" role="status">{l.none}</p>
          : <ul id={listId} role="listbox" className="palette-results">{hits.map((hit, i) => { const Icon = ICONS[hit.type];
            return <li key={hit.type + hit.id} id={`hit-${hit.type}-${hit.id}`} role="option" aria-selected={i === active} className={i === active ? "is-active" : ""}
              onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); go(hit); }}>
              <span className={"palette-icon is-" + hit.type.toLowerCase()}><Icon size={16}/></span>
              <span className="palette-text"><strong>{hit.title}</strong>{hit.subtitle && <small dir="auto">{hit.subtitle}</small>}</span>
              <span className="palette-type">{l.types[hit.type]}</span>
              {i === active && <CornerDownLeft size={14} className="palette-enter"/>}
            </li>; })}</ul>}
      </div>
      <footer className="palette-foot">{l.keys}</footer>
    </section>
  </div>;
}
