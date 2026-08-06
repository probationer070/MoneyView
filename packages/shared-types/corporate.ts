export interface DcfSummary {
  report_id: string;
  ticker: string;
  estimated_value: number;
  intrinsic_value_per_share: number | null;
  enterprise_value: number;
  equity_value: number | null;
  valuation_method: string;
  bridge_quality: string;
  current_price: number;
  upside_pct: number;
  /**
   * Share of enterprise value carried by the discounted terminal value. A high reading
   * says the valuation rests on the perpetuity assumption rather than on the explicit
   * forecast.
   */
  terminal_value_share_pct: number;
  status: string;
  generated_at: string;
}

export interface DcfAssumptionSummary {
  report_id: string;
  ticker: string;
  generated_at: string;
  wacc_used: number;
  margin_used: number;
  growth_used: number;
  fcff_used: number;
  esg_penalty_used: number;
  terminal_growth_used: number;
  enterprise_value_index: number;
}

export interface DcfProjectionRow {
  year: number;
  projected_fcff: number;
  discount_factor: number;
  present_value: number;
}

export interface DcfWaccBreakdown {
  risk_free_rate: number;
  unlevered_beta: number;
  debt_ratio: number;
  tax_rate: number;
  equity_risk_premium: number;
  country_risk_premium: number;
}

/**
 * One (WACC, terminal growth) point of the sensitivity grid.
 *
 * When `undefined_reason` is set every value is null together: the Gordon growth model
 * has no value at that point, and the grid is swept precisely to reach it.
 * `intrinsic_value_per_share` is additionally null whenever the equity bridge did not
 * resolve, on the same rule the headline valuation follows.
 */
export interface DcfSensitivityCell {
  wacc: number;
  terminal_growth: number;
  is_base: boolean;
  enterprise_value: number | null;
  terminal_value_share_pct: number | null;
  intrinsic_value_per_share: number | null;
  undefined_reason: string | null;
}

/** Row-major with WACC on the outer axis. */
export interface DcfSensitivityGrid {
  wacc_values: number[];
  terminal_growth_values: number[];
  cells: DcfSensitivityCell[];
}

export interface DcfFullReport {
  summary: DcfSummary;
  assumptions: DcfAssumptionSummary;
  projection_rows: DcfProjectionRow[];
  wacc_breakdown: DcfWaccBreakdown;
  terminal_cash_flow: number;
  terminal_value: number;
  present_value_of_terminal: number;
  present_value_of_fcff: number;
  enterprise_value: number;
  equity_value: number | null;
  intrinsic_value_per_share: number | null;
  net_debt: number | null;
  non_operating_assets: number | null;
  diluted_shares_outstanding: number | null;
  valuation_method: string;
  bridge_quality: string;
  terminal_value_share_pct: number;
  sensitivity: DcfSensitivityGrid;
  agency_discount: number;
  dcf_multiple: number;
  baseline_multiple: number;
  fcff_scale: number;
}

export interface DcfSummaryResponse extends DcfSummary {
  wacc_used: number;
  margin_used: number;
  growth_used: number;
  fcff_used: number;
  esg_penalty_used: number;
  terminal_growth_used: number;
  enterprise_value_index: number;
}

export interface DcfPhase1Event {
  phase: "phase1";
  summary: DcfSummary;
}

export interface DcfPhase2Event {
  phase: "phase2";
  assumptions: DcfAssumptionSummary;
}

export interface DcfCompleteEvent {
  phase: "complete";
  report_id: string;
  generated_at: string;
}

export type DcfStreamEvent = DcfPhase1Event | DcfPhase2Event | DcfCompleteEvent;

export interface CorporateComparisonSnapshotDeleteResult {
  snapshot_version: string;
  deleted_rows: number;
}

export interface CorporateDcfBatchRequest {
  tickers: string[];
}

export type MetricQuality =
  | "ok"
  | "estimated"
  | "stale"
  | "suspicious"
  | "invalid"
  | "missing";

export interface CorporateMetricAuditInput {
  field: string;
  label: string;
  value: number | null;
  display_value: string;
  source: string;
}

export interface CorporateMetricAuditEntry {
  value: number | null;
  display_value: string;
  method: string;
  quality: MetricQuality;
  reason: string | null;
  warnings: string[];
  confidence: number;
  inputs_used: CorporateMetricAuditInput[];
  source: string;
  as_of: string | null;
  calculation_version: string;
}

export interface CorporateMetricAudit {
  ticker: string;
  source_mode: "yahoo_finance" | "corporate_metrics" | "default_model" | "unavailable";
  generated_at: string;
  growth: CorporateMetricAuditEntry | null;
  roic: CorporateMetricAuditEntry;
  wacc: CorporateMetricAuditEntry;
  spread: CorporateMetricAuditEntry;
  dcf: CorporateMetricAuditEntry | null;
}

export interface CorporateDerivedMetricMeta {
  method: string;
  quality: MetricQuality;
  reason: string | null;
  warnings: string[];
  confidence: number;
  source: string;
  calculation_version: string;
  metric_role: "primary" | "supporting" | "fallback";
  as_of: string | null;
}
