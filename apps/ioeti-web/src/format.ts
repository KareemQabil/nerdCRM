/**
 * One way to show figures across the record screens. Amounts are written left to right with Latin digits, thousands
 * separators and two decimals ("3,000.00 EGP"), as accounting documents are. The server sends decimals as strings with
 * up to ten places; they are never shown raw.
 */
const amountFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wholeFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const quantityFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const rateFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });

function numeric(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** "3,000.00 EGP"; "—" when there is no amount. `whole` rounds to the unit, for headline figures ("3,000 EGP"). */
export function amount(value: string | number | null | undefined, currency?: string | null, whole = false): string {
  const n = numeric(value);
  return n === null ? "—" : (whole ? wholeFormat : amountFormat).format(n) + (currency ? " " + currency : "");
}

/** An exchange rate, up to six decimals: "48.5", "0.020619". */
export function rate(value: string | number | null | undefined): string {
  const n = numeric(value);
  return n === null ? "—" : rateFormat.format(n);
}

/** A calendar day ("2026-10-27") in the reader's language: "27 أكتوبر 2026" / "27 Oct 2026". */
export function day(value: string | null | undefined, ar: boolean): string {
  return value ? new Date(value.slice(0, 10) + "T00:00:00").toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

/** A quantity or percentage without trailing zeros: "2", "1.5", "14". */
export function quantity(value: string | number | null | undefined): string {
  const n = numeric(value);
  return n === null ? "—" : quantityFormat.format(n);
}
