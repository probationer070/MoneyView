import { expect, test } from "@playwright/test";
import { mockMarketPageApi } from "./helpers/marketPageMock";

test("market overview renders deterministically from shared dashboard fixtures", async ({ page }) => {
  await mockMarketPageApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Market Overview", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Real-time snapshot of major global and domestic indices")).toBeVisible();
  await expect(page.getByText("S&P 500")).toBeVisible();
  await expect(page.getByText("^GSPC")).toBeVisible();
  await expect(page.getByText("Nasdaq")).toBeVisible();
  await expect(page.getByText("^IXIC")).toBeVisible();
});

test("market overview opens and closes detail from both card and table views", async ({ page }) => {
  await mockMarketPageApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Open detail for S&P 500" }).click();
  await expect(page.getByRole("dialog", { name: "S&P 500" })).toBeVisible();
  await expect(page.getByText("Market Detail")).toBeVisible();
  await expect(page.getByText("3/4 advancers")).toBeVisible();
  await expect(page.getByText("5 risk-on / 0 risk-off")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daily Volume" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daily Indicators" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Monthly Indicators" })).toBeVisible();
  await expect(page.getByText("1,340,000,000")).toBeVisible();
  await expect(page.getByText("fresh_cache").first()).toBeVisible();
  await expect(page.getByText("2026-04-16T07:30:00Z")).toBeVisible();
  await page.getByRole("button", { name: "Close modal" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Table" }).click();
  await page.getByRole("button", { name: "Open detail for Nasdaq from table" }).click();
  await expect(page.getByRole("dialog", { name: "Nasdaq" })).toBeVisible();
  await expect(page.getByText("live_refresh").first()).toBeVisible();
  await expect(page.getByText("Daily first, monthly second: use daily indicators for tactical inspection and monthly indicators for regime-level confirmation.")).toBeVisible();
});

test("market overview detail uses instrument-aware copy for commodity, fx, and crypto", async ({ page }) => {
  await mockMarketPageApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Open detail for Gold" }).click();
  await expect(page.getByRole("dialog", { name: "Gold" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Commodity Context" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daily Commodity Signals" })).toBeVisible();
  await expect(page.getByText("Trend Spread").first()).toBeVisible();
  await expect(page.getByText("Upper Range Band").first()).toBeVisible();
  await expect(page.getByText("Unit framing: USD per ounce matter more than stock-style benchmark framing.")).toBeVisible();
  await page.getByRole("button", { name: "Close modal" }).click();

  await page.getByRole("button", { name: "Open detail for USD/KRW" }).click();
  await expect(page.getByRole("dialog", { name: "USD/KRW" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "FX Context" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daily FX Signals" })).toBeVisible();
  await expect(page.getByText("Pair Momentum").first()).toBeVisible();
  await expect(page.getByText("20D Pair Average").first()).toBeVisible();
  await expect(page.getByText("USD/KRW reads as quote-currency value per base-currency unit.")).toBeVisible();
  await page.getByRole("button", { name: "Close modal" }).click();

  await page.getByRole("button", { name: "Open detail for Bitcoin" }).click();
  await expect(page.getByRole("dialog", { name: "Bitcoin" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Crypto Context" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daily Crypto Signals" })).toBeVisible();
  await expect(page.getByText("Momentum Spread").first()).toBeVisible();
  await expect(page.getByText("Upper Volatility Band").first()).toBeVisible();
  await expect(page.getByText("Unit framing: USD per BTC can move with outsized volatility relative to traditional macro assets.")).toBeVisible();
});

test("market overview detail stays usable on mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockMarketPageApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Open detail for S&P 500" }).click();
  await expect(page.getByRole("dialog", { name: "S&P 500" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Monthly" })).toBeVisible();
  await page.getByRole("button", { name: "Monthly" }).click();
  await expect(page.getByRole("heading", { name: "Monthly Indicators" })).toBeVisible();
  await expect(page.getByText("Monthly bars")).toBeVisible();

  await page.getByRole("button", { name: "Close modal" }).click();
  await page.getByRole("button", { name: "Open detail for Bitcoin" }).click();
  await expect(page.getByRole("heading", { name: "Monthly Crypto Signals" })).toBeVisible();
});

test("market overview detail shows explicit warnings for stale and partial data", async ({ page }) => {
  await mockMarketPageApi(page, {
    detailOverrides: {
      "KRW=X": {
        monthly_history: [],
        monthly_indicators: {
          ticker: "KRW=X",
          rsi_14: null,
          macd: null,
          macd_signal: null,
          macd_hist: null,
          bb_upper: null,
          bb_mid: null,
          bb_lower: null,
          ma_20: null,
          ma_50: null,
          ma_200: null,
          as_of_date: null,
        },
        data_quality: {
          source: "cache_fallback",
          freshness_status: "stale_cache",
          used_live_refresh: false,
          used_stale_cache_fallback: true,
          requested_period: "5y",
          last_updated: "2026-04-16T07:40:00Z",
          latest_trading_date: "2026-04-08",
          detail_note: "Live refresh was unavailable, so this detail payload fell back to the latest cached history.",
        },
      },
    },
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Open detail for USD/KRW" }).click();
  await expect(page.getByRole("heading", { name: "Detail Warnings" })).toBeVisible();
  await expect(page.getByText("This market detail is using stale cached history because a live refresh was unavailable.")).toBeVisible();
  await expect(page.getByText("Monthly history is not available for this instrument yet, so the monthly chart and indicators are incomplete.")).toBeVisible();
  await expect(page.getByText("Daily volume is not provided for this FX pair, so volume metrics are intentionally shown as unavailable.")).toBeVisible();
});

test("market overview detail shows an explicit modal error state when the detail request fails", async ({ page }) => {
  await mockMarketPageApi(page, { failDetailTickers: ["^GSPC"] });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Open detail for S&P 500" }).click();
  await expect(page.getByRole("dialog", { name: "S&P 500" })).toBeVisible();
  await expect(page.getByText("Market Detail Unavailable")).toBeVisible();
});
