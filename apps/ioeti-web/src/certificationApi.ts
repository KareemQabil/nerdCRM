import { ApiError, wrapped } from "./api";
import { DEMO_MODE } from "./demo";

/** Wave 4b/4C: client ISO certification (ioeti-certification). Decisions and certificates wait for D-02. */
export type CyclePhase = "STAGE1_PENDING" | "STAGE2_PENDING" | "FINDINGS_OPEN" | "READY_FOR_DECISION";
export type DecisionBlocker = "STAGE1_NOT_COMPLETED" | "STAGE2_NOT_COMPLETED" | "OPEN_MAJOR_NONCONFORMITIES" | "POLICY_D02";
export type CertificationCycle = {
  id: number; version: number; reference: string; clientId: number | null; clientName: string | null; standardCode: string;
  scope: string | null; siteCount: number | null; openMajors: number; readyForDecision: boolean; decisionStatus: string;
  managedByMe: boolean; phase: CyclePhase; decisionBlockers: DecisionBlocker[]; managerName: string | null;
};
export type AuditType = "STAGE1" | "STAGE2";
export type CertificationAudit = {
  id: number; version: number; type: AuditType; plannedDate: string; auditorId: number; auditorName: string;
  status: "PLANNED" | "COMPLETED" | "CANCELLED"; completedOn: string | null;
};
export type NcGrade = "MAJOR" | "MINOR" | "OBSERVATION";
export type Nonconformity = {
  id: number; version: number; grade: NcGrade; clause: string | null; statement: string; clientResponse: string | null;
  status: "OPEN" | "RESPONDED" | "CLOSED"; raisedAt: string | null; respondedAt: string | null; closedAt: string | null;
};
export type Qualification = {
  id: number; auditorId: number; auditorName: string; standardCode: string; validFrom: string; validUntil: string;
  evidenceReference: string | null;
};
export type Person = { id: number; name: string };
export type TimelineEvent = {
  at: string | null; label: string; actorName: string | null;
  kind: "CYCLE_OPENED" | "AUDIT_PLANNED" | "AUDIT_COMPLETED" | "AUDIT_CANCELLED" | "NC_RAISED" | "NC_RESPONDED" | "NC_CLOSED";
};
export type CycleFilters = { q?: string; standardCode?: string; phase?: CyclePhase | ""; mine?: boolean; limit?: number; offset?: number };

const BASE = "/ws/ioeti/certification";
async function list<T>(path: string): Promise<T[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<T[]>(BASE + path);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid certification response");
  return values;
}
async function post<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode is read-only");
  return wrapped<T>(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
const id = (value: number) => encodeURIComponent(value);

export function getCycles(filters: CycleFilters = {}): Promise<CertificationCycle[]> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.standardCode) params.set("standardCode", filters.standardCode);
  if (filters.phase) params.set("phase", filters.phase);
  if (filters.mine) params.set("mine", "true");
  params.set("limit", String(filters.limit ?? 25));
  params.set("offset", String(filters.offset ?? 0));
  return list<CertificationCycle>("/cycles?" + params.toString());
}
export const getCycle = (cycleId: number) => wrapped<CertificationCycle>(`${BASE}/cycles/${id(cycleId)}`);
export const createCycle = (body: { reference: string; clientId: number; standardCode: string; scope: string; siteCount?: number }) =>
  post<CertificationCycle>("/cycles", body);
export const getAudits = (cycleId: number) => list<CertificationAudit>(`/cycles/${id(cycleId)}/audits`);
export const getEligibleAuditors = (cycleId: number, date: string) =>
  list<Person>(`/cycles/${id(cycleId)}/eligible-auditors?date=${encodeURIComponent(date)}`);
export const getTimeline = (cycleId: number) => list<TimelineEvent>(`/cycles/${id(cycleId)}/timeline`);
export const planAudit = (cycleId: number, version: number, type: AuditType, plannedDate: string, auditorId: number) =>
  post<CertificationAudit>(`/cycles/${id(cycleId)}/audits`, { version, type, plannedDate, auditorId });
export const completeAudit = (auditId: number, version: number, completedOn: string) =>
  post<CertificationAudit>(`/audits/${id(auditId)}/complete`, { version, completedOn });
export const cancelAudit = (auditId: number, version: number) => post<CertificationAudit>(`/audits/${id(auditId)}/cancel`, { version });
export const getNonconformities = (auditId: number) => list<Nonconformity>(`/audits/${id(auditId)}/nonconformities`);
export const raiseNonconformity = (auditId: number, version: number, grade: NcGrade, clause: string, statement: string) =>
  post<Nonconformity>(`/audits/${id(auditId)}/nonconformities`, { version, grade, clause: clause || null, statement });
export const respondNonconformity = (ncId: number, version: number, response: string) =>
  post<Nonconformity>(`/nonconformities/${id(ncId)}/respond`, { version, response });
export const closeNonconformity = (ncId: number, version: number) => post<Nonconformity>(`/nonconformities/${id(ncId)}/close`, { version });
export const getQualifications = () => list<Qualification>("/qualifications");
export const getAuditorCandidates = () => list<Person>("/qualifications/candidates");
export const createQualification = (body: { auditorId: number; standardCode: string; validFrom: string; validUntil: string; evidenceReference?: string }) =>
  post<Qualification>("/qualifications", body);
