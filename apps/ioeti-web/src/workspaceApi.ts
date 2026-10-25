import { ApiError, wrapped } from "./api";
import { DEMO_MODE } from "./demo";

/** Wave 5b: quotation versions, review requests, invoice requests, renewals and the Account 360 summary. */
export type QuoteVersion = { number: number; savedAt: string | null; lines: number; totalBeforeTax: string | number };
export type ReviewReason = "PRICING" | "SCOPE" | "TERMS" | "DOCUMENTS" | "OTHER";
export type ReviewEvent = { kind: "REQUESTED" | "CHANGES_REQUESTED" | "WITHDRAWN" | "APPROVED" | "REJECTED"; reason: ReviewReason | null; actorName: string | null; at: string };
export type Review = {
  id: number; version: number; quoteId: number | null; contractId: number | null; quoteVersionNumber: number | null;
  status: "PENDING" | "CHANGES_REQUESTED" | "WITHDRAWN" | "APPROVED" | "REJECTED"; requestedBy: string | null; requestedAt: string | null; reviewedBy: string | null;
  reason: ReviewReason | null; decisionStatus: string; requestedByMe: boolean; events: ReviewEvent[];
  opportunityId?: number | null; subjectReference?: string | null;
  /** D-11: who the quotation's tier says approves it (NONE, SALES_MANAGER, GM), and whether the caller may decide. */
  approver?: string | null; canDecide?: boolean; decidedAt?: string | null; rationale?: string | null;
};
export type InvoiceRequest = {
  id: number; version: number; quoteId: number; milestoneId: number; milestoneTitle: string | null; dueDate: string | null;
  amountBeforeTax: string | number | null; currency: string; status: "REQUESTED" | "CANCELLED"; requestedBy: string | null;
  requestedAt: string | null; invoiceNumber: string | null;
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
/** D-11: a holder of the tier's role approves (the quotation is finalized natively) or rejects with a reason. */
export const approveReview = (reviewId: number, version: number, rationale: string) =>
  post<Review>(`${BASE}/reviews/${id(reviewId)}/approve`, { version, rationale });
export const rejectReview = (reviewId: number, version: number, reason: ReviewReason, rationale: string) =>
  post<Review>(`${BASE}/reviews/${id(reviewId)}/reject`, { version, reason, rationale });
/** D-11: the client's acceptance on its evidence (a document filed on the quotation); confirms the order natively. */
export const acceptQuote = (quote: { id: number; version: number }, input: { kind: "SIGNED_QUOTE" | "PURCHASE_ORDER"; reference: string; acceptedOn: string; documentId: number }) =>
  post<{ quoteId: number; status: string }>(`${BASE}/quotes/${id(quote.id)}/accept`, { version: quote.version, ...input });
/** D-11: activation on the signed copy filed on the contract, by the business line's signatory role. */
export const activateContract = (contract: { id: number; version: number }, input: { signedOn: string; startOn?: string; documentId: number }) =>
  post<{ contractId: number; status: string }>(`${BASE}/contracts/${id(contract.id)}/activate`, { version: contract.version, ...input });
export const getInvoiceRequests = (quoteId: number) => list<InvoiceRequest>(`${BASE}/invoice-requests?quoteId=${id(quoteId)}`);
export const requestInvoice = (milestoneId: number, quoteVersion: number) => post<InvoiceRequest>(`${BASE}/invoice-requests`, { milestoneId, quoteVersion });
export const cancelInvoiceRequest = (requestId: number, version: number) => post<InvoiceRequest>(`${BASE}/invoice-requests/${id(requestId)}/cancel`, { version });
export const renewContract = (contractId: number, version: number) =>
  post<{ opportunityId: number; name: string; contractId: number }>(`${BASE}/contracts/${id(contractId)}/renewal`, { version });
export const getAccountSummary = (accountId: number) => wrapped<AccountSummary360>(`${BASE}/account360/${id(accountId)}`);
