/**
 * Isolated, browser-memory-only preview fixtures. Never used by the real Axelor
 * service mode. Build-time VITE_IOETI_DEMO=true is required to enable.
 *
 * The demo NEVER sends credentials, reads production records or persists edits.
 */
import type { BusinessLine, Opportunity, SessionIdentity, LeadSummary, AccountSummary } from "./api";

export const DEMO_MODE = import.meta.env.VITE_IOETI_DEMO === "true";

const lines: BusinessLine[] = [
  { id: 1, code: "ISO9001", nameAr: "شهادات ISO 9001", nameEn: "ISO 9001 Certification", status: 2, sequence: 10, responsibleTeam: "Quality Services" },
  { id: 2, code: "ISO22000", nameAr: "شهادات ISO 22000", nameEn: "ISO 22000 Certification", status: 2, sequence: 20, responsibleTeam: "Food Safety" },
  { id: 3, code: "TRAINING", nameAr: "التدريب", nameEn: "Training", status: 2, sequence: 30, responsibleTeam: "Learning" },
  { id: 4, code: "RECRUITMENT", nameAr: "التوظيف لصالح العملاء", nameEn: "Client Recruitment", status: 1, sequence: 40, responsibleTeam: "Talent" },
  { id: 5, code: "FUNDRAISING", nameAr: "تنمية الموارد", nameEn: "Fundraising", status: 1, sequence: 50, responsibleTeam: "Partnerships" },
];
let opportunities: Opportunity[] = [
  { id: 1004, version: 1, name: "Sample: Nile View Hotel — ISO 9001", reference: "DEMO-1004", businessLineCode: "ISO9001", businessLineNameAr: "شهادات ISO 9001", businessLineNameEn: "ISO 9001 Certification", stage: "Qualification" },
  { id: 1003, version: 1, name: "Sample: Delta Foods — ISO 22000", reference: "DEMO-1003", businessLineCode: "ISO22000", businessLineNameAr: "شهادات ISO 22000", businessLineNameEn: "ISO 22000 Certification", stage: "Proposal" },
  { id: 1002, version: 1, name: "Sample: Hospitality training cohort", reference: "DEMO-1002", businessLineCode: "TRAINING", businessLineNameAr: "التدريب", businessLineNameEn: "Training", stage: "New" },
];
const leadSamples: LeadSummary[] = [
  { id: 2103, name: "Sample: Salma Hassan", organization: "Nile View Hotel", stage: "New" },
  { id: 2102, name: "Sample: Mahmoud Ali", organization: "Delta Foods", stage: "Qualified" },
  { id: 2101, name: "Sample: Nour Mostafa", organization: "Cairo Hospitality Group", stage: "Contacted" },
  { id: 2100, name: "Sample: Hany Ibrahim", organization: "Alexandria Tourism Services", stage: "New" },
];
const accountSamples: AccountSummary[] = [
  { id: 3104, name: "Sample: Nile View Hotel", reference: "DEMO-AC-3104", customer: false, prospect: true },
  { id: 3103, name: "Sample: Delta Foods", reference: "DEMO-AC-3103", customer: true, prospect: false },
  { id: 3102, name: "Sample: Cairo Hospitality Group", reference: "DEMO-AC-3102", customer: true, prospect: true },
  { id: 3101, name: "Sample: Alexandria Tourism Services", reference: "DEMO-AC-3101", customer: false, prospect: true },
];
let nextId = 1005;

export const demoStore = {
  session: (): SessionIdentity => ({ code: "demo", name: "Preview Guest · Sample Data", language: "ar" }),
  lines: () => lines.map(x => ({ ...x })),
  leads: (offset: number, limit: number) => leadSamples.slice(offset, offset + limit).map(x => ({ ...x })),
  lead: (id: number) => {
    const item = leadSamples.find(x => x.id === id);
    if (!item) throw new Error("Preview lead not found");
    return { ...item };
  },
  accounts: (offset: number, limit: number) => accountSamples.slice(offset, offset + limit).map(x => ({ ...x })),
  account: (id: number) => {
    const item = accountSamples.find(x => x.id === id);
    if (!item) throw new Error("Preview account not found");
    return { ...item };
  },
  list: (offset: number, limit: number) => opportunities.slice(offset, offset + limit).map(x => ({ ...x })),
  get: (id: number) => {
    const item = opportunities.find(x => x.id === id);
    if (!item) throw new Error("Preview record does not exist");
    return { ...item };
  },
  create: (name: string, code: string) => {
    const line = lines.find(l => l.code === code && l.status === 2);
    if (!line) throw new Error("Select an active business line");
    const created: Opportunity = {
      id: nextId++, version: 1, name, reference: "DEMO-" + nextId,
      businessLineCode: code, businessLineNameAr: line.nameAr,
      businessLineNameEn: line.nameEn, stage: "New",
    };
    opportunities = [created, ...opportunities];
    return { ...created };
  },
  rename: (id: number, name: string, version: number) => {
    const item = opportunities.find(x => x.id === id);
    if (!item) throw new Error("Preview record does not exist");
    if (item.version !== version) throw new Error("Preview record was updated elsewhere");
    const updated = { ...item, name, version: item.version + 1 };
    opportunities = opportunities.map(x => x.id === id ? updated : x);
    return { ...updated };
  },
};
