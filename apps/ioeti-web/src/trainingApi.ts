import { ApiError, wrapped } from "./api";
import { DEMO_MODE } from "./demo";

/**
 * D-03 (signed 2026-10-25) on top of the Wave 4a training API: the rules a cohort runs under, assessment scores,
 * eligibility and certificates, national IDs (sent, never read back), invoice links, cancellation previews and refunds.
 * Approving a refund issues the credit note through the D-06 finance service, then records it on the refund.
 */
const T = "/ws/ioeti/training";
const id = (value: number) => encodeURIComponent(value);
const post = <R>(path: string, body: Record<string, unknown>) => {
  if (DEMO_MODE) return Promise.reject(new ApiError(403, "Preview mode is read-only"));
  return wrapped<R>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
};
const list = async <R>(path: string): Promise<R[]> => {
  if (DEMO_MODE) return [];
  const values = await wrapped<R[]>(path);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid training response");
  return values;
};

export type IdentityCollection = "NOT_ASKED" | "OPTIONAL" | "REQUIRED";
export type RefundStep = { daysBeforeStart: number; refundPercent: number };
/** The policies in force today; null fields mean the policy owner has not set them yet. */
export type CohortRules = {
  criteriaSet: boolean; minAttendancePercent: number | null; passMark: number | null; identityCollection: IdentityCollection | null;
  cancellationSet: boolean; refundSteps: RefundStep[] | null; cohortCancelledRefundPercent: number | null;
};
export type EligibilityReason = "NOT_CONFIRMED" | "NO_SESSIONS" | "ATTENDANCE_BELOW" | "SCORE_MISSING" | "SCORE_BELOW" | "POLICY_NOT_SET";
export type EligibilityRow = {
  enrollmentId: number; version: number; traineeName: string | null; sessionsPresent: number; attendancePercent: number | null;
  score: number | null; eligible: boolean; reason: EligibilityReason | null; certificateId: number | null; certificateVersion: number | null;
  certificateSerial: string | null; certificateIssued: string | null;
};
export type Eligibility = {
  cohortId: number; cohortVersion: number; criteriaSet: boolean; minAttendancePercent: number | null; passMark: number | null;
  sessions: number; canIssue: boolean; rows: EligibilityRow[];
};
export type Certificate = {
  id: number; version: number; serial: string; enrollmentId: number; issueDate: string; traineeName: string; courseName: string;
  courseNameAr: string | null; durationHours: number | null; cohortCode: string; startDate: string | null; endDate: string | null;
  attendancePercent: number; score: number | null; status: "ISSUED" | "REVOKED"; revokedOn: string | null;
};
export type BulkIssue = { issued: Certificate[]; skipped: { enrollmentId: number; traineeName: string | null; reason: EligibilityReason }[] };
export type InvoiceChoice = { id: number; number: string | null; date: string | null; currency: string | null; totalWithTax: number; received: number; unlinked: number };
export type Fee = { id: number; version: number; invoiceId: number; invoiceNumber: string | null; amount: number; currency: string | null; paid: number };
export type RefundStatus = "REQUESTED" | "CREDITED" | "REJECTED";
export type Refund = {
  id: number; version: number; enrollmentId: number; traineeName: string | null; cohortId: number; cohortCode: string; courseName: string;
  cause: "ENROLMENT_CANCELLED" | "COHORT_CANCELLED"; status: RefundStatus; invoiceId: number; invoiceNumber: string | null; invoiceVersion: number;
  currency: string | null; invoiceTotal: number; paidAmount: number; daysBeforeStart: number | null; refundPercent: number; amount: number;
  creditPercent: number; requestedAt: string; requestedBy: string | null; decidedAt: string | null; decidedBy: string | null;
  rejectReason: string | null; creditId: number | null; creditNumber: string | null; creditedAmount: number | null; canDecide: boolean;
};
export type CancellationOutcome = "REFUND" | "NO_REFUND_DUE" | "NOT_INVOICED" | "NOTHING_PAID" | "POLICY_NOT_SET" | "START_DATE_MISSING" | "ALREADY_REQUESTED";
export type Cancellation = {
  enrollmentId: number; version: number; status: string; outcome: CancellationOutcome; fee: Fee | null; paid: number;
  daysBeforeStart: number | null; refundPercent: number | null; refundAmount: number; currency: string | null; canLinkInvoice: boolean;
  refund: Refund | null;
};
export type CohortCancellation = {
  cohortId: number; version: number; enrollments: number; paidEnrollments: number; refunds: number; refundTotal: number;
  currency: string | null; refundPercent: number | null; outcome: "REFUND" | "NO_REFUND" | "POLICY_NOT_SET"; certificatesIssued: number;
};

export const getCohortRules = (cohortId: number) => wrapped<CohortRules>(`${T}/cohorts/${id(cohortId)}/rules`);
export const getEligibility = (cohortId: number) => wrapped<Eligibility>(`${T}/cohorts/${id(cohortId)}/eligibility`);
export const recordScore = (enrollmentId: number, version: number, score: number) =>
  post<unknown>(`${T}/enrollments/${id(enrollmentId)}/assessment`, { version, score });
export const recordNationalId = (enrollmentId: number, version: number, nationalId: string) =>
  post<unknown>(`${T}/enrollments/${id(enrollmentId)}/national-id`, { version, nationalId });
export const issueCertificate = (enrollmentId: number, version: number) =>
  post<Certificate>(`${T}/enrollments/${id(enrollmentId)}/certificate`, { version });
export const issueAllCertificates = (cohortId: number, version: number) =>
  post<BulkIssue>(`${T}/cohorts/${id(cohortId)}/certificates`, { version });
export const getCertificate = (certificateId: number) => wrapped<Certificate>(`${T}/certificates/${id(certificateId)}`);
export const revokeCertificate = (certificateId: number, version: number, reason: string) =>
  post<Certificate>(`${T}/certificates/${id(certificateId)}/revoke`, { version, reason });

export const getInvoiceChoices = (enrollmentId: number) => list<InvoiceChoice>(`${T}/enrollments/${id(enrollmentId)}/invoices`);
export const linkInvoice = (enrollmentId: number, invoiceId: number, amount?: number) =>
  post<Fee>(`${T}/enrollments/${id(enrollmentId)}/fee`, { invoiceId, ...(amount != null ? { amount } : {}) });
export const getCancellation = (enrollmentId: number) => wrapped<Cancellation>(`${T}/enrollments/${id(enrollmentId)}/cancellation`);
export const getCohortCancellation = (cohortId: number) => wrapped<CohortCancellation>(`${T}/cohorts/${id(cohortId)}/cancellation`);
export const cancelCohort = (cohortId: number, version: number) => post<unknown>(`${T}/cohorts/${id(cohortId)}/cancel`, { version });
export const requestRefund = (enrollmentId: number, version: number) => post<Refund>(`${T}/enrollments/${id(enrollmentId)}/refund`, { version });
export const getRefunds = (status: RefundStatus | "ALL" = "REQUESTED") => list<Refund>(`${T}/refunds?status=${status}`);
export const getCohortRefunds = (cohortId: number) => list<Refund>(`${T}/cohorts/${id(cohortId)}/refunds`);
export const rejectRefund = (refund: Refund, reason: string) =>
  post<Refund>(`${T}/refunds/${id(refund.id)}/reject`, { version: refund.version, reason });

/** The credit note's reason names the refund, so the credit note it created can be found again on the invoice. */
export const refundReason = (refund: Refund) => `Training refund #${refund.id} · ${refund.cohortCode}`;

type CreditedInvoice = { refunds: { id: number; reason: string | null }[] };
/**
 * Step 1 of approving: finance issues the credit note for the refund's share of the invoice with the existing D-06
 * service (native rights and accounting set-up are checked there). Returns the new credit note's id.
 */
export async function issueRefundCreditNote(refund: Refund): Promise<number> {
  const reason = refundReason(refund);
  const invoice = await post<CreditedInvoice>(`/ws/ioeti/finance/invoices/${id(refund.invoiceId)}/credit-notes`,
    { version: refund.invoiceVersion, percent: refund.creditPercent, reason });
  const credit = [...(invoice.refunds || [])].filter(r => r.reason === reason).sort((a, b) => b.id - a.id)[0];
  if (!credit) throw new ApiError(502, "Credit note not found on the invoice", "CREDIT_NOTE_MISSING");
  return credit.id;
}
/** Step 2: the refund records the credit note; the server checks it is this invoice's, for this share, and unused. */
export const approveRefund = (refund: Refund, creditInvoiceId: number) =>
  post<Refund>(`${T}/refunds/${id(refund.id)}/approve`, { version: refund.version, creditInvoiceId });
