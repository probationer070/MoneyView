/**
 * Mirrors apps/api/models/schema_parts/valuation.py.
 *
 * `value` and `reason` are MUTUALLY EXCLUSIVE -- the model's own docstring says
 * so. `source` is present on every row, including refused ones: a refused
 * trailing_pe still reports "Damodaran", naming where the figure would have
 * come from.
 */
export interface VerdictRow {
  value: number | null;
  comparison: string | null;
  source: string;
  reason: string | null;
}

export interface VerdictPanel {
  ticker: string;
  /** A FIXED constant string, identical for every ticker. Framing, not a verdict. */
  direction: string;
  rows: Record<string, VerdictRow>;
}

/** Fixed display order. Never sorted by magnitude -- see the plan's constraints. */
export const SIGNAL_ORDER = ["drawdown", "volume", "trailing_pe", "dcf_gap"] as const;

export type SignalName = (typeof SIGNAL_ORDER)[number];

/** Only the fields the picker needs; the endpoint returns more. */
export interface WatchlistItem {
  ticker: string;
  name: string;
  sector?: string;
}
