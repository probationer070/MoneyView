import type { Page } from "@playwright/test";
import type {
  CorporateMetricAudit,
  DcfAssumptionSummary,
  DcfCompleteEvent,
  DcfFullReport,
  DcfPhase1Event,
  DcfPhase2Event,
  DcfSummary,
  DcfSummaryResponse,
} from "../../../../../packages/shared-types";
import { API_PREFIX, json, nowIso } from "./mockUtils";

// current_price for the "Technology" sector comparison rows (AAPL/MSFT/ESTM/MISS), shared
// between the fixture below and any test that needs to identify a specific ticker's data
// point independently (e.g. by decoding a chart's rendered pixel position). Exported so
// those tests derive the value from this single source instead of restating it as a
// separate literal that can silently drift out of sync with the fixture.
export const CORPORATE_COMPARISON_CURRENT_PRICES: Record<string, number> = {
  AAPL: 210.4,
  MSFT: 415.3,
  ESTM: 250.0,
  MISS: 240.0,
};

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

export type CorporatePageMockOptions = {
  failQuarterlyStatements?: boolean;
  failOhlcv?: boolean;
  failDcfFullReport?: boolean;
  /**
   * bridge_quality for the single-ticker DCF summary (stream, report, and POST /dcf/AAPL).
   * The bulk-report handler always derives its own per-ticker quality from the ticker name,
   * so one bulk table can carry all three states at once.
   */
  dcfBridgeQuality?: BridgeQuality;
};

export type BridgeQuality = "ok" | "estimated" | "missing";

/**
 * Rewrites a summary into what corporate_dcf.py actually emits for the given bridge state,
 * rather than flipping bridge_quality alone. A test that asserts a value is suppressed has to
 * run against a payload the backend can really produce, or it proves nothing.
 *
 * For "missing": the bridge does not resolve, so equity value and the per-share value are
 * absent, estimated_value falls back to enterprise value (corporate_dcf.py:222), and
 * upside_pct is set to 0.0 rather than left out (corporate_dcf.py:224).
 */
function withBridgeQuality<T extends DcfSummary>(summary: T, quality: BridgeQuality): T {
  if (quality !== "missing") {
    return { ...summary, bridge_quality: quality };
  }
  return {
    ...summary,
    bridge_quality: "missing",
    valuation_method: "enterprise_value_no_share_bridge",
    intrinsic_value_per_share: null,
    equity_value: null,
    estimated_value: summary.enterprise_value,
    upside_pct: 0.0,
    status: "Bridge Incomplete",
  };
}

/**
 * The bulk table's per-ticker bridge state, matching the comparison fixture's convention:
 * MISS has no bridge, ESTM has an estimated one, everything else resolves cleanly. A mixed
 * table is what catches a guard written `!== "ok"`, which would wrongly suppress ESTM.
 */
function bulkBridgeQuality(ticker: string): BridgeQuality {
  if (ticker === "MISS") return "missing";
  if (ticker === "ESTM") return "estimated";
  return "ok";
}

const mockDcfSummary: DcfSummary = {
  report_id: "mockdcf001",
  ticker: "AAPL",
  estimated_value: 240.5,
  intrinsic_value_per_share: 240.5,
  enterprise_value: 1462.4,
  equity_value: 1202.5,
  valuation_method: "intrinsic_equity_per_share",
  bridge_quality: "ok",
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
  equity_value: 1202.5,
  intrinsic_value_per_share: 240.5,
  net_debt: 300,
  non_operating_assets: 40.1,
  diluted_shares_outstanding: 5,
  valuation_method: "intrinsic_equity_per_share",
  bridge_quality: "ok",
  agency_discount: 0.945,
  dcf_multiple: 15.9,
  baseline_multiple: 12.5,
  fcff_scale: 1,
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

const mockMetricAudit = (ticker: string): CorporateMetricAudit => ({
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
    value: ticker === "MSFT" ? 22 : 18,
    display_value: ticker === "MSFT" ? "22.0%" : "18.0%",
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
      { field: "nopat", label: "NOPAT", value: 96200000000, display_value: "$96,200,000,000", source: "Yahoo Finance annual or quarterly statement bundle" },
      { field: "average_invested_capital", label: "Average invested capital", value: 118000000000, display_value: "$118,000,000,000", source: "Yahoo Finance annual or quarterly statement bundle" },
      { field: "final_roic_value", label: "Final ROIC value", value: ticker === "MSFT" ? 22 : 18, display_value: ticker === "MSFT" ? "22.0%" : "18.0%", source: "Computed from recent_average basis" },
    ],
  },
  wacc: {
    value: ticker === "MSFT" ? 9 : 10,
    display_value: ticker === "MSFT" ? "9.0%" : "10.0%",
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
      { field: "equity_risk_premium", label: "Equity risk premium", value: 0.055, display_value: "5.5%", source: "Model policy input" },
      { field: "final_wacc_value", label: "Final WACC value", value: ticker === "MSFT" ? 9 : 10, display_value: ticker === "MSFT" ? "9.0%" : "10.0%", source: "Weighted capital costs" },
    ],
  },
  spread: {
    value: ticker === "MSFT" ? 13 : 8,
    display_value: ticker === "MSFT" ? "13.0%" : "8.0%",
    method: "roic_minus_wacc",
    quality: "estimated",
    reason: "ROIC - WACC inherits the lower-confidence state of the two source metrics.",
    warnings: ["ROIC - WACC inherits the lower-confidence state of ROIC and WACC."],
    confidence: 0.69,
    source: "Derived spread",
    as_of: "2025-12-31",
    calculation_version: "spread_v1_roic_minus_wacc",
    inputs_used: [
      { field: "roic", label: "ROIC", value: ticker === "MSFT" ? 22 : 18, display_value: ticker === "MSFT" ? "22.0%" : "18.0%", source: "Yahoo Finance annual or quarterly statement bundle" },
      { field: "wacc", label: "WACC", value: ticker === "MSFT" ? 9 : 10, display_value: ticker === "MSFT" ? "9.0%" : "10.0%", source: "Yahoo Finance statement bundle plus market profile" },
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

export async function mockCorporatePageApi(page: Page, stats?: CorporatePageMockStats, options?: CorporatePageMockOptions) {
  const singleBridge = options?.dcfBridgeQuality ?? "ok";
  const dcfSummary = withBridgeQuality(mockDcfSummary, singleBridge);
  const dcfSummaryResponse = withBridgeQuality(mockDcfSummaryResponse, singleBridge);
  const dcfFullReport = { ...mockDcfFullReport, summary: dcfSummary };
  const dcfPhase1Event: DcfPhase1Event = { phase: "phase1", summary: dcfSummary };

  let comparisonSnapshot = {
    mode: "snapshot",
    as_of_date: "2026-04-11",
    generated_at: "2026-04-11T12:00:00Z",
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
        bridge_quality: "ok",
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
        bridge_quality: "ok",
        current_price: CORPORATE_COMPARISON_CURRENT_PRICES.AAPL,
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
        bridge_quality: "ok",
        current_price: CORPORATE_COMPARISON_CURRENT_PRICES.MSFT,
        dcf_implied_return: 10.81,
        capm_expected_return: 10.39,
        stock_expected_return: 10.81,
        market_expected_return: 9.7,
        expected_return_spread: 1.11,
        stock_expected_return_source: "dcf_implied_upside",
        has_price_data: true,
      },
      {
        ticker: "ESTM",
        name: "Estimated Bridge Co",
        sector: "Technology",
        group_name: "core",
        weight: 0.1,
        roic: 15,
        wacc: 10,
        roic_minus_wacc: 5,
        // A real intrinsic value per share, reached through a documented fallback input.
        // It must render exactly like an `ok` row -- this is the row that catches a guard
        // written `!== "ok"` instead of `=== "missing"`.
        dcf_value: 300.0,
        bridge_quality: "estimated",
        current_price: CORPORATE_COMPARISON_CURRENT_PRICES.ESTM,
        dcf_implied_return: 20.0,
        capm_expected_return: 11.0,
        stock_expected_return: 20.0,
        market_expected_return: 9.7,
        expected_return_spread: 10.3,
        stock_expected_return_source: "dcf_implied_upside",
        has_price_data: true,
      },
      {
        ticker: "MISS",
        name: "No Bridge Co",
        sector: "Technology",
        group_name: "core",
        weight: 0.1,
        roic: 12,
        wacc: 10,
        roic_minus_wacc: 2,
        // An enterprise value in billions, which is what dcf_value actually holds when the
        // bridge does not resolve. Deliberately the LARGEST value in the fixture: a
        // comparator that fails to suppress it sorts it first on "DCF value descending",
        // which is exactly what the sort test detects.
        dcf_value: 2438.0,
        bridge_quality: "missing",
        current_price: CORPORATE_COMPARISON_CURRENT_PRICES.MISS,
        dcf_implied_return: 0.0,
        capm_expected_return: 11.0,
        stock_expected_return: 0.0,
        market_expected_return: 9.7,
        expected_return_spread: -9.7,
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
        growth_calculation_version: "growth_v2_stable_cagr",
        growth_cagr: 6.1,
        growth_recent_average: 5.8,
        annual_growth_rates: [{ year: 2025, value: 6.0 }],
        roic_calculation_version: "roic_v3_stable_invested_capital",
        roic_recent_average: 18.5,
        roic_all_year_average: 17.9,
        annual_roic: [{ year: 2025, value: 18.0 }],
      });
    }

    if (pathname === `${API_PREFIX}/corporate/metrics/AAPL/audit` && method === "GET") {
      return json(route, mockMetricAudit("AAPL"));
    }

    if (pathname === `${API_PREFIX}/corporate/metrics/MSFT/audit` && method === "GET") {
      return json(route, mockMetricAudit("MSFT"));
    }

    if (pathname === `${API_PREFIX}/corporate/metrics/AAPL/quarterly-statements` && method === "GET") {
      if (stats) stats.quarterlyRequests += 1;
      if (options?.failQuarterlyStatements) {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Mock quarterly statements failure" }),
        });
      }
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
        growth_avg_legacy: 5.8,
        growth_cagr_v2: 6.1,
        roic: 18,
        roic_legacy: 18,
        roic_stable_v2: 18,
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
        growth_meta: {
          method: "stable_cagr",
          quality: "ok",
          reason: null,
          warnings: [],
          confidence: 0.98,
          source: "Stable CAGR from Yahoo annual revenue values",
          calculation_version: "growth_v2_stable_cagr",
          metric_role: "primary",
          as_of: "2025-12-31",
        },
        roic_meta: {
          method: "stable_invested_capital",
          quality: "ok",
          reason: null,
          warnings: [],
          confidence: 0.98,
          source: "Stable ROIC from NOPAT over average invested capital",
          calculation_version: "roic_v3_stable_invested_capital",
          metric_role: "primary",
          as_of: "2025-12-31",
        },
      });
    }

    if (pathname === `${API_PREFIX}/corporate/metrics/MSFT` && method === "GET") {
      return json(route, {
        ticker: "MSFT",
        growth: 7,
        growth_avg_legacy: 6.4,
        growth_cagr_v2: 7.0,
        roic: 22,
        roic_legacy: 22,
        roic_stable_v2: 22,
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
        growth_meta: {
          method: "stable_cagr",
          quality: "ok",
          reason: null,
          warnings: [],
          confidence: 0.98,
          source: "Stable CAGR from Yahoo annual revenue values",
          calculation_version: "growth_v2_stable_cagr",
          metric_role: "primary",
          as_of: "2025-12-31",
        },
        roic_meta: {
          method: "stable_invested_capital",
          quality: "ok",
          reason: null,
          warnings: [],
          confidence: 0.98,
          source: "Stable ROIC from NOPAT over average invested capital",
          calculation_version: "roic_v3_stable_invested_capital",
          metric_role: "primary",
          as_of: "2025-12-31",
        },
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
          `data: ${JSON.stringify(dcfPhase1Event)}`,
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
      if (options?.failDcfFullReport) {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Mock full DCF report failure" }),
        });
      }
      return json(route, {
        status: "ok",
        data: dcfFullReport,
      });
    }

    if (pathname === `${API_PREFIX}/corporate/dcf/reports/bulk` && method === "POST") {
      if (stats) stats.dcfBulkReportRequests += 1;
      const payload = JSON.parse(route.request().postData() ?? "{}");
      const tickers = Array.isArray(payload.tickers) ? payload.tickers : [];
      return json(route, tickers.map((ticker: string, index: number) => ({
        ...mockDcfFullReport,
        // withBridgeQuality is applied last so the "missing" rewrite overrides the per-index
        // estimated_value/upside_pct/status values above it, exactly as the backend would.
        summary: withBridgeQuality({
          ...mockDcfFullReport.summary,
          report_id: `mockdcf-bulk-${index + 1}`,
          ticker,
          estimated_value: mockDcfFullReport.summary.estimated_value + index * 18,
          current_price: mockDcfFullReport.summary.current_price + index * 12,
          upside_pct: mockDcfFullReport.summary.upside_pct - index * 1.1,
          status: index === 0 ? "Undervalued" : index === 1 ? "Fairly Valued" : "Watch",
          generated_at: nowIso(),
        }, bulkBridgeQuality(ticker)),
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
        data: dcfSummaryResponse,
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
      if (options?.failOhlcv) {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Mock OHLCV failure" }),
        });
      }
      return json(route, [
        { date: "2026-04-07", open: 200, high: 205, low: 198, close: 203, volume: 1000000 },
        { date: "2026-04-08", open: 203, high: 207, low: 202, close: 206, volume: 1200000 },
        { date: "2026-04-09", open: 206, high: 210, low: 205, close: 209, volume: 1400000 },
      ]);
    }

    return route.continue();
  });
}
