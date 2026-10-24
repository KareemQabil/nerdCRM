import { ApiError, wrapped } from "./api";
import { DEMO_MODE } from "./demo";

/** Field visits (capability map) on the native intervention; the server checks permissions on every call. */
export type VisitStatus = "TO_PLAN" | "PLANNED" | "STARTED" | "SUSPENDED" | "FINISHED" | "CANCELLED";
export type Visit = {
  id: number; version: number; reference: string | null; status: VisitStatus; purpose: string | null; accountId: number | null; accountName: string | null;
  type: string | null; assigneeId: number | null; assigneeName: string | null; mine: boolean; plannedStart: string | null; plannedEnd: string | null;
  startedAt: string | null; finishedAt: string | null; durationSeconds: number | null; opportunityId: number | null; contractId: number | null;
};
export type VisitNote = { id: number; text: string; at: string; authorName: string | null; mine: boolean };
export type Option = { id: number; name: string };
export type VisitCommand = "start" | "suspend" | "finish" | "cancel";
/** Mirrors the server's rule so the screen offers only possible actions; the server still decides. */
export const VISIT_ACTIONS: Record<VisitStatus, (VisitCommand | "plan")[]> = {
  TO_PLAN: ["plan", "cancel"], PLANNED: ["start", "plan", "cancel"], STARTED: ["suspend", "finish"],
  SUSPENDED: ["start", "finish", "cancel"], FINISHED: [], CANCELLED: [],
};

const BASE = "/ws/ioeti/visits";
const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; } };
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
async function list<T>(url: string): Promise<T[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<T[]>(url);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid response");
  return values;
}
export const getVisits = (mine: boolean) => list<Visit>(`${BASE}${mine ? "?mine=true" : ""}`);
export const getVisit = (id: number) => wrapped<{ visit: Visit; log: VisitNote[] }>(`${BASE}/${encodeURIComponent(id)}`);
export const addVisit = (input: { accountId: number; purpose: string; typeId?: number; opportunityId?: number; assignedToId?: number; start?: string; end?: string }) =>
  wrapped<Visit>(BASE, json({ ...input, zone: zone() }));
export const planVisit = (id: number, version: number, assignedToId: number, start: string, end?: string) =>
  wrapped<Visit>(`${BASE}/${encodeURIComponent(id)}/plan`, json({ version, assignedToId, start, end: end || undefined, zone: zone() }));
export const runVisit = (id: number, version: number, command: VisitCommand) =>
  wrapped<Visit>(`${BASE}/${encodeURIComponent(id)}/${command}`, json({ version, zone: zone() }));
export const addVisitNote = (id: number, version: number, text: string) =>
  wrapped<VisitNote>(`${BASE}/${encodeURIComponent(id)}/notes`, json({ version, text, zone: zone() }));
export const getVisitTypes = () => list<Option>(`${BASE}/types`);
export const getVisitPeople = () => list<Option>(`${BASE}/people`);
