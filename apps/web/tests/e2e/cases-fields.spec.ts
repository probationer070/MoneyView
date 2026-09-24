import { expect, test } from "@playwright/test";
import {
  CASE_FIELDS, SEGMENT_FIELDS, fieldTargets, formatWire, fromWire, labelForInput, metaForInput, toWire,
} from "../../app/cases/caseFields";
import { EMPTY_NARRATIVE, buildForkRequest, buildSimulateRequest, rowsNamedIn } from "../../app/cases/changeRows";
import type { CaseRecord } from "../../app/cases/caseTypes";

const RECORD: CaseRecord = {
  id: 1, case_name: "parent", ticker: "TESTCO", as_of_date: "2026-01-01",
  base_year: 2025, target_year: 2035, parent_case_id: null,
  riskfree_rate: 0.042, wacc_initial: 0.09, wacc_stable: 0.074, wacc_converge_from: 5,
  marginal_tax_rate: 0.25, effective_tax_rate: 0.15, nol_balance: 0, roic_stable: 0.12,
  terminal_growth: 0.03, cash: 100, debt: 50, ipo_proceeds: 0, shares_basic: 100, shares_new: 0,
  segments: [{
    id: 10, name: "Core", base_revenue: 1000, base_margin: 0.2, tam_target: null,
    market_share_target: null, revenue_target: 2000, margin_target: 0.28,
    sales_to_capital_early: 2, sales_to_capital_late: 3, ramp_start_year: 1,
    initial_growth: null, waypoint_gap_fraction: null, narratives: [],
  }],
};
const targets = new Map(fieldTargets(RECORD).map((t) => [t.key, t]));
const current = (key: string) => {
  const t = targets.get(key)!;
  const source = t.scope === "case" ? RECORD : RECORD.segments[0];
  const raw = source[t.meta.field];
  return typeof raw === "number" ? raw : null;
};

test.describe("case field metadata", () => {
  test("the settable fields match the API: 16 case, 11 segment, 10 narrated", () => {
    expect(CASE_FIELDS.map((m) => m.field).sort()).toEqual([
      "base_year", "cash", "debt", "effective_tax_rate", "ipo_proceeds", "marginal_tax_rate",
      "nol_balance", "riskfree_rate", "roic_stable", "shares_basic", "shares_new", "target_year",
      "terminal_growth", "wacc_converge_from", "wacc_initial", "wacc_stable",
    ]);
    expect(SEGMENT_FIELDS.map((m) => m.field).sort()).toEqual([
      "base_margin", "base_revenue", "initial_growth", "margin_target", "market_share_target",
      "ramp_start_year", "revenue_target", "sales_to_capital_early", "sales_to_capital_late",
      "tam_target", "waypoint_gap_fraction",
    ]);
    expect(SEGMENT_FIELDS.filter((m) => m.narrated).map((m) => m.field).sort()).toEqual([
      "base_margin", "base_revenue", "initial_growth", "margin_target", "market_share_target",
      "revenue_target", "sales_to_capital_early", "sales_to_capital_late", "tam_target",
      "waypoint_gap_fraction",
    ]);
    expect(CASE_FIELDS.some((m) => m.narrated)).toBe(false);
    expect(
      [...CASE_FIELDS, ...SEGMENT_FIELDS].filter((m) => m.unit === "rate").map((m) => m.field).sort(),
    ).toEqual([
      "base_margin", "effective_tax_rate", "initial_growth", "margin_target", "marginal_tax_rate",
      "market_share_target", "riskfree_rate", "roic_stable", "terminal_growth", "wacc_initial",
      "wacc_stable",
    ]);
    expect(
      [...CASE_FIELDS, ...SEGMENT_FIELDS].filter((m) => m.integer).map((m) => m.field).sort(),
    ).toEqual(["base_year", "ramp_start_year", "target_year", "wacc_converge_from"]);
  });

  test("a rate entered as a percentage goes on the wire as a fraction, and back", () => {
    const wacc = CASE_FIELDS.find((m) => m.field === "wacc_stable")!;
    expect(toWire(wacc, 7.4)).toBe(0.074);
    expect(fromWire(wacc, 0.074)).toBe(7.4);
    expect(formatWire(wacc, 0.074)).toBe("7.40%");
    const cash = CASE_FIELDS.find((m) => m.field === "cash")!;
    expect(toWire(cash, 100)).toBe(100);
    const stc = SEGMENT_FIELDS.find((m) => m.field === "sales_to_capital_early")!;
    expect(toWire(stc, 2.5)).toBe(2.5);
  });

  test("a /diff input key resolves to its field's metadata and label", () => {
    expect(metaForInput("case.wacc_stable")?.unit).toBe("rate");
    expect(metaForInput("segment.Core.base_margin")?.narrated).toBe(true);
    expect(metaForInput("segment.A.B.margin_target")?.field).toBe("margin_target");
    expect(labelForInput("segment.Core.base_margin")).toBe("Core · Base margin");
    expect(labelForInput("case.wacc_stable")).toBe("WACC, stable");
  });
});

test.describe("the fork request builder", () => {
  test("a narrated change is an object with its claim; an unnarrated one is a bare fraction", () => {
    const built = buildForkRequest("child", [
      { id: 1, targetKey: "case.wacc_stable", value: "8.1", narrative: EMPTY_NARRATIVE },
      {
        id: 2, targetKey: "segment.Core.base_margin", value: "22",
        narrative: { claim: "pricing power", threeP: "plausible", confidence: "", evidenceSource: "" },
      },
    ], targets, current);

    expect(built.problems).toEqual({});
    expect(built.changedCount).toBe(2);
    expect(built.request).toEqual({
      case_name: "child",
      overrides: {
        case: { wacc_stable: 0.081 },
        segments: { Core: { base_margin: { value: 0.22, claim: "pricing power", three_p: "plausible" } } },
      },
    });
  });

  test("an unchanged row is left out and not counted", () => {
    const built = buildForkRequest("child", [
      { id: 1, targetKey: "case.wacc_stable", value: "7.4", narrative: EMPTY_NARRATIVE },
    ], targets, current);
    expect(built.changedCount).toBe(0);
    expect(built.unchanged).toEqual([1]);
    expect(built.request.overrides.case).toEqual({});
  });

  test("a narrated change without a claim or three_p is a row problem, still counted as changed", () => {
    const built = buildForkRequest("child", [
      { id: 7, targetKey: "segment.Core.base_margin", value: "25", narrative: EMPTY_NARRATIVE },
    ], targets, current);
    expect(built.changedCount).toBe(1);
    expect(built.problems[7]).toMatch(/claim/);
  });

  test("an integer field refuses a fraction", () => {
    const built = buildForkRequest("child", [
      { id: 3, targetKey: "case.target_year", value: "2036.5", narrative: EMPTY_NARRATIVE },
    ], targets, current);
    expect(built.problems[3]).toMatch(/whole number/);
  });
});

test.describe("the simulate request builder", () => {
  test("rate parameters go on the wire as fractions, including a normal's sd", () => {
    const built = buildSimulateRequest([
      { id: 1, targetKey: "case.wacc_stable", shape: "normal", params: { mean: "7.4", sd: "0.5" }, narrative: EMPTY_NARRATIVE },
    ], "2000", "", targets);
    expect(built.problems).toEqual({});
    expect(built.request).toEqual({
      runs: 2000,
      distributions: { case: { wacc_stable: { shape: "normal", mean: 0.074, sd: 0.005 } }, segments: {} },
    });
  });

  test("a narrated distribution carries its claim; runs outside 1000-20000 are refused", () => {
    const built = buildSimulateRequest([
      {
        id: 1, targetKey: "segment.Core.margin_target", shape: "triangular",
        params: { low: "24", mode: "28", high: "30" },
        narrative: { claim: "scale", threeP: "possible", confidence: "", evidenceSource: "" },
      },
    ], "500", "42", targets);
    expect(built.runsProblem).toMatch(/1,000/);
    expect(built.request.seed).toBe(42);
    expect(built.request.distributions.segments.Core.margin_target).toEqual({
      shape: "triangular", low: 0.24, mode: 0.28, high: 0.3, claim: "scale", three_p: "possible",
    });
  });

  test("the seed must be a whole number of 0 or more, or left empty", () => {
    for (const bad of ["-1", "1.5", "abc"]) {
      const built = buildSimulateRequest([], "2000", bad, targets);
      expect(built.seedProblem).toMatch(/whole number of 0 or more/);
      expect(built.request.seed).toBeUndefined();
    }
    const built = buildSimulateRequest([], "2000", "7", targets);
    expect(built.seedProblem).toBeNull();
    expect(built.request.seed).toBe(7);
  });
});

test("a refusal names only the rows whose field it mentions", () => {
  const rows = [
    { id: 1, targetKey: "segment.Core.base_margin" },
    { id: 2, targetKey: "segment.Core.margin_target" },
    { id: 3, targetKey: "case.wacc_stable" },
  ];
  expect(rowsNamedIn("narrative_required: base_margin is a narrated field", rows, targets)).toEqual([1]);
  expect(rowsNamedIn("unknown_field: case.wacc_stable is not settable", rows, targets)).toEqual([3]);
});
