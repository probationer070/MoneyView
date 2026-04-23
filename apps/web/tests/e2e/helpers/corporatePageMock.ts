import type { Page } from "@playwright/test";
import type {
  DcfAssumptionSummary,
  DcfCompleteEvent,
  DcfFullReport,
  DcfPhase1Event,
  DcfPhase2Event,
  DcfSummary,
  DcfSummaryResponse,
} from "../../../../../packages/shared-types";
import { API_PREFIX, json, nowIso } from "./mockUtils";

export type CorporatePageMockStats = {
  dcfRequests: number;
  dcfFullReportRequests: number;
  dcfBulkReportRequests: number;
  comparisonRequests: number;
  metricSaveRequests: number;
  metricHistoryRequests: number;
  quarterlyRequests: number;
  ohlcvRequests: number;
};

const mockDcfSummary: DcfSummary = {
  report_id: "mockdcf001",
  ticker: "AAPL",
  estimated_value: 240.5,
  current_price: 210.4,
  upside_pct: 14.31,
  status: "Undervalued",
  generated_at: "2026-04-11T12:00:00Z",
};

const mockDcfAssumptions: DcfAssumptionSummary = {
  report_id: "mockdcf001",
  ticker: "AAPL",
  generated_at: "2026-04-11T12:00:00Z",
  wacc_used: 0.1,
  margin_used: 0.18,
  growth_used: 0.06,
  fcff_used: 92,
  esg_penalty_used: 22,
  terminal_growth_used: 0.02,
  enterprise_value_index: 262.4,
};

const mockDcfSummaryResponse: DcfSummaryResponse = {
  ...mockDcfSummary,
  wacc_used: mockDcfAssumptions.wacc_used,
  margin_used: mockDcfAssumptions.margin_used,
  growth_used: mockDcfAssumptions.growth_used,
  fcff_used: mockDcfAssumptions.fcff_used,
  esg_penalty_used: mockDcfAssumptions.esg_penalty_used,
  terminal_growth_used: mockDcfAssumptions.terminal_growth_used,
  enterprise_value_index: mockDcfAssumptions.enterprise_value_index,
};

const mockDcfFullReport: DcfFullReport = {
  summary: mockDcfSummary,
  assumptions: mockDcfAssumptions,
  projection_rows: [
    { year: 1, projected_fcff: 97.52, discount_factor: 1.1, present_value: 88.65 },
    { year: 2, projected_fcff: 103.37, discount_factor: 1.21, present_value: 85.43 },
  ],
  wacc_breakdown: {
    risk_free_rate: 0.042,
    unlevered_beta: 1.05,
    debt_ratio: 18,
    tax_rate: 0.25,
    equity_risk_premium: 0.055,
    country_risk_premium: 0.8,
  },
  terminal_cash_flow: 133.2,
  terminal_value: 1665.0,
  present_value_of_terminal: 1034.1,
  present_value_of_fcff: 428.3,
  enterprise_value: 1462.4,
  agency_discount: 0.945,
  dcf_multiple: 15.9,
  baseline_multiple: 12.5,
  fcff_scale: 1,
};

const mockDcfPhase1Event: DcfPhase1Event = {
  phase: "phase1",
  summary: mockDcfSummary,
};

const mockDcfPhase2Event: DcfPhase2Event = {
  phase: "phase2",
  assumptions: mockDcfAssumptions,
};

const mockDcfCompleteEvent: DcfCompleteEvent = {
  phase: "complete",
  report_id: mockDcfSummary.report_id,
  generated_at: mockDcfSummary.generated_at,
};

export async function mockCorporatePageApi(page: Page, stats?: CorporatePageMockStats) {
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
        { ticker: "GOOGL", name: "Alphabet", sector: "Communication Services", source: "watchlist" },
      ]);
    }

    if (pathname === `${API_PREFIX}/corporate/companies` && method === "POST") {
      return json(route, JSON.parse(route.request().postData() ?? "{}"));
    }

    if (pathname === `${API_PREFIX}/portfolio/watchlist` && method === "GET") {
      return json(route, [
        {
          ticker: "AAPL",
          name: "Apple",
          sector: "Technology",
          group_name: "core",
          weight: 0.35,
          last_close: 210.4,
          delta: { delta_pct: 1.2 },
          sparkline: [203, 205, 207, 208, 210.4],
        },
        {
          ticker: "MSFT",
          name: "Microsoft",
          sector: "Technology",
          group_name: "core",
          weight: 0.25,
          last_close: 415.3,
          delta: { delta_pct: 0.8 },
          sparkline: [401, 407, 410, 412, 415.3],
        },
      ]);
    }

    if (pathname === `${API_PREFIX}/corporate/metrics/AAPL/history` && method === "GET") {
      if (stats) stats.metricHistoryRequests += 1;
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
      if (stats) stats.quarterlyRequests += 1;
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

    if (pathname === `${API_PREFIX}/corporate/metrics/MSFT` && method === "GET") {
      return json(route, {
        ticker: "MSFT",
        growth: 7,
        roic: 22,
        wacc: 9,
        debt_ratio: 15,
        unlevered_beta: 0.95,
        crp: 0.8,
        reinvestment: 40,
        fcff: 120,
        innovation: 88,
        market_share: 58,
        governance: 80,
        esg_penalty: 18,
      });
    }

    if (pathname === `${API_PREFIX}/corporate/metrics/AAPL` && method === "PUT") {
      if (stats) stats.metricSaveRequests += 1;
      return json(route, JSON.parse(route.request().postData() ?? "{}"));
    }

    if (pathname === `${API_PREFIX}/corporate/metrics/MSFT` && method === "PUT") {
      if (stats) stats.metricSaveRequests += 1;
      return json(route, JSON.parse(route.request().postData() ?? "{}"));
    }

    if (pathname === `${API_PREFIX}/market/index/%5EGSPC` && method === "GET") {
      return json(route, [
        { date: "2026-04-08", open: 5100, high: 5120, low: 5080, close: 5110, volume: 1000000 },
        { date: "2026-04-09", open: 5110, high: 5140, low: 5105, close: 5135, volume: 1100000 },
      ]);
    }

    if (pathname === `${API_PREFIX}/corporate/dcf/AAPL/stream` && method === "POST") {
      if (stats) stats.dcfRequests += 1;
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          "event: phase1",
          `data: ${JSON.stringify(mockDcfPhase1Event)}`,
          "",
          "event: phase2",
          `data: ${JSON.stringify(mockDcfPhase2Event)}`,
          "",
          "event: complete",
          `data: ${JSON.stringify(mockDcfCompleteEvent)}`,
          "",
        ].join("\n"),
      });
    }

    if (pathname === `${API_PREFIX}/corporate/dcf/AAPL/report` && method === "POST") {
      if (stats) stats.dcfFullReportRequests += 1;
      return json(route, {
        status: "ok",
        data: mockDcfFullReport,
      });
    }

    if (pathname === `${API_PREFIX}/corporate/dcf/reports/bulk` && method === "POST") {
      if (stats) stats.dcfBulkReportRequests += 1;
      const payload = JSON.parse(route.request().postData() ?? "{}");
      const tickers = Array.isArray(payload.tickers) ? payload.tickers : [];
      return json(route, tickers.map((ticker: string, index: number) => ({
        ...mockDcfFullReport,
        summary: {
          ...mockDcfFullReport.summary,
          report_id: `mockdcf-bulk-${index + 1}`,
          ticker,
          estimated_value: mockDcfFullReport.summary.estimated_value + index * 18,
          current_price: mockDcfFullReport.summary.current_price + index * 12,
          upside_pct: mockDcfFullReport.summary.upside_pct - index * 1.1,
          status: index === 0 ? "Undervalued" : index === 1 ? "Fairly Valued" : "Watch",
          generated_at: nowIso(),
        },
        assumptions: {
          ...mockDcfFullReport.assumptions,
          report_id: `mockdcf-bulk-${index + 1}`,
          ticker,
          generated_at: nowIso(),
        },
      })));
    }

    if (pathname === `${API_PREFIX}/corporate/dcf/AAPL` && method === "POST") {
      if (stats) stats.dcfRequests += 1;
      return json(route, {
        status: "ok",
        data: mockDcfSummaryResponse,
      });
    }

    if (pathname === `${API_PREFIX}/corporate/comparison` && method === "GET") {
      if (stats) stats.comparisonRequests += 1;
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
      if (stats) stats.ohlcvRequests += 1;
      return json(route, [
        { date: "2026-04-07", open: 200, high: 205, low: 198, close: 203, volume: 1000000 },
        { date: "2026-04-08", open: 203, high: 207, low: 202, close: 206, volume: 1200000 },
        { date: "2026-04-09", open: 206, high: 210, low: 205, close: 209, volume: 1400000 },
      ]);
    }

    return route.continue();
  });
}
