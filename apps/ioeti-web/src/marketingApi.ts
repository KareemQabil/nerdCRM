import { ApiError, wrapped, type LeadSummary } from "./api";
import { DEMO_MODE } from "./demo";

/** Wave 6: lead intake with duplicate review, server-side filters, saved views, consent, attribution, follow-ups. */
export type Option = { id: number; name: string };
export type LeadQuery = { q?: string; stageId?: number; sourceId?: number; businessLine?: string; mine?: boolean };
export type LeadIntake = {
  firstName?: string; name: string; organization?: string; email?: string; phone?: string;
  businessLineCode?: string; sourceId?: number; campaignId?: number; confirmNotDuplicate?: boolean;
};
export type SavedView = { id: number; name: string; searchText: string | null; stageId: number | null; sourceId: number | null; businessLineCode: string | null; onlyMine: boolean };
export type Channel = "EMAIL" | "CALL";
export type ConsentMethod = "WRITTEN" | "EMAIL" | "WEB_FORM" | "PHONE" | "IN_PERSON";
export type ConsentEntry = { id: number; channel: Channel; allowed: boolean; method: ConsentMethod; evidenceReference: string | null; recordedBy: string | null; at: string };
export type ConsentState = { channels: { channel: Channel; allowed: boolean }[]; history: ConsentEntry[] };
export type Attribution = { sourceId: number | null; sourceName: string | null; campaigns: Option[] };
export type TimelineItem = { at: string | null; kind: string; label: string | null; status: string | null; actorName: string | null; eventId: number | null };
export type FollowUpType = "CALL" | "MEETING" | "TASK";
export type FollowUp = {
  id: number; version: number; type: FollowUpType | "OTHER"; subject: string; at: string | null; status: "PLANNED" | "DONE" | "CANCELLED" | null;
  overdue: boolean; leadId: number | null; leadName: string | null;
};

const BASE = "/ws/ioeti/marketing";
async function list<T>(url: string): Promise<T[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<T[]>(url);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid marketing response");
  return values;
}
async function post<T>(url: string, body: Record<string, unknown> = {}): Promise<T> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode is read-only");
  return wrapped<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
const id = (value: number) => encodeURIComponent(value);

export function searchLeads(query: LeadQuery, offset = 0, limit = 25): Promise<LeadSummary[]> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (query.q?.trim()) params.set("q", query.q.trim());
  if (query.stageId) params.set("stageId", String(query.stageId));
  if (query.sourceId) params.set("sourceId", String(query.sourceId));
  if (query.businessLine) params.set("businessLine", query.businessLine);
  if (query.mine) params.set("mine", "true");
  return list<LeadSummary>(`${BASE}/leads?${params}`);
}
export const getSources = () => list<Option>(`${BASE}/sources`);
export const getCampaigns = () => list<Option>(`${BASE}/campaigns`);
export const getSavedViews = () => list<SavedView>(`${BASE}/saved-views`);
export const saveView = (name: string, query: LeadQuery) => post<SavedView>(`${BASE}/saved-views`, {
  name, searchText: query.q || null, stageId: query.stageId ?? null, sourceId: query.sourceId ?? null,
  businessLineCode: query.businessLine || null, onlyMine: !!query.mine,
});
export const deleteView = (viewId: number) => post<SavedView>(`${BASE}/saved-views/${id(viewId)}/delete`);
export const findDuplicates = (intake: LeadIntake) => post<LeadSummary[]>(`${BASE}/leads/duplicates`, intake);
export const recordLead = (intake: LeadIntake) => post<LeadSummary>(`${BASE}/leads`, intake);
export const getConsents = async (leadId: number): Promise<ConsentState> =>
  DEMO_MODE ? { channels: [], history: [] } : wrapped<ConsentState>(`${BASE}/leads/${id(leadId)}/consents`);
export const recordConsent = (leadId: number, version: number, channel: Channel, allowed: boolean, method: ConsentMethod, evidenceReference: string) =>
  post<ConsentEntry>(`${BASE}/leads/${id(leadId)}/consents`, { version, channel, allowed, method, evidenceReference: evidenceReference || null });
export const getAttribution = (leadId: number) => wrapped<Attribution>(`${BASE}/leads/${id(leadId)}/attribution`);
export const attributeCampaign = (leadId: number, version: number, campaignId: number) =>
  post<Attribution>(`${BASE}/leads/${id(leadId)}/campaigns`, { version, campaignId });
export const getTimeline = (leadId: number) => list<TimelineItem>(`${BASE}/leads/${id(leadId)}/timeline`);
export const planFollowUp = (leadId: number, version: number, type: FollowUpType, subject: string, at: string) =>
  post<FollowUp>(`${BASE}/leads/${id(leadId)}/follow-ups`, { version, type, subject, at });
export const getFollowUps = (overdue: boolean) => list<FollowUp>(`${BASE}/follow-ups${overdue ? "?overdue=true" : ""}`);
export const markFollowUpDone = (followUpId: number, version: number) => post<FollowUp>(`${BASE}/follow-ups/${id(followUpId)}/done`, { version });
export const addSource = (name: string) => post<Option>(`${BASE}/sources`, { name });
