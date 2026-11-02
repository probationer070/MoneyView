import { expect, test } from "@playwright/test";
import { runStatusView, beforeText } from "../../app/monte-carlo/lib/resultModel";
import { translate } from "../../lib/i18n/translate";
import { en } from "../../lib/i18n/messages/en";
import { tokens } from "../../lib/tokens.generated";
import { formatKrwCompact, krwAxis } from "../../app/monte-carlo/lib/krwFormat";
import { formatUsdRange, usd } from "../../app/monte-carlo/lib/usdFormat";
import { runValuationMonteCarlo } from "../../app/monte-carlo/lib/valuation-core";
import type { ValuationInput } from "../../app/monte-carlo/lib/types";
import { isMonteCarloTab, MONTE_CARLO_TAB_KEY } from "../../app/monte-carlo/lib/tabs";

// Pure model spec (no page): the KRW strings and the axis ticks are pinned here, in both locales.
test.describe("formatKrwCompact", () => {
  test("en pins the millions unit, the integer-won branch and the sign", () => {
    expect(formatKrwCompact(9_640_000, "en")).toBe("KRW 9.64M");
    expect(formatKrwCompact(950_000, "en")).toBe("KRW 950,000");
    expect(formatKrwCompact(-9_640_000, "en")).toBe("-KRW 9.64M");
    expect(formatKrwCompact(999_999.6, "en")).toBe("KRW 1.00M");
    expect(formatKrwCompact(0, "en")).toBe("KRW 0");
  });

  test("ko pins the 만원 unit, the 억 branch, the won branch and the sign", () => {
    expect(formatKrwCompact(9_640_000, "ko")).toBe("964만원");
    expect(formatKrwCompact(123_450_000, "ko")).toBe("1억 2,345만원");
    expect(formatKrwCompact(100_000_000, "ko")).toBe("1억원");
    expect(formatKrwCompact(9_500, "ko")).toBe("9,500원");
    expect(formatKrwCompact(-9_640_000, "ko")).toBe("-964만원");
  });

  test("ko unit edges use the rounded value: 만원 rounding and 억 rounding", () => {
    expect(formatKrwCompact(9_999.6, "ko")).toBe("1만원");
    expect(formatKrwCompact(99_995_000, "ko")).toBe("1억원");
    expect(formatKrwCompact(-0.4, "ko")).toBe("0원");
    expect(formatKrwCompact(1_234_567_890_000, "ko")).toBe("12,345억 6,789만원");
  });

  test("missing and non-finite values read as the dash, in both locales", () => {
    for (const locale of ["en", "ko"] as const) {
      expect(formatKrwCompact(Number.NaN, locale)).toBe("—");
      expect(formatKrwCompact(Number.POSITIVE_INFINITY, locale)).toBe("—");
      expect(formatKrwCompact(Number.NEGATIVE_INFINITY, locale)).toBe("—");
      expect(formatKrwCompact(null, locale)).toBe("—");
      expect(formatKrwCompact(undefined, locale)).toBe("—");
    }
  });
});

test.describe("krwAxis", () => {
  test("en ticks are millions with one decimal; ko ticks are 만원", () => {
    expect(krwAxis("en").tick(9_640_000)).toBe("9.6");
    expect(krwAxis("ko").tick(9_640_000)).toBe("964");
    expect(krwAxis("en").divisor).toBe(1_000_000);
    expect(krwAxis("ko").divisor).toBe(10_000);
    expect(krwAxis("en").unitKey).toBe("monteCarlo.units.krwAxis");
  });

  test("a non-finite tick reads as the dash", () => {
    expect(krwAxis("en").tick(Number.NaN)).toBe("—");
    expect(krwAxis("ko").tick(Number.NaN)).toBe("—");
  });
});

test.describe("isMonteCarloTab", () => {
  test("the five tabs are tabs; everything else is not, and nothing throws", () => {
    for (const key of ["path", "risk", "distribution", "valuation", "correlation"]) {
      expect(isMonteCarloTab(key)).toBe(true);
    }
    for (const bad of ["bogus", "constructor", "__proto__", "", 1, null, undefined]) {
      expect(isMonteCarloTab(bad)).toBe(false);
    }
    expect(MONTE_CARLO_TAB_KEY).toBe("moneyview.tab.monteCarlo.tab");
  });
});

// Run-status view and before/after text: pure, no page. Labels are catalog keys, checked against en.
test.describe("runStatusView", () => {
  test("loading is running, with progress rounded to a whole percent", () => {
    expect(runStatusView("loading", 45.6, false)).toEqual({ state: "running", labelKey: "monteCarlo.status.running", progress: 46 });
  });

  test("progress is clamped to 0..100 and NaN reads as 0", () => {
    expect(runStatusView("loading", -5, false).progress).toBe(0);
    expect(runStatusView("loading", 130, false).progress).toBe(100);
    expect(runStatusView("loading", Number.NaN, false).progress).toBe(0);
  });

  test("a running job is running even when an older result exists", () => {
    expect(runStatusView("loading", 10, true).state).toBe("running");
  });

  test("error is failed, with or without an older result, and has no progress", () => {
    expect(runStatusView("error", 80, false)).toEqual({ state: "failed", labelKey: "monteCarlo.status.failed", progress: null });
    expect(runStatusView("error", 80, true).state).toBe("failed");
  });

  test("cancelled is cancelled and has no progress", () => {
    expect(runStatusView("cancelled", 30, true)).toEqual({ state: "cancelled", labelKey: "monteCarlo.status.cancelled", progress: null });
  });

  test("idle with a result is ready; idle without one is empty; progress is null unless running", () => {
    expect(runStatusView("idle", 50, true)).toEqual({ state: "ready", labelKey: "monteCarlo.status.ready", progress: null });
    expect(runStatusView("idle", 50, false)).toEqual({ state: "empty", labelKey: "monteCarlo.status.empty", progress: null });
  });

  test("every label key resolves to its English catalog text", () => {
    const labels = [
      runStatusView("idle", 0, false).labelKey,
      runStatusView("loading", 0, false).labelKey,
      runStatusView("error", 0, false).labelKey,
      runStatusView("cancelled", 0, false).labelKey,
      runStatusView("idle", 0, true).labelKey,
    ];
    expect(labels.map((key) => translate(en, key))).toEqual([
      "No analysis run yet",
      "Running",
      "Run failed",
      "Run canceled",
      "Results ready",
    ]);
  });
});

test.describe("beforeText", () => {
  const fmtEn = (n: number) => formatKrwCompact(n, "en");
  const fmtKo = (n: number) => formatKrwCompact(n, "ko");

  test("returns the previous figure's text when it differs from the current one", () => {
    expect(beforeText(9_640_000, 9_800_000, fmtEn)).toBe("KRW 9.64M");
    expect(beforeText(9_640_000, 9_800_000, fmtKo)).toBe("964만원");
  });

  test("returns null when both figures format to the same text", () => {
    expect(beforeText(9_640_000, 9_640_100, fmtEn)).toBeNull();
  });

  test("returns null when either side is missing or not finite", () => {
    expect(beforeText(null, 9_800_000, fmtEn)).toBeNull();
    expect(beforeText(undefined, 9_800_000, fmtEn)).toBeNull();
    expect(beforeText(9_640_000, null, fmtEn)).toBeNull();
    expect(beforeText(Number.NaN, 9_800_000, fmtEn)).toBeNull();
    expect(beforeText(9_640_000, Number.POSITIVE_INFINITY, fmtEn)).toBeNull();
  });
});

test.describe("layout tokens", () => {
  test("the rail width and chart minimum height are the approved 320px and 200px", () => {
    expect(tokens.component.rail.width).toBe("320px");
    expect(tokens.component.chart["min-height"]).toBe("200px");
  });
});

// Per-share price and the valuation interval are dollars in both locales (owner, 2026-11-01; replaces D8 for this tab).
test.describe("usd and formatUsdRange", () => {
  test("usd: $ prefix and two decimals in both locales; NaN and Infinity are a dash", () => {
    expect(usd(187.415, "en")).toBe("$187.42");
    expect(usd(187.415, "ko")).toBe("$187.42");
    expect(usd(50_000, "en")).toBe("$50,000.00");
    expect(usd(Number.NaN, "ko")).toBe("—");
    expect(usd(Number.POSITIVE_INFINITY, "en")).toBe("—");
  });

  test("usd: the sign goes before the $, and a value that rounds to zero has no sign", () => {
    expect(usd(-5, "en")).toBe("-$5.00");
    expect(usd(-0.004, "en")).toBe("$0.00");
    expect(usd(-0, "ko")).toBe("$0.00");
  });

  test("formatUsdRange: each end is a full dollar figure, joined by an en dash", () => {
    expect(formatUsdRange(41.2, 58.9, "en")).toBe("$41.20–$58.90");
    expect(formatUsdRange(-5, 3, "ko")).toBe("-$5.00–$3.00");
    expect(formatUsdRange(-0.004, 0, "en")).toBe("$0.00–$0.00");
  });

  test("formatUsdRange: either side missing or not finite reads a dash", () => {
    for (const locale of ["en", "ko"] as const) {
      expect(formatUsdRange(null, 58.9, locale)).toBe("—");
      expect(formatUsdRange(41.2, Number.NaN, locale)).toBe("—");
    }
  });
});

// Deterministic inputs: no uncertainty, one forecast year, no growth, 10% discount rate.
// Fair value = eps/1.1 + eps*PER/1.1, with PER = price/EPS.
function certainInput(currentPrice: number, baseEps: number): ValuationInput {
  return {
    ticker: "TEST", currentPrice, baseEps, averageGrowthRate: 0, growthUncertainty: 0, discountRate: 10,
    discountRateUncertainty: 0, terminalGrowthRate: 0, forecastPeriodYears: 1, targetPerUncertainty: 0,
    simulationCount: 10, seed: 1,
  };
}

test.describe("valuation engine in dollars", () => {
  test("an EPS below $1 keeps its own P/E: price 10, EPS 0.50 gives P/E 20, fair value 9.55", () => {
    // Under the won-era floor of 1 the P/E was 10/1 = 10 and the fair value 5.00.
    const summary = runValuationMonteCarlo(certainInput(10, 0.5)).fair_value_summary;
    expect(summary.fair_value_median).toBe(9.55);
  });

  test("the summary keeps cents: price 187.42 stays 187.42", () => {
    const summary = runValuationMonteCarlo(certainInput(187.42, 9.37)).fair_value_summary;
    expect(summary.current_price).toBe(187.42);
  });
});
