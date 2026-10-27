/**
 * One total split into its outcomes (for example the leads that are still open, converted or lost) as a single stacked bar.
 * Every segment is named in the legend with its count and share, so colour never carries the meaning alone; hovering a
 * segment repeats the same words. The figures come from the server; nothing here is estimated.
 *
 * Colours (validated for colour-blind separation on the light and dark surfaces): open = blue, converted = green,
 * lost = red, in that fixed order.
 */
export type Outcome = { key: "open" | "converted" | "lost"; label: string; value: number };

/** `captioned` shows the title above the bar, where no heading names it already. */
export function OutcomeBar({ title, outcomes, captioned }: { title: string; outcomes: Outcome[]; captioned?: boolean }) {
  const total = outcomes.reduce((sum, o) => sum + o.value, 0);
  const share = (value: number) => total === 0 ? 0 : Math.round(value * 100 / total);
  const summary = title + ": " + outcomes.map(o => `${o.label} ${o.value} (${share(o.value)}%)`).join("، ");
  return <figure className={"outcome-bar" + (captioned ? " is-captioned" : "")}>
    {captioned && <span className="outcome-title">{title}</span>}
    <div className="outcome-track" role="img" aria-label={summary}>
      {total === 0 ? <span className="outcome-empty"/> : outcomes.filter(o => o.value > 0).map(o =>
        <span key={o.key} className={"outcome-seg is-" + o.key} style={{ flexGrow: o.value }} title={`${o.label}: ${o.value} (${share(o.value)}%)`}/>)}
    </div>
    <figcaption className="outcome-legend">{outcomes.map(o => <span key={o.key} className="outcome-key">
      <i className={"outcome-dot is-" + o.key} aria-hidden="true"/>{o.label}<strong dir="ltr">{o.value}</strong><small dir="ltr">{share(o.value)}%</small>
    </span>)}</figcaption>
  </figure>;
}
