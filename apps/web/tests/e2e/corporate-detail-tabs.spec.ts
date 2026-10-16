import { expect, test, type Page } from "@playwright/test";
import type { CorporateMetricAudit, CorporateMetricAuditEntry } from "../../../../packages/shared-types";
import { mockCorporatePageApi, type CorporatePageMockStats } from "./helpers/corporatePageMock";
import { openDetailTab, openLowerTab, refreshDcf } from "./helpers/corporateDcf";

// Spec 2026-10-14 §4 and §7 test 7.
async function gotoCorporate(page: Page) {
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
}
const dialog = (page: Page) => page.getByRole("dialog");
const detailTabs = (page: Page) => dialog(page).getByRole("tablist", { name: "Calculation detail sections" });

async function openKpi(page: Page, name: RegExp) {
  await page.getByTestId("corporate-kpis").getByRole("button", { name }).click();
  await expect(dialog(page)).toBeVisible();
}
async function openAssumptionDetail(page: Page, label: string) {
  await page.getByTestId("assumption-table").getByRole("button", { name: `${label} detail` }).click();
  await expect(dialog(page)).toBeVisible();
}
async function closeDetail(page: Page) {
  await dialog(page).getByRole("button", { name: "Close modal" }).click();
  await expect(dialog(page)).toHaveCount(0);
}

function auditEntry(value: number, inputs: CorporateMetricAuditEntry["inputs_used"]): CorporateMetricAuditEntry {
  return {
    value, display_value: `${value.toFixed(1)}%`, method: "test", quality: "ok", reason: null, warnings: [], confidence: 0.9,
    inputs_used: inputs, source: "test audit", as_of: "2025-12-31", calculation_version: "test",
  };
}

test("the header pins ticker and value; Summary, Calculation steps and Raw data split the old sections", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  await openKpi(page, /^ROIC - WACC/);
  await expect(dialog(page)).toContainText("AAPL · 8.0%");
  await expect(detailTabs(page).getByRole("tab", { name: "Summary", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(dialog(page).getByTestId("substituted-formula")).toHaveText("ROIC − WACC = 18.0% − 10.0% = 8.0%");
  await expect(dialog(page).getByText("Result Summary: value, inputs used")).toBeVisible();
  await expect(dialog(page).getByRole("columnheader", { name: "As of" })).toBeVisible();
  await expect(dialog(page).getByRole("cell", { name: "2025-12-31" }).first()).toBeVisible();

  await openDetailTab(dialog(page), "Calculation steps");
  await expect(dialog(page).getByRole("heading", { name: "ROIC - WACC Audit" })).toBeVisible();
  await expect(dialog(page).getByText("Result Summary: value, inputs used")).toHaveCount(0);

  await openDetailTab(dialog(page), "Raw data");
  await expect(dialog(page).getByRole("button", { name: "Download CSV: Analysis" })).toHaveCount(1);
  await expect(dialog(page).getByRole("heading", { name: "Raw Datasets" })).toBeVisible();
});

// The audit's WACC inputs; the final value is the argument, so a test controls the divergence from the input.
async function routeWaccAudit(page: Page, finalWacc: number) {
  const wacc = auditEntry(finalWacc, [
    { field: "equity_weight", label: "Equity weight", value: 0.82, display_value: "82.0%", source: "t" },
    { field: "cost_of_equity", label: "Cost of equity", value: 0.1, display_value: "10.0%", source: "t" },
    { field: "debt_weight", label: "Debt weight", value: 0.18, display_value: "18.0%", source: "t" },
    { field: "cost_of_debt", label: "Cost of debt", value: 0.041, display_value: "4.1%", source: "t" },
    { field: "tax_rate", label: "Tax rate", value: 0.21, display_value: "21.0%", source: "t" },
    { field: "final_wacc_value", label: "Final WACC value", value: finalWacc, display_value: `${finalWacc.toFixed(1)}%`, source: "t" },
  ]);
  const audit: CorporateMetricAudit = {
    ticker: "AAPL", source_mode: "yahoo_finance", generated_at: "2026-10-14T00:00:00Z", growth: null,
    roic: auditEntry(18, []), wacc, spread: auditEntry(8, []), dcf: null,
  };
  await page.route((url) => url.pathname.endsWith("/corporate/metrics/AAPL/audit"), (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(audit) }));
}

test("WACC substitutes the audit's weights and costs when all six inputs are present", async ({ page }) => {
  await mockCorporatePageApi(page);
  await routeWaccAudit(page, 8.8);
  await gotoCorporate(page);
  await openKpi(page, /^WACC/);
  await expect(dialog(page).getByTestId("substituted-formula"))
    .toHaveText("WACC = E/V × Ke + D/V × Kd × (1 − t) = 82.0% × 10.0% + 18.0% × 4.1% × (1 − 21.0%) = 8.8%");
  // The slider holds 10.0%, the audit 8.8%: the summary says which WACC the formula uses.
  await expect(dialog(page).getByTestId("wacc-input-note")).toHaveText("From the latest audit; your WACC input is 10.0%.");
});

test("an audit WACC equal to the input has no caption", async ({ page }) => {
  await mockCorporatePageApi(page);
  await routeWaccAudit(page, 10.0);
  await gotoCorporate(page);
  await openKpi(page, /^WACC/);
  await expect(dialog(page).getByTestId("substituted-formula")).toHaveText("WACC = E/V × Ke + D/V × Kd × (1 − t) = 82.0% × 10.0% + 18.0% × 4.1% × (1 − 21.0%) = 10.0%");
  await expect(dialog(page).getByTestId("wacc-input-note")).toHaveCount(0);
});

test("a DCF summary's as-of is the full DCF's generated_at", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  await refreshDcf(page);
  await page.getByRole("button", { name: "Verdict detail" }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("columnheader", { name: "As of" })).toBeVisible();
  await expect(dialog(page).getByRole("cell", { name: "2026-04-11T12:00:00Z" }).first()).toBeVisible();
});

test("without the audit's inputs WACC shows only the symbolic formula", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  await openKpi(page, /^WACC/);
  await expect(dialog(page).getByText("WACC = E/V x Ke + D/V x Kd x (1 - tax)")).toBeVisible();
  await expect(dialog(page).getByTestId("substituted-formula")).toHaveCount(0);
});

test("the last tab is remembered across metrics", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  await openAssumptionDetail(page, "Growth Rate");
  await openDetailTab(dialog(page), "Raw data");
  await closeDetail(page);
  await openKpi(page, /^Levered Beta/);
  await expect(detailTabs(page).getByRole("tab", { name: "Raw data" })).toHaveAttribute("aria-selected", "true");
});

function newStats(): CorporatePageMockStats {
  return {
    dcfRequests: 0, dcfFullReportRequests: 0, dcfBulkReportRequests: 0, comparisonRequests: 0,
    metricSaveRequests: 0, metricHistoryRequests: 0, quarterlyRequests: 0, ohlcvRequests: 0,
  };
}

// Spec 2026-10-14 §4 "Trend" and §7 test 9; plan N1 (only growth and ROIC have annual series).
test("growth and ROIC have a Trend tab; CRP and debt ratio do not", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  for (const [label, count] of [["Growth Rate", 1], ["ROIC", 1], ["Country Risk Premium", 0], ["Debt Ratio", 0]] as const) {
    await openAssumptionDetail(page, label);
    await expect(detailTabs(page).getByRole("tab", { name: "Trend" }), label).toHaveCount(count);
    await closeDetail(page);
  }
});

test("the trend asks for nothing until Load source data, then shows the annual values", async ({ page }) => {
  const stats = newStats();
  await mockCorporatePageApi(page, stats);
  const historyRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/corporate/metrics/AAPL/history")) historyRequests.push(request.url());
  });
  await gotoCorporate(page);
  await openAssumptionDetail(page, "Growth Rate");
  await openDetailTab(dialog(page), "Trend");
  await expect(dialog(page).getByText("Annual values load with the source data. Nothing is requested until you ask.")).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Load source data" })).toBeEnabled();
  expect(historyRequests).toEqual([]);
  expect(stats.metricHistoryRequests).toBe(0);
  await dialog(page).getByRole("button", { name: "Load source data" }).click();
  const table = dialog(page).getByTestId("trend-table");
  await expect(table).toContainText("2025", { timeout: 30_000 });
  await expect(table).toContainText("6.0%");
  expect(historyRequests).toHaveLength(1);
});

test("a metric without the remembered tab opens Summary and keeps the memory", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  await openAssumptionDetail(page, "Growth Rate");
  await openDetailTab(dialog(page), "Trend");
  await closeDetail(page);
  await openAssumptionDetail(page, "Country Risk Premium");
  await expect(detailTabs(page).getByRole("tab", { name: "Summary", exact: true })).toHaveAttribute("aria-selected", "true");
  await closeDetail(page);
  await openAssumptionDetail(page, "ROIC");
  await expect(detailTabs(page).getByRole("tab", { name: "Trend" })).toHaveAttribute("aria-selected", "true");
});

test("a series with no annual values shows the empty state, not a table of dashes", async ({ page }) => {
  await mockCorporatePageApi(page);
  await page.route((url) => url.pathname.endsWith("/corporate/metrics/AAPL/history"), (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ticker: "AAPL", start_year: 2021, country_risk_premium: 0.8, growth_cagr: null, growth_recent_average: null,
        roic_recent_average: null, roic_all_year_average: null,
        annual_growth_rates: [{ year: 2024, value: null }, { year: 2025, value: null }], annual_roic: [],
      }),
    }));
  await gotoCorporate(page);
  await openAssumptionDetail(page, "Growth Rate");
  await openDetailTab(dialog(page), "Trend");
  await dialog(page).getByRole("button", { name: "Load source data" }).click();
  await expect(dialog(page).getByText("No annual values for this metric.")).toBeVisible({ timeout: 30_000 });
  await expect(dialog(page).getByTestId("trend-table")).toHaveCount(0);
});

// Spec 2026-10-14 §4 "동종업 비교" (part A) and §7 test 10; plan Task 10.
async function refreshComparison(page: Page) {
  await openLowerTab(page, "Target Stock Comparison");
  await page.getByRole("button", { name: "Refresh comparison" }).click();
  await expect(page.getByRole("cell", { name: "GOOGL" }).first()).toBeVisible({ timeout: 30_000 });
  // Task 7b: the KPIs and Verdict detail live on the Summary page tab; go back before opening them.
  await openLowerTab(page, "Summary");
}

test("Peers waits for the comparison, then ranks this ticker inside the universe", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  await openKpi(page, /^ROIC - WACC/);
  await openDetailTab(dialog(page), "Peers");
  await expect(dialog(page)).toContainText("Shown after the comparison is calculated in the Target Stock Comparison tab.");
  await closeDetail(page);
  await refreshComparison(page);
  await openKpi(page, /^ROIC - WACC/);
  const position = dialog(page).getByTestId("peer-position");
  await expect(position).toContainText("Rank 3 of 6, high to low");
  await expect(position).toContainText("Low -15.00%");
  await expect(position).toContainText("High 13.00%");
  await expect(position.getByTestId("peer-marker")).toHaveAttribute("style", /left: 82\.1%/);
  await expect(position.getByRole("img", { name: "AAPL at 8.00%, range -15.00% to 13.00%" })).toHaveCount(1);
});

test("Peers says its value comes from the comparison run", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  await refreshComparison(page);
  await openKpi(page, /^ROIC - WACC/);
  await openDetailTab(dialog(page), "Peers");
  await expect(dialog(page).getByTestId("peer-position")).toContainText("Value from the comparison run; the rank uses that run's inputs.");
});

test("the upside position leaves out the unbridged row and the refused one", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  await refreshComparison(page);
  await page.getByRole("button", { name: "Verdict detail" }).click();
  await openDetailTab(dialog(page), "Peers");
  await expect(dialog(page).getByTestId("peer-position")).toContainText("Rank 2 of 4, high to low");
});

async function refreshCustomComparison(page: Page, tickers: string) {
  await openLowerTab(page, "Target Stock Comparison");
  await page.getByLabel("Comparison universe").selectOption("custom");
  await page.getByLabel("Custom tickers").fill(tickers);
  await page.getByRole("button", { name: "Refresh comparison" }).click();
  await expect(page.getByRole("cell", { name: tickers.split(",")[0].trim(), exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await openLowerTab(page, "Summary");
}

test("a ticker outside the comparison says so, and a lone ticker has no range to draw", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  await refreshCustomComparison(page, "NVDA, TSLA");
  await openKpi(page, /^ROIC - WACC/);
  await openDetailTab(dialog(page), "Peers");
  await expect(dialog(page).getByTestId("peer-position")).toHaveCount(0);
  await expect(dialog(page)).toContainText("AAPL is not in the current comparison universe.");
  await closeDetail(page);
  await refreshCustomComparison(page, "AAPL");
  await openKpi(page, /^ROIC - WACC/);
  await openDetailTab(dialog(page), "Peers");
  const position = dialog(page).getByTestId("peer-position");
  await expect(position).toContainText("Rank 1 of 1, high to low");
  await expect(position.getByTestId("peer-marker")).toHaveCount(0);
  await expect(position).toContainText("Only AAPL has a value in this comparison, so there is no range to draw.");
});

test("Peers flags a comparison calculated for an earlier universe", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  await refreshComparison(page);
  await openLowerTab(page, "Target Stock Comparison");
  await page.getByLabel("Comparison universe").selectOption("custom");
  await openLowerTab(page, "Summary");
  await page.getByRole("button", { name: "Verdict detail" }).click();
  await openDetailTab(dialog(page), "Peers");
  await expect(dialog(page).getByText("Calculated for an earlier universe. Recalculate in the Target Stock Comparison tab.")).toBeVisible();
});

test("a ticker with no value in the comparison says so, and shows no position", async ({ page }) => {
  await mockCorporatePageApi(page);
  // AAPL's only row, with no upside: the Peers tab must not rank it.
  await page.route((url) => url.pathname.endsWith("/corporate/comparison"), async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        data: {
          market_expected_return: 9.7,
          risk_free_rate: 4.2,
          equity_risk_premium: 5.5,
          stock_expected_return_method: "dcf_implied_upside",
          comparison_reference_return_method: "capm_beta_reference",
          snapshot: {
            mode: "live", as_of_date: "2026-04-11", generated_at: "2026-04-11T12:00:00Z", snapshot_version: "live",
            snapshot_available: false, snapshot_source: "live", comparison_universe: "portfolio_plus_benchmark",
            benchmark_ticker: "^GSPC", custom_tickers: [], snapshot_cadence: "daily_kst_0000",
            snapshot_retention_days: 365, snapshot_is_stale: false,
          },
          rows: [
            {
              ticker: "AAPL", name: "Apple", sector: "Technology", group_name: "core", weight: 0.35, roic: 18, wacc: 10,
              roic_minus_wacc: 8, dcf_value: 240.5, bridge_quality: "ok", current_price: 220, dcf_implied_return: null,
              capm_expected_return: 11.26, stock_expected_return: null, market_expected_return: 9.7,
              market_implied_return: 14.31, implied_return_spread: null, implied_return_refusal: "no_value", dcf_refusal: null,
              stock_expected_return_source: "dcf_implied_upside", has_price_data: true,
            },
          ],
        },
      }),
    });
  });
  await gotoCorporate(page);
  await openLowerTab(page, "Target Stock Comparison");
  await page.getByRole("button", { name: "Refresh comparison" }).click();
  await expect(page.getByRole("cell", { name: "AAPL", exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await openLowerTab(page, "Summary");
  await page.getByRole("button", { name: "Verdict detail" }).click();
  await openDetailTab(dialog(page), "Peers");
  await expect(dialog(page)).toContainText("No value for AAPL in this comparison.");
  await expect(dialog(page).getByTestId("peer-position")).toHaveCount(0);
});

// Spec 2026-10-14 §4.1 and §6, plan Task 11. The sensitivity tab posts to the non-stream summary route.
const isSingleDcf = (url: URL) => url.pathname.endsWith("/corporate/dcf/AAPL");

function recordSingleDcfBodies(page: Page): Record<string, number>[] {
  const bodies: Record<string, number>[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && isSingleDcf(new URL(request.url()))) bodies.push(request.postDataJSON());
  });
  return bodies;
}

test("Calculate sends exactly two DCF requests that move only WACC by ±1.0%p", async ({ page }) => {
  await mockCorporatePageApi(page);
  const bodies = recordSingleDcfBodies(page);
  await gotoCorporate(page);
  // The inputs are the hydrated ones once the table shows them.
  await expect(page.getByTestId("assumption-row-esgPenalty")).toContainText("22.0");
  await openAssumptionDetail(page, "WACC");
  await openDetailTab(dialog(page), "Sensitivity");
  const calculate = dialog(page).getByRole("button", { name: "Calculate", exact: true });
  await expect(calculate).toBeEnabled();
  await expect(dialog(page).getByTestId("sensitivity-row-current")).toBeVisible();
  expect(bodies, "nothing is sent before Calculate").toHaveLength(0);
  await calculate.click();
  await expect(dialog(page).getByTestId("sensitivity-row-up")).toContainText("$240.5", { timeout: 30_000 });
  await expect(dialog(page).getByTestId("sensitivity-row-down")).toContainText("$240.5");
  expect(bodies).toHaveLength(2);
  const [down, up] = [...bodies].sort((a, b) => a.wacc - b.wacc);
  await expect(dialog(page).getByTestId("sensitivity-row-down")).toContainText("9.0%");
  await expect(dialog(page).getByTestId("sensitivity-row-up")).toContainText("11.0%");

  // The page's own request with the inputs as they are now is the reference for the other fields.
  await closeDetail(page);
  const stream = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname.endsWith("/corporate/dcf/AAPL/stream"));
  await refreshDcf(page);
  const base = (await stream).postDataJSON() as Record<string, number>;
  expect(down.wacc).toBeCloseTo(base.wacc - 0.01, 10);
  expect(up.wacc).toBeCloseTo(base.wacc + 0.01, 10);
  expect({ ...down, wacc: base.wacc }).toEqual(base);
  expect({ ...up, wacc: base.wacc }).toEqual(base);
});

test("a run still in flight survives a tab switch and settles into the tab", async ({ page }) => {
  await mockCorporatePageApi(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route((url) => isSingleDcf(url), async (route) => {
    await held;
    return route.fallback();
  });
  await gotoCorporate(page);
  await openAssumptionDetail(page, "WACC");
  await openDetailTab(dialog(page), "Sensitivity");
  await dialog(page).getByRole("button", { name: "Calculate", exact: true }).click();
  await expect(dialog(page).getByTestId("sensitivity-row-up")).toContainText("Calculating…");
  await openDetailTab(dialog(page), "Summary");
  await openDetailTab(dialog(page), "Sensitivity");
  await expect(dialog(page).getByTestId("sensitivity-row-up")).toContainText("Calculating…");
  release();
  await expect(dialog(page).getByTestId("sensitivity-row-up")).toContainText("$240.5", { timeout: 30_000 });
  await expect(dialog(page).getByTestId("sensitivity-row-down")).toContainText("$240.5");
});

test("when one of the two runs fails, the other still shows and the failed one says so", async ({ page }) => {
  await mockCorporatePageApi(page);
  await page.route((url) => isSingleDcf(url), async (route) => {
    const body = route.request().postDataJSON() as { wacc: number };
    if (body.wacc < 0.1) {
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "Mock DCF failure" }) });
    }
    return route.fallback();
  });
  await gotoCorporate(page);
  await openAssumptionDetail(page, "WACC");
  await openDetailTab(dialog(page), "Sensitivity");
  await dialog(page).getByRole("button", { name: "Calculate", exact: true }).click();
  await expect(dialog(page).getByTestId("sensitivity-row-up")).toContainText("$240.5", { timeout: 30_000 });
  await expect(dialog(page).getByTestId("sensitivity-row-down").getByRole("alert")).toContainText("This run failed");
});

test("a refused run shows the refusal as content, not as a failure", async ({ page }) => {
  await mockCorporatePageApi(page);
  await page.route((url) => isSingleDcf(url), async (route) => {
    const body = route.request().postDataJSON() as { wacc: number };
    if (body.wacc < 0.1) {
      return route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ detail: { code: "mock_refusal", message: "Mock refusal sentence" } }),
      });
    }
    return route.fallback();
  });
  await gotoCorporate(page);
  await openAssumptionDetail(page, "WACC");
  await openDetailTab(dialog(page), "Sensitivity");
  await dialog(page).getByRole("button", { name: "Calculate", exact: true }).click();
  await expect(dialog(page).getByTestId("sensitivity-row-up")).toContainText("$240.5", { timeout: 30_000 });
  await expect(dialog(page).getByTestId("sensitivity-row-down")).toContainText("Mock refusal sentence");
  await expect(dialog(page).getByTestId("sensitivity-row-down").getByRole("alert")).toHaveCount(0);
});

test("results stay until an assumption changes, and a step past the slider floor is clamped and flagged", async ({ page }) => {
  await mockCorporatePageApi(page);
  const bodies = recordSingleDcfBodies(page);
  await gotoCorporate(page);
  await openAssumptionDetail(page, "WACC");
  await openDetailTab(dialog(page), "Sensitivity");
  await dialog(page).getByRole("button", { name: "Calculate", exact: true }).click();
  await expect(dialog(page).getByTestId("sensitivity-row-up")).toContainText("$240.5", { timeout: 30_000 });
  expect(bodies).toHaveLength(2);

  await closeDetail(page);
  await openAssumptionDetail(page, "WACC");
  await expect(dialog(page).getByTestId("sensitivity-row-up")).toContainText("$240.5");
  expect(bodies, "reopening the tab does not refetch").toHaveLength(2);

  await closeDetail(page);
  await page.getByTestId("assumption-table").getByRole("button", { name: "Edit WACC" }).click();
  await page.getByTestId("assumption-slider-wacc").getByRole("slider").press("Home");
  await openAssumptionDetail(page, "WACC");
  await expect(dialog(page).getByTestId("sensitivity-row-up")).not.toContainText("$240.5");
  await dialog(page).getByRole("button", { name: "Calculate", exact: true }).click();
  await expect(dialog(page).getByTestId("sensitivity-row-up")).toContainText("$240.5", { timeout: 30_000 });
  expect(bodies).toHaveLength(4);
  const [floorDown, floorUp] = bodies.slice(2).sort((a, b) => a.wacc - b.wacc);
  expect(floorDown.wacc).toBeCloseTo(0.02, 10);
  expect(floorUp.wacc).toBeCloseTo(0.03, 10);
  await expect(dialog(page).getByTestId("sensitivity-row-down")).toContainText("clamped to the slider range");
  await expect(dialog(page).getByTestId("sensitivity-row-up")).not.toContainText("clamped to the slider range");
});

test("an assumption the DCF does not use says so and offers nothing to run", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  await openAssumptionDetail(page, "Innovation Index");
  await openDetailTab(dialog(page), "Sensitivity");
  await expect(dialog(page)).toContainText("An assumption the DCF does not use directly.");
  await expect(dialog(page).getByRole("button", { name: "Calculate", exact: true })).toHaveCount(0);
});
