import { expect, test, type Page } from "@playwright/test";
import { mockCorporatePageApi, type CorporatePageMockStats } from "./helpers/corporatePageMock";
import { mockPortfolioPageApi, type PortfolioPageMockStats } from "./helpers/portfolioPageMock";

const CORPORATE_DCF_CACHE_KEY = "moneyview:corporate-dcf-cache:v1";
const CORPORATE_COMPARISON_CACHE_KEY = "moneyview:corporate-comparison-cache:v1";
const CORPORATE_METRIC_HISTORY_CACHE_KEY = "moneyview:corporate-metric-history-cache:v1";
const CORPORATE_QUARTERLY_CACHE_KEY = "moneyview:corporate-quarterly-statements-cache:v1";
const CORPORATE_PRICE_HISTORY_CACHE_KEY = "moneyview:corporate-price-history-cache:v1";
const CORPORATE_ACTIVE_TICKER_KEY = "moneyview:corporate-active-ticker:v1";
const PORTFOLIO_COMPARISON_CACHE_KEY = "moneyview.portfolio.comparison-cache.v1";
const PORTFOLIO_COMPARISON_HISTORY_CACHE_KEY = "moneyview.portfolio.comparison-history-cache.v1";
const PORTFOLIO_ATTRIBUTION_CACHE_KEY = "moneyview.portfolio.attribution-cache.v1";

function corporateStats(): CorporatePageMockStats {
  return {
    dcfRequests: 0,
    dcfFullReportRequests: 0,
    dcfBulkReportRequests: 0,
    comparisonRequests: 0,
    metricSaveRequests: 0,
    metricHistoryRequests: 0,
    quarterlyRequests: 0,
    ohlcvRequests: 0,
  };
}

async function seedSessionStorage(page: Page, values: Record<string, unknown>) {
  await page.addInitScript((entries: Array<[string, unknown]>) => {
    window.sessionStorage.clear();
    for (const [key, value] of entries) {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    }
  }, Object.entries(values));
}

test("corporate first load keeps heavy calculation zones idle until refresh", async ({ page }) => {
  const stats = corporateStats();
  await mockCorporatePageApi(page, stats);

  await page.goto("/corporate", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("DCF stays idle on first load until you refresh it.")).toBeVisible();
  await expect(page.getByText("Source data stays idle on first load until refreshed.")).toBeVisible();
  await expect(page.getByText(/Comparison stays idle on first load\./)).toBeVisible();
  await page.waitForTimeout(300);
  expect(stats.dcfRequests).toBe(0);
  expect(stats.comparisonRequests).toBe(0);
  expect(stats.metricHistoryRequests).toBe(0);
  expect(stats.quarterlyRequests).toBe(0);
  expect(stats.ohlcvRequests).toBe(0);
});

test("corporate renders cached calculation results without auto-fetch and refreshes live data on demand", async ({ page }) => {
  const stats = corporateStats();
  await seedSessionStorage(page, {
    [CORPORATE_DCF_CACHE_KEY]: {
      snapshot: {
        ticker: "AAPL",
        growth: 6,
        roic: 18,
        wacc: 10,
        debtRatio: 18,
        unleveredBeta: 1.05,
        crp: 0.8,
        reinvestment: 34,
        fcff: 92,
        esgPenalty: 22,
      },
      result: {
        estimated_value: 199.9,
        current_price: 180.2,
        upside_pct: 10.93,
        wacc_used: 0.1,
        margin_used: 0.18,
        growth_used: 0.06,
        status: "Cached",
      },
      lastUpdatedAt: "2026-04-10T10:00:00Z",
    },
    [CORPORATE_COMPARISON_CACHE_KEY]: {
      snapshot: {
        comparisonUniverse: "watchlist_plus_benchmark",
        comparisonBenchmarkTicker: "^KS11",
        comparisonCustomTickersInput: "",
      },
      result: {
        market_expected_return: 8.8,
        risk_free_rate: 3.8,
        equity_risk_premium: 5.0,
        stock_expected_return_method: "dcf_implied_upside",
        comparison_reference_return_method: "capm_beta_reference",
        snapshot: {
          mode: "snapshot",
          as_of_date: "2026-04-10",
          generated_at: "2026-04-10T10:00:00Z",
          snapshot_version: "cached",
          snapshot_versions_for_day: 1,
          snapshot_available: true,
          snapshot_source: "cached",
          comparison_universe: "watchlist_plus_benchmark",
          benchmark_ticker: "^KS11",
          custom_tickers: [],
          snapshot_cadence: "daily_kst_0000",
          snapshot_retention_days: 365,
          snapshot_is_stale: false,
        },
        rows: [
          {
            ticker: "^KS11",
            name: "^KS11",
            sector: "Benchmark",
            group_name: "benchmark",
            weight: 0,
            roic: 10,
            wacc: 8,
            roic_minus_wacc: 2,
            dcf_value: 110,
            current_price: 100,
            dcf_implied_return: 10,
            capm_expected_return: 9.7,
            stock_expected_return: 10,
            market_expected_return: 9.7,
            expected_return_spread: 0.3,
            stock_expected_return_source: "dcf_implied_upside",
            has_price_data: true,
          },
          {
            ticker: "AAPL",
            name: "Apple",
            sector: "Technology",
            group_name: "core",
            weight: 0.35,
            roic: 17,
            wacc: 10,
            roic_minus_wacc: 7,
            dcf_value: 199.9,
            current_price: 180.2,
            dcf_implied_return: 10.93,
            capm_expected_return: 9.9,
            stock_expected_return: 10.93,
            market_expected_return: 8.8,
            expected_return_spread: 2.13,
            stock_expected_return_source: "dcf_implied_upside",
            has_price_data: true,
          },
        ],
      },
      lastUpdatedAt: "2026-04-10T10:00:00Z",
    },
    [CORPORATE_METRIC_HISTORY_CACHE_KEY]: {
      snapshot: "AAPL",
      result: {
        ticker: "AAPL",
        start_year: 2021,
        country_risk_premium: 0.8,
        growth_cagr: 5.5,
        growth_recent_average: 5.2,
        annual_growth_rates: [{ year: 2025, value: 5.3 }],
        roic_recent_average: 17.8,
        roic_all_year_average: 17.1,
        annual_roic: [{ year: 2025, value: 17.5 }],
      },
      lastUpdatedAt: "2026-04-10T10:00:00Z",
    },
    [CORPORATE_QUARTERLY_CACHE_KEY]: {
      snapshot: "AAPL",
      result: {
        ticker: "AAPL",
        source: "Cached quarterly statements",
        rows: [],
      },
      lastUpdatedAt: "2026-04-10T10:00:00Z",
    },
    [CORPORATE_PRICE_HISTORY_CACHE_KEY]: {
      snapshot: "AAPL",
      result: [
        { date: "2026-04-08", open: 180, high: 182, low: 179, close: 181, volume: 1000000 },
        { date: "2026-04-09", open: 181, high: 183, low: 180, close: 182, volume: 1100000 },
      ],
      lastUpdatedAt: "2026-04-10T10:00:00Z",
    },
  });
  await mockCorporatePageApi(page, stats);

  await page.goto("/corporate", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: /Backend DCF/i })).toContainText("$199.9");
  await expect(page.getByText("Last updated")).toHaveCount(3);
  await expect(page.getByRole("cell", { name: "AAPL" }).first()).toBeVisible();
  await page.waitForTimeout(300);
  expect(stats.dcfRequests).toBe(0);
  expect(stats.comparisonRequests).toBe(0);
  expect(stats.metricHistoryRequests).toBe(0);
  expect(stats.quarterlyRequests).toBe(0);
  expect(stats.ohlcvRequests).toBe(0);

  await page.getByRole("button", { name: "Refresh DCF" }).click();
  await expect.poll(() => stats.dcfRequests).toBe(1);
  await expect(page.getByRole("button", { name: /Backend DCF/i })).toContainText("$240.5");

  await page.getByRole("button", { name: "Refresh source data" }).click();
  await expect.poll(() => stats.metricHistoryRequests).toBe(1);
  await expect.poll(() => stats.quarterlyRequests).toBe(1);
  await expect.poll(() => stats.ohlcvRequests).toBe(1);

  await page.getByRole("button", { name: "Refresh comparison" }).click();
  await expect.poll(() => stats.comparisonRequests).toBe(1);
  await expect(page.getByRole("cell", { name: "GOOGL" }).first()).toBeVisible();
});

test("corporate page refresh restores the selected ticker without auto-fetching heavy zones", async ({ page }) => {
  const stats = corporateStats();
  await mockCorporatePageApi(page, stats);

  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });

  await page.getByLabel("Company Search").fill("Microsoft");
  await page.getByRole("button", { name: "Microsoft" }).click();
  await expect(page.getByText(/Microsoft: life cycle/i)).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Microsoft: life cycle/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Backend DCF/i })).toContainText("Refresh to calculate");
  await page.waitForTimeout(300);
  expect(stats.dcfRequests).toBe(0);
  expect(stats.comparisonRequests).toBe(0);
  expect(stats.metricHistoryRequests).toBe(0);
  expect(stats.quarterlyRequests).toBe(0);
  expect(stats.ohlcvRequests).toBe(0);
});

test("corporate page refresh labels stale source-data cache for a different selected ticker", async ({ page }) => {
  const stats = corporateStats();
  await seedSessionStorage(page, {
    [CORPORATE_ACTIVE_TICKER_KEY]: "MSFT",
    [CORPORATE_DCF_CACHE_KEY]: {
      snapshot: {
        ticker: "AAPL",
        growth: 6,
        roic: 18,
        wacc: 10,
        debtRatio: 18,
        unleveredBeta: 1.05,
        crp: 0.8,
        reinvestment: 34,
        fcff: 92,
        esgPenalty: 22,
      },
      result: {
        estimated_value: 199.9,
        current_price: 180.2,
        upside_pct: 10.93,
        wacc_used: 0.1,
        margin_used: 0.18,
        growth_used: 0.06,
        status: "Cached",
      },
      lastUpdatedAt: "2026-04-10T10:00:00Z",
    },
    [CORPORATE_METRIC_HISTORY_CACHE_KEY]: {
      snapshot: "AAPL",
      result: {
        ticker: "AAPL",
        start_year: 2021,
        country_risk_premium: 0.8,
        growth_cagr: 5.5,
        growth_recent_average: 5.2,
        annual_growth_rates: [{ year: 2025, value: 5.3 }],
        roic_recent_average: 17.8,
        roic_all_year_average: 17.1,
        annual_roic: [{ year: 2025, value: 17.5 }],
      },
      lastUpdatedAt: "2026-04-10T10:00:00Z",
    },
    [CORPORATE_QUARTERLY_CACHE_KEY]: {
      snapshot: "AAPL",
      result: {
        ticker: "AAPL",
        source: "Cached quarterly statements",
        rows: [],
      },
      lastUpdatedAt: "2026-04-10T10:00:00Z",
    },
    [CORPORATE_PRICE_HISTORY_CACHE_KEY]: {
      snapshot: "AAPL",
      result: [
        { date: "2026-04-08", open: 180, high: 182, low: 179, close: 181, volume: 1000000 },
      ],
      lastUpdatedAt: "2026-04-10T10:00:00Z",
    },
  });
  await mockCorporatePageApi(page, stats);

  await page.goto("/corporate", { waitUntil: "domcontentloaded" });

  await expect(page.getByText(/Microsoft: life cycle/i)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: /Backend DCF/i })).toContainText("Refresh to calculate");
  await expect(page.getByRole("button", { name: /Backend DCF/i })).not.toContainText("$199.9");
  await expect(page.getByText("Cached source data is for AAPL. Refresh for MSFT.")).toBeVisible();
  await expect(page.getByText("Growth Rate now stays on the stable CAGR path. Annual growth rates remain available in View Details for context.")).toBeVisible();
  await page.waitForTimeout(300);
  expect(stats.dcfRequests).toBe(0);
  expect(stats.metricHistoryRequests).toBe(0);
  expect(stats.quarterlyRequests).toBe(0);
  expect(stats.ohlcvRequests).toBe(0);
});

test("portfolio first load auto-loads the latest comparison snapshot while history and attribution stay idle until refresh", async ({ page }) => {
  const stats: PortfolioPageMockStats = {
    comparisonRequests: 0,
    comparisonHistoryRequests: 0,
    attributionRequests: 0,
    stockDetailRequests: 0,
    stockSnapshotHistoryRequests: 0,
  };
  await mockPortfolioPageApi(page, stats);

  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Saved snapshot history stays idle until you refresh portfolio analysis.")).toBeVisible();
  await expect(page.getByText("Attribution stays idle on first load. Click Refresh Analysis when you want current portfolio attribution.")).toBeVisible();
  await expect(page.getByText("Latest Snapshot Summary")).toBeVisible();
  await expect(page.getByText(/Market expected return: 9\.70%/)).toBeVisible();
  await page.waitForTimeout(300);
  expect(stats.comparisonRequests).toBe(1);
  expect(stats.comparisonHistoryRequests).toBe(0);
  expect(stats.attributionRequests).toBe(0);
});

test("portfolio renders cached analysis without auto-fetch, refreshes on demand, and keeps detail fetches modal-gated", async ({ page }) => {
  const stats: PortfolioPageMockStats = {
    comparisonRequests: 0,
    comparisonHistoryRequests: 0,
    attributionRequests: 0,
    stockDetailRequests: 0,
    stockSnapshotHistoryRequests: 0,
  };
  await seedSessionStorage(page, {
    [PORTFOLIO_COMPARISON_CACHE_KEY]: {
      snapshot: {
        mode: "snapshot",
        comparisonUniverse: "portfolio_plus_benchmark",
        benchmarkTicker: "^GSPC",
        customTickersInput: "",
        holdingsSignature: "AAPL:0.200000|MSFT:0.200000|NVDA:0.200000|GOOGL:0.200000|AMZN:0.200000",
      },
      result: {
        market_expected_return: 9.7,
        risk_free_rate: 4.2,
        equity_risk_premium: 5.5,
        stock_expected_return_method: "dcf_implied_upside",
        comparison_reference_return_method: "capm_beta_reference",
        snapshot: {
          mode: "snapshot",
          as_of_date: "2026-04-10",
          generated_at: "2026-04-10T09:00:00Z",
          snapshot_version: "cached-portfolio",
          snapshot_versions_for_day: 1,
          snapshot_available: true,
          snapshot_source: "cached",
          comparison_universe: "portfolio_plus_benchmark",
          benchmark_ticker: "^GSPC",
          custom_tickers: [],
          snapshot_cadence: "daily_kst_0000",
          snapshot_retention_days: 365,
          snapshot_is_stale: false,
        },
        rows: [
          {
            ticker: "^GSPC",
            name: "S&P 500",
            sector: "Benchmark",
            group_name: "benchmark",
            weight: 0,
            roic_minus_wacc: 2,
            dcf_value: 108,
            current_price: 100,
            dcf_implied_return: 8.5,
            capm_expected_return: 9.7,
            expected_return_spread: -1.2,
          },
          {
            ticker: "AAPL",
            name: "Apple",
            sector: "Technology",
            group_name: "core",
            weight: 0.35,
            roic_minus_wacc: 7.1,
            dcf_value: 232.1,
            current_price: 205.1,
            dcf_implied_return: 13.2,
            capm_expected_return: 11.0,
            expected_return_spread: 3.5,
          },
        ],
      },
      lastUpdatedAt: "2026-04-10T09:00:00Z",
    },
    [PORTFOLIO_COMPARISON_HISTORY_CACHE_KEY]: {
      snapshot: {
        comparisonUniverse: "portfolio_plus_benchmark",
        benchmarkTicker: "^GSPC",
        customTickersInput: "",
        holdingsSignature: "AAPL:0.200000|MSFT:0.200000|NVDA:0.200000|GOOGL:0.200000|AMZN:0.200000",
      },
      result: {
        comparison_universe: "portfolio_plus_benchmark",
        benchmark_ticker: "^GSPC",
        custom_tickers: [],
        points: [
          {
            as_of_date: "2026-04-10",
            generated_at: "2026-04-10T09:00:00Z",
            snapshot_version: "cached-portfolio",
            snapshot_versions_for_day: 1,
            snapshot_source: "cached",
            comparison_universe: "portfolio_plus_benchmark",
            benchmark_ticker: "^GSPC",
            stock_count: 2,
            average_expected_return_spread: 2.4,
            average_roic_minus_wacc: 6.0,
            average_dcf_value: 220.5,
            market_expected_return: 9.7,
          },
        ],
      },
      lastUpdatedAt: "2026-04-10T09:00:00Z",
    },
    [PORTFOLIO_ATTRIBUTION_CACHE_KEY]: {
      snapshot: {
        tickers: ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN"],
        weights: [0.2, 0.2, 0.2, 0.2, 0.2],
        benchmarkTicker: "^GSPC",
        holdingStartDate: "",
        attributionAsOfDate: "",
      },
      result: {
        totals: {
          portfolio_return: 0.08,
          benchmark_return: 0.07,
        },
        active_return: 0.01,
        effects: {
          allocation: 0.004,
          selection: 0.0035,
          interaction: 0.0025,
        },
        sector_breakdowns: [
          {
            sector: "Technology",
            portfolio_weight: 1,
            benchmark_weight: 1,
            portfolio_return: 0.08,
            benchmark_return: 0.07,
            allocation_effect: 0.004,
            selection_effect: 0.0035,
            interaction_effect: 0.0025,
            active_contribution: 0.01,
          },
        ],
        risk_metrics: {
          beta: 1.1,
          beta_rolling_window: 252,
          var_95_1d: -0.021,
          es_95_1d: -0.032,
          var_method: "historical",
          es_method: "historical",
        },
        metadata: {
          method: "brinson_fachler_arithmetic",
          benchmark: "^GSPC",
          benchmark_weights_source: "provider_derived",
          period: "5y",
          generated_at: "2026-04-10T09:00:00Z",
          portfolio_hash: "cached",
          cache_key: "cached",
          cache_hit: true,
          data_contract: {
            return_frequency: "daily",
            rebalancing_assumption: "bop",
            timezone_cutoff: "16:00:00",
            timezone: "UTC",
            currency: "USD",
            fx_handling: "none_usd_only",
            corporate_actions: "split_and_dividend_adjusted_total_return",
            benchmark_source: "cached",
            sector_taxonomy: "watchlist_sector_gics_like",
            missing_data_fallback: "cached",
          },
          data_quality: {
            synthetic_data_used: false,
            synthetic_tickers: [],
            benchmark_proxy_used: false,
            benchmark_proxy_method: null,
            limitations: [],
          },
        },
      },
      lastUpdatedAt: "2026-04-10T09:00:00Z",
    },
  });
  await mockPortfolioPageApi(page, stats);

  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Last updated")).toBeVisible();
  await expect(page.getByText("Latest Snapshot Summary")).toBeVisible();
  await expect(page.getByText("Positive Spread")).toBeVisible();
  await expect(page.getByText("8.0%")).toBeVisible();
  await page.waitForTimeout(300);
  expect(stats.comparisonRequests).toBe(1);
  expect(stats.comparisonHistoryRequests).toBe(0);
  expect(stats.attributionRequests).toBe(0);
  expect(stats.stockDetailRequests).toBe(0);
  expect(stats.stockSnapshotHistoryRequests).toBe(0);

  await page.getByRole("button", { name: "Refresh Analysis" }).click();
  await expect.poll(() => stats.comparisonRequests).toBe(2);
  await expect.poll(() => stats.comparisonHistoryRequests).toBe(1);
  await expect.poll(() => stats.attributionRequests).toBe(1);
  await expect(page.getByText(/Refreshing portfolio comparison, snapshot history, and attribution\./)).toBeVisible();

  await page.getByLabel("Add to Watchlist only").check();
  await page.getByLabel("Ticker", { exact: true }).fill("ORCL");
  await page.getByLabel("Name", { exact: true }).fill("Oracle");
  await page.getByLabel("Sector", { exact: true }).fill("Software");
  await page.getByRole("button", { name: "Save Manual Ticker" }).click();
  await expect(page.getByText("Saved ORCL as a tracked holding with 0.0% portfolio allocation.")).toBeVisible();
  await page.waitForTimeout(300);
  expect(stats.attributionRequests).toBe(1);

  expect(stats.stockDetailRequests).toBe(0);
  expect(stats.stockSnapshotHistoryRequests).toBe(0);

  await page.locator('[role="button"]').filter({ hasText: "Apple" }).first().click();
  const stockDetailDialog = page.getByRole("dialog");
  await expect(stockDetailDialog).toBeVisible();
  await expect.poll(() => stats.stockDetailRequests).toBe(1);
  await expect.poll(() => stats.stockSnapshotHistoryRequests).toBeGreaterThan(0);
  await expect(stockDetailDialog.getByRole("heading", { name: "Stock History Timeline" })).toBeVisible();
});
