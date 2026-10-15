/**
 * Candle colours for the detail chart. Up candles are always the up token, whatever the day's
 * direction. colorAccent is the day's accent (the chart's line and fallbacks), so it follows the
 * direction. Passing only colorAccent let TVChart paint up candles in --down on a down day.
 */
export function detailChartColours(deltaPct: number): { colorAccent: string; upColor: string } {
  return {
    colorAccent: deltaPct >= 0 ? "var(--up)" : "var(--down)",
    upColor: "var(--up)",
  };
}
