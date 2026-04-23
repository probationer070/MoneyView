import { expect, test } from "@playwright/test";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";

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
