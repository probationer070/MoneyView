import { expect, test, type Page } from "@playwright/test";
import { API_PREFIX, json } from "./helpers/mockUtils";
import { mockPortfolioPageApi, type PortfolioPageMockStats } from "./helpers/portfolioPageMock";
import { portfolioPartialWeightsFixture } from "./fixtures/shared";
import { openPortfolioPanel, portfolioModal } from "./helpers/portfolioPanels";

async function gotoPortfolio(page: Page) {
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Starting Core Analytics...")).toHaveCount(0);
  // The holdings section is behind the rail now, so the grid is what "loaded" looks like.
  await expect(page.getByTestId("grid-search")).toBeVisible();
}

function removeButtons(page: Page) {
  // Per-row Remove buttons are gone (D6); delete lives in the stock detail modal. What this
  // counted was the holdings, so it counts their tiles or, in table view, their rows.
  return page.getByRole("tabpanel").locator('[data-testid^="stock-tile-cell-"], tbody tr');
}

async function clearAllHoldings(page: Page) {
  await gotoPortfolio(page);
  await openPortfolioPanel(page, "holdings");

  // The Remove button lives in the stock detail modal now that the holdings panel is gone.
  const tiles = page.getByRole("button", { name: /^Open details for/ });
  let remaining = await tiles.count();
  while (remaining > 0) {
    await tiles.first().click({ force: true });
    const dialog = portfolioModal(page);
    await dialog.getByRole("button", { name: "Remove From Watchlist" }).click();
    await expect(dialog).toHaveCount(0);
    // Wait for the tile to leave before opening the next one, or the modal opens for a stock being removed.
    remaining -= 1;
    await expect(tiles).toHaveCount(remaining);
  }
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

test.describe("wide window layout", () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test("stock detail modal: news sits beside the chart only, metrics run full width below", async ({ page }) => {
    await mockPortfolioPageApi(page);
    // Forty articles: far taller than the chart, so a news column not bound to the chart row
    // would stretch the row (and push the metrics down) instead of scrolling inside it.
    await page.route(/\/api\/v1\/news\/feed\?/, (route) => json(route, Array.from({ length: 40 }, (_, index) => ({
      id: index + 1, ticker: "AAPL", headline: `AAPL news ${index + 1}`, url: `https://example.com/AAPL/${index + 1}`,
      source: "Mock News", published_date: "2026-04-10", sentiment: "neutral", importance: 1,
    }))));
    await clearAllHoldings(page);
    await addHolding(page, "AAPL", "Apple Inc.", "Technology");
    await openPortfolioPanel(page, "holdings");
    await page.getByTestId("stock-tile-AAPL").click();
    const dialog = portfolioModal(page);
    const roic = dialog.getByText("ROIC - WACC", { exact: true }).first();
    await expect(roic).toBeVisible({ timeout: 60_000 });
    const chart = await dialog.getByTestId("stock-detail-chart").boundingBox();
    const news = await dialog.getByTestId("stock-detail-news").boundingBox();
    const tile = await roic.boundingBox();
    expect(chart && news && tile).toBeTruthy();
    // The news column ends with the chart row instead of stretching down the whole modal.
    expect(Math.abs(news!.height - chart!.height)).toBeLessThanOrEqual(2);
    // The metric tiles start below that row, not beside the news.
    expect(tile!.y).toBeGreaterThan(news!.y + news!.height);
    // The row is as tall as the chart, not as tall as the news list: no empty band under the chart.
    const slack = await dialog.getByTestId("stock-detail-chart").evaluate((section) => {
      const last = section.lastElementChild as HTMLElement;
      return section.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom;
    });
    expect(slack).toBeLessThan(40);
  });

});

test("clicking a holding opens the stock detail modal", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await clearAllHoldings(page);
  await addHolding(page, "AAPL", "Apple Inc.", "Technology");
  await openPortfolioPanel(page, "holdings");

  const stockTrigger = page.getByTestId("stock-tile-AAPL");
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
  await expect(stockDetailDialog.getByText("DCF value vs price (one-off gap)", { exact: true }).first()).toBeVisible();
  await expect(stockDetailDialog.getByText("Implied return vs WACC (pts per year)", { exact: true }).first()).toBeVisible();
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
  await expect(stockDetailDialog.getByText("Implied return vs WACC trend")).toBeVisible();
  await expect(stockDetailDialog.getByText("Saved Snapshot History", { exact: true })).toBeVisible();
  await expect(stockDetailDialog.getByRole("heading", { name: "4/11/2026", exact: true })).toBeVisible();
  await expect(stockDetailDialog.getByText("13.20%").first()).toBeVisible();

  // Escape closes the modal. Overlays listen on `document`, and ModalShell's listener used to
  // be re-registered mid-dispatch -- which the DOM skips for that keypress (ERROR-LOG.md 2026-08-02).
  await page.keyboard.press("Escape");
  await expect(portfolioModal(page)).toHaveCount(0);
});

test("the stock modal saves a theme without touching the sector", async ({ page }) => {
  // Catches a theme save that goes through the full-row upsert (which rewrites sector and
  // weight) or that posts a body other than {"theme": id}.
  await mockPortfolioPageApi(page, undefined, {
    watchlist: portfolioPartialWeightsFixture.map((row) => (
      row.ticker === "AAPL" ? { ...row, theme: "ai_semis" } : row
    )),
  });
  const fullRowPosts: string[] = [];
  const themePostBodies: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const { pathname } = new URL(request.url());
    if (pathname === `${API_PREFIX}/portfolio/watchlist`) fullRowPosts.push(request.url());
    if (pathname === `${API_PREFIX}/portfolio/watchlist/AAPL/theme`) themePostBodies.push(request.postData() ?? "");
  });

  await gotoPortfolio(page);
  await openPortfolioPanel(page, "holdings");
  await page.getByTestId("stock-tile-AAPL").click();

  const stockDetailDialog = portfolioModal(page);
  await expect(stockDetailDialog).toBeVisible();
  const themeSelect = stockDetailDialog.getByLabel("Stock theme");
  await expect(themeSelect).toHaveValue("ai_semis");
  await expect(themeSelect.locator("option:checked")).toHaveText("AI semiconductors");

  await themeSelect.selectOption({ label: "Memory & storage" });
  await stockDetailDialog.getByRole("button", { name: "Save Theme" }).click();

  await expect(stockDetailDialog.getByText("Saved theme for AAPL.")).toBeVisible();
  expect(fullRowPosts).toEqual([]);
  expect(themePostBodies).toEqual(['{"theme":"memory_storage"}']);
  await expect(themeSelect.locator("option:checked")).toHaveText("Memory & storage");
  await expect(stockDetailDialog.getByLabel("Stock sector")).toHaveValue("Technology");
});

test("stock detail modal shows explicit error states when detail and news requests fail", async ({ page }) => {
  await mockPortfolioPageApi(page, undefined, { failStockDetail: true, failNewsFeed: true });
  await clearAllHoldings(page);
  await addHolding(page, "AAPL", "Apple Inc.", "Technology");

  await openPortfolioPanel(page, "holdings");
  await page.getByTestId("stock-tile-AAPL").click();

  const stockDetailDialog = portfolioModal(page);
  await expect(stockDetailDialog).toBeVisible();
  await expect(stockDetailDialog.getByText("Stock Detail Unavailable")).toBeVisible();
  await expect(stockDetailDialog.getByText("Filtered News Unavailable")).toBeVisible();
});

test("deleted holdings stay searchable and can reopen detail from the stock search panel", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await clearAllHoldings(page);
  await addHolding(page, "AAPL", "Apple Inc.", "Technology");

  // The Weights tab was the last one open; select Stocks so the reload below restores it (tab state is per session).
  await openPortfolioPanel(page, "holdings");
  await clearAllHoldings(page);
  await expect(page.getByRole("button", { name: /^Open details for/ })).toHaveCount(0);

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

  await openPortfolioPanel(page, "allocation");
  await expect(page.getByRole("button", { name: "Normalize To 100%" })).toBeVisible();
  const applyToSnapshotToggle = page.locator('input[aria-label="Apply allocation changes to snapshot"]');
  await expect(applyToSnapshotToggle).not.toBeChecked();
  await applyToSnapshotToggle.check();
  await savePortfolioAllocation(page, "AAPL", "35");
  await expect(page.getByText(/Saved allocation changes and updated the/)).toBeVisible();
  await page.getByRole("button", { name: "Normalize To 100%" }).click();
  await expect(page.getByText("Normalized saved stock weights to 100.0% invested.")).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await openPortfolioPanel(page, "allocation");
  await page.getByRole("button", { name: "Export Watchlist To JSON" }).click();
  await expect(page.getByText("Exported 1 holdings to data/exports/watchlist-export.json.")).toBeVisible();
  await expect(page.getByText("Last sync/import source: watchlist_db_sync")).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("replace the current DB watchlist");
    await dialog.dismiss();
  });
  await page.getByLabel("Arm destructive JSON import").check();
  await page.getByRole("button", { name: "Import JSON Into DB" }).click();
  await openPortfolioPanel(page, "holdings");
  await expect(page.getByTestId("stock-tile-AAPL")).toBeVisible();
});

test("normalize is not undone by a stale debounced weight draft", async ({ page }) => {
  const stats: PortfolioPageMockStats = {
    comparisonRequests: 0,
    stockDetailRequests: 0,
    stockSnapshotHistoryRequests: 0,
    watchlistSaves: [],
  };
  await mockPortfolioPageApi(page, stats);
  await clearAllHoldings(page);
  await addHolding(page, "AAPL", "Apple Inc.", "Technology");
  await savePortfolioAllocation(page, "AAPL", "35");
  await expect(page.getByText("Saved allocation for AAPL.")).toBeVisible();

  // Normalize straight after the save, while the debounced draft copy still reads 35.
  const savesBeforeNormalize = stats.watchlistSaves?.length ?? 0;
  await page.getByRole("button", { name: "Normalize To 100%" }).click();
  await expect.poll(() => stats.watchlistSaves?.slice(savesBeforeNormalize).at(-1)?.weight).toBe(1);
  await expect(page.getByText("Normalized saved stock weights to 100.0% invested.")).toBeVisible();
  // Let the 450 ms debounce window pass so a stale auto-save would have fired by now.
  await page.waitForTimeout(1000);

  const savesAfterNormalize = stats.watchlistSaves?.slice(savesBeforeNormalize) ?? [];
  expect(savesAfterNormalize.some((save) => save.ticker === "AAPL" && save.weight === 0.35)).toBe(false);
  expect(savesAfterNormalize.at(-1)).toEqual({ ticker: "AAPL", weight: 1 });
  await expect(page.getByText("Normalized saved stock weights to 100.0% invested.")).toBeVisible();
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
  await page.getByRole("button", { name: "Table", exact: true }).click();

  await expect(page.getByText(/Mobile view keeps the core comparison columns visible first\./).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "ROIC - WACC", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "DCF value vs price (one-off gap)", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Implied return vs WACC (pts per year)", exact: true }).first()).toBeVisible();
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

test("the holdings table shows implied return vs WACC, and a refused row says why", async ({ page }) => {
  await mockPortfolioPageApi(page, undefined, { nullMetricTicker: "MSFT" });
  await gotoPortfolio(page);
  await openPortfolioPanel(page, "holdings");
  // Desktop opens on cards; the comparison columns live in the table view.
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Implied return vs WACC (pts per year)" }).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "DCF value vs price (one-off gap)" }).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Expected vs Market" })).toHaveCount(0);
  const msft = page.locator("tr", { hasText: "MSFT" }).first();
  await expect(msft.locator('[title*="No current price"]')).toHaveCount(1);
});

test("the trend delta is not taken across a snapshot that recorded no implied return", async ({ page }) => {
  await mockPortfolioPageApi(page);
  // Registered after the catch-all so it wins (Playwright matches in reverse order).
  await page.route(
    (url) => url.pathname === `${API_PREFIX}/corporate/comparison/stock-history`,
    (route) => json(route, {
      status: "ok",
      data: {
        ticker: "AAPL", comparison_universe: "portfolio_plus_benchmark", benchmark_ticker: "^GSPC", custom_tickers: [],
        points: [
          { as_of_date: "2026-09-26", generated_at: "2026-09-26T09:00:00Z", snapshot_version: "v3", snapshot_source: "manual",
            benchmark_ticker: "^GSPC", current_price: 210, roic_minus_wacc: 8, dcf_implied_return: 12, implied_return_spread: 2.0, implied_return_refusal: null, market_expected_return: 9.7 },
          { as_of_date: "2026-08-03", generated_at: "2026-08-03T09:00:00Z", snapshot_version: "v2", snapshot_source: "manual",
            benchmark_ticker: "^GSPC", current_price: 200, roic_minus_wacc: 8, dcf_implied_return: 10, implied_return_spread: null, implied_return_refusal: null, market_expected_return: 9.7 },
        ],
      },
    }),
  );
  await clearAllHoldings(page);
  await addHolding(page, "AAPL", "Apple Inc.", "Technology");
  await openPortfolioPanel(page, "holdings");
  await page.getByTestId("stock-tile-AAPL").click();
  const delta = portfolioModal(page).getByTestId("implied-spread-trend-delta");
  await expect(delta).toBeVisible();
  await expect(delta).not.toHaveText("2.00%");
  await expect(delta).toHaveText("N/A");
});

async function openAppleDetailWithHistory(page: Page, points: Array<Record<string, unknown>>) {
  await mockPortfolioPageApi(page);
  await page.route(
    (url) => url.pathname === `${API_PREFIX}/corporate/comparison/stock-history`,
    (route) => json(route, {
      status: "ok",
      data: { ticker: "AAPL", comparison_universe: "portfolio_plus_benchmark", benchmark_ticker: "^GSPC", custom_tickers: [], points },
    }),
  );
  await clearAllHoldings(page);
  await addHolding(page, "AAPL", "Apple Inc.", "Technology");
  await openPortfolioPanel(page, "holdings");
  await page.getByTestId("stock-tile-AAPL").click();
  return portfolioModal(page);
}

function historyPoint(date: string, version: string, extra: Record<string, unknown>) {
  return {
    as_of_date: date, generated_at: `${date}T09:00:00Z`, snapshot_version: version, snapshot_source: "manual",
    benchmark_ticker: "^GSPC", current_price: 200, roic_minus_wacc: 8, dcf_implied_return: 10, dcf_refusal: null,
    implied_return_spread: 1.0, implied_return_refusal: null, market_expected_return: 9.7, ...extra,
  };
}

test("a refused point in stock history says why its DCF value is absent", async ({ page }) => {
  const modal = await openAppleDetailWithHistory(page, [
    historyPoint("2026-09-27", "v4", { dcf_implied_return: null, dcf_refusal: "non_positive_fcff", implied_return_spread: null, implied_return_refusal: "non_positive_fcff" }),
  ]);
  await expect(modal.getByText(/zero or negative over the forecast/).first()).toBeVisible();
  await expect(modal.getByText("Saved snapshot is missing DCF value vs price for this ticker.")).toHaveCount(0);
});

test("the trend delta uses the latest and oldest points that recorded an implied return", async ({ page }) => {
  // Newest first: 2.0 (v3), 1.25 (v3), then a pre-v3 point with none. The delta is between the
  // two recorded points (0.75), not blank because the oldest point predates v3.
  const modal = await openAppleDetailWithHistory(page, [
    historyPoint("2026-09-27", "v3b", { implied_return_spread: 2.0 }),
    historyPoint("2026-09-26", "v3a", { implied_return_spread: 1.25 }),
    historyPoint("2026-08-03", "v2", { implied_return_spread: null }),
  ]);
  await expect(modal.getByTestId("implied-spread-trend-delta")).toHaveText("0.75%");
});
