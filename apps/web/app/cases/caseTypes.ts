/**
 * Wire types for /api/v1/valuation/cases/*. Mirrors apps/api/services/valuation_case.py
 * (list, load, run), case_diff.py, case_fork.py and case_simulate.py. The backend is the
 * authority: when these disagree with it, these are wrong.
 */

export type ThreeP = "possible" | "plausible" | "probable";
export type Confidence = "confirmed" | "derived" | "assumed";

export const THREE_P_VALUES: readonly ThreeP[] = ["possible", "plausible", "probable"];
export const CONFIDENCE_VALUES: readonly Confidence[] = ["confirmed", "derived", "assumed"];

export interface CaseSummary {
  id: number;
  case_name: string;
  ticker: string | null;
  as_of_date: string;
  base_year: number;
  target_year: number;
  parent_case_id: number | null;
}

export interface Narrative {
  input_field: string;
  claim: string;
  evidence_source: string | null;
  confidence: Confidence;
  three_p: ThreeP;
}

/** A stored segment row is flat: every column is a key. Read numbers through `wireValue`. */
export type SegmentRecord = { id: number; name: string; narratives: Narrative[] } & Record<string, unknown>;

export type CaseRecord = {
  id: number;
  case_name: string;
  ticker: string | null;
  as_of_date: string;
  base_year: number;
  target_year: number;
  parent_case_id: number | null;
  segments: SegmentRecord[];
} & Record<string, unknown>;

/** Per-year arrays: index i is year base_year + i + 1, through target_year. */
export interface RunSegment {
  name: string;
  revenue: number[];
  margin: number[];
  ebit: number[];
  reinvestment: number[];
}

export interface RunResult {
  case_id: number;
  case_name: string;
  base_year: number;
  target_year: number;
  segments: RunSegment[];
  revenue: number[];
  ebit: number[];
  tax: number[];
  reinvestment: number[];
  fcff: number[];
  wacc: number[];
  terminal_value_share_pct: number;
  enterprise_value: number;
  equity_value: number;
  value_per_share_basic: number;
  value_per_share_diluted: number;
}

export interface DiffContribution {
  /** "case.<field>" or "segment.<segment name>.<field>". */
  input: string;
  from: number;
  to: number;
  contribution: number;
}

/** GET /valuation/cases/{id}/pricing (apps/api/services/case_pricing.py). */
export interface PricingResult {
  case_id: number;
  basis: "ev_sales";
  vintage: string;
  industry: string;
  industry_firms: number;
  ev_sales: number;
  base_revenue_total: number;
  implied_enterprise_value: number;
  dcf_enterprise_value: number;
  /** dcf / implied - 1, a fraction with no horizon. */
  dcf_to_implied: number;
  source: string;
}

export interface DiffResult {
  case_id: number;
  parent_case_id: number;
  metric: string;
  parent_value_per_share_diluted: number;
  case_value_per_share_diluted: number;
  total_difference: number;
  method: "shapley";
  changed_input_count: number;
  contributions: DiffContribution[];
}

export interface NarratedValue {
  value: number;
  claim: string;
  three_p: ThreeP;
  confidence?: Confidence;
  evidence_source?: string;
}

export type ForkLeaf = number | NarratedValue;

export interface Overrides<Leaf> {
  case: Record<string, Leaf>;
  segments: Record<string, Record<string, Leaf>>;
}

export interface ForkRequest {
  case_name: string;
  overrides: Overrides<ForkLeaf>;
}

export type Shape = "triangular" | "normal" | "uniform";

/** Flat: the shape's parameters sit beside `shape` (case_simulate._distribution). */
export type DistributionLeaf = {
  shape: Shape;
  claim?: string;
  three_p?: ThreeP;
  confidence?: Confidence;
} & Record<string, number | string>;

export interface SimulateRequest {
  runs: number;
  seed?: number;
  distributions: Overrides<DistributionLeaf>;
}

export interface RefusalGroup {
  code: string;
  count: number;
  message: string;
}

export interface HistogramBin {
  lower: number;
  upper: number;
  count: number;
}

export interface Association {
  input: string;
  /** null when the input or the output was constant: not measurable, not zero. */
  spearman: number | null;
}

/**
 * The summary keys (p10/p50/p90/mean/histogram/association_among_accepted_samples) are ABSENT,
 * not null, in two cases: all of them together when `suppressed` is present (the refused
 * fraction reached case_simulate.REFUSED_FRACTION_CAP), or individually when `not_finite` names
 * them (that one statistic overflowed). Suppression must be decided by the presence of
 * `suppressed`, never by testing any statistic.
 */
export interface SimulateResult {
  case_id: number;
  metric: string;
  seed: number;
  runs_requested: number;
  runs_valid: number;
  runs_refused: number;
  refused_fraction: number;
  refusals: RefusalGroup[];
  /** Present exactly when the API withheld the summary (refused_fraction >= cap). The API's own sentence. */
  suppressed?: string;
  /** Present when one or more of p10/p50/p90/mean overflowed and was omitted on its own; the API's sentence naming which. */
  not_finite?: string;
  p10?: number;
  p50?: number;
  p90?: number;
  mean?: number;
  histogram?: HistogramBin[];
  association_among_accepted_samples?: Association[];
}

export const SHAPLEY_INPUT_CAP = 12;
export const MIN_RUNS = 1000;
export const MAX_RUNS = 20000;
export const DEFAULT_RUNS = 2000;
