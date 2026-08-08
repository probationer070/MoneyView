export interface PortfolioPreferences {
  total_investment_amount: number;
  transaction_fee_rate: number;
  updated_at: string;
}

/**
 * Snapshot-history contract.
 *
 * Hand-written and re-exported by `index.ts` *in preference to* the generated interface of
 * the same name. `generated/portfolio.ts` is produced by a manual two-step that nothing
 * enforces, and its copy had drifted months behind the backend model: no
 * `metric_schema_version`, and both nullable averages typed `?: number`. Same name, wrong
 * shape, no error anywhere -- which is the reason this lives here rather than being left to
 * the next regeneration.
 *
 * Mirrors `CorporateComparisonHistoryPoint` in `apps/api/models/schema_parts/corporate.py`.
 */
export interface CorporateComparisonHistoryPoint {
  as_of_date: string;
  generated_at: string;
  snapshot_version: string;
  snapshot_source: string;
  comparison_universe: string;
  benchmark_ticker: string;
  stock_count: number;
  // Nullable: both averages cover only the rows whose equity bridge resolved, so a
  // snapshot with no such rows has no average at all. Render an unavailable state,
  // never a zero.
  average_expected_return_spread: number | null;
  average_roic_minus_wacc: number;
  average_dcf_value: number | null;
  // Which definition average_dcf_value carries: enterprise value below 2, intrinsic value
  // per share from 2 on. 0 means the snapshot predates the stored column.
  metric_schema_version: number;
  market_expected_return: number;
}

export interface CorporateComparisonHistoryResponse {
  comparison_universe: string;
  benchmark_ticker: string;
  custom_tickers: string[];
  points: CorporateComparisonHistoryPoint[];
}
