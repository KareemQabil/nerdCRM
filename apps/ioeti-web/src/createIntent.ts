import { useEffect, useRef } from "react";

/**
 * "+ New" from anywhere: the top bar (or a record, such as an account starting an opportunity) records what the person
 * wants to create and opens that page, which opens its own create form once it is on screen. Session storage only carries
 * the intent across the page change; nothing is created until the person fills the form, and the server checks the create.
 */
export type CreateKind = "lead" | "account" | "opportunity" | "calendar" | "visit";
/** What the form can start with, e.g. the account an opportunity is for. */
export type CreatePrefill = { accountId?: number; accountName?: string };
const KEY = "ioeti.create";

export function requestCreate(kind: CreateKind, page: string, prefill?: CreatePrefill) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ kind, prefill: prefill ?? null })); } catch { /* the page simply opens without its form */ }
  if (window.location.hash !== "#/" + page) window.location.hash = "#/" + page;
  window.dispatchEvent(new CustomEvent("ioeti:create", { detail: kind }));
}

/** The prefill (or {}) once when the person asked to create this kind of record; the request is used up. Null otherwise. */
export function takeCreate(kind: CreateKind): CreatePrefill | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const intent = JSON.parse(raw) as { kind: string; prefill: CreatePrefill | null };
    if (intent.kind !== kind) return null;
    sessionStorage.removeItem(KEY);
    return intent.prefill ?? {};
  } catch { return null; }
}

/** Opens the page's create form when "+ New" asked for it: on arrival, or while the page is already open. */
export function useCreateIntent(kind: CreateKind, open: (prefill: CreatePrefill) => void) {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    const first = takeCreate(kind);
    if (first) latest.current(first);
    const on = (e: Event) => { if ((e as CustomEvent).detail !== kind) return; const p = takeCreate(kind); if (p) latest.current(p); };
    window.addEventListener("ioeti:create", on);
    return () => window.removeEventListener("ioeti:create", on);
  }, [kind]);
}
