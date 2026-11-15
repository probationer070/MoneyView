import { expect, test } from "@playwright/test";
import { mockPortfolioPageApi, type PortfolioPageMockStats } from "./helpers/portfolioPageMock";

// The page sections are tabs under the header now, not an icon rail with a side panel.

async function gotoPortfolio(page: import("@playwright/test").Page) {
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
}

test("three page tabs in order, Stocks selected by default, and no icon rail", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);

  const tabs = page.getByRole("tablist", { name: "Portfolio views" }).getByRole("tab");
  await expect(tabs).toHaveText(["Stocks", "Weights", "Attribution"]);
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "false");
  await expect(page.getByLabel("Portfolio sections")).toHaveCount(0);
  await expect(page.getByTestId("portfolio-rail")).toHaveCount(0);
  await expect(page.getByTestId("stock-tile-AAPL")).toBeVisible({ timeout: 60_000 });
});

test("the Weights tab shows the allocation editor", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);

  await page.getByRole("tab", { name: "Weights" }).click();
  await expect(page.getByRole("tab", { name: "Weights" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel").getByLabel("Total investment amount")).toBeVisible();
  await expect(page.getByLabel("Portfolio table scroll region")).toBeVisible();
});

test("the Attribution tab calculates through its own button", async ({ page }) => {
  const stats: PortfolioPageMockStats = {
    comparisonRequests: 0,
    comparisonHistoryRequests: 0,
    attributionRequests: 0,
    stockDetailRequests: 0,
    stockSnapshotHistoryRequests: 0,
  };
  await mockPortfolioPageApi(page, stats);
  await gotoPortfolio(page);

  await page.getByRole("tab", { name: "Attribution" }).click();
  expect(stats.attributionRequests).toBe(0);
  await page.getByRole("button", { name: "Refresh Analysis" }).click();
  await expect.poll(() => stats.attributionRequests).toBeGreaterThan(0);
});

test("Add To Portfolio from the stock detail modal lands on the Weights tab", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);

  await page.getByTestId("stock-tile-AAPL").click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: /Review Portfolio Weight|Add To Portfolio/ }).click();

  await expect(page.getByRole("tab", { name: "Weights" })).toHaveAttribute("aria-selected", "true");
});
