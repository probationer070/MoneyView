"use client";

import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { formatNumber } from "@/lib/format";
import { useT } from "@/lib/i18n/locale";
import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";
import { fetchApi } from "@/lib/api";
import { useDevMonitorPageLoad } from "@/hooks/useDevMonitorPageLoad";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { Sparkline } from "@/components/ui/Sparkline";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import {
  AttributionResult,
  RawOHLCV,
  toAllocationDonutData,
  toAttributionWaterfallData,
} from "@/lib/transformers";
import { ExportButton } from "@/components/ui/ExportButton";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import {
  benchmarkPresetIdForTicker,
  DEFAULT_PORTFOLIO_BENCHMARK_TICKER,
  PORTFOLIO_BENCHMARK_PRESETS,
} from "@/lib/benchmarkPresets";
import { useDebounce } from "@/hooks/useDebounce";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonCard } from "@/components/ui/LoadingState";
import { PortfolioAttributionSummary } from "./components/PortfolioAttributionSummary";
import { PortfolioAllocationEditor } from "./components/PortfolioAllocationEditor";
import { AddStockModal } from "./components/AddStockModal";
import { PortfolioCommandCenter } from "./components/PortfolioCommandCenter";
import { PortfolioGuide } from "./components/PortfolioGuide";
import { PeriodControl } from "./components/PeriodControl";
import { PortfolioShell } from "./components/PortfolioShell";
import { StockViewToggle, type StocksView } from "./components/StockViewToggle";
import { resolveGroupFilter, selectVisibleStocks, StockTileGrid, type GridFilter } from "./components/StockTileGrid";
import { WatchlistPeerSyncStatus, type WatchlistPeerSyncStatusData } from "./components/WatchlistPeerSyncStatus";
import { tabStateKey, useTabState } from "@/lib/tabState";
import { tokens } from "@/lib/tokens.generated";
import { acquireNews, fetchBulkNews, summarizeAcquisition } from "@/lib/portfolioNews";
import {
  buildPortfolioTickerMetrics,
  metricDisplayTitle,
  metricNumericValue,
  metricSubtitle,
  metricToneClass as portfolioMetricToneClass,
  type PortfolioTickerMetrics,
  volatilityToneClass as portfolioVolatilityToneClass,
} from "./portfolioMetrics";
import { MetricQualityBadge } from "@/components/ui/MetricQualityBadge";

function ModalLoadingOverlay({ label }: { label: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)] p-4" role="status" aria-live="polite">
      <div className="w-full max-w-xl border border-[var(--line)] bg-[var(--surface-raised)] p-5">
        <div className="type-body text-[var(--ink)]">{label}</div>
        <div className="mt-4 h-24 animate-pulse bg-[var(--surface)]" />
      </div>
    </div>
  );
}

const StockDetailModal = dynamic(
  () => import("./components/StockDetailModal").then((mod) => mod.StockDetailModal),
  {
    loading: () => <ModalLoadingOverlay label="Loading stock detail" />,
    ssr: false,
  },
);

// Domain models returned by the portfolio, detail, and news endpoints.
interface WatchlistDelta {
  delta_pct: number;
}

export interface PortfolioStock {
  ticker: string;
  name: string;
  sector: string;
  group_name: string;
  weight: number;
  // Nullable because "no priced bar" is a real state the API now reports honestly rather
  // than as 0. Declaring these non-null was a lie the compiler believed, which is how a
  // `.toLocaleString()` on null reached the holdings panel.
  last_close: number | null;
  delta: WatchlistDelta | null;
  sparkline: number[];
  // Watchlist insertion order. The only recency signal the row carries, and the
  // tile grid's no-weights fallback orders by it. 0 means "not a watchlist row".
  id: number;
  // Stable theme id from GET /portfolio/watchlist/themes; "" means no theme.
  theme: string;
}

export interface WatchlistTheme {
  id: string;
  ko: string;
  en: string;
}

interface WatchlistItemPayload {
  ticker: string;
  name: string;
  sector: string;
  group_name: string;
  weight: number;
}

interface WatchlistResyncResult {
  item_count: number;
  source: string;
}

interface WatchlistSyncResult {
  item_count: number;
  source: string;
  json_path: string;
  preserved_weights: boolean;
}

interface WatchlistSyncStatus {
  source: string;
  last_updated_at: string;
  json_path: string;
}

interface PortfolioPreferences {
  total_investment_amount: number;
  transaction_fee_rate: number;
  updated_at: string;
}

interface CorporateCompany {
  ticker: string;
  name: string;
  sector?: string;
  source?: string;
}

interface SelectedStockContext {
  ticker: string;
  fallbackStock: PortfolioStock;
}

interface CorporateComparisonRow {
  ticker: string;
  name: string;
  sector: string;
  group_name: string;
  weight: number;
  roic_minus_wacc: number;
  dcf_value: number | null;
  current_price: number;
  dcf_implied_return: number | null;
  capm_expected_return: number;
  market_implied_return: number | null;
  implied_return_spread: number | null;
  implied_return_refusal: string | null;
  dcf_refusal: string | null;
}

export interface CorporateComparisonSnapshotMeta {
  mode: "snapshot" | "live";
  as_of_date: string;
  generated_at: string;
  snapshot_version: string;
  snapshot_available: boolean;
  snapshot_source: string;
  comparison_universe: string;
  benchmark_ticker: string;
  custom_tickers: string[];
  snapshot_cadence: string;
  snapshot_retention_days: number;
  snapshot_is_stale: boolean;
}

export interface CorporateComparisonResponse {
  market_expected_return: number;
  risk_free_rate: number;
  equity_risk_premium: number;
  stock_expected_return_method: string;
  comparison_reference_return_method: string;
  snapshot: CorporateComparisonSnapshotMeta;
  rows: CorporateComparisonRow[];
}

interface CorporateComparisonStockHistoryPoint {
  as_of_date: string;
  generated_at: string;
  snapshot_version: string;
  snapshot_source: string;
  benchmark_ticker: string;
  current_price: number;
  roic_minus_wacc: number;
  dcf_implied_return: number | null;
  // Null when refused or before metric v3 (not recorded); the refusal code tells them apart.
  implied_return_spread: number | null;
  implied_return_refusal: string | null;
  dcf_refusal: string | null;
  market_expected_return: number;
}

export interface CorporateComparisonStockHistoryResponse {
  ticker: string;
  comparison_universe: string;
  benchmark_ticker: string;
  custom_tickers: string[];
  points: CorporateComparisonStockHistoryPoint[];
}

export type PortfolioComparisonUniverse = "portfolio_plus_benchmark" | "custom";

export interface NewsArticle {
  id: number | null;
  ticker: string | null;
  headline: string;
  url: string;
  source: string;
  published_date: string;
  sentiment: string;
  importance: number;
}

export interface StockDetail {
  ticker: string;
  prices: RawOHLCV[];
  news: NewsArticle[];
}

const PORTFOLIO_DATE_FILTERS_STORAGE_KEY = "moneyview.portfolio.dateFilters.v1";
const PORTFOLIO_COMPARISON_CACHE_KEY = "moneyview.portfolio.comparison-cache.v1";
const PORTFOLIO_ATTRIBUTION_CACHE_KEY = "moneyview.portfolio.attribution-cache.v1";
const DEFAULT_TOTAL_INVESTMENT_AMOUNT = 10_000;
const DEFAULT_TRANSACTION_FEE_RATE = 0.002;

type CachedCalculation<TSnapshot, TResult> = {
  snapshot: TSnapshot;
  result: TResult;
  lastUpdatedAt: string;
};

type PortfolioComparisonRequestSnapshot = {
  mode: "snapshot" | "live";
  comparisonUniverse: PortfolioComparisonUniverse;
  benchmarkTicker: string;
  customTickersInput: string;
  holdingsSignature: string;
};

type AttributionRequestSnapshot = {
  tickers: string[];
  weights: number[];
  benchmarkTicker: string;
  holdingStartDate: string;
  attributionAsOfDate: string;
};

function readSessionCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const rawValue = window.sessionStorage.getItem(key);
    if (!rawValue) return null;
    return JSON.parse(rawValue) as T;
  } catch {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Blocked storage: there is nothing to clear.
    }
    return null;
  }
}

function writeSessionCache<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Session cache is an optional optimization layer.
  }
}

function readStoredPortfolioDateFilters() {
  if (typeof window === "undefined") {
    return {
      holdingStartDate: "",
      attributionAsOfDate: "",
    };
  }

  try {
    const rawValue = window.localStorage.getItem(PORTFOLIO_DATE_FILTERS_STORAGE_KEY);
    if (!rawValue) {
      return {
        holdingStartDate: "",
        attributionAsOfDate: "",
      };
    }

    const parsed = JSON.parse(rawValue) as { holdingStartDate?: string; attributionAsOfDate?: string };
    const holdingStartDate = parsed.holdingStartDate ?? "";
    const attributionAsOfDate = parsed.attributionAsOfDate ?? "";
    return {
      holdingStartDate,
      attributionAsOfDate: holdingStartDate && attributionAsOfDate && holdingStartDate > attributionAsOfDate
        ? ""
        : attributionAsOfDate,
    };
  } catch {
    try {
      window.localStorage.removeItem(PORTFOLIO_DATE_FILTERS_STORAGE_KEY);
    } catch {
      // Blocked storage: there is nothing to clear.
    }
    return {
      holdingStartDate: "",
      attributionAsOfDate: "",
    };
  }
}

const EMPTY_WATCHLIST: PortfolioStock[] = [];
const EMPTY_THEMES: WatchlistTheme[] = [];
/**
 * The group the tile grid's follow control adds to and removes from.
 *
 * `custom` is the group `stock_targets.json` already uses for hand-picked names, so
 * following a stock in the UI and adding it to that file mean the same thing. Removing
 * follow moves a row to `total` rather than deleting it: the stock stays on the
 * watchlist and keeps its weight, it just leaves the followed view.
 */
export const FOLLOWED_GROUP = "custom";
const UNFOLLOWED_GROUP = "total";

const WEIGHT_SUM_TOLERANCE = 1e-6;
export const MOVING_AVERAGE_WINDOWS = [5, 20, 60, 120] as const;
export const MOVING_AVERAGE_COLORS: Record<(typeof MOVING_AVERAGE_WINDOWS)[number], string> = {
  5: tokens.chart["1"],
  20: tokens.chart["2"],
  60: tokens.chart["3"],
  120: tokens.chart["4"],
};

// Loading placeholders keep the attribution dashboard stable while API requests resolve.
function KpiSkeletonCard() {
  return <SkeletonCard className="h-[88px]" />;
}

function ChartSkeleton({ title }: { title: string }) {
  return (
    <div>
      <span className="sr-only">{title}</span>
      <SkeletonCard className="h-[320px]" />
    </div>
  );
}

// Shared empty/error state panel for watchlist and attribution engine failures.
export function StatusPanel({ title, message, tone = "neutral" }: { title: string; message: string; tone?: "neutral" | "warning" }) {
  if (tone === "warning") return <ErrorState title={title} message={message} />;
  return <EmptyState title={title} description={message} />;
}

// Compact identity block reused by holding cards and table rows.
function MetricCell({ metric, toneClass }: { metric: PortfolioTickerMetrics["roicMinusWacc"]; toneClass: string }) {
  const subtitle = metricSubtitle(metric);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className={`type-mono  ${toneClass}`} title={metricDisplayTitle(metric)}>
        {metric.displayValue}
      </div>
      <div className="flex flex-wrap justify-end gap-1">
        <MetricQualityBadge quality={metric.quality} />
      </div>
      {subtitle ? (
        <div className="max-w-[12rem] text-right type-caption text-[var(--ink-muted)]">
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

function mergePortfolioCompanies(companies: CorporateCompany[] | undefined, watchlist: PortfolioStock[]) {
  const merged = new Map<string, CorporateCompany>();
  for (const company of companies ?? []) {
    merged.set(company.ticker.toUpperCase(), {
      ticker: company.ticker.toUpperCase(),
      name: company.name,
      sector: company.sector,
      source: company.source,
    });
  }
  for (const stock of watchlist) {
    merged.set(stock.ticker.toUpperCase(), {
      ticker: stock.ticker.toUpperCase(),
      name: stock.name || stock.ticker,
      sector: stock.sector,
      source: "watchlist",
    });
  }
  return Array.from(merged.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function buildBrowserPortfolioStock(company: CorporateCompany, existingStock?: PortfolioStock | null): PortfolioStock {
  if (existingStock) {
    return existingStock;
  }

  return {
    ticker: company.ticker.toUpperCase(),
    name: company.name || company.ticker.toUpperCase(),
    sector: company.sector ?? "",
    group_name: "browser",
    weight: 0,
    last_close: 0,
    delta: { delta_pct: 0 },
    sparkline: [],
    id: 0,
    theme: "",
  };
}

// Table layout for holdings when the user switches away from card view.
function HoldingsTable({
  watchlist,
  comparisonMetricsByTicker,
  onSelect,
  followedGroup,
  onToggleFollow,
}: {
  watchlist: PortfolioStock[];
  comparisonMetricsByTicker: Record<string, PortfolioTickerMetrics>;
  onSelect: (stock: PortfolioStock) => void;
  followedGroup: string;
  onToggleFollow: (stock: PortfolioStock) => void;
}) {
  const t = useT();
  return (
    <section className="overflow-x-auto border border-[var(--line)] bg-[var(--surface-raised)]">
      <div className="border-b border-[var(--line)] bg-[var(--surface)] px-4 py-2 type-small text-[var(--ink-muted)] sm:hidden">
        Mobile view keeps the core comparison columns visible first. Open a stock row for the full detail workflow.
      </div>
      <table className="min-w-[760px] w-full type-body">
        <thead className="sticky top-0 z-10 bg-[var(--surface)] text-left text-[var(--ink-muted)]">
          <tr>
            <th className="px-2 py-3 type-caption"><BilingualLabel k="ticker" /></th>
            <th className="hidden px-2 py-3 lg:table-cell type-caption"><BilingualLabel k="sector" /></th>
            <th className="px-2 py-3 text-right type-caption"><BilingualLabel k="currentPrice" /></th>
            <th className="hidden px-2 py-3 text-right md:table-cell type-caption"><BilingualLabel k="trend" /></th>
            <th className="px-2 py-3 text-right type-caption"><BilingualLabel k="roicWacc" /></th>
            <th className="px-2 py-3 text-right type-caption">DCF value vs price (one-off gap)</th>
            <th className="px-2 py-3 text-right type-caption">Implied return vs WACC (pts per year)</th>
            <th className="hidden px-2 py-3 text-right md:table-cell type-caption"><BilingualLabel k="volatility" /></th>
            <th className="hidden px-2 py-3 text-right lg:table-cell type-caption"><BilingualLabel k="weight" /></th>
            <th className="px-2 py-3 text-center type-caption">{t("portfolio.view.follow")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--grid)]">
          {watchlist.map((stock) => {
            const deltaPct = stock.delta?.delta_pct ?? 0;
            const metrics = comparisonMetricsByTicker[stock.ticker] ?? EMPTY_COMPARISON_METRICS;
            const followed = stock.group_name === followedGroup;
            return (
              <tr
                key={stock.ticker}
                className="cursor-pointer hover:bg-[var(--surface)]"
                onClick={() => onSelect(stock)}
              >
                <td className="px-2 py-3">
                  <div className="type-mono  text-[var(--ink)]">{stock.ticker}</div>
                  <div className="type-small text-[var(--ink-muted)]">{stock.name || stock.ticker}</div>
                  <div className="mt-1 type-caption text-[var(--ink-muted)] lg:hidden">{sectorLabel(stock.sector)}</div>
                </td>
                <td className="hidden px-2 py-3 text-[var(--ink-muted)] lg:table-cell">{sectorLabel(stock.sector)}</td>
                <td className="px-2 py-3 text-right tabular-nums">
                  <div className="flex flex-col items-end gap-1">
                    <span>{formatCurrencyCompact(metrics.currentPrice ?? stock.last_close)}</span>
                    <DeltaBadge value={deltaPct} />
                  </div>
                </td>
                <td className="hidden px-2 py-3 md:table-cell">
                  <div className="ml-auto w-24">
                    <Sparkline
                      data={stock.sparkline}
                      height={24}
                    />
                  </div>
                </td>
                <td className="px-2 py-3 text-right align-top">
                  <MetricCell metric={metrics.roicMinusWacc} toneClass={portfolioMetricToneClass(metrics.roicMinusWacc)} />
                </td>
                <td className="px-2 py-3 text-right align-top">
                  <MetricCell metric={metrics.dcfUpside} toneClass={portfolioMetricToneClass(metrics.dcfUpside)} />
                </td>
                <td className="px-2 py-3 text-right align-top">
                  <MetricCell metric={metrics.impliedVsWacc} toneClass={portfolioMetricToneClass(metrics.impliedVsWacc)} />
                </td>
                <td className="hidden px-2 py-3 text-right align-top md:table-cell">
                  <MetricCell metric={metrics.volatility} toneClass={portfolioVolatilityToneClass(metrics.volatility)} />
                </td>
                <td className="hidden px-2 py-3 text-right tabular-nums lg:table-cell">
                  {formatWeightPercent(stock.weight)}
                </td>
                <td className="px-2 py-3 text-center">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleFollow(stock);
                    }}
                    aria-pressed={followed}
                    aria-label={followed ? `Unfollow ${stock.ticker}` : `Follow ${stock.ticker}`}
                    title={followed ? "Followed — click to remove" : "Follow this stock"}
                    data-testid={`table-follow-${stock.ticker}`}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-1)] type-body transition-colors ${followed ? "text-[var(--brand-text)]" : "text-[var(--ink-muted)] hover:text-[var(--ink)]"}`}
                  >
                    {followed ? "★" : "☆"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// Small interpretation helpers keep tooltip copy and status labels consistent.
export function isToday(dateText: string) {
  const today = new Date().toISOString().slice(0, 10);
  return dateText?.slice(0, 10) === today;
}

function formatWeightPercent(weight: number) {
  return formatNumber(weight, "percent", { digits: 1 });
}

export function isMetricOutlier(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) || Math.abs(value) > 500;
}

export function formatMetricPercent(value: number | null | undefined) {
  if (isMetricOutlier(value)) return "N/A";
  return formatNumber(Number(value) / 100, "percent", { digits: 2 });
}

export function formatCurrencyCompact(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `$${formatNumber(Number(value), "price", { digits: 1 })}`;
}

function formatCurrencyInput(value: number) {
  if (!Number.isFinite(value)) return `${DEFAULT_TOTAL_INVESTMENT_AMOUNT}`;
  return value.toFixed(2).replace(/\.00$/, "");
}

function clampAllocationPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 100);
}

function parseAllocationPercent(value: string, fallbackPercent: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return clampAllocationPercent(fallbackPercent);
  return clampAllocationPercent(parsed);
}

export function metricToneClass(value: number | null | undefined) {
  if (isMetricOutlier(value)) return "text-[var(--status-warning-ink)]";
  if (value === 0) return "text-[var(--ink-muted)]";
  return Number(value) > 0 ? "text-[var(--up)]" : "text-[var(--down)]";
}

function estimateVolatilityFromSparkline(sparkline: number[]) {
  if (sparkline.length < 3) return null;
  const returns = sparkline
    .slice(1)
    .map((value, index) => {
      const prev = sparkline[index];
      if (prev <= 0) return null;
      return Math.log(value / prev);
    })
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (returns.length < 2) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

export function summarizeSparklineTrend(sparkline: number[]) {
  if (sparkline.length < 2) return null;
  const first = sparkline[0];
  const last = sparkline.at(-1) ?? first;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null;
  return ((last - first) / first) * 100;
}

const EMPTY_COMPARISON_METRICS: PortfolioTickerMetrics = {
  ticker: "",
  roicMinusWacc: { value: null, displayValue: "N/A", quality: "missing", reason: "No portfolio comparison data has been loaded yet." },
  dcfUpside: { value: null, displayValue: "N/A", quality: "missing", reason: "No portfolio comparison data has been loaded yet." },
  impliedVsWacc: { value: null, displayValue: "N/A", quality: "missing", reason: "No portfolio comparison data has been loaded yet." },
  currentPrice: null,
  volatility: { value: null, displayValue: "N/A", quality: "missing", reason: "Not enough price history to estimate volatility." },
  sourceMode: "unavailable",
  asOf: null,
  snapshotVersion: null,
  warnings: [],
  excludedFromRanking: true,
};

function normalizeWeightsToOne(weights: PortfolioStock[]) {
  const total = weights.reduce((sum, stock) => sum + stock.weight, 0);
  if (total <= 0) return weights.map((stock) => ({ ...stock, weight: 0 }));
  return weights.map((stock) => ({
    ...stock,
    weight: stock.weight / total,
  }));
}

function formatSyncTimestamp(value: string) {
  if (!value) return "No explicit sync/import yet";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function formatDateLabel(value: string) {
  if (!value) return "N/A";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

export function portfolioComparisonUniverseLabel(value: string) {
  if (value === "custom") return "Custom Universe";
  return "Portfolio + Benchmark";
}

function isPortfolioComparisonSnapshotStale(
  requested: PortfolioComparisonRequestSnapshot | null,
  current: PortfolioComparisonRequestSnapshot,
) {
  return Boolean(
    requested
    && (
      requested.mode !== current.mode
      || requested.comparisonUniverse !== current.comparisonUniverse
      || requested.benchmarkTicker !== current.benchmarkTicker
      || requested.customTickersInput !== current.customTickersInput
      || requested.holdingsSignature !== current.holdingsSignature
    ),
  );
}

function isPortfolioAttributionSnapshotStale(
  requested: AttributionRequestSnapshot | null,
  current: AttributionRequestSnapshot,
) {
  return Boolean(
    requested
    && (
      requested.benchmarkTicker !== current.benchmarkTicker
      || requested.holdingStartDate !== current.holdingStartDate
      || requested.attributionAsOfDate !== current.attributionAsOfDate
      || requested.tickers.join(",") !== current.tickers.join(",")
      || requested.weights.join(",") !== current.weights.join(",")
    ),
  );
}

function portfolioAttributionViewState({
  attributionData,
  attributionIsLoading,
  attributionIsError,
  hasHoldings,
  canRunAttribution,
}: {
  attributionData: AttributionResult | null | undefined;
  attributionIsLoading: boolean;
  attributionIsError: boolean;
  hasHoldings: boolean;
  canRunAttribution: boolean;
}) {
  return {
    showLoading: attributionIsLoading && hasHoldings && !attributionData,
    showResults: hasHoldings && !attributionIsError && Boolean(attributionData),
    showNoHoldings: !attributionIsLoading && !hasHoldings,
    showIdle: !attributionData && canRunAttribution && !attributionIsLoading && !attributionIsError,
    showError: !attributionIsLoading && attributionIsError && hasHoldings && !attributionData,
  };
}

function sectorLabel(value: string) {
  return value.trim() || "Unclassified";
}

export function aggregateMonthlyBars(dailyBars: RawOHLCV[]): RawOHLCV[] {
  const monthly = new Map<string, RawOHLCV>();
  for (const bar of dailyBars) {
    const monthKey = bar.date.slice(0, 7);
    const existing = monthly.get(monthKey);
    if (!existing) {
      monthly.set(monthKey, { ...bar });
      continue;
    }
    existing.high = Math.max(existing.high, bar.high);
    existing.low = Math.min(existing.low, bar.low);
    existing.close = bar.close;
    existing.volume += bar.volume;
  }
  return Array.from(monthly.values()).sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
}

export function buildMovingAverageSeries(prices: RawOHLCV[], windowSize: (typeof MOVING_AVERAGE_WINDOWS)[number]) {
  const sorted = [...prices].sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
  return sorted.flatMap((bar, index) => {
    if (index + 1 < windowSize) return [];
    const slice = sorted.slice(index + 1 - windowSize, index + 1);
    const average = slice.reduce((sum, item) => sum + item.close, 0) / windowSize;
    return [{ time: bar.date, value: average }];
  });
}

// StockDetailModal extracted to components/StockDetailModal.tsx

export default function PortfolioPage() {
  const t = useT();
  useDevMonitorPageLoad({ component: "portfolio" });
  // Page state tracks the holdings presentation mode and the currently opened detail modal.
  const queryClient = useQueryClient();
  const initialDateFilters = readStoredPortfolioDateFilters();
  const [selectedStockContext, setSelectedStockContext] = useState<SelectedStockContext | null>(null);
  const [holdingStartDate, setHoldingStartDate] = useState(initialDateFilters.holdingStartDate);
  const [attributionAsOfDate, setAttributionAsOfDate] = useState(initialDateFilters.attributionAsOfDate);
  const [newTicker, setNewTicker] = useState("");
  const [newName, setNewName] = useState("");
  const [newSector, setNewSector] = useState("");
  const [portfolioBrowserSearch, setPortfolioBrowserSearch] = useState("");
  const [addStockOpen, setAddStockOpen] = useState(false);
  const [newsFetchedAt, setNewsFetchedAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const autoNewsStartedRef = useRef(false);
  const [addToWatchlistOnly, setAddToWatchlistOnly] = useState(true);
  const [newWeightPercent, setNewWeightPercent] = useState("");
  const [weightDrafts, setWeightDrafts] = useState<Record<string, string>>({});
  const [editingAllocationTicker, setEditingAllocationTicker] = useState<string | null>(null);
  const [totalInvestmentInput, setTotalInvestmentInput] = useState(`${DEFAULT_TOTAL_INVESTMENT_AMOUNT}`);
  const [importJsonArmed, setImportJsonArmed] = useState(false);
  const [mutationMessage, setMutationMessage] = useState<string | null>(null);
  const [portfolioComparisonMode, setPortfolioComparisonMode] = useState<"snapshot" | "live">("snapshot");
  const [portfolioComparisonUniverse] = useState<PortfolioComparisonUniverse>("portfolio_plus_benchmark");
  const [portfolioComparisonBenchmarkTicker, setPortfolioComparisonBenchmarkTicker] = useState(DEFAULT_PORTFOLIO_BENCHMARK_TICKER);
  const [portfolioComparisonCustomTickersInput] = useState("NVDA, TSLA");
  const [portfolioComparisonMessage, setPortfolioComparisonMessage] = useState<string | null>(null);
  const [portfolioAnalysisMessage, setPortfolioAnalysisMessage] = useState<string | null>(null);
  const [applyAllocationToSnapshot, setApplyAllocationToSnapshot] = useState(false);
  // "custom" is the curated group seeded from stock_targets.json. It replaces the old
  // "held" filter, which meant weight > 0 and therefore matched nothing at all while every
  // weight was 0 -- see FOLLOWED_GROUP.
  // Kept per tab, so leaving Portfolio and coming back does not discard the filter and
  // search the user had set. Session-scoped: see lib/tabState.
  const [gridFilter, setGridFilter] = useTabState<GridFilter>(
    tabStateKey("portfolio", "gridFilter"),
    FOLLOWED_GROUP,
  );
  const [gridSearch, setGridSearch] = useTabState(tabStateKey("portfolio", "gridSearch"), "");
  const [refreshSummary, setRefreshSummary] = useState<string | null>(null);
  const [portfolioComparisonRequestedSnapshot, setPortfolioComparisonRequestedSnapshot] = useState<PortfolioComparisonRequestSnapshot | null>(
    () => readSessionCache<CachedCalculation<PortfolioComparisonRequestSnapshot, CorporateComparisonResponse>>(PORTFOLIO_COMPARISON_CACHE_KEY)?.snapshot ?? null,
  );
  const [portfolioAttributionRequestedSnapshot, setPortfolioAttributionRequestedSnapshot] = useState<AttributionRequestSnapshot | null>(
    () => readSessionCache<CachedCalculation<AttributionRequestSnapshot, AttributionResult>>(PORTFOLIO_ATTRIBUTION_CACHE_KEY)?.snapshot ?? null,
  );
  const [portfolioAnalysisRefreshToken, setPortfolioAnalysisRefreshToken] = useState<string | null>(null);
  const [savingAllocationTickers, setSavingAllocationTickers] = useState<string[]>([]);
  const [savingTotalInvestment, setSavingTotalInvestment] = useState(false);
  const [cachedPortfolioComparisonCalculation] = useState<CachedCalculation<PortfolioComparisonRequestSnapshot, CorporateComparisonResponse> | null>(
    () => readSessionCache<CachedCalculation<PortfolioComparisonRequestSnapshot, CorporateComparisonResponse>>(PORTFOLIO_COMPARISON_CACHE_KEY),
  );
  const [cachedPortfolioAttributionCalculation] = useState<CachedCalculation<AttributionRequestSnapshot, AttributionResult> | null>(
    () => readSessionCache<CachedCalculation<AttributionRequestSnapshot, AttributionResult>>(PORTFOLIO_ATTRIBUTION_CACHE_KEY),
  );
  const allocationAutoSaveInFlightRef = useRef(false);
  const totalInvestmentAutoSaveInFlightRef = useRef(false);
  const allocationSectionRef = useRef<HTMLElement | null>(null);
  const weightInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Which page tab is showing. Owned here rather than inside PortfolioShell so page actions
  // can switch tabs programmatically, not just on a click. Restored per session like the grid filter.
  const [stocksView, setStocksView] = useTabState<StocksView>(tabStateKey("portfolio", "stocksView"), "cards");
  const [storedTab, setActiveTab] = useTabState<string>(tabStateKey("portfolio", "tab"), "stocks");
  const activeTab = ["stocks", "weights", "attribution"].includes(storedTab) ? storedTab : "stocks";
  // A pending scroll/focus request against the allocation panel. SidePanel renders null
  // while closed, so allocationSectionRef and weightInputRefs are null until the panel has
  // mounted -- a requestAnimationFrame issued in the same tick as the open would still find
  // nothing. Routing the request through state instead means the consuming effect runs in
  // the commit that mounted the panel, and React attaches refs during commit, before
  // effects. The token makes a repeated request re-fire when the panel is already open.
  const [allocationFocusRequest, setAllocationFocusRequest] = useState<
    { ticker: string | null; token: number } | null
  >(null);

  const requestAllocationFocus = useCallback((ticker: string | null) => {
    // Close the stock detail modal if it is what asked for this. It would otherwise cover
    // the panel it just opened, and its focus trap would pull focus straight back off the
    // weight input. No-op when nothing is selected, as from the holdings toolbar.
    setSelectedStockContext(null);
    setActiveTab("weights");
    // The weight input is only rendered while its row is in edit mode (same gate the
    // double-click path uses), so without this the focus below would still have nothing
    // to land on.
    if (ticker) setEditingAllocationTicker(ticker);
    setAllocationFocusRequest((current) => ({ ticker, token: (current?.token ?? 0) + 1 }));
  }, [setActiveTab]);

  useEffect(() => {
    if (!allocationFocusRequest) return;
    allocationSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // The focus is deferred a frame, the scroll is not. SidePanel focuses its own container
    // when it opens, and the closing detail modal restores focus as it unmounts -- both land
    // after this effect, so focusing the input here would just be overwritten. By now the
    // panel has mounted and its refs are attached, which is what the earlier
    // requestAnimationFrame-at-click-time could not guarantee.
    const { ticker } = allocationFocusRequest;
    const frame = requestAnimationFrame(() => {
      if (!ticker) return;
      const input = weightInputRefs.current[ticker];
      input?.focus();
      input?.select();
    });
    // Deliberately not cleared here: clearing re-runs this effect, and the cleanup below
    // would then cancel the frame we just scheduled. The token is what makes a repeated
    // request re-fire, so the request can simply stay put until the next one replaces it.
    return () => cancelAnimationFrame(frame);
  }, [allocationFocusRequest]);

  const normalizedBenchmarkTicker = portfolioComparisonBenchmarkTicker.trim().toUpperCase() || DEFAULT_PORTFOLIO_BENCHMARK_TICKER;
  const normalizedCustomTickersInput = portfolioComparisonCustomTickersInput.toUpperCase();
  const debouncedBenchmarkTicker = useDebounce(normalizedBenchmarkTicker, 400);
  const debouncedCustomTickersInput = useDebounce(normalizedCustomTickersInput, 400);
  const debouncedWeightDraftsKey = useDebounce(JSON.stringify(weightDrafts), 450);
  const debouncedTotalInvestmentInput = useDebounce(totalInvestmentInput, 500);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        PORTFOLIO_DATE_FILTERS_STORAGE_KEY,
        JSON.stringify({
          holdingStartDate,
          attributionAsOfDate,
        }),
      );
    } catch {
      // Browser storage is optional; the filters still apply for this visit.
    }
  }, [holdingStartDate, attributionAsOfDate]);

  // Watchlist query is the source for holdings, attribution inputs, and detail entry points.
  const watchlistQuery = useQuery<PortfolioStock[]>({
    queryKey: ["portfolio-watchlist"],
    queryFn: () => fetchApi<PortfolioStock[]>("/portfolio/watchlist", {
      monitor: {
        operation: "frontend.query.portfolio_watchlist",
        component: "portfolio_page",
      },
    }),
    staleTime: 1000 * 60,
  });
  const watchlistThemesQuery = useQuery<WatchlistTheme[]>({
    queryKey: ["watchlist-themes"],
    queryFn: () => fetchApi<WatchlistTheme[]>("/portfolio/watchlist/themes"),
    staleTime: Infinity,
  });
  const companiesQuery = useQuery<CorporateCompany[]>({
    queryKey: ["portfolio-browser-companies"],
    queryFn: () => fetchApi<CorporateCompany[]>("/corporate/companies", {
      monitor: {
        operation: "frontend.query.portfolio_companies",
        component: "portfolio_page",
      },
    }),
    staleTime: 1000 * 60 * 5,
  });
  const syncStatusQuery = useQuery<WatchlistSyncStatus>({
    queryKey: ["portfolio-watchlist-sync-status"],
    queryFn: () => fetchApi<WatchlistSyncStatus>("/portfolio/watchlist/sync-status", {
      monitor: {
        operation: "frontend.query.portfolio_sync_status",
        component: "portfolio_page",
      },
    }),
    staleTime: 1000 * 30,
  });
  // Keyed on the watchlist fetch time: the status route is read-only, so it must be read after
  // the watchlist GET (which performs the sync) has completed, not in parallel with it.
  const peerSyncQuery = useQuery<WatchlistPeerSyncStatusData>({
    queryKey: ["portfolio-watchlist-peer-sync", watchlistQuery.dataUpdatedAt],
    queryFn: () => fetchApi<WatchlistPeerSyncStatusData>("/portfolio/watchlist/peer-sync"),
    enabled: watchlistQuery.isSuccess,
    refetchOnWindowFocus: false,
    // The key changes on every watchlist refetch; keep showing the last status until the new one
    // arrives, or the line blinks out and Import briefly reappears while sync is on.
    placeholderData: keepPreviousData,
  });
  const portfolioPreferencesQuery = useQuery<PortfolioPreferences>({
    queryKey: ["portfolio-preferences"],
    queryFn: () => fetchApi<PortfolioPreferences>("/portfolio/preferences", {
      monitor: {
        operation: "frontend.query.portfolio_preferences",
        component: "portfolio_page",
      },
    }),
    staleTime: 1000 * 60,
  });

  const watchlist = watchlistQuery.data ?? EMPTY_WATCHLIST;
  const portfolioPreferences = useMemo(() => (
    portfolioPreferencesQuery.data ?? {
      total_investment_amount: DEFAULT_TOTAL_INVESTMENT_AMOUNT,
      transaction_fee_rate: DEFAULT_TRANSACTION_FEE_RATE,
      updated_at: "",
    }
  ), [portfolioPreferencesQuery.data]);

  useEffect(() => {
    if (savingTotalInvestment || totalInvestmentAutoSaveInFlightRef.current) return;
    setTotalInvestmentInput((current) => {
      const normalizedCurrent = current.trim();
      const nextValue = formatCurrencyInput(portfolioPreferences.total_investment_amount);
      if (!normalizedCurrent || Number(normalizedCurrent) === portfolioPreferences.total_investment_amount) {
        return nextValue;
      }
      return current;
    });
  }, [portfolioPreferences.total_investment_amount, savingTotalInvestment]);
  const browserCompanies = useMemo(
    () => mergePortfolioCompanies(companiesQuery.data, watchlist),
    [companiesQuery.data, watchlist],
  );
  const tickers = useMemo(() => watchlist.map((row) => row.ticker), [watchlist]);
  const storedWeights = useMemo(() => watchlist.map((row) => row.weight), [watchlist]);
  const totalStoredWeight = useMemo(
    () => storedWeights.reduce((sum, value) => sum + value, 0),
    [storedWeights],
  );
  const usingStoredWeights = useMemo(
    () => storedWeights.some((weight) => weight > 0),
    [storedWeights],
  );
  const holdingsSignature = useMemo(
    () => watchlist.map((stock) => `${stock.ticker}:${stock.weight.toFixed(6)}`).join("|"),
    [watchlist],
  );
  const weights = useMemo(() => {
    if (tickers.length === 0) return [];
    if (usingStoredWeights) return storedWeights;
    return tickers.map(() => 1 / tickers.length);
  }, [storedWeights, tickers, usingStoredWeights]);
  const hasHoldings = watchlist.length > 0;
  // watchlist is referentially stable across renders: watchlistQuery.data defaults to the
  // module-level EMPTY_WATCHLIST, not a fresh literal, so these memos only recompute when
  // the data or the grid controls actually change.
  // Resolved once and shared: both memos below need the same answer, and each was
  // rebuilding the group list to get it.
  const effectiveGridFilter = useMemo(
    () => resolveGroupFilter(watchlist, gridFilter),
    [watchlist, gridFilter],
  );
  const visibleStocks = useMemo(
    () => selectVisibleStocks(watchlist, effectiveGridFilter, gridSearch).stocks,
    [watchlist, effectiveGridFilter, gridSearch],
  );
  const visibleTickers = useMemo(
    () => visibleStocks.map((stock) => stock.ticker),
    [visibleStocks],
  );
  // The news query key follows a debounced search so typing four characters is one
  // round-trip instead of four. refreshNews deliberately keeps using the undebounced
  // visibleTickers, so the press-time capture still matches exactly what is on screen.
  const debouncedGridSearch = useDebounce(gridSearch, 400);
  const newsQueryTickers = useMemo(
    () => selectVisibleStocks(watchlist, effectiveGridFilter, debouncedGridSearch)
      .stocks.map((stock) => stock.ticker),
    [watchlist, effectiveGridFilter, debouncedGridSearch],
  );

  const bulkNewsQuery = useQuery({
    queryKey: ["portfolio-news", newsQueryTickers],
    queryFn: () => fetchBulkNews(newsQueryTickers),
    enabled: newsQueryTickers.length > 0,
    // Keep the last good news on the tiles while a new key resolves. Without this the data
    // is undefined for every new key and each tile falls back to the "never checked"
    // placeholder, so the whole grid blanks on every search or filter change.
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    // The summary describes the set that was visible when Refresh was pressed. Once the
    // filter or search moves it no longer describes what the user is looking at.
    setRefreshSummary(null);
  }, [gridFilter, gridSearch]);

  // What the grid was showing when Refresh was pressed. Clearing on a filter change only
  // retires a summary already on screen; the crawl takes ~11s, so a result can still land
  // after the user has moved on and read as though it described the tiles now in front of
  // them. Qualifying the line beats dropping it: which tickers failed is the part worth
  // reading, and dropping would throw exactly that away.
  const refreshSubjectRef = useRef<{ filter: GridFilter; search: string } | null>(null);
  const qualifyRefreshSummary = (summary: string) => {
    const subject = refreshSubjectRef.current;
    if (!subject || (subject.filter === gridFilter && subject.search === gridSearch)) return summary;
    return `${summary} · for the stocks visible when you pressed Refresh`;
  };

  const toggleFollow = useMutation({
    mutationFn: async (stock: PortfolioStock) => {
      const nextGroup = stock.group_name === FOLLOWED_GROUP ? UNFOLLOWED_GROUP : FOLLOWED_GROUP;
      // The dedicated group endpoint, never POST /watchlist. That one is a full-row upsert
      // whose weight defaults to 0.0, so following a stock through it would silently wipe
      // an allocation the user set deliberately.
      return fetchApi(`/portfolio/watchlist/${encodeURIComponent(stock.ticker)}/group`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_name: nextGroup }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["portfolio-watchlist"] });
    },
  });

  const refreshNews = useMutation({
    // The visible set is captured here, when Refresh is pressed. A filter change while
    // the batch is in flight must not alter what it acquires, or the reported counts
    // would describe a set the user can no longer see.
    mutationFn: () => acquireNews(visibleTickers),
    onMutate: () => {
      refreshSubjectRef.current = { filter: gridFilter, search: gridSearch };
      // Drop the previous run's line immediately so a stale summary cannot sit under a
      // spinning refresh icon and read as this run's result.
      setRefreshSummary(null);
    },
    onSuccess: (response) => {
      setRefreshSummary(qualifyRefreshSummary(summarizeAcquisition(response)));
      setNewsFetchedAt(Date.now());
      void queryClient.invalidateQueries({ queryKey: ["portfolio-news"] });
    },
    onError: (error) => {
      setRefreshSummary(qualifyRefreshSummary(error instanceof Error ? error.message : "Refresh failed"));
    },
  });

  // The first time the Stocks tab has stocks on screen, fetch their news once. The server
  // reports "fresh" for tickers it already holds, so its staleness rules still apply. The
  // ref (not state) keeps tab switches and re-renders from starting it again.
  useEffect(() => {
    if (activeTab !== "stocks" || visibleTickers.length === 0 || autoNewsStartedRef.current) return;
    autoNewsStartedRef.current = true;
    refreshNews.mutate();
  }, [activeTab, visibleTickers, refreshNews]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const openStockDetail = useCallback((stock: PortfolioStock) => {
    setSelectedStockContext({ ticker: stock.ticker, fallbackStock: stock });
  }, []);
  const weightsOverflow = usingStoredWeights && totalStoredWeight > 1 + WEIGHT_SUM_TOLERANCE;
  const canRunAttribution = hasHoldings && !weightsOverflow;
  const impliedCashWeight = useMemo(
    () => Math.max(0, 1 - totalStoredWeight),
    [totalStoredWeight],
  );
  const investedWeight = useMemo(
    () => Math.min(totalStoredWeight, 1),
    [totalStoredWeight],
  );
  const allocatedHoldingsCount = useMemo(
    () => watchlist.filter((stock) => stock.weight > 0).length,
    [watchlist],
  );
  const existingTicker = useMemo(
    () => watchlist.find((stock) => stock.ticker === newTicker.trim().toUpperCase()) ?? null,
    [newTicker, watchlist],
  );
  const selectedWatchlistStock = useMemo(
    () => (
      selectedStockContext
        ? watchlist.find((stock) => stock.ticker === selectedStockContext.ticker) ?? null
        : null
    ),
    [selectedStockContext, watchlist],
  );
  const selectedStock = selectedWatchlistStock ?? selectedStockContext?.fallbackStock ?? null;
  const selectedStockIsInWatchlist = Boolean(selectedWatchlistStock);
  const browserSearchResults = useMemo(() => {
    const query = portfolioBrowserSearch.trim().toUpperCase();
    if (!query) return browserCompanies.slice(0, 12);
    const startsWith = browserCompanies.filter((company) =>
      company.ticker.startsWith(query) || company.name.toUpperCase().startsWith(query),
    );
    const contains = browserCompanies.filter((company) =>
      !startsWith.some((entry) => entry.ticker === company.ticker)
      && (
        company.ticker.includes(query)
        || company.name.toUpperCase().includes(query)
        || (company.sector ?? "").toUpperCase().includes(query)
      ),
    );
    return [...startsWith, ...contains].slice(0, 16);
  }, [browserCompanies, portfolioBrowserSearch]);
  const totalDraftWeightPercent = useMemo(
    () => watchlist.reduce((sum, stock) => sum + Math.max(Number(weightDrafts[stock.ticker] ?? (stock.weight * 100).toFixed(1)), 0), 0),
    [watchlist, weightDrafts],
  );
  const draftWeightsOverflow = totalDraftWeightPercent > 100 + (WEIGHT_SUM_TOLERANCE * 100);
  const totalInvestmentAmount = Math.max(portfolioPreferences.total_investment_amount, 0);
  const comparisonCurrentSnapshot = useMemo<PortfolioComparisonRequestSnapshot>(() => ({
    mode: portfolioComparisonMode,
    comparisonUniverse: portfolioComparisonUniverse,
    benchmarkTicker: debouncedBenchmarkTicker,
    customTickersInput: portfolioComparisonUniverse === "custom" ? debouncedCustomTickersInput : "",
    holdingsSignature,
  }), [debouncedBenchmarkTicker, debouncedCustomTickersInput, holdingsSignature, portfolioComparisonMode, portfolioComparisonUniverse]);
  const attributionCurrentSnapshot = useMemo<AttributionRequestSnapshot>(() => ({
    tickers,
    weights,
    benchmarkTicker: debouncedBenchmarkTicker,
    holdingStartDate,
    attributionAsOfDate,
  }), [attributionAsOfDate, debouncedBenchmarkTicker, holdingStartDate, tickers, weights]);
  const effectivePortfolioComparisonSnapshot = useMemo<PortfolioComparisonRequestSnapshot | null>(() => {
    if (portfolioComparisonRequestedSnapshot) return portfolioComparisonRequestedSnapshot;
    if (!hasHoldings) return null;
    if (portfolioComparisonMode !== "snapshot") return null;
    return comparisonCurrentSnapshot;
  }, [comparisonCurrentSnapshot, hasHoldings, portfolioComparisonMode, portfolioComparisonRequestedSnapshot]);
  const portfolioComparisonFetchTrigger = portfolioComparisonRequestedSnapshot
    ? (portfolioAnalysisRefreshToken ?? "manual")
    : effectivePortfolioComparisonSnapshot
      ? "auto-snapshot"
      : "idle";
  const portfolioComparisonQuery = useQuery<CorporateComparisonResponse>({
    queryKey: [
      "portfolio-comparison-summary",
      effectivePortfolioComparisonSnapshot?.mode ?? "idle",
      effectivePortfolioComparisonSnapshot?.comparisonUniverse ?? "idle",
      effectivePortfolioComparisonSnapshot?.benchmarkTicker ?? "idle",
      effectivePortfolioComparisonSnapshot?.customTickersInput ?? "",
      effectivePortfolioComparisonSnapshot?.holdingsSignature ?? "idle",
      portfolioComparisonFetchTrigger,
    ],
    enabled: Boolean(hasHoldings && effectivePortfolioComparisonSnapshot && portfolioComparisonFetchTrigger !== "idle"),
      queryFn: ({ signal }) =>
        fetchApi<CorporateComparisonResponse>("/corporate/comparison", {
          signal,
          params: {
            mode: effectivePortfolioComparisonSnapshot?.mode ?? "snapshot",
            comparison_universe: effectivePortfolioComparisonSnapshot?.comparisonUniverse ?? "portfolio_plus_benchmark",
            benchmark_ticker: effectivePortfolioComparisonSnapshot?.benchmarkTicker ?? DEFAULT_PORTFOLIO_BENCHMARK_TICKER,
            custom_tickers: effectivePortfolioComparisonSnapshot?.customTickersInput ?? "",
          },
          monitor: {
            operation: "frontend.query.portfolio_comparison",
            component: "portfolio_page",
          },
        }),
    staleTime: 60_000,
  });

  // Attribution uses saved watchlist weights when present, otherwise falls back to equal weight.
  const attributionQuery = useQuery<AttributionResult>({
    queryKey: [
      "portfolio-attribution",
      portfolioAttributionRequestedSnapshot?.tickers.join(",") ?? "idle",
      portfolioAttributionRequestedSnapshot?.weights.join(",") ?? "idle",
      "5y",
      portfolioAttributionRequestedSnapshot?.benchmarkTicker ?? "idle",
      "USD",
      portfolioAttributionRequestedSnapshot?.holdingStartDate ?? "",
      portfolioAttributionRequestedSnapshot?.attributionAsOfDate ?? "",
      portfolioAnalysisRefreshToken ?? "idle",
    ],
    enabled: Boolean(canRunAttribution && portfolioAttributionRequestedSnapshot && portfolioAnalysisRefreshToken),
      queryFn: () =>
        fetchApi<AttributionResult>("/portfolio/attribution", {
          method: "POST",
          body: JSON.stringify({
            tickers: portfolioAttributionRequestedSnapshot?.tickers ?? [],
          weights: portfolioAttributionRequestedSnapshot?.weights ?? [],
          benchmark: portfolioAttributionRequestedSnapshot?.benchmarkTicker ?? DEFAULT_PORTFOLIO_BENCHMARK_TICKER,
          period: "5y",
          currency: "USD",
          date_from: portfolioAttributionRequestedSnapshot?.holdingStartDate || null,
          as_of_date: portfolioAttributionRequestedSnapshot?.attributionAsOfDate || null,
            attribution_method: "brinson_fachler_arithmetic",
            allow_synthetic_fallback: true,
            allow_benchmark_proxy: true,
          }),
          monitor: {
            operation: "frontend.query.portfolio_attribution",
            component: "portfolio_page",
          },
        }),
    placeholderData: (previous) => previous,
  });

  const cachedPortfolioComparison = cachedPortfolioComparisonCalculation
    && !isPortfolioComparisonSnapshotStale(cachedPortfolioComparisonCalculation.snapshot, comparisonCurrentSnapshot)
    ? cachedPortfolioComparisonCalculation.result
    : null;
  const cachedPortfolioAttribution = cachedPortfolioAttributionCalculation
    && !isPortfolioAttributionSnapshotStale(cachedPortfolioAttributionCalculation.snapshot, attributionCurrentSnapshot)
    ? cachedPortfolioAttributionCalculation.result
    : null;

  // Chart adapters convert domain attribution data into display-ready allocation/effects datasets.
  const comparisonData = portfolioComparisonQuery.data ?? cachedPortfolioComparison;
  const attributionData = attributionQuery.data ?? cachedPortfolioAttribution;
  const allocationData = attributionData ? toAllocationDonutData(attributionData) : [];
  const waterfallData = attributionData ? toAttributionWaterfallData(attributionData) : [];
  const activeComparisonData = comparisonData;
  const activeSnapshotMeta = activeComparisonData?.snapshot ?? null;
  const portfolioComparisonCalculating = normalizedBenchmarkTicker !== debouncedBenchmarkTicker
    || (portfolioComparisonUniverse === "custom" && normalizedCustomTickersInput !== debouncedCustomTickersInput)
    || portfolioComparisonQuery.isFetching
    || attributionQuery.isFetching;
  const comparisonMetricsByTicker = useMemo<Record<string, PortfolioTickerMetrics>>(() => buildPortfolioTickerMetrics({
    watchlist,
    activeComparisonData: activeComparisonData ?? null,
    comparisonData: comparisonData ?? null,
    selectedSnapshotData: undefined,
    selectedHistoryPointSnapshotVersion: null,
    portfolioComparisonUniverse,
    portfolioComparisonQueryHasData: Boolean(portfolioComparisonQuery.data),
    activeSnapshotMeta,
    estimateVolatilityFromSparkline,
  }), [
    activeComparisonData,
    activeSnapshotMeta,
    comparisonData,
    portfolioComparisonQuery.data,
    portfolioComparisonUniverse,
    watchlist,
  ]);
  const allocationRows = useMemo(() => watchlist.map((stock) => {
    const allocationPercent = parseAllocationPercent(
      weightDrafts[stock.ticker] ?? (stock.weight * 100).toFixed(1),
      stock.weight * 100,
    );
    const allocatedAmount = totalInvestmentAmount * (allocationPercent / 100);
    const metrics = comparisonMetricsByTicker[stock.ticker] ?? EMPTY_COMPARISON_METRICS;
    const projectedUpsidePercent = metricNumericValue(metrics.dcfUpside);
    const grossProjectedValue = projectedUpsidePercent == null
      ? allocatedAmount
      : allocatedAmount * (1 + (projectedUpsidePercent / 100));
    const transactionFeeAmount = projectedUpsidePercent == null
      ? 0
      : grossProjectedValue * portfolioPreferences.transaction_fee_rate;
    const netProjectedValue = projectedUpsidePercent == null
      ? allocatedAmount
      : grossProjectedValue - transactionFeeAmount;
    const finalProfit = projectedUpsidePercent == null
      ? 0
      : netProjectedValue - allocatedAmount;
    return {
      stock,
      allocationPercent,
      allocatedAmount,
      grossProjectedValue,
      netProjectedValue,
      transactionFeeAmount,
      finalProfit,
      projectedUpsidePercent,
      isSaving: savingAllocationTickers.includes(stock.ticker),
    };
  }), [
    comparisonMetricsByTicker,
    portfolioPreferences.transaction_fee_rate,
    savingAllocationTickers,
    totalInvestmentAmount,
    watchlist,
    weightDrafts,
  ]);
  const allocationSummary = useMemo(() => allocationRows.reduce((summary, row) => ({
    allocatedAmount: summary.allocatedAmount + row.allocatedAmount,
    grossProjectedValue: summary.grossProjectedValue + row.grossProjectedValue,
    netProjectedValue: summary.netProjectedValue + row.netProjectedValue,
    transactionFeeAmount: summary.transactionFeeAmount + row.transactionFeeAmount,
    finalProfit: summary.finalProfit + row.finalProfit,
  }), {
    allocatedAmount: 0,
    grossProjectedValue: 0,
    netProjectedValue: 0,
    transactionFeeAmount: 0,
    finalProfit: 0,
  }), [allocationRows]);

  const attributionView = portfolioAttributionViewState({
    attributionData,
    attributionIsLoading: attributionQuery.isLoading,
    attributionIsError: attributionQuery.isError,
    hasHoldings,
    canRunAttribution,
  });
  useEffect(() => {
    if (!portfolioComparisonQuery.data || !effectivePortfolioComparisonSnapshot) return;
    writeSessionCache(PORTFOLIO_COMPARISON_CACHE_KEY, {
      snapshot: effectivePortfolioComparisonSnapshot,
      result: portfolioComparisonQuery.data,
      lastUpdatedAt: new Date(portfolioComparisonQuery.dataUpdatedAt).toISOString(),
    } satisfies CachedCalculation<PortfolioComparisonRequestSnapshot, CorporateComparisonResponse>);
  }, [effectivePortfolioComparisonSnapshot, portfolioComparisonQuery.data, portfolioComparisonQuery.dataUpdatedAt]);


  useEffect(() => {
    if (!attributionQuery.data || !portfolioAttributionRequestedSnapshot) return;
    writeSessionCache(PORTFOLIO_ATTRIBUTION_CACHE_KEY, {
      snapshot: portfolioAttributionRequestedSnapshot,
      result: attributionQuery.data,
      lastUpdatedAt: new Date(attributionQuery.dataUpdatedAt).toISOString(),
    } satisfies CachedCalculation<AttributionRequestSnapshot, AttributionResult>);
  }, [attributionQuery.data, attributionQuery.dataUpdatedAt, portfolioAttributionRequestedSnapshot]);

  const invalidatePortfolioCompanyQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["portfolio-browser-companies"] }),
      queryClient.invalidateQueries({ queryKey: ["corporate-companies"] }),
      queryClient.invalidateQueries({ queryKey: ["corporate-watchlist-holdings"] }),
    ]);
  }, [queryClient]);

  const refreshPortfolioQueries = useCallback(async () => {
    const refreshedWatchlist = await watchlistQuery.refetch();
    await syncStatusQuery.refetch();
    await invalidatePortfolioCompanyQueries();
    return refreshedWatchlist.data ?? [];
  }, [invalidatePortfolioCompanyQueries, syncStatusQuery, watchlistQuery]);

  const patchWatchlistCache = useCallback((payload: WatchlistItemPayload) => {
    queryClient.setQueryData<PortfolioStock[]>(["portfolio-watchlist"], (current) => (
      (current ?? EMPTY_WATCHLIST).map((stock) => (
        stock.ticker === payload.ticker
          ? {
            ...stock,
            name: payload.name,
            sector: payload.sector,
            group_name: payload.group_name,
            weight: payload.weight,
          }
          : stock
      ))
    ));
  }, [queryClient]);

  const persistWatchlistItem = useCallback(async (
    payload: WatchlistItemPayload,
    options: { invalidateCompanies?: boolean } = {},
  ) => {
    const response = await fetchApi<WatchlistItemPayload>("/portfolio/watchlist", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    patchWatchlistCache(response);
    if (options.invalidateCompanies ?? true) {
      await invalidatePortfolioCompanyQueries();
    }
    return response;
  }, [invalidatePortfolioCompanyQueries, patchWatchlistCache]);

  const persistPortfolioPreferences = useCallback(async (nextAmount: number) => {
    const response = await fetchApi<PortfolioPreferences>("/portfolio/preferences", {
      method: "PUT",
      body: JSON.stringify({
        total_investment_amount: Math.max(nextAmount, 0),
        transaction_fee_rate: DEFAULT_TRANSACTION_FEE_RATE,
        updated_at: portfolioPreferences.updated_at,
      } satisfies PortfolioPreferences),
    });
    queryClient.setQueryData<PortfolioPreferences>(["portfolio-preferences"], response);
    return response;
  }, [portfolioPreferences.updated_at, queryClient]);

  const addWatchlistMutation = useMutation({
    mutationFn: async (payload: WatchlistItemPayload) =>
      fetchApi<WatchlistItemPayload>("/portfolio/watchlist", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: async (payload) => {
      setMutationMessage(
        payload.weight > 0
          ? `Saved ${payload.ticker} with an active portfolio allocation.`
          : `Saved ${payload.ticker} as a tracked holding with 0.0% portfolio allocation.`,
      );
      setNewTicker("");
      setNewName("");
      setNewSector("");
      setAddToWatchlistOnly(true);
      setNewWeightPercent("");
      await refreshPortfolioQueries();
    },
    onError: (error) => {
      setMutationMessage(error instanceof Error ? error.message : "Failed to add holding.");
    },
  });

  const deleteWatchlistMutation = useMutation({
    mutationFn: async (ticker: string) =>
      fetchApi<{ status: string; ticker: string }>(`/portfolio/watchlist/${ticker}`, {
        method: "DELETE",
      }),
    onSuccess: async ({ ticker }) => {
      setMutationMessage(`Removed ${ticker} from the watchlist.`);
      await refreshPortfolioQueries();
    },
    onError: (error) => {
      setMutationMessage(error instanceof Error ? error.message : "Failed to remove holding.");
    },
  });

  const resyncWatchlistMutation = useMutation({
    mutationFn: async () =>
      fetchApi<WatchlistResyncResult>("/portfolio/watchlist/resync", {
        method: "POST",
      }),
    onSuccess: async (result) => {
      await refreshPortfolioQueries();
      setMutationMessage(`Imported ${result.item_count} holdings from stock_targets.json into the DB watchlist.`);
    },
    onError: (error) => {
      setMutationMessage(error instanceof Error ? error.message : "Failed to resync watchlist.");
    },
  });

  const syncWatchlistMutation = useMutation({
    mutationFn: async () =>
      fetchApi<WatchlistSyncResult>("/portfolio/watchlist/sync", {
        method: "POST",
      }),
    onSuccess: async (result) => {
      await refreshPortfolioQueries();
      setMutationMessage(`Exported ${result.item_count} holdings to data/exports/watchlist-export.json.`);
    },
    onError: (error) => {
      setMutationMessage(error instanceof Error ? error.message : "Failed to sync watchlist to JSON.");
    },
  });

  const handleAddHolding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ticker = newTicker.trim().toUpperCase();
    if (!ticker) {
      setMutationMessage("Ticker is required.");
      return;
    }

    const parsedWeightPercent = Number(newWeightPercent.trim() || "0");
    if (!addToWatchlistOnly && (!Number.isFinite(parsedWeightPercent) || parsedWeightPercent < 0 || parsedWeightPercent > 100)) {
      setMutationMessage("Initial allocation must be between 0 and 100%.");
      return;
    }

    setMutationMessage(null);
    const existing = watchlist.find((stock) => stock.ticker === ticker);
    await addWatchlistMutation.mutateAsync({
      ticker,
      name: newName.trim() || existing?.name || ticker,
      sector: newSector.trim() || existing?.sector || "",
      group_name: existing?.group_name || "custom",
      weight: addToWatchlistOnly ? (existing?.weight ?? 0) : parsedWeightPercent / 100,
    });
  };

  const handleAddCandidate = async (company: CorporateCompany, groupName = "browser") => {
    const ticker = company.ticker.trim().toUpperCase();
    if (!ticker || watchlist.some((stock) => stock.ticker === ticker)) return;
    setMutationMessage(null);
    await addWatchlistMutation.mutateAsync({
      ticker,
      name: company.name || ticker,
      sector: company.sector ?? "",
      group_name: groupName,
      weight: 0,
    });
    setPortfolioBrowserSearch("");
  };

  const handleOpenCompanyDetail = (company: CorporateCompany) => {
    const existingStock = watchlist.find((stock) => stock.ticker === company.ticker) ?? null;
    setSelectedStockContext({
      ticker: company.ticker,
      fallbackStock: buildBrowserPortfolioStock(company, existingStock),
    });
  };

  const handleDeleteHolding = async (stock: PortfolioStock) => {
    setMutationMessage(null);
    await deleteWatchlistMutation.mutateAsync(stock.ticker);
  };

  const handleUpdateStockSector = async (stock: PortfolioStock, nextSector: string) => {
    const normalizedSector = nextSector.trim();
    if (selectedWatchlistStock?.ticker === stock.ticker) {
      await persistWatchlistItem({
        ticker: stock.ticker,
        name: stock.name || stock.ticker,
        sector: normalizedSector,
        group_name: stock.group_name,
        weight: selectedWatchlistStock.weight,
      });
    } else {
      await fetchApi<CorporateCompany>("/corporate/companies", {
        method: "POST",
        body: JSON.stringify({
          ticker: stock.ticker,
          name: stock.name || stock.ticker,
          sector: normalizedSector,
          source: "manual",
        } satisfies CorporateCompany),
      });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-browser-companies"] });
      await queryClient.invalidateQueries({ queryKey: ["corporate-companies"] });
    }

    setSelectedStockContext((current) => (
      current && current.ticker === stock.ticker
        ? {
          ...current,
          fallbackStock: {
            ...current.fallbackStock,
            sector: normalizedSector,
          },
        }
        : current
    ));
    setMutationMessage(`Updated sector for ${stock.ticker}.`);
  };

  const handleUpdateStockTheme = async (stock: PortfolioStock, themeId: string) => {
    await fetchApi<PortfolioStock>(`/portfolio/watchlist/${encodeURIComponent(stock.ticker)}/theme`, {
      method: "POST",
      body: JSON.stringify({ theme: themeId }),
    });
    await queryClient.refetchQueries({ queryKey: ["portfolio-watchlist"] });
  };

  const handleAllocationDraftChange = (stock: PortfolioStock, nextValue: string) => {
    setWeightDrafts((current) => ({
      ...current,
      [stock.ticker]: `${clampAllocationPercent(Number(nextValue || "0"))}`,
    }));
  };

  const handleNormalizeWeights = async () => {
    const normalized = normalizeWeightsToOne(
      watchlist
        .map((stock) => ({
          ...stock,
          weight: parseAllocationPercent(weightDrafts[stock.ticker] ?? (stock.weight * 100).toFixed(1), stock.weight * 100) / 100,
        }))
        .filter((stock) => stock.weight > 0),
    );
    if (normalized.length === 0) {
      setMutationMessage("Assign positive weights before normalizing.");
      return;
    }

    setMutationMessage(null);
    setSavingAllocationTickers(normalized.map((stock) => stock.ticker));
    allocationAutoSaveInFlightRef.current = true;
    try {
      for (const stock of normalized) {
        await persistWatchlistItem({
          ticker: stock.ticker,
          name: stock.name,
          sector: stock.sector,
          group_name: stock.group_name,
          weight: stock.weight,
        }, { invalidateCompanies: false });
      }
    } finally {
      allocationAutoSaveInFlightRef.current = false;
      setSavingAllocationTickers([]);
    }
    setWeightDrafts({});
    setMutationMessage("Normalized saved stock weights to 100.0% invested.");
    if (applyAllocationToSnapshot) {
      try {
        const refreshed = await savePortfolioSnapshot();
        await queryClient.invalidateQueries({ queryKey: ["portfolio-comparison-summary"] });
        setPortfolioComparisonMode("snapshot");
        setPortfolioComparisonMessage(`Normalized weights and updated the ${formatDateLabel(refreshed.snapshot.as_of_date)} snapshot.`);
      } catch (error) {
        setPortfolioComparisonMessage(error instanceof Error ? error.message : "Failed to update the snapshot after normalizing weights.");
      }
    }
  };

  const handleImportJson = async () => {
    if (!importJsonArmed) {
      setMutationMessage("Arm Import JSON before replacing the DB watchlist from file.");
      return;
    }
    const confirmed = window.confirm(
      "Import JSON will replace the current DB watchlist with stock_targets.json contents. Saved DB weights and holdings not present in the file can be overwritten. Continue?",
    );
    if (!confirmed) return;
    setMutationMessage(null);
    await resyncWatchlistMutation.mutateAsync();
    setImportJsonArmed(false);
  };

  const savePortfolioSnapshot = useCallback(async () => (
    fetchApi<CorporateComparisonResponse>("/corporate/comparison/snapshot", {
      method: "POST",
      params: {
        comparison_universe: portfolioComparisonUniverse,
        benchmark_ticker: normalizedBenchmarkTicker,
        custom_tickers: portfolioComparisonUniverse === "custom" ? normalizedCustomTickersInput : "",
      },
    })
  ), [normalizedBenchmarkTicker, normalizedCustomTickersInput, portfolioComparisonUniverse]);

  useEffect(() => {
    if (allocationAutoSaveInFlightRef.current || watchlist.length === 0) return;
    const debouncedWeightDrafts = JSON.parse(debouncedWeightDraftsKey) as Record<string, string>;

    const pendingChanges = watchlist
      .map((stock) => {
        const rawDraft = debouncedWeightDrafts[stock.ticker];
        if (rawDraft == null) return null;
        const nextPercent = parseAllocationPercent(rawDraft, stock.weight * 100);
        const currentPercent = Number((stock.weight * 100).toFixed(1));
        if (Math.abs(nextPercent - currentPercent) < 0.05) return null;
        return { stock, nextPercent };
      })
      .filter((entry): entry is { stock: PortfolioStock; nextPercent: number } => Boolean(entry));

    if (pendingChanges.length === 0) return;

    allocationAutoSaveInFlightRef.current = true;
    setSavingAllocationTickers(pendingChanges.map(({ stock }) => stock.ticker));
    void (async () => {
      try {
        for (const entry of pendingChanges) {
          await persistWatchlistItem({
            ticker: entry.stock.ticker,
            name: entry.stock.name,
            sector: entry.stock.sector,
            group_name: entry.stock.group_name,
            weight: entry.nextPercent / 100,
          }, { invalidateCompanies: false });
        }
        setWeightDrafts((current) => {
          const nextDrafts = { ...current };
          for (const entry of pendingChanges) {
            delete nextDrafts[entry.stock.ticker];
          }
          return nextDrafts;
        });
        setMutationMessage(
          pendingChanges.length === 1
            ? `Saved allocation for ${pendingChanges[0].stock.ticker}.`
            : `Saved ${pendingChanges.length} allocation changes automatically.`,
        );
        if (applyAllocationToSnapshot) {
          try {
            const refreshed = await savePortfolioSnapshot();
            await queryClient.invalidateQueries({ queryKey: ["portfolio-comparison-summary"] });
            setPortfolioComparisonMode("snapshot");
            setPortfolioComparisonMessage(
              `Saved allocation changes and updated the ${formatDateLabel(refreshed.snapshot.as_of_date)} snapshot.`,
            );
          } catch (error) {
            setPortfolioComparisonMessage(error instanceof Error ? error.message : "Failed to update the snapshot after saving allocation changes.");
          }
        }
      } catch (error) {
        setMutationMessage(error instanceof Error ? error.message : "Failed to save allocation changes.");
      } finally {
        allocationAutoSaveInFlightRef.current = false;
        setSavingAllocationTickers([]);
      }
    })();
  }, [applyAllocationToSnapshot, debouncedWeightDraftsKey, persistWatchlistItem, queryClient, savePortfolioSnapshot, watchlist]);

  useEffect(() => {
    if (!portfolioPreferencesQuery.data || totalInvestmentAutoSaveInFlightRef.current) return;
    const parsedAmount = Number(debouncedTotalInvestmentInput.trim());
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) return;
    if (Math.abs(parsedAmount - portfolioPreferences.total_investment_amount) < 0.01) return;

    totalInvestmentAutoSaveInFlightRef.current = true;
    setSavingTotalInvestment(true);
    void persistPortfolioPreferences(parsedAmount)
      .then((response) => {
        setMutationMessage(`Saved total investment amount (${formatCurrencyCompact(response.total_investment_amount)}).`);
      })
      .catch((error: unknown) => {
        setMutationMessage(error instanceof Error ? error.message : "Failed to save total investment amount.");
      })
      .finally(() => {
        totalInvestmentAutoSaveInFlightRef.current = false;
        setSavingTotalInvestment(false);
      });
  }, [debouncedTotalInvestmentInput, persistPortfolioPreferences, portfolioPreferences, portfolioPreferencesQuery.data]);

  const handleAllocationValueDoubleClick = (stock: PortfolioStock) => {
    setEditingAllocationTicker(stock.ticker);
    window.requestAnimationFrame(() => {
      weightInputRefs.current[stock.ticker]?.focus();
      weightInputRefs.current[stock.ticker]?.select();
    });
  };

  const handleAllocationInputBlur = () => {
    setEditingAllocationTicker(null);
  };

  const handleAllocationInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "Escape") {
      event.currentTarget.blur();
    }
  };

  const handleRefreshPortfolioAnalysis = () => {
    if (!hasHoldings) {
      setPortfolioAnalysisMessage("Add holdings before refreshing portfolio analysis.");
      return;
    }

    setPortfolioComparisonRequestedSnapshot(comparisonCurrentSnapshot);
    setPortfolioAttributionRequestedSnapshot(canRunAttribution ? attributionCurrentSnapshot : null);
    setPortfolioAnalysisRefreshToken(`${Date.now()}`);
    setPortfolioAnalysisMessage(
      canRunAttribution
        ? "Refreshing portfolio comparison and attribution."
        : "Refreshing portfolio comparison. Attribution stays paused until saved weights are 100% or below.",
    );
  };

  const handleFocusAllocationForStock = (stock: PortfolioStock) => {
    const watchlistStock = watchlist.find((entry) => entry.ticker === stock.ticker) ?? null;
    if (!watchlistStock) {
      setNewTicker(stock.ticker);
      setNewName(stock.name);
      setNewSector(stock.sector);
      setAddToWatchlistOnly(false);
      setNewWeightPercent(stock.weight > 0 ? (stock.weight * 100).toFixed(1) : "5");
      setMutationMessage(`Prepared ${stock.ticker} in Manual Add so you can save it back into the portfolio with an allocation.`);
      requestAllocationFocus(null);
      return;
    }

    setMutationMessage(
      watchlistStock.weight > 0
        ? `${watchlistStock.ticker} already has a saved allocation. Adjust the weight below if needed.`
        : `Allocation controls opened for ${watchlistStock.ticker}. Set a positive weight to include it in portfolio testing.`,
    );
    requestAllocationFocus(watchlistStock.ticker);
  };

  // D9: the two dates and the benchmark sit behind one trigger at the right end of the tab row.
  const periodControl = (
    <PeriodControl start={holdingStartDate} end={attributionAsOfDate}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 type-small text-[var(--ink-muted)]">
                  <InfoTooltip
                    label="Holding Start Date"
                    description="Sets the starting point for return, attribution, and beta calculations. Use the date the stock was added or the position was first held; this prevents multi-year winners from showing inflated returns when the actual holding period is shorter."
                  />
                  <input
                    type="date"
                    value={holdingStartDate}
                    onChange={(event) => setHoldingStartDate(event.target.value)}
                    max={attributionAsOfDate || new Date().toISOString().slice(0, 10)}
                    className="rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 type-body text-[var(--ink)]"
                  />
                </label>
                <label className="flex flex-col gap-1 type-small text-[var(--ink-muted)]">
                  <InfoTooltip
                    label="Return End Date"
                    description="Sets the ending date for return, attribution, and beta calculations. Leave blank to use the latest available cached market date."
                  />
                  <input
                    type="date"
                    value={attributionAsOfDate}
                    onChange={(event) => setAttributionAsOfDate(event.target.value)}
                    min={holdingStartDate || undefined}
                    max={new Date().toISOString().slice(0, 10)}
                    className="rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 type-body text-[var(--ink)]"
                  />
                </label>
              </div>
                <label className="flex items-center gap-2 type-small text-[var(--ink-muted)]">
                  <InfoTooltip
                    label="Benchmark"
                    description="Manual benchmark ticker input always wins. Presets are just fast selectors for common baselines. Whatever benchmark is active when you save a snapshot is stored with that snapshot for historical consistency."
                  />
                  <input
                    aria-label="Portfolio benchmark ticker"
                    value={portfolioComparisonBenchmarkTicker}
                    onChange={(event) => {
                      setPortfolioComparisonBenchmarkTicker(event.target.value.toUpperCase());
                    }}
                    className="w-24 rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 type-small text-[var(--ink)]"
                  />
                </label>
                <label className="flex items-center gap-2 type-small text-[var(--ink-muted)]">
                  <InfoTooltip
                    label="Benchmark preset"
                    description="Use presets for the common S&P 500 or Korea-market baselines. Selecting Manual ticker means the current benchmark symbol does not match one of the preset shortcuts."
                  />
                  <select
                    aria-label="Portfolio benchmark preset"
                    value={benchmarkPresetIdForTicker(portfolioComparisonBenchmarkTicker)}
                    onChange={(event) => {
                      const selectedPreset = PORTFOLIO_BENCHMARK_PRESETS.find((preset) => preset.id === event.target.value);
                      if (selectedPreset) {
                        setPortfolioComparisonBenchmarkTicker(selectedPreset.ticker);
                      }
                    }}
                    className="rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 type-small text-[var(--ink)]"
                  >
                    {PORTFOLIO_BENCHMARK_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                    <option value="custom">Manual ticker</option>
                  </select>
                </label>
    </PeriodControl>
  );

  // Panel bodies: the sections that used to stack down the page, moved verbatim into
  // the rail-triggered side panels. Only the tile grid stays in the scrolling region.
  const attributionPanelBody = (
    <>
      <div className="flex flex-col gap-3 px-4 pt-3">
        <div className="flex flex-wrap items-end gap-3">
          <button
            type="button"
            onClick={handleRefreshPortfolioAnalysis}
            className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-1)] border border-[var(--line)] px-3 py-2 type-small text-[var(--ink)] hover:border-[var(--brand)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${portfolioComparisonCalculating ? "animate-spin" : ""}`} />
            Refresh Analysis
          </button>
        </div>
        {portfolioAnalysisMessage && <span className="type-small text-[var(--ink-muted)]">{portfolioAnalysisMessage}</span>}
      </div>
      {/* Attribution loading state: skeleton KPI cards and chart panels while results calculate. */}
      {attributionView.showLoading && (
        <>
          <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <KpiSkeletonCard />
            <KpiSkeletonCard />
            <KpiSkeletonCard />
            <KpiSkeletonCard />
          </section>
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartSkeleton title="Loading attribution allocation" />
            <ChartSkeleton title="Loading attribution effects" />
          </section>
        </>
      )}

      {/* Attribution results: KPI summary, benchmark methodology, allocation, and effects charts. */}
      {attributionView.showResults && attributionData && (
        <PortfolioAttributionSummary
          attributionData={attributionData}
          allocationData={allocationData}
          waterfallData={waterfallData}
          holdingStartDate={holdingStartDate}
          attributionAsOfDate={attributionAsOfDate}
        />
      )}
      {attributionView.showNoHoldings && !watchlistQuery.isError && (
        <StatusPanel
          title="Attribution Pending Portfolio"
          message="Attribution charts will appear once the watchlist has at least one holding."
        />
      )}

      {attributionView.showIdle && (
        <StatusPanel
          title="Attribution Idle"
          message="Attribution stays idle on first load. Click Refresh Analysis when you want current portfolio attribution."
        />
      )}

      {weightsOverflow && (
        <StatusPanel
          title="Allocation Weights Exceed 100%"
          message={`Saved watchlist allocations currently sum to ${formatNumber(totalStoredWeight, "percent", { digits: 1 })}. Reduce total assigned weight to 100% or below before attribution can run.`}
          tone="warning"
        />
      )}

      {attributionView.showError && (
        <StatusPanel
          title="Attribution Engine Unavailable"
          message="Attribution request failed. Check API health or input constraints and retry."
          tone="warning"
        />
      )}
    </>
  );

  const allocationPanelBody = (
    <>
      <section ref={allocationSectionRef} className="border border-[var(--line)] bg-[var(--surface-raised)] p-4">
        <div className="flex flex-col gap-2">
          {/* Title and its description live on the panel header; repeating them here
              showed the same words twice. The copy also described a full-width
              two-column section -- there is no left or right inside a 480px panel. */}
          <p className="type-body text-[var(--ink-muted)]">
            Weights save as you change them. Totals update in this panel.
          </p>
        </div>

        <div className="mt-4 grid min-w-72 grid-cols-1 gap-2 sm:grid-cols-5">
          <div className="bg-[var(--surface)] p-3 type-small">
            <div className="text-[var(--ink-muted)]">Tracked Names</div>
            <div className="type-figure-md mt-1 text-[var(--ink)]">{watchlist.length}</div>
          </div>
          <div className="bg-[var(--surface)] p-3 type-small">
            <div className="text-[var(--ink-muted)]">Allocated Names</div>
            <div className="type-figure-md mt-1 text-[var(--ink)]">{allocatedHoldingsCount}</div>
          </div>
          <div className="bg-[var(--surface)] p-3 type-small">
            <div className="text-[var(--ink-muted)]">Total Investment</div>
            <div className="type-figure-md mt-1 text-[var(--ink)]">{formatCurrencyCompact(totalInvestmentAmount)}</div>
          </div>
          <div className="bg-[var(--surface)] p-3 type-small">
            <div className="text-[var(--ink-muted)]">Invested Capital</div>
            <div className="type-figure-md mt-1 text-[var(--ink)]">{formatCurrencyCompact(allocationSummary.allocatedAmount)}</div>
            <div className="mt-1 type-caption text-[var(--ink-muted)]">{formatWeightPercent(investedWeight)} allocated</div>
          </div>
          <div className="bg-[var(--surface)] p-3 type-small">
            <div className="text-[var(--ink-muted)]">Implied Cash</div>
            <div className="type-figure-md mt-1 text-[var(--ink)]">{formatCurrencyCompact(totalInvestmentAmount * impliedCashWeight)}</div>
            <div className="mt-1 type-caption text-[var(--ink-muted)]">{formatWeightPercent(impliedCashWeight)} unallocated</div>
          </div>
          <div className="bg-[var(--surface)] p-3 type-small">
            <div className="text-[var(--ink-muted)]">Final Profit</div>
            <div className={`type-figure-md mt-1 ${metricToneClass(allocationSummary.finalProfit)}`}>
              {formatCurrencyCompact(allocationSummary.finalProfit)}
            </div>
            <div className="mt-1 type-caption text-[var(--ink-muted)]">
              Fee-aware using {formatNumber(portfolioPreferences.transaction_fee_rate, "percent", { digits: 1 })} exit fee
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
          <PortfolioCommandCenter
            browserSearch={portfolioBrowserSearch}
            setBrowserSearch={setPortfolioBrowserSearch}
            browserSearchResults={browserSearchResults}
            watchlistTickers={tickers}
            onOpenCompanyDetail={handleOpenCompanyDetail}
            onAddCandidate={(company) => void handleAddCandidate(company)}
            addingWatchlist={addWatchlistMutation.isPending}
            newTicker={newTicker}
            setNewTicker={setNewTicker}
            newName={newName}
            setNewName={setNewName}
            newSector={newSector}
            setNewSector={setNewSector}
            newWeightPercent={newWeightPercent}
            setNewWeightPercent={setNewWeightPercent}
            addToWatchlistOnly={addToWatchlistOnly}
            setAddToWatchlistOnly={setAddToWatchlistOnly}
            onAddHolding={handleAddHolding}
            existingTicker={Boolean(existingTicker)}
            onExportWatchlist={() => {
              setMutationMessage(null);
              void syncWatchlistMutation.mutateAsync();
            }}
            exportingWatchlist={syncWatchlistMutation.isPending}
            onImportJson={() => void handleImportJson()}
            importingJson={resyncWatchlistMutation.isPending}
            importJsonArmed={importJsonArmed}
            setImportJsonArmed={setImportJsonArmed}
            importUnavailableReason={peerSyncQuery.data?.enabled ? "Import is unavailable while watchlist sync is on." : null}
            syncStatus={syncStatusQuery.data}
            formatSyncTimestamp={formatSyncTimestamp}
            formatSectorLabel={sectorLabel}
          />

          <section className="border border-[var(--line)] bg-[var(--surface-raised)] p-4">
            <PortfolioAllocationEditor
              totalInvestmentInput={totalInvestmentInput}
              setTotalInvestmentInput={setTotalInvestmentInput}
              applyAllocationToSnapshot={applyAllocationToSnapshot}
              setApplyAllocationToSnapshot={setApplyAllocationToSnapshot}
              handleNormalizeWeights={handleNormalizeWeights}
              savingAllocationTickers={savingAllocationTickers}
              usingStoredWeights={usingStoredWeights}
              totalStoredWeight={totalStoredWeight}
              totalDraftWeightPercent={totalDraftWeightPercent}
              allocationSummary={allocationSummary}
              savingTotalInvestment={savingTotalInvestment}
              draftWeightsOverflow={draftWeightsOverflow}
              allocationRows={allocationRows}
              editingAllocationTicker={editingAllocationTicker}
              weightInputRefs={weightInputRefs}
              weightDrafts={weightDrafts}
              handleAllocationDraftChange={handleAllocationDraftChange}
              handleAllocationInputBlur={handleAllocationInputBlur}
              handleAllocationInputKeyDown={handleAllocationInputKeyDown}
              handleAllocationValueDoubleClick={handleAllocationValueDoubleClick}
              formatCurrencyCompact={formatCurrencyCompact}
              metricToneClass={metricToneClass}
              watchlist={watchlist}
            />
          </section>
        </div>
      </section>
    </>
  );


      const stocksPanel = (
        <>
          <div className="flex items-center justify-end px-4 pt-3">
            <button
              type="button"
              disabled={refreshNews.isPending}
              onClick={() => refreshNews.mutate()}
              className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-1)] px-2 py-1 type-small text-[var(--ink-muted)] hover:text-[var(--ink)]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshNews.isPending ? "animate-spin" : ""}`} />
              {newsFetchedAt === null
                ? t("portfolio.news.never")
                : Math.floor((nowMs - newsFetchedAt) / 60_000) < 1
                  ? t("portfolio.news.justNow")
                  : t("portfolio.news.updated", { minutes: formatNumber(Math.max(0, Math.floor((nowMs - newsFetchedAt) / 60_000)), "integer") })}
            </button>
          </div>
        {refreshSummary ? (
          <p data-testid="news-refresh-summary" className="px-4 pt-3 type-small text-[var(--ink-muted)]">
            {refreshSummary}
          </p>
        ) : null}
        {/* A failed bulk fetch leaves newsByTicker empty, and an empty entry is exactly
            what a ticker with no news looks like -- so without this line every tile reads
            as "never checked" and the failure is invisible. ERROR-LOG.md (2026-08-02) is
            the backend half of this same confusion: StockNewsCrawler used to report every
            provider failure as "no news". Saying it here keeps that fix from being undone
            one layer up. */}
        {bulkNewsQuery.isError ? (
          <p data-testid="news-load-error" className="px-4 pt-3 type-small text-[var(--down)]">
            Could not load news for the visible stocks. The headlines below are missing, not absent — press Refresh to try again.
          </p>
        ) : null}
        <StockTileGrid
          stocks={watchlist}
          newsByTicker={bulkNewsQuery.data?.tickers ?? {}}
          filter={gridFilter}
          onFilterChange={setGridFilter}
          followedGroup={FOLLOWED_GROUP}
          unfollowedGroup={UNFOLLOWED_GROUP}
          onToggleFollow={(stock) => toggleFollow.mutate(stock)}
          search={gridSearch}
          onSearchChange={setGridSearch}
          onOpenStock={openStockDetail}
          onAddStock={() => setAddStockOpen(true)}
          addStockLabel={t("portfolio.addStock.open")}
          renderTable={stocksView === "table" ? (visible) => (
            <HoldingsTable
              watchlist={visible}
              comparisonMetricsByTicker={comparisonMetricsByTicker}
              onSelect={openStockDetail}
              followedGroup={FOLLOWED_GROUP}
              onToggleFollow={(stock) => toggleFollow.mutate(stock)}
            />
          ) : undefined}
          statusSlot={<WatchlistPeerSyncStatus status={peerSyncQuery.data} />}
        />
        </>
      );

  return (
    <ErrorBoundary
      fallbackTitle="Portfolio Command Center Failure"
      fallbackMessage="Portfolio attribution UI failed to render safely."
    >
      <PortfolioShell
        tabs={[
          { key: "stocks", label: t("portfolio.tabs.stocks") },
          { key: "weights", label: t("portfolio.tabs.weights") },
          { key: "attribution", label: t("portfolio.tabs.attribution") },
        ]}
        tabsLabel={t("portfolio.tabs.label")}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabsAside={activeTab === "stocks" ? <StockViewToggle value={stocksView} onChange={setStocksView} /> : activeTab === "attribution" ? periodControl : null}
        panels={{ stocks: stocksPanel, weights: allocationPanelBody, attribution: attributionPanelBody }}
        notices={
          <>
            <div className="px-4 pt-3"><PortfolioGuide /></div>
            {/* Mutation feedback lives in the shell, not in a panel: its writers are spread
                across the holdings panel (Sync, delete), the stock detail modal (sector edit,
                add to portfolio) and the allocation panel, and only one panel mounts at a time. */}
            {mutationMessage ? (
              <p data-testid="portfolio-mutation-message" className="px-4 pt-3 type-body text-[var(--ink-muted)]">
                {mutationMessage}
              </p>
            ) : null}
            {/* Same reason: normalize-weights and save-allocation both write this from the
                allocation panel, but it used to render only inside the snapshot panel, so
                "Failed to update the snapshot after saving allocation changes." was never seen. */}
            {portfolioComparisonMessage ? (
              <p data-testid="portfolio-comparison-message" className="px-4 pt-3 type-body text-[var(--ink-muted)]">
                {portfolioComparisonMessage}
              </p>
            ) : null}
          </>
        }
      >
        <div className="px-4 pt-4">
          {/* Header: page identity and export. The attribution dates live in the Attribution tab. */}
          <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-col self-start">
              <h1 className="type-heading-5 text-[var(--ink)]">{t("portfolio.title")}</h1>
              <p data-testid="portfolio-subtitle" className="type-mono text-[var(--ink-muted)] mt-1">
                {t("portfolio.subtitle", {
                  count: formatNumber(watchlist.length, "integer"),
                  weight: formatNumber(totalStoredWeight, "percent", { digits: 1 }),
                })}
              </p>
            </div>
            <div className="flex flex-col gap-3 lg:items-end">
              <ExportButton tickers={tickers} weights={weights} benchmark={debouncedBenchmarkTicker} period="5y" currency="USD" dateFrom={holdingStartDate} asOfDate={attributionAsOfDate} />
            </div>
          </header>
        </div>
        <AddStockModal
          open={addStockOpen}
          onClose={() => setAddStockOpen(false)}
          search={portfolioBrowserSearch}
          onSearchChange={setPortfolioBrowserSearch}
          results={browserSearchResults}
          watchlistTickers={tickers}
          onAdd={(company) => void handleAddCandidate(company, FOLLOWED_GROUP)}
          adding={addWatchlistMutation.isPending}
          formatSectorLabel={sectorLabel}
        />
      </PortfolioShell>
      {/* Stock detail modal renders on demand when a holding is selected. */}
      {selectedStock && (
        <StockDetailModal
          stock={selectedStock}
          isInWatchlist={selectedStockIsInWatchlist}
          comparisonMetrics={comparisonMetricsByTicker[selectedStock.ticker] ?? EMPTY_COMPARISON_METRICS}
          snapshotMeta={activeSnapshotMeta}
          comparisonUniverse={portfolioComparisonUniverse}
          comparisonBenchmarkTicker={debouncedBenchmarkTicker}
          comparisonCustomTickersInput={debouncedCustomTickersInput}
          activeSnapshotVersion={activeSnapshotMeta?.snapshot_version ?? ""}
          onAddToPortfolio={handleFocusAllocationForStock}
          onUpdateSector={(stock, nextSector) => handleUpdateStockSector(stock, nextSector)}
          themes={watchlistThemesQuery.data ?? EMPTY_THEMES}
          onUpdateTheme={(stock, themeId) => handleUpdateStockTheme(stock, themeId)}
          onRemoveFromWatchlist={(stock) => void handleDeleteHolding(stock)}
          onClose={() => setSelectedStockContext(null)}
        />
      )}
    </ErrorBoundary>
  );
}
