import { expect, test, type Page } from "@playwright/test";
import type { CorporateMetricAudit, CorporateMetricAuditEntry } from "../../../../packages/shared-types";
import { mockCorporatePageApi, type CorporatePageMockStats } from "./helpers/corporatePageMock";
import { openDetailTab, refreshDcf } from "./helpers/corporateDcf";

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
  await expect(dialog(page).getByRole("button", { name: "Load source data" })).toBeVisible();
  await page.waitForLoadState("networkidle");
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
