import { wrapped } from "./api";

/** Wave 7b: reports computed on the server inside the caller's read permissions (null = not permitted). */
export type Amount = { currency: string | null; amount: string | number };
export type PipelineRow = { businessLineCode: string | null; stage: string | null; open: boolean | null; count: number; amounts: Amount[] };
export type SourceRow = { source: string | null; total: number; open: number; converted: number; lost: number };
export type SalesReport = {
  from: string | null; to: string | null; businessLineCode: string | null;
  pipeline: PipelineRow[] | null;
  leads: { total: number; open: number; converted: number; lost: number; bySource: SourceRow[] } | null;
  campaigns: { id: number; name: string; leads: number }[] | null;
  followUps: { planned: number; overdue: number; doneLast30Days: number } | null;
};
export type AreasReport = { from: string | null; to: string | null; areas: { key: string; count: number }[] };
export type SystemReport = {
  modules: string[]; migrations: { version: number; name: string; appliedOn: string | null }[] | null;
  policies: { id: string; title: string; status: string }[];
};

function query(from: string, to: string, line?: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (line) params.set("businessLine", line);
  const text = params.toString();
  return text ? `?${text}` : "";
}
export const getSalesReport = (from: string, to: string, line?: string) => wrapped<SalesReport>(`/ws/ioeti/reports/sales${query(from, to, line)}`);
export const getAreasReport = (from: string, to: string) => wrapped<AreasReport>(`/ws/ioeti/reports/areas${query(from, to)}`);
export const getSystemReport = () => wrapped<SystemReport>("/ws/ioeti/reports/system");

/** CSV with a BOM so Excel opens Arabic correctly; every cell quoted, and text that a spreadsheet would
 * run as a formula (= + - @ tab, carriage return) is prefixed with an apostrophe. */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const text = typeof v === "number" ? String(v) : String(v ?? "").replace(/^([=+\-@\t\r])/, "'$1");
    return `"${text.replace(/"/g, '""')}"`;
  };
  return "\uFEFF" + [header, ...rows].map(r => r.map(cell).join(",")).join("\r\n");
}
export function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
