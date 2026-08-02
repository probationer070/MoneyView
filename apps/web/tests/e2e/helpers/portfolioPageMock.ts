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

export type PortfolioPageMockStats = {
  comparisonRequests: number;
  comparisonHistoryRequests: number;
  attributionRequests: number;
  stockDetailRequests: number;
  stockSnapshotHistoryRequests: number;
};

export type PortfolioPageMockOptions = {
  failStockDetail?: boolean;
  failNewsFeed?: boolean;
  excludeComparisonTickers?: string[];
  nullMetricTicker?: string;
  /**
   * Replaces the seed watchlist for this page only. The shared fixture keeps its real
   * weights because other specs assert against them; a spec that needs a different
   * universe (no weights, more rows than the fallback cap) passes its own here instead
   * of mutating the fixture out from under everyone else.
   */
  watchlist?: PortfolioStockFixture[];
  /** Holds POST /news/acquire open so a spec can observe the in-flight state. */
  acquireDelayMs?: number;
};

// Per-ticker news shape. AAPL has articles, MSFT is checked-but-empty, GOOGL has never
// been checked: the three states a tile has to tell apart. Every other ticker is
// never-checked, which is what an unseeded watchlist row really looks like.
const NEWS_ARTICLES_BY_TICKER: Record<string, Array<{ headline: string; url: string }>> = {
  AAPL: [
    { headline: "AAPL headline one", url: "https://example.com/news/aapl/1" },
    { headline: "AAPL headline two", url: "https://example.com/news/aapl/2" },
    { headline: "AAPL headline three", url: "https://example.com/news/aapl/3" },
  ],
};
const NEWS_LAST_CHECKED_BY_TICKER: Record<string, string | null> = {
  AAPL: "2026-04-11T14:00:00Z",
  MSFT: "2026-04-11T14:00:00Z",
};

// Outcome per ticker for POST /news/acquire, covering all four statuses the contract
// defines. Anything not named lands on "empty", which summarizes as already-current.
const ACQUIRE_OUTCOME_BY_TICKER: Record<string, { status: string; articles: number; detail: string | null }> = {
  AAPL: { status: "acquired", articles: 3, detail: null },
  MSFT: { status: "fresh", articles: 0, detail: null },
  GOOGL: { status: "failed", articles: 0, detail: "provider timeout" },
};

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

export async function mockPortfolioPageApi(page: Page, stats?: PortfolioPageMockStats, options?: PortfolioPageMockOptions) {
  let watchlist: PortfolioStock[] = cloneFixture(options?.watchlist ?? portfolioPartialWeightsFixture);
  let companyRegistry = [
    { ticker: "AAPL", name: "Apple Inc.", sector: "Technology", source: "portfolio" },
    { ticker: "MSFT", name: "Microsoft Corp.", sector: "Technology", source: "portfolio" },
    { ticker: "NVDA", name: "NVIDIA", sector: "Semiconductors", source: "portfolio" },
    { ticker: "TSLA", name: "Tesla", sector: "Automotive", source: "portfolio" },
    { ticker: "AMZN", name: "Amazon", sector: "Consumer", source: "portfolio" },
  ];
  let portfolioPreferences = {
    total_investment_amount: 10000,
    transaction_fee_rate: 0.002,
    updated_at: nowIso(),
  };

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
    snapshot_available: true,
    snapshot_source: "scheduled_kst_daily",
    comparison_universe: "portfolio_plus_benchmark",
    benchmark_ticker: "^GSPC",
    custom_tickers: [] as string[],
    snapshot_cadence: "daily_kst_0000",
    snapshot_retention_days: 365,
    snapshot_is_stale: false,
  };
  const selectedSnapshotUniverse = {
    comparisonUniverse: "portfolio_plus_benchmark",
    benchmarkTicker: "^GSPC",
    customTickers: [] as string[],
  };
  let snapshotHistory = cloneFixture(snapshotHistoryFixture);
  const snapshotRowsByVersion: Record<string, Array<(typeof benchmarkUniverseFixture.rows)[number]>> = {
    "2026-04-11|portfolio_plus_benchmark|^GSPC||2026-04-11T12:00:00Z": cloneFixture(benchmarkUniverseFixture.rows),
    "2026-04-10|portfolio_plus_benchmark|^GSPC||2026-04-10T12:00:00Z": [
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
        stock_expected_return: 8.5,
        market_expected_return: 9.7,
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
        stock_expected_return: 13.2,
        market_expected_return: 9.7,
        expected_return_spread: 3.5,
      },
      {
        ticker: "MSFT",
        name: "Microsoft",
        sector: "Technology",
        group_name: "core",
        weight: 0.25,
        roic_minus_wacc: 12.5,
        dcf_value: 451.4,
        current_price: 410.2,
        dcf_implied_return: 10.0,
        capm_expected_return: 10.2,
        stock_expected_return: 10.0,
        market_expected_return: 9.7,
        expected_return_spread: 0.3,
      },
    ],
  };

  const comparisonRowsByUniverse = (comparisonUniverse: string, benchmarkTicker: string, customTickers: string[]) => {
    const rows = comparisonUniverse === "custom"
      ? [
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
      ]
      : cloneFixture(benchmarkUniverseFixture.rows);

    const excludedTickers = new Set((options?.excludeComparisonTickers ?? []).map((ticker) => ticker.toUpperCase()));
    return rows
      .filter((row) => !excludedTickers.has(String(row.ticker).toUpperCase()))
      .map((row) => {
        if ((options?.nullMetricTicker ?? "").toUpperCase() !== String(row.ticker).toUpperCase()) {
          return row;
        }
        return {
          ...row,
          roic_minus_wacc: null,
          dcf_implied_return: null,
          expected_return_spread: null,
        };
      });
  };
  const metricAudit = (ticker: string) => ({
    ticker,
    source_mode: "yahoo_finance",
    generated_at: nowIso(),
    growth: {
      value: 12,
      display_value: "12.0%",
      method: "stable_cagr",
      quality: "ok",
      reason: null,
      warnings: [],
      confidence: 0.98,
      source: "Stable CAGR from Yahoo annual revenue values",
      as_of: "2025-12-31",
      calculation_version: "growth_v2_stable_cagr",
      inputs_used: [
        { field: "final_growth_value", label: "Final growth value", value: 12, display_value: "12.0%", source: "Stable CAGR from Yahoo annual revenue values" },
        { field: "growth_recent_average", label: "Recent average growth", value: 10.5, display_value: "10.5%", source: "Supporting annual YoY context" },
      ],
    },
    roic: {
      value: 18,
      display_value: "18.0%",
      method: "stable_invested_capital",
      quality: "ok",
      reason: null,
      warnings: [],
      confidence: 0.98,
      source: "Yahoo Finance annual or quarterly statement bundle",
      as_of: "2025-12-31",
      calculation_version: "roic_v3_stable_invested_capital",
      inputs_used: [
        { field: "operating_income", label: "Operating income / EBIT", value: 114000000000, display_value: "$114,000,000,000", source: "Yahoo Finance annual or quarterly statement bundle" },
        { field: "tax_rate", label: "Tax rate", value: 0.156, display_value: "15.6%", source: "Yahoo Finance annual or quarterly statement bundle" },
        { field: "average_invested_capital", label: "Average invested capital", value: 118000000000, display_value: "$118,000,000,000", source: "Yahoo Finance annual or quarterly statement bundle" },
        { field: "final_roic_value", label: "Final ROIC value", value: 18, display_value: "18.0%", source: "Computed from recent_average basis" },
      ],
    },
    wacc: {
      value: 10,
      display_value: "10.0%",
      method: "latest_capital_structure",
      quality: "estimated",
      reason: "Market capitalization was unavailable, so debt and equity weights fall back to statement debt ratio.",
      warnings: ["Market capitalization was unavailable, so debt and equity weights fall back to statement debt ratio."],
      confidence: 0.76,
      source: "Yahoo Finance statement bundle plus market profile",
      as_of: "2025-12-31",
      calculation_version: "wacc_v2_latest_capital_structure",
      inputs_used: [
        { field: "risk_free_rate", label: "Risk-free rate", value: 0.042, display_value: "4.2%", source: "Model policy input" },
        { field: "beta", label: "Beta", value: 1.12, display_value: "1.12", source: "Yahoo Finance statement bundle plus market profile" },
        { field: "final_wacc_value", label: "Final WACC value", value: 10, display_value: "10.0%", source: "Weighted capital costs" },
      ],
    },
    spread: {
      value: 8,
      display_value: "8.0%",
      method: "roic_minus_wacc",
      quality: "estimated",
      reason: "ROIC - WACC inherits the lower-confidence state of the two source metrics.",
      warnings: ["ROIC - WACC inherits the lower-confidence state of ROIC and WACC."],
      confidence: 0.69,
      source: "Derived spread",
      as_of: "2025-12-31",
      calculation_version: "spread_v1_roic_minus_wacc",
      inputs_used: [
        { field: "roic", label: "ROIC", value: 18, display_value: "18.0%", source: "Yahoo Finance annual or quarterly statement bundle" },
        { field: "wacc", label: "WACC", value: 10, display_value: "10.0%", source: "Yahoo Finance statement bundle plus market profile" },
      ],
    },
    dcf: {
      value: null,
      display_value: "Unavailable",
      method: "dcf_summary_placeholder",
      quality: "missing",
      reason: "DCF audit is loaded from the DCF report endpoint.",
      warnings: ["Use the DCF report endpoint for valuation audit inputs."],
      confidence: 0,
      inputs_used: [],
      source: "Deferred to /corporate/dcf/{ticker}/report",
      as_of: null,
      calculation_version: "dcf_v1_summary_placeholder",
    },
  });

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

    if (pathname === `${API_PREFIX}/portfolio/preferences` && method === "GET") {
      return json(route, { status: "ok", data: portfolioPreferences });
    }

    if (pathname === `${API_PREFIX}/portfolio/preferences` && method === "PUT") {
      const payload = JSON.parse(route.request().postData() ?? "{}");
      portfolioPreferences = {
        total_investment_amount: Number(payload.total_investment_amount ?? portfolioPreferences.total_investment_amount),
        transaction_fee_rate: 0.002,
        updated_at: nowIso(),
      };
      return json(route, { status: "ok", data: portfolioPreferences });
    }

    if (pathname === `${API_PREFIX}/corporate/companies` && method === "GET") {
      return json(route, companyRegistry);
    }

    if (pathname === `${API_PREFIX}/corporate/companies` && method === "POST") {
      const payload = JSON.parse(route.request().postData() ?? "{}");
      const normalized = {
        ticker: String(payload.ticker ?? "").toUpperCase(),
        name: payload.name,
        sector: payload.sector ?? "",
        source: payload.source ?? "manual",
      };
      companyRegistry = [
        ...companyRegistry.filter((company) => company.ticker !== normalized.ticker),
        normalized,
      ];
      return json(route, normalized);
    }

    if (pathname === `${API_PREFIX}/portfolio/attribution` && method === "POST") {
      if (stats) stats.attributionRequests += 1;
      const payload = JSON.parse(route.request().postData() ?? "{}");
      return json(route, { status: "ok", data: buildAttribution(payload.weights ?? [], payload.tickers ?? []) });
    }

    if (pathname === `${API_PREFIX}/corporate/comparison` && method === "GET") {
      if (stats) stats.comparisonRequests += 1;
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
      if (stats) stats.comparisonHistoryRequests += 1;
      const comparisonUniverse = url.searchParams.get("comparison_universe") ?? "portfolio_plus_benchmark";
      const benchmarkTicker = (url.searchParams.get("benchmark_ticker") ?? "^GSPC").toUpperCase();
      const customTickers = (url.searchParams.get("custom_tickers") ?? "")
        .split(",")
        .map((ticker) => ticker.trim().toUpperCase())
        .filter(Boolean);
      return json(route, {
        status: "ok",
        data: {
          ...cloneFixture(snapshotHistory),
          comparison_universe: comparisonUniverse,
          benchmark_ticker: benchmarkTicker,
          custom_tickers: customTickers,
        },
      });
    }

    if (pathname === `${API_PREFIX}/corporate/comparison/snapshot-version` && method === "GET") {
      const snapshotVersion = url.searchParams.get("snapshot_version") ?? portfolioComparisonSnapshot.snapshot_version;
      const rows = cloneFixture(snapshotRowsByVersion[snapshotVersion] ?? benchmarkUniverseFixture.rows);
      const point = snapshotHistory.points.find((entry) => entry.snapshot_version === snapshotVersion);
      selectedSnapshotUniverse.comparisonUniverse = point?.comparison_universe ?? portfolioComparisonSnapshot.comparison_universe;
      selectedSnapshotUniverse.benchmarkTicker = (point?.benchmark_ticker ?? portfolioComparisonSnapshot.benchmark_ticker).toUpperCase();
      selectedSnapshotUniverse.customTickers = cloneFixture(snapshotHistory.custom_tickers ?? portfolioComparisonSnapshot.custom_tickers);
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
            as_of_date: point?.as_of_date ?? portfolioComparisonSnapshot.as_of_date,
            generated_at: point?.generated_at ?? portfolioComparisonSnapshot.generated_at,
            snapshot_version: snapshotVersion,
            snapshot_source: point?.snapshot_source ?? portfolioComparisonSnapshot.snapshot_source,
          },
          rows,
        },
      });
    }

    if (pathname === `${API_PREFIX}/corporate/comparison/stock-history` && method === "GET") {
      if (stats) stats.stockSnapshotHistoryRequests += 1;
      const ticker = (url.searchParams.get("ticker") ?? "AAPL").toUpperCase();
      const comparisonUniverse = url.searchParams.get("comparison_universe") ?? "portfolio_plus_benchmark";
      const benchmarkTicker = (url.searchParams.get("benchmark_ticker") ?? "^GSPC").toUpperCase();
      const customTickers = (url.searchParams.get("custom_tickers") ?? "")
        .split(",")
        .map((entry) => entry.trim().toUpperCase())
        .filter(Boolean);
      const matchesSelectedSnapshotContext = comparisonUniverse === selectedSnapshotUniverse.comparisonUniverse
        && benchmarkTicker === selectedSnapshotUniverse.benchmarkTicker
        && customTickers.join(",") === selectedSnapshotUniverse.customTickers.join(",");
      const points = snapshotHistory.points.map((point) => {
        const row = (snapshotRowsByVersion[point.snapshot_version] ?? benchmarkUniverseFixture.rows).find((entry) => entry.ticker === ticker);
        return {
          as_of_date: point.as_of_date,
          generated_at: point.generated_at,
          snapshot_version: point.snapshot_version,
          snapshot_source: point.snapshot_source,
          benchmark_ticker: point.benchmark_ticker,
          current_price: row?.current_price ?? 0,
          roic_minus_wacc: row?.roic_minus_wacc ?? 0,
          dcf_implied_return: row?.dcf_implied_return ?? 0,
          expected_return_spread: row?.expected_return_spread ?? 0,
          market_expected_return: point.market_expected_return,
        };
      });
      return json(route, {
        status: "ok",
        data: {
          ticker,
          comparison_universe: comparisonUniverse,
          benchmark_ticker: benchmarkTicker,
          custom_tickers: customTickers,
          points: matchesSelectedSnapshotContext ? points : [],
        },
      });
    }

    if (pathname.startsWith(`${API_PREFIX}/corporate/metrics/`) && pathname.endsWith("/audit") && method === "GET") {
      const ticker = (pathname.split("/").at(-2) ?? "AAPL").toUpperCase();
      return json(route, metricAudit(ticker));
    }

    if (pathname === `${API_PREFIX}/portfolio/watchlist` && method === "POST") {
      const payload = JSON.parse(route.request().postData() ?? "{}");
      const existingRow = watchlist.find((item) => item.ticker === payload.ticker);
      const nextRow: PortfolioStock = {
        ticker: payload.ticker,
        name: payload.name,
        sector: payload.sector,
        group_name: payload.group_name,
        weight: payload.weight,
        last_close: existingRow?.last_close ?? 100,
        delta: { delta_pct: 1.1 },
        sparkline: existingRow?.sparkline ?? [95, 97, 99, 100],
        // An upsert keeps its row id; a genuinely new ticker takes the next one, the way
        // an autoincrement primary key behaves.
        id: existingRow?.id ?? watchlist.reduce((max, item) => Math.max(max, item.id), 0) + 1,
      };
      watchlist = [...watchlist.filter((item) => item.ticker !== payload.ticker), nextRow];
      companyRegistry = [
        ...companyRegistry.filter((company) => company.ticker !== nextRow.ticker),
        {
          ticker: nextRow.ticker,
          name: nextRow.name,
          sector: nextRow.sector,
          source: "watchlist",
        },
      ];
      return json(route, payload);
    }

    if (pathname.startsWith(`${API_PREFIX}/portfolio/watchlist/`) && method === "DELETE") {
      const ticker = pathname.split("/").at(-1) ?? "";
      watchlist = watchlist.filter((item) => item.ticker !== ticker);
      return json(route, { status: "ok", ticker });
    }

    if (pathname === `${API_PREFIX}/corporate/comparison/snapshot-version` && method === "DELETE") {
      const snapshotVersion = url.searchParams.get("snapshot_version") ?? "";
      if (!snapshotVersion || !snapshotHistory.points.some((point) => point.snapshot_version === snapshotVersion)) {
        return route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ detail: `snapshot version not found: ${snapshotVersion}` }),
        });
      }
      snapshotHistory = {
        ...snapshotHistory,
        points: snapshotHistory.points.filter((point) => point.snapshot_version !== snapshotVersion),
      };
      delete snapshotRowsByVersion[snapshotVersion];
      return json(route, {
        status: "ok",
        data: {
          snapshot_version: snapshotVersion,
          deleted_rows: 1,
        },
      });
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
          id: 1,
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
      if (stats) stats.stockDetailRequests += 1;
      if (options?.failStockDetail) {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Mock stock detail failure" }),
        });
      }
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
      if (options?.failNewsFeed) {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Mock news feed failure" }),
        });
      }
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

    // GET /news/feed/bulk is declared response_model=APIResponse[BulkNewsResponse], so it
    // is enveloped. POST /news/acquire returns NewsAcquireResponse bare. The two differ on
    // the wire and the mock has to differ with them.
    if (pathname === `${API_PREFIX}/news/feed/bulk` && method === "GET") {
      const requested = (url.searchParams.get("tickers") ?? "")
        .split(",")
        .map((ticker) => ticker.trim().toUpperCase())
        .filter(Boolean);
      const tickers: Record<string, { articles: unknown[]; last_checked_at: string | null }> = {};
      for (const ticker of requested) {
        tickers[ticker] = {
          articles: (NEWS_ARTICLES_BY_TICKER[ticker] ?? []).map((article, index) => ({
            id: index + 1,
            ticker,
            headline: article.headline,
            url: article.url,
            source: "Mock News",
            published_date: "2026-04-11",
            sentiment: "neutral",
            importance: 1,
          })),
          last_checked_at: NEWS_LAST_CHECKED_BY_TICKER[ticker] ?? null,
        };
      }
      return json(route, { status: "ok", data: { tickers } });
    }

    if (pathname === `${API_PREFIX}/news/acquire` && method === "POST") {
      const payload = JSON.parse(route.request().postData() ?? "{}");
      const requested: string[] = (payload.tickers ?? []).map((ticker: string) => String(ticker).toUpperCase());
      const body = {
        results: requested.map((ticker) => ({
          ticker,
          ...(ACQUIRE_OUTCOME_BY_TICKER[ticker] ?? { status: "empty", articles: 0, detail: null }),
        })),
        skipped_unknown: [] as string[],
      };
      if (options?.acquireDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.acquireDelayMs));
      }
      return json(route, body);
    }

    return route.continue();
  });
}
