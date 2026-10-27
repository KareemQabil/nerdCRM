import type { Language } from "./preferences";

/** A local "YYYY-MM-DDTHH:mm" value, as a datetime-local input expects. */
export function localValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function at(daysAhead: number, hour: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** Tomorrow at ten, or the next working day when tomorrow is Friday or Saturday (Egypt's weekend). */
export function nextWorkingMorning(): Date {
  let d = at(1, 10);
  while (d.getDay() === 5 || d.getDay() === 6) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 10);
  return d;
}

/**
 * One-tap times for planning a follow-up, next to the date field: in an hour, tomorrow morning (the next working day),
 * in two days, next week (Sunday, the first working day). The field stays editable for any other time.
 */
export function WhenChips({ language, onPick }: { language: Language; onPick: (value: string) => void }) {
  const ar = language === "ar";
  const inHour = () => { const d = new Date(Date.now() + 60 * 60 * 1000); d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0); return d; };
  const nextWeek = () => { const d = at(1, 10); while (d.getDay() !== 0) d.setDate(d.getDate() + 1); return d; };
  const twoDays = () => { let d = at(2, 10); while (d.getDay() === 5 || d.getDay() === 6) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 10); return d; };
  const chips: [string, () => Date][] = [
    [ar ? "بعد ساعة" : "In an hour", inHour],
    [ar ? "بكرة الصبح" : "Tomorrow morning", nextWorkingMorning],
    [ar ? "بعد يومين" : "In two days", twoDays],
    [ar ? "الأسبوع الجاي" : "Next week", nextWeek],
  ];
  return <div className="when-chips" role="group" aria-label={ar ? "مواعيد سريعة" : "Quick times"}>
    {chips.map(([label, make]) => <button key={label} type="button" className="when-chip" onClick={() => onPick(localValue(make()))}>{label}</button>)}
  </div>;
}
