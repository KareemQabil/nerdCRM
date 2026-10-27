import { ApiError, wrapped } from "./api";
import { DEMO_MODE } from "./demo";

/** Wave 5: handover from sales to operations and the engagements it creates (ioeti-operations). */
export type HandoverStatus = "SUBMITTED" | "REWORK_REQUESTED" | "ACCEPTED" | "REJECTED";
export type Reason = "MISSING_SCOPE" | "MISSING_DOCUMENTS" | "NO_CAPACITY" | "CLIENT_NOT_READY" | "OTHER";
export type Requirement = { id: number; version: number; businessLineCode: string; title: string; mandatory: boolean; sequence: number | null };
export type HandoverItem = {
  id: number; version: number; title: string; mandatory: boolean; done: boolean; doneBy: string | null; doneAt: string | null; evidenceReference: string | null;
};
export type Handover = {
  id: number; version: number; contractId: number; contractReference: string | null; contractName: string | null; clientId: number | null;
  clientName: string | null; businessLineCode: string; status: HandoverStatus; requestedBy: string | null; reviewedBy: string | null;
  operationsLead: string | null; submittedAt: string | null; decidedAt: string | null; engagementId: number | null; items: HandoverItem[];
  missingRequired: number; requestedByMe: boolean;
};
export type HandoverEvent = {
  id: number; kind: string; reason: Reason | null; actorName: string | null; at: string; fromUser: string | null; toUser: string | null; itemTitle: string | null;
};
export type Engagement = {
  id: number; version: number; code: string; name: string; clientId: number | null; clientName: string | null; leadName: string | null;
  teamName: string | null; handoverId: number; contractReference: string | null; businessLineCode: string; startedAt: string | null;
  tasks: number; tasksDone: number; tasksOverdue: number; progress: number; ledByMe: boolean;
};
export type Task = { id: number; version: number; name: string; dueDate: string | null; assigneeName: string | null; status: string | null; done: boolean; overdue: boolean };
export type ContractOption = { id: number; reference: string | null; name: string | null; clientName: string | null };
export type Person = { id: number; name: string };

const BASE = "/ws/ioeti/operations";
async function list<T>(path: string): Promise<T[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<T[]>(BASE + path);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid operations response");
  return values;
}
async function send<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode is read-only");
  return wrapped<T>(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
const id = (value: number) => encodeURIComponent(value);

export const getRequirements = (businessLine?: string) => list<Requirement>("/requirements" + (businessLine ? "?businessLine=" + encodeURIComponent(businessLine) : ""));
export const addRequirement = (body: { businessLineCode: string; title: string; mandatory: boolean; sequence?: number }) => send<Requirement>("/requirements", body);
export const retireRequirement = (reqId: number, version: number) => send<Requirement>(`/requirements/${id(reqId)}/retire`, { version });
export const getHandovers = (status?: HandoverStatus) => list<Handover>("/handovers" + (status ? "?status=" + status : ""));
export const getHandover = (handoverId: number) => wrapped<Handover>(`${BASE}/handovers/${id(handoverId)}`);
export const getReadyContracts = () => list<ContractOption>("/ready-contracts");
export const requestHandover = (contractId: number) => send<Handover>("/handovers", { contractId });
export const completeItem = (itemId: number, version: number, evidenceReference?: string) =>
  send<Handover>(`/items/${id(itemId)}/complete`, { version, ...(evidenceReference ? { evidenceReference } : {}) });
export const sendBack = (handoverId: number, version: number, reason: Reason) => send<Handover>(`/handovers/${id(handoverId)}/rework`, { version, reason });
export const resubmit = (handoverId: number, version: number) => send<Handover>(`/handovers/${id(handoverId)}/resubmit`, { version });
export const reject = (handoverId: number, version: number, reason: Reason) => send<Handover>(`/handovers/${id(handoverId)}/reject`, { version, reason });
export const accept = (handoverId: number, version: number, operationsLeadId: number, startDate: string) =>
  send<Engagement>(`/handovers/${id(handoverId)}/accept`, { version, operationsLeadId, startDate });
export const getEvents = (handoverId: number) => list<HandoverEvent>(`/handovers/${id(handoverId)}/events`);
export const getPeople = () => list<Person>("/people");
export const getEngagements = (mine?: boolean) => list<Engagement>("/engagements" + (mine ? "?mine=true" : ""));
export const getEngagement = (engagementId: number) => wrapped<Engagement>(`${BASE}/engagements/${id(engagementId)}`);
export const getTasks = (engagementId: number) => list<Task>(`/engagements/${id(engagementId)}/tasks`);
export const addTask = (engagementId: number, version: number, body: { name: string; dueDate?: string; assigneeId?: number }) =>
  send<Task>(`/engagements/${id(engagementId)}/tasks`, { version, ...body });
export const completeTask = (taskId: number, version: number) => send<Task>(`/tasks/${id(taskId)}/complete`, { version });
export const transfer = (engagementId: number, version: number, userId: number) => send<Engagement>(`/engagements/${id(engagementId)}/owner`, { version, userId });
