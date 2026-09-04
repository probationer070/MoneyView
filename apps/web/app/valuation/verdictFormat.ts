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
 */

export const SIGNAL_LABELS: Record<SignalName, string> = {
  drawdown: "Drawdown from peak",
  volume: "Volume vs baseline",
  trailing_pe: "Trailing PE",
  dcf_gap: "Gap to fair value",
};

/** The basis line under each figure. `dcf_gap` names its lack of a horizon. */
export const SIGNAL_UNIT_NOTE: Record<SignalName, string> = {
  drawdown: "percent of the 252-bar peak",
  volume: "multiple of the baseline mean",
  trailing_pe: "price ÷ earnings, a multiple",
  dcf_gap: "total gap, no time horizon",
};

function percent(value: number, decimals = 1): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(decimals)}%`;
}

export function formatSignalValue(signal: SignalName, value: number): string {
  switch (signal) {
    case "drawdown":
      // A decline is already negative; percent() supplies the sign.
      return percent(value);
    case "dcf_gap":
      return percent(value);
    case "volume":
      // A ratio. "x1.20" cannot be misread as a proportion.
      return `×${value.toFixed(2)}`;
    case "trailing_pe":
      return value.toFixed(1);
  }
}
