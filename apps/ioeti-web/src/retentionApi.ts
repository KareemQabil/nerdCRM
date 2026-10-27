import { ApiError, wrapped } from "./api";

/**
 * D-07 retention review (signed 2026-10-25): records whose retention period has run out, for a policy owner to keep (with a
 * reason, until a date) or anonymize. Nothing is removed or changed automatically. The server checks on every call that the
 * caller is a policy owner.
 */
export type DataType = "LEADS" | "CANDIDATES" | "TRAINEES" | "DONORS" | "CONTACTS";
/** One data type; `due` is null when no period is set (never shown as zero). */
export type RetentionType = {
  dataType: DataType; set: boolean; months: number | null; policyVersionId: number | null; since: string | null; due: number | null; canAnonymize: boolean;
};
export type RetentionOverview = { today: string; types: RetentionType[] };
export type DueRecord = { id: number; label: string; lastActivityOn: string; dueSince: string };
export type RetentionQueue = { dataType: DataType; months: number; cutoff: string; total: number; canAnonymize: boolean; rows: DueRecord[] };
export type RetentionDecision = {
  id: number; dataType: DataType; recordId: number; decision: "KEEP" | "ANONYMIZED"; reason: string; reviewAgainOn: string | null;
  lastActivityOn: string; policyVersionId: number | null; decidedBy: string | null; decidedAt: string;
};

const BASE = "/ws/ioeti/privacy/retention";
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const getRetention = () => wrapped<RetentionOverview>(BASE);
export const getRetentionQueue = (type: DataType) => wrapped<RetentionQueue>(`${BASE}/${type}`);
export async function getRetentionDecisions(): Promise<RetentionDecision[]> {
  const rows = await wrapped<RetentionDecision[]>(`${BASE}/decisions`);
  if (!Array.isArray(rows)) throw new ApiError(502, "Invalid response");
  return rows;
}
export const keepRecord = (type: DataType, id: number, reason: string, reviewAgainOn: string) =>
  wrapped<RetentionDecision>(`${BASE}/${type}/${id}/keep`, json({ reason, reviewAgainOn }));
export const anonymizeRecord = (type: DataType, id: number, reason: string) =>
  wrapped<RetentionDecision>(`${BASE}/${type}/${id}/anonymize`, json({ reason }));
