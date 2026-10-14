import { expect, test } from "@playwright/test";
import { verdictLabelKey, verdictView } from "../../app/corporate/verdict";
import { LEGACY_LOWER_TAB_KEY, migrateLowerTab, PAGE_TAB_KEY } from "../../app/corporate/pageTabs";
import { restoreTabState } from "../../lib/tabState";
import { isOneScreenRoute, ONE_SCREEN_ROUTES } from "../../components/ui/oneScreenRoutes";
import type { DcfSummary } from "../../../../packages/shared-types";
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

const DCF: DcfSummary = {
  report_id: "m-1", ticker: "AAPL", estimated_value: 240.5, intrinsic_value_per_share: 240.5,
  enterprise_value: 1462.4, equity_value: 1300.2, valuation_method: "fcff_equity_bridge", bridge_quality: "ok",
  current_price: 210.4, upside_pct: 14.31, terminal_value_share_pct: 70.71, wacc_minus_terminal_growth: null,
  terminal_growth_binding_constraint: null, status: "Undervalued", generated_at: "2026-10-14T00:00:00Z",
};

test.describe("verdictView", () => {
  test("a bridged valuation carries its per-share value, upside, price and status", () => {
    expect(verdictView(DCF, false, null)).toMatchObject({
      state: "valued", intrinsic: 240.5, upside: 14.31, currentPrice: 210.4, status: "Undervalued",
    });
  });

  test("an unbridged valuation withholds value and upside, and keeps the EV aside", () => {
    const view = verdictView({ ...DCF, bridge_quality: "missing", estimated_value: 1462.4, upside_pct: 0 }, false, null);
    expect(view).toMatchObject({ state: "valued", intrinsic: null, upside: null, enterpriseValue: 1462.4 });
  });

  test("a refusal wins over a value and over a running stream", () => {
    expect(verdictView(DCF, true, "reason").state).toBe("refused");
    expect(verdictView(null, false, "reason")).toMatchObject({ state: "refused", refusalText: "reason", intrinsic: null });
  });

  test("streaming without a value is streaming; with a cached value it stays valued", () => {
    expect(verdictView(null, true, null).state).toBe("streaming");
    expect(verdictView(DCF, true, null)).toMatchObject({ state: "valued", streaming: true });
    expect(verdictView(null, false, null).state).toBe("idle");
  });
});

/** A sessionStorage stand-in that records what was written. */
function memoryStorage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

test.describe("migrateLowerTab", () => {
  test("a chosen DCF or comparison tab moves to the page-tab key, and the old key is dropped", () => {
    for (const tab of ["dcf", "comparison"]) {
      const storage = memoryStorage({ [LEGACY_LOWER_TAB_KEY]: JSON.stringify(tab) });
      migrateLowerTab(storage);
      expect(storage.map.get(PAGE_TAB_KEY)).toBe(JSON.stringify(tab));
      expect(storage.map.has(LEGACY_LOWER_TAB_KEY)).toBe(false);
    }
  });

  test("diagnostics, the old default that useTabState wrote back on every visit, is not carried", () => {
    const storage = memoryStorage({ [LEGACY_LOWER_TAB_KEY]: JSON.stringify("diagnostics") });
    migrateLowerTab(storage);
    expect(storage.map.has(PAGE_TAB_KEY)).toBe(false);
    expect(storage.map.has(LEGACY_LOWER_TAB_KEY)).toBe(false);
  });

  test("a stored page tab wins, and junk is dropped without a throw", () => {
    const chosen = memoryStorage({ [LEGACY_LOWER_TAB_KEY]: JSON.stringify("dcf"), [PAGE_TAB_KEY]: JSON.stringify("summary") });
    migrateLowerTab(chosen);
    expect(chosen.map.get(PAGE_TAB_KEY)).toBe(JSON.stringify("summary"));
    const junk = memoryStorage({ [LEGACY_LOWER_TAB_KEY]: "{not json" });
    expect(() => migrateLowerTab(junk)).not.toThrow();
    expect([...junk.map.keys()]).toEqual([]);
  });

  test("it runs once: a second call finds nothing to move", () => {
    const storage = memoryStorage({ [LEGACY_LOWER_TAB_KEY]: JSON.stringify("comparison") });
    migrateLowerTab(storage);
    storage.map.set(PAGE_TAB_KEY, JSON.stringify("summary"));
    migrateLowerTab(storage);
    expect(storage.map.get(PAGE_TAB_KEY)).toBe(JSON.stringify("summary"));
  });
});

test.describe("restoreTabState", () => {
  test("a migration that runs first is read in the same pass", () => {
    const storage = memoryStorage({ [LEGACY_LOWER_TAB_KEY]: JSON.stringify("comparison") });
    expect(restoreTabState<string>(storage, PAGE_TAB_KEY, () => migrateLowerTab(storage))).toBe("comparison");
  });

  test("with nothing stored and no migration, the read gives null", () => {
    expect(restoreTabState<string>(memoryStorage({}), PAGE_TAB_KEY)).toBeNull();
  });
});

test.describe("isOneScreenRoute", () => {
  test("the listed route and the paths under it are one-screen; a longer name is not", () => {
    expect(ONE_SCREEN_ROUTES).toContain("/corporate");
    expect(ONE_SCREEN_ROUTES).not.toContain("/");
    expect(isOneScreenRoute("/corporate")).toBe(true);
    expect(isOneScreenRoute("/corporate/x")).toBe(true);
    expect(isOneScreenRoute("/corporate-xyz")).toBe(false);
    expect(isOneScreenRoute("/")).toBe(false);
  });
});
