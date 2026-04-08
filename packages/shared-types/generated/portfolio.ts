// AUTO-GENERATED FROM BACKEND PYDANTIC SCHEMAS.
// DO NOT EDIT BY HAND. Regenerate with:
//   python scripts/export_schema.py
//   npx json2ts packages/shared-types/generated/portfolio.schema.json > packages/shared-types/generated/portfolio.ts

export type PeriodEnum = "1w" | "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y";
export type AttributionMethodEnum = "brinson_fachler_arithmetic";
export type ReturnFrequencyEnum = "daily" | "monthly";
export type RebalancingEnum = "bop" | "eop";
export type RiskMethodEnum = "historical";
export type BenchmarkWeightsSourceEnum = "provider_derived" | "user_provided";
export type ReportExportFormatEnum = "html" | "pdf" | "markdown" | "csv" | "json";

export interface RiskProfileInput {
  beta_rolling_window?: number;
  var_method?: RiskMethodEnum;
  var_confidence_level?: number;
  var_horizon_days?: number;
  es_method?: RiskMethodEnum;
  es_confidence_level?: number;
  es_horizon_days?: number;
}

export interface AttributionRequest {
  tickers: string[];
  weights: number[];
  benchmark?: string;
  period?: PeriodEnum;
  currency?: string;
  return_frequency?: ReturnFrequencyEnum;
  rebalancing?: RebalancingEnum;
  attribution_method?: AttributionMethodEnum;
  allow_cash?: boolean;
  allow_short?: boolean;
  allow_synthetic_fallback?: boolean;
  allow_benchmark_proxy?: boolean;
  date_from?: string | null;
  as_of_date?: string | null;
  benchmark_weights?: number[] | null;
  risk_profile?: RiskProfileInput;
}

export interface AttributionTotals {
  portfolio_return: number;
  benchmark_return: number;
}

export interface AttributionEffects {
  allocation: number;
  selection: number;
  interaction: number;
}

export interface SectorAttribution {
  sector: string;
  portfolio_weight: number;
  benchmark_weight: number;
  portfolio_return: number;
  benchmark_return: number;
  allocation_effect: number;
  selection_effect: number;
  interaction_effect: number;
  active_contribution: number;
}

export interface RiskMetrics {
  beta: number;
  beta_rolling_window: number;
  var_95_1d: number;
  es_95_1d: number;
  var_method?: RiskMethodEnum;
  es_method?: RiskMethodEnum;
}

export interface AttributionDataContract {
  return_frequency: ReturnFrequencyEnum;
  rebalancing_assumption: RebalancingEnum;
  timezone_cutoff?: string;
  timezone?: string;
  currency?: string;
  fx_handling?: string;
  corporate_actions?: string;
  benchmark_source?: string;
  sector_taxonomy?: string;
  missing_data_fallback?: string;
}

export interface AttributionDataQuality {
  synthetic_data_used?: boolean;
  synthetic_tickers?: string[];
  benchmark_proxy_used?: boolean;
  benchmark_proxy_method?: string | null;
  limitations?: string[];
}

export interface AttributionMetadata {
  method: AttributionMethodEnum;
  benchmark: string;
  benchmark_weights_source: BenchmarkWeightsSourceEnum;
  period: PeriodEnum;
  schema_version?: string;
  generated_at: string;
  portfolio_hash: string;
  cache_key: string;
  cache_hit?: boolean;
  data_contract: AttributionDataContract;
  data_quality?: AttributionDataQuality;
}

export interface AttributionResult {
  totals: AttributionTotals;
  active_return: number;
  effects: AttributionEffects;
  sector_breakdowns: SectorAttribution[];
  risk_metrics: RiskMetrics;
  metadata: AttributionMetadata;
}

export interface ReportFilters {
  period?: PeriodEnum;
  date_from?: string | null;
  date_to?: string | null;
  benchmark?: string;
  currency?: string;
}

export interface ReportOptions {
  formats?: ReportExportFormatEnum[];
  include_risk_metrics?: boolean;
  include_sector_table?: boolean;
  include_methodology?: boolean;
}

export interface ReportSummaryRequest {
  tickers: string[];
  weights: number[];
  filters?: ReportFilters;
  report_options?: ReportOptions;
  attribution_method?: AttributionMethodEnum;
  version?: string;
  allow_cash?: boolean;
  allow_short?: boolean;
  allow_synthetic_fallback?: boolean;
  allow_benchmark_proxy?: boolean;
  benchmark_weights?: number[] | null;
  risk_profile?: RiskProfileInput;
}

export interface ReportPayload {
  version: string;
  schema_version?: string;
  generated_at: string;
  portfolio_hash: string;
  filters: ReportFilters;
  report_options: ReportOptions;
  attribution: AttributionResult;
  executive_summary: string;
  markdown_content: string;
}

export interface ReportExportRequest {
  request: ReportSummaryRequest;
  format: ReportExportFormatEnum;
}

export interface ReportExportResponse {
  format: ReportExportFormatEnum;
  content_type: string;
  filename: string;
  content: string;
}
