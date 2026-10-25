"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { fetchApi } from "@/lib/api";
import { bridgedEstimatedValue, bridgedUpsidePct } from "@/lib/bridgeQuality";
import { DcfRefusalError, postDcf } from "@/lib/dcfRefusal";
import { tabStateKey, useTabState } from "@/lib/tabState";
import { useDevMonitorPageLoad } from "@/hooks/useDevMonitorPageLoad";
import type {
  CorporateDcfBatchRequest,
  CorporateMetricAudit,
  DcfAssumptionSummary as DCFAssumptionSummary,
  DcfFullReport as DCFFullReport,
  DcfSummaryResponse as DCFResult,
} from "../../../../packages/shared-types";
import {
  DEFAULT_PORTFOLIO_BENCHMARK_TICKER,
  PORTFOLIO_BENCHMARK_PRESETS,
} from "@/lib/benchmarkPresets";
import { useDebounce } from "@/hooks/useDebounce";
import {
} from "./components/CorporateGraphs";
import { CorporateDiagnosticsSection } from "./components/CorporateDiagnosticsSection";
import { TargetStockComparisonSection } from "./components/TargetStockComparisonSection";
import { CorporatePageTabs } from "./components/CorporatePageTabs";
import { CorporateHeader } from "./components/CorporateHeader";
import { DcfTab } from "./components/DcfTab";
import { AssumptionTable } from "./components/AssumptionTable";
import { KpiRow } from "./components/KpiRow";
import { VerdictBlock, VerdictStrip } from "./components/VerdictBlock";
import { verdictView } from "./verdict";
import { buildCalculationDetails } from "./buildCalculationDetails";
import { substitutedFormula } from "./substitutedFormula";
import { buildFormulaContext } from "./formulaContext";
import { historicalPriceStatus, quarterlyStatementsStatus } from "./detailStatus";
import type { CalculationDetailKey } from "./components/calculationDetailTypes";
import {
  ACTIVE_TICKER_SESSION_KEY,
  COMPARISON_CACHE_KEY,
  DCF_CACHE_KEY,
  EMPTY_WATCHLIST_HOLDINGS,
  IMPLIED_ERP_BUYBACK_YIELD,
  IMPLIED_ERP_DIVIDEND_YIELD,
  IMPLIED_ERP_FALLBACK_INDEX_LEVEL,
  IMPLIED_ERP_FIVE_YEAR_GROWTH,
  KOREA_COUNTRY_RISK_PREMIUM,
  METRIC_HISTORY_CACHE_KEY,
  PRICE_HISTORY_CACHE_KEY,
  QUARTERLY_STATEMENTS_CACHE_KEY,
  RISK_FREE_RATE,
  STORAGE_KEY,
  TAX_RATE,
  initialAssumptions,
} from "./corporateConstants";
import type {
  CachedCalculation,
  ComparisonRequestSnapshot,
  ComparisonSortKey,
  ComparisonUniverse,
  CorporateAssumptions,
  CorporateCompany,
  CorporateComparisonApi,
  CorporateMetricHistoryApi,
  CorporateMetricsApi,
  DcfRequestSnapshot,
  ImpliedErpInputs,
  QuarterlyStatementsApi,
  RawDatasetRow,
  RoicBasis,
  StockPriceRow,
  WatchlistHolding,
} from "./corporateTypes";
import { isComparisonSortKey } from "./corporateTypes";
import {
  annualMetricRows,
  clamp,
  companyForTicker,
  dateTimeText,
  dcfRequestBody,
  defaultAssumptionsFor,
  snapshotOf,
  downloadHistoricalPriceCsv,
  downloadQuarterlyStatementsCsv,
  downloadRawDatasetCsv,
  fromApiMetrics,
  mergeCompanies,
  mergeDcfSummary,
  metricBasisParams,
  moneyText,
  numberText,
  numberText2,
  pct,
  pct2,
  readSessionCache,
  selectedMetricValue,
  solveImpliedMarketReturn,
  streamCorporateDcfSummary,
  toApiMetrics,
  writeSessionCache,
} from "./corporateUtils";
import {
  buildRawDatasetRows,
  buildSimilarComparisonBarData,
  buildSimilarComparisonRows,
  buildSimilarComparisonScatterPeers,
  buildSimilarComparisonScatterSelected,
  buildWatchlistCoverage,
  sortComparisonRows,
} from "./corporateDerivedViews";

function CalculationModalLoadingOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)] p-4" role="status" aria-live="polite">
      <div className="w-full max-w-2xl border border-[var(--line)] bg-[var(--surface-raised)] p-5">
        <div className="type-label text-[var(--ink)]">Loading calculation detail</div>
        <div className="mt-4 h-28 animate-pulse bg-[var(--surface)]" />
      </div>
    </div>
  );
}

const CalculationDetailModal = dynamic(
  () => import("./components/CalculationDetailModal").then((mod) => mod.CalculationDetailModal),
  {
    loading: () => <CalculationModalLoadingOverlay />,
    ssr: false,
  },
);

/** The ticker a link names (`/corporate?ticker=MSFT`), upper-cased; undefined when there is none. */
function tickerFromAddress(): string | undefined {
  return new URLSearchParams(window.location.search).get("ticker")?.trim().toUpperCase() || undefined;
}

export default function CorporateAnalysisPage() {
  useDevMonitorPageLoad({ component: "corporate" });
  // Local UI state: selected ticker assumptions, search input, add-company form, and active modal.
  const queryClient = useQueryClient();
  const router = useRouter();
  const restoredInitialTicker = useRef(initialAssumptions.ticker);
  if (typeof window !== "undefined" && restoredInitialTicker.current === initialAssumptions.ticker) {
    const sessionTicker = tickerFromAddress() ?? readSessionCache<string>(ACTIVE_TICKER_SESSION_KEY)?.trim().toUpperCase();
    if (sessionTicker) {
      restoredInitialTicker.current = sessionTicker;
    }
  }
  const hydratingTickerRef = useRef<string | null>(restoredInitialTicker.current);
  const pendingMetricsPersistRef = useRef(false);
  const [assumptions, setAssumptions] = useState<CorporateAssumptions>(() => {
    if (typeof window === "undefined") return initialAssumptions;
    try {
      const initialTicker = tickerFromAddress() ?? (readSessionCache<string>(ACTIVE_TICKER_SESSION_KEY)?.trim().toUpperCase() || initialAssumptions.ticker);
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) return defaultAssumptionsFor(initialTicker);
      const byTicker = JSON.parse(stored) as Record<string, CorporateAssumptions>;
      return byTicker[initialTicker] ?? defaultAssumptionsFor(initialTicker);
    } catch {
      return defaultAssumptionsFor(initialAssumptions.ticker);
    }
  });
  const [activeCalculation, setActiveCalculation] = useState<CalculationDetailKey | null>(null);
  const [latestLoadedMetrics, setLatestLoadedMetrics] = useState<CorporateMetricsApi | null>(null);
  const [roicBasis, setRoicBasis] = useState<RoicBasis>("recent_average");
  const [roicYear, setRoicYear] = useState("2025");
  // Kept per tab. These five decide what the comparison computes, and retyping a custom
  // universe after stepping away to read a decision was the most repeated cost on this page.
  const [storedSortKey, setComparisonSortKey] = useTabState<ComparisonSortKey>(
    tabStateKey("corporate", "sortKey"), "implied_return_spread");
  // A key saved before metric v3 ("expected_return_spread") names a field that no longer
  // exists; sorting by it would compare undefined with undefined.
  const comparisonSortKey: ComparisonSortKey = isComparisonSortKey(storedSortKey) ? storedSortKey : "implied_return_spread";
  const [comparisonSortDirection, setComparisonSortDirection] = useTabState<"desc" | "asc">(
    tabStateKey("corporate", "sortDirection"), "desc");
  const [comparisonUniverse, setComparisonUniverse] = useTabState<ComparisonUniverse>(
    tabStateKey("corporate", "universe"), "watchlist_plus_benchmark");
  const [comparisonBenchmarkTicker, setComparisonBenchmarkTicker] = useTabState(
    tabStateKey("corporate", "benchmarkTicker"), DEFAULT_PORTFOLIO_BENCHMARK_TICKER);
  const [comparisonCustomTickersInput, setComparisonCustomTickersInput] = useTabState(
    tabStateKey("corporate", "customTickers"), "AAPL, MSFT");
  const [sourceDataRequestedTicker, setSourceDataRequestedTicker] = useState<string | null>(() => readSessionCache<CachedCalculation<string, CorporateMetricHistoryApi>>(METRIC_HISTORY_CACHE_KEY)?.snapshot ?? null);
  const [sourceDataRefreshToken, setSourceDataRefreshToken] = useState<string | null>(null);
  const [cachedMetricsHistory] = useState<CorporateMetricHistoryApi | null>(() => readSessionCache<CachedCalculation<string, CorporateMetricHistoryApi>>(METRIC_HISTORY_CACHE_KEY)?.result ?? null);
  const [cachedMetricsHistorySnapshot] = useState<string | null>(() => readSessionCache<CachedCalculation<string, CorporateMetricHistoryApi>>(METRIC_HISTORY_CACHE_KEY)?.snapshot ?? null);
  const [cachedQuarterlyStatements] = useState<QuarterlyStatementsApi | null>(() => readSessionCache<CachedCalculation<string, QuarterlyStatementsApi>>(QUARTERLY_STATEMENTS_CACHE_KEY)?.result ?? null);
  const [cachedQuarterlyStatementsSnapshot] = useState<string | null>(() => readSessionCache<CachedCalculation<string, QuarterlyStatementsApi>>(QUARTERLY_STATEMENTS_CACHE_KEY)?.snapshot ?? null);
  const [cachedHistoricalPrices] = useState<StockPriceRow[] | null>(() => readSessionCache<CachedCalculation<string, StockPriceRow[]>>(PRICE_HISTORY_CACHE_KEY)?.result ?? null);
  const [cachedHistoricalPricesSnapshot] = useState<string | null>(() => readSessionCache<CachedCalculation<string, StockPriceRow[]>>(PRICE_HISTORY_CACHE_KEY)?.snapshot ?? null);
  const [cachedSourceDataUpdatedAt] = useState<string | null>(() =>
    readSessionCache<CachedCalculation<string, CorporateMetricHistoryApi>>(METRIC_HISTORY_CACHE_KEY)?.lastUpdatedAt
    ?? readSessionCache<CachedCalculation<string, QuarterlyStatementsApi>>(QUARTERLY_STATEMENTS_CACHE_KEY)?.lastUpdatedAt
    ?? readSessionCache<CachedCalculation<string, StockPriceRow[]>>(PRICE_HISTORY_CACHE_KEY)?.lastUpdatedAt
    ?? null,
  );
  const [dcfRequestedSnapshot, setDcfRequestedSnapshot] = useState<DcfRequestSnapshot | null>(() => {
    const cached = readSessionCache<CachedCalculation<DcfRequestSnapshot, DCFResult>>(DCF_CACHE_KEY);
    return cached?.snapshot.ticker?.trim().toUpperCase() === restoredInitialTicker.current ? cached.snapshot : null;
  });
  const [dcfCachedCalculation] = useState<CachedCalculation<DcfRequestSnapshot, DCFResult> | null>(() =>
    readSessionCache<CachedCalculation<DcfRequestSnapshot, DCFResult>>(DCF_CACHE_KEY),
  );
  const [dcfRefreshToken, setDcfRefreshToken] = useState<string | null>(null);
  const [dcfStreamResult, setDcfStreamResult] = useState<DCFResult | null>(null);
  const [dcfFullReport, setDcfFullReport] = useState<DCFFullReport | null>(null);
  const [dcfStreamStatus, setDcfStreamStatus] = useState<"idle" | "streaming" | "complete" | "error">("idle");
  const [dcfFullReportLoading, setDcfFullReportLoading] = useState(false);
  const [dcfFullReportError, setDcfFullReportError] = useState<string | null>(null);
  const [dcfStreamError, setDcfStreamError] = useState<string | null>(null);
  // A DCF the model declined (e.g. non_positive_fcff): shown as content, never as an error.
  const [dcfRefusal, setDcfRefusalState] = useState<DcfRefusalError | null>(null);
  // Recording a refusal also drops the cached result, which may be a value computed under the
  // old $1B FCFF floor: hiding it only in memory brought it back on the next reload.
  const setDcfRefusal = (refusal: DcfRefusalError | null) => {
    setDcfRefusalState(refusal);
    if (refusal) {
      try {
        window.sessionStorage.removeItem(DCF_CACHE_KEY);
      } catch {
        // Session cache is optional; the in-memory refusal still supersedes it.
      }
    }
  };
  const [bulkDcfReports, setBulkDcfReports] = useState<DCFFullReport[]>([]);
  const [bulkDcfReportsLoading, setBulkDcfReportsLoading] = useState(false);
  const [bulkDcfReportsError, setBulkDcfReportsError] = useState<string | null>(null);
  const [bulkDcfReportsLastUpdatedAt, setBulkDcfReportsLastUpdatedAt] = useState<string | null>(null);
  // Tickers the batch could not value, with the reason. Surfaced rather than dropped: a
  // run that quietly returned 134 reports for 139 tickers would claim a completeness it
  // does not have.
  const [bulkDcfSkipped, setBulkDcfSkipped] = useState<{ ticker: string; reason: string }[]>([]);
  const [comparisonRequestedSnapshot, setComparisonRequestedSnapshot] = useState<ComparisonRequestSnapshot | null>(() => readSessionCache<CachedCalculation<ComparisonRequestSnapshot, CorporateComparisonApi>>(COMPARISON_CACHE_KEY)?.snapshot ?? null);
  const [comparisonCachedResult] = useState<CorporateComparisonApi | null>(() => readSessionCache<CachedCalculation<ComparisonRequestSnapshot, CorporateComparisonApi>>(COMPARISON_CACHE_KEY)?.result ?? null);
  const [comparisonLastUpdatedAt] = useState<string | null>(() => readSessionCache<CachedCalculation<ComparisonRequestSnapshot, CorporateComparisonApi>>(COMPARISON_CACHE_KEY)?.lastUpdatedAt ?? null);
  const [comparisonRefreshToken, setComparisonRefreshToken] = useState<string | null>(null);
  const debounced = useDebounce(assumptions, 250);
  const selectedMetricParams = useMemo(
    () => metricBasisParams(roicBasis, roicYear),
    [roicBasis, roicYear],
  );
  // The inputs on screen, not the debounced copy: a Refresh or a sensitivity run made within 250 ms of a
  // hydration, slider move or ticker switch must send what the reader sees (ERROR-LOG 2026-10-15).
  const activeDcfSnapshot = useMemo<DcfRequestSnapshot>(() => snapshotOf(assumptions), [assumptions]);
  const activeComparisonSnapshot = useMemo<ComparisonRequestSnapshot>(() => ({
    comparisonUniverse,
    comparisonBenchmarkTicker,
    comparisonCustomTickersInput,
  }), [comparisonBenchmarkTicker, comparisonCustomTickersInput, comparisonUniverse]);
  const sourceDataTicker = assumptions.ticker.trim().toUpperCase();
  const normalizeSourceTicker = (ticker: string | null | undefined) => ticker?.trim().toUpperCase() || null;

  // Company search data combines server-side saved companies with local presets.
  const companiesQuery = useQuery<CorporateCompany[]>({
    queryKey: ["corporate-companies"],
    queryFn: () => fetchApi<CorporateCompany[]>("/corporate/companies", {
      monitor: {
        operation: "frontend.query.corporate_companies",
        component: "corporate_page",
      },
    }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const watchlistQuery = useQuery<WatchlistHolding[]>({
    queryKey: ["corporate-watchlist-holdings"],
    queryFn: () => fetchApi<WatchlistHolding[]>("/portfolio/watchlist", {
      monitor: {
        operation: "frontend.query.corporate_watchlist",
        component: "corporate_page",
      },
    }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const companies = useMemo(() => mergeCompanies(companiesQuery.data), [companiesQuery.data]);
  const watchlistHoldings = watchlistQuery.data ?? EMPTY_WATCHLIST_HOLDINGS;
  const activeCompany = companyForTicker(assumptions.ticker, companies);

  // Hydrate and persist assumption state across backend storage and browser fallback storage.
  const metricsHistoryQuery = useQuery<CorporateMetricHistoryApi>({
    queryKey: ["corporate-metric-history", sourceDataRequestedTicker ?? "idle", sourceDataRefreshToken ?? "idle"],
    queryFn: ({ signal }) =>
      fetchApi<CorporateMetricHistoryApi>(`/corporate/metrics/${sourceDataRequestedTicker}/history`, {
        signal,
        monitor: {
          operation: "frontend.query.corporate_metric_history",
          component: "corporate_page",
          ticker: sourceDataRequestedTicker,
        },
      }),
    placeholderData: (previous) => previous,
    staleTime: 5 * 60_000,
    enabled: Boolean(sourceDataRequestedTicker && sourceDataRefreshToken),
  });

  const quarterlyStatementsQuery = useQuery<QuarterlyStatementsApi>({
    queryKey: ["corporate-quarterly-statements", sourceDataRequestedTicker ?? "idle", sourceDataRefreshToken ?? "idle"],
    queryFn: ({ signal }) =>
      fetchApi<QuarterlyStatementsApi>(`/corporate/metrics/${sourceDataRequestedTicker}/quarterly-statements`, {
        signal,
        monitor: {
          operation: "frontend.query.corporate_quarterly_statements",
          component: "corporate_page",
          ticker: sourceDataRequestedTicker,
        },
      }),
    placeholderData: (previous) => previous,
    staleTime: 5 * 60_000,
    enabled: Boolean(sourceDataRequestedTicker && sourceDataRefreshToken),
  });
  const metricAuditQuery = useQuery<CorporateMetricAudit>({
    queryKey: ["corporate-metric-audit", assumptions.ticker, roicBasis, roicYear],
    queryFn: ({ signal }) =>
      fetchApi<CorporateMetricAudit>(`/corporate/metrics/${assumptions.ticker}/audit`, {
        signal,
        params: {
          roic_basis: roicBasis,
          ...(roicBasis === "annual" ? { roic_year: Number(roicYear) } : {}),
        },
        monitor: {
          operation: "frontend.query.corporate_metric_audit",
          component: "corporate_page",
          ticker: assumptions.ticker,
        },
      }),
    staleTime: 5 * 60_000,
    enabled: Boolean(assumptions.ticker),
  });

  useEffect(() => {
    const ticker = assumptions.ticker;
    hydratingTickerRef.current = ticker;
    fetchApi<CorporateMetricsApi>(`/corporate/metrics/${ticker}`, { params: selectedMetricParams })
      .then((metrics) => {
        setLatestLoadedMetrics((current) => (
          hydratingTickerRef.current === ticker || current?.ticker?.trim().toUpperCase() === ticker ? metrics : current
        ));
        setAssumptions((current) => (current.ticker === ticker ? fromApiMetrics(metrics) : current));
      })
      .catch(() => {
        // Local storage remains the fallback when backend hydration is unavailable.
      })
      .finally(() => {
        if (hydratingTickerRef.current === ticker) {
          hydratingTickerRef.current = null;
        }
      });
  }, [assumptions.ticker, selectedMetricParams]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const byTicker = stored ? (JSON.parse(stored) as Record<string, CorporateAssumptions>) : {};
      byTicker[assumptions.ticker] = assumptions;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(byTicker));
    } catch {
      // Browser storage is optional; realtime calculations still work without it.
    }
  }, [assumptions]);

  useEffect(() => {
    writeSessionCache(ACTIVE_TICKER_SESSION_KEY, assumptions.ticker);
  }, [assumptions.ticker]);

  // The address ticker is read once above; dropping it keeps a reload from jumping back to it after the user switches company.
  useEffect(() => {
    if (tickerFromAddress()) router.replace("/corporate");
  }, [router]);

  useEffect(() => {
    if (hydratingTickerRef.current === debounced.ticker) return;
    if (!pendingMetricsPersistRef.current) return;
    pendingMetricsPersistRef.current = false;
    fetchApi<CorporateMetricsApi>(`/corporate/metrics/${debounced.ticker}`, {
      method: "PUT",
      body: JSON.stringify(toApiMetrics(debounced)),
    }).catch(() => {
      // Local storage preserves ticker state if the backend is temporarily unavailable.
    });
  }, [debounced]);

  const update = <K extends keyof CorporateAssumptions>(key: K, value: CorporateAssumptions[K]) => {
    pendingMetricsPersistRef.current = true;
    setAssumptions((current) => ({ ...current, [key]: value }));
  };

  const applyMetricHistorySelection = ({
    nextRoicBasis = roicBasis,
    nextRoicYear = roicYear,
  }: {
    nextRoicBasis?: RoicBasis;
    nextRoicYear?: string;
  }) => {
    const history = metricsHistoryData;
    if (!history || history.ticker !== assumptions.ticker) return;

    const roicValue = selectedMetricValue(
      nextRoicBasis,
      nextRoicYear,
      history.annual_roic,
      history.roic_recent_average,
      history.roic_all_year_average,
    );

    pendingMetricsPersistRef.current = true;
    setAssumptions((current) => {
      if (current.ticker !== history.ticker) return current;
      return {
        ...current,
        roic: roicValue == null ? current.roic : roicValue,
      };
    });
  };

  const selectTicker = (ticker: string) => {
    const normalizedTicker = ticker.trim().toUpperCase();
    setLatestLoadedMetrics(null);
    writeSessionCache(ACTIVE_TICKER_SESSION_KEY, normalizedTicker);
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const byTicker = stored ? (JSON.parse(stored) as Record<string, CorporateAssumptions>) : {};
      setAssumptions(byTicker[normalizedTicker] ?? defaultAssumptionsFor(normalizedTicker, companies));
    } catch {
      setAssumptions(defaultAssumptionsFor(normalizedTicker, companies));
    }
  };

  const selectTickerAndOpenCalculation = (ticker: string, key: CalculationDetailKey) => {
    selectTicker(ticker);
    setActiveCalculation(key);
  };

  const addCompany = async ({ ticker, name }: { ticker: string; name: string }) => {
    const saved = await fetchApi<CorporateCompany>("/corporate/companies", {
      method: "POST",
      body: JSON.stringify({ ticker, name, source: "manual" }),
    });
    queryClient.setQueryData<CorporateCompany[]>(["corporate-companies"], (current = []) => {
      const next = current.filter((company) => company.ticker.toUpperCase() !== saved.ticker.toUpperCase());
      return [...next, saved];
    });
    selectTicker(saved.ticker.toUpperCase());
  };

  // Market and valuation queries feed the implied ERP model and backend DCF card.
  const sp500Query = useQuery<StockPriceRow[]>({
    queryKey: ["corporate-market-index", "^GSPC", "5y"],
    queryFn: ({ signal }) =>
      fetchApi<StockPriceRow[]>("/market/index/%5EGSPC", {
        params: { period: "5y" },
        signal,
        monitor: {
          operation: "frontend.query.corporate_market_index",
          component: "corporate_page",
          ticker: "^GSPC",
        },
      }),
    placeholderData: (previous) => previous,
    staleTime: 5 * 60_000,
  });

  const impliedErpInputs = useMemo<ImpliedErpInputs>(() => ({
    indexLevel: sp500Query.data?.at(-1)?.close ?? IMPLIED_ERP_FALLBACK_INDEX_LEVEL,
    dividendYield: IMPLIED_ERP_DIVIDEND_YIELD,
    buybackYield: IMPLIED_ERP_BUYBACK_YIELD,
    growthRates: IMPLIED_ERP_FIVE_YEAR_GROWTH,
    stableGrowth: RISK_FREE_RATE,
    riskFreeRate: RISK_FREE_RATE,
  }), [sp500Query.data]);

  const impliedMarketReturn = useMemo(() => solveImpliedMarketReturn(impliedErpInputs), [impliedErpInputs]);
  const impliedErp = Math.max(impliedMarketReturn - RISK_FREE_RATE, 0);

  // Derived metrics are the frontend valuation layer used by cards, charts, and detail modals.
  const derived = useMemo(() => {
    const debtToEquity = assumptions.debtRatio / Math.max(100 - assumptions.debtRatio, 1);
    const leveredBeta = assumptions.unleveredBeta * (1 + (1 - TAX_RATE) * debtToEquity);
    const bottomUpKe = RISK_FREE_RATE + leveredBeta * impliedErp + KOREA_COUNTRY_RISK_PREMIUM;
    const spread = assumptions.roic - assumptions.wacc;
    const sustainableGrowth = (assumptions.reinvestment / 100) * assumptions.roic;

    return {
      debtToEquity,
      leveredBeta,
      bottomUpKe,
      spread,
      sustainableGrowth,
    };
  }, [assumptions, impliedErp]);

  const comparisonQuery = useQuery<CorporateComparisonApi>({
    queryKey: [
      "corporate-comparison",
      "live",
      comparisonRequestedSnapshot?.comparisonUniverse ?? "idle",
      comparisonRequestedSnapshot?.comparisonBenchmarkTicker ?? "idle",
      comparisonRequestedSnapshot?.comparisonCustomTickersInput ?? "idle",
      comparisonRefreshToken ?? "idle",
    ],
    queryFn: ({ signal }) =>
      fetchApi<CorporateComparisonApi>("/corporate/comparison", {
        signal,
        params: {
          mode: "live",
          comparison_universe: comparisonRequestedSnapshot?.comparisonUniverse ?? "watchlist_plus_benchmark",
          benchmark_ticker: comparisonRequestedSnapshot?.comparisonBenchmarkTicker ?? DEFAULT_PORTFOLIO_BENCHMARK_TICKER,
          custom_tickers: comparisonRequestedSnapshot?.comparisonCustomTickersInput ?? "",
        },
        monitor: {
          operation: "frontend.query.corporate_comparison",
          component: "corporate_page",
          ticker: assumptions.ticker,
        },
      }),
    placeholderData: (previous) => previous,
    staleTime: 60_000,
    enabled: Boolean(comparisonRequestedSnapshot && comparisonRefreshToken),
  });
  const historicalPricesQuery = useQuery<StockPriceRow[]>({
    queryKey: ["corporate-ohlcv", sourceDataRequestedTicker ?? "idle", "5y", sourceDataRefreshToken ?? "idle"],
    queryFn: ({ signal }) =>
      fetchApi<StockPriceRow[]>(`/detail/${sourceDataRequestedTicker}/ohlcv`, {
        params: { period: "5y" },
        signal,
        monitor: {
          operation: "frontend.query.corporate_historical_prices",
          component: "corporate_page",
          ticker: sourceDataRequestedTicker,
        },
      }),
    placeholderData: (previous) => previous,
    staleTime: 5 * 60_000,
    enabled: Boolean(sourceDataRequestedTicker && sourceDataRefreshToken),
  });
  const dcfCachedForTicker = dcfCachedCalculation?.snapshot.ticker?.trim().toUpperCase() === sourceDataTicker
    ? dcfCachedCalculation
    : null;
  // A DCF belongs to one ticker: the stream result survives a ticker switch, so only one for the current ticker is used.
  const dcfStreamForTicker = normalizeSourceTicker(dcfStreamResult?.ticker) === sourceDataTicker ? dcfStreamResult : null;
  const dcfFullReportForTicker = normalizeSourceTicker(dcfFullReport?.summary.ticker) === sourceDataTicker ? dcfFullReport : null;
  // A refusal supersedes any cached value, including one computed under the old FCFF floor.
  const dcfDisplayData = dcfRefusal ? null : dcfStreamForTicker ?? dcfCachedForTicker?.result ?? null;
  const comparisonDisplayData = comparisonQuery.data ?? comparisonCachedResult;
  const rawMetricsHistoryData = metricsHistoryQuery.data ?? cachedMetricsHistory;
  const rawQuarterlyStatementsData = quarterlyStatementsQuery.data ?? cachedQuarterlyStatements;
  const rawHistoricalPricesData = historicalPricesQuery.data ?? cachedHistoricalPrices ?? [];
  const metricsHistorySnapshot = normalizeSourceTicker(metricsHistoryQuery.data ? sourceDataRequestedTicker : cachedMetricsHistorySnapshot);
  const quarterlyStatementsSnapshot = normalizeSourceTicker(quarterlyStatementsQuery.data ? sourceDataRequestedTicker : cachedQuarterlyStatementsSnapshot);
  const historicalPricesSnapshot = normalizeSourceTicker(historicalPricesQuery.data ? sourceDataRequestedTicker : cachedHistoricalPricesSnapshot);
  const metricsHistoryData = metricsHistorySnapshot === sourceDataTicker ? rawMetricsHistoryData : null;
  const quarterlyStatementsData = quarterlyStatementsSnapshot === sourceDataTicker ? rawQuarterlyStatementsData : null;
  const historicalPricesData = historicalPricesSnapshot === sourceDataTicker ? rawHistoricalPricesData : [];
  const dcfData = dcfDisplayData;
  const comparisonData = comparisonDisplayData;
  const activeMetricsMeta = latestLoadedMetrics?.ticker?.trim().toUpperCase() === assumptions.ticker.trim().toUpperCase()
    ? latestLoadedMetrics
    : null;
  const growthMeta = activeMetricsMeta?.growth_meta ?? null;
  const roicMeta = activeMetricsMeta?.roic_meta ?? null;
  const dcfDisplayLastUpdatedAt = dcfStreamForTicker?.generated_at ?? dcfCachedForTicker?.lastUpdatedAt ?? null;
  const comparisonDisplayLastUpdatedAt = comparisonQuery.data ? new Date(comparisonQuery.dataUpdatedAt).toISOString() : comparisonLastUpdatedAt;
  const sourceDataDisplayLastUpdatedAt = metricsHistoryQuery.data
    ? new Date(metricsHistoryQuery.dataUpdatedAt).toISOString()
    : quarterlyStatementsQuery.data
      ? new Date(quarterlyStatementsQuery.dataUpdatedAt).toISOString()
      : historicalPricesQuery.data
        ? new Date(historicalPricesQuery.dataUpdatedAt).toISOString()
        : cachedSourceDataUpdatedAt;
  const dcfIsStale = Boolean(
    dcfDisplayData
    && dcfRequestedSnapshot
    && JSON.stringify(dcfRequestedSnapshot) !== JSON.stringify(activeDcfSnapshot),
  );
  const comparisonIsStale = Boolean(
    comparisonDisplayData
    && comparisonRequestedSnapshot
    && JSON.stringify(comparisonRequestedSnapshot) !== JSON.stringify(activeComparisonSnapshot),
  );
  const staleSourceDataTickers = [
    rawMetricsHistoryData && metricsHistorySnapshot !== sourceDataTicker ? metricsHistorySnapshot : null,
    rawQuarterlyStatementsData && quarterlyStatementsSnapshot !== sourceDataTicker ? quarterlyStatementsSnapshot : null,
    rawHistoricalPricesData.length > 0 && historicalPricesSnapshot !== sourceDataTicker ? historicalPricesSnapshot : null,
  ].filter((ticker): ticker is string => Boolean(ticker));
  const staleSourceTickers = Array.from(new Set(staleSourceDataTickers));

  useEffect(() => {
    if (!dcfRequestedSnapshot || !dcfRefreshToken) return;

    const abortController = new AbortController();
    let streamedSummary: DCFResult | null = null;
    let streamedAssumptions: DCFAssumptionSummary | null = null;
    setDcfStreamStatus("streaming");
    setDcfStreamError(null);
    setDcfRefusal(null);
    setDcfFullReport(null);

    void streamCorporateDcfSummary(dcfRequestedSnapshot, abortController.signal, (payload) => {
      const phase = payload.phase;
      if (phase === "phase1" && payload.summary && typeof payload.summary === "object") {
        streamedSummary = payload.summary as DCFResult;
        setDcfStreamResult(mergeDcfSummary(streamedSummary, streamedAssumptions));
        return;
      }
      if (phase === "phase2" && payload.assumptions && typeof payload.assumptions === "object") {
        streamedAssumptions = payload.assumptions as DCFAssumptionSummary;
        if (streamedSummary) {
          const merged = mergeDcfSummary(streamedSummary, streamedAssumptions);
          setDcfStreamResult(merged);
          writeSessionCache(DCF_CACHE_KEY, {
            snapshot: dcfRequestedSnapshot,
            result: merged,
            lastUpdatedAt: merged.generated_at,
          } satisfies CachedCalculation<DcfRequestSnapshot, DCFResult>);
        }
        return;
      }
      if (phase === "complete") {
        setDcfStreamStatus("complete");
      }
    }).catch((error: unknown) => {
      if (abortController.signal.aborted) return;
      if (error instanceof DcfRefusalError) {
        setDcfRefusal(error);
        setDcfStreamResult(null);
        setDcfStreamStatus("complete");
        return;
      }
      setDcfStreamStatus("error");
      setDcfStreamError(error instanceof Error ? error.message : "DCF summary stream failed.");
    }).finally(() => {
      if (!abortController.signal.aborted) {
        setDcfStreamStatus((current) => (current === "streaming" ? "complete" : current));
      }
    });

    return () => abortController.abort();
  }, [dcfRefreshToken, dcfRequestedSnapshot]);

  useEffect(() => {
    if (!comparisonQuery.data || !comparisonRequestedSnapshot) return;
    const lastUpdatedAt = new Date(comparisonQuery.dataUpdatedAt).toISOString();
    const cacheValue: CachedCalculation<ComparisonRequestSnapshot, CorporateComparisonApi> = {
      snapshot: comparisonRequestedSnapshot,
      result: comparisonQuery.data,
      lastUpdatedAt,
    };
    writeSessionCache(COMPARISON_CACHE_KEY, cacheValue);
  }, [comparisonQuery.data, comparisonQuery.dataUpdatedAt, comparisonRequestedSnapshot]);

  useEffect(() => {
    if (!metricsHistoryQuery.data || !sourceDataRequestedTicker) return;
    writeSessionCache(METRIC_HISTORY_CACHE_KEY, {
      snapshot: sourceDataRequestedTicker,
      result: metricsHistoryQuery.data,
      lastUpdatedAt: new Date(metricsHistoryQuery.dataUpdatedAt).toISOString(),
    } satisfies CachedCalculation<string, CorporateMetricHistoryApi>);
  }, [metricsHistoryQuery.data, metricsHistoryQuery.dataUpdatedAt, sourceDataRequestedTicker]);

  useEffect(() => {
    if (!quarterlyStatementsQuery.data || !sourceDataRequestedTicker) return;
    writeSessionCache(QUARTERLY_STATEMENTS_CACHE_KEY, {
      snapshot: sourceDataRequestedTicker,
      result: quarterlyStatementsQuery.data,
      lastUpdatedAt: new Date(quarterlyStatementsQuery.dataUpdatedAt).toISOString(),
    } satisfies CachedCalculation<string, QuarterlyStatementsApi>);
  }, [quarterlyStatementsQuery.data, quarterlyStatementsQuery.dataUpdatedAt, sourceDataRequestedTicker]);

  useEffect(() => {
    if (!historicalPricesQuery.data || !sourceDataRequestedTicker) return;
    writeSessionCache(PRICE_HISTORY_CACHE_KEY, {
      snapshot: sourceDataRequestedTicker,
      result: historicalPricesQuery.data,
      lastUpdatedAt: new Date(historicalPricesQuery.dataUpdatedAt).toISOString(),
    } satisfies CachedCalculation<string, StockPriceRow[]>);
  }, [historicalPricesQuery.data, historicalPricesQuery.dataUpdatedAt, sourceDataRequestedTicker]);

  const handleRefreshDcf = () => {
    setDcfRequestedSnapshot(snapshotOf(assumptions));
    setDcfRefreshToken(`${Date.now()}`);
  };

  const loadFullDcfReport = async () => {
    // The report is for the ticker on screen; a DCF requested for an earlier ticker is not reused.
    const snapshot = dcfRequestedSnapshot && normalizeSourceTicker(dcfRequestedSnapshot.ticker) === sourceDataTicker ? dcfRequestedSnapshot : activeDcfSnapshot;
    setDcfFullReportLoading(true);
    setDcfFullReportError(null);
    try {
      // postDcf, not fetchApi: a 422 refusal must reach the page as content with its code.
      const report = await postDcf<DCFFullReport>(`/corporate/dcf/${snapshot.ticker}/report`, dcfRequestBody(snapshot));
      setDcfFullReport(report);
    } catch (error) {
      if (error instanceof DcfRefusalError) {
        setDcfRefusal(error);
        setDcfStreamResult(null);
        return;
      }
      setDcfFullReportError(error instanceof Error ? error.message : "Failed to load the full DCF report.");
    } finally {
      setDcfFullReportLoading(false);
    }
  };

  const handleCalculateAllDcfReports = async () => {
    const tickers = Array.from(new Set((comparisonData?.rows ?? [])
      .filter((row) => row.group_name !== "benchmark")
      .map((row) => row.ticker)));
    if (tickers.length === 0) {
      setBulkDcfReports([]);
      setBulkDcfReportsLastUpdatedAt(null);
      setBulkDcfReportsError("Refresh comparison first so there are non-benchmark stocks to calculate.");
      return;
    }

    setBulkDcfReportsLoading(true);
    setBulkDcfReportsError(null);
    setBulkDcfSkipped([]);
    try {
      const batch = await fetchApi<{
        reports: DCFFullReport[];
        skipped: { ticker: string; reason: string }[];
      }>("/corporate/dcf/reports/bulk", {
        method: "POST",
        body: JSON.stringify({ tickers } satisfies CorporateDcfBatchRequest),
      });
      setBulkDcfReports(batch.reports ?? []);
      setBulkDcfSkipped(batch.skipped ?? []);
      setBulkDcfReportsLastUpdatedAt(new Date().toISOString());
    } catch (error) {
      setBulkDcfReportsError(error instanceof Error ? error.message : "Failed to calculate reports for the current comparison universe.");
    } finally {
      setBulkDcfReportsLoading(false);
    }
  };

  const handleRefreshComparison = () => {
    setComparisonRequestedSnapshot(activeComparisonSnapshot);
    setComparisonRefreshToken(`${Date.now()}`);
  };

  const handleRefreshSourceData = () => {
    setSourceDataRequestedTicker(sourceDataTicker);
    setSourceDataRefreshToken(`${Date.now()}`);
  };

  const sortedComparisonRows = useMemo(
    () => sortComparisonRows(comparisonDisplayData?.rows, comparisonSortKey, comparisonSortDirection),
    [comparisonDisplayData?.rows, comparisonSortDirection, comparisonSortKey],
  );
  const nonBenchmarkComparisonRows = useMemo(
    () => sortedComparisonRows.filter((row) => row.group_name !== "benchmark"),
    [sortedComparisonRows],
  );
  const selectedComparisonRow = useMemo(
    () => nonBenchmarkComparisonRows.find((row) => row.ticker === assumptions.ticker) ?? nonBenchmarkComparisonRows[0] ?? null,
    [assumptions.ticker, nonBenchmarkComparisonRows],
  );
  const selectedComparisonSector = (selectedComparisonRow?.sector ?? activeCompany.sector ?? "").trim();
  const similarComparisonRows = useMemo(
    () => buildSimilarComparisonRows({
      rows: nonBenchmarkComparisonRows,
      selectedTicker: selectedComparisonRow?.ticker ?? "",
      selectedSector: selectedComparisonSector,
    }),
    [nonBenchmarkComparisonRows, selectedComparisonRow?.ticker, selectedComparisonSector],
  );
  const similarComparisonBarData = useMemo(
    () => buildSimilarComparisonBarData(similarComparisonRows, selectedComparisonRow?.ticker ?? ""),
    [selectedComparisonRow?.ticker, similarComparisonRows],
  );
  const similarComparisonScatterPeers = useMemo(
    () => buildSimilarComparisonScatterPeers(similarComparisonRows, selectedComparisonRow?.ticker ?? ""),
    [selectedComparisonRow?.ticker, similarComparisonRows],
  );
  const similarComparisonScatterSelected = useMemo(
    () => buildSimilarComparisonScatterSelected(selectedComparisonRow),
    [selectedComparisonRow],
  );
  const watchlistCoverage = useMemo(
    () => buildWatchlistCoverage(watchlistHoldings, companies),
    [companies, watchlistHoldings],
  );
  const bulkDcfReportUniverseKey = useMemo(
    () => nonBenchmarkComparisonRows.map((row) => row.ticker).join(","),
    [nonBenchmarkComparisonRows],
  );

  useEffect(() => {
    setBulkDcfReports([]);
    setBulkDcfReportsError(null);
    setBulkDcfReportsLastUpdatedAt(null);
  }, [bulkDcfReportUniverseKey]);

  // Chart datasets keep each visualization declarative and reuse the same derived model.
  const hurdleBars = [
    { name: "Risk-free", value: RISK_FREE_RATE, fill: "var(--chart-4)" },
    { name: "Beta x Implied ERP", value: derived.leveredBeta * impliedErp, fill: "var(--chart-1)" },
    { name: "CRP", value: KOREA_COUNTRY_RISK_PREMIUM, fill: "var(--ink)" },
  ];

  const regionalHurdle = [
    { region: "US", rf: RISK_FREE_RATE, erp: impliedErp, defaultSpread: 0.0, riskMultiplier: 0.0, crp: 0.0, revenue: 46 },
    { region: "EU", rf: RISK_FREE_RATE + 0.2, erp: impliedErp + 0.4, defaultSpread: 0.3, riskMultiplier: 1.0, crp: 0.3, revenue: 22 },
    { region: "Korea", rf: RISK_FREE_RATE + 0.4, erp: impliedErp + 1.2, defaultSpread: KOREA_COUNTRY_RISK_PREMIUM, riskMultiplier: 1.0, crp: KOREA_COUNTRY_RISK_PREMIUM, revenue: 12 },
    { region: "Emerging", rf: RISK_FREE_RATE + 0.9, erp: impliedErp + 2.1, defaultSpread: KOREA_COUNTRY_RISK_PREMIUM, riskMultiplier: 1.35, crp: Number((KOREA_COUNTRY_RISK_PREMIUM * 1.35).toFixed(1)), revenue: 20 },
  ];

  const betaTreemapProxy = [
    { name: "Industry", beta: Number(assumptions.unleveredBeta.toFixed(1)), size: 42 },
    { name: "Operating", beta: Number(clamp(0.75 + assumptions.reinvestment / 100, 0.6, 1.8).toFixed(1)), size: 28 },
    { name: "Financial", beta: Number(derived.leveredBeta.toFixed(2)), size: 30 },
  ];

  const waccCurve = Array.from({ length: 10 }, (_, idx) => {
    const debt = idx * 10;
    const curve = assumptions.wacc - 2.4 * (debt / 45) + 3.2 * Math.pow(debt / 70, 2);
    return { debt, wacc: Number(curve.toFixed(1)) };
  });

  const companyName = activeCompany.name;

  const valueMatrix = [
    {
      name: companyName,
      growth: assumptions.growth,
      spread: derived.spread,
      efficiency: clamp(assumptions.fcff / 1.6, 10, 100),
      fcff: assumptions.fcff,
    },
    { name: "Peer A", growth: 4.2, spread: 3.4, efficiency: 56, fcff: 70 },
    { name: "Peer B", growth: 8.5, spread: -1.8, efficiency: 44, fcff: 42 },
    { name: "Peer C", growth: 2.1, spread: 7.2, efficiency: 68, fcff: 60 },
  ];

  // Downloadable raw dataset mirrors the assumptions, derived metrics, and chart inputs.
  const rawDatasetRows: RawDatasetRow[] = buildRawDatasetRows({
    assumptions,
    derived,
    impliedMarketReturn,
    impliedErp,
    impliedErpInputs,
    dcfData,
    regionalHurdle,
    hurdleBars,
    betaTreemapProxy,
    waccCurve,
    valueMatrix,
  });

  const annualGrowthRates = annualMetricRows(metricsHistoryData?.annual_growth_rates ?? []);
  const annualRoicValues = annualMetricRows(metricsHistoryData?.annual_roic ?? []);
  const selectedRoicYearValue = annualRoicValues.find((point) => String(point.year) === roicYear)?.value;
  const roicYearUnavailableMessage = roicBasis === "annual" && selectedRoicYearValue == null
    ? `${roicYear} ROIC unavailable from Yahoo statements. Retaining the current/manual ROIC value.`
    : "";
  const growthBasisLabel = growthMeta?.metric_role === "fallback"
    ? "stable CAGR unavailable; fallback assumption in use"
    : "stable CAGR";
  const roicBasisLabel = roicBasis === "recent_average"
    ? "recent multi-year average"
    : roicBasis === "all_year_average"
      ? "all available years average"
      : `annual ${roicYear || annualRoicValues.at(-1)?.year || ""}`.trim();

  const sourceLabel = [
    growthMeta?.metric_role === "fallback"
      ? "Growth is currently using a fallback assumption because stable CAGR was unavailable."
      : "Growth is using the stable CAGR derived from Yahoo annual revenue where available.",
    roicMeta?.metric_role === "fallback"
      ? "ROIC is currently using a fallback assumption because the stable invested-capital pipeline was not decision-grade."
      : "ROIC is using the stabilized NOPAT / average invested-capital pipeline.",
    "Current slider/browser values and saved presets remain manual override layers.",
  ].join(" ");

  const calculationDetails = buildCalculationDetails({
    companyName,
    assumptions,
    derived,
    dcfData: dcfData ?? undefined,
    sourceLabel,
    storageKey: STORAGE_KEY,
    taxRate: TAX_RATE,
    riskFreeRate: RISK_FREE_RATE,
    koreaCountryRiskPremium: KOREA_COUNTRY_RISK_PREMIUM,
    growthBasisLabel,
    roicBasisLabel,
    annualGrowthRates,
    annualRoicValues,
    metricsHistoryData: metricsHistoryData ?? undefined,
    impliedErpInputs,
    impliedMarketReturn,
    impliedErp,
    hasSp500Data: Boolean(sp500Query.data),
    regionalHurdle,
    betaTreemapProxy,
    waccCurve,
    valueMatrix,
  });

  const activeCalculationDetail = activeCalculation ? calculationDetails[activeCalculation] : null;
  // A stale DCF's formula would mix the DCF's values with the inputs now on screen, so it is not shown.
  const dcfFormulaIsStale = dcfIsStale && (activeCalculation === "backendDcf" || activeCalculation === "backendFairValue");
  const activeSubstitutedFormula = activeCalculation && !dcfFormulaIsStale
    ? substitutedFormula(activeCalculation, buildFormulaContext({ assumptions, derived, impliedErp, impliedMarketReturn, waccAudit: metricAuditQuery.data?.wacc ?? null, dcfData }))
    : null;
  // The full report needs a DCF result to be on screen, and a refusal blocks it.
  const canLoadFullReport = dcfRefusal === null && !(!dcfData && dcfStreamStatus === "idle");
  const verdict = verdictView(dcfData, dcfStreamStatus === "streaming", dcfRefusal?.readerText ?? null); // block + strip, spec §2A

  return (
    <div className="mx-auto flex h-[calc(100dvh_-_var(--main-pad-top,0px)_-_var(--main-pad-bottom,0px))] max-w-7xl flex-col">
      <CorporateHeader
        companies={companies}
        selectedTicker={assumptions.ticker}
        onSelectTicker={selectTicker}
        onAddCompany={addCompany}
        companyName={companyName}
        sector={activeCompany.sector ?? null}
        priceText={dcfData ? moneyText(dcfData.current_price) : null}
        dcfUpdatedText={dcfDisplayLastUpdatedAt ? dateTimeText(dcfDisplayLastUpdatedAt) : null}
        dcfStreaming={dcfStreamStatus === "streaming"}
        dcfIsStale={dcfIsStale}
        dcfStreamError={dcfStreamError}
        onRefreshDcf={handleRefreshDcf}
        verdictStrip={<VerdictStrip view={verdict} onOpenDetail={() => setActiveCalculation("backendDcf")} staleSource={staleSourceTickers.length > 0 ? { cached: staleSourceTickers.join(", "), ticker: sourceDataTicker } : null} />}
      />

      <CorporatePageTabs
        panels={{
          // Summary (spec §2A): verdict and KPIs on the left 2/3, the assumption table on the right 1/3.
          summary: (
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="flex min-w-0 flex-col gap-3 lg:col-span-2">
                <VerdictBlock view={verdict} onOpenDetail={() => setActiveCalculation("backendDcf")} />
                <KpiRow
                  spread={derived.spread}
                  bottomUpKe={derived.bottomUpKe}
                  wacc={assumptions.wacc}
                  leveredBeta={derived.leveredBeta}
                  onOpenDetail={setActiveCalculation}
                />
              </div>
              <AssumptionTable
                assumptions={assumptions}
                onChange={update}
                onOpenDetail={setActiveCalculation}
                growthMeta={growthMeta}
                roicMeta={roicMeta}
                roicAudit={metricAuditQuery.data?.roic ?? null}
                waccAudit={metricAuditQuery.data?.wacc ?? null}
                sourceTicker={sourceDataTicker}
                sourceUpdatedAt={sourceDataDisplayLastUpdatedAt}
                staleSourceTickers={staleSourceTickers}
                sourceIsFetching={metricsHistoryQuery.isFetching || quarterlyStatementsQuery.isFetching || historicalPricesQuery.isFetching}
                hasSourceData={Boolean(metricsHistoryData) || Boolean(quarterlyStatementsData) || historicalPricesData.length > 0}
                roicYearUnavailableMessage={roicYearUnavailableMessage}
                onRefreshSourceData={handleRefreshSourceData}
                roicBasis={roicBasis}
                roicYear={roicYear}
                annualRoicValues={annualRoicValues}
                onRoicBasisChange={(next) => {
                  setRoicBasis(next);
                  applyMetricHistorySelection({ nextRoicBasis: next, nextRoicYear: roicYear });
                }}
                onRoicYearChange={(next) => {
                  setRoicYear(next);
                  applyMetricHistorySelection({ nextRoicYear: next });
                }}
                growthBasisLabel={growthBasisLabel}
              />
            </section>
          ),
          diagnostics: (
            <CorporateDiagnosticsSection
              companyName={companyName}
              hurdleBars={hurdleBars}
              regionalHurdle={regionalHurdle}
              assumptionsDebtRatio={assumptions.debtRatio}
              betaTreemapProxy={betaTreemapProxy}
              waccCurve={waccCurve}
              valueMatrix={valueMatrix}
              onOpenDetail={setActiveCalculation}
            />
          ),
          dcf: (
            <DcfTab
              sustainableGrowth={derived.sustainableGrowth}
              fcff={assumptions.fcff}
              dcfResult={dcfData ?? undefined}
              onOpenDetail={setActiveCalculation}
              report={dcfFullReportForTicker}
              reportLoading={dcfFullReportLoading}
              reportError={dcfFullReportError}
              canLoadReport={canLoadFullReport}
              onLoadReport={() => void loadFullDcfReport()}
            />
          ),
          comparison: (
            <TargetStockComparisonSection
              comparisonData={comparisonData}
              comparisonDisplayLastUpdatedAt={comparisonDisplayLastUpdatedAt}
              comparisonIsStale={comparisonIsStale}
              comparisonUniverse={comparisonUniverse}
              comparisonBenchmarkTicker={comparisonBenchmarkTicker}
              comparisonBenchmarkOptions={PORTFOLIO_BENCHMARK_PRESETS}
              comparisonCustomTickersInput={comparisonCustomTickersInput}
              comparisonSortKey={comparisonSortKey}
              comparisonSortDirection={comparisonSortDirection}
              onComparisonUniverseChange={setComparisonUniverse}
              onComparisonBenchmarkTickerChange={setComparisonBenchmarkTicker}
              onComparisonCustomTickersInputChange={setComparisonCustomTickersInput}
              onComparisonSortKeyChange={setComparisonSortKey}
              onComparisonSortDirectionChange={setComparisonSortDirection}
              onRefreshComparison={handleRefreshComparison}
              onVerifyWatchlistSync={() => {
                void companiesQuery.refetch();
                void watchlistQuery.refetch();
              }}
              onOpenPortfolio={() => router.push("/portfolio")}
              watchlistCoverage={watchlistCoverage}
              watchlistSyncLoading={watchlistQuery.isFetching || companiesQuery.isFetching}
              comparisonIsLoading={comparisonQuery.isLoading}
              comparisonIsFetching={comparisonQuery.isFetching}
              comparisonIsError={comparisonQuery.isError}
              sortedComparisonRows={sortedComparisonRows}
              selectedComparisonTicker={selectedComparisonRow?.ticker ?? ""}
              selectedComparisonSector={selectedComparisonSector}
              similarComparisonBarData={similarComparisonBarData}
              similarComparisonScatterPeers={similarComparisonScatterPeers}
              similarComparisonScatterSelected={similarComparisonScatterSelected}
              currentTicker={assumptions.ticker}
              onSelectTicker={selectTicker}
              onOpenCalculationForTicker={selectTickerAndOpenCalculation}
              bulkDcfReportsLoading={bulkDcfReportsLoading}
              bulkDcfReportsError={bulkDcfReportsError}
              bulkDcfReports={bulkDcfReports}
              bulkDcfReportsLastUpdatedAt={bulkDcfReportsLastUpdatedAt}
              bulkDcfSkipped={bulkDcfSkipped}
              onCalculateAllDcfReports={() => void handleCalculateAllDcfReports()}
              formatPct2={pct2}
              formatMoney={moneyText}
              formatDateTime={dateTimeText}
            />
          ),
        }}
      />
      {/* Calculation detail modal is mounted only when a metric or chart title is selected. */}
      {activeCalculation && activeCalculationDetail && (
        <CalculationDetailModal
          detail={activeCalculationDetail}
          detailKey={activeCalculation}
          substitutedFormula={activeSubstitutedFormula}
          sliderWacc={assumptions.wacc}
          dcfStatus={dcfData?.status ?? null}
          dcfGeneratedAt={dcfData?.generated_at ?? null}
          dcfSnapshot={activeDcfSnapshot}
          baseDcf={dcfData && !dcfIsStale ? { intrinsic: bridgedEstimatedValue(dcfData), upside: bridgedUpsidePct(dcfData) } : null}
          ticker={assumptions.ticker}
          metricAudit={metricAuditQuery.data ?? null}
          metricAuditIsLoading={metricAuditQuery.isLoading}
          metricAuditIsError={metricAuditQuery.isError}
          history={metricsHistoryData}
          historyIsFetching={metricsHistoryQuery.isFetching}
          historyIsError={metricsHistoryQuery.isError}
          onLoadHistory={handleRefreshSourceData}
          comparisonRows={comparisonData?.rows ?? null}
          comparisonIsStale={comparisonIsStale}
          rawDatasetRows={rawDatasetRows}
          historicalPrices={historicalPricesData}
          historicalStatus={historicalPriceStatus(historicalPricesQuery, historicalPricesData.length)}
          historicalIsLoading={historicalPricesQuery.isLoading && historicalPricesData.length === 0}
          historicalIsError={historicalPricesQuery.isError && historicalPricesData.length === 0}
          quarterlyStatementRows={quarterlyStatementsData?.rows ?? []}
          quarterlyStatementStatus={quarterlyStatementsStatus(quarterlyStatementsQuery, quarterlyStatementsData)}
          quarterlyStatementsIsLoading={quarterlyStatementsQuery.isLoading && !quarterlyStatementsData}
          quarterlyStatementsIsError={quarterlyStatementsQuery.isError && !quarterlyStatementsData}
          dcfFullReport={dcfFullReportForTicker}
          dcfFullReportStatus={
            dcfFullReportLoading
              ? "Loading full DCF report..."
              : dcfFullReportError
                ? dcfFullReportError
              : dcfFullReportForTicker
                ? `Full report loaded for ${dcfFullReportForTicker.summary.ticker} (${dcfFullReportForTicker.summary.report_id}).`
                : "Full report not loaded yet."
          }
          dcfFullReportIsLoading={dcfFullReportLoading}
          dcfFullReportIsError={Boolean(dcfFullReportError)}
          onRequestDcfFullReport={() => void loadFullDcfReport()}
          onDownloadRawDatasetCsv={() => downloadRawDatasetCsv(assumptions.ticker, rawDatasetRows)}
          onDownloadHistoricalPriceCsv={() => downloadHistoricalPriceCsv(assumptions.ticker, historicalPricesData)}
          onDownloadQuarterlyStatementsCsv={() => downloadQuarterlyStatementsCsv(assumptions.ticker, quarterlyStatementsData?.rows ?? [])}
          onPrint={() => window.print()}
          formatNumber={numberText}
          formatNumber2={numberText2}
          formatPct={pct}
          onClose={() => setActiveCalculation(null)}
        />
      )}
    </div>
  );
}
