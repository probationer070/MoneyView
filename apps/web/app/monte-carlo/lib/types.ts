export type PathSimulationInput = {
  initialInvestment: number;
  expectedAnnualReturn: number;
  annualVolatility: number;
  investmentHorizonYears: number;
  simulationCount: number;
  executionMode: "interactive" | "summary";
  jumpProbabilityMonthly: number;
  jumpIntensityMultiplier: number;
  riskFreeRate: number;
  seed: number;
};

export type MonteCarloResult = {
  ticker: string;
  model: string;
  execution_mode: "interactive" | "summary";
  path_summary: Array<Record<string, number>>;
  sample_paths: Array<Record<string, number>>;
  risk_metrics: Record<string, number>;
  histogram: Array<Record<string, number>>;
  normal_fit: Array<Record<string, number>>;
  cdf_comparison: Array<Record<string, number>>;
};

export type PathSummaryPoint = {
  time: number;
  mean: number;
  p05: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
};

export type HistogramPoint = {
  return: number;
  frequency: number;
  loss_bucket?: number;
  normal_scaled?: number;
};

export type NormalFitPoint = {
  return: number;
  density: number;
};

export type CdfComparisonPoint = {
  return: number;
  simulated_cdf: number;
  normal_cdf: number;
};

export type ValuationInput = {
  ticker: string;
  currentPrice: number;
  baseEps: number;
  averageGrowthRate: number;
  growthUncertainty: number;
  discountRate: number;
  discountRateUncertainty: number;
  terminalGrowthRate: number;
  forecastPeriodYears: number;
  targetPerUncertainty: number;
  simulationCount: number;
  seed: number;
};

export type StockPriceLookup = {
  ticker: string;
  status: "ok" | "fetching" | "not_found";
  price: number | null;
  as_of_date: string | null;
  source: string;
  freshness_status: string;
  retry_after_seconds: number | null;
  detail_note: string;
};

export type ValuationResult = {
  ticker: string;
  model: string;
  valuation_distribution: Array<Record<string, number>>;
  fair_value_summary: {
    current_price: number;
    fair_value_mean: number;
    fair_value_median: number;
    fair_value_p05: number;
    fair_value_p10: number;
    fair_value_p25: number;
    fair_value_p75: number;
    fair_value_p90: number;
    fair_value_p95: number;
    fair_value_std: number;
    undervaluation_probability: number;
    upside_potential: number;
    z_score: number;
    percentile_position: number;
  };
};

export type ValuationDistributionPoint = {
  fair_value: number;
  frequency: number;
};

export type CorrelationInput = {
  assets: Array<{
    name: string;
    expectedReturn: number;
    volatility: number;
  }>;
  correlationMatrix: number[][];
  simulationCount: number;
  seed: number;
};

export type CorrelationResult = {
  model: string;
  assets: string[];
  heatmap: Array<{ asset_x: string; asset_y: string; correlation: number }>;
  efficient_frontier: Array<{ return: number; risk: number; sharpe: number; is_optimal?: number }>;
  spearman_sensitivity: Array<{ asset: string; spearman_rho_sensitivity: number }>;
  covariance_summary: Array<{ asset: string; expected_return: number; volatility: number }>;
  optimal_summary: {
    optimal_return: number;
    optimal_volatility: number;
    diversification_effect: number;
    optimal_sharpe: number;
  };
};

export type CorrelationHeatmapPoint = {
  asset_x: string;
  asset_y: string;
  correlation: number;
};

export type EfficientFrontierPoint = {
  return: number;
  risk: number;
  sharpe: number;
  is_optimal?: number;
};

export type SpearmanSensitivityPoint = {
  asset: string;
  spearman_rho_sensitivity: number;
};

export type SharedSimulationResult = {
  raw: MonteCarloResult;
  pathKeys: string[];
  pathChartData: Array<Record<string, number>>;
  pathSummary: PathSummaryPoint[];
  terminalMedian: number;
  terminalP05: number;
  terminalP10: number;
  terminalP25: number;
  terminalP75: number;
  terminalP90: number;
  terminalP95: number;
  medianExpectedReturn: number;
  medianMaxDrawdown: number;
  percentileGaugeMin: number;
  percentileGaugeMax: number;
  percentileGaugeRange: number;
  normalOverlay: Array<{ return: number; normal_scaled: number }>;
  returnDistributionChartData: HistogramPoint[];
};

export type SimulationResultState<T> = {
  result: T | null;
  warnings: string[];
};

export type SimulationWorkerRequest = {
  type: "run-path";
  requestId: string;
  payload: PathSimulationInput;
};

export type ValuationWorkerRequest = {
  type: "run-valuation";
  requestId: string;
  payload: ValuationInput;
};

export type CorrelationWorkerRequest = {
  type: "run-correlation";
  requestId: string;
  payload: CorrelationInput;
};

export type SimulationWorkerCancel = {
  type: "cancel";
  requestId: string;
};

export type SimulationWorkerMessage = SimulationWorkerRequest | ValuationWorkerRequest | CorrelationWorkerRequest | SimulationWorkerCancel;

export type SimulationWorkerProgress = {
  type: "progress";
  requestId: string;
  progress: number;
};

export type SimulationWorkerResult = {
  type: "result";
  requestId: string;
  result: MonteCarloResult;
};

export type ValuationWorkerResult = {
  type: "valuation-result";
  requestId: string;
  result: ValuationResult;
};

export type CorrelationWorkerResult = {
  type: "correlation-result";
  requestId: string;
  result: CorrelationResult;
};

export type SimulationWorkerError = {
  type: "error";
  requestId: string;
  error: string;
};

export type SimulationWorkerResponse =
  | SimulationWorkerProgress
  | SimulationWorkerResult
  | ValuationWorkerResult
  | CorrelationWorkerResult
  | SimulationWorkerError;
