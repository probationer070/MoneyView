import { expect, test, type Page } from "@playwright/test";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";

// Short table headers are BilingualLabel pairs: both halves are in the DOM, and assistive tech
// reads only the active locale's half (the other is aria-hidden). So the accessible name of a
// header follows the locale, and the inactive half is absent from the accessibility tree.

async function openBatchReportTable(page: Page, tab: string, refresh: string, bulk: RegExp) {
  await mockCorporatePageApi(page);
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("corporate-page-tabs")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("corporate-page-tabs").getByRole("tab", { name: tab }).click();
  await page.getByRole("button", { name: refresh }).click();
  await expect(page.getByRole("cell", { name: "MISS" }).first()).toBeVisible({ timeout: 60_000 });
  const bulkButton = page.getByRole("button", { name: bulk });
  await expect(bulkButton).toBeEnabled({ timeout: 60_000 });
  await bulkButton.click();
}

test.describe("bilingual table headers in ko-KR", () => {
  test.use({ locale: "ko-KR" });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("moneyview.locale", "ko"));
  });

  test("the batch report and comparison headers read in Korean", async ({ page }) => {
    await openBatchReportTable(page, "종목 비교", "비교 새로고침", /전체 DCF 계산/);

    await expect(page.getByRole("columnheader", { name: "종목 코드", exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("columnheader", { name: "적정가치", exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("columnheader", { name: "보고서 ID", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Fair Value", exact: true })).toHaveCount(0);
  });
});

test.describe("bilingual table headers in en-US", () => {
  test.use({ locale: "en-US" });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("moneyview.locale", "en"));
  });

  test("the batch report headers read in English", async ({ page }) => {
    await openBatchReportTable(page, "Target Stock Comparison", "Refresh comparison", /Calculate All DCF Reports/i);

    await expect(page.getByRole("columnheader", { name: "Fair Value", exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("columnheader", { name: "Report ID", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "적정가치", exact: true })).toHaveCount(0);
  });
});
