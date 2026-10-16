/**
 * The colour of up candles (and their wicks). It is a fixed token: an up candle is red on every
 * day, whatever colour the chart's accent takes. `colorAccent` colours the line and the volume
 * fallback only, so it is deliberately not an input here. Without this, a down day's accent
 * (--down) painted up candles blue -- the 2026-10-14 market defect and its detail-page recurrence.
 */
export function candleUpColour({ upColor }: { colorAccent?: string; upColor?: string }): string {
  return upColor ?? "var(--up)";
}
