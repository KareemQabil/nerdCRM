import { ApiError, wrapped } from "./api";
import { DEMO_MODE } from "./demo";

/**
 * Business-rule policies (owner decisions D-01..D-12, 2026-10-25): every rule is a value a policy owner sets
 * from a date; none is shipped and workflows that need one are refused until it is set. The server checks
 * who may read and change them on every call.
 */
export type PolicyScope = "NONE" | "BUSINESS_LINE" | "SCHEME" | "COURSE" | "CLIENT_AGREEMENT" | "LEAD_SOURCE" | "DATA_TYPE";
export type FieldKind = "PERCENT" | "DECIMAL" | "INTEGER" | "BOOLEAN" | "CHOICE" | "MULTI_CHOICE" | "TEXT" | "TIME" | "DATE_LIST" | "LIST";
export type PolicyField = {
  name: string; kind: FieldKind; required: boolean; options: string[]; min: number | null; max: number | null; items: PolicyField[];
  titleAr: string; titleEn: string;
};
export type PolicySummary = {
  key: string; decision: string; area: string; scope: PolicyScope; allowsDefault: boolean; titleAr: string; titleEn: string; helpAr: string; helpEn: string;
  inForce: number;
};
export type PolicyOverview = { canEdit: boolean; noOwners: boolean; policies: PolicySummary[] };
export type PolicyValue = {
  scope: string | null; versionId: number | null; value: Record<string, unknown> | null; since: string | null; nextFrom: string | null;
  nextValue: Record<string, unknown> | null; nextUnsets: boolean;
};
export type PolicyVersion = {
  id: number; scope: string | null; value: Record<string, unknown> | null; retired: boolean; effectiveFrom: string; reason: string;
  authorName: string | null; createdAt: string;
};
export type PolicyDetail = Omit<PolicySummary, "inForce"> & { fields: PolicyField[]; canEdit: boolean; values: PolicyValue[]; versions: PolicyVersion[] };
export type Person = { id: number; name: string; me: boolean };

const BASE = "/ws/ioeti/policies";
const enc = (value: string | number) => encodeURIComponent(value);
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
async function list<T>(url: string): Promise<T[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<T[]>(url);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid response");
  return values;
}

export const getPolicies = () => wrapped<PolicyOverview>(BASE);
export const getPolicy = (key: string) => wrapped<PolicyDetail>(`${BASE}/${enc(key)}`);
export const setPolicy = (key: string, input: { scope?: string; value: Record<string, unknown>; effectiveFrom?: string; reason: string }) =>
  wrapped<PolicyDetail>(`${BASE}/${enc(key)}`, json(input));
export const retirePolicy = (key: string, input: { scope?: string; effectiveFrom?: string; reason: string }) =>
  wrapped<PolicyDetail>(`${BASE}/${enc(key)}/retire`, json(input));
/** The teams and lead sources a policy value can name (the routing rules, D-12). */
export type PolicyReferences = { teams: { id: number; name: string }[]; sources: { id: number; name: string }[] };
export const getPolicyReferences = () => wrapped<PolicyReferences>(`${BASE}/references`);
export const getPolicyOwners = () => list<Person>(`${BASE}/owners`);
export const getPolicyPeople = () => list<Person>(`${BASE}/people`);
export const appointOwner = (userId: number) => wrapped<Person[]>(`${BASE}/owners`, json({ userId }));
export const dismissOwner = (userId: number) => wrapped<Person[]>(`${BASE}/owners/${enc(userId)}/dismiss`, json({}));
