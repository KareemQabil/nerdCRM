import { ApiError, wrapped } from "./api";
import { DEMO_MODE } from "./demo";

/** Wave 4b/4C + M1 (D-02): client ISO certification (ioeti-certification): programme, decision, certificate. */
export type CyclePhase = "STAGE1_PENDING" | "STAGE2_PENDING" | "FINDINGS_OPEN" | "READY_FOR_DECISION" | "CERTIFIED";
export type DecisionBlocker = "STAGE1_NOT_COMPLETED" | "STAGE2_NOT_COMPLETED" | "OPEN_MAJOR_NONCONFORMITIES" | "POLICY_D02";
export type CertificationCycle = {
  id: number; version: number; reference: string; clientId: number | null; clientName: string | null; standardCode: string;
  scope: string | null; siteCount: number | null; openMajors: number; readyForDecision: boolean; decisionStatus: string;
  managedByMe: boolean; phase: CyclePhase; decisionBlockers: DecisionBlocker[]; managerName: string | null;
  certificateNumber?: string | null; certificateStatus?: CertificateStatus | null;
};
export type AuditType = "STAGE1" | "STAGE2" | "SURVEILLANCE" | "RECERTIFICATION";
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
  kind: "CYCLE_OPENED" | "AUDIT_PLANNED" | "AUDIT_COMPLETED" | "AUDIT_CANCELLED" | "NC_RAISED" | "NC_RESPONDED" | "NC_CLOSED"
    | "DECISION_VOTE" | "DECISION_GRANT" | "DECISION_REFUSE" | "CERTIFICATE_ISSUED" | "CERTIFICATE_SUSPENDED"
    | "CERTIFICATE_RESTORED" | "CERTIFICATE_WITHDRAWN";
};

/** D-02: the cycle's decision, as the server computes it (mode, who may decide, votes, certificate). */
export type DecisionStatus = "BLOCKED_BY_POLICY" | "NOT_READY" | "AWAITING_DECISION" | "GRANTED" | "REFUSED";
export type DecisionMode = "INDEPENDENT_REVIEWER" | "COMMITTEE";
export type Vote = "GRANT" | "REFUSE";
export type CertificateStatus = "ACTIVE" | "SUSPENDED" | "WITHDRAWN" | "EXPIRED";
export type CertificateAction = "suspend" | "restore" | "withdraw";
export type DecisionVote = { voterId: number; voterName: string; vote: Vote | null; reason: string | null; castAt: string | null };
export type DecisionRound = {
  id: number; mode: DecisionMode; requiredVotes: number; status: "OPEN" | "DECIDED"; outcome: Vote | null; decidedAt: string | null;
  votesCast: number; grantVotes: number | null; refuseVotes: number | null; votes: DecisionVote[];
};
export type IsoCertificate = {
  id: number; version: number; number: string; standardCode: string; issuedOn: string; expiresOn: string; status: CertificateStatus;
  surveillanceMonths: number; surveillance: { index: number; dueOn: string; done: boolean; overdue: boolean }[]; recertificationDueBy: string;
  events: { action: "ISSUED" | "SUSPENDED" | "RESTORED" | "WITHDRAWN"; reason: string | null; actorName: string | null; at: string | null }[];
};
export type DecisionPanel = {
  cycleId: number; cycleVersion: number; status: DecisionStatus; missingPolicies: ("cert.decision" | "cert.cycle")[];
  mode: DecisionMode | null; requiredVotes: number | null; validityMonths: number | null; surveillanceMonths: number | null;
  blockers: DecisionBlocker[]; canVote: boolean; canGrant: boolean;
  cannotDecideReason: "NO_DECISION_RIGHT" | "AUDITED_CLIENT" | "ALREADY_VOTED" | null;
  eligibleDeciders: Person[]; nobodyReason: "NO_ROLE_HOLDERS" | "ALL_AUDITED_CLIENT" | "NOT_ENOUGH_ELIGIBLE" | null;
  openRound: DecisionRound | null; pastRounds: DecisionRound[]; certificate: IsoCertificate | null; canManageCertificate: boolean;
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
export const getDecision = (cycleId: number) => wrapped<DecisionPanel>(`${BASE}/cycles/${id(cycleId)}/decision`);
export const recordDecision = (cycleId: number, version: number, vote: Vote, reason: string) =>
  post<DecisionPanel>(`/cycles/${id(cycleId)}/decision`, { version, vote, reason });
export const changeCertificate = (cycleId: number, action: CertificateAction, version: number, reason: string) =>
  post<DecisionPanel>(`/cycles/${id(cycleId)}/certificate/${action}`, { version, reason });
