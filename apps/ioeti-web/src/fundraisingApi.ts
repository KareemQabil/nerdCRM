import { ApiError, wrapped } from "./api";
import { DEMO_MODE } from "./demo";

/** Wave 4E: fundraising and partnerships (ioeti-fundraising). Sensitive donor data and bank references are write-only. */
export type Money = string | number;
export type DonorType = "INDIVIDUAL" | "FOUNDATION" | "CORPORATE" | "GOVERNMENT" | "MULTILATERAL";
export type Donor = {
  id: number; version: number; partnerId: number | null; name: string | null; anonymous: boolean; donorType: DonorType;
  managedByMe: boolean; managerName: string | null; sensitiveOnFile: boolean; openOpportunities: number;
};
export type MoneyTotals = {
  currency: string; proposed: Money; committed: Money; scheduled: Money; collected: Money; outstanding: Money; restrictedCommitted: Money;
};
export type Stage = "IDENTIFIED" | "PROPOSAL" | "SUBMITTED" | "APPROVED" | "DECLINED" | "WITHDRAWN";
export type Opportunity = {
  id: number; version: number; reference: string; donorId: number; donorName: string | null; title: string; purpose: string | null;
  kind: "GRANT" | "DONATION" | "SPONSORSHIP"; stage: Stage; proposedAmount: Money | null; currency: string; deadline: string | null;
  campaignId: number | null; campaignName: string | null; renewalOf: string | null; commitmentId: number | null; archived: boolean; managedByMe: boolean;
};
export type Commitment = {
  id: number; version: number; opportunityId: number; reference: string; title: string; donorName: string | null; currency: string;
  committed: Money; scheduled: Money; collected: Money; outstanding: Money; unscheduled: Money; restricted: boolean;
  restrictionPurpose: string | null; agreementReference: string | null; approvedOn: string; periodEnd: string | null;
  pendingDeliverables: number; receiptStatus: string; accountingStatus: string; managedByMe: boolean;
};
export type CollectionState = "DUE" | "PARTIAL" | "OVERDUE" | "COLLECTED" | "CANCELLED";
export type Installment = { id: number; version: number; sequence: number; dueDate: string; amount: Money; collected: Money; status: CollectionState };
export type InstallmentStatus = {
  id: number; commitmentId: number; reference: string; donorName: string | null; sequence: number; dueDate: string; amount: Money;
  collected: Money; currency: string; status: CollectionState;
};
export type CollectionRecord = {
  id: number; version: number; amount: Money; receivedOn: string; status: "RECORDED" | "VOIDED"; voidReason: string | null;
  recordedBy: string | null; receiptStatus: string;
};
export type Deliverable = { id: number; version: number; title: string; dueDate: string; status: "PENDING" | "SUBMITTED" | "ACCEPTED"; submittedOn: string | null };
export type TimelineEvent = { at: string; kind: string; label: string | null; actorName: string | null };
export type Overview = { totals: MoneyTotals[]; stages: Record<Stage, number>; attention: InstallmentStatus[]; opportunities: number };
export type Campaign = { id: number; name: string };

const BASE = "/ws/ioeti/fundraising";
async function list<T>(path: string): Promise<T[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<T[]>(BASE + path);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid fundraising response");
  return values;
}
async function send<T>(method: "POST" | "PUT", path: string, body: Record<string, unknown> = {}): Promise<T> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode is read-only");
  return wrapped<T>(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
const id = (value: number) => encodeURIComponent(value);
const query = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== "") p.set(k, String(v)); });
  const s = p.toString();
  return s ? "?" + s : "";
};

export const getOverview = () => wrapped<Overview>(`${BASE}/overview`);
export const getCollectionStatus = (status?: CollectionState) => list<InstallmentStatus>("/collections" + query({ status }));
export const getCampaigns = () => list<Campaign>("/campaigns");
export const getDonors = (q?: string) => list<Donor>("/donors" + query({ q }));
export const getDonor = (donorId: number) => wrapped<{ donor: Donor; totals: MoneyTotals[] }>(`${BASE}/donors/${id(donorId)}`);
export const createDonor = (body: { partnerId: number; donorType: DonorType; anonymous?: boolean }) => send<Donor>("POST", "/donors", body);
export const saveSensitive = (donorId: number, version: number, body: { givingCapacity?: string; contactPreference?: string; relationshipNote?: string }) =>
  send<Donor>("PUT", `/donors/${id(donorId)}/sensitive`, { version, ...body });
export const getTimeline = (donorId: number) => list<TimelineEvent>(`/donors/${id(donorId)}/timeline`);
export const recordActivity = (donorId: number, version: number, body: { kind: string; occurredOn: string; subject: string }) =>
  send<Donor>("POST", `/donors/${id(donorId)}/stewardship`, { version, ...body });
export const getOpportunities = (filters: { stage?: Stage; donorId?: number; campaignId?: number; q?: string } = {}) =>
  list<Opportunity>("/opportunities" + query(filters));
export const getOpportunity = (oppId: number) => wrapped<Opportunity>(`${BASE}/opportunities/${id(oppId)}`);
export const createOpportunity = (body: {
  reference: string; donorId: number; title: string; purpose?: string; kind: string; proposedAmount?: string; currencyCode: string;
  deadline?: string; campaignId?: number;
}) => send<Opportunity>("POST", "/opportunities", body);
export const moveOpportunity = (oppId: number, version: number, stage: "PROPOSAL" | "SUBMITTED" | "DECLINED" | "WITHDRAWN") =>
  send<Opportunity>("POST", `/opportunities/${id(oppId)}/stage`, { version, stage });
export const approveOpportunity = (oppId: number, version: number, body: {
  committedAmount: string; approvedOn: string; periodEnd?: string; restricted: boolean; restrictionPurpose?: string; agreementReference?: string;
}) => send<Commitment>("POST", `/opportunities/${id(oppId)}/approve`, { version, ...body });
export const archiveOpportunity = (oppId: number, version: number) => send<Opportunity>("POST", `/opportunities/${id(oppId)}/archive`, { version });
export const renewOpportunity = (oppId: number, version: number, reference: string) =>
  send<Opportunity>("POST", `/opportunities/${id(oppId)}/renewal`, { version, reference });
export const getCommitment = (commitmentId: number) => wrapped<Commitment>(`${BASE}/commitments/${id(commitmentId)}`);
export const getInstallments = (commitmentId: number) => list<Installment>(`/commitments/${id(commitmentId)}/installments`);
export const scheduleInstallment = (commitmentId: number, version: number, dueDate: string, amount: string) =>
  send<Installment>("POST", `/commitments/${id(commitmentId)}/installments`, { version, dueDate, amount });
export const cancelInstallment = (installmentId: number, version: number) => send<Installment>("POST", `/installments/${id(installmentId)}/cancel`, { version });
export const getCollections = (installmentId: number) => list<CollectionRecord>(`/installments/${id(installmentId)}/collections`);
export const recordCollection = (installmentId: number, version: number, body: { amount: string; receivedOn: string; bankReference: string }) =>
  send<CollectionRecord>("POST", `/installments/${id(installmentId)}/collections`, { version, ...body });
export const voidCollection = (collectionId: number, version: number, reason: "DUPLICATE_ENTRY" | "WRONG_AMOUNT" | "PAYMENT_RETURNED") =>
  send<CollectionRecord>("POST", `/collections/${id(collectionId)}/void`, { version, reason });
export const getDeliverables = (commitmentId: number) => list<Deliverable>(`/commitments/${id(commitmentId)}/deliverables`);
export const addDeliverable = (commitmentId: number, version: number, title: string, dueDate: string) =>
  send<Deliverable>("POST", `/commitments/${id(commitmentId)}/deliverables`, { version, title, dueDate });
export const advanceDeliverable = (deliverableId: number, version: number, stage: "SUBMITTED" | "ACCEPTED") =>
  send<Deliverable>("POST", `/deliverables/${id(deliverableId)}/status`, { version, stage });
