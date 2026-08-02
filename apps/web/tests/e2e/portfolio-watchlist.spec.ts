import { expect, test, type Page } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import { openPortfolioPanel, portfolioModal } from "./helpers/portfolioPanels";

async function gotoPortfolio(page: Page) {
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Starting Core Analytics...")).toHaveCount(0);
  // The holdings section is behind the rail now, so the grid is what "loaded" looks like.
  await expect(page.getByTestId("grid-search")).toBeVisible();
}

function removeButtons(page: Page) {
  return page.locator("button").filter({ hasText: /^Remove$/ });
}

async function clearAllHoldings(page: Page) {
  await gotoPortfolio(page);
  await openPortfolioPanel(page, "holdings");

  while ((await removeButtons(page).count()) > 0) {
    await removeButtons(page).first().click();
    await page.waitForTimeout(500);
  }

  await expect(page.getByText("No Holdings Yet")).toBeVisible();
}

async function addHolding(page: Page, ticker: string, name: string, sector: string) {
  await openPortfolioPanel(page, "allocation");
  await page.getByLabel("Add to Watchlist only").check();
  await page.getByLabel("Ticker", { exact: true }).fill(ticker);
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Sector", { exact: true }).fill(sector);
  await page.getByRole("button", { name: "Save Manual Ticker" }).click();
  await expect(page.getByText(`Saved ${ticker} as a tracked holding with 0.0% portfolio allocation.`)).toBeVisible();
}

function browserRow(page: Page, ticker: string) {
  return page.locator("div").filter({ has: page.getByText(ticker, { exact: true }) }).filter({ has: page.getByRole("button") }).first();
}

async function addHoldingWithAllocation(page: Page, ticker: string, name: string, sector: string, allocationPercent: string) {
  await openPortfolioPanel(page, "allocation");
  await page.getByLabel("Add to Watchlist only").uncheck();
  await page.getByLabel("Ticker", { exact: true }).fill(ticker);
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Sector", { exact: true }).fill(sector);
  await page.getByLabel("Initial allocation percent").fill(allocationPercent);
  await page.getByRole("button", { name: "Save Manual Ticker" }).click();
  await expect(page.getByText(`Saved ${ticker} with an active portfolio allocation.`)).toBeVisible();
}

async function savePortfolioAllocation(page: Page, ticker: string, allocationPercent: string) {
  await openPortfolioPanel(page, "allocation");
  const row = page.locator("tr").filter({ has: page.getByRole("cell", { name: ticker, exact: true }) }).first();
  await row.locator("td").nth(2).getByRole("button").dblclick();
  const input = row.locator("td").nth(2).locator('input[type="number"]');
  await input.fill(allocationPercent);
  await input.blur();
}

async function refreshPortfolioAnalysis(page: Page) {
  await openPortfolioPanel(page, "snapshot");
  await page.getByRole("button", { name: "Refresh Analysis" }).click();
  await expect(page.getByText(/Refreshing portfolio comparison, snapshot history, and attribution\./)).toBeVisible();
}

test("deleting all holdings leaves the portfolio empty after reload", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);
  await openPortfolioPanel(page, "holdings");
  await expect(removeButtons(page)).toHaveCount(5);

  await clearAllHoldings(page);

  await page.reload({ waitUntil: "domcontentloaded" });
  await openPortfolioPanel(page, "holdings");
  await expect(page.getByText("No Holdings Yet")).toBeVisible();
  await expect(removeButtons(page)).toHaveCount(0);
});

test("added holdings persist and the portfolio table shows saved allocations", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await clearAllHoldings(page);

  await openPortfolioPanel(page, "allocation");
  await page.getByLabel("Stock browser search").fill("AAPL");
  await expect(browserRow(page, "AAPL").getByRole("button", { name: "+ Add" })).toBeVisible();
  await addHoldingWithAllocation(page, "AAPL", "Apple Inc.", "Technology", "60");
  await expect(browserRow(page, "AAPL").getByRole("button", { name: "Added" })).toBeVisible();
  await addHolding(page, "MSFT", "Microsoft Corp.", "Technology");
  await savePortfolioAllocation(page, "MSFT", "40");
  await expect(page.getByText("Saved allocation for MSFT.")).toBeVisible();

  // Saved weights and the JSON export live in the allocation workspace.
  await expect(
    page.getByText(/Export writes the current DB-backed watchlist, including weights, into/),
  ).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Allocation", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "60.0%" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "40.0%" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Export Watchlist To JSON" })).toBeEnabled();

  // The comparison metric cells live in the holdings table.
  await openPortfolioPanel(page, "holdings");
  await expect(removeButtons(page)).toHaveCount(2);
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.getByRole("cell", { name: /14\.31%/ }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: /4\.61%/ }).first()).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await openPortfolioPanel(page, "holdings");
  await expect(removeButtons(page)).toHaveCount(2);
  await openPortfolioPanel(page, "allocation");
  await page.getByLabel("Stock browser search").fill("AAPL");
  await expect(browserRow(page, "AAPL").getByRole("button", { name: "Added" })).toBeVisible();
  await expect(page.getByRole("button", { name: "60.0%" }).first()).toBeVisible();
});

test("clicking a holding opens the stock detail modal", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await clearAllHoldings(page);
  await addHolding(page, "AAPL", "Apple Inc.", "Technology");
  await openPortfolioPanel(page, "holdings");

  const stockTrigger = page.locator('[role="button"]').filter({ hasText: "Apple Inc." }).first();
  await stockTrigger.focus();
  await expect(stockTrigger).toBeFocused();
  await stockTrigger.click();

  const stockDetailDialog = portfolioModal(page);
  const closeButton = stockDetailDialog.getByRole("button", { name: "Close modal" });
  await expect(stockDetailDialog).toBeVisible();
  await expect(closeButton).toBeFocused();
  await expect(stockDetailDialog.locator("h2").filter({ hasText: "OHLC Candlestick + Volume" })).toBeVisible();
  await expect(stockDetailDialog.getByText("Ticker News Feed (filtered)", { exact: true })).toBeVisible();
  await expect(stockDetailDialog.getByText("ROIC - WACC", { exact: true }).first()).toBeVisible();
  await expect(stockDetailDialog.getByText("DCF Upside", { exact: true }).first()).toBeVisible();
  await expect(stockDetailDialog.getByText("Expected vs Market", { exact: true }).first()).toBeVisible();
  await expect(stockDetailDialog.getByText("14.31%").first()).toBeVisible();
  await expect(stockDetailDialog.getByText("4.61%").first()).toBeVisible();
  await expect(stockDetailDialog.getByRole("heading", { name: "ROIC Audit" })).toBeVisible();
  await expect(stockDetailDialog.getByRole("heading", { name: "WACC Audit" })).toBeVisible();
  await expect(stockDetailDialog.getByText("Average invested capital")).toBeVisible();
  await expect(stockDetailDialog.getByText("Market capitalization was unavailable").first()).toBeVisible();
  await expect(stockDetailDialog.getByRole("link", { name: "View Full Detail" })).toHaveAttribute("href", "/detail/AAPL");
  await expect(stockDetailDialog.getByText(/Saved snapshot metrics from/)).toBeVisible();
  await expect(stockDetailDialog.getByLabel("Stock sector")).toHaveValue("Technology");
  await stockDetailDialog.getByLabel("Stock sector").fill("Consumer Technology");
  await stockDetailDialog.getByRole("button", { name: "Save Sector" }).click();
  await expect(stockDetailDialog.getByText("Saved sector for AAPL.")).toBeVisible();

  await expect(stockDetailDialog.getByRole("heading", { name: "Stock History Timeline" })).toBeVisible();
  await expect(stockDetailDialog.getByText("Saved Snapshots", { exact: true })).toBeVisible();
  await expect(stockDetailDialog.getByText("Expected Spread Trend")).toBeVisible();
  await expect(stockDetailDialog.getByText("Saved Snapshot History", { exact: true })).toBeVisible();
  await expect(stockDetailDialog.getByRole("heading", { name: "4/11/2026", exact: true })).toBeVisible();
  await expect(stockDetailDialog.getByText("13.20%").first()).toBeVisible();

  // Closed through the button rather than Escape: with a rail panel open behind it the
  // modal never sees the Escape keydown. That is a live defect, recorded in ERROR-LOG.md
  // and task-12-report.md, not something this spec should bless.
  await stockDetailDialog.getByRole("button", { name: "Close modal" }).click();
  await expect(portfolioModal(page)).toHaveCount(0);
});

test("stock detail modal shows explicit error states when detail and news requests fail", async ({ page }) => {
  await mockPortfolioPageApi(page, undefined, { failStockDetail: true, failNewsFeed: true });
  await clearAllHoldings(page);
  await addHolding(page, "AAPL", "Apple Inc.", "Technology");
  await refreshPortfolioAnalysis(page);

  await openPortfolioPanel(page, "holdings");
  await page.locator('[role="button"]').filter({ hasText: "Apple Inc." }).first().click();

  const stockDetailDialog = portfolioModal(page);
  await expect(stockDetailDialog).toBeVisible();
  await expect(stockDetailDialog.getByText("Stock Detail Unavailable")).toBeVisible();
  await expect(stockDetailDialog.getByText("Filtered News Unavailable")).toBeVisible();
});

test("deleted holdings stay searchable and can reopen detail from the stock search panel", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await clearAllHoldings(page);
  await addHolding(page, "AAPL", "Apple Inc.", "Technology");

  await clearAllHoldings(page);
  await expect(page.getByText("No Holdings Yet")).toBeVisible();

  await openPortfolioPanel(page, "allocation");
  await page.getByLabel("Stock browser search").fill("AAPL");
  const aaplSearchRow = browserRow(page, "AAPL");
  await expect(aaplSearchRow.getByRole("button", { name: "Open Detail", exact: true })).toBeVisible();
  await expect(aaplSearchRow.getByRole("button", { name: "+ Add" })).toBeVisible();

  await aaplSearchRow.getByRole("button", { name: "Open Detail", exact: true }).click();
  const stockDetailDialog = portfolioModal(page);
  await expect(stockDetailDialog).toBeVisible();
  await expect(stockDetailDialog.getByText("Apple Inc.")).toBeVisible();
  await expect(stockDetailDialog.getByRole("button", { name: "Remove From Watchlist" })).toHaveCount(0);
  await expect(stockDetailDialog.getByRole("button", { name: "Add To Portfolio" })).toBeVisible();
  await stockDetailDialog.getByRole("button", { name: "Close modal" }).click();
  await expect(stockDetailDialog).toHaveCount(0);

  await aaplSearchRow.getByRole("button", { name: "+ Add" }).click();
  await expect(page.getByText("Saved AAPL as a tracked holding with 0.0% portfolio allocation.")).toBeVisible();
  await expect(aaplSearchRow.getByRole("button", { name: "Added" })).toBeVisible();
});

test("weight editing and sync or import controls are visible and actionable", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await clearAllHoldings(page);
  await addHolding(page, "AAPL", "Apple Inc.", "Technology");
  await expect(page.getByLabel("Add to Watchlist only")).toBeChecked();
  await expect(page.getByLabel("Initial allocation percent")).toBeDisabled();
  await savePortfolioAllocation(page, "AAPL", "25");
  await expect(page.getByText("Saved allocation for AAPL.")).toBeVisible();
  await page.getByLabel("Total investment amount").fill("25000");
  await expect(page.getByText(/Saved total investment amount/)).toBeVisible();

  await openPortfolioPanel(page, "snapshot");
  await expect(page.getByText("Latest Snapshot Summary").first()).toBeVisible();
  await expect(page.getByLabel("Portfolio comparison source")).toBeVisible();
  await expect(page.getByLabel("Portfolio comparison universe")).toBeVisible();
  await expect(page.getByLabel("Portfolio benchmark preset")).toBeVisible();
  await expect(page.getByLabel("Portfolio benchmark ticker")).toHaveValue("^GSPC");
  await expect(page.getByText(/Preset is currently S&P 500\./)).toBeVisible();
  await expect(page.getByText(/Live mode is review-only\./)).toBeVisible();
  await page.getByLabel("Portfolio comparison source").selectOption("live");
  await refreshPortfolioAnalysis(page);
  await expect(page.getByText(/Market expected return: 9\.70%/)).toBeVisible();
  await expect(page.getByText(/Primary stock return:/)).toBeVisible();
  await page.getByLabel("Portfolio benchmark preset").selectOption("kosdaq");
  await expect(page.getByLabel("Portfolio benchmark ticker")).toHaveValue("^KQ11");
  await expect(page.getByText(/Preset is currently KOSDAQ\./)).toBeVisible();
  await page.getByLabel("Portfolio comparison universe").selectOption("custom");
  await expect(page.getByLabel("Portfolio custom tickers")).toBeVisible();
  await expect(page.getByText(/Custom Universe compares the selected benchmark/)).toBeVisible();
  await page.getByLabel("Portfolio benchmark ticker").fill("^IXIC");
  await page.getByLabel("Portfolio custom tickers").fill("NVDA, TSLA");
  await refreshPortfolioAnalysis(page);
  await expect(page.getByText(/Custom tickers:/)).toBeVisible();
  await expect(page.getByText("NVDA, TSLA")).toBeVisible();
  await expect(page.getByText(/Preset is currently Manual ticker\./)).toBeVisible();
  await page.getByRole("button", { name: "Save Current As Snapshot" }).click();
  await expect(page.getByText(/Saved portfolio snapshot for/)).toBeVisible();
  await page.getByLabel("Holding Start Date").fill("2026-01-15");
  await page.getByLabel("Return End Date").fill("2026-04-10");
  await expect(page.getByLabel("Holding Start Date")).toHaveValue("2026-01-15");
  await expect(page.getByLabel("Return End Date")).toHaveValue("2026-04-10");
  await page.getByRole("button", { name: "Open Snapshot History" }).click();
  const snapshotHistoryDialog = portfolioModal(page);
  await expect(snapshotHistoryDialog).toBeVisible();
  await expect(snapshotHistoryDialog.getByRole("heading", { name: "Snapshot History" })).toBeVisible();
  await expect(snapshotHistoryDialog.getByText("manual_refresh snapshot")).toBeVisible();
  await snapshotHistoryDialog.getByRole("button", { name: "Review Snapshot" }).nth(1).click();
  await expect(page.getByText(/Reviewing saved snapshot from Apr 10, 2026|Reviewing saved snapshot from 4\/10\/2026/)).toBeVisible();
  await expect(page.getByText(/saved benchmark and universe from that snapshot stay locked/i)).toBeVisible();
  await page.getByLabel("Portfolio benchmark preset").selectOption("kosdaq");
  await expect(page.getByLabel("Portfolio benchmark ticker")).toHaveValue("^KQ11");

  await openPortfolioPanel(page, "allocation");
  await expect(page.getByRole("button", { name: "Normalize To 100%" })).toBeVisible();
  const applyToSnapshotToggle = page.locator('input[aria-label="Apply allocation changes to snapshot"]');
  await expect(applyToSnapshotToggle).not.toBeChecked();
  await applyToSnapshotToggle.check();
  await savePortfolioAllocation(page, "AAPL", "35");
  // The confirmation for this allocation-panel action is rendered by the snapshot panel.
  await openPortfolioPanel(page, "snapshot");
  await expect(page.getByText(/Saved allocation changes and updated the/)).toBeVisible();
  await openPortfolioPanel(page, "allocation");
  await page.getByRole("button", { name: "Normalize To 100%" }).click();
  await expect(page.getByText("Normalized saved stock weights to 100.0% invested.")).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel("Holding Start Date")).toHaveValue("2026-01-15");
  await expect(page.getByLabel("Return End Date")).toHaveValue("2026-04-10");

  await openPortfolioPanel(page, "allocation");
  await page.getByRole("button", { name: "Export Watchlist To JSON" }).click();
  await expect(page.getByText("Exported 1 holdings to stock_targets.json from the DB-backed watchlist.")).toBeVisible();
  await expect(page.getByText("Last sync/import source: watchlist_db_sync")).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("replace the current DB watchlist");
    await dialog.dismiss();
  });
  await page.getByLabel("Arm destructive JSON import").check();
  await page.getByRole("button", { name: "Import JSON Into DB" }).click();
  await openPortfolioPanel(page, "holdings");
  await expect(page.locator('[role="button"]').filter({ hasText: "Apple Inc." }).first()).toBeVisible();
});

test("allocation normalize updates saved weights to a 100 percent total", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await clearAllHoldings(page);

  await addHoldingWithAllocation(page, "AAPL", "Apple Inc.", "Technology", "20");
  await addHoldingWithAllocation(page, "MSFT", "Microsoft Corp.", "Technology", "30");

  // The saved weights are the allocation workspace's own table; the holdings view toggle
  // this test used to click never affected them.
  await openPortfolioPanel(page, "allocation");
  await expect(page.getByRole("button", { name: "20.0%" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "30.0%" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Normalize To 100%" }).click();
  await expect(page.getByText("Normalized saved stock weights to 100.0% invested.")).toBeVisible();

  await expect(page.getByRole("button", { name: "40.0%" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "60.0%" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "20.0%" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "30.0%" })).toHaveCount(0);
});

test("portfolio table prioritizes comparison columns on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);
  await openPortfolioPanel(page, "holdings");

  await expect(page.getByText(/Mobile view keeps the core comparison columns visible first\./).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "ROIC - WACC", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "DCF Upside", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Expected vs Market", exact: true }).first()).toBeVisible();
  await expect(page.locator("th").filter({ hasText: /^Trend$/ }).first()).toBeHidden();
  await expect(page.getByText("Technology").first()).toBeVisible();
});

test("portfolio allocation table keeps long ticker lists inside a scroll region", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await clearAllHoldings(page);

  for (let index = 1; index <= 14; index += 1) {
    const ticker = `TST${index}`;
    await addHolding(page, ticker, `Test Holding ${index}`, "Technology");
  }

  await openPortfolioPanel(page, "allocation");

  const scrollRegion = page.getByLabel("Portfolio table scroll region");
  await expect(scrollRegion).toBeVisible();

  const overflowState = await scrollRegion.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      overflowY: style.overflowY,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  });

  expect(["auto", "scroll"]).toContain(overflowState.overflowY);
  expect(overflowState.scrollHeight).toBeGreaterThan(overflowState.clientHeight);

  await scrollRegion.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  const bottomSlider = scrollRegion.locator('input[type="range"]').last();
  await expect(bottomSlider).toBeVisible();
});

test("portfolio table and stock modal stay aligned on latest snapshot metric values and source context", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);

  await openPortfolioPanel(page, "holdings");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.getByRole("cell", { name: /14\.31%/ }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: /4\.61%/ }).first()).toBeVisible();

  await openPortfolioPanel(page, "allocation");
  await page.getByLabel("Stock browser search").fill("AAPL");
  await page.getByRole("button", { name: "Open Detail", exact: true }).first().click();
  const stockDetailDialog = portfolioModal(page);
  await expect(stockDetailDialog).toBeVisible();
  await expect(stockDetailDialog.getByText("14.31%").first()).toBeVisible();
  await expect(stockDetailDialog.getByText("4.61%").first()).toBeVisible();
  await expect(stockDetailDialog.getByText(/Saved snapshot metrics from/)).toBeVisible();
});
