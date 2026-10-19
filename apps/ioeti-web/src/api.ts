// Native browser session is proxied through the same-origin /axelor-erp path in development.
// No token in localStorage, no generic model API exposure, and no mock business records.
const PREFIX = "/axelor-erp";

export type BusinessLine = {
  id: number;
  code: string;
  nameAr: string;
  nameEn: string;
  status: number;
  sequence: number | null;
  responsibleTeam: string | null;
};
type Envelope<T> = {
  codeStatus?: number;
  messageStatus?: string;
  object?: T;
  status?: number;
  data?: unknown;
};

export class ApiError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); }
}

export async function signIn(username: string, password: string): Promise<void> {
  const response = await fetch(PREFIX + "/callback", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new ApiError(response.status, "Authentication failed");
  // A successful HTTP login must still be proven by an authenticated IOETI API call.
  await getBusinessLines();
}

export async function getBusinessLines(): Promise<BusinessLine[]> {
  const response = await fetch(PREFIX + "/ws/ioeti/business-lines", {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (response.status === 401 || response.status === 403) {
    throw new ApiError(response.status, "Not authenticated or not authorized");
  }
  if (!response.ok) throw new ApiError(response.status, "Unable to load business lines");
  const body = (await response.json()) as Envelope<BusinessLine[]>;
  if (body.codeStatus && body.codeStatus >= 400) {
    throw new ApiError(body.codeStatus, body.messageStatus || "Request failed");
  }
  if (body.status != null && body.status !== 0) throw new ApiError(403, "Access denied");
  if (!Array.isArray(body.object)) throw new ApiError(502, "Invalid business-line response");
  return body.object;
}
