import { useEffect, useRef, useState } from "react";

export type Section = { id: string; label: string };

/**
 * A sticky row of links to the sections of a long record, marking the one in view. Plain anchors, so they work with the
 * keyboard; sections carry a scroll margin so the bar does not cover their heading.
 */
export function SectionNav({ sections, label }: { sections: Section[]; label: string }) {
  const [current, setCurrent] = useState(sections[0]?.id ?? "");
  const ids = sections.map(s => s.id).join(" ");
  // A chosen section stays marked while the page scrolls to it.
  const chosenUntil = useRef(0);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(entries => {
      for (const e of entries) visible.set(e.target.id, e.isIntersecting ? e.boundingClientRect.top : Infinity);
      if (Date.now() < chosenUntil.current) return;
      const shown = [...visible.entries()].filter(([, y]) => y !== Infinity).sort((a, b) => a[1] - b[1]);
      // At the bottom of the page the last sections cannot reach the top: the lowest one shown is current.
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      const pick = atEnd ? shown[shown.length - 1] : shown[0];
      if (pick) setCurrent(pick[0]);
    }, { rootMargin: "-96px 0px -55% 0px" });
    for (const id of ids.split(" ")) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids]);
  return <nav className="section-nav" aria-label={label}>
    {sections.map(s => <a key={s.id} href={"#" + s.id} aria-current={current === s.id ? "location" : undefined}
      onClick={e => {
        // Hash routing owns location.hash: scroll without changing it.
        e.preventDefault();
        document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
        chosenUntil.current = Date.now() + 1000;
        setCurrent(s.id);
      }}>{s.label}</a>)}
  </nav>;
}
