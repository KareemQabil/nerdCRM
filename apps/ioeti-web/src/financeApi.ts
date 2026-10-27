import { ApiError, wrapped } from "./api";
import { DEMO_MODE } from "./demo";

/** Finance's invoicing queue within D-06: requests, coming milestones and real totals; issuing stays blocked. */
export type FinanceRequest = {
  id: number; version: number; status: "REQUESTED" | "CANCELLED"; orderId: number; orderReference: string | null; accountId: number | null;
  accountName: string | null; milestoneId: number; milestoneTitle: string | null; dueDate: string | null; amountBeforeTax: number | null; currency: string;
  requestedBy: string | null; requestedAt: string | null; ageDays: number | null; overdue: boolean; mine: boolean; invoiceStatus: "BLOCKED_BY_POLICY";
};
export type UpcomingMilestone = {
  id: number; title: string | null; dueDate: string; amountBeforeTax: number | null; currency: string; orderId: number; orderVersion: number;
  orderReference: string | null; accountId: number | null; accountName: string | null; overdue: boolean; daysLeft: number;
};
export type FinanceMoney = { currency: string; booked: number | null; requested: number | null; invoiced: number | null; collected: number | null };
export type FinanceSummary = { ordersPermitted: boolean; requestsPermitted: boolean; invoicesPermitted: boolean; rows: FinanceMoney[] };

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
async function list<T>(url: string): Promise<T[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<T[]>(url);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid response");
  return values;
}
const id = (n: number) => encodeURIComponent(n);
export const getFinanceQueue = (state: "open" | "cancelled" | "all") => list<FinanceRequest>(`/ws/ioeti/finance/queue?state=${state}`);
export const getUpcomingMilestones = (within: number) => list<UpcomingMilestone>(`/ws/ioeti/finance/milestones?within=${within}`);
export const getFinanceSummary = () => wrapped<FinanceSummary>("/ws/ioeti/finance/summary");
export const requestMilestoneInvoice = (m: UpcomingMilestone) =>
  wrapped<unknown>("/ws/ioeti/workspace/invoice-requests", json({ milestoneId: m.id, quoteVersion: m.orderVersion }));
export const cancelRequest = (r: FinanceRequest) => wrapped<unknown>(`/ws/ioeti/workspace/invoice-requests/${id(r.id)}/cancel`, json({ version: r.version }));
export const issueInvoice = (r: FinanceRequest) => wrapped<unknown>(`/ws/ioeti/workspace/invoice-requests/${id(r.id)}/issue`, json({}));
