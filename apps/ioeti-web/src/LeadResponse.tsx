import { AlarmClock, CircleCheck, CircleDashed, Clock3 } from "lucide-react";
import type { LeadResponse } from "./api";

/**
 * D-12 (signed 2026-10-25): where a lead stands against its response targets, counted in working hours. The figures come
 * from the server (the owners' targets and working hours as they were when the lead arrived); nothing here estimates.
 */
const T = {
  ar: { NOT_SET: "مفيش هدف رد", DUE: "مستني أول تواصل", OVERDUE: "متأخر", MET: "اتواصلنا في الميعاد", LATE: "اتواصلنا متأخر", CLOSED: "اتقفل",
    dueAt: "أول تواصل قبل", contactedAt: "أول تواصل", qualification: "التأهيل", qualifyDueAt: "التأهيل قبل", qualifiedAt: "اتأهل",
    missing: { CALENDAR: "مواعيد العمل مش مضبوطة", TARGET: "مفيش هدف رد لخط الأعمال ده" } as Record<string, string>,
    q: { DUE: "مستني", OVERDUE: "متأخر", MET: "في الميعاد", LATE: "متأخر", CLOSED: "اتقفل" } as Record<string, string>,
    note: "مواعيد الرد بتتحسب بساعات العمل من وقت وصول الـ lead. لو الميعاد فات، مدير الخط بيوصله إشعار داخلي. مفيش إعادة توزيع تلقائي." },
  en: { NOT_SET: "No response target", DUE: "Awaiting first contact", OVERDUE: "Overdue", MET: "Contacted on time", LATE: "Contacted late", CLOSED: "Closed",
    dueAt: "First contact by", contactedAt: "First contact", qualification: "Qualification", qualifyDueAt: "Qualify by", qualifiedAt: "Qualified",
    missing: { CALENDAR: "Working hours are not set", TARGET: "No response target for this line" } as Record<string, string>,
    q: { DUE: "Pending", OVERDUE: "Overdue", MET: "On time", LATE: "Late", CLOSED: "Closed" } as Record<string, string>,
    note: "Response targets are counted in working hours from when the lead arrived. When one is missed, the line's manager gets an in-app notice. Nothing is reassigned automatically." },
};
const tone: Record<string, string> = { NOT_SET: "kind-none", DUE: "kind-open", OVERDUE: "kind-lost", MET: "kind-won", LATE: "kind-late", CLOSED: "kind-none" };
const when = (value: string | null | undefined, ar: boolean) =>
  value ? new Date(value.replace(/Z$/, "")).toLocaleString(ar ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";

export function ResponseChip({ response, ar }: { response?: LeadResponse | null; ar: boolean }) {
  if (!response) return <>—</>;
  const t = T[ar ? "ar" : "en"];
  const Icon = response.status === "OVERDUE" ? AlarmClock : response.status === "MET" ? CircleCheck : response.status === "NOT_SET" || response.status === "CLOSED" ? CircleDashed : Clock3;
  return <span className={"stage-chip response-chip " + (tone[response.status] ?? "kind-none")}
    title={response.status === "NOT_SET" ? t.missing[response.missing ?? ""] : response.dueAt ? `${t.dueAt} ${when(response.dueAt, ar)}` : undefined}>
    <Icon size={13} aria-hidden="true"/>{t[response.status as keyof typeof t] as string ?? response.status}</span>;
}

/** The lead record's response block: the targets, when they were met, and how the clock works. */
export function ResponseDetails({ response, ar }: { response?: LeadResponse | null; ar: boolean }) {
  if (!response) return null;
  const t = T[ar ? "ar" : "en"];
  return <>
    <div><dt>{ar ? "زمن الاستجابة" : "Response"}</dt><dd><ResponseChip response={response} ar={ar}/>
      {response.status === "NOT_SET" && response.missing && <small className="response-missing">{t.missing[response.missing]}</small>}</dd></div>
    {response.dueAt && <div><dt>{t.dueAt}</dt><dd><bdi>{when(response.dueAt, ar)}</bdi></dd></div>}
    {response.contactedAt && <div><dt>{t.contactedAt}</dt><dd><bdi>{when(response.contactedAt, ar)}</bdi></dd></div>}
    {response.qualification && <div><dt>{t.qualification}</dt><dd>
      <span className={"stage-chip " + (tone[response.qualification] ?? "kind-none")}>{t.q[response.qualification] ?? response.qualification}</span>
      {response.qualifiedAt ? <small> {t.qualifiedAt}: <bdi>{when(response.qualifiedAt, ar)}</bdi></small>
        : response.qualifyDueAt && <small> {t.qualifyDueAt}: <bdi>{when(response.qualifyDueAt, ar)}</bdi></small>}</dd></div>}
  </>;
}

export const responseNote = (ar: boolean) => T[ar ? "ar" : "en"].note;
