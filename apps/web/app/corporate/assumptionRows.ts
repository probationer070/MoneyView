import type { CalculationDetailKey } from "./components/calculationDetailTypes";
import type { CorporateAssumptions, DcfRequestSnapshot } from "./corporateTypes";
import { dcfRequestBody } from "./corporateUtils";

export type AssumptionKey =
  | "growth" | "roic" | "wacc" | "debtRatio" | "unleveredBeta" | "crp"
  | "reinvestment" | "innovation" | "governance" | "esgPenalty";
export type AssumptionField = Exclude<keyof CorporateAssumptions, "ticker" | "crp" | "fcff" | "marketShare">;
export type DcfRequestBody = ReturnType<typeof dcfRequestBody>;
type DcfField = keyof DcfRequestBody;
type SnapshotField = Exclude<keyof DcfRequestSnapshot, "ticker">;

export interface AssumptionRowDef {
  key: AssumptionKey;
  /** The assumption its slider edits; null for the fixed country risk premium. */
  field: AssumptionField | null;
  min: number;
  max: number;
  step: number;
  suffix: "%" | "";
  /** The DCF request field it feeds and its sensitivity step, in slider units (spec §4.1). */
  dcf: { field: DcfField; snapshotField: SnapshotField; delta: number } | null;
}

// Slider ranges are the ones CorporateAssumptionsPanel used (deleted in Task 5).
export const ASSUMPTION_ROWS: readonly AssumptionRowDef[] = [
  { key: "growth", field: "growth", min: -5, max: 20, step: 0.5, suffix: "%", dcf: { field: "revenue_growth_rate", snapshotField: "growth", delta: 1 } },
  { key: "roic", field: "roic", min: -5, max: 45, step: 0.5, suffix: "%", dcf: { field: "operating_margin", snapshotField: "roic", delta: 2 } },
  { key: "wacc", field: "wacc", min: 2, max: 24, step: 0.25, suffix: "%", dcf: { field: "wacc", snapshotField: "wacc", delta: 1 } },
  { key: "debtRatio", field: "debtRatio", min: 0, max: 90, step: 1, suffix: "%", dcf: { field: "debt_ratio", snapshotField: "debtRatio", delta: 10 } },
  { key: "unleveredBeta", field: "unleveredBeta", min: 0.4, max: 2.5, step: 0.05, suffix: "", dcf: { field: "unlevered_beta", snapshotField: "unleveredBeta", delta: 0.1 } },
  { key: "crp", field: null, min: 0, max: 0, step: 0, suffix: "%", dcf: null },
  { key: "reinvestment", field: "reinvestment", min: 0, max: 90, step: 1, suffix: "%", dcf: { field: "reinvestment", snapshotField: "reinvestment", delta: 10 } },
  { key: "innovation", field: "innovation", min: 0, max: 100, step: 1, suffix: "", dcf: null },
  { key: "governance", field: "governance", min: 0, max: 100, step: 1, suffix: "", dcf: null },
  { key: "esgPenalty", field: "esgPenalty", min: 0, max: 100, step: 1, suffix: "", dcf: { field: "esg_penalty", snapshotField: "esgPenalty", delta: 10 } },
];

export function assumptionRow(key: CalculationDetailKey): AssumptionRowDef | null {
  return ASSUMPTION_ROWS.find((row) => row.key === key) ?? null;
}

/** How the table and the slider print a value: percent 1 dp, beta 2 dp, scores 1 dp (plan N11). */
export function formatAssumption(row: AssumptionRowDef, value: number): string {
  if (row.suffix === "%") return `${value.toFixed(1)}%`;
  return row.key === "unleveredBeta" ? value.toFixed(2) : value.toFixed(1);
}

/** The sensitivity step in the assumption's unit: "1.0%p", "0.10", "10". */
export function formatDelta(row: AssumptionRowDef): string {
  const delta = row.dcf?.delta ?? 0;
  if (row.suffix === "%") return `${delta.toFixed(1)}%p`;
  return row.key === "unleveredBeta" ? delta.toFixed(2) : delta.toFixed(0);
}

export interface SensitivitySide {
  value: number;
  /** True when the step crossed the slider range and the value was pulled back to it. */
  clamped: boolean;
  body: DcfRequestBody;
}

export interface SensitivityPlan {
  field: DcfField;
  current: number;
  delta: number;
  down: SensitivitySide;
  up: SensitivitySide;
}

// 1.05 - 0.1 is 0.9500000000000001 in floating point; the request must carry 0.95.
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/** The two DCF request bodies of the sensitivity tab: only this assumption moves, by ±delta,
 *  clamped to its slider range; every other field is the current snapshot's (spec §4.1). */
export function sensitivityPlan(snapshot: DcfRequestSnapshot, key: CalculationDetailKey): SensitivityPlan | null {
  const row = assumptionRow(key);
  const dcf = row?.dcf;
  if (!row || !dcf) return null;
  const current = snapshot[dcf.snapshotField];
  const side = (raw: number): SensitivitySide => {
    const target = round6(raw);
    const value = Math.min(Math.max(target, row.min), row.max);
    return { value, clamped: value !== target, body: dcfRequestBody({ ...snapshot, [dcf.snapshotField]: value }) };
  };
  return { field: dcf.field, current, delta: dcf.delta, down: side(current - dcf.delta), up: side(current + dcf.delta) };
}
