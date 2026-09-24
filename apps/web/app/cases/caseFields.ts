import type { CaseRecord } from "./caseTypes";

export type FieldUnit = "rate" | "money" | "ratio" | "year" | "count";

export interface FieldMeta {
  field: string;
  label: string;
  unit: FieldUnit;
  narrated: boolean;
  integer: boolean;
}

function meta(field: string, label: string, unit: FieldUnit, narrated = false, integer = false): FieldMeta {
  return { field, label, unit, narrated, integer };
}

/** case_fork._SETTABLE_CASE_FIELDS. None is narrated. */
export const CASE_FIELDS: readonly FieldMeta[] = [
  meta("base_year", "Base year", "year", false, true),
  meta("target_year", "Target year", "year", false, true),
  meta("riskfree_rate", "Risk-free rate", "rate"),
  meta("wacc_initial", "WACC, initial", "rate"),
  meta("wacc_stable", "WACC, stable", "rate"),
  meta("wacc_converge_from", "WACC converges from year", "count", false, true),
  meta("marginal_tax_rate", "Marginal tax rate", "rate"),
  meta("nol_balance", "NOL balance", "money"),
  meta("roic_stable", "ROIC, stable", "rate"),
  meta("terminal_growth", "Terminal growth", "rate"),
  meta("effective_tax_rate", "Effective tax rate", "rate"),
  meta("cash", "Cash", "money"),
  meta("debt", "Debt", "money"),
  meta("ipo_proceeds", "IPO proceeds", "money"),
  meta("shares_basic", "Shares, basic", "count"),
  meta("shares_new", "Shares, new", "count"),
];

/**
 * case_fork._SETTABLE_SEGMENT_FIELDS; `narrated` mirrors valuation_case.NARRATED_FIELDS.
 * waypoint_gap_fraction is a fraction of a gap, not a rate, so it stays a plain ratio.
 */
export const SEGMENT_FIELDS: readonly FieldMeta[] = [
  meta("base_revenue", "Base revenue", "money", true),
  meta("base_margin", "Base margin", "rate", true),
  meta("tam_target", "TAM, target", "money", true),
  meta("market_share_target", "Market share, target", "rate", true),
  meta("revenue_target", "Revenue, target", "money", true),
  meta("margin_target", "Margin, target", "rate", true),
  meta("sales_to_capital_early", "Sales to capital, early", "ratio", true),
  meta("sales_to_capital_late", "Sales to capital, late", "ratio", true),
  meta("ramp_start_year", "Ramp start year", "count", false, true),
  meta("initial_growth", "Initial growth", "rate", true),
  meta("waypoint_gap_fraction", "Waypoint gap fraction", "ratio", true),
];

// toPrecision(12) strips binary noise (7.4 / 100 is not exactly 0.074 in every engine), so a
// value typed back unchanged compares equal to the stored one.
function clean(value: number): number {
  return Number(value.toPrecision(12));
}

/** Display units -> wire units. The ONLY place a rate is divided by 100. */
export function toWire(field: FieldMeta, display: number): number {
  return clean(field.unit === "rate" ? display / 100 : display);
}

/** Wire units -> display units. The ONLY place a rate is multiplied by 100. */
export function fromWire(field: FieldMeta, wire: number): number {
  return clean(field.unit === "rate" ? wire * 100 : wire);
}

export function formatWire(field: FieldMeta, wire: number | null | undefined): string {
  if (wire === null || wire === undefined) return "not set";
  const display = fromWire(field, wire);
  if (field.unit === "rate") return `${display.toFixed(2)}%`;
  if (field.integer) return String(display);
  return display.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function unitSuffix(field: FieldMeta): string {
  return field.unit === "rate" ? "%" : "";
}

/** A pickable field. `key` is the same string /diff reports as `input`. */
export interface FieldTarget {
  key: string;
  scope: "case" | "segment";
  segment: string | null;
  meta: FieldMeta;
}

export function fieldTargets(record: CaseRecord): FieldTarget[] {
  return [
    ...CASE_FIELDS.map((m): FieldTarget => ({ key: `case.${m.field}`, scope: "case", segment: null, meta: m })),
    ...record.segments.flatMap((segment) =>
      SEGMENT_FIELDS.map((m): FieldTarget => ({
        key: `segment.${segment.name}.${m.field}`, scope: "segment", segment: segment.name, meta: m,
      })),
    ),
  ];
}

export function wireValue(record: CaseRecord, target: FieldTarget): number | null {
  const source = target.scope === "case" ? record : record.segments.find((s) => s.name === target.segment);
  const raw = source?.[target.meta.field];
  return typeof raw === "number" ? raw : null;
}

/** "case.x" or "segment.<name>.x" -- a segment name may contain dots, a column may not. */
function splitInput(input: string): { segment: string | null; field: string } {
  if (input.startsWith("case.")) return { segment: null, field: input.slice("case.".length) };
  const rest = input.slice("segment.".length);
  const cut = rest.lastIndexOf(".");
  return { segment: rest.slice(0, cut), field: rest.slice(cut + 1) };
}

export function metaForInput(input: string): FieldMeta | null {
  const { segment, field } = splitInput(input);
  const pool = segment === null ? CASE_FIELDS : SEGMENT_FIELDS;
  return pool.find((m) => m.field === field) ?? null;
}

export function labelForInput(input: string): string {
  const { segment, field } = splitInput(input);
  const label = metaForInput(input)?.label ?? field;
  return segment === null ? label : `${segment} · ${label}`;
}
