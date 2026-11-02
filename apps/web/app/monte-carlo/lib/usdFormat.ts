import { formatNumber, MISSING, type FormatLocale } from "@/lib/format";

// Valuation-tab per-share amounts are dollars in both locales (owner, 2026-11-01): the price lookup returns a USD
// quote. Two decimals; the sign goes before the $ (-$5.00); a value that rounds to zero prints $0.00, never -$0.00
// (cents gives -0 for it, and -0 < 0 is false). Rounding is on the magnitude, so -2.345 and 2.345 mirror each other.
function cents(value: number): number {
  const rounded = Math.round(Math.abs(value) * 100) / 100;
  return value < 0 ? -rounded : rounded;
}

export function usd(value: number, locale: FormatLocale): string {
  if (!Number.isFinite(value)) return MISSING;
  const amount = cents(value);
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${formatNumber(Math.abs(amount), "price", { locale })}`;
}

// A dollar interval: each end is a full figure with its own sign, joined by an en dash. Either side missing reads a dash.
export function formatUsdRange(lo: number | null, hi: number | null, locale: FormatLocale): string {
  if (lo === null || hi === null || !Number.isFinite(lo) || !Number.isFinite(hi)) return MISSING;
  return `${usd(lo, locale)}–${usd(hi, locale)}`;
}
