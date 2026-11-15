import { expect, test, type Page } from "@playwright/test";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";
import { lowerPanel, openLowerTab } from "./helpers/corporateDcf";
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

// Plan 2026-11-16 S3b: source/as-of caption, stale badge, refused display.
const refusalPatch = {
  wacc: null, cost_of_equity: null, assumptions: null,
  wacc_refusal: { code: "assumptions_missing", missing: ["risk_free_rate", "equity_risk_premium"] },
};
const unavailable = { status: "unavailable", reason: "assumptions_missing", wacc_refusal: refusalPatch.wacc_refusal };

test("the caption under the Ke card names the echoed source and as-of", async ({ page }) => {
  await goto(page, { assumptions: echo({}) });
  const caption = page.getByTestId("assumption-source-caption").first();
  await expect(caption).toContainText("Risk-free: FRED DGS10, 2026-11-13");
  await expect(caption).toContainText("ERP: owner, 2026-11-16");
});

test("the hurdle chart carries the caption and keeps its bar label format", async ({ page }) => {
  await goto(page, { assumptions: echo({}) });
  await page.getByTestId("corporate-page-tabs").getByRole("tab", { name: "Core Diagnostics", exact: true }).click();
  await expect(lowerPanel(page).getByRole("button", { name: /Risk-free: 4\.0%/ })).toBeVisible({ timeout: 30_000 });
  await expect(lowerPanel(page).getByTestId("assumption-source-caption")).toContainText("FRED DGS10, 2026-11-13");
});

test("a stale flag shows the badge and a fresh echo does not", async ({ page }) => {
  await goto(page, { assumptions: echo({ stale: ["erp"] }) });
  const badges = page.getByTestId("assumption-stale-badge");
  await expect(badges).toHaveCount(1);
  await expect(badges).toContainText("ERP is older than 120 days");
});

test("a fresh echo shows no stale badge", async ({ page }) => {
  await goto(page, { assumptions: echo({}) });
  await expect(page.getByTestId("assumption-source-caption").first()).toBeVisible();
  await expect(page.getByTestId("assumption-stale-badge")).toHaveCount(0);
});

test("a refused WACC shows the reason and no number on the WACC tile and the Ke card", async ({ page }) => {
  await goto(page, refusalPatch);
  const refused = page.getByTestId("wacc-refused");
  await expect(refused).toContainText("WACC unavailable");
  await expect(refused).toContainText("risk_free_rate, equity_risk_premium");
  await expect(refused).not.toContainText(/\d+(\.\d+)?%/);
  // Neither the seed WACC (10.0%) nor the slider value stands in for it.
  await expect(page.getByTestId("corporate-kpis")).not.toContainText("10.0%");
  await expect(tile(page, "Bottom-up Ke")).not.toContainText(/\d+(\.\d+)?%/);
  await page.getByTestId("corporate-page-tabs").getByRole("tab", { name: "Core Diagnostics", exact: true }).click();
  await expect(lowerPanel(page).getByTestId("wacc-refused")).toBeVisible({ timeout: 30_000 });
  await expect(lowerPanel(page).getByRole("button", { name: /Risk-free:/ })).toHaveCount(0);
});

test.describe("ko-KR", () => {
  test.use({ locale: "ko-KR" });
  test("the refusal reads in Korean", async ({ page }) => {
    await mockCorporatePageApi(page, undefined, { aaplMetricsPatch: refusalPatch });
    await page.goto("/corporate", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "기업 분석" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("wacc-refused")).toContainText("WACC를 계산할 수 없음");
    await expect(page.getByTestId("wacc-refused")).toContainText("시장 가정에서 입력하세요");
  });
});

test("the DCF route's unavailable payload shows the reason, not a value", async ({ page }) => {
  await mockCorporatePageApi(page, undefined, { aaplMetricsPatch: refusalPatch });
  await page.route("**/api/v1/corporate/dcf/AAPL/stream", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(unavailable),
  }));
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Refresh DCF" }).click();
  const verdict = page.getByTestId("corporate-verdict");
  await expect(verdict).toHaveAttribute("data-state", "refused");
  await expect(verdict.getByTestId("dcf-refusal")).toContainText("No risk-free rate or equity risk premium is on file");
});

test("the comparison table shows the reason instead of rows when assumptions are missing", async ({ page }) => {
  await mockCorporatePageApi(page, undefined, { aaplMetricsPatch: refusalPatch });
  await page.route("**/api/v1/corporate/comparison*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(unavailable),
  }));
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
  await openLowerTab(page, "Target Stock Comparison");
  await page.getByRole("button", { name: "Refresh comparison" }).click();
  await expect(page.getByTestId("comparison-refused")).toContainText("No risk-free rate or equity risk premium is on file", { timeout: 30_000 });
});
