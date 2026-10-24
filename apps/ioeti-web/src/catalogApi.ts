import { ApiError, wrapped, type CatalogProduct } from "./api";
import { DEMO_MODE } from "./demo";

/** The service catalogue (capability map: service catalogue). The server checks the native product
 * permissions on every call; the screen only follows what it answers. */
export type CatalogService = {
  id: number; version: number; code: string; name: string; summary: string | null; type: "service" | "storable";
  unitId: number | null; unit: string | null; salePrice: string | number | null; currencyCode: string | null; onSale: boolean;
  categoryId: number | null; category: string | null; startDate: string | null; endDate: string | null; accountingReady: boolean;
};
export type CatalogOption = { id: number; name: string };
export type ServiceInput = {
  code?: string; name?: string; summary?: string; type?: "service" | "storable"; unitId?: number | ""; salePrice?: string;
  currencyCode?: string; categoryId?: number | ""; onSale?: boolean; startDate?: string; endDate?: string;
};

const BASE = "/ws/ioeti/catalog/products";
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
async function list<T>(url: string): Promise<T[]> {
  if (DEMO_MODE) return [];
  const values = await wrapped<T[]>(url);
  if (!Array.isArray(values)) throw new ApiError(502, "Invalid response");
  return values;
}

/** The whole catalogue for people who may change it; 403 for everyone else. */
export const getManagedCatalog = (q = "", offset = 0) =>
  list<CatalogService>(`${BASE}?all=true&limit=50&offset=${offset}&q=${encodeURIComponent(q)}`);
/** The services on sale, as sellers see them for quotations. */
export const getSellableCatalog = (q = "", offset = 0) =>
  list<CatalogProduct>(`${BASE}?limit=50&offset=${offset}&q=${encodeURIComponent(q)}`);
export const getService = (id: number) => wrapped<CatalogService>(`${BASE}/${encodeURIComponent(id)}`);
export const addService = (input: ServiceInput) => wrapped<CatalogService>(BASE, json(input));
export const changeService = (id: number, version: number, input: ServiceInput) =>
  wrapped<CatalogService>(`${BASE}/${encodeURIComponent(id)}`, json({ version, ...input }));
export const getUnits = () => list<CatalogOption>(`${BASE}/units`);
export const getCategories = () => list<CatalogOption>(`${BASE}/categories`);
