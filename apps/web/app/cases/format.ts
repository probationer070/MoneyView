import { formatNumber, type FormatLocale } from "@/lib/format";

export function fmtMoney(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function fmtPerShare(value: number, locale: FormatLocale = "en"): string {
  return formatNumber(value, "price", { locale });
}

export function fmtSigned(value: number): string {
  return `${value >= 0 ? "+" : "−"}${fmtPerShare(Math.abs(value))}`;
}
