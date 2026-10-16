import { formatNumber, type FormatLocale } from "@/lib/format";
import type { SignalName } from "./verdictTypes";

/**
 * One formatter per signal. There is deliberately NO shared formatValue().
 *
 * The four rows arrive as bare JSON numbers in four different units:
 *
 *   drawdown    -0.0939  fractional decline from the running peak  -> -9.4%
 *   volume       1.1951  recent mean volume / baseline mean volume -> x1.20
 *   trailing_pe 24.3     price / EPS, a multiple                   -> 24.3
 *   dcf_gap      0.182   (intrinsic - price) / price, NO horizon   -> +18.2%
 *
 * A single formatter across all four renders volume's 1.1951 as "119.5%",
 * which states a proportion the number is not. The panel's whole purpose is
 * that a figure travels with its basis; formatting it in the wrong unit
 * breaks that at the last step.
 *
 * The labels and basis lines are in the catalogs (valuation.signal, valuation.unitNote).
 */

export function formatSignalValue(signal: SignalName, value: number, locale: FormatLocale = "en"): string {
  switch (signal) {
    case "drawdown":
      // A decline is already negative; the signed percent supplies the sign.
      return formatNumber(value, "percent", { signed: true, locale });
    case "dcf_gap":
      return formatNumber(value, "percent", { signed: true, locale });
    case "volume":
      // A ratio. "x1.20" cannot be misread as a proportion.
      return `×${formatNumber(value, "ratio", { locale })}`;
    case "trailing_pe":
      return formatNumber(value, "ratio", { digits: 1, locale });
  }
}
