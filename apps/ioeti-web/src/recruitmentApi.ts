import { ApiError, wrapped } from "./api";
import { DEMO_MODE } from "./demo";

/** Wave 4D: recruitment for external clients (ioeti-recruitment). Restricted candidate data is write-only. */
export type JobOrderStatus = "OPEN" | "ON_HOLD" | "FILLED" | "CLOSED";
export type JobOrder = {
  id: number; version: number; reference: string; clientId: number | null; clientName: string | null; title: string;
  headcount: number; location: string | null; requirements: string | null; status: JobOrderStatus;
  activeCandidates: number; placed: number; recruitedByMe: boolean; recruiterName: string | null;
};
export type Candidate = {
  id: number; version: number; displayName: string; headline: string | null; yearsExperience: number | null;
  privateProfileOnFile: boolean; ownedByMe: boolean;
};
export type ConsentMethod = "WRITTEN" | "EMAIL" | "RECORDED_CALL";
export type Consent = {
  id: number; version: number; jobOrderId: number; jobOrderReference: string; method: ConsentMethod; givenOn: string;
  evidenceReference: string | null; revokedAt: string | null; active: boolean;
};
export type Stage = "SOURCED" | "SCREENED" | "SHORTLISTED" | "SUBMITTED" | "INTERVIEWING" | "OFFERED" | "PLACED" | "REJECTED" | "WITHDRAWN";
export type Application = {
  id: number; version: number; jobOrderId: number; candidateId: number; candidateName: string; candidateHeadline: string | null;
  stage: Stage; submittedAt: string | null; offerDate: string | null; offerStatus: "PENDING" | "ACCEPTED" | "DECLINED" | null;
  consentOnFile: boolean;
};
export type Interview = { id: number; version: number; round: number; scheduledAt: string; outcome: "PENDING" | "PASSED" | "FAILED" | "NO_SHOW" };
export type PlacementRecord = {
  id: number; version: number; applicationId: number; candidateName: string; startDate: string; guaranteeStatus: string;
  feeMilestones: ("OFFER_ACCEPTED" | "CANDIDATE_STARTED")[]; invoicingStatus: string;
};

const BASE = "/ws/ioeti/recruitment";
async function list<T>(path: string): Promise<T[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<T[]>(BASE + path);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid recruitment response");
  return values;
}
async function send<T>(method: "POST" | "PUT", path: string, body: Record<string, unknown> = {}): Promise<T> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode is read-only");
  return wrapped<T>(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
const id = (value: number) => encodeURIComponent(value);
const query = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) p.set(k, v); });
  const s = p.toString();
  return s ? "?" + s : "";
};

export const getJobOrders = (q?: string) => list<JobOrder>("/job-orders" + query({ q }));
export const getJobOrder = (orderId: number) => wrapped<JobOrder>(`${BASE}/job-orders/${id(orderId)}`);
export const createJobOrder = (body: { reference: string; clientId: number; title: string; headcount: number; location?: string; requirements?: string }) =>
  send<JobOrder>("POST", "/job-orders", body);
export const setJobOrderStatus = (orderId: number, version: number, status: "OPEN" | "ON_HOLD" | "CLOSED") =>
  send<JobOrder>("POST", `/job-orders/${id(orderId)}/status`, { version, status });
export const getCandidates = (q?: string) => list<Candidate>("/candidates" + query({ q }));
export const getCandidate = (candidateId: number) => wrapped<Candidate>(`${BASE}/candidates/${id(candidateId)}`);
export const createCandidate = (body: { displayName: string; headline?: string; yearsExperience?: number }) =>
  send<Candidate>("POST", "/candidates", body);
export const savePrivateProfile = (candidateId: number, version: number, body: { email?: string; phone?: string; expectedSalary?: string; cvReference?: string }) =>
  send<Candidate>("PUT", `/candidates/${id(candidateId)}/private`, { version, ...body });
export const getConsents = (candidateId: number) => list<Consent>(`/candidates/${id(candidateId)}/consents`);
export const recordConsent = (candidateId: number, version: number, body: { jobOrderId: number; method: ConsentMethod; givenOn: string; evidenceReference?: string }) =>
  send<Consent>("POST", `/candidates/${id(candidateId)}/consents`, { version, ...body });
export const revokeConsent = (consentId: number, version: number) => send<Consent>("POST", `/consents/${id(consentId)}/revoke`, { version });
export const getApplications = (orderId: number) => list<Application>(`/job-orders/${id(orderId)}/applications`);
export const attachCandidate = (orderId: number, version: number, candidateId: number) =>
  send<Application>("POST", `/job-orders/${id(orderId)}/applications`, { version, candidateId });
export const moveApplication = (appId: number, version: number, stage: "SCREENED" | "SHORTLISTED" | "REJECTED" | "WITHDRAWN") =>
  send<Application>("POST", `/applications/${id(appId)}/stage`, { version, stage });
export const submitApplication = (appId: number, version: number) => send<Application>("POST", `/applications/${id(appId)}/submit`, { version });
export const getInterviews = (appId: number) => list<Interview>(`/applications/${id(appId)}/interviews`);
export const scheduleInterview = (appId: number, version: number, round: number, scheduledAt: string) =>
  send<Interview>("POST", `/applications/${id(appId)}/interviews`, { version, round, scheduledAt });
export const recordOutcome = (interviewId: number, version: number, outcome: "PASSED" | "FAILED" | "NO_SHOW") =>
  send<Interview>("POST", `/interviews/${id(interviewId)}/outcome`, { version, outcome });
export const recordOffer = (appId: number, version: number, offerDate: string) =>
  send<Application>("POST", `/applications/${id(appId)}/offer`, { version, offerDate });
export const answerOffer = (appId: number, version: number, accepted: boolean) =>
  send<Application>("POST", `/applications/${id(appId)}/offer-answer`, { version, accepted });
export const confirmPlacement = (appId: number, version: number, startDate: string) =>
  send<PlacementRecord>("POST", `/applications/${id(appId)}/placement`, { version, startDate });
export const getPlacements = (orderId: number) => list<PlacementRecord>(`/job-orders/${id(orderId)}/placements`);
export const recordStart = (placementId: number, startedOn: string) =>
  send<PlacementRecord>("POST", `/placements/${id(placementId)}/started`, { startedOn });
