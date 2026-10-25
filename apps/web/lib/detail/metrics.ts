import type { Bar } from "./types";

// Indicators the detail tiles show, all from daily bars (ascending). Each returns null when there are
// too few bars, never 0. Returns are in percent units.

const closes = (bars: Bar[]) => bars.map((bar) => bar.close);

/** Percent change of the last close against the close n bars earlier. Needs n + 1 bars. */
export function trendReturn(bars: Bar[], n: number): number | null {
  if (bars.length < n + 1) return null;
  const base = bars[bars.length - 1 - n].close;
  return base === 0 ? null : (bars[bars.length - 1].close / base - 1) * 100;
}

/** Simple average of the last n closes. Needs n bars. */
export function sma(bars: Bar[], n: number): number | null {
  if (bars.length < n) return null;
  return closes(bars).slice(-n).reduce((sum, value) => sum + value, 0) / n;
}

/** Wilder RSI(14): the first average is a simple mean of 14 changes, later ones are smoothed. Needs 15 bars. */
export function rsi14(bars: Bar[]): number | null {
  const period = 14;
  if (bars.length < period + 1) return null;
  const values = closes(bars);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change > 0) gain += change; else loss -= change;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

/** The last bar's volume over the mean of the 20 bars before it. Needs 21 bars; null when that mean is 0. */
export function volumeMultiple(bars: Bar[]): number | null {
  if (bars.length < 21) return null;
  const prior = bars.slice(-21, -1).reduce((sum, bar) => sum + bar.volume, 0) / 20;
  return prior === 0 ? null : bars[bars.length - 1].volume / prior;
}

/** Percent of the last close from the highest high of the last n bars (0 or negative). Needs n bars. */
export function pctFromHigh(bars: Bar[], n: number): number | null {
  if (bars.length < n) return null;
  const high = Math.max(...bars.slice(-n).map((bar) => bar.high));
  return high === 0 ? null : (bars[bars.length - 1].close / high - 1) * 100;
}

/** The latest session: its percent change from the bar before, and its own high and low. Needs 2 bars. */
export function yesterday(bars: Bar[]): { returnPct: number; high: number; low: number } | null {
  if (bars.length < 2) return null;
  const last = bars[bars.length - 1];
  const previous = bars[bars.length - 2].close;
  if (previous === 0) return null;
  return { returnPct: (last.close / previous - 1) * 100, high: last.high, low: last.low };
}
