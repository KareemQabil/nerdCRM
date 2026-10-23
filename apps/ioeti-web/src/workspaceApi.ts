import { ApiError, wrapped } from "./api";
import { DEMO_MODE } from "./demo";

/** Wave 5b: quotation versions, review requests, invoice requests, renewals and the Account 360 summary. */
export type QuoteVersion = { number: number; savedAt: string | null; lines: number; totalBeforeTax: string | number };
export type ReviewReason = "PRICING" | "SCOPE" | "TERMS" | "DOCUMENTS" | "OTHER";
export type ReviewEvent = { kind: "REQUESTED" | "CHANGES_REQUESTED" | "WITHDRAWN"; reason: ReviewReason | null; actorName: string | null; at: string };
export type Review = {
  id: number; version: number; quoteId: number | null; contractId: number | null; quoteVersionNumber: number | null;
  status: "PENDING" | "CHANGES_REQUESTED" | "WITHDRAWN"; requestedBy: string | null; requestedAt: string | null; reviewedBy: string | null;
  reason: ReviewReason | null; decisionStatus: string; requestedByMe: boolean; events: ReviewEvent[];
  opportunityId?: number | null; subjectReference?: string | null;
};
export type InvoiceRequest = {
  id: number; version: number; quoteId: number; milestoneId: number; milestoneTitle: string | null; dueDate: string | null;
  amountBeforeTax: string | number | null; currency: string; status: "REQUESTED" | "CANCELLED"; requestedBy: string | null;
  requestedAt: string | null; invoiceStatus: string;
};
export type Section = { key: string; count: number; permitted: boolean };
export type MoneyRow = {
  currency: string; quotedDraft: string | number | null; bookedActive: string | number | null; invoiceRequested: string | number | null;
  invoiced: string | number | null; collected: string | number | null;
};
export type AccountSummary360 = { id: number; name: string; sections: Section[]; money: MoneyRow[] };

const BASE = "/ws/ioeti/workspace";
async function list<T>(url: string): Promise<T[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<T[]>(url);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid workspace response");
  return values;
}
async function post<T>(url: string, body: Record<string, unknown> = {}): Promise<T> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode is read-only");
  return wrapped<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
const id = (value: number) => encodeURIComponent(value);

export const getQuoteVersions = (quoteId: number) => list<QuoteVersion>(`/ws/ioeti/quotes/${id(quoteId)}/versions`);
export const saveQuoteVersion = (quoteId: number, version: number) => post<unknown>(`/ws/ioeti/quotes/${id(quoteId)}/versions`, { version });
export const restoreQuoteVersion = (quoteId: number, number: number, version: number) =>
  post<unknown>(`/ws/ioeti/quotes/${id(quoteId)}/versions/${id(number)}/restore`, { version });
export const getReviews = (subject: { quoteId?: number; contractId?: number }) =>
  list<Review>(`${BASE}/reviews?` + (subject.quoteId ? `quoteId=${id(subject.quoteId)}` : `contractId=${id(subject.contractId!)}`));
/** Pending reviews the caller may see and did not request: a reviewer's queue. */
export const getPendingReviews = () => list<Review>(`${BASE}/reviews?pending=true`);
export const requestReview = (subject: { quoteId?: number; contractId?: number }, version: number) => post<Review>(`${BASE}/reviews`, { ...subject, version });
export const withdrawReview = (reviewId: number, version: number) => post<Review>(`${BASE}/reviews/${id(reviewId)}/withdraw`, { version });
export const requestChanges = (reviewId: number, version: number, reason: ReviewReason) =>
  post<Review>(`${BASE}/reviews/${id(reviewId)}/changes`, { version, reason });
export const getInvoiceRequests = (quoteId: number) => list<InvoiceRequest>(`${BASE}/invoice-requests?quoteId=${id(quoteId)}`);
export const requestInvoice = (milestoneId: number, quoteVersion: number) => post<InvoiceRequest>(`${BASE}/invoice-requests`, { milestoneId, quoteVersion });
export const cancelInvoiceRequest = (requestId: number, version: number) => post<InvoiceRequest>(`${BASE}/invoice-requests/${id(requestId)}/cancel`, { version });
export const renewContract = (contractId: number, version: number) =>
  post<{ opportunityId: number; name: string; contractId: number }>(`${BASE}/contracts/${id(contractId)}/renewal`, { version });
export const getAccountSummary = (accountId: number) => wrapped<AccountSummary360>(`${BASE}/account360/${id(accountId)}`);
