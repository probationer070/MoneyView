import { expect, test, type Page } from "@playwright/test";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";

async function tickerY(page: Page, ticker: string) {
  const box = await page.getByRole("button", { name: ticker, exact: true }).first().boundingBox();
  if (!box) {
    throw new Error(`Could not find comparison button for ${ticker}`);
  }
  return box.y;
}

test("corporate comparison table renders and exposes sorting controls", async ({ page }) => {
  await mockCorporatePageApi(page);
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Target Stock Comparison")).toBeVisible();
  await expect(page.getByLabel("Comparison universe")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("S&P 500 (^GSPC)")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel("Sort by")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel("Direction")).toBeVisible();
  await expect(page.getByText(/Portfolio snapshots and saved history are managed from the Portfolio page only\./)).toBeVisible();
  await expect(page.getByText("Live watchlist comparison")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Portfolio Testing" })).toBeVisible();
  await expect(page.getByText("Watchlist Holdings Sync")).toBeVisible();
  await expect(page.getByText(/All live watchlist tickers are available inside Corporate Analysis\./)).toBeVisible();

  await page.getByLabel("Comparison universe").selectOption("watchlist_plus_benchmark");
  await page.getByRole("button", { name: "Refresh comparison" }).click();
  await expect(page.locator("div").filter({ hasText: /^Watchlist \+ Benchmark$/ }).first()).toBeVisible();
  await expect(page.getByText("GOOGL")).toBeVisible();

  await page.getByLabel("Comparison universe").selectOption("custom");
  await expect(page.getByLabel("Custom tickers")).toBeVisible();
  await page.getByLabel("Custom tickers").fill("NVDA, TSLA");
  await page.getByRole("button", { name: "Refresh comparison" }).click();
  await expect(page.locator("div").filter({ hasText: /^Custom Universe$/ }).first()).toBeVisible();
  await expect(page.getByText(/Benchmark: \^GSPC\./)).toBeVisible();
  await expect(page.getByRole("cell", { name: "^GSPC" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "NVDA" }).first()).toBeVisible();

  await page.getByLabel("Sort by").selectOption("roic_minus_wacc");
  await page.getByLabel("Direction").selectOption("asc");
  await expect(page.getByText("Custom tickers: NVDA, TSLA.")).toBeVisible();
  await expect(page.getByText("Similar Stocks Spread View")).toBeVisible();
  await expect(page.getByText("Price Vs Fair Value Map")).toBeVisible();
  await expect(page.getByRole("button", { name: "Calculate All Reports" })).toBeVisible();
  await page.getByRole("button", { name: "Calculate All Reports" }).click();
  await expect(page.getByText("Batch DCF Reports")).toBeVisible();
  await expect(page.getByRole("cell", { name: "mockdcf-bulk-1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "NVDA" }).first()).toBeVisible();

  await expect(page.getByRole("columnheader", { name: "ROIC - WACC" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Spread" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Sector" })).toBeVisible();
});

test("corporate comparison sorting reorders non-benchmark rows and metric clicks open calculation detail modal", async ({ page }) => {
  await mockCorporatePageApi(page);
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Comparison universe").selectOption("watchlist_plus_benchmark");
  await page.getByRole("button", { name: "Refresh comparison" }).click();
  await expect(page.getByRole("cell", { name: "GOOGL" }).first()).toBeVisible();

  await page.getByLabel("Sort by").selectOption("roic_minus_wacc");
  await page.getByLabel("Direction").selectOption("asc");

  const ascAaplY = await tickerY(page, "AAPL");
  const ascGooglY = await tickerY(page, "GOOGL");
  const ascMsftY = await tickerY(page, "MSFT");
  expect(ascAaplY).toBeLessThan(ascGooglY);
  expect(ascGooglY).toBeLessThan(ascMsftY);

  await page.getByLabel("Direction").selectOption("desc");
  const descAaplY = await tickerY(page, "AAPL");
  const descGooglY = await tickerY(page, "GOOGL");
  const descMsftY = await tickerY(page, "MSFT");
  expect(descMsftY).toBeLessThan(descGooglY);
  expect(descGooglY).toBeLessThan(descAaplY);

  await page.getByRole("button", { name: "240.5" }).click();
  const calculationDialog = page.getByRole("dialog");
  await expect(calculationDialog).toBeVisible();
  await expect(calculationDialog.getByRole("heading", { name: /Apple Backend Fair Value/i })).toBeVisible();
  await expect(calculationDialog.getByText("Calculation Formula")).toBeVisible();
  await expect(calculationDialog.getByText("Result Summary: value, inputs used")).toBeVisible();
  await expect(calculationDialog.getByText("Calculation transparency and data lineage")).toBeVisible();
  await expect(calculationDialog.getByRole("button", { name: "Download CSV: Analysis" }).first()).toBeVisible();
});

test("calculation detail modal shows explicit source-data and full-report errors", async ({ page }) => {
  await mockCorporatePageApi(page, undefined, {
    failQuarterlyStatements: true,
    failOhlcv: true,
    failDcfFullReport: true,
  });
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Refresh source data" }).click();
  await page.getByRole("button", { name: /ROIC - WACC/i }).first().click();

  const calculationDialog = page.getByRole("dialog");
  await expect(calculationDialog).toBeVisible();
  await expect(calculationDialog.getByRole("heading", { name: "ROIC - WACC Audit" })).toBeVisible();
  await expect(calculationDialog.getByText("ROIC - WACC inherits the lower-confidence state").first()).toBeVisible();
  await calculationDialog.locator("summary").filter({ hasText: "Historical OHLCV Dataset" }).click();
  await calculationDialog.locator("summary").filter({ hasText: "Quarterly Financial Statements" }).click();
  await expect(calculationDialog.getByText("Historical OHLCV Unavailable")).toBeVisible();
  await expect(calculationDialog.locator("p").filter({ hasText: /^Quarterly Financial Statements Unavailable$/ })).toBeVisible();

  await calculationDialog.getByRole("button", { name: "Close modal" }).click();
  await page.getByRole("button", { name: "Refresh DCF" }).click();
  const viewFullReportButton = page.getByRole("button", { name: "View Full Report" });
  await expect(viewFullReportButton).toBeEnabled();
  await viewFullReportButton.click();

  const dcfDialog = page.getByRole("dialog");
  await expect(dcfDialog).toBeVisible();
  await dcfDialog.locator("summary").filter({ hasText: "Full DCF Report" }).click();
  await expect(dcfDialog.getByText("Full DCF Report Unavailable")).toBeVisible();
});
