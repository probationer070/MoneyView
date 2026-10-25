import { expect, test, type Page } from "@playwright/test";
import { mockDetailPage } from "./helpers/detailPageMock";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";

/**
 * Blocked site storage must never break a page. Every Storage call throws, for every key, in
 * both localStorage and sessionStorage: a stub that exempts a key proves nothing about that key's
 * readers (ERROR-LOG 2026-10-24, the locale crash). The pages below each kept their own storage
 * helpers whose catch blocks called `removeItem` unguarded, and whose writes had no guard at all.
 */
async function blockStorage(page: Page) {
  await page.addInitScript(() => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    Storage.prototype.getItem = blocked;
    Storage.prototype.setItem = blocked;
    Storage.prototype.removeItem = blocked;
  });
}

test("portfolio loads when storage throws", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await blockStorage(page);
  await mockPortfolioPageApi(page);
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("grid-search")).toBeVisible();
  expect(errors, "nothing crashes").toEqual([]);
});

test("detail page renders when storage throws", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await blockStorage(page);
  await mockDetailPage(page, "AAPL");
  await page.goto("/detail/AAPL", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("tile-1w")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("detail-movers-up")).toBeVisible();
  expect(errors, "nothing crashes").toEqual([]);
});
