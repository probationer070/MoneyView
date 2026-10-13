import { expect, test } from "@playwright/test";
import { verdictLabelKey } from "../../app/corporate/verdict";
import { ASSUMPTION_ROWS, assumptionRow, formatAssumption, formatDelta, sensitivityPlan } from "../../app/corporate/assumptionRows";
import { substitutedFormula, type FormulaContext } from "../../app/corporate/substitutedFormula";
import { peerRank } from "../../app/corporate/peerRank";
import { availableDetailTabs, resolveDetailTab } from "../../app/corporate/detailTabs";
import { dcfRequestBody } from "../../app/corporate/corporateUtils";
import type { CorporateComparisonRowApi, DcfRequestSnapshot } from "../../app/corporate/corporateTypes";

test.describe("verdictLabelKey", () => {
  test("maps the three backend statuses and nothing else", () => {
    expect(verdictLabelKey("Undervalued")).toBe("undervalued");
    expect(verdictLabelKey("Overvalued")).toBe("overvalued");
    expect(verdictLabelKey("Bridge Incomplete")).toBe("bridgeIncomplete");
    expect(verdictLabelKey("Fairly Valued")).toBeNull();
    expect(verdictLabelKey("undervalued")).toBeNull();
  });

  test("verdictLabelKey reads only its own keys", () => {
    for (const inherited of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(verdictLabelKey(inherited), inherited).toBeNull();
    }
  });
});

const SNAPSHOT: DcfRequestSnapshot = {
  ticker: "AAPL", growth: 6, roic: 18, wacc: 10, debtRatio: 18, unleveredBeta: 1.05,
  crp: 0.8, reinvestment: 34, fcff: 92, esgPenalty: 22,
};

test.describe("sensitivityPlan (spec §4.1)", () => {
  const cases = [
    ["growth", "revenue_growth_rate", 0.05, 0.07],
    ["roic", "operating_margin", 0.16, 0.2],
    ["wacc", "wacc", 0.09, 0.11],
    ["reinvestment", "reinvestment", 24, 44],
    ["unleveredBeta", "unlevered_beta", 0.95, 1.15],
    ["debtRatio", "debt_ratio", 8, 28],
    ["esgPenalty", "esg_penalty", 12, 32],
  ] as const;

  for (const [key, field, down, up] of cases) {
    test(`${key} moves only ${field}, by its spec delta`, () => {
      const base = dcfRequestBody(SNAPSHOT) as Record<string, number>;
      const plan = sensitivityPlan(SNAPSHOT, key);
      expect(plan, key).not.toBeNull();
      expect(plan!.field).toBe(field);
      const downBody = plan!.down.body as Record<string, number>;
      const upBody = plan!.up.body as Record<string, number>;
      expect(downBody[field]).toBeCloseTo(down, 10);
      expect(upBody[field]).toBeCloseTo(up, 10);
      for (const other of Object.keys(base).filter((name) => name !== field)) {
        expect(downBody[other], `${key} down leaves ${other}`).toBe(base[other]);
        expect(upBody[other], `${key} up leaves ${other}`).toBe(base[other]);
      }
    });
  }

  test("a step past the slider range is clamped and flagged", () => {
    const wacc = assumptionRow("wacc")!;
    const plan = sensitivityPlan({ ...SNAPSHOT, wacc: wacc.min + 0.5 }, "wacc")!;
    expect(plan.down).toMatchObject({ value: wacc.min, clamped: true });
    expect(plan.up).toMatchObject({ value: wacc.min + 1.5, clamped: false });
    const esg = assumptionRow("esgPenalty")!;
    const high = sensitivityPlan({ ...SNAPSHOT, esgPenalty: esg.max - 5 }, "esgPenalty")!;
    expect(high.up).toMatchObject({ value: esg.max, clamped: true });
  });

  test("a current value already outside the slider range clamps both sides to the bound", () => {
    const wacc = assumptionRow("wacc")!;
    const plan = sensitivityPlan({ ...SNAPSHOT, wacc: wacc.min - 3 }, "wacc")!;
    expect(plan.down).toMatchObject({ value: wacc.min, clamped: true });
    expect(plan.up).toMatchObject({ value: wacc.min, clamped: true });
  });

  test("the beta step is rounded, not drifted", () => {
    const plan = sensitivityPlan(SNAPSHOT, "unleveredBeta")!;
    expect(plan.down.value).toBe(0.95);
    expect(plan.up.value).toBe(1.15);
    expect((plan.down.body as Record<string, number>).unlevered_beta).toBe(0.95);
  });

  test("assumptions the DCF does not use have no plan", () => {
    for (const key of ["innovation", "governance", "crp", "spread", "backendDcf"] as const) {
      expect(sensitivityPlan(SNAPSHOT, key), key).toBeNull();
    }
  });

  test("a value is printed in its row's unit", () => {
    expect(formatAssumption(assumptionRow("innovation")!, 82)).toBe("82.0");
    expect(formatAssumption(assumptionRow("unleveredBeta")!, 1.05)).toBe("1.05");
    expect(formatAssumption(assumptionRow("growth")!, 6)).toBe("6.0%");
  });

  test("the step is printed in the assumption's own unit", () => {
    expect(formatDelta(assumptionRow("growth")!)).toBe("1.0%p");
    expect(formatDelta(assumptionRow("unleveredBeta")!)).toBe("0.10");
    expect(formatDelta(assumptionRow("esgPenalty")!)).toBe("10");
    expect(ASSUMPTION_ROWS.map((row) => row.key)).toEqual([
      "growth", "roic", "wacc", "debtRatio", "unleveredBeta", "crp", "reinvestment", "innovation", "governance", "esgPenalty",
    ]);
  });
});

const CTX: FormulaContext = {
  roic: 21.3, wacc: 9.4, reinvestment: 34, unleveredBeta: 1.05,
  spread: 11.9, bottomUpKe: 10.6, leveredBeta: 1.12, sustainableGrowth: 7.2, debtToEquity: 0.22,
  riskFreeRate: 4.2, impliedErp: 5.1, impliedMarketReturn: 9.3, countryRiskPremium: 0.8, taxRate: 0.25,
  waccAudit: null,
  dcf: { intrinsic: 240.5, price: 210.4, upside: 14.31 },
};

const WACC_AUDIT = {
  value: 8.8, display_value: "8.8%", method: "latest_capital_structure", quality: "ok" as const, reason: null,
  warnings: [], confidence: 0.9, source: "test", as_of: "2025-12-31", calculation_version: "wacc_v2",
  inputs_used: [
    { field: "equity_weight", label: "Equity weight", value: 0.82, display_value: "82.0%", source: "t" },
    { field: "cost_of_equity", label: "Cost of equity", value: 0.1, display_value: "10.0%", source: "t" },
    { field: "debt_weight", label: "Debt weight", value: 0.18, display_value: "18.0%", source: "t" },
    { field: "cost_of_debt", label: "Cost of debt", value: 0.041, display_value: "4.1%", source: "t" },
    { field: "tax_rate", label: "Tax rate", value: 0.21, display_value: "21.0%", source: "t" },
    { field: "final_wacc_value", label: "Final WACC value", value: 8.8, display_value: "8.8%", source: "t" },
  ],
};

test.describe("substitutedFormula (plan N2)", () => {
  test("each operand lands in its own slot", () => {
    expect(substitutedFormula("spread", CTX)).toBe("ROIC − WACC = 21.3% − 9.4% = 11.9%");
    expect(substitutedFormula("bottomUpKe", CTX)).toBe("Ke = rf + βL × ERP + CRP = 4.2% + 1.12 × 5.1% + 0.8% = 10.6%");
    expect(substitutedFormula("leveredBeta", CTX)).toBe("βL = βU × [1 + (1 − t) × D/E] = 1.05 × [1 + (1 − 25.0%) × 0.22] = 1.12");
    expect(substitutedFormula("sustainableGrowth", CTX)).toBe("g = reinvestment × ROIC = 34.0% × 21.3% = 7.2%");
    expect(substitutedFormula("erp", CTX)).toBe("ERP = IRR − rf = 9.3% − 4.2% = 5.1%");
    expect(substitutedFormula("backendFairValue", CTX)).toBe("Upside = intrinsic ÷ price − 1 = $240.5 ÷ $210.4 − 1 = +14.3%");
    expect(substitutedFormula("backendDcf", CTX)).toBe("Upside = intrinsic ÷ price − 1 = $240.5 ÷ $210.4 − 1 = +14.3%");
  });

  test("prints the page's result, never recomputes it", () => {
    // Inconsistent on purpose: a formatter that recomputed ROIC − WACC would print 8.0%.
    expect(substitutedFormula("spread", { ...CTX, roic: 18, wacc: 10, spread: 7.7 })).toBe("ROIC − WACC = 18.0% − 10.0% = 7.7%");
  });

  test("WACC uses the audit's six inputs and needs all of them", () => {
    expect(substitutedFormula("wacc", { ...CTX, waccAudit: WACC_AUDIT }))
      .toBe("WACC = E/V × Ke + D/V × Kd × (1 − t) = 82.0% × 10.0% + 18.0% × 4.1% × (1 − 21.0%) = 8.8%");
    const missingKd = { ...WACC_AUDIT, inputs_used: WACC_AUDIT.inputs_used.filter((input) => input.field !== "cost_of_debt") };
    expect(substitutedFormula("wacc", { ...CTX, waccAudit: missingKd })).toBeNull();
    expect(substitutedFormula("wacc", CTX)).toBeNull();
  });

  test("the ERP identity is withheld when the zero floor bit", () => {
    expect(substitutedFormula("erp", { ...CTX, impliedMarketReturn: 3.9, impliedErp: 0 })).toBeNull();
  });

  test("an unbridged DCF has no substituted formula", () => {
    expect(substitutedFormula("backendDcf", { ...CTX, dcf: { intrinsic: null, price: 210.4, upside: null } })).toBeNull();
    expect(substitutedFormula("backendDcf", { ...CTX, dcf: null })).toBeNull();
    expect(substitutedFormula("backendDcf", { ...CTX, dcf: { intrinsic: 240.5, price: 210.4, upside: null } })).toBeNull();
    expect(substitutedFormula("backendFairValue", { ...CTX, dcf: { intrinsic: 240.5, price: 210.4, upside: null } })).toBeNull();
    expect(substitutedFormula("backendDcf", { ...CTX, dcf: { intrinsic: null, price: 210.4, upside: 14.3 } })).toBeNull();
    expect(substitutedFormula("backendFairValue", { ...CTX, dcf: { intrinsic: null, price: 210.4, upside: 14.3 } })).toBeNull();
  });

  test("a tiny negative upside prints 0.0%, not -0.0%", () => {
    expect(substitutedFormula("backendDcf", { ...CTX, dcf: { intrinsic: 210.36, price: 210.4, upside: -0.04 } })).toBe("Upside = intrinsic ÷ price − 1 = $210.4 ÷ $210.4 − 1 = 0.0%");
  });

  test("metrics whose operands are not on the page get none", () => {
    for (const key of ["growth", "roic", "debtRatio", "crp", "hurdleDecomposition", "terminalValueShare"] as const) {
      expect(substitutedFormula(key, CTX), key).toBeNull();
    }
  });
});

function row(ticker: string, over: Partial<CorporateComparisonRowApi> = {}): CorporateComparisonRowApi {
  return {
    ticker, name: ticker, sector: "Technology", group_name: "core", weight: 0.1,
    roic: 10, wacc: 9, roic_minus_wacc: 1, dcf_value: 100, current_price: 90, dcf_implied_return: 5,
    capm_expected_return: 9, stock_expected_return: null, market_expected_return: 9.7,
    market_implied_return: null, implied_return_spread: null, implied_return_refusal: null, dcf_refusal: null,
    stock_expected_return_source: "test", has_price_data: true, bridge_quality: "ok", ...over,
  };
}

test.describe("peerRank", () => {
  test("ranks high to low among non-benchmark rows, with the band and position", () => {
    const rows = [row("A", { roic: 20 }), row("B", { roic: 10 }), row("C", { roic: 15 }), row("^GSPC", { group_name: "benchmark", roic: 99 })];
    expect(peerRank(rows, "roic", "c")).toEqual({ state: "ranked", value: 15, rank: 2, count: 3, min: 10, max: 20, position: 0.5 });
  });

  test("an unbridged row's 0.0 upside is not a peer value", () => {
    const rows = [row("A", { dcf_implied_return: 12 }), row("MISS", { bridge_quality: "missing", dcf_implied_return: 0 }), row("B", { dcf_implied_return: -4 })];
    expect(peerRank(rows, "dcf_implied_return", "A")).toMatchObject({ rank: 1, count: 2, min: -4, max: 12 });
    expect(peerRank(rows, "dcf_implied_return", "MISS")).toEqual({ state: "noValue" });
  });

  test("a refused row's null is left out, and a ticker outside the universe is absent", () => {
    const rows = [row("A", { dcf_implied_return: 3 }), row("BURN", { dcf_implied_return: null })];
    expect(peerRank(rows, "dcf_implied_return", "A")).toMatchObject({ count: 1, position: 0.5 });
    expect(peerRank(rows, "dcf_implied_return", "ZZZ")).toEqual({ state: "absent" });
  });
});

test.describe("detail tabs", () => {
  test("each metric gets only the tabs it has data for", () => {
    expect(availableDetailTabs("growth")).toEqual(["summary", "steps", "trend", "sensitivity", "raw"]);
    expect(availableDetailTabs("roic")).toEqual(["summary", "steps", "trend", "peers", "sensitivity", "raw"]);
    expect(availableDetailTabs("crp")).toEqual(["summary", "steps", "sensitivity", "raw"]);
    expect(availableDetailTabs("spread")).toEqual(["summary", "steps", "peers", "raw"]);
    expect(availableDetailTabs("hurdleDecomposition")).toEqual(["summary", "steps", "raw"]);
    expect(availableDetailTabs("wacc")).toEqual(["summary", "steps", "peers", "sensitivity", "raw"]);
    expect(availableDetailTabs("backendDcf")).toEqual(["summary", "steps", "peers", "raw"]);
    expect(availableDetailTabs("backendFairValue")).toEqual(["summary", "steps", "peers", "raw"]);
  });

  test("a stored tab the metric lacks resolves to summary", () => {
    expect(resolveDetailTab("trend", availableDetailTabs("crp"))).toBe("summary");
    expect(resolveDetailTab("peers", availableDetailTabs("spread"))).toBe("peers");
    for (const junk of [null, 42, "bogus", "constructor"]) {
      expect(resolveDetailTab(junk, availableDetailTabs("roic"))).toBe("summary");
    }
  });
});
