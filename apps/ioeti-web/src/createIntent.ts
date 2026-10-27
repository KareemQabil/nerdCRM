import { useEffect, useRef } from "react";
/**
 * "+ New" from anywhere: the top bar records what the person wants to create and opens that page, which opens its own
 * create form once it is on screen. Session storage only carries the intent across the page change; nothing is created
 * until the person fills the form, and the server checks the create as always.
 */
export type CreateKind = "lead" | "account" | "opportunity" | "calendar" | "visit";
const KEY = "ioeti.create";

export function requestCreate(kind: CreateKind, page: string) {
  try { sessionStorage.setItem(KEY, kind); } catch { /* the page simply opens without its form */ }
  if (window.location.hash === "#/" + page) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else window.location.hash = "#/" + page;
  window.dispatchEvent(new CustomEvent("ioeti:create", { detail: kind }));
}

/** True once when the person asked to create this kind of record; the request is used up. */
export function takeCreate(kind: CreateKind): boolean {
  try {
    if (sessionStorage.getItem(KEY) !== kind) return false;
    sessionStorage.removeItem(KEY);
    return true;
  } catch { return false; }
}

/** Opens the page's create form when "+ New" asked for it: on arrival, or while the page is already open. */
export function useCreateIntent(kind: CreateKind, open: () => void) {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    if (takeCreate(kind)) latest.current();
    const on = (e: Event) => { if ((e as CustomEvent).detail === kind && takeCreate(kind)) latest.current(); };
    window.addEventListener("ioeti:create", on);
    return () => window.removeEventListener("ioeti:create", on);
  }, [kind]);
}
