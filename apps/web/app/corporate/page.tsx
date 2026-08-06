"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { bridgedEstimatedValue, UNBRIDGED_PLACEHOLDER, UNBRIDGED_REASON } from "@/lib/bridgeQuality";
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
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { PageHeader } from "@/components/ui/PageHeader";
import {
} from "./components/CorporateGraphs";
import { CorporateDiagnosticsSection } from "./components/CorporateDiagnosticsSection";
import { TargetStockComparisonSection } from "./components/TargetStockComparisonSection";
import { CorporateAssumptionsPanel } from "./components/CorporateAssumptionsPanel";
import { buildCalculationDetails } from "./buildCalculationDetails";
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
import {
  annualMetricRows,
  clamp,
  companyForTicker,
  comparisonUniverseLabel,
  dateTimeText,
  dcfRequestBody,
  defaultAssumptionsFor,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="status" aria-live="polite">
      <div className="w-full max-w-2xl rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5 shadow-2xl">
        <div className="text-sm font-semibold text-[var(--text-primary)]">Loading calculation detail</div>
        <div className="mt-4 h-28 animate-pulse rounded bg-[var(--surface-muted)]" />
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

export default function CorporateAnalysisPage() {
  useDevMonitorPageLoad({ component: "corporate" });
  // Local UI state: selected ticker assumptions, search input, add-company form, and active modal.
  const queryClient = useQueryClient();
  const router = useRouter();
  const restoredInitialTicker = useRef(initialAssumptions.ticker);
  if (typeof window !== "undefined" && restoredInitialTicker.current === initialAssumptions.ticker) {
    const sessionTicker = readSessionCache<string>(ACTIVE_TICKER_SESSION_KEY)?.trim().toUpperCase();
    if (sessionTicker) {
      restoredInitialTicker.current = sessionTicker;
    }
  }
  const hydratingTickerRef = useRef<string | null>(restoredInitialTicker.current);
  const pendingMetricsPersistRef = useRef(false);
  const [assumptions, setAssumptions] = useState<CorporateAssumptions>(() => {
    if (typeof window === "undefined") return initialAssumptions;
    try {
      const initialTicker = readSessionCache<string>(ACTIVE_TICKER_SESSION_KEY)?.trim().toUpperCase() || initialAssumptions.ticker;
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) return defaultAssumptionsFor(initialTicker);
      const byTicker = JSON.parse(stored) as Record<string, CorporateAssumptions>;
      return byTicker[initialTicker] ?? defaultAssumptionsFor(initialTicker);
    } catch {
      return defaultAssumptionsFor(initialAssumptions.ticker);
    }
  });
  const [companySearch, setCompanySearch] = useState("");
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanySymbol, setNewCompanySymbol] = useState("");
  const [activeCalculation, setActiveCalculation] = useState<CalculationDetailKey | null>(null);
  const [latestLoadedMetrics, setLatestLoadedMetrics] = useState<CorporateMetricsApi | null>(null);
  const [roicBasis, setRoicBasis] = useState<RoicBasis>("recent_average");
  const [roicYear, setRoicYear] = useState("2025");
  const [comparisonSortKey, setComparisonSortKey] = useState<ComparisonSortKey>("expected_return_spread");
  const [comparisonSortDirection, setComparisonSortDirection] = useState<"desc" | "asc">("desc");
  const [comparisonUniverse, setComparisonUniverse] = useState<ComparisonUniverse>("watchlist_plus_benchmark");
  const [comparisonBenchmarkTicker, setComparisonBenchmarkTicker] = useState(DEFAULT_PORTFOLIO_BENCHMARK_TICKER);
  const [comparisonCustomTickersInput, setComparisonCustomTickersInput] = useState("AAPL, MSFT");
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
  const [bulkDcfReports, setBulkDcfReports] = useState<DCFFullReport[]>([]);
  const [bulkDcfReportsLoading, setBulkDcfReportsLoading] = useState(false);
  const [bulkDcfReportsError, setBulkDcfReportsError] = useState<string | null>(null);
  const [bulkDcfReportsLastUpdatedAt, setBulkDcfReportsLastUpdatedAt] = useState<string | null>(null);
  const [comparisonRequestedSnapshot, setComparisonRequestedSnapshot] = useState<ComparisonRequestSnapshot | null>(() => readSessionCache<CachedCalculation<ComparisonRequestSnapshot, CorporateComparisonApi>>(COMPARISON_CACHE_KEY)?.snapshot ?? null);
  const [comparisonCachedResult] = useState<CorporateComparisonApi | null>(() => readSessionCache<CachedCalculation<ComparisonRequestSnapshot, CorporateComparisonApi>>(COMPARISON_CACHE_KEY)?.result ?? null);
  const [comparisonLastUpdatedAt] = useState<string | null>(() => readSessionCache<CachedCalculation<ComparisonRequestSnapshot, CorporateComparisonApi>>(COMPARISON_CACHE_KEY)?.lastUpdatedAt ?? null);
  const [comparisonRefreshToken, setComparisonRefreshToken] = useState<string | null>(null);
  const debounced = useDebounce(assumptions, 250);
  const selectedMetricParams = useMemo(
    () => metricBasisParams(roicBasis, roicYear),
    [roicBasis, roicYear],
  );
  const activeDcfSnapshot = useMemo<DcfRequestSnapshot>(() => ({
    ticker: debounced.ticker,
    growth: debounced.growth,
    roic: debounced.roic,
    wacc: debounced.wacc,
    debtRatio: debounced.debtRatio,
    unleveredBeta: debounced.unleveredBeta,
    crp: debounced.crp,
    reinvestment: debounced.reinvestment,
    fcff: debounced.fcff,
    esgPenalty: debounced.esgPenalty,
  }), [debounced]);
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
  const showCompanyResults = companySearch.trim().length > 0;
  const filteredCompanies = useMemo(() => {
    const query = companySearch.trim().toLowerCase();
    if (!query) return companies;
    const startsWith = companies.filter((company) => company.name.toLowerCase().startsWith(query));
    return startsWith.length > 0
      ? startsWith
      : companies.filter((company) => company.name.toLowerCase().includes(query));
  }, [companies, companySearch]);

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
    setCompanySearch("");
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

  const addCompany = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ticker = newCompanySymbol.trim().toUpperCase();
    const name = newCompanyName.trim();
    if (!ticker || !name) return;

    const saved = await fetchApi<CorporateCompany>("/corporate/companies", {
      method: "POST",
      body: JSON.stringify({ ticker, name, source: "manual" }),
    });
    queryClient.setQueryData<CorporateCompany[]>(["corporate-companies"], (current = []) => {
      const next = current.filter((company) => company.ticker.toUpperCase() !== saved.ticker.toUpperCase());
      return [...next, saved];
    });
    setNewCompanyName("");
    setNewCompanySymbol("");
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
  const dcfDisplayData = dcfStreamResult ?? dcfCachedForTicker?.result ?? null;
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
  const dcfDisplayLastUpdatedAt = dcfStreamResult?.generated_at ?? dcfCachedForTicker?.lastUpdatedAt ?? null;
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
  const sourceDataIsStale = staleSourceDataTickers.length > 0;
  const sourceDataStaleMessage = sourceDataIsStale
    ? `Cached source data is for ${Array.from(new Set(staleSourceDataTickers)).join(", ")}. Refresh for ${sourceDataTicker}.`
    : "";

  useEffect(() => {
    if (!dcfRequestedSnapshot || !dcfRefreshToken) return;

    const abortController = new AbortController();
    let streamedSummary: DCFResult | null = null;
    let streamedAssumptions: DCFAssumptionSummary | null = null;
    setDcfStreamStatus("streaming");
    setDcfStreamError(null);
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
    setDcfRequestedSnapshot(activeDcfSnapshot);
    setDcfRefreshToken(`${Date.now()}`);
  };

  const handleViewFullDcfReport = async () => {
    const snapshot = dcfRequestedSnapshot ?? activeDcfSnapshot;
    setActiveCalculation("backendDcf");
    setDcfFullReportLoading(true);
    setDcfFullReportError(null);
    try {
      const report = await fetchApi<DCFFullReport>(`/corporate/dcf/${snapshot.ticker}/report`, {
        method: "POST",
        body: JSON.stringify(dcfRequestBody(snapshot)),
      });
      setDcfFullReport(report);
    } catch (error) {
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
    try {
      const reports = await fetchApi<DCFFullReport[]>("/corporate/dcf/reports/bulk", {
        method: "POST",
        body: JSON.stringify({ tickers } satisfies CorporateDcfBatchRequest),
      });
      setBulkDcfReports(reports);
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
    { name: "Risk-free", value: RISK_FREE_RATE, fill: "#9DA5A2" },
    { name: "Beta x Implied ERP", value: derived.leveredBeta * impliedErp, fill: "#60CAAD" },
    { name: "CRP", value: KOREA_COUNTRY_RISK_PREMIUM, fill: "#444444" },
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

  // null when the equity bridge did not resolve, in which case estimated_value is an
  // enterprise value and must not be shown under the "Intrinsic DCF" label.
  const bridgedFairValue = dcfData ? bridgedEstimatedValue(dcfData) : null;

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

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 py-6">
      {/* Page header: title plus ticker navigation, backend DCF shortcut, and add-company form. */}
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <PageHeader
          title="Corporate Analysis"
          subtitle={`${companyName}: hurdle rate, bottom-up beta, DCF, and value drivers`}
        />

        <div className="flex w-full flex-col gap-2 min-[1300px]:items-end">
          <div id="company-search-container" className="flex w-full flex-col gap-2 min-[1300px]:flex-row min-[1300px]:justify-end">
            <div className="flex w-full min-w-0 flex-col gap-2 text-sm font-semibold text-[var(--text-primary)] min-[1300px]:max-w-2xl">
              {/* Company Search: absolute results overlay prevents the dropdown from pushing layout. */}
              <div className="relative flex flex-col gap-2">
                <label htmlFor="company-search">Company Search</label>
                <input
                  id="company-search"
                  name="company-search-no-history"
                  type="text"
                  value={companySearch}
                  onChange={(event) => setCompanySearch(event.target.value)}
                  placeholder="Type a company name"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm"
                />
                {showCompanyResults && (
                  <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-28 overflow-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-1 shadow-lg">
                    {filteredCompanies.map((company) => (
                      <button
                        key={company.ticker}
                        type="button"
                        onClick={() => {
                          selectTicker(company.ticker);
                        }}
                        className={`block w-full rounded px-3 py-2 text-left text-sm transition hover:bg-[var(--surface)] ${company.ticker === assumptions.ticker ? "bg-[var(--surface)] font-bold text-[var(--text-primary)]" : "text-[var(--text-muted)]"
                          }`}
                      >
                        {company.name}
                      </button>
                    ))}
                    {filteredCompanies.length === 0 && (
                      <div className="px-3 py-2 text-xs text-[var(--text-muted)]">No saved companies match that name.</div>
                    )}
                  </div>
                )}
              </div>
              {/* Backend DCF: quick link into the intrinsic valuation detail modal. */}
              <button
                type="button"
                onClick={() => setActiveCalculation("backendDcf")}
                className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-left text-sm transition hover:border-[var(--surface)]"
              >
                <div className="text-xs text-[var(--text-muted)]">
                  <InfoTooltip
                    label="Intrinsic DCF"
                    description="Backend intrinsic value from projected FCFF, WACC, terminal growth, and the enterprise-to-equity bridge. Current market price is used only for upside comparison."
                  />
                </div>
                <div
                  className="font-bold text-[var(--text-primary)]"
                  title={dcfData && bridgedFairValue === null ? UNBRIDGED_REASON : undefined}
                >
                  {!dcfData
                    ? "Refresh to calculate"
                    : bridgedFairValue === null
                      ? UNBRIDGED_PLACEHOLDER
                      : moneyText(bridgedFairValue)}
                  {dcfStreamStatus === "streaming" ? " ..." : ""}
                </div>
              </button>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                <button
                  type="button"
                  onClick={handleRefreshDcf}
                  disabled={dcfStreamStatus === "streaming"}
                  className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 font-bold text-[var(--text-primary)] disabled:opacity-60"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${dcfStreamStatus === "streaming" ? "animate-spin" : ""}`} />
                  Refresh DCF
                </button>
                <button
                  type="button"
                  onClick={() => void handleViewFullDcfReport()}
                  disabled={dcfFullReportLoading || (!dcfData && dcfStreamStatus === "idle")}
                  className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 font-bold text-[var(--text-primary)] disabled:opacity-60"
                >
                  {dcfFullReportLoading ? "Loading report..." : "View Full Report"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCalculateAllDcfReports()}
                  disabled={bulkDcfReportsLoading || nonBenchmarkComparisonRows.length === 0}
                  className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 font-bold text-[var(--text-primary)] disabled:opacity-60"
                >
                  {bulkDcfReportsLoading ? "Calculating all DCF reports..." : "Calculate All DCF Reports"}
                </button>
                <span>{dcfDisplayLastUpdatedAt ? `Last updated ${dateTimeText(dcfDisplayLastUpdatedAt)}` : "Not calculated yet"}</span>
                {dcfIsStale && (
                  <span className="rounded-full bg-amber-100 px-2 py-1 text-[length:var(--type-caption)] font-bold text-amber-800">
                    Stale
                  </span>
                )}
                {!dcfData && dcfStreamStatus !== "streaming" && (
                  <span>DCF stays idle on first load until you refresh it.</span>
                )}
                {dcfStreamError && (
                  <span className="rounded-full bg-red-100 px-2 py-1 text-[length:var(--type-caption)] font-bold text-red-800">
                    {dcfStreamError}
                  </span>
                )}
              </div>
            </div>
            {/* Add Company: persists a manual ticker and immediately selects it for analysis. */}
            <form onSubmit={addCompany} className="grid w-full min-w-0 grid-cols-1 gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-sm sm:grid-cols-2 min-[1300px]:max-w-sm">
              <div className="text-xs font-semibold text-[var(--text-muted)] sm:col-span-2">Add Company</div>
              <input
                value={newCompanyName}
                onChange={(event) => setNewCompanyName(event.target.value)}
                placeholder="Company name"
                className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-2"
              />
              <input
                value={newCompanySymbol}
                onChange={(event) => setNewCompanySymbol(event.target.value)}
                placeholder="Symbol"
                className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-2"
              />
              <button
                type="submit"
                className="rounded-[var(--radius)] bg-[var(--surface)] px-3 py-2 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2"
                disabled={!newCompanyName.trim() || !newCompanySymbol.trim()}
              >
                Add for Analysis
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Main analysis grid: assumption controls on the left, valuation cards and charts on the right. */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-6">
        <CorporateAssumptionsPanel
          setActiveCalculation={setActiveCalculation}
          handleRefreshSourceData={handleRefreshSourceData}
          metricsHistoryQueryIsFetching={metricsHistoryQuery.isFetching}
          quarterlyStatementsQueryIsFetching={quarterlyStatementsQuery.isFetching}
          historicalPricesQueryIsFetching={historicalPricesQuery.isFetching}
          sourceDataDisplayLastUpdatedAt={sourceDataDisplayLastUpdatedAt}
          sourceDataIsStale={sourceDataIsStale}
          sourceDataStaleMessage={sourceDataStaleMessage}
          hasMetricsHistoryData={Boolean(metricsHistoryData)}
          hasQuarterlyStatementsData={Boolean(quarterlyStatementsData)}
          hasHistoricalPricesData={historicalPricesData.length > 0}
          applyMetricHistorySelection={applyMetricHistorySelection}
          growthBasisLabel={growthBasisLabel}
          growthMeta={growthMeta}
          roicBasis={roicBasis}
          setRoicBasis={setRoicBasis}
          roicYear={roicYear}
          setRoicYear={setRoicYear}
          annualRoicValues={annualRoicValues}
          roicBasisLabel={roicBasisLabel}
          roicMeta={roicMeta}
          roicYearUnavailableMessage={roicYearUnavailableMessage}
          roicAudit={metricAuditQuery.data?.roic ?? null}
          waccAudit={metricAuditQuery.data?.wacc ?? null}
          assumptions={assumptions}
          update={update}
        />

        {/* Dashboard surface: KPI cards first, then the diagnostic chart suite as a clearly visible section. */}
        <div className="space-y-4 xl:col-span-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <button
              type="button"
              onClick={() => setActiveCalculation("spread")}
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-left transition hover:border-[var(--surface)]"
            >
              <div className="text-xs font-semibold text-[var(--text-muted)]">
                <InfoTooltip
                  label="ROIC - WACC"
                  description={`Spread between return on invested capital and WACC. Basis: ${pct(assumptions.roic)} ROIC - ${pct(assumptions.wacc)} WACC = ${pct(derived.spread)}. Positive is good because returns exceed the hurdle rate; current status is ${derived.spread >= 0 ? "Good, value creation" : "Bad, value destruction"}.`}
                />
              </div>
              <div className={`mt-1 text-3xl font-black ${derived.spread >= 0 ? "text-[var(--delta-up)]" : "text-[var(--delta-down)]"}`}>
                {pct(derived.spread)}
              </div>
              <div className="mt-2 text-xs text-[var(--text-muted)]">
                {derived.spread >= 0 ? "Value creation" : "Value destruction"}
              </div>
            </button>
            <button
              type="button"
              onClick={() => setActiveCalculation("bottomUpKe")}
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-left transition hover:border-[var(--surface)]"
            >
              <div className="text-xs font-semibold text-[var(--text-muted)]">
                <InfoTooltip
                  label="Bottom-up Ke"
                  description={`Cost of equity estimate. Basis: risk-free rate ${pct(RISK_FREE_RATE)} + levered beta ${numberText2(derived.leveredBeta)} x implied ERP ${pct(impliedErp)} + South Korea CRP ${pct(KOREA_COUNTRY_RISK_PREMIUM)} = ${pct(derived.bottomUpKe)}. Lower is generally better, but it must still reflect real risk.`}
                />
              </div>
              <div className="mt-1 text-3xl font-black text-[var(--text-primary)]">{pct(derived.bottomUpKe)}</div>
              <div className="mt-2 text-xs text-[var(--text-muted)]">rf + beta x implied ERP + CRP</div>
            </button>
            <button
              type="button"
              onClick={() => setActiveCalculation("leveredBeta")}
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-left transition hover:border-[var(--surface)]"
            >
              <div className="text-xs font-semibold text-[var(--text-muted)]">
                <InfoTooltip
                  label="Levered Beta"
                  description={`Equity risk after financial leverage. Basis: betaU ${numberText(assumptions.unleveredBeta)} x [1 + (1 - ${pct(TAX_RATE * 100)}) x D/E ${numberText(derived.debtToEquity)}] = ${numberText2(derived.leveredBeta)}. Beta 1.0 is average market risk; beta above 1.0 is more volatile than the market, so beta 1.5 means 50.0% higher risk; beta below 1.0 is less volatile, so beta 0.7 means 30.0% lower risk.`}
                />
              </div>
              <div className="mt-1 text-3xl font-black text-[var(--text-primary)]">{numberText2(derived.leveredBeta)}</div>
              <div className="mt-2 text-xs text-[var(--text-muted)]">Hamada adjusted</div>
            </button>
          </div>

          <CorporateDiagnosticsSection
            companyName={companyName}
            hurdleBars={hurdleBars}
            regionalHurdle={regionalHurdle}
            assumptionsDebtRatio={assumptions.debtRatio}
            betaTreemapProxy={betaTreemapProxy}
            waccCurve={waccCurve}
            valueMatrix={valueMatrix}
            sustainableGrowth={derived.sustainableGrowth}
            fcff={assumptions.fcff}
            dcfResult={dcfData ?? undefined}
            onOpenDetail={setActiveCalculation}
          />
        </div>

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
          onCalculateAllDcfReports={() => void handleCalculateAllDcfReports()}
          formatPct2={pct2}
          formatMoney={moneyText}
          formatDateTime={dateTimeText}
          formatComparisonUniverseLabel={comparisonUniverseLabel}
        />
      </section>
      {/* Calculation detail modal is mounted only when a metric or chart title is selected. */}
      {activeCalculationDetail && (
        <CalculationDetailModal
          detail={activeCalculationDetail}
          ticker={assumptions.ticker}
          metricAudit={metricAuditQuery.data ?? null}
          metricAuditIsLoading={metricAuditQuery.isLoading}
          metricAuditIsError={metricAuditQuery.isError}
          rawDatasetRows={rawDatasetRows}
          historicalPrices={historicalPricesData}
          historicalStatus={
            historicalPricesQuery.isLoading && historicalPricesData.length === 0
              ? "Loading 5-year historical price data"
              : historicalPricesQuery.isError && historicalPricesData.length === 0
                ? "5-year historical price data unavailable"
                : historicalPricesData.length === 0
                  ? "Refresh source data to load 5-year historical price data"
                  : `${historicalPricesData.length} daily rows from the 5-year OHLCV endpoint`
          }
          historicalIsLoading={historicalPricesQuery.isLoading && historicalPricesData.length === 0}
          historicalIsError={historicalPricesQuery.isError && historicalPricesData.length === 0}
          quarterlyStatementRows={quarterlyStatementsData?.rows ?? []}
          quarterlyStatementStatus={
            quarterlyStatementsQuery.isLoading && !quarterlyStatementsData
              ? "Loading Yahoo quarterly financial statements"
              : quarterlyStatementsQuery.isError && !quarterlyStatementsData
                ? "Yahoo quarterly financial statements unavailable"
                : !quarterlyStatementsData
                  ? "Refresh source data to load Yahoo quarterly financial statements"
                  : `${quarterlyStatementsData.rows.length} rows from ${quarterlyStatementsData.source ?? "Yahoo quarterly financial statements"}`
          }
          quarterlyStatementsIsLoading={quarterlyStatementsQuery.isLoading && !quarterlyStatementsData}
          quarterlyStatementsIsError={quarterlyStatementsQuery.isError && !quarterlyStatementsData}
          dcfFullReport={dcfFullReport}
          dcfFullReportStatus={
            dcfFullReportLoading
              ? "Loading full DCF report..."
              : dcfFullReportError
                ? dcfFullReportError
              : dcfFullReport
                ? `Full report loaded for ${dcfFullReport.summary.ticker} (${dcfFullReport.summary.report_id}).`
                : "Full report not loaded yet."
          }
          dcfFullReportIsLoading={dcfFullReportLoading}
          dcfFullReportIsError={Boolean(dcfFullReportError)}
          onRequestDcfFullReport={() => void handleViewFullDcfReport()}
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
