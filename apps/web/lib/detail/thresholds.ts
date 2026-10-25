export interface Thresholds { price: number; volume: number }

export const DEFAULT_THRESHOLDS: Thresholds = { price: 2, volume: 2 };
export const PRICE_RANGE = { min: 0.5, max: 10 } as const;
export const VOLUME_RANGE = { min: 0, max: 10 } as const;
const STORAGE_KEY = "moneyview.detail.bigMove";

/** Clamp to the range and to the 0.1 step; a non-number falls back to the fallback. */
export function clampThreshold(value: number, range: { min: number; max: number }, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.round(Math.min(range.max, Math.max(range.min, value)) * 10) / 10;
}

function clamped(price: number, volume: number): Thresholds {
  return {
    price: clampThreshold(price, PRICE_RANGE, DEFAULT_THRESHOLDS.price),
    volume: clampThreshold(volume, VOLUME_RANGE, DEFAULT_THRESHOLDS.volume),
  };
}

/** The saved thresholds, or the defaults when storage is blocked, empty or holds junk. */
export function readThresholds(): Thresholds {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { ...DEFAULT_THRESHOLDS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_THRESHOLDS };
    const { price, volume } = parsed as { price?: unknown; volume?: unknown };
    return clamped(typeof price === "number" ? price : NaN, typeof volume === "number" ? volume : NaN);
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
}

export function writeThresholds(thresholds: Thresholds): void {
  try {
    const { price, volume } = clamped(thresholds.price, thresholds.volume);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ price, volume }));
  } catch {
    // Blocked storage: the thresholds last for this visit only.
  }
}
