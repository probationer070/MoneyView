/**
 * Market contracts mirrored from `apps/api/models/schema_parts/market.py`.
 */

/**
 * A dated market-moving event, drawn as a vertical line on price charts.
 *
 * Mirrors `MarketEvent` in `apps/api/models/schema_parts/market.py`.
 *
 * `source` is required and non-empty on the backend, and the loader refuses an event
 * without one. These dates are asserted -- claims about the world rather than computations
 * over price bars -- so the citation is the only thing that lets a reader check a line
 * instead of trusting it. Typed as a plain `string` here for that reason: an optional field
 * would invite a caller to omit what the API guarantees.
 *
 * `end_date` is `null` for a point-in-time event, which is the common case.
 */
export interface MarketEvent {
  id: string;
  label: string;
  category: string;
  start_date: string;
  end_date: string | null;
  source: string;
  note: string;
}
