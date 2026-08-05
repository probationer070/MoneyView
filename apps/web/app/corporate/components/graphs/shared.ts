export const CHART_INITIAL_DIMENSION = { width: 1, height: 1 };

export type DetailKey =
  | "companyStatus"
  | "hurdleDecomposition"
  | "erp"
  | "crp"
  | "bottomUpKe"
  | "betaWaccCurve"
  | "valueDriverMatrix"
  | "riskReturnMinard"
  | "failureProbability"
  | "dcfCoreModules"
  | "sustainableGrowth"
  | "terminalValueShare"
  | "fcffMagnitude"
  | "backendFairValue";

export interface HealthRadarPoint {
  subject: string;
  score: number;
  peer: number;
}

export interface HurdleBarPoint {
  name: string;
  value: number;
  fill: string;
}

export interface RegionalHurdlePoint {
  region: string;
  rf: number;
  erp: number;
  defaultSpread: number;
  riskMultiplier: number;
  crp: number;
  revenue: number;
}

export interface BetaPoint {
  name: string;
  beta: number;
  size: number;
}

export interface WaccCurvePoint {
  debt: number;
  wacc: number;
}

export interface ValueMatrixPoint {
  name: string;
  growth: number;
  spread: number;
  efficiency: number;
  fcff: number;
}

export interface RiskReturnPoint {
  risk: string;
  npv: number;
  success: number;
  fail: number;
}

export interface DcfResult {
  estimated_value: number;
  // Optional because a DCF result restored from sessionStorage can predate the field. The
  // backend always sends it; a cache written by an earlier build does not.
  terminal_value_share_pct?: number;
  intrinsic_value_per_share?: number | null;
  enterprise_value?: number;
  equity_value?: number | null;
  valuation_method?: string;
  bridge_quality?: string;
}

export function pct(value: number) {
  return `${value.toFixed(1)}%`;
}

export function pct2(value: number) {
  return `${value.toFixed(2)}%`;
}

export function numberText(value: number) {
  return value.toFixed(1);
}

export function moneyText(value: number) {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}
