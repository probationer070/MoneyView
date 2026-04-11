import { expect, test, type Page } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";

async function gotoPortfolio(page: Page) {
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Starting Core Analytics...")).toHaveCount(0);
  await expect(page.getByText("Watchlist Holdings", { exact: true })).toBeVisible();
}

function removeButtons(page: Page) {
  return page.locator("button").filter({ hasText: /^Remove$/ });
}

async function clearAllHoldings(page: Page) {
  await gotoPortfolio(page);

  while ((await removeButtons(page).count()) > 0) {
    await removeButtons(page).first().click();
    await page.waitForTimeout(500);
  }

  await expect(page.getByText("No Holdings Yet")).toBeVisible();
}

async function addHolding(page: Page, ticker: string, name: string, sector: string) {
  await page.getByLabel("Ticker", { exact: true }).fill(ticker);
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Sector", { exact: true }).fill(sector);
  await page.getByRole("button", { name: "Save Manual Ticker" }).click();
  await expect(page.getByText(`Saved ${ticker} as a tracked holding with 0.0% portfolio allocation.`)).toBeVisible();
}

async function savePortfolioAllocation(page: Page, ticker: string, allocationPercent: string) {
  const allocationToggle = page.getByRole("button", { name: /Portfolio Allocation \(Cash & Weight Control, Testing Purpose\)/ });
  if (await page.getByRole("button", { name: "Normalize To 100%" }).count() === 0) {
    await allocationToggle.click();
  }
  const row = page.locator("tr").filter({ has: page.getByRole("cell", { name: ticker, exact: true }) }).first();
  await row.locator('input[type="number"]').fill(allocationPercent);
  await row.getByRole("button", { name: "Save", exact: true }).click();
}

test("deleting all holdings leaves the portfolio empty after reload", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);
  await expect(removeButtons(page)).toHaveCount(5);

  await clearAllHoldings(page);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("No Holdings Yet")).toBeVisible();
  await expect(removeButtons(page)).toHaveCount(0);
});

test("added holdings persist and the portfolio table shows saved allocations", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await clearAllHoldings(page);

  await addHolding(page, "AAPL", "Apple Inc.", "Technology");
  await addHolding(page, "MSFT", "Microsoft Corp.", "Technology");
  await savePortfolioAllocation(page, "AAPL", "60");
  await expect(page.getByText("Saved allocation for AAPL.")).toBeVisible();
  await savePortfolioAllocation(page, "MSFT", "40");
  await expect(page.getByText("Saved allocation for MSFT.")).toBeVisible();

  await expect(removeButtons(page)).toHaveCount(2);
  await expect(
    page.getByText(/Export writes the current DB-backed watchlist, including weights, into/),
  ).toBeVisible();

  await page.getByRole("button", { name: "Table" }).click();
  await expect(page.getByRole("columnheader", { name: "Allocation", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "60.0%" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "40.0%" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Export JSON" })).toBeEnabled();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(removeButtons(page)).toHaveCount(2);
  await page.getByRole("button", { name: "Table" }).click();
  await expect(page.getByRole("cell", { name: "60.0%" }).first()).toBeVisible();
});

test("clicking a holding opens the stock detail modal", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await clearAllHoldings(page);
  await addHolding(page, "AAPL", "Apple Inc.", "Technology");

  await page.locator('[role="button"]').filter({ hasText: "Apple Inc." }).first().click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("OHLC Candlestick + Volume", { exact: true })).toBeVisible();
  await expect(page.getByText("Stock News", { exact: true })).toBeVisible();
  await expect(page.getByText("ROIC - WACC", { exact: true })).toBeVisible();
  await expect(page.getByText("DCF Upside", { exact: true })).toBeVisible();
  await expect(page.getByText("Expected vs Market", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Close stock detail" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("weight editing and sync or import controls are visible and actionable", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await clearAllHoldings(page);
  await addHolding(page, "AAPL", "Apple Inc.", "Technology");
  await savePortfolioAllocation(page, "AAPL", "25");
  await expect(page.getByText("Saved allocation for AAPL.")).toBeVisible();

  await expect(page.getByText("Latest Snapshot Summary")).toBeVisible();
  await expect(page.getByLabel("Portfolio comparison source")).toBeVisible();
  await expect(page.getByLabel("Portfolio comparison universe")).toBeVisible();
  await expect(page.getByLabel("Portfolio benchmark preset")).toBeVisible();
  await expect(page.getByLabel("Portfolio benchmark ticker")).toHaveValue("^GSPC");
  await page.getByLabel("Portfolio comparison source").selectOption("live");
  await expect(page.getByText(/Market expected return: 9\.70%/)).toBeVisible();
  await expect(page.getByText(/Primary stock return:/)).toBeVisible();
  await page.getByLabel("Portfolio benchmark preset").selectOption("kosdaq");
  await expect(page.getByLabel("Portfolio benchmark ticker")).toHaveValue("^KQ11");
  await page.getByLabel("Portfolio comparison universe").selectOption("custom");
  await expect(page.getByLabel("Portfolio custom tickers")).toBeVisible();
  await page.getByLabel("Portfolio benchmark ticker").fill("^IXIC");
  await page.getByLabel("Portfolio custom tickers").fill("NVDA, TSLA");
  await expect(page.getByText("Custom tickers: NVDA, TSLA.")).toBeVisible();
  await page.getByRole("button", { name: "Save Current As Snapshot" }).click();
  await expect(page.getByText(/Saved portfolio snapshot for/)).toBeVisible();
  await page.getByRole("button", { name: "Open Snapshot History" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Snapshot History" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "manual_refresh" })).toBeVisible();
  await page.getByRole("button", { name: "Close snapshot history" }).click();

  const allocationSection = page.getByRole("button", { name: /Portfolio Allocation \(Cash & Weight Control, Testing Purpose\)/ });
  await expect(allocationSection).toBeVisible();
  if (await page.getByRole("button", { name: "Normalize To 100%" }).count() === 0) {
    await allocationSection.click();
  }
  await expect(page.getByRole("button", { name: "Normalize To 100%" })).toBeVisible();
  const applyToSnapshotToggle = page.locator('input[aria-label="Apply allocation changes to snapshot"]');
  await expect(applyToSnapshotToggle).not.toBeChecked();
  await applyToSnapshotToggle.check();
  await savePortfolioAllocation(page, "AAPL", "35");
  await expect(page.getByText(/Saved allocation for AAPL and updated the/)).toBeVisible();
  await page.getByRole("button", { name: "Normalize To 100%" }).click();
  await expect(page.getByText(/Normalized weights and updated the/)).toBeVisible();

  await page.getByRole("button", { name: "Export Watchlist To JSON" }).click();
  await expect(page.getByText("Exported 1 holdings to stock_targets.json from the DB-backed watchlist.")).toBeVisible();
  await expect(page.getByText("Last sync/import source: watchlist_db_sync")).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("replace the current DB watchlist");
    await dialog.dismiss();
  });
  await page.getByLabel("Arm destructive JSON import").check();
  await page.getByRole("button", { name: "Import JSON Into DB" }).click();
  await expect(page.locator('[role="button"]').filter({ hasText: "Apple Inc." }).first()).toBeVisible();
});
