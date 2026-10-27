import { useEffect, useRef, useState } from "react";
import { Activity, Building2, CalendarPlus, MapPin, Plus, UserPlus } from "lucide-react";
import { requestCreate, type CreateKind } from "./createIntent";

/** The create actions a person can reach, in the order they are used most. Each opens its page's own form. */
export const CREATE_ACTIONS: { kind: CreateKind; page: string; icon: typeof Plus; ar: string; en: string; key: string }[] = [
  { kind: "lead", page: "leads", icon: UserPlus, ar: "عميل محتمل جديد", en: "New lead", key: "L" },
  { kind: "opportunity", page: "opportunities", icon: Activity, ar: "فرصة جديدة", en: "New opportunity", key: "O" },
  { kind: "account", page: "accounts", icon: Building2, ar: "حساب جديد", en: "New account", key: "A" },
  { kind: "calendar", page: "agenda", icon: CalendarPlus, ar: "موعد جديد", en: "New calendar item", key: "C" },
  { kind: "visit", page: "visits", icon: MapPin, ar: "زيارة ميدانية جديدة", en: "New field visit", key: "V" },
];

/** "+ New" in the top bar: one place to start any record, from any page. */
export function QuickCreate({ ar, canOpen }: { ar: boolean; canOpen: (page: string) => boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const actions = CREATE_ACTIONS.filter(a => canOpen(a.page));
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); root.current?.querySelector<HTMLButtonElement>(".quick-create-button")?.focus(); return; }
      const hit = actions.find(a => a.key === e.key.toUpperCase());
      if (hit && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); setOpen(false); requestCreate(hit.kind, hit.page); }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    window.setTimeout(() => root.current?.querySelector<HTMLButtonElement>(".quick-create-menu button")?.focus());
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", key); };
  }, [open, actions]);
  // "N" anywhere outside a field opens the menu
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key.toLowerCase() !== "n" || e.ctrlKey || e.metaKey || e.altKey || t?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      e.preventDefault(); setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!actions.length) return null;
  return <div className="quick-create" ref={root}>
    <button type="button" className="btn btn-primary quick-create-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}
      title={ar ? "إنشاء جديد (N)" : "Create (N)"}><Plus size={17}/><span>{ar ? "جديد" : "New"}</span></button>
    {open && <div className="quick-create-menu" role="menu" aria-label={ar ? "إنشاء جديد" : "Create"}>
      {actions.map(a => { const Icon = a.icon; return <button key={a.kind} type="button" role="menuitem" onClick={() => { setOpen(false); requestCreate(a.kind, a.page); }}
        onKeyDown={e => {
          const items = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
          const i = items.indexOf(e.currentTarget);
          if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
          if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
        }}>
        <Icon size={16} aria-hidden="true"/><span>{ar ? a.ar : a.en}</span><kbd dir="ltr">{a.key}</kbd></button>; })}
    </div>}
  </div>;
}
