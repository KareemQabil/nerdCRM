import { DEMO_MODE, demoStore } from "./demo";
import { notifyApiFailure, notifyApiSuccess } from "./feedback";
// Custom IOETI endpoints only. The browser never imports unrestricted Axelor models.
// Auth uses a same-origin Vite development proxy. Do not deploy the proxy publicly.
const PREFIX = "/axelor-erp";
export type BusinessLine = {
  id: number; code: string; nameAr: string; nameEn: string;
  status: number; sequence: number | null; responsibleTeam: string | null;
};
export type LeadSummary = {
  id: number; name: string; organization: string | null; stage: string | null;
  // live API only (absent in the fictional preview)
  version?: number; converted?: boolean; businessLineCode?: string | null;
  accountId?: number | null; opportunityId?: number | null;
  stageId?: number | null; stageKind?: "OPEN" | "CONVERTED" | "LOST" | null; lostReason?: string | null; assignedToMe?: boolean | null; receivedAt?: string | null;
  response?: LeadResponse | null;
  governorate?: string | null;
};
/** D-12: where a lead stands against its response targets (computed by the server in working hours). */
export type ResponseStatus = "NOT_SET" | "DUE" | "OVERDUE" | "MET" | "LATE" | "CLOSED";
export type LeadResponse = {
  status: ResponseStatus; missing: "CALENDAR" | "TARGET" | null; dueAt: string | null; contactedAt: string | null;
  qualification: ResponseStatus | null; qualifyDueAt: string | null; qualifiedAt: string | null;
};
export type LeadStage = { id: number; name: string; kind: "OPEN" | "CONVERTED" | "LOST" };
export type LostReason = { id: number; name: string };
export type ContactSummary = { id: number; name: string; jobTitle: string | null };
export type LeadConversion = { leadId: number; accountId: number; contactId: number | null; opportunityId: number };
export type ConvertLeadCommand = { version: number; opportunityName?: string; businessLineCode?: string; accountId?: number };
export type AccountSummary = { id: number; name: string; reference: string | null; customer: boolean; prospect: boolean; version?: number };
export type SessionIdentity = { code: string; name: string; language: string | null; administrator?: boolean; policyOwner?: boolean; pages?: string[] };
export type Opportunity = {
  id: number;
  version: number;
  name: string;
  reference: string | null;
  businessLineCode: string | null;
  businessLineNameAr: string | null;
  businessLineNameEn: string | null;
  stage: string | null;
  // live API only (journeys plan, phase 2): the stage path and the salesperson's estimate
  stageId?: number | null; stageKind?: "OPEN" | "WON" | "LOST" | null; amount?: string | number | null; currencyCode?: string | null;
  expectedCloseDate?: string | null; probability?: string | number | null; lostReason?: string | null;
};
type Envelope<T> = {
  codeStatus?: number; messageStatus?: string; object?: T; status?: number;
  data?: unknown; message?: string;
};
export type ApiFieldError = { field: string; code: string };
/** statusCode plus the stable IOETI error contract (error.code / error.fields); the UI localizes these. */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string | null = null,
    public readonly fields: ApiFieldError[] = [],
  ) { super(message); }
}
async function contractDetails(response: Response): Promise<{ code: string | null; fields: ApiFieldError[] }> {
  try {
    const body = await response.clone().json() as { error?: { code?: unknown; fields?: unknown } };
    const error = body?.error;
    const fields = Array.isArray(error?.fields)
      ? error.fields.filter((f): f is ApiFieldError =>
          !!f && typeof (f as ApiFieldError).field === "string" && typeof (f as ApiFieldError).code === "string")
        .map(f => ({ field: f.field, code: f.code }))
      : [];
    return { code: typeof error?.code === "string" ? error.code : null, fields };
  } catch {
    return { code: null, fields: [] };
  }
}
/** Axelor's CSRF token (pac4j cookie CSRF-TOKEN, readable by design); required on unsafe methods. */
function csrfToken(): string | null {
  const match = document.cookie.split("; ").find(part => part.startsWith("CSRF-TOKEN="));
  return match ? decodeURIComponent(match.slice("CSRF-TOKEN=".length)) : null;
}
async function request(path: string, options?: RequestInit): Promise<Response> {
  let response: Response;
  const method = (options?.method || "GET").toUpperCase();
  const token = method === "GET" || method === "HEAD" ? null : csrfToken();
  try {
    response = await fetch(PREFIX + path, {
      credentials: "same-origin", cache: "no-store",
      ...options,
      headers: { Accept: "application/json", ...options?.headers, ...(token ? { "X-CSRF-Token": token } : {}) },
    });
  } catch {
    throw new ApiError(0, "Backend is unreachable");
  }
  if (response.status === 401 || response.status === 403) {
    const { code } = await contractDetails(response);
    // the session ended: the app returns to sign-in (not for the sign-in and session checks themselves)
    if (response.status === 401 && code !== MFA_REQUIRED && !/\/(session|login|logout|mfa)\b/.test(path)) window.dispatchEvent(new Event("ioeti:session-expired"));
    throw new ApiError(response.status, response.status === 401 ? "Session expired" : "Access denied", code);
  }
  if (!response.ok) {
    const { code, fields } = await contractDetails(response);
    throw new ApiError(response.status, response.status === 409 ? "Record was changed elsewhere" : "Request failed", code, fields);
  }
  return response;
}
export async function wrapped<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method || "GET").toUpperCase();
  const read = method === "GET" || method === "HEAD";
  try {
    const response = await request(path, options);
    const body = await response.json() as Envelope<T>;
    if (typeof body.codeStatus === "number" && body.codeStatus >= 400) {
      throw new ApiError(body.codeStatus, body.messageStatus || "Request failed");
    }
    // Some Axelor error responses report HTTP 200 + status -1.
    if (body.status != null && body.status !== 0) {
      throw new ApiError(403, body.messageStatus || "Axelor operation rejected");
    }
    if (body.object === undefined || body.object === null) {
      throw new ApiError(502, "Unexpected backend response");
    }
    if (!read) notifyApiSuccess(method, response.status);
    return body.object;
  } catch (failure) {
    // Preserve the actual typed API error for inline validation and retry UIs.
    // The global notice renders only status and stable code, never raw server messages.
    // Reads stay silent: their callers show (or deliberately hide) the failure, e.g. an optional
    // section the user may not read, or the unread-notice count polled every minute.
    if (!read) notifyApiFailure(failure);
    throw failure;
  }
}
/** A protected image (e.g. a checklist photo) as a blob, through the same session and error handling. */
export async function blob(path: string): Promise<Blob> {
  const response = await request(path, { headers: { Accept: "image/png, image/jpeg" } });
  return response.blob();
}
export async function getSession(): Promise<SessionIdentity> {
  if (DEMO_MODE) return demoStore.session();
  const response = await request("/ws/ioeti/session");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || typeof (body as SessionIdentity).code !== "string") {
    throw new ApiError(502, "Invalid identity response");
  }
  return body as SessionIdentity;
}
/** Thrown when Axelor asks for a new password (temporary password set by an administrator). */
export const PASSWORD_CHANGE_REQUIRED = "PASSWORD_CHANGE_REQUIRED";
/** D-07: the person turned on two-step sign-in; the callback asks for a code before it opens a session. */
export const MFA_REQUIRED = "MFA_REQUIRED";
export async function signIn(username: string, password: string, newPassword?: string): Promise<SessionIdentity> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode does not accept credentials");
  const response = await request("/callback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(newPassword ? { username, password, newPassword } : { username, password }),
  });
  // Verify Axelor session instead of trusting HTTP 200 or access to one business module.
  if (!response.ok) throw new ApiError(response.status, "Authentication failed");
  // Axelor answers a required password change with 200 and a route instead of a session.
  let body: { route?: { path?: string; state?: { error?: string; passwordRequirements?: string } } } = {};
  try { body = await response.json(); } catch { body = {}; }
  if (body.route?.path === "/change-password") {
    throw new ApiError(428, body.route.state?.error || body.route.state?.passwordRequirements || "Password change required", PASSWORD_CHANGE_REQUIRED);
  }
  if (body.route?.path === "/mfa") throw new ApiError(428, "Two-step sign-in code required", MFA_REQUIRED);
  return getSession();
}
/** The second step of a two-step sign-in: a code from the authenticator app, or a recovery code. */
export async function signInWithCode(username: string, code: string, recovery: boolean): Promise<SessionIdentity> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode does not accept credentials");
  // the native MFA client takes the second step (pac4j picks the client by name)
  const response = await request("/callback?client_name=MfaClient", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, mfaCode: code.trim(), mfaMethod: recovery ? "RECOVERY" : "TOTP" }),
  });
  if (!response.ok) throw new ApiError(response.status, "Authentication failed");
  let body: { route?: { path?: string } } = {};
  try { body = await response.json(); } catch { body = {}; }
  // a wrong code answers with the code step again, without a session
  if (body.route?.path === "/mfa") throw new ApiError(401, "Wrong code", MFA_REQUIRED);
  return getSession();
}
/** Ends the server session (pac4j /logout); the old session cookie is then refused. */
export async function signOut(): Promise<void> {
  if (DEMO_MODE) return;
  try {
    await fetch(PREFIX + "/logout", { credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiError(0, "Backend is unreachable");
  }
}
export async function getBusinessLines(): Promise<BusinessLine[]> {
  if (DEMO_MODE) return demoStore.lines();
  const values = await wrapped<BusinessLine[]>("/ws/ioeti/business-lines");
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid business-line list");
  return values;
}
/** Lines the signed-in user may start opportunities in (server rule: membership until D-07). */
export async function getCreatableBusinessLines(): Promise<BusinessLine[]> {
  if (DEMO_MODE) return (await demoStore.lines()).filter(line => line.status === 2);
  const values = await wrapped<BusinessLine[]>("/ws/ioeti/business-lines?creatable=true");
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid business-line list");
  return values;
}
export async function getOpportunities(offset = 0, limit = 25): Promise<Opportunity[]> {
  if (DEMO_MODE) return demoStore.list(offset, limit);
  const values = await wrapped<Opportunity[]>(`/ws/ioeti/opportunities?limit=${limit}&offset=${offset}`);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid opportunity list");
  return values;
}
export async function getOpportunity(id: number): Promise<Opportunity> {
  if (DEMO_MODE) return demoStore.get(id);
  return wrapped<Opportunity>(`/ws/ioeti/opportunities/${encodeURIComponent(id)}`);
}
/** The optional part of a new opportunity: the client account and the salesperson's estimate. */
export type OpportunityExtras = { accountId?: number; amount?: string; currencyCode?: string; expectedCloseDate?: string; probability?: string };
export async function createOpportunity(name: string, businessLineCode: string, extras: OpportunityExtras = {}): Promise<Opportunity> {
  if (DEMO_MODE) return demoStore.create(name, businessLineCode);
  const given = Object.fromEntries(Object.entries(extras).filter(([, v]) => v !== undefined && v !== ""));
  return wrapped<Opportunity>("/ws/ioeti/opportunities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, businessLineCode, ...given }),
  });
}
/** One card on the pipeline board: the opportunity, its account and owner as far as the caller may read them. */
export type BoardCard = { opportunity: Opportunity; accountName: string | null; accountId: number | null; ownerName: string | null; mine: boolean };
export async function getPipelineBoard(): Promise<BoardCard[]> {
  if (DEMO_MODE) return (await demoStore.list(0, 200)).map(o => ({ opportunity: o, accountName: null, accountId: null, ownerName: null, mine: true }));
  const values = await wrapped<BoardCard[]>("/ws/ioeti/opportunities/board");
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid board");
  return values;
}
export async function renameOpportunity(id: number, name: string, version: number): Promise<Opportunity> {
  if (DEMO_MODE) return demoStore.rename(id, name, version);
  return wrapped<Opportunity>(`/ws/ioeti/opportunities/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, version }),
  });
}

/** Read-only reverse-mapped models, never Axelor generic REST. */
export async function getLeads(offset = 0, limit = 25): Promise<LeadSummary[]> {
  if (DEMO_MODE) return demoStore.leads(offset, limit);
  const values = await wrapped<LeadSummary[]>(`/ws/ioeti/leads?limit=${limit}&offset=${offset}`);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid lead response");
  return values;
}
export async function getLead(id: number): Promise<LeadSummary> {
  if (DEMO_MODE) return demoStore.lead(id);
  return wrapped<LeadSummary>(`/ws/ioeti/leads/${id}`);
}
export async function getAccounts(offset = 0, limit = 25): Promise<AccountSummary[]> {
  if (DEMO_MODE) return demoStore.accounts(offset, limit);
  const values = await wrapped<AccountSummary[]>(`/ws/ioeti/accounts?limit=${limit}&offset=${offset}`);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid accounts response");
  return values;
}
export async function getAccount(id: number): Promise<AccountSummary> {
  if (DEMO_MODE) return demoStore.account(id);
  return wrapped<AccountSummary>(`/ws/ioeti/accounts/${id}`);
}

/** Lead → Account (+ Contact) + Opportunity in one server transaction; the preview never converts. */
export async function convertLead(id: number, command: ConvertLeadCommand): Promise<LeadConversion> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode is read-only");
  return wrapped<LeadConversion>(`/ws/ioeti/leads/${encodeURIComponent(id)}/convert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
}
/** Lead qualification on the native AOS LeadService; the preview never changes leads. */
export async function getLeadStages(): Promise<LeadStage[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<LeadStage[]>("/ws/ioeti/leads/stages");
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid stages response");
  return values;
}
export async function getLostReasons(): Promise<LostReason[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<LostReason[]>("/ws/ioeti/leads/lost-reasons");
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid lost reasons response");
  return values;
}
async function leadCommand(id: number, action: string, body: Record<string, unknown>): Promise<LeadSummary> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode is read-only");
  return wrapped<LeadSummary>(`/ws/ioeti/leads/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
export const moveLeadStage = (id: number, version: number, stageId: number) => leadCommand(id, "stage", { version, stageId });
export const loseLead = (id: number, version: number, lostReasonId: number | null, note: string) =>
  leadCommand(id, "lose", { version, lostReasonId, note: note || null });
export const reopenLead = (id: number, version: number) => leadCommand(id, "reopen", { version });
export const assignLeadToMe = (id: number, version: number) => leadCommand(id, "assign", { version });
/** Account 360: contacts and opportunities, each filtered by the caller's own permissions. */
export async function getAccountContacts(id: number): Promise<ContactSummary[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<ContactSummary[]>(`/ws/ioeti/accounts/${encodeURIComponent(id)}/contacts`);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid contacts response");
  return values;
}
export async function getAccountOpportunities(id: number): Promise<Opportunity[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<Opportunity[]>(`/ws/ioeti/accounts/${encodeURIComponent(id)}/opportunities`);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid opportunities response");
  return values;
}

/** Wave 3: catalog and draft quotations (native AOS SaleOrder). Tax comes from the finance.tax policy (D-06). */
export type CatalogProduct = { id: number; code: string | null; name: string; unit: string | null; salePrice: string | null; currency: string | null };
export type QuoteLine = { id: number; productCode: string | null; name: string; quantity: string; unit: string | null; unitPriceBeforeTax: string | null; discountPercent?: string | null; totalBeforeTax: string | null };
/**
 * D-11: a draft's approval tier today (NEEDED with the approver, NOT_NEEDED, POLICY_NOT_SET or OUTSIDE_APPROVAL_TIERS),
 * or, once finalized, APPROVED with who approved, the end of validity and when the rep recorded sending it.
 */
export type QuoteApproval = {
  status: "NEEDED" | "NOT_NEEDED" | "POLICY_NOT_SET" | "OUTSIDE_APPROVAL_TIERS" | "APPROVED" | null; approver: string | null;
  discountPercent: string | number | null; approvedBy: string | null; approvedAt: string | null; validUntil: string | null; expired: boolean;
  sentAt: string | null; sentBy: string | null; sentVia: string | null;
  /** D-11: the client's acceptance (a signed quotation or a purchase order) and the evidence revision it was recorded on. */
  acceptance?: { kind: "SIGNED_QUOTE" | "PURCHASE_ORDER"; reference: string | null; acceptedOn: string; recordedBy: string | null;
    recordedAt: string | null; documentId: number | null; documentRevision: number | null } | null;
};
export type Quote = {
  id: number; version: number; reference: string | null; status: string | null; opportunityId: number | null;
  accountId: number | null; accountName: string | null; currency: string | null; totalBeforeTax: string | null;
  /** APPLIED, or POLICY_NOT_SET when the owners have not set a tax for the quotation's business line. */
  taxStatus: string; taxTotal?: string | null; totalWithTax?: string | null;
  tax?: { name: string; ratePercent: string; policyVersionId: number; since: string } | null; taxOutdated?: boolean;
  versionNumber?: number | null; lines: QuoteLine[]; approval?: QuoteApproval | null;
};
export async function getCatalog(search = ""): Promise<CatalogProduct[]> {
  if (DEMO_MODE) return [];
  const query = search.trim() ? `&q=${encodeURIComponent(search.trim())}` : "";
  const values = await wrapped<CatalogProduct[]>(`/ws/ioeti/catalog/products?limit=50${query}`);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid catalog response");
  return values;
}
export async function getQuotes(opportunityId: number): Promise<Quote[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<Quote[]>(`/ws/ioeti/quotes?opportunityId=${encodeURIComponent(opportunityId)}`);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid quotations response");
  return values;
}
export async function createQuote(opportunityId: number, opportunityVersion: number): Promise<Quote> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode is read-only");
  return wrapped<Quote>("/ws/ioeti/quotes", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ opportunityId, opportunityVersion }),
  });
}
export async function addQuoteLine(id: number, version: number, productId: number, quantity: string): Promise<Quote> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode is read-only");
  return wrapped<Quote>(`/ws/ioeti/quotes/${encodeURIComponent(id)}/lines`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version, productId, quantity: Number(quantity) }),
  });
}

/** D-06: apply the tax policy in force today to a draft quotation again. */
export async function refreshQuoteTax(id: number, version: number): Promise<Quote> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode is read-only");
  return wrapped<Quote>(`/ws/ioeti/quotes/${encodeURIComponent(id)}/tax`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version }),
  });
}
const quotePost = async (id: number, path: string, body: Record<string, unknown>): Promise<Quote> => {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode is read-only");
  return wrapped<Quote>(`/ws/ioeti/quotes/${encodeURIComponent(id)}/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
};
/** D-11: a line's discount in %; the quotation's approval tier follows it. */
export const setLineDiscount = (q: Quote, lineId: number, percent: string) =>
  quotePost(q.id, `lines/${encodeURIComponent(lineId)}/discount`, { version: q.version, percent });
/** D-11: finalizes when the tier needs no approval; otherwise 422 APPROVAL_REQUIRED. */
export const finalizeQuote = (q: Quote) => quotePost(q.id, "finalize", { version: q.version });
/** D-11: the rep records sending the finalized quotation themselves (nothing is e-mailed). */
export const markQuoteSent = (q: Quote, via: string) => quotePost(q.id, "sent", { version: q.version, via });

/** Wave 3: payment milestones (native Timetable). Booked, invoiced and collected are separate figures. */
export type Milestone = { id: number; title: string; percentage: string; amountBeforeTax: string | null; dueDate: string | null; state: string; invoiceReference: string | null };
export type MilestonePlan = {
  quoteId: number; quoteVersion: number; currency: string | null; totalBeforeTax: string | null;
  plannedPercentage: string; plannedAmountBeforeTax: string; bookingStatus: string; bookedBeforeTax: string;
  invoiced: string; collected: string; invoicingStatus: string; milestones: Milestone[];
};
export async function getMilestones(quoteId: number): Promise<MilestonePlan> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode is read-only");
  return wrapped<MilestonePlan>(`/ws/ioeti/quotes/${encodeURIComponent(quoteId)}/milestones`);
}
export async function addMilestone(quoteId: number, version: number, title: string, percentage: string, dueDate: string): Promise<MilestonePlan> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode is read-only");
  return wrapped<MilestonePlan>(`/ws/ioeti/quotes/${encodeURIComponent(quoteId)}/milestones`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version, title, percentage: Number(percentage), dueDate }),
  });
}
export async function removeMilestone(quoteId: number, milestoneId: number, version: number): Promise<MilestonePlan> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode is read-only");
  return wrapped<MilestonePlan>(`/ws/ioeti/quotes/${encodeURIComponent(quoteId)}/milestones/${encodeURIComponent(milestoneId)}?version=${encodeURIComponent(version)}`, { method: "DELETE" });
}

/**
 * Wave 3: customer contracts (native AOS Contract). D-11: activation on uploaded signature evidence by the business line's
 * signatory role; activation.status is SIGNED, ACTIVE (before D-11), POLICY_NOT_SET, NOT_SIGNATORY or READY.
 */
export type ContractActivationView = {
  status: "SIGNED" | "ACTIVE" | "POLICY_NOT_SET" | "NOT_SIGNATORY" | "READY"; signatory: string | null; signedOn: string | null;
  activatedBy: string | null; activatedAt: string | null; documentId: number | null; documentRevision: number | null;
};
export type Contract = {
  id: number; version: number; reference: string | null; name: string | null; status: string | null;
  contractType: "BILLING" | "FRAMEWORK" | null; opportunityId: number | null; accountId: number | null;
  accountName: string | null; currency: string | null; activationStatus: string;
  sourceQuoteId?: number | null; totalBeforeTax?: string | null;
  lines?: { id: number; productCode: string | null; name: string; quantity: string; unitPriceBeforeTax: string | null; totalBeforeTax: string | null }[];
  activation?: ContractActivationView | null;
};
export async function getContracts(opportunityId: number): Promise<Contract[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<Contract[]>(`/ws/ioeti/contracts?opportunityId=${encodeURIComponent(opportunityId)}`);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid contracts response");
  return values;
}
export async function createContract(opportunityId: number, opportunityVersion: number, contractType: "BILLING" | "FRAMEWORK"): Promise<Contract> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode is read-only");
  return wrapped<Contract>("/ws/ioeti/contracts", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ opportunityId, opportunityVersion, contractType }),
  });
}
export async function fillContractFromQuote(contractId: number, version: number, quoteId: number): Promise<Contract> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode is read-only");
  return wrapped<Contract>(`/ws/ioeti/contracts/${encodeURIComponent(contractId)}/lines-from-quote`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version, quoteId }),
  });
}

/** Wave 4a: external training (ioeti-training). Certificates and cohort cancellation wait for D-03. */
export type TrainingCourse = { id: number; version: number; code: string; name: string; nameAr: string | null; durationHours: number | null; active: boolean };
export type TrainingCohort = {
  id: number; version: number; code: string; courseId: number | null; courseName: string | null;
  startDate: string | null; endDate: string | null; capacity: number; minSeats: number | null; location: string | null;
  status: "PLANNED" | "OPEN" | "CLOSED"; confirmed: number; waitlisted: number; seatsLeft: number; coordinatedByMe: boolean;
};
export type TrainingEnrollment = {
  id: number; version: number; traineeId: number; traineeName: string | null; clientName: string | null;
  status: "CONFIRMED" | "WAITLISTED" | "CANCELLED"; waitlistPosition: number | null;
};
export type TrainingSession = { id: number; version: number; title: string; startsAt: string; durationMinutes: number | null };
export type AttendanceStatus = "PRESENT" | "ABSENT" | "EXCUSED";
export type TrainingAttendance = { id: number; enrollmentId: number; status: AttendanceStatus };
const TRAINING = "/ws/ioeti/training";
async function trainingList<T>(path: string): Promise<T[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<T[]>(TRAINING + path);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid training response");
  return values;
}
async function trainingPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode is read-only");
  return wrapped<T>(TRAINING + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
export const getTrainingCourses = () => trainingList<TrainingCourse>("/courses");
export const createTrainingCourse = (body: { code: string; name: string; nameAr?: string; durationHours?: number }) =>
  trainingPost<TrainingCourse>("/courses", body);
export const getTrainingCohorts = () => trainingList<TrainingCohort>("/cohorts");
export const getTrainingCohort = (id: number) => wrapped<TrainingCohort>(`${TRAINING}/cohorts/${encodeURIComponent(id)}`);
export const createTrainingCohort = (body: { courseId: number; code: string; capacity: number; minSeats?: number; startDate?: string; endDate?: string; location?: string }) =>
  trainingPost<TrainingCohort>("/cohorts", body);
export const setCohortState = (id: number, version: number, action: "open" | "close") =>
  trainingPost<TrainingCohort>(`/cohorts/${encodeURIComponent(id)}/${action}`, { version });
export const getCohortEnrollments = (id: number) => trainingList<TrainingEnrollment>(`/cohorts/${encodeURIComponent(id)}/enrollments`);
export const enrollTrainee = (cohortId: number, version: number, traineeId: number, clientId?: number) =>
  trainingPost<TrainingEnrollment>(`/cohorts/${encodeURIComponent(cohortId)}/enrollments`, { version, traineeId, ...(clientId ? { clientId } : {}) });
export const cancelEnrollment = (id: number, version: number) =>
  trainingPost<TrainingEnrollment>(`/enrollments/${encodeURIComponent(id)}/cancel`, { version });
export const getCohortSessions = (id: number) => trainingList<TrainingSession>(`/cohorts/${encodeURIComponent(id)}/sessions`);
export const scheduleSession = (cohortId: number, version: number, title: string, startsAt: string, durationMinutes?: number) =>
  trainingPost<TrainingSession>(`/cohorts/${encodeURIComponent(cohortId)}/sessions`, { version, title, startsAt, ...(durationMinutes ? { durationMinutes } : {}) });
export const getSessionAttendance = (id: number) => trainingList<TrainingAttendance>(`/sessions/${encodeURIComponent(id)}/attendance`);
export const recordAttendance = (sessionId: number, version: number, enrollmentId: number, status: AttendanceStatus) =>
  trainingPost<TrainingAttendance>(`/sessions/${encodeURIComponent(sessionId)}/attendance`, { version, enrollmentId, status });
