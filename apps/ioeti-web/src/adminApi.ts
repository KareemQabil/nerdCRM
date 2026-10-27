import { ApiError, wrapped } from "./api";
import { DEMO_MODE } from "./demo";

/** Administration from the platform (journeys plan, phase 1). Administrators only; the server checks it. */
export type TeamRef = { id: number; name: string };
export type PersonRef = { id: number; code: string; name: string; active: boolean };
export type AdminUser = {
  id: number; version: number; code: string; name: string; contactOnFile: boolean; language: string | null; active: boolean;
  mustChangePassword: boolean; profileCode: string | null; profileName: string | null; administrator: boolean;
  businessLines: string[]; teams: TeamRef[]; createdOn: string | null;
};
export type Right = { object: string; read: boolean; write: boolean; create: boolean; remove: boolean; conditional: boolean };
export type ProfileAccess = { code: string | null; name: string | null; administrator: boolean; rights: Right[] };
export type AdminUserDetail = { user: AdminUser; access: ProfileAccess };
export type Profile = { id: number; code: string; name: string; administrator: boolean; people: number; rules: number };
export type AdminTeam = { id: number; version: number; code: string | null; name: string; members: PersonRef[] };
export type AdminLine = {
  id: number; version: number; code: string; nameEn: string; nameAr: string; status: 1 | 2 | 3; sequence: number | null;
  purpose: string | null; responsibleTeam: TeamRef | null; manager: PersonRef | null; members: number;
};
export type AdminChange = {
  id: number; action: string; subject: "USER" | "TEAM" | "BUSINESS_LINE"; subjectId: number | null; subjectLabel: string | null;
  changes: string | null; actorName: string | null; createdAt: string;
};
export type NewPerson = {
  code: string; name: string; email?: string; language: string; temporaryPassword: string; profileCode?: string;
  businessLines: string[]; teamIds: number[];
};
export type PersonChange = {
  version: number; name?: string; email?: string; language?: string; profileCode?: string; businessLines?: string[]; teamIds?: number[];
};
export type LineInput = {
  version?: number; code?: string; nameEn?: string; nameAr?: string; status?: number; sequence?: number | null; purpose?: string;
  responsibleTeamId?: number; managerId?: number;
};

const BASE = "/ws/ioeti/admin";
const enc = (value: string | number) => encodeURIComponent(value);
async function list<T>(url: string): Promise<T[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<T[]>(url);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid administration response");
  return values;
}
async function post<T>(url: string, body: Record<string, unknown> = {}): Promise<T> {
  if (DEMO_MODE) throw new ApiError(403, "Preview mode is read-only");
  return wrapped<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function getPeople(filter: { q?: string; status?: "active" | "inactive" | ""; line?: string } = {}) {
  const query = new URLSearchParams();
  if (filter.q) query.set("q", filter.q);
  if (filter.status) query.set("status", filter.status);
  if (filter.line) query.set("businessLine", filter.line);
  return list<AdminUser>(`${BASE}/users${query.toString() ? "?" + query : ""}`);
}
export const getPerson = (id: number) => wrapped<AdminUserDetail>(`${BASE}/users/${enc(id)}`);
export const addPerson = (input: NewPerson) => post<AdminUser>(`${BASE}/users`, input);
export const changePerson = (id: number, input: PersonChange) => post<AdminUser>(`${BASE}/users/${enc(id)}`, input);
export const deactivatePerson = (id: number, version: number) => post<AdminUser>(`${BASE}/users/${enc(id)}/deactivate`, { version });
export const activatePerson = (id: number, version: number) => post<AdminUser>(`${BASE}/users/${enc(id)}/activate`, { version });
export const setTemporaryPassword = (id: number, version: number, temporaryPassword: string) =>
  post<AdminUser>(`${BASE}/users/${enc(id)}/password`, { version, temporaryPassword });

export const getProfiles = () => list<Profile>(`${BASE}/profiles`);
export const getProfile = (code: string) => wrapped<ProfileAccess>(`${BASE}/profiles/${enc(code)}`);

export const getTeams = () => list<AdminTeam>(`${BASE}/teams`);
export const addTeam = (name: string, memberIds: number[]) => post<AdminTeam>(`${BASE}/teams`, { name, memberIds });
export const changeTeam = (id: number, version: number, name: string, memberIds: number[]) =>
  post<AdminTeam>(`${BASE}/teams/${enc(id)}`, { version, name, memberIds });

export const getAdminLines = () => list<AdminLine>(`${BASE}/business-lines`);
export const addLine = (input: LineInput) => post<AdminLine>(`${BASE}/business-lines`, input);
export const changeLine = (code: string, input: LineInput) => post<AdminLine>(`${BASE}/business-lines/${enc(code)}`, input);
export const getLineMembers = (code: string) => list<PersonRef>(`${BASE}/business-lines/${enc(code)}/members`);
export const setLineMembers = (code: string, userIds: number[]) => post<PersonRef[]>(`${BASE}/business-lines/${enc(code)}/members`, { userIds });

export function getChanges(filter: { subject?: string; subjectId?: number; limit?: number; offset?: number } = {}) {
  const query = new URLSearchParams();
  if (filter.subject) query.set("subject", filter.subject);
  if (filter.subjectId != null) query.set("subjectId", String(filter.subjectId));
  query.set("limit", String(filter.limit ?? 50));
  if (filter.offset) query.set("offset", String(filter.offset));
  return list<AdminChange>(`${BASE}/audit?${query}`);
}

/**
 * A strong temporary password made in the browser (Web Crypto). The administrator copies it to the
 * person; the server hashes it and forces a change at the first sign-in. It is never stored in the page.
 */
export function makeTemporaryPassword(length = 16): string {
  const lower = "abcdefghjkmnpqrstuvwxyz", upper = "ABCDEFGHJKLMNPQRSTUVWXYZ", digits = "23456789", marks = "-_";
  const all = lower + upper + digits + marks;
  const pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const chars = [pick(lower), pick(upper), pick(digits), pick(marks)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Reference lists (lost reasons, lead sources, opportunity stages) managed by administrators. */
export type ListKind = "lost-reasons" | "sources" | "opportunity-stages" | "campaign-types";
export type ListValue = { id: number; version: number; name: string; sequence: number | null; role: "WON" | "LOST" | "DEFAULT" | "PROPOSITION" | null; uses: number };
export const getListValues = (kind: ListKind) => list<ListValue>(`${BASE}/lists/${kind}`);
export const addListValue = (kind: ListKind, name: string) => post<ListValue>(`${BASE}/lists/${kind}`, { name });
export const renameListValue = (kind: ListKind, id: number, version: number, name: string) =>
  post<ListValue>(`${BASE}/lists/${kind}/${enc(id)}`, { version, name });
export const deleteListValue = (kind: ListKind, id: number, version: number) =>
  post<ListValue[]>(`${BASE}/lists/${kind}/${enc(id)}/delete`, { version });
export const orderStages = (ids: number[]) => post<ListValue[]>(`${BASE}/lists/opportunity-stages/order`, { ids });

/** How the records the platform creates are numbered; field visits need an administrator to set it up. */
export type NumberingRow = { code: string; name: string; configured: boolean; version: number | null; prefix: string | null; digits: number | null; nextNumber: number | null; example: string | null };
export const getNumbering = () => list<NumberingRow>(`${BASE}/numbering`);
export const setNumbering = (code: string, version: number | null, prefix: string, digits: number) =>
  post<NumberingRow>(`${BASE}/numbering/${enc(code)}`, { version: version ?? undefined, prefix, digits });

/**
 * The company's quality set-up: statuses (with their kind), where issues are found (with origin), issue and action types,
 * and for root-cause analysis the analysis methods (with their branches), the causes under each branch and the processes (with their owner).
 */
export type QualityList = "statuses" | "detections" | "issue-types" | "action-types" | "methods" | "causes" | "processes";
export type QualityBranch = { id: number; name: string; causes: number };
export type QualityValue = {
  id: number; version: number; name: string; code: string | null; kind: string | null; sequence: number | null; uses: number;
  branches?: QualityBranch[] | null; branchId?: number | null; branchName?: string | null; ownerId?: number | null; ownerName?: string | null;
};
export type QualityExtra = { kind?: string; branchId?: number; ownerId?: number };
export const getQualityValues = (which: QualityList) => list<QualityValue>(`${BASE}/quality/${which}`);
export const addQualityValue = (which: QualityList, name: string, extra: QualityExtra = {}) => post<QualityValue>(`${BASE}/quality/${which}`, { name, ...extra });
export const changeQualityValue = (which: QualityList, id: number, version: number, name: string, extra: QualityExtra = {}) =>
  post<QualityValue>(`${BASE}/quality/${which}/${enc(id)}`, { version, name, ...extra });
export const deleteQualityValue = (which: QualityList, id: number, version: number) =>
  post<QualityValue[]>(`${BASE}/quality/${which}/${enc(id)}/delete`, { version });
export const addMethodBranch = (method: QualityValue, name: string) =>
  post<QualityValue>(`${BASE}/quality/methods/${enc(method.id)}/branches`, { version: method.version, name });
export const deleteMethodBranch = (method: QualityValue, branchId: number) =>
  post<QualityValue>(`${BASE}/quality/methods/${enc(method.id)}/branches/${enc(branchId)}/delete`, { version: method.version });
