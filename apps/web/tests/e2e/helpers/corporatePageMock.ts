import type { Page } from "@playwright/test";
import { API_PREFIX, json, nowIso } from "./mockUtils";

export async function mockCorporatePageApi(page: Page) {
  let comparisonSnapshot = {
    mode: "snapshot",
    as_of_date: "2026-04-11",
    generated_at: "2026-04-11T12:00:00Z",
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
        ...customTickers.map((ticker, index) => ({
          ticker,
          name: ticker,
          sector: "Custom",
          group_name: "custom",
          weight: 0,
          roic: 18 + index,
          wacc: 10,
          roic_minus_wacc: 8 + index,
          dcf_value: 240.5 + index * 20,
          current_price: 210.4 + index * 10,
          dcf_implied_return: 14.31 - index,
          capm_expected_return: 11.26 - index * 0.4,
          stock_expected_return: 14.31 - index,
          market_expected_return: 9.7,
          expected_return_spread: 4.61 - index,
          stock_expected_return_source: "dcf_implied_upside",
          has_price_data: true,
        })),
      ];
    }

    const baseRows = [
      {
        ticker: benchmarkTicker,
        name: benchmarkTicker,
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
        roic: 18,
        wacc: 10,
        roic_minus_wacc: 8,
        dcf_value: 240.5,
        current_price: 210.4,
        dcf_implied_return: 14.31,
        capm_expected_return: 11.26,
        stock_expected_return: 14.31,
        market_expected_return: 9.7,
        expected_return_spread: 4.61,
        stock_expected_return_source: "dcf_implied_upside",
        has_price_data: true,
      },
      {
        ticker: "MSFT",
        name: "Microsoft",
        sector: "Technology",
        group_name: "core",
        weight: 0.25,
        roic: 22,
        wacc: 9,
        roic_minus_wacc: 13,
        dcf_value: 460.2,
        current_price: 415.3,
        dcf_implied_return: 10.81,
        capm_expected_return: 10.39,
        stock_expected_return: 10.81,
        market_expected_return: 9.7,
        expected_return_spread: 1.11,
        stock_expected_return_source: "dcf_implied_upside",
        has_price_data: true,
      },
    ];

    if (comparisonUniverse === "watchlist_plus_benchmark") {
      return [
        ...baseRows,
        {
          ticker: "GOOGL",
          name: "Alphabet",
          sector: "Communication Services",
          group_name: "watch",
          weight: 0,
          roic: 20,
          wacc: 9.5,
          roic_minus_wacc: 10.5,
          dcf_value: 180.2,
          current_price: 170.1,
          dcf_implied_return: 5.94,
          capm_expected_return: 10.76,
          stock_expected_return: 5.94,
          market_expected_return: 9.7,
          expected_return_spread: -3.76,
          stock_expected_return_source: "dcf_implied_upside",
          has_price_data: true,
        },
      ];
    }

    return baseRows;
  };

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const { pathname, searchParams } = url;
    const method = route.request().method();

    if (pathname === `${API_PREFIX}/health`) {
      return json(route, { status: "ok", version: "1.0.0" });
    }

    if (pathname === `${API_PREFIX}/corporate/companies` && method === "GET") {
      return json(route, [
        { ticker: "AAPL", name: "Apple", sector: "Technology", source: "watchlist" },
        { ticker: "MSFT", name: "Microsoft", sector: "Technology", source: "watchlist" },
      ]);
    }

    if (pathname === `${API_PREFIX}/corporate/companies` && method === "POST") {
      return json(route, JSON.parse(route.request().postData() ?? "{}"));
    }

    if (pathname === `${API_PREFIX}/corporate/metrics/AAPL/history` && method === "GET") {
      return json(route, {
        ticker: "AAPL",
        start_year: 2021,
        country_risk_premium: 0.8,
        growth_cagr: 6.1,
        growth_recent_average: 5.8,
        annual_growth_rates: [{ year: 2025, value: 6.0 }],
        roic_recent_average: 18.5,
        roic_all_year_average: 17.9,
        annual_roic: [{ year: 2025, value: 18.0 }],
      });
    }

    if (pathname === `${API_PREFIX}/corporate/metrics/AAPL/quarterly-statements` && method === "GET") {
      return json(route, {
        ticker: "AAPL",
        source: "Mock quarterly statements",
        rows: [],
      });
    }

    if (pathname === `${API_PREFIX}/corporate/metrics/AAPL` && method === "GET") {
      return json(route, {
        ticker: "AAPL",
        growth: 6,
        roic: 18,
        wacc: 10,
        debt_ratio: 18,
        unlevered_beta: 1.05,
        crp: 0.8,
        reinvestment: 34,
        fcff: 92,
        innovation: 82,
        market_share: 64,
        governance: 74,
        esg_penalty: 22,
      });
    }

    if (pathname === `${API_PREFIX}/corporate/metrics/AAPL` && method === "PUT") {
      return json(route, JSON.parse(route.request().postData() ?? "{}"));
    }

    if (pathname === `${API_PREFIX}/market/index/%5EGSPC` && method === "GET") {
      return json(route, [
        { date: "2026-04-08", open: 5100, high: 5120, low: 5080, close: 5110, volume: 1000000 },
        { date: "2026-04-09", open: 5110, high: 5140, low: 5105, close: 5135, volume: 1100000 },
      ]);
    }

    if (pathname === `${API_PREFIX}/corporate/dcf/AAPL` && method === "POST") {
      return json(route, {
        status: "ok",
        data: {
          estimated_value: 240.5,
          current_price: 210.4,
          upside_pct: 14.31,
          wacc_used: 0.1,
          margin_used: 0.18,
          growth_used: 0.06,
          status: "Undervalued",
        },
      });
    }

    if (pathname === `${API_PREFIX}/corporate/comparison` && method === "GET") {
      const mode = (searchParams.get("mode") ?? "snapshot") as "snapshot" | "live";
      const comparisonUniverse = searchParams.get("comparison_universe") ?? "portfolio_plus_benchmark";
      const benchmarkTicker = (searchParams.get("benchmark_ticker") ?? "^GSPC").toUpperCase();
      const customTickers = (searchParams.get("custom_tickers") ?? "")
        .split(",")
        .map((ticker) => ticker.trim().toUpperCase())
        .filter(Boolean);
      return json(route, {
        status: "ok",
        data: {
          market_expected_return: 9.7,
          risk_free_rate: 4.2,
          equity_risk_premium: 5.5,
          stock_expected_return_method: "dcf_implied_upside",
          comparison_reference_return_method: "capm_beta_reference",
          snapshot: {
            ...comparisonSnapshot,
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
      const comparisonUniverse = searchParams.get("comparison_universe") ?? "portfolio_plus_benchmark";
      const benchmarkTicker = (searchParams.get("benchmark_ticker") ?? "^GSPC").toUpperCase();
      const customTickers = (searchParams.get("custom_tickers") ?? "")
        .split(",")
        .map((ticker) => ticker.trim().toUpperCase())
        .filter(Boolean);
      comparisonSnapshot = {
        ...comparisonSnapshot,
        mode: "snapshot",
        as_of_date: "2026-04-11",
        generated_at: nowIso(),
        snapshot_version: "2026-04-11|portfolio_plus_benchmark|^GSPC||2026-04-11T12:30:00Z",
        snapshot_versions_for_day: 2,
        snapshot_source: "manual_refresh",
        comparison_universe: comparisonUniverse,
        benchmark_ticker: benchmarkTicker,
        custom_tickers: customTickers,
        snapshot_is_stale: false,
      };
      return json(route, {
        status: "ok",
        data: {
          market_expected_return: 9.7,
          risk_free_rate: 4.2,
          equity_risk_premium: 5.5,
          stock_expected_return_method: "dcf_implied_upside",
          comparison_reference_return_method: "capm_beta_reference",
          snapshot: comparisonSnapshot,
          rows: comparisonRowsByUniverse(comparisonUniverse, benchmarkTicker, customTickers),
        },
      });
    }

    if (pathname === `${API_PREFIX}/detail/AAPL/ohlcv` && method === "GET") {
      return json(route, [
        { date: "2026-04-07", open: 200, high: 205, low: 198, close: 203, volume: 1000000 },
        { date: "2026-04-08", open: 203, high: 207, low: 202, close: 206, volume: 1200000 },
        { date: "2026-04-09", open: 206, high: 210, low: 205, close: 209, volume: 1400000 },
      ]);
    }

    return route.continue();
  });
}
