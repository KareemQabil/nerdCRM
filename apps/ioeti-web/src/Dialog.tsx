import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Centered dialog for small, bounded actions (docs/design/RECORD_INTERACTION_RULES.md): focus moves in
 * and is trapped, Escape and the backdrop close it unless a save is running, and focus returns to
 * whatever opened it.
 */
export function Dialog({ title, description, kicker, busy, onClose, footer, children, wide }: {
  title: string; description?: string; kicker?: string; busy?: boolean; onClose: () => void; footer?: ReactNode; children: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useRef("dlg-" + Math.random().toString(36).slice(2)).current;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input:not([readonly]):not([disabled]), select, textarea, button.btn-primary");
    (first || ref.current)?.focus();
    return () => opener?.focus?.();
  }, []);
  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") { event.stopPropagation(); if (!busy) onClose(); return; }
    if (event.key !== "Tab" || !ref.current) return;
    const focusable = Array.from(ref.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(node => node.getClientRects().length > 0);
    if (!focusable.length) { event.preventDefault(); ref.current.focus(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  return <div className="drawer-overlay action-modal-overlay" onMouseDown={e => { if (!busy && e.target === e.currentTarget) onClose(); }}>
    <section ref={ref} className={"action-modal" + (wide ? " action-modal-wide" : "")} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="drawer-header"><div className="detail-kicker">{kicker}</div>
        <button type="button" className="icon-button" aria-label="×" disabled={busy} onClick={onClose}><X size={18}/></button></header>
      <div className="drawer-body"><h2 id={titleId}>{title}</h2>{description && <p>{description}</p>}{children}</div>
      {footer && <footer className="drawer-footer drawer-actions">{footer}</footer>}
    </section>
  </div>;
}

/** Choose several items as removable chips plus a filtered picker; keyboard friendly. */
export function ChipPicker<T>({ label, items, selected, keyOf, labelOf, onChange, placeholder, emptyText }: {
  label: string; items: T[]; selected: T[]; keyOf: (item: T) => string | number; labelOf: (item: T) => string;
  onChange: (next: T[]) => void; placeholder: string; emptyText?: string;
}) {
  const chosen = new Set(selected.map(keyOf));
  const rest = items.filter(item => !chosen.has(keyOf(item)));
  return <div className="chip-picker">
    <span className="chip-picker-label">{label}</span>
    <div className="chip-row">
      {selected.length === 0 && <span className="chip-empty">{emptyText}</span>}
      {selected.map(item => <span key={keyOf(item)} className="chip">{labelOf(item)}
        <button type="button" aria-label={`× ${labelOf(item)}`} onClick={() => onChange(selected.filter(s => keyOf(s) !== keyOf(item)))}><X size={13}/></button></span>)}
    </div>
    {rest.length > 0 && <select aria-label={placeholder} value="" onChange={e => {
      const next = rest.find(item => String(keyOf(item)) === e.target.value);
      if (next) onChange([...selected, next]);
    }}><option value="">{placeholder}</option>{rest.map(item => <option key={keyOf(item)} value={String(keyOf(item))}>{labelOf(item)}</option>)}</select>}
  </div>;
}

/** Copies text; falls back to selecting it when the clipboard is refused. */
export async function copyText(text: string, fallback?: HTMLInputElement | null): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { fallback?.select(); return false; }
}
