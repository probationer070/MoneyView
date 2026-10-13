/**
 * The one number formatter. Figures align because every figure goes through here and is set
 * in Geist Mono (type-mono / type-figure*), whose digits are fixed-width.
 *
 * signDisplay "negative", not "auto": "auto" prints -0.04 at one digit as "-0.0".
 * The minus is ASCII "-", not the redesign's U+2212: pasted figures must stay numbers in a
 * spreadsheet (plan R13). Percent inputs are fractions: 0.123 -> "12.3%".
 */
export type NumberKind = "price" | "percent" | "ratio" | "multiple" | "integer" | "compact";
export type FormatLocale = "en" | "ko";
export const MISSING = "—";

const DIGITS: Record<NumberKind, number> = { price: 2, percent: 1, ratio: 2, multiple: 1, integer: 0, compact: 1 };
const INTL: Record<FormatLocale, string> = { en: "en-US", ko: "ko-KR" };

export function formatNumber(
  value: number | null | undefined,
  kind: NumberKind,
  { digits = DIGITS[kind], signed = false, locale = "en" }: { digits?: number; signed?: boolean; locale?: FormatLocale } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return MISSING;
  const body = new Intl.NumberFormat(INTL[locale], {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    notation: kind === "compact" ? "compact" : "standard",
    signDisplay: signed ? "exceptZero" : "negative",
  }).format(kind === "percent" ? value * 100 : value);
  return kind === "percent" ? `${body}%` : kind === "multiple" ? `${body}x` : body;
}
