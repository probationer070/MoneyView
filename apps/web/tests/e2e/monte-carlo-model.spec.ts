import { expect, test } from "@playwright/test";
import { runStatusView, beforeText } from "../../app/monte-carlo/lib/resultModel";
import { translate } from "../../lib/i18n/translate";
import { en } from "../../lib/i18n/messages/en";
import { tokens } from "../../lib/tokens.generated";
import { formatKrwCompact, formatKrwRange, krw, krwAxis } from "../../app/monte-carlo/lib/krwFormat";
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

// Per-share price and the valuation interval: en keeps the KRW prefix, ko uses the 원 suffix (owner decision D8).
test.describe("krw and formatKrwRange", () => {
  test("krw: en reads KRW 50,000 and ko reads 50,000원; NaN is a dash in both", () => {
    expect(krw(50_000, "en")).toBe("KRW 50,000");
    expect(krw(50_000, "ko")).toBe("50,000원");
    expect(krw(Number.NaN, "en")).toBe("—");
    expect(krw(Number.NaN, "ko")).toBe("—");
  });

  test("formatKrwRange: en keeps the prefix once; ko puts 원 once after the range, joined by an en dash", () => {
    expect(formatKrwRange(41_200, 58_900, "en")).toBe("KRW 41,200–58,900");
    expect(formatKrwRange(41_200, 58_900, "ko")).toBe("41,200–58,900원");
    expect(formatKrwRange(41_200, 58_900, "ko").includes("KRW")).toBe(false);
  });

  test("krw: the sign goes first, rounds half away from zero, and a value that rounds to zero has no sign", () => {
    expect(krw(-5_000, "en")).toBe("-KRW 5,000");
    expect(krw(-5_000, "ko")).toBe("-5,000원");
    expect(krw(-2.5, "en")).toBe("-KRW 3");
    expect(krw(-0.4, "en")).toBe("KRW 0");
    expect(krw(-0.4, "ko")).toBe("0원");
    expect(krw(-0, "en")).toBe("KRW 0");
    expect(krw(-0, "ko")).toBe("0원");
  });

  test("formatKrwRange: each end carries its own sign, rounds half away from zero, and never prints -0", () => {
    expect(formatKrwRange(-5_000, -3_000, "en")).toBe("KRW -5,000–-3,000");
    expect(formatKrwRange(-5_000, 3_000, "ko")).toBe("-5,000–3,000원");
    expect(formatKrwRange(-2.5, 2.5, "en")).toBe("KRW -3–3");
    expect(formatKrwRange(-0.4, 0, "en")).toBe("KRW 0–0");
    expect(formatKrwRange(-0, -0.4, "ko")).toBe("0–0원");
  });

  test("formatKrwRange: either side not finite reads a dash", () => {
    for (const locale of ["en", "ko"] as const) {
      expect(formatKrwRange(null, 58_900, locale)).toBe("—");
      expect(formatKrwRange(41_200, Number.NaN, locale)).toBe("—");
      expect(formatKrwRange(Number.POSITIVE_INFINITY, 58_900, locale)).toBe("—");
    }
  });
});
