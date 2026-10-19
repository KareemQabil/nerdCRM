import { DEMO_MODE, demoStore } from "./demo";
// Custom IOETI endpoints only. The browser never imports unrestricted Axelor models.
// Auth uses a same-origin Vite development proxy. Do not deploy the proxy publicly.
const PREFIX = "/axelor-erp";
export type BusinessLine = {
  id: number; code: string; nameAr: string; nameEn: string;
  status: number; sequence: number | null; responsibleTeam: string | null;
};
export type LeadSummary = { id: number; name: string; organization: string | null; stage: string | null };
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
async function request(path: string, options?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(PREFIX + path, {
      credentials: "same-origin", cache: "no-store",
      headers: { Accept: "application/json", ...options?.headers },
      ...options,
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
export async function getBusinessLines(): Promise<BusinessLine[]> {
  if (DEMO_MODE) return demoStore.lines();
  const values = await wrapped<BusinessLine[]>("/ws/ioeti/business-lines");
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
