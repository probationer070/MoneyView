import { expect, test, type Page } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import type { PortfolioStockFixture } from "./fixtures/shared";

// D7 (add stock dialog), D8 (automatic news fetch) and D4 (one-line subtitle) of the
// portfolio redesign. The registry in the mock holds AAPL, MSFT, NVDA, TSLA and AMZN.

function stock(ticker: string, name: string, weight: number, id: number): PortfolioStockFixture {
  return {
    ticker, name, sector: "Technology", group_name: "custom", weight,
    last_close: 100 + id, delta: { delta_pct: 0.5 }, sparkline: [95, 97, 99, 100 + id], id, theme: "",
  };
}

const WATCHLIST = [stock("AAPL", "Apple Inc.", 0.5, 1), stock("MSFT", "Microsoft Corp.", 0.25, 2)];

async function gotoStocks(page: Page) {
  await mockPortfolioPageApi(page, undefined, { watchlist: WATCHLIST });
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("stock-tile-AAPL")).toBeVisible({ timeout: 60_000 });
}

const addCard = (page: Page) => page.getByRole("button", { name: "+ Add stock" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Add stock" });

test("the add card opens a labelled dialog with focus in the search", async ({ page }) => {
  await gotoStocks(page);
  await addCard(page).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toHaveAttribute("aria-modal", "true");
  await expect(dialog(page).getByRole("textbox", { name: "Add stock" })).toBeFocused();
});

test("searching and pressing Add posts to the watchlist and the new tile appears", async ({ page }) => {
  await gotoStocks(page);
  await addCard(page).click();
  await dialog(page).getByRole("textbox", { name: "Add stock" }).fill("NVDA");
  const posted = page.waitForRequest((request) =>
    new URL(request.url()).pathname.endsWith("/portfolio/watchlist") && request.method() === "POST");
  await dialog(page).getByRole("button", { name: "+ Add", exact: true }).click();
  expect(JSON.parse((await posted).postData() ?? "{}").ticker).toBe("NVDA");
  await page.getByRole("button", { name: "Close modal" }).click();
  await expect.poll(() => page.getByTestId("stock-tile-NVDA").count()).toBeGreaterThan(0);
});

test("a ticker already in the watchlist shows Already added instead of Add", async ({ page }) => {
  await gotoStocks(page);
  await addCard(page).click();
  await dialog(page).getByRole("textbox", { name: "Add stock" }).fill("AAPL");
  await expect(dialog(page).getByRole("button", { name: "Already added" })).toBeDisabled();
  await expect(dialog(page).getByRole("button", { name: "+ Add", exact: true })).toHaveCount(0);
});

test("Escape closes the dialog and returns focus to the add card", async ({ page }) => {
  await gotoStocks(page);
  await addCard(page).focus();
  await addCard(page).click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(addCard(page)).toBeFocused();
});

test("the table view's add row opens the same dialog", async ({ page }) => {
  await gotoStocks(page);
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.getByTestId("stock-tile-AAPL")).toHaveCount(0);
  await addCard(page).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("textbox", { name: "Add stock" })).toBeFocused();
});

test("news is fetched once on first load, not again after switching tabs, and the quiet button refetches", async ({ page }) => {
  let acquireRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/news/acquire") && request.method() === "POST") acquireRequests += 1;
  });
  await gotoStocks(page);
  const quiet = page.getByRole("button", { name: /News updated (just now|\d+ min ago)/ });
  await expect(quiet).toBeVisible();
  expect(acquireRequests).toBe(1);

  await page.getByRole("tab", { name: "Weights" }).click();
  await page.getByRole("tab", { name: "Stocks" }).click();
  await expect(page.getByTestId("stock-tile-AAPL")).toBeVisible();
  await page.waitForTimeout(1_000);
  expect(acquireRequests).toBe(1);

  await quiet.click();
  await expect.poll(() => acquireRequests).toBe(2);
});

test("right after the automatic news fetch the quiet button says updated just now", async ({ page }) => {
  await gotoStocks(page);
  await expect(page.getByRole("button", { name: "News updated just now" })).toBeVisible();
});

test("the subtitle shows the stock count and the weight total", async ({ page }) => {
  await gotoStocks(page);
  await expect(page.getByTestId("portfolio-subtitle")).toHaveText("2 stocks · weights total 75.0%");
});
