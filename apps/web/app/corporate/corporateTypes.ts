export interface CorporateCompany {
  ticker: string;
  name: string;
  sector?: string;
  source?: string;
  preset?: {
    growth: number;
    roic: number;
    wacc: number;
    debtRatio: number;
    unleveredBeta: number;
  };
}

export interface WatchlistHolding {
  ticker: string;
  name: string;
  sector: string;
  group_name: string;
  weight: number;
}

export interface CorporateAssumptions {
  ticker: string;
  growth: number;
  roic: number;
  wacc: number;
  debtRatio: number;
  unleveredBeta: number;
  crp: number;
  reinvestment: number;
  fcff: number;
  innovation: number;
  marketShare: number;
  governance: number;
  esgPenalty: number;
}

export interface StockPriceRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ImpliedErpInputs {
  indexLevel: number;
  dividendYield: number;
  buybackYield: number;
  growthRates: number[];
  stableGrowth: number;
  riskFreeRate: number;
}

export interface CorporateMetricsApi {
  ticker: string;
  growth: number;
  growth_avg_legacy?: number | null;
  growth_cagr_v2?: number | null;
  roic: number;
  roic_legacy?: number | null;
  roic_stable_v2?: number | null;
  wacc: number;
  debt_ratio: number;
  unlevered_beta: number;
  crp: number;
  reinvestment: number;
  fcff: number;
  innovation: number;
  market_share: number;
  governance: number;
  esg_penalty: number;
  growth_meta?: CorporateDerivedMetricMeta | null;
  roic_meta?: CorporateDerivedMetricMeta | null;
}

export interface CorporateDerivedMetricMeta {
  method: string;
  quality: "ok" | "estimated" | "stale" | "suspicious" | "invalid" | "missing";
  reason: string | null;
  warnings: string[];
  confidence: number;
  source: string;
  calculation_version: string;
  metric_role: "primary" | "supporting" | "fallback";
  as_of: string | null;
}

export type RoicBasis = "recent_average" | "all_year_average" | "annual";

export interface AnnualMetricPoint {
  year: number;
  value: number | null;
}

export interface CorporateMetricHistoryApi {
  ticker: string;
  start_year: number;
  country_risk_premium: number;
  growth_cagr: number | null;
  growth_recent_average: number | null;
  annual_growth_rates: AnnualMetricPoint[];
  roic_recent_average: number | null;
  roic_all_year_average: number | null;
  annual_roic: AnnualMetricPoint[];
}

export interface QuarterlyStatementRow {
  ticker: string;
  statement: string;
  period: string;
  metric: string;
  value: number;
}

export interface QuarterlyStatementsApi {
  ticker: string;
  source: string;
  rows: QuarterlyStatementRow[];
}

export interface CorporateComparisonRowApi {
  ticker: string;
  name: string;
  sector: string;
  group_name: string;
  weight: number;
  roic: number;
  wacc: number;
  roic_minus_wacc: number;
  dcf_value: number;
  current_price: number;
  dcf_implied_return: number;
  capm_expected_return: number;
  stock_expected_return: number;
  market_expected_return: number;
  expected_return_spread: number;
  stock_expected_return_source: string;
  has_price_data: boolean;
}

export interface CorporateComparisonSnapshotApi {
  mode: "snapshot" | "live";
  as_of_date: string;
  generated_at: string;
  snapshot_version: string;
  snapshot_versions_for_day: number;
  snapshot_available: boolean;
  snapshot_source: string;
  comparison_universe: "portfolio_plus_benchmark" | "watchlist_plus_benchmark" | "custom";
  benchmark_ticker: string;
  custom_tickers: string[];
  snapshot_cadence: string;
  snapshot_retention_days: number;
  snapshot_is_stale: boolean;
}

export interface CorporateComparisonApi {
  market_expected_return: number;
  risk_free_rate: number;
  equity_risk_premium: number;
  stock_expected_return_method: string;
  comparison_reference_return_method: string;
  snapshot: CorporateComparisonSnapshotApi;
  rows: CorporateComparisonRowApi[];
}

export type ComparisonSortKey = "roic_minus_wacc" | "dcf_value" | "expected_return_spread";
export type ComparisonUniverse = "watchlist_plus_benchmark" | "custom";

export interface RawDatasetRow {
  dataset: string;
  field: string;
  value: string;
  source: string;
}

export interface DcfRequestSnapshot {
  ticker: string;
  growth: number;
  roic: number;
  wacc: number;
  debtRatio: number;
  unleveredBeta: number;
  crp: number;
  reinvestment: number;
  fcff: number;
  esgPenalty: number;
}

export interface ComparisonRequestSnapshot {
  comparisonUniverse: ComparisonUniverse;
  comparisonBenchmarkTicker: string;
  comparisonCustomTickersInput: string;
}

export interface CachedCalculation<TSnapshot, TResult> {
  snapshot: TSnapshot;
  result: TResult;
  lastUpdatedAt: string;
}
