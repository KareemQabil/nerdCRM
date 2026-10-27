import { useEffect, useRef, useState } from "react";
import { Briefcase, Building2, CornerDownLeft, LayoutGrid, MapPin, Search, ShieldAlert, UserRound, X } from "lucide-react";
import { problem, recordHref, searchEverything, type SearchHit } from "./dailyApi";
import type { Language } from "./preferences";
import "./daily.css";

const L = {
  ar: {
    placeholder: "ابحث عن عميل محتمل أو حساب أو فرصة أو زيارة أو مشكلة جودة…", hint: "اكتب حرفين على الأقل. الهمزات والتاء المربوطة مش فارقة.",
    none: "مفيش نتائج تقدر توصلها.", searching: "جاري البحث…", types: { LEAD: "عميل محتمل", ACCOUNT: "حساب", OPPORTUNITY: "فرصة", VISIT: "زيارة ميدانية", QUALITY: "مشكلة جودة" },
    keys: "↑↓ للتنقل · Enter للفتح · Esc للإغلاق", close: "إغلاق", page: "صفحة",
  },
  en: {
    placeholder: "Search leads, accounts, opportunities, visits and quality issues…", hint: "Type at least two characters. Arabic spelling variants match.",
    none: "No results you can open.", searching: "Searching…", types: { LEAD: "Lead", ACCOUNT: "Account", OPPORTUNITY: "Opportunity", VISIT: "Field visit", QUALITY: "Quality issue" },
    keys: "↑↓ to move · Enter to open · Esc to close", close: "Close", page: "Page",
  },
} as const;
const ICONS = { LEAD: UserRound, ACCOUNT: Building2, OPPORTUNITY: Briefcase, VISIT: MapPin, QUALITY: ShieldAlert } as const;

export type PalettePage = { id: string; label: string; group: string };
type Option = { kind: "page"; page: PalettePage } | { kind: "record"; hit: SearchHit };

/** Arabic spelling variants that should not stop a match: hamza forms, taa marbuta, alef maqsura, diacritics. */
export function fold(text: string): string {
  return text.toLocaleLowerCase().normalize("NFKD").replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي").trim();
}

/** One search box (Ctrl/⌘ + K): the pages this person can open, then the records they may read. */
export function CommandPalette({ language, onClose, pages = [], onGo }: {
  language: Language; onClose: () => void; pages?: PalettePage[]; onGo?: (page: string) => void;
}) {
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
  useEffect(() => setActive(0), [q]);
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
  const folded = fold(q);
  const pageHits = folded.length < 2 || !onGo ? [] : pages.filter(p => fold(p.label).includes(folded) || fold(p.group).includes(folded)).slice(0, 5);
  const options: Option[] = [...pageHits.map(page => ({ kind: "page" as const, page })), ...hits.map(hit => ({ kind: "record" as const, hit }))];
  const optionId = (o: Option) => o.kind === "page" ? `page-${o.page.id}` : `hit-${o.hit.type}-${o.hit.id}`;
  function go(option: Option | undefined) {
    if (!option) return;
    if (option.kind === "page") { onClose(); onGo?.(option.page.id); return; }
    const href = recordHref(option.hit.type, option.hit.id);
    if (!href) return;
    onClose();
    window.location.hash = href.slice(1);
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(options.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); go(options[active]); }
    else if (e.key === "Tab") e.preventDefault(); // the input keeps focus; arrows move through results
  }
  const listId = "palette-results";
  return <div className="drawer-overlay palette-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="palette" role="dialog" aria-modal="true" aria-label={l.placeholder} onKeyDown={onKeyDown}>
      <div className="palette-input"><Search size={19}/>
        <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder={l.placeholder} maxLength={100} role="combobox"
          aria-expanded={options.length > 0} aria-controls={listId} aria-activedescendant={options[active] ? optionId(options[active]) : undefined} aria-autocomplete="list"/>
        <button type="button" className="icon-button" aria-label={l.close} onClick={onClose}><X size={17}/></button></div>
      <div className="palette-body">
        {q.trim().length < 2 ? <p className="palette-hint">{l.hint}</p>
          : error && pageHits.length === 0 ? <p className="daily-error" role="alert">{error}</p>
          : options.length === 0 ? <p className="palette-hint" role="status">{busy ? l.searching : l.none}</p>
          : <ul id={listId} role="listbox" className="palette-results">{options.map((option, i) => {
            const Icon = option.kind === "page" ? LayoutGrid : ICONS[option.hit.type];
            return <li key={optionId(option)} id={optionId(option)} role="option" aria-selected={i === active} className={i === active ? "is-active" : ""}
              onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); go(option); }}>
              <span className={"palette-icon is-" + (option.kind === "page" ? "page" : option.hit.type.toLowerCase())}><Icon size={16}/></span>
              {option.kind === "page"
                ? <span className="palette-text"><strong>{option.page.label}</strong><small>{option.page.group}</small></span>
                : <span className="palette-text"><strong>{option.hit.title}</strong>{option.hit.subtitle && <small dir="auto">{option.hit.subtitle}</small>}</span>}
              <span className="palette-type">{option.kind === "page" ? l.page : l.types[option.hit.type]}</span>
              {i === active && <CornerDownLeft size={14} className="palette-enter"/>}
            </li>; })}</ul>}
      </div>
      <footer className="palette-foot">{l.keys}</footer>
    </section>
  </div>;
}
