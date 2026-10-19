import { DEMO_MODE, demoStore } from "./demo";
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
};
export type ContactSummary = { id: number; name: string; jobTitle: string | null };
export type LeadConversion = { leadId: number; accountId: number; contactId: number | null; opportunityId: number };
export type ConvertLeadCommand = { version: number; opportunityName?: string; businessLineCode?: string; accountId?: number };
export type AccountSummary = { id: number; name: string; reference: string | null; customer: boolean; prospect: boolean };
export type SessionIdentity = { code: string; name: string; language: string | null };
export type Opportunity = {
  id: number;
  version: number;
  name: string;
  reference: string | null;
  businessLineCode: string | null;
  businessLineNameAr: string | null;
  businessLineNameEn: string | null;
  stage: string | null;
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
    throw new ApiError(response.status, response.status === 401 ? "Session expired" : "Access denied", code);
  }
  if (!response.ok) {
    const { code, fields } = await contractDetails(response);
    throw new ApiError(response.status, response.status === 409 ? "Record was changed elsewhere" : "Request failed", code, fields);
  }
  return response;
}
async function wrapped<T>(path: string, options?: RequestInit): Promise<T> {
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
  return body.object;
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
export async function signIn(username: string, password: string): Promise<SessionIdentity> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode does not accept credentials");
  const response = await request("/callback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  // Verify Axelor session instead of trusting HTTP 200 or access to one business module.
  if (!response.ok) throw new ApiError(response.status, "Authentication failed");
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
export async function createOpportunity(name: string, businessLineCode: string): Promise<Opportunity> {
  if (DEMO_MODE) return demoStore.create(name, businessLineCode);
  return wrapped<Opportunity>("/ws/ioeti/opportunities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, businessLineCode }),
  });
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

/** Wave 3: catalog and draft quotations (native AOS SaleOrder). Amounts are before tax (D-06). */
export type CatalogProduct = { id: number; code: string | null; name: string; unit: string | null; salePrice: string | null; currency: string | null };
export type QuoteLine = { id: number; productCode: string | null; name: string; quantity: string; unit: string | null; unitPriceBeforeTax: string | null; totalBeforeTax: string | null };
export type Quote = {
  id: number; version: number; reference: string | null; status: string | null; opportunityId: number | null;
  accountId: number | null; accountName: string | null; currency: string | null; totalBeforeTax: string | null;
  taxStatus: string; lines: QuoteLine[];
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

/** Wave 3: draft customer contracts (native AOS Contract). Activation and handover are policy-blocked (D-11). */
export type Contract = {
  id: number; version: number; reference: string | null; name: string | null; status: string | null;
  contractType: "BILLING" | "FRAMEWORK" | null; opportunityId: number | null; accountId: number | null;
  accountName: string | null; currency: string | null; activationStatus: string;
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
