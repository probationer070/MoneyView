/**
 * Mirrors apps/api/models/schema_parts/decision.py.
 *
 * Both percent fields carry `_pct` because they sit on the same scatter and a
 * raw fraction beside a percent would put them 100x apart. They are NOT
 * commensurable despite sharing a unit: `dcf_implied_return_pct` is total
 * upside with no time horizon, `price_move_pct` is a move over a stated
 * period. Never combine them.
 */
export type DecisionAction = "buy" | "sell" | "watch" | "pass";

export interface DecisionOutcome {
  decided_on: string;
  price_now: number | null;
  price_date: string | null;
  price_move_pct: number | null;
  /** Why there is no outcome yet. Content, not an error. */
  reason: string | null;
}

export interface DecisionRow {
  id: number;
  ticker: string;
  decided_at: string;
  action: string;
  memo: string;
  price_at_decision: number | null;
  dcf_value: number | null;
  dcf_implied_return_pct: number | null;
  roic: number | null;
  wacc: number | null;
  risk_free_rate: number | null;
  equity_risk_premium: number | null;
  metric_schema_version: number | null;
  figures_source: string;
  /** Stored INSTEAD of the figures when the model could not value the ticker. */
  figures_unavailable_reason: string | null;
  outcome: DecisionOutcome;
}

export const DECISION_ACTIONS: DecisionAction[] = ["buy", "sell", "watch", "pass"];
