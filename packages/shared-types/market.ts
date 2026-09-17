/**
 * Market contracts mirrored from `apps/api/models/schema_parts/market.py`.
 */

/** Where an event came from. Decides whether it can be edited and what the tooltip says. */
export type EventOrigin = "builtin" | "rule" | "user";

/**
 * A dated event drawn as a vertical line on price charts.
 *
 * Mirrors `MarketEvent` in `apps/api/models/schema_parts/market.py`.
 *
 * `source` is non-null for `builtin` and `rule` events -- the backend refuses them without one --
 * and may be null only for a user's own event, which the tooltip then labels as unsourced.
 * `missing_category` is set only on a user event whose category no longer exists; `category`
 * is then `uncategorized`.
 */
export interface MarketEvent {
  id: string;
  label: string;
  category: string;
  start_date: string;
  end_date: string | null;
  source: string | null;
  note: string;
  origin: EventOrigin;
  missing_category: string | null;
}

/** A resolved event category. Mirrors `EventCategory`. `visible` is the global chart filter. */
export interface EventCategory {
  id: string;
  label: string;
  /** `#RRGGBB`. */
  color: string;
  origin: "builtin" | "user";
  visible: boolean;
  overridden: boolean;
}

/** A user event as submitted. Mirrors `MarketEventInput`; `id` and `origin` are the server's. */
export interface MarketEventInput {
  label: string;
  category: string;
  start_date: string;
  end_date?: string | null;
  source?: string | null;
  note?: string;
}

/** Mirrors `EventCategoryInput`. */
export interface EventCategoryInput {
  label: string;
  /** `#RRGGBB`. */
  color: string;
}

/** Mirrors `EventCategoryPatch`: only the fields present change. */
export interface EventCategoryPatch {
  label?: string;
  color?: string;
  visible?: boolean;
}

/** One date on a relative-strength series. Mirrors `MarketSpreadPoint`. */
export interface MarketSpreadPoint {
  date: string;
  value: number;
}

/**
 * Relative strength of one ticker against another, indexed to 100 at the base date.
 *
 * Mirrors `MarketSpread` in `apps/api/models/schema_parts/market.py`.
 *
 * `basis` is non-empty on every row, refusals included, and `refused_reason` and a
 * populated `series` are mutually exclusive: an empty series with no reason would render
 * as a flat result rather than an absence. Window figures are calendar days; `observations`
 * carries the session count.
 */
export interface MarketSpread {
  id: string;
  label: string;
  numerator: string;
  denominator: string;
  requested_window_days: number;
  actual_window_start: string | null;
  actual_window_end: string | null;
  actual_window_days: number | null;
  observations: number;
  basis: string;
  series: MarketSpreadPoint[];
  latest: number | null;
  refused_reason: string | null;
}
