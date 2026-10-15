/**
 * The colour of a multi-day path: its own first-to-last direction. A window that ends where it
 * began counts as up, as the sparkline always has. The day's delta never colours a path; it
 * colours only the day's figures (DeltaBadge), which is why no caller passes a sparkline colour.
 */
export function windowTone(series: readonly number[]): "up" | "down" {
  if (series.length === 0) return "up";
  return series[series.length - 1] >= series[0] ? "up" : "down";
}
