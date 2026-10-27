import { ApiError, wrapped } from "./api";
import { DEMO_MODE } from "./demo";

/** Quality issues and corrective actions (capability map) on the native quality improvement; the server checks permissions on every call. */
export type Gravity = "CRITICAL" | "MAJOR" | "MINOR";
export type StatusKind = "OPEN" | "CLOSED" | "CANCELLED";
export type Effectiveness = "NOT_CHECKED" | "EFFECTIVE" | "NOT_EFFECTIVE";
export type QualityIssue = {
  id: number; version: number; reference: string | null; title: string | null; gravity: Gravity | null; statusId: number | null; statusName: string | null;
  statusKind: StatusKind; detection: string | null; origin: "INTERNAL" | "CUSTOMER" | "SUPPLIER" | null; issueType: string | null;
  accountId: number | null; accountName: string | null; projectId: number | null; projectName: string | null; ownerId: number | null; ownerName: string | null;
  mine: boolean; raisedAt: string | null; raisedByName: string | null; dueDate: string | null; progress: number; openActions: number; overdueActions: number;
  effectiveness: Effectiveness;
};
export type CorrectiveAction = {
  id: number; version: number; title: string; ownerId: number | null; ownerName: string | null; mine: boolean; due: string | null; type: string | null;
  status: "OPEN" | "DONE" | "CANCELLED"; overdue: boolean; doneAt: string | null; outcome: string | null;
};
export type QualityDetail = {
  issue: QualityIssue; details: string | null; objective: string | null; criteria: string | null; earliest: string | null;
  check: string | null; checkedByName: string | null; checkedAt: string | null; actions: CorrectiveAction[];
};
export type Choice = { id: number; name: string; kind: string | null };
export type QualityOptions = {
  ready: boolean; missing: ("COMPANY" | "STATUSES" | "DETECTIONS" | "ISSUE_TYPES")[];
  statuses: Choice[]; detections: Choice[]; issueTypes: Choice[]; actionTypes: Choice[];
};

const BASE = "/ws/ioeti/quality";
const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; } };
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
async function list<T>(url: string): Promise<T[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<T[]>(url);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid response");
  return values;
}
const id = (n: number) => encodeURIComponent(n);
export const getIssues = (state: "open" | "closed" | "all", mine: boolean) => list<QualityIssue>(`${BASE}?state=${state}${mine ? "&mine=true" : ""}`);
export const getIssue = (n: number) => wrapped<QualityDetail>(`${BASE}/${id(n)}`);
export const getQualityOptions = () => wrapped<QualityOptions>(`${BASE}/options`);
export const getQualityPeople = () => list<Choice>(`${BASE}/people`);
export const raiseIssue = (input: { title: string; details?: string; detectionId: number; issueTypeId: number; gravity: Gravity; accountId?: number; projectId?: number }) =>
  wrapped<QualityDetail>(BASE, json({ ...input, zone: zone() }));
export const planIssue = (n: number, version: number, input: { ownerId: number; objective?: string; criteria?: string; earliest?: string; latest?: string }) =>
  wrapped<QualityDetail>(`${BASE}/${id(n)}/plan`, json({ version, ...input }));
export const moveIssue = (n: number, version: number, statusId: number) => wrapped<QualityDetail>(`${BASE}/${id(n)}/status`, json({ version, statusId }));
export const checkEffectiveness = (n: number, version: number, effective: boolean, check: string) =>
  wrapped<QualityDetail>(`${BASE}/${id(n)}/effectiveness`, json({ version, effective, check, zone: zone() }));
export const addAction = (n: number, version: number, input: { title: string; ownerId: number; due?: string; typeId?: number }) =>
  wrapped<QualityDetail>(`${BASE}/${id(n)}/actions`, json({ version, ...input }));
export const actOn = (n: number, action: CorrectiveAction, command: "done" | "reopen" | "cancel", outcome?: string) =>
  wrapped<QualityDetail>(`${BASE}/${id(n)}/actions/${id(action.id)}/${command}`, json({ version: action.version, outcome, zone: zone() }));
