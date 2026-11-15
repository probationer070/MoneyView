import { expect, test, type Page } from "@playwright/test";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";
import { lowerPanel } from "./helpers/corporateDcf";
import * as constants from "../../app/corporate/corporateConstants";

// Plan 2026-11-16 S3a: rf, ERP and CRP come from `metrics.assumptions`, never from a literal in the page.
const echo = (patch: Record<string, unknown>) => ({
  risk_free_rate: 4.0, risk_free_source: "FRED DGS10", risk_free_as_of: "2026-11-13",
  equity_risk_premium: 5.0, erp_source: "owner", erp_as_of: "2026-11-16",
  crp: 0.5, crp_basis: "non_mature_rule", stale: [], ...patch,
});

const tile = (page: Page, label: string) => page.getByTestId("corporate-kpis").locator(":scope > *").filter({ hasText: label });

async function goto(page: Page, patch: Record<string, unknown>) {
  await mockCorporatePageApi(page, undefined, { aaplMetricsPatch: patch });
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
}

test.use({ viewport: { width: 1280, height: 720 } });

test("the constants module no longer exports rf, ERP or CRP literals", () => {
  for (const name of ["RISK_FREE_RATE", "EQUITY_RISK_PREMIUM", "KOREA_COUNTRY_RISK_PREMIUM"]) {
    expect(Object.keys(constants)).not.toContain(name);
  }
});

test("a re-levered Ke and the hurdle bars follow the echoed rf and ERP", async ({ page }) => {
  await goto(page, { crp: 0.5, assumptions: echo({}) });
  // 1.05 x [1 + 0.79 x 18/82] = 1.23; 4.0 + 1.23 x 5.0 + 0.5 = 10.7%.
  await expect(tile(page, "Bottom-up Ke")).toContainText("10.7%");
  await page.getByTestId("corporate-page-tabs").getByRole("tab", { name: "Core Diagnostics", exact: true }).click();
  await expect(lowerPanel(page).getByRole("button", { name: /Risk-free: 4\.0%/ })).toBeVisible({ timeout: 30_000 });
  await expect(lowerPanel(page).getByRole("button", { name: /Beta x ERP: 6\.2%/ })).toBeVisible();
});

test("a missing crp falls to the echoed crp", async ({ page }) => {
  await goto(page, { crp: undefined, assumptions: echo({ crp: 0.5 }) });
  await expect(page.getByTestId("assumption-row-crp")).toContainText("0.5%");
});

test("a ticker with no crp and no assumptions shows CRP as a dash, not a literal", async ({ page }) => {
  await goto(page, { crp: undefined, assumptions: null });
  const row = page.getByTestId("assumption-row-crp");
  await expect(row).toContainText("—");
  await expect(row).not.toContainText("1.1%");
  await expect(row).not.toContainText("0.8%");
  await expect(row).not.toContainText("NaN");
});

test("metrics without assumptions show no Ke built from a literal rf and ERP", async ({ page }) => {
  await goto(page, { assumptions: null });
  await expect(tile(page, "Levered Beta")).toContainText("1.23");
  await expect(tile(page, "Bottom-up Ke")).not.toContainText("11.8%");
});
