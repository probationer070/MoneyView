import { expect, test, type Page } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";

// The backend distinguishes "this failed" from "there is nothing here". The UI has to
// keep that distinction, or the fix that made the backend honest is undone one layer up.
//
// ERROR-LOG.md (2026-08-02) records StockNewsCrawler reporting every provider failure as
// "no news"; the crawler now propagates failures. A tile that renders a failed bulk fetch
// as the never-checked placeholder puts the same claim back on screen.

const RAIL_REFRESH = "Refresh news for visible stocks";

function rail(page: Page) {
  return page.getByTestId("portfolio-rail");
}

async function gotoGrid(page: Page) {
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
}

test("a failed news load says so instead of leaving every tile reading as unchecked", async ({ page }) => {
  await mockPortfolioPageApi(page, undefined, { failBulkNews: true });
  await gotoGrid(page);

  // Positive control: the grid rendered, so this is an assertion about a live page.
  await expect(page.getByTestId("stock-tile-AAPL")).toBeVisible({ timeout: 60_000 });

  await expect(page.getByTestId("news-load-error")).toBeVisible();
});

test("no news-load error appears when the feed loads", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  await expect(page.getByTestId("stock-tile-AAPL")).toBeVisible({ timeout: 60_000 });

  await expect(page.getByTestId("news-load-error")).toHaveCount(0);
});

test("refresh names the tickers the backend did not recognise", async ({ page }) => {
  await mockPortfolioPageApi(page, undefined, { acquireSkippedUnknown: ["ZZZZ", "QQQQ"] });
  await gotoGrid(page);

  await rail(page).getByRole("button", { name: RAIL_REFRESH }).click();

  const summary = page.getByTestId("news-refresh-summary");
  // Named, not counted: which ticker was dropped is the actionable part, and the count
  // alone would let a typo'd ticker sit in the watchlist forever looking like "no news".
  await expect(summary).toContainText("2 not recognised (ZZZZ, QQQQ)");
});

test("refresh with nothing to do does not report it as a successful refresh", async ({ page }) => {
  await mockPortfolioPageApi(page, undefined, { acquireReturnsNoResults: true });
  await gotoGrid(page);

  await rail(page).getByRole("button", { name: RAIL_REFRESH }).click();

  const summary = page.getByTestId("news-refresh-summary");
  // "0 refreshed · 0 already current" is a report about work that never happened; it
  // reads as a clean run rather than as nothing having been requested.
  await expect(summary).toContainText("Nothing to refresh");
  await expect(summary).not.toContainText("already current");
});
