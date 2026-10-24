import { ApiError, wrapped, type AccountSummary, type ContactSummary, type LeadSummary, type Opportunity } from "./api";
import { DEMO_MODE } from "./demo";

/** Daily work (journeys plan, phase 2): edit leads, add accounts and contacts, move opportunities through
 * their stages, log and plan activities, the personal agenda and one search box. Every call goes to the
 * IOETI API, which checks the caller's rights and the record version; nothing here decides access. */

export type StageKind = "OPEN" | "WON" | "LOST";
export type OpportunityStage = { id: number; name: string; kind: StageKind };
export type OpportunityPlan = Opportunity;
export type ActivityKind = "CALL" | "MEETING" | "TASK" | "NOTE";
export type RecordType = "LEAD" | "ACCOUNT" | "OPPORTUNITY";
export type Activity = {
  id: number; version: number; kind: ActivityKind; status: "PLANNED" | "DONE" | "CANCELED"; subject: string; at: string | null;
  ownerName: string | null; mine: boolean; outcomeRecorded: boolean;
};
export type AgendaItem = {
  type: "ACTIVITY" | "SESSION" | "AUDIT" | "INTERVIEW" | "VISIT"; id: number; title: string | null; at: string | null; endsAt: string | null;
  kind: ActivityKind | null; status: string | null; recordType: string | null; recordId: number | null;
};
export type SearchHit = { type: RecordType; id: number; title: string; subtitle: string | null };
export type AccountInput = { name: string; website?: string; phone?: string; email?: string; confirmNotDuplicate?: boolean };
export type ContactInput = { firstName?: string; name: string; phone?: string; email?: string };
export type LeadEdit = {
  firstName?: string; name?: string; organization?: string; email?: string; phone?: string; businessLineCode?: string; confirmNotDuplicate?: boolean;
};

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const id = (value: number) => encodeURIComponent(value);
function post<T>(url: string, body: unknown): Promise<T> {
  if (DEMO_MODE) return Promise.reject(new ApiError(403, "Preview mode is read-only"));
  return wrapped<T>(url, json(body));
}
async function list<T>(url: string): Promise<T[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<T[]>(url);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid response");
  return values;
}

// leads
export const editLead = (leadId: number, version: number, change: LeadEdit) =>
  post<LeadSummary>(`/ws/ioeti/marketing/leads/${id(leadId)}`, { version, ...change });

// accounts and contacts
export const createAccount = (input: AccountInput) => post<AccountSummary & { version: number }>("/ws/ioeti/accounts", input);
export const similarAccounts = (name: string) => post<AccountSummary[]>("/ws/ioeti/accounts/similar", { name });
export const editAccount = (accountId: number, version: number, change: Partial<AccountInput>) =>
  post<AccountSummary & { version: number }>(`/ws/ioeti/accounts/${id(accountId)}`, { version, ...change });
export const addContact = (accountId: number, version: number, contact: ContactInput) =>
  post<ContactSummary>(`/ws/ioeti/accounts/${id(accountId)}/contacts`, { version, ...contact });

// opportunity stages and plan
export const getOpportunityStages = () => list<OpportunityStage>("/ws/ioeti/opportunities/stages");
export const moveOpportunity = (oppId: number, version: number, stageId: number) =>
  post<OpportunityPlan>(`/ws/ioeti/opportunities/${id(oppId)}/stage`, { version, stageId });
export const loseOpportunity = (oppId: number, version: number, lostReasonId: number, note: string) =>
  post<OpportunityPlan>(`/ws/ioeti/opportunities/${id(oppId)}/lose`, { version, lostReasonId, note: note || undefined });
export const reopenOpportunity = (oppId: number, version: number) =>
  post<OpportunityPlan>(`/ws/ioeti/opportunities/${id(oppId)}/reopen`, { version });
export const planOpportunity = (oppId: number, version: number, plan: {
  amount?: string | null; currencyCode?: string | null; expectedCloseDate?: string | null; probability?: string | null;
}) => post<OpportunityPlan>(`/ws/ioeti/opportunities/${id(oppId)}/plan`, { version, ...plan });

// activities, agenda, search
export const getActivities = (record: RecordType, recordId: number) =>
  list<Activity>(`/ws/ioeti/workspace/activities?record=${record}&recordId=${id(recordId)}`);
export const logActivity = (input: {
  record: RecordType; recordId: number; version: number; kind: ActivityKind; subject: string; at?: string; outcome?: string; planned: boolean;
}) => post<Activity>("/ws/ioeti/workspace/activities", { ...input, zone: browserZone() });
/** The browser's IANA time zone, so the server judges "already happened" on the person's own clock. */
function browserZone(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
}
export const getAgenda = (from: string, to: string) =>
  list<AgendaItem>(`/ws/ioeti/workspace/agenda?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
export const searchEverything = (q: string) => list<SearchHit>(`/ws/ioeti/workspace/search?q=${encodeURIComponent(q)}`);

/** Where a record opens in the web app. */
export function recordHref(type: string | null, recordId: number | null): string | null {
  if (recordId == null) return null;
  switch (type) {
    case "LEAD": return `#/leads/${recordId}`;
    case "ACCOUNT": return `#/accounts/${recordId}`;
    case "OPPORTUNITY": return `#/opportunities/${recordId}`;
    case "CYCLE": return `#/certification/${recordId}`;
    case "JOB_ORDER": return `#/recruitment/orders/${recordId}`;
    case "COHORT": return `#/training`;
    case "VISIT": return `#/visits/${recordId}`;
    default: return null;
  }
}

/** A local date-time for <input type="datetime-local"> and the API (no seconds, no zone). */
export function localDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function localDate(date: Date): string { return localDateTime(date).slice(0, 10); }
/** The server's date-times are wall-clock times (Axelor serialises LocalDateTime with a trailing "Z" that
 * does not mean UTC): read the digits as local time, as the other screens do. */
export function wallClock(value: string | null | undefined): Date | null {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)) : null;
}

/** Field and conflict errors in the caller's language. */
export function problem(error: unknown, ar: boolean): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : String(error);
  if (error.statusCode === 409 && error.code === "POSSIBLE_DUPLICATE") return ar ? "يوجد سجل مشابه. راجعه أو أكّد أنه مختلف." : "A similar record exists. Check it or confirm this one is different.";
  if (error.statusCode === 409) return ar ? "السجل اتغير من شخص تاني. حدّث الصفحة وحاول تاني." : "Someone else changed this record. Refresh and try again.";
  if (error.statusCode === 403) return ar ? "ليس لديك صلاحية لهذا الإجراء." : "You do not have permission for this.";
  if (error.statusCode === 404) return ar ? "السجل غير موجود أو غير متاح لك." : "The record does not exist or is not available to you.";
  if (error.code === "BLOCKED_BY_POLICY") return ar ? "الإجراء ده موقوف لحين اعتماد سياسة الشركة." : "This action waits for a company policy decision.";
  const field = error.fields?.[0];
  if (field) {
    const names: Record<string, [string, string]> = {
      email: ["البريد الإلكتروني", "E-mail"], phone: ["الهاتف", "Phone"], name: ["الاسم", "Name"], amount: ["القيمة", "Amount"],
      probability: ["الاحتمال", "Probability"], currencyCode: ["العملة", "Currency"], expectedCloseDate: ["تاريخ الإغلاق", "Close date"],
      at: ["الوقت", "Time"], subject: ["الموضوع", "Subject"], lostReasonId: ["سبب الخسارة", "Lost reason"], website: ["الموقع", "Website"],
    };
    const codes: Record<string, [string, string]> = {
      REQUIRED: ["مطلوب", "is required"], FORMAT: ["صيغته غير صحيحة", "has the wrong format"], RANGE: ["خارج المدى المسموح", "is out of range"],
      UNKNOWN: ["غير معروف", "is unknown"], TOO_LONG: ["أطول من المسموح", "is too long"], FUTURE: ["لا يمكن أن يكون في المستقبل لنشاط تم", "cannot be in the future for something done"],
      PAST: ["لا يمكن أن يكون في الماضي لنشاط مخطط", "cannot be in the past for something planned"], TOO_SHORT: ["قصير جدًا", "is too short"],
    };
    const n = names[field.field]?.[ar ? 0 : 1] ?? field.field;
    const c = codes[field.code]?.[ar ? 0 : 1] ?? field.code;
    return `${n}: ${c}`;
  }
  return error.message;
}
