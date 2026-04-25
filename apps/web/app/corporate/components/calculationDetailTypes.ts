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
  | "failureProbability"
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
  | "riskReturnMinard"
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
  auditMetric?: "roic" | "wacc" | "spread";
}
