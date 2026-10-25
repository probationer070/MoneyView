import type { Bar } from "./types";

/** Trading days of returns behind the price yardstick, and of volume behind the volume yardstick. */
const RETURN_WINDOW = 60;
const VOLUME_WINDOW = 20;

export interface BigMove {
  date: string;
  /** The day's close-to-close return in percent units (6 is +6%). */
  returnPct: number;
  /** |return| divided by the sample standard deviation of the previous 60 daily returns. */
  priceRatio: number;
  /** Volume divided by the mean of the previous 20 days; null when that cannot be computed. */
  volumeRatio: number | null;
  /** True when the volume test also passed (drawn filled). */
  strong: boolean;
  up: boolean;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStdev(values: number[]): number {
  const centre = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - centre) ** 2, 0) / (values.length - 1));
}

/**
 * The days that moved far more than usual, newest first.
 * A day qualifies when |r_t| / sd_t >= thresholds.price (hollow), and is strong when the volume
 * threshold is above 0 and volume_t / mean(volume_{t-20..t-1}) >= thresholds.volume. `from` limits
 * which days are reported; earlier bars still feed the windows.
 */
export function detectBigMoves(bars: Bar[], thresholds: { price: number; volume: number }, from?: string): BigMove[] {
  const returns: number[] = bars.map((bar, i) => (i === 0 ? NaN : bar.close / bars[i - 1].close - 1));
  const moves: BigMove[] = [];
  // Index t needs returns t-60..t-1, which exist from t = 61 (return 0 is undefined).
  for (let t = RETURN_WINDOW + 1; t < bars.length; t++) {
    const bar = bars[t];
    if (from !== undefined && bar.date < from) continue;
    const sd = sampleStdev(returns.slice(t - RETURN_WINDOW, t));
    if (!(sd > 0) || !Number.isFinite(returns[t])) continue;
    const priceRatio = Math.abs(returns[t]) / sd;
    if (!(priceRatio >= thresholds.price)) continue;

    let volumeRatio: number | null = null;
    if (t >= VOLUME_WINDOW) {
      const average = mean(bars.slice(t - VOLUME_WINDOW, t).map((b) => b.volume));
      if (average > 0) volumeRatio = bar.volume / average;
    }
    const strong = thresholds.volume > 0 && volumeRatio !== null && volumeRatio >= thresholds.volume;
    moves.push({ date: bar.date, returnPct: returns[t] * 100, priceRatio, volumeRatio, strong, up: returns[t] >= 0 });
  }
  return moves.reverse();
}
