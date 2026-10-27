import { ApiError, wrapped } from "./api";
import { DEMO_MODE } from "./demo";

/** Campaigns (capability map: marketing and campaigns). Native campaign permissions decide on the server;
 * results are counted within the caller's read scope from real records only. */
export type CampaignStage = "DRAFT" | "PLANNED" | "STARTED" | "SUSPENDED" | "ENDED";
export const CAMPAIGN_STAGES: CampaignStage[] = ["DRAFT", "PLANNED", "STARTED", "SUSPENDED", "ENDED"];
/** Mirrors the server's rule so the board can say "not allowed" before asking; the server still decides. */
export const CAMPAIGN_NEXT: Record<CampaignStage, CampaignStage[]> = {
  DRAFT: ["PLANNED"], PLANNED: ["DRAFT", "STARTED"], STARTED: ["SUSPENDED", "ENDED"], SUSPENDED: ["STARTED", "ENDED"], ENDED: [],
};
export type Campaign = {
  id: number; version: number; name: string; stage: CampaignStage; typeId: number | null; type: string | null;
  startDate: string | null; endDate: string | null; summary: string | null; ownerName: string | null;
  leads: number; converted: number; opportunities: number;
};
export type CampaignLead = { id: number; name: string; converted: boolean; stage: string | null };
export type CampaignInput = { name?: string; typeId?: number | ""; startDate?: string; endDate?: string; summary?: string };

const BASE = "/ws/ioeti/campaigns";
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
async function list<T>(url: string): Promise<T[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<T[]>(url);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid response");
  return values;
}
export const getCampaigns = (q = "") => list<Campaign>(`${BASE}${q ? `?q=${encodeURIComponent(q)}` : ""}`);
export const getCampaign = (id: number) => wrapped<{ campaign: Campaign; leads: CampaignLead[] }>(`${BASE}/${encodeURIComponent(id)}`);
export const addCampaign = (input: CampaignInput) => wrapped<Campaign>(BASE, json(input));
export const changeCampaign = (id: number, version: number, input: CampaignInput) => wrapped<Campaign>(`${BASE}/${encodeURIComponent(id)}`, json({ version, ...input }));
export const moveCampaign = (id: number, version: number, stage: CampaignStage) =>
  wrapped<Campaign>(`${BASE}/${encodeURIComponent(id)}/stage`, json({ version, stage }));
export const getCampaignTypes = () => list<{ id: number; name: string }>(`${BASE}/types`);
