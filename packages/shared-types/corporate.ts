export interface DcfSummary {
  report_id: string;
  ticker: string;
  estimated_value: number;
  current_price: number;
  upside_pct: number;
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
