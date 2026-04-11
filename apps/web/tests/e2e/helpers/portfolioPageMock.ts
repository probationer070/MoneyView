import type { Page } from "@playwright/test";
import {
  benchmarkUniverseFixture,
  marketOverviewFixture,
  portfolioPartialWeightsFixture,
  snapshotHistoryFixture,
  type PortfolioStockFixture,
} from "../fixtures/shared";
import { API_PREFIX, cloneFixture, json, nowIso } from "./mockUtils";

type PortfolioStock = PortfolioStockFixture;

function buildAttribution(weights: number[], tickers: string[]) {
  const normalizedWeights = tickers.map((_, index) => weights[index] ?? 0);
  const portfolioReturn = normalizedWeights.reduce((sum, weight, index) => sum + weight * (0.08 + index * 0.02), 0);
  const benchmarkReturn = 0.07;
  const activeReturn = portfolioReturn - benchmarkReturn;
  return {
    totals: {
      portfolio_return: portfolioReturn,
      benchmark_return: benchmarkReturn,
    },
    active_return: activeReturn,
    effects: {
      allocation: activeReturn * 0.4,
      selection: activeReturn * 0.35,
      interaction: activeReturn * 0.25,
    },
    sector_breakdowns: [
      {
        sector: "Technology",
        portfolio_weight: 1.0,
        benchmark_weight: 1.0,
        portfolio_return: portfolioReturn,
        benchmark_return: benchmarkReturn,
        allocation_effect: activeReturn * 0.4,
        selection_effect: activeReturn * 0.35,
        interaction_effect: activeReturn * 0.25,
        active_contribution: activeReturn,
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
      generated_at: nowIso(),
      portfolio_hash: "e2e-portfolio",
      cache_key: "e2e-cache",
      cache_hit: false,
      data_contract: {
        return_frequency: "daily",
        rebalancing_assumption: "bop",
        timezone_cutoff: "16:00:00",
        timezone: "UTC",
        currency: "USD",
        fx_handling: "none_usd_only",
        corporate_actions: "split_and_dividend_adjusted_total_return",
        benchmark_source: "e2e-mock",
        sector_taxonomy: "watchlist_sector_gics_like",
        missing_data_fallback: "mock",
      },
      data_quality: {
        synthetic_data_used: false,
        synthetic_tickers: [],
        benchmark_proxy_used: false,
        benchmark_proxy_method: null,
        limitations: [],
      },
    },
  };
}

export async function mockPortfolioPageApi(page: Page) {
  let watchlist: PortfolioStock[] = cloneFixture(portfolioPartialWeightsFixture);

  let syncStatus = {
    source: "",
    last_updated_at: "",
    json_path: "C:\\Learn\\Economy\\MoneyView\\apps\\api\\services\\webscrap\\stock_targets.json",
  };
  let portfolioComparisonSnapshot = {
    mode: "snapshot",
    as_of_date: "2026-04-11",
    generated_at: nowIso(),
    snapshot_version: "2026-04-11|portfolio_plus_benchmark|^GSPC||2026-04-11T12:00:00Z",
    snapshot_versions_for_day: 1,
    snapshot_available: true,
    snapshot_source: "scheduled_kst_daily",
    comparison_universe: "portfolio_plus_benchmark",
    benchmark_ticker: "^GSPC",
    custom_tickers: [] as string[],
    snapshot_cadence: "daily_kst_0000",
    snapshot_retention_days: 365,
    snapshot_is_stale: false,
  };

  const comparisonRowsByUniverse = (comparisonUniverse: string, benchmarkTicker: string, customTickers: string[]) => {
    if (comparisonUniverse === "custom") {
      return [
        {
          ticker: benchmarkTicker,
          name: benchmarkTicker,
          sector: "Benchmark",
          group_name: "benchmark",
          weight: 0,
          roic_minus_wacc: 2,
          dcf_value: 110,
          current_price: 100,
          dcf_implied_return: 10,
          capm_expected_return: 9.7,
          stock_expected_return: 10,
          market_expected_return: 9.7,
          expected_return_spread: 0.3,
        },
        ...customTickers.map((ticker, index) => ({
          ticker,
          name: ticker,
          sector: "Custom",
          group_name: "custom",
          weight: 0,
          roic_minus_wacc: 8 + index,
          dcf_value: 240.5 + index * 20,
          current_price: 210.4 + index * 10,
          dcf_implied_return: 14.31 - index,
          capm_expected_return: 11.26 - index * 0.4,
          stock_expected_return: 14.31 - index,
          market_expected_return: 9.7,
          expected_return_spread: 4.61 - index,
        })),
      ];
    }

    return cloneFixture(benchmarkUniverseFixture.rows);
  };

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    const method = route.request().method();

    if (pathname === `${API_PREFIX}/health`) {
      return json(route, { status: "ok", version: "1.0.0" });
    }

    if (pathname === `${API_PREFIX}/market/indices` && method === "GET") {
      return json(route, cloneFixture(marketOverviewFixture));
    }

    if (pathname === `${API_PREFIX}/portfolio/watchlist` && method === "GET") {
      return json(route, watchlist);
    }

    if (pathname === `${API_PREFIX}/portfolio/watchlist/sync-status` && method === "GET") {
      return json(route, { status: "ok", data: syncStatus });
    }

    if (pathname === `${API_PREFIX}/portfolio/attribution` && method === "POST") {
      const payload = JSON.parse(route.request().postData() ?? "{}");
      return json(route, { status: "ok", data: buildAttribution(payload.weights ?? [], payload.tickers ?? []) });
    }

    if (pathname === `${API_PREFIX}/corporate/comparison` && method === "GET") {
      const mode = (url.searchParams.get("mode") ?? "snapshot") as "snapshot" | "live";
      const comparisonUniverse = url.searchParams.get("comparison_universe") ?? "portfolio_plus_benchmark";
      const benchmarkTicker = (url.searchParams.get("benchmark_ticker") ?? "^GSPC").toUpperCase();
      const customTickers = (url.searchParams.get("custom_tickers") ?? "")
        .split(",")
        .map((ticker) => ticker.trim().toUpperCase())
        .filter(Boolean);
      return json(route, {
        status: "ok",
        data: {
          market_expected_return: benchmarkUniverseFixture.market_expected_return,
          risk_free_rate: benchmarkUniverseFixture.risk_free_rate,
          equity_risk_premium: benchmarkUniverseFixture.equity_risk_premium,
          stock_expected_return_method: benchmarkUniverseFixture.stock_expected_return_method,
          comparison_reference_return_method: benchmarkUniverseFixture.comparison_reference_return_method,
          snapshot: {
            ...cloneFixture(portfolioComparisonSnapshot),
            mode,
            comparison_universe: comparisonUniverse,
            benchmark_ticker: benchmarkTicker,
            custom_tickers: customTickers,
          },
          rows: comparisonRowsByUniverse(comparisonUniverse, benchmarkTicker, customTickers),
        },
      });
    }

    if (pathname === `${API_PREFIX}/corporate/comparison/snapshot` && method === "POST") {
      const comparisonUniverse = url.searchParams.get("comparison_universe") ?? "portfolio_plus_benchmark";
      const benchmarkTicker = (url.searchParams.get("benchmark_ticker") ?? "^GSPC").toUpperCase();
      const customTickers = (url.searchParams.get("custom_tickers") ?? "")
        .split(",")
        .map((ticker) => ticker.trim().toUpperCase())
        .filter(Boolean);
      portfolioComparisonSnapshot = {
        ...portfolioComparisonSnapshot,
        mode: "snapshot",
        snapshot_source: "manual_refresh",
        generated_at: nowIso(),
        snapshot_version: "2026-04-11|portfolio_plus_benchmark|^GSPC||2026-04-11T12:30:00Z",
        snapshot_versions_for_day: 2,
        comparison_universe: comparisonUniverse,
        benchmark_ticker: benchmarkTicker,
        custom_tickers: customTickers,
      };
      return json(route, {
        status: "ok",
        data: {
          market_expected_return: benchmarkUniverseFixture.market_expected_return,
          risk_free_rate: benchmarkUniverseFixture.risk_free_rate,
          equity_risk_premium: benchmarkUniverseFixture.equity_risk_premium,
          stock_expected_return_method: benchmarkUniverseFixture.stock_expected_return_method,
          comparison_reference_return_method: benchmarkUniverseFixture.comparison_reference_return_method,
          snapshot: cloneFixture(portfolioComparisonSnapshot),
          rows: comparisonRowsByUniverse(comparisonUniverse, benchmarkTicker, customTickers),
        },
      });
    }

    if (pathname === `${API_PREFIX}/corporate/comparison/history` && method === "GET") {
      const comparisonUniverse = url.searchParams.get("comparison_universe") ?? "portfolio_plus_benchmark";
      const benchmarkTicker = (url.searchParams.get("benchmark_ticker") ?? "^GSPC").toUpperCase();
      const customTickers = (url.searchParams.get("custom_tickers") ?? "")
        .split(",")
        .map((ticker) => ticker.trim().toUpperCase())
        .filter(Boolean);
      return json(route, {
        status: "ok",
        data: {
          ...cloneFixture(snapshotHistoryFixture),
          comparison_universe: comparisonUniverse,
          benchmark_ticker: benchmarkTicker,
          custom_tickers: customTickers,
        },
      });
    }

    if (pathname === `${API_PREFIX}/portfolio/watchlist` && method === "POST") {
      const payload = JSON.parse(route.request().postData() ?? "{}");
      const nextRow: PortfolioStock = {
        ticker: payload.ticker,
        name: payload.name,
        sector: payload.sector,
        group_name: payload.group_name,
        weight: payload.weight,
        last_close: watchlist.find((item) => item.ticker === payload.ticker)?.last_close ?? 100,
        delta: { delta_pct: 1.1 },
        sparkline: watchlist.find((item) => item.ticker === payload.ticker)?.sparkline ?? [95, 97, 99, 100],
      };
      watchlist = [...watchlist.filter((item) => item.ticker !== payload.ticker), nextRow];
      return json(route, payload);
    }

    if (pathname.startsWith(`${API_PREFIX}/portfolio/watchlist/`) && method === "DELETE") {
      const ticker = pathname.split("/").at(-1) ?? "";
      watchlist = watchlist.filter((item) => item.ticker !== ticker);
      return json(route, { status: "ok", ticker });
    }

    if (pathname === `${API_PREFIX}/portfolio/watchlist/sync` && method === "POST") {
      syncStatus = {
        ...syncStatus,
        source: "watchlist_db_sync",
        last_updated_at: nowIso(),
      };
      return json(route, {
        status: "ok",
        data: {
          item_count: watchlist.length,
          source: "watchlist_db_sync",
          json_path: syncStatus.json_path,
          preserved_weights: true,
        },
      });
    }

    if (pathname === `${API_PREFIX}/portfolio/watchlist/resync` && method === "POST") {
      watchlist = [
        {
          ticker: "NVDA",
          name: "NVIDIA",
          sector: "Semiconductors",
          group_name: "growth",
          weight: 1.0,
          last_close: 119.2,
          delta: { delta_pct: 2.4 },
          sparkline: [111, 113, 116, 118, 119.2],
        },
      ];
      syncStatus = {
        ...syncStatus,
        source: "manual_json_resync",
        last_updated_at: nowIso(),
      };
      return json(route, {
        status: "ok",
        data: {
          item_count: watchlist.length,
          source: "manual_json_resync",
        },
      });
    }

    if (pathname.startsWith(`${API_PREFIX}/portfolio/stock/`) && method === "GET") {
      const ticker = pathname.split("/").at(-1) ?? "AAPL";
      return json(route, {
        ticker,
        prices: [
          { date: "2026-04-07", open: 200, high: 205, low: 198, close: 203, volume: 1000000 },
          { date: "2026-04-08", open: 203, high: 207, low: 202, close: 206, volume: 1200000 },
          { date: "2026-04-09", open: 206, high: 210, low: 205, close: 209, volume: 1400000 },
        ],
        news: [
          {
            id: 1,
            ticker,
            headline: `${ticker} headline`,
            url: "https://example.com/article",
            source: "Mock News",
            published_date: "2026-04-10",
            sentiment: "positive",
            importance: 1,
          },
        ],
      });
    }

    if (pathname === `${API_PREFIX}/news/feed` && method === "GET") {
      const ticker = url.searchParams.get("ticker") ?? "AAPL";
      return json(route, Array.from({ length: 5 }, (_, index) => ({
        id: index + 1,
        ticker,
        headline: `${ticker} news ${index + 1}`,
        url: `https://example.com/${ticker}/${index + 1}`,
        source: "Mock News",
        published_date: "2026-04-10",
        sentiment: "neutral",
        importance: 1,
      })));
    }

    if (pathname === `${API_PREFIX}/news/crawl/stock` && method === "POST") {
      return json(route, []);
    }

    return route.continue();
  });
}
