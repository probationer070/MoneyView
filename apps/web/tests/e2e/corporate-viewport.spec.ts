import { expect, test, type Page } from "@playwright/test";
import { mockCorporatePageApi, type CorporatePageMockStats } from "./helpers/corporatePageMock";

function createStats(): CorporatePageMockStats {
  return {
    dcfRequests: 0,
    dcfFullReportRequests: 0,
    dcfBulkReportRequests: 0,
    comparisonRequests: 0,
    metricSaveRequests: 0,
    metricHistoryRequests: 0,
    quarterlyRequests: 0,
    ohlcvRequests: 0,
  };
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
    .toBeTruthy();
}

test("corporate graphs stay visible across mobile and desktop viewports without reload-triggered recalculation calls", async ({ page }) => {
  const stats = createStats();
  await mockCorporatePageApi(page, stats);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Company Status Diagnosis").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Hurdle Rate Decomposition").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("4-Quadrant Value Driver Matrix").first()).toBeVisible({ timeout: 60_000 });
  await page.getByText("Risk-Return Minard Chart").first().scrollIntoViewIfNeeded();
  await expect(page.getByText("Risk-Return Minard Chart").first()).toBeVisible({ timeout: 60_000 });
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.getByText("Core Diagnostics")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Target Stock Comparison")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Risk-Return Minard Chart").first()).toBeVisible({ timeout: 60_000 });
  await expectNoHorizontalOverflow(page);

  expect(stats.dcfRequests).toBe(0);
  expect(stats.comparisonRequests).toBe(0);
  expect(stats.metricHistoryRequests).toBe(0);
  expect(stats.metricSaveRequests).toBe(0);
  expect(stats.quarterlyRequests).toBe(0);
  expect(stats.ohlcvRequests).toBe(0);
});
