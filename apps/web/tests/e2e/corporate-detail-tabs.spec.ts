import { expect, test, type Page } from "@playwright/test";
import type { CorporateMetricAudit, CorporateMetricAuditEntry } from "../../../../packages/shared-types";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";
import { openDetailTab } from "./helpers/corporateDcf";

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

test("WACC substitutes the audit's weights and costs when all six inputs are present", async ({ page }) => {
  await mockCorporatePageApi(page);
  const wacc = auditEntry(8.8, [
    { field: "equity_weight", label: "Equity weight", value: 0.82, display_value: "82.0%", source: "t" },
    { field: "cost_of_equity", label: "Cost of equity", value: 0.1, display_value: "10.0%", source: "t" },
    { field: "debt_weight", label: "Debt weight", value: 0.18, display_value: "18.0%", source: "t" },
    { field: "cost_of_debt", label: "Cost of debt", value: 0.041, display_value: "4.1%", source: "t" },
    { field: "tax_rate", label: "Tax rate", value: 0.21, display_value: "21.0%", source: "t" },
    { field: "final_wacc_value", label: "Final WACC value", value: 8.8, display_value: "8.8%", source: "t" },
  ]);
  const audit: CorporateMetricAudit = {
    ticker: "AAPL", source_mode: "yahoo_finance", generated_at: "2026-10-14T00:00:00Z", growth: null,
    roic: auditEntry(18, []), wacc, spread: auditEntry(8, []), dcf: null,
  };
  await page.route((url) => url.pathname.endsWith("/corporate/metrics/AAPL/audit"), (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(audit) }));
  await gotoCorporate(page);
  await openKpi(page, /^WACC/);
  await expect(dialog(page).getByTestId("substituted-formula"))
    .toHaveText("WACC = E/V × Ke + D/V × Kd × (1 − t) = 82.0% × 10.0% + 18.0% × 4.1% × (1 − 21.0%) = 8.8%");
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
