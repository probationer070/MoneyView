export type CalculationDetailKey =
  | "realtime"
  | "growth"
  | "roic"
  | "wacc"
  | "debtRatio"
  | "unleveredBeta"
  | "leveredBeta"
  | "crp"
  | "erp"
  | "reinvestment"
  | "innovation"
  | "governance"
  | "esgPenalty"
  | "spread"
  | "bottomUpKe"
  | "backendDcf"
  | "sustainableGrowth"
  | "companyStatus"
  | "hurdleDecomposition"
  | "betaWaccCurve"
  | "valueDriverMatrix"
  | "dcfCoreModules"
  | "terminalValueShare"
  | "fcffMagnitude"
  | "backendFairValue";

export interface CalculationRow {
  label: string;
  value: string;
  source: string;
}

export interface RawDatasetRow {
  dataset: string;
  field: string;
  value: string;
  source: string;
}

export interface CalculationDetail {
  title: string;
  timeHorizon: string;
  summary: CalculationRow[];
  components: CalculationRow[];
  formula: string;
  result: string;
  sourcing: CalculationRow[];
  simulation: CalculationRow[];
  auditMetric?: "growth" | "roic" | "wacc" | "spread";
}
