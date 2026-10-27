/**
 * One way to show figures across the record screens. Amounts are written left to right with Latin digits, thousands
 * separators and two decimals ("3,000.00 EGP"), as accounting documents are. The server sends decimals as strings with
 * up to ten places; they are never shown raw.
 */
const amountFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantityFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

function numeric(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** "3,000.00 EGP"; "—" when there is no amount. */
export function amount(value: string | number | null | undefined, currency?: string | null): string {
  const n = numeric(value);
  return n === null ? "—" : amountFormat.format(n) + (currency ? " " + currency : "");
}

/** A quantity or rate without trailing zeros: "2", "1.5", "14". */
export function quantity(value: string | number | null | undefined): string {
  const n = numeric(value);
  return n === null ? "—" : quantityFormat.format(n);
}
