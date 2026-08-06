"use client";

import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ChevronDown, ChevronRight, PieChart, RefreshCw, SlidersHorizontal, Table as TableIcon, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
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
import { ViewToggle, type ViewMode } from "@/components/ui/ViewToggle";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import {
  benchmarkPresetIdForTicker,
  DEFAULT_PORTFOLIO_BENCHMARK_TICKER,
  PORTFOLIO_BENCHMARK_PRESETS,
} from "@/lib/benchmarkPresets";
import { useDebounce } from "@/hooks/useDebounce";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState, SkeletonCard } from "@/components/ui/LoadingState";
import { ActionButton } from "@/components/ui/ActionButton";
import { PortfolioSnapshotSummary } from "./components/PortfolioSnapshotSummary";
import { PortfolioAttributionSummary } from "./components/PortfolioAttributionSummary";
import { PortfolioAllocationEditor } from "./components/PortfolioAllocationEditor";
import { PortfolioCommandCenter } from "./components/PortfolioCommandCenter";
import { PortfolioShell } from "./components/PortfolioShell";
import { selectVisibleStocks, StockTileGrid, type GridFilter } from "./components/StockTileGrid";
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="status" aria-live="polite">
      <div className="w-full max-w-xl rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5 shadow-2xl">
        <div className="text-sm font-semibold text-[var(--text-primary)]">{label}</div>
        <div className="mt-4 h-24 animate-pulse rounded bg-[var(--surface-muted)]" />
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

const SnapshotHistoryModal = dynamic(
  () => import("./components/SnapshotHistoryModal").then((mod) => mod.SnapshotHistoryModal),
  {
    loading: () => <ModalLoadingOverlay label="Loading saved snapshots" />,
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
  last_close: number;
  delta: WatchlistDelta;
  sparkline: number[];
  // Watchlist insertion order. The only recency signal the row carries, and the
  // tile grid's no-weights fallback orders by it. 0 means "not a watchlist row".
  id: number;
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
  dcf_value: number;
  current_price: number;
  dcf_implied_return: number;
  capm_expected_return: number;
  expected_return_spread: number;
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

export interface CorporateComparisonHistoryPoint {
  as_of_date: string;
  generated_at: string;
  snapshot_version: string;
  snapshot_source: string;
  comparison_universe: string;
  benchmark_ticker: string;
  stock_count: number;
  // Nullable: both averages cover only the rows whose equity bridge resolved, so a
  // snapshot with no such rows has no average at all. Render an unavailable state,
  // never a zero.
  average_expected_return_spread: number | null;
  average_roic_minus_wacc: number;
  average_dcf_value: number | null;
  // Which definition average_dcf_value carries: enterprise value below 2, intrinsic value
  // per share from 2 on. 0 means the snapshot predates the stored column.
  metric_schema_version: number;
  market_expected_return: number;
}

export interface CorporateComparisonHistoryResponse {
  comparison_universe: string;
  benchmark_ticker: string;
  custom_tickers: string[];
  points: CorporateComparisonHistoryPoint[];
}

interface CorporateComparisonStockHistoryPoint {
  as_of_date: string;
  generated_at: string;
  snapshot_version: string;
  snapshot_source: string;
  benchmark_ticker: string;
  current_price: number;
  roic_minus_wacc: number;
  dcf_implied_return: number;
  expected_return_spread: number;
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

interface SectorGroup {
  sector: string;
  holdings: PortfolioStock[];
}

const PORTFOLIO_DATE_FILTERS_STORAGE_KEY = "moneyview.portfolio.dateFilters.v1";
const PORTFOLIO_COMPARISON_CACHE_KEY = "moneyview.portfolio.comparison-cache.v1";
const PORTFOLIO_COMPARISON_HISTORY_CACHE_KEY = "moneyview.portfolio.comparison-history-cache.v1";
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

type PortfolioComparisonHistoryRequestSnapshot = {
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
    window.sessionStorage.removeItem(key);
    return null;
  }
}

function writeSessionCache<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(key, JSON.stringify(value));
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
    window.localStorage.removeItem(PORTFOLIO_DATE_FILTERS_STORAGE_KEY);
    return {
      holdingStartDate: "",
      attributionAsOfDate: "",
    };
  }
}

const EMPTY_WATCHLIST: PortfolioStock[] = [];
const WEIGHT_SUM_TOLERANCE = 1e-6;
export const MOVING_AVERAGE_WINDOWS = [5, 20, 60, 120] as const;
export const MOVING_AVERAGE_COLORS: Record<(typeof MOVING_AVERAGE_WINDOWS)[number], string> = {
  5: "#F97316",
  20: "#10B981",
  60: "#3B82F6",
  120: "#111827",
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

function WatchlistSkeletonGrid() {
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, idx) => (
        <div
          key={`watchlist-skeleton-${idx}`}
          className="bg-[var(--bg-surface)] rounded-[var(--radius)] border border-[var(--border)] p-4 animate-pulse"
        >
          <div className="flex justify-between items-start mb-3">
            <div className="space-y-2">
              <div className="h-4 w-24 bg-gray-200 rounded" />
              <div className="h-3 w-14 bg-gray-200 rounded" />
            </div>
            <div className="space-y-2">
              <div className="h-4 w-14 bg-gray-200 rounded" />
              <div className="h-5 w-12 bg-gray-200 rounded" />
            </div>
          </div>
          <div className="h-8 w-full bg-[var(--bg-subtle)] rounded" />
        </div>
      ))}
    </section>
  );
}

// Shared empty/error state panel for watchlist and attribution engine failures.
export function StatusPanel({ title, message, tone = "neutral" }: { title: string; message: string; tone?: "neutral" | "warning" }) {
  if (tone === "warning") return <ErrorState title={title} message={message} />;
  return <EmptyState title={title} description={message} />;
}

// Compact identity block reused by holding cards and table rows.
function StockIdentity({ stock }: { stock: PortfolioStock }) {
  return (
    <div>
      <h3 className="font-bold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
        {stock.name || stock.ticker}
      </h3>
      <p className="text-xs font-light tracking-wide text-[var(--text-muted)]">{stock.ticker}</p>
    </div>
  );
}

function MetricCell({ metric, toneClass }: { metric: PortfolioTickerMetrics["roicMinusWacc"]; toneClass: string }) {
  const subtitle = metricSubtitle(metric);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className={`font-semibold tabular-nums ${toneClass}`} title={metricDisplayTitle(metric)}>
        {metric.displayValue}
      </div>
      <div className="flex flex-wrap justify-end gap-1">
        <MetricQualityBadge quality={metric.quality} />
      </div>
      {subtitle ? (
        <div className="max-w-[12rem] text-right text-[11px] leading-tight text-[var(--text-muted)]">
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
  };
}

// Table layout for holdings when the user switches away from card view.
function HoldingsTable({
  watchlist,
  comparisonMetricsByTicker,
  onSelect,
  onDelete,
  deletingTicker,
}: {
  watchlist: PortfolioStock[];
  comparisonMetricsByTicker: Record<string, PortfolioTickerMetrics>;
  onSelect: (stock: PortfolioStock) => void;
  onDelete: (stock: PortfolioStock) => void;
  deletingTicker?: string | null;
}) {
  return (
    <section className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-panel)]">
      <div className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2 text-xs text-[var(--text-muted)] sm:hidden">
        Mobile view keeps the core comparison columns visible first. Open a stock row for the full detail workflow.
      </div>
      <table className="min-w-[760px] w-full text-sm lg:min-w-[1120px]">
        <thead className="sticky top-0 z-10 bg-[var(--surface-muted)] text-left text-[var(--text-muted)]">
          <tr>
            <th className="px-4 py-3 font-semibold">Ticker</th>
            <th className="hidden px-4 py-3 font-semibold lg:table-cell">Sector</th>
            <th className="px-4 py-3 text-right font-semibold">Current Price</th>
            <th className="hidden px-4 py-3 text-right font-semibold md:table-cell">Trend</th>
            <th className="px-4 py-3 text-right font-semibold">ROIC - WACC</th>
            <th className="px-4 py-3 text-right font-semibold">DCF Upside</th>
            <th className="px-4 py-3 text-right font-semibold">Expected vs Market</th>
            <th className="hidden px-4 py-3 text-right font-semibold md:table-cell">Volatility</th>
            <th className="hidden px-4 py-3 text-right font-semibold lg:table-cell">Weight</th>
            <th className="hidden px-4 py-3 text-right font-semibold xl:table-cell">Change</th>
            <th className="hidden px-4 py-3 text-right font-semibold xl:table-cell">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]/60">
          {watchlist.map((stock) => {
            const deltaPct = stock.delta?.delta_pct ?? 0;
            const metrics = comparisonMetricsByTicker[stock.ticker] ?? EMPTY_COMPARISON_METRICS;
            return (
              <tr
                key={stock.ticker}
                className="cursor-pointer hover:bg-[var(--surface-muted)]/50"
                onClick={() => onSelect(stock)}
              >
                <td className="px-4 py-3">
                  <div className="font-bold text-[var(--text-primary)]">{stock.ticker}</div>
                  <div className="text-xs font-light tracking-wide text-[var(--text-muted)]">{stock.name || stock.ticker}</div>
                  <div className="mt-1 text-[length:var(--type-caption)] text-[var(--text-muted)] lg:hidden">{sectorLabel(stock.sector)}</div>
                </td>
                <td className="hidden px-4 py-3 text-[var(--text-muted)] lg:table-cell">{sectorLabel(stock.sector)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCurrencyCompact(metrics.currentPrice ?? stock.last_close)}</td>
                <td className="hidden px-4 py-3 md:table-cell">
                  <div className="ml-auto w-24">
                    <Sparkline
                      data={stock.sparkline}
                      height={24}
                      color={deltaPct >= 0 ? "var(--delta-up)" : "var(--delta-down)"}
                    />
                  </div>
                </td>
                <td className="px-4 py-3 text-right align-top">
                  <MetricCell metric={metrics.roicMinusWacc} toneClass={portfolioMetricToneClass(metrics.roicMinusWacc)} />
                </td>
                <td className="px-4 py-3 text-right align-top">
                  <MetricCell metric={metrics.dcfUpside} toneClass={portfolioMetricToneClass(metrics.dcfUpside)} />
                </td>
                <td className="px-4 py-3 text-right align-top">
                  <MetricCell metric={metrics.expectedVsMarket} toneClass={portfolioMetricToneClass(metrics.expectedVsMarket)} />
                </td>
                <td className="hidden px-4 py-3 text-right align-top md:table-cell">
                  <MetricCell metric={metrics.volatility} toneClass={portfolioVolatilityToneClass(metrics.volatility)} />
                </td>
                <td className="hidden px-4 py-3 text-right tabular-nums lg:table-cell">
                  {formatWeightPercent(stock.weight)}
                </td>
                <td className="hidden px-4 py-3 text-right xl:table-cell">
                  <DeltaBadge value={deltaPct} />
                </td>
                <td className="hidden px-4 py-3 text-right xl:table-cell">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(stock);
                    }}
                    disabled={deletingTicker === stock.ticker}
                    className="inline-flex items-center gap-1 rounded-[var(--radius)] border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--delta-down)] disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {deletingTicker === stock.ticker ? "Removing" : "Remove"}
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

function portfolioStatus(label: string, value: number) {
  if (label === "beta") return value <= 1.2 ? "Good: near or below market risk." : "Risky: above-market sensitivity.";
  if (label === "active") return value >= 0 ? "Good: outperforming benchmark." : "Bad: underperforming benchmark.";
  if (label === "return") return value >= 0 ? "Good: positive return." : "Bad: negative return.";
  if (label === "change") return value >= 0 ? "Good: price increased versus previous close." : "Bad: price declined versus previous close.";
  return "Review in context.";
}

function formatWeightPercent(weight: number) {
  return `${(weight * 100).toFixed(1)}%`;
}

export function isMetricOutlier(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) || Math.abs(value) > 500;
}

export function formatMetricPercent(value: number | null | undefined) {
  if (isMetricOutlier(value)) return "N/A";
  return `${Number(value).toFixed(2)}%`;
}

export function formatCurrencyCompact(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
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
  if (isMetricOutlier(value)) return "text-amber-700";
  if (value === 0) return "text-[var(--text-muted)]";
  return Number(value) > 0 ? "text-[var(--delta-up)]" : "text-[var(--delta-down)]";
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
  expectedVsMarket: { value: null, displayValue: "N/A", quality: "missing", reason: "No portfolio comparison data has been loaded yet." },
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

function portfolioComparisonUniverseHelpText(value: PortfolioComparisonUniverse) {
  if (value === "custom") {
    return "Custom Universe compares the selected benchmark against only the tickers you enter below. Use it when you want to test a short candidate list without changing the tracked watchlist.";
  }
  return "Portfolio + Benchmark uses the current tracked holdings as the stock comparison set and keeps the benchmark as the external hurdle rate.";
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

function isPortfolioComparisonHistorySnapshotStale(
  requested: PortfolioComparisonHistoryRequestSnapshot | null,
  current: PortfolioComparisonHistoryRequestSnapshot,
) {
  return Boolean(
    requested
    && (
      requested.comparisonUniverse !== current.comparisonUniverse
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

function portfolioSnapshotHistoryViewState({
  comparisonHistoryData,
  isLoading,
  isError,
  recentSnapshotCount,
}: {
  comparisonHistoryData: CorporateComparisonHistoryResponse | null | undefined;
  isLoading: boolean;
  isError: boolean;
  recentSnapshotCount: number;
}) {
  return {
    showLoading: isLoading && !comparisonHistoryData,
    showError: isError && !comparisonHistoryData,
    showIdle: !comparisonHistoryData && !isLoading && !isError,
    showEmpty: Boolean(comparisonHistoryData && !isLoading && !isError && recentSnapshotCount === 0),
    showList: Boolean(comparisonHistoryData && !isLoading && !isError && recentSnapshotCount > 0),
  };
}

function portfolioComparisonViewState({
  activeComparisonData,
  comparisonData,
  comparisonIsLoading,
  comparisonIsError,
  selectedHistoryPoint,
  selectedSnapshotIsLoading,
  selectedSnapshotIsError,
  hasSnapshotSummary,
}: {
  activeComparisonData: CorporateComparisonResponse | null | undefined;
  comparisonData: CorporateComparisonResponse | null | undefined;
  comparisonIsLoading: boolean;
  comparisonIsError: boolean;
  selectedHistoryPoint: CorporateComparisonHistoryPoint | null;
  selectedSnapshotIsLoading: boolean;
  selectedSnapshotIsError: boolean;
  hasSnapshotSummary: boolean;
}) {
  return {
    showSelectedSnapshotLoading: Boolean(selectedHistoryPoint && selectedSnapshotIsLoading),
    showSelectedSnapshotError: Boolean(selectedHistoryPoint && selectedSnapshotIsError),
    showLoading: comparisonIsLoading && !comparisonData,
    showError: comparisonIsError && !comparisonData,
    showEmpty: !activeComparisonData && !comparisonIsLoading && !comparisonIsError && !selectedSnapshotIsLoading,
    showSummary: Boolean(activeComparisonData && hasSnapshotSummary),
  };
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

function portfolioWatchlistViewState({
  hasHoldings,
  holdingsView,
  watchlistIsLoading,
  watchlistIsError,
}: {
  hasHoldings: boolean;
  holdingsView: ViewMode;
  watchlistIsLoading: boolean;
  watchlistIsError: boolean;
}) {
  return {
    showError: !watchlistIsLoading && watchlistIsError,
    showEmpty: !watchlistIsLoading && !watchlistIsError && !hasHoldings,
    showSectorFilter: hasHoldings,
    showSkeleton: watchlistIsLoading,
    showChartCards: hasHoldings && !watchlistIsLoading && holdingsView === "chart",
    showTableGroups: hasHoldings && !watchlistIsLoading && holdingsView !== "chart",
  };
}

function benchmarkPresetLabelForTicker(ticker: string) {
  return PORTFOLIO_BENCHMARK_PRESETS.find((preset) => preset.ticker === ticker.trim().toUpperCase())?.label ?? "Manual ticker";
}

function sectorLabel(value: string) {
  return value.trim() || "Unclassified";
}

function buildSectorGroups(watchlist: PortfolioStock[]): SectorGroup[] {
  const grouped = new Map<string, PortfolioStock[]>();
  for (const stock of watchlist) {
    const sector = sectorLabel(stock.sector);
    const current = grouped.get(sector) ?? [];
    current.push(stock);
    grouped.set(sector, current);
  }
  return Array.from(grouped.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([sector, holdings]) => ({
      sector,
      holdings: [...holdings].sort((left, right) => left.ticker.localeCompare(right.ticker)),
    }));
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
  useDevMonitorPageLoad({ component: "portfolio" });
  // Page state tracks the holdings presentation mode and the currently opened detail modal.
  const queryClient = useQueryClient();
  const router = useRouter();
  const initialDateFilters = readStoredPortfolioDateFilters();
  const [holdingsView, setHoldingsView] = useState<ViewMode>("chart");
  const [selectedStockContext, setSelectedStockContext] = useState<SelectedStockContext | null>(null);
  const [holdingStartDate, setHoldingStartDate] = useState(initialDateFilters.holdingStartDate);
  const [attributionAsOfDate, setAttributionAsOfDate] = useState(initialDateFilters.attributionAsOfDate);
  const [newTicker, setNewTicker] = useState("");
  const [newName, setNewName] = useState("");
  const [newSector, setNewSector] = useState("");
  const [portfolioBrowserSearch, setPortfolioBrowserSearch] = useState("");
  const [addToWatchlistOnly, setAddToWatchlistOnly] = useState(true);
  const [newWeightPercent, setNewWeightPercent] = useState("");
  const [weightDrafts, setWeightDrafts] = useState<Record<string, string>>({});
  const [editingAllocationTicker, setEditingAllocationTicker] = useState<string | null>(null);
  const [totalInvestmentInput, setTotalInvestmentInput] = useState(`${DEFAULT_TOTAL_INVESTMENT_AMOUNT}`);
  const [importJsonArmed, setImportJsonArmed] = useState(false);
  const [mutationMessage, setMutationMessage] = useState<string | null>(null);
  const [portfolioComparisonMode, setPortfolioComparisonMode] = useState<"snapshot" | "live">("snapshot");
  const [portfolioComparisonUniverse, setPortfolioComparisonUniverse] = useState<PortfolioComparisonUniverse>("portfolio_plus_benchmark");
  const [portfolioComparisonBenchmarkTicker, setPortfolioComparisonBenchmarkTicker] = useState(DEFAULT_PORTFOLIO_BENCHMARK_TICKER);
  const [portfolioComparisonCustomTickersInput, setPortfolioComparisonCustomTickersInput] = useState("NVDA, TSLA");
  const [portfolioComparisonMessage, setPortfolioComparisonMessage] = useState<string | null>(null);
  const [portfolioAnalysisMessage, setPortfolioAnalysisMessage] = useState<string | null>(null);
  const [snapshotHistoryOpen, setSnapshotHistoryOpen] = useState(false);
  const [selectedHistoryPoint, setSelectedHistoryPoint] = useState<CorporateComparisonHistoryPoint | null>(null);
  const [applyAllocationToSnapshot, setApplyAllocationToSnapshot] = useState(false);
  const [sectorFilter, setSectorFilter] = useState("All Sectors");
  const [collapsedSectors, setCollapsedSectors] = useState<Record<string, boolean>>({});
  const [gridFilter, setGridFilter] = useState<GridFilter>("held");
  const [gridSearch, setGridSearch] = useState("");
  const [refreshSummary, setRefreshSummary] = useState<string | null>(null);
  const [portfolioComparisonRequestedSnapshot, setPortfolioComparisonRequestedSnapshot] = useState<PortfolioComparisonRequestSnapshot | null>(
    () => readSessionCache<CachedCalculation<PortfolioComparisonRequestSnapshot, CorporateComparisonResponse>>(PORTFOLIO_COMPARISON_CACHE_KEY)?.snapshot ?? null,
  );
  const [portfolioComparisonHistoryRequestedSnapshot, setPortfolioComparisonHistoryRequestedSnapshot] = useState<PortfolioComparisonHistoryRequestSnapshot | null>(
    () => readSessionCache<CachedCalculation<PortfolioComparisonHistoryRequestSnapshot, CorporateComparisonHistoryResponse>>(PORTFOLIO_COMPARISON_HISTORY_CACHE_KEY)?.snapshot ?? null,
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
  const [cachedPortfolioComparisonHistoryCalculation] = useState<CachedCalculation<PortfolioComparisonHistoryRequestSnapshot, CorporateComparisonHistoryResponse> | null>(
    () => readSessionCache<CachedCalculation<PortfolioComparisonHistoryRequestSnapshot, CorporateComparisonHistoryResponse>>(PORTFOLIO_COMPARISON_HISTORY_CACHE_KEY),
  );
  const [cachedPortfolioAttributionCalculation] = useState<CachedCalculation<AttributionRequestSnapshot, AttributionResult> | null>(
    () => readSessionCache<CachedCalculation<AttributionRequestSnapshot, AttributionResult>>(PORTFOLIO_ATTRIBUTION_CACHE_KEY),
  );
  const allocationAutoSaveInFlightRef = useRef(false);
  const totalInvestmentAutoSaveInFlightRef = useRef(false);
  const allocationSectionRef = useRef<HTMLElement | null>(null);
  const weightInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Which rail panel is open. Owned here rather than inside PortfolioShell so page actions
  // can open a panel programmatically, not just a rail click. setOpenPanel is referentially
  // stable, which is what keeps SidePanel's Escape listener from re-registering.
  const [openPanel, setOpenPanel] = useState<string | null>(null);
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
    setOpenPanel("allocation");
    // The weight input is only rendered while its row is in edit mode (same gate the
    // double-click path uses), so without this the focus below would still have nothing
    // to land on.
    if (ticker) setEditingAllocationTicker(ticker);
    setAllocationFocusRequest((current) => ({ ticker, token: (current?.token ?? 0) + 1 }));
  }, []);

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
    if (typeof window === "undefined") return;

    const syncHoldingsViewForViewport = () => {
      setHoldingsView((current) => (window.innerWidth < 1024 ? "table" : current));
    };

    syncHoldingsViewForViewport();
    window.addEventListener("resize", syncHoldingsViewForViewport);
    return () => window.removeEventListener("resize", syncHoldingsViewForViewport);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      PORTFOLIO_DATE_FILTERS_STORAGE_KEY,
      JSON.stringify({
        holdingStartDate,
        attributionAsOfDate,
      }),
    );
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
  const visibleStocks = useMemo(
    () => selectVisibleStocks(watchlist, gridFilter, gridSearch).stocks,
    [watchlist, gridFilter, gridSearch],
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
    () => selectVisibleStocks(watchlist, gridFilter, debouncedGridSearch).stocks.map((stock) => stock.ticker),
    [watchlist, gridFilter, debouncedGridSearch],
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
      void queryClient.invalidateQueries({ queryKey: ["portfolio-news"] });
    },
    onError: (error) => {
      setRefreshSummary(qualifyRefreshSummary(error instanceof Error ? error.message : "Refresh failed"));
    },
  });

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
  const availableSectors = useMemo(
    () => buildSectorGroups(watchlist).map((group) => group.sector),
    [watchlist],
  );
  const activeSectorFilter = sectorFilter === "All Sectors" || availableSectors.includes(sectorFilter)
    ? sectorFilter
    : "All Sectors";
  const filteredWatchlist = useMemo(
    () => (activeSectorFilter === "All Sectors" ? watchlist : watchlist.filter((stock) => sectorLabel(stock.sector) === activeSectorFilter)),
    [activeSectorFilter, watchlist],
  );
  const watchlistSectorGroups = useMemo(() => buildSectorGroups(filteredWatchlist), [filteredWatchlist]);
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
  const comparisonHistoryCurrentSnapshot = useMemo<PortfolioComparisonHistoryRequestSnapshot>(() => ({
    comparisonUniverse: portfolioComparisonUniverse,
    benchmarkTicker: debouncedBenchmarkTicker,
    customTickersInput: portfolioComparisonUniverse === "custom" ? debouncedCustomTickersInput : "",
    holdingsSignature,
  }), [debouncedBenchmarkTicker, debouncedCustomTickersInput, holdingsSignature, portfolioComparisonUniverse]);
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
  const portfolioComparisonHistoryQuery = useQuery<CorporateComparisonHistoryResponse>({
    queryKey: [
      "portfolio-comparison-history",
      portfolioComparisonHistoryRequestedSnapshot?.comparisonUniverse ?? "idle",
      portfolioComparisonHistoryRequestedSnapshot?.benchmarkTicker ?? "idle",
      portfolioComparisonHistoryRequestedSnapshot?.customTickersInput ?? "",
      portfolioComparisonHistoryRequestedSnapshot?.holdingsSignature ?? "idle",
      portfolioAnalysisRefreshToken ?? "idle",
    ],
    enabled: Boolean(hasHoldings && portfolioComparisonHistoryRequestedSnapshot && portfolioAnalysisRefreshToken),
      queryFn: ({ signal }) =>
        fetchApi<CorporateComparisonHistoryResponse>("/corporate/comparison/history", {
          signal,
          params: {
            comparison_universe: portfolioComparisonHistoryRequestedSnapshot?.comparisonUniverse ?? "portfolio_plus_benchmark",
            benchmark_ticker: portfolioComparisonHistoryRequestedSnapshot?.benchmarkTicker ?? DEFAULT_PORTFOLIO_BENCHMARK_TICKER,
            custom_tickers: portfolioComparisonHistoryRequestedSnapshot?.customTickersInput ?? "",
            limit: 30,
          },
          monitor: {
            operation: "frontend.query.portfolio_comparison_history",
            component: "portfolio_page",
          },
      }),
    staleTime: 60_000,
  });
  const selectedSnapshotQuery = useQuery<CorporateComparisonResponse>({
    queryKey: ["portfolio-comparison-snapshot-version", selectedHistoryPoint?.snapshot_version ?? ""],
    enabled: hasHoldings && portfolioComparisonMode === "snapshot" && Boolean(selectedHistoryPoint?.snapshot_version),
      queryFn: ({ signal }) =>
        fetchApi<CorporateComparisonResponse>("/corporate/comparison/snapshot-version", {
          signal,
          params: {
            snapshot_version: selectedHistoryPoint?.snapshot_version ?? "",
          },
          monitor: {
            operation: "frontend.query.portfolio_snapshot_version",
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
  const cachedPortfolioComparisonHistory = cachedPortfolioComparisonHistoryCalculation
    && !isPortfolioComparisonHistorySnapshotStale(cachedPortfolioComparisonHistoryCalculation.snapshot, comparisonHistoryCurrentSnapshot)
    ? cachedPortfolioComparisonHistoryCalculation.result
    : null;
  const cachedPortfolioAttribution = cachedPortfolioAttributionCalculation
    && !isPortfolioAttributionSnapshotStale(cachedPortfolioAttributionCalculation.snapshot, attributionCurrentSnapshot)
    ? cachedPortfolioAttributionCalculation.result
    : null;

  // Chart adapters convert domain attribution data into display-ready allocation/effects datasets.
  const comparisonData = portfolioComparisonQuery.data ?? cachedPortfolioComparison;
  const comparisonHistoryData = portfolioComparisonHistoryQuery.data ?? cachedPortfolioComparisonHistory;
  const attributionData = attributionQuery.data ?? cachedPortfolioAttribution;
  const allocationData = attributionData ? toAllocationDonutData(attributionData) : [];
  const waterfallData = attributionData ? toAttributionWaterfallData(attributionData) : [];
  const activeComparisonData = portfolioComparisonMode === "snapshot" && selectedSnapshotQuery.data
    ? selectedSnapshotQuery.data
    : comparisonData;
  const activeSnapshotMeta = activeComparisonData?.snapshot ?? null;
  const recentSnapshotPoints = comparisonHistoryData?.points.slice(0, 3) ?? [];
  const portfolioComparisonCalculating = normalizedBenchmarkTicker !== debouncedBenchmarkTicker
    || (portfolioComparisonUniverse === "custom" && normalizedCustomTickersInput !== debouncedCustomTickersInput)
    || portfolioComparisonQuery.isFetching
    || portfolioComparisonHistoryQuery.isFetching
    || attributionQuery.isFetching
    || selectedSnapshotQuery.isFetching;
  const portfolioAnalysisDisplayLastUpdatedAt = useMemo(() => {
    const candidates = [
      portfolioComparisonQuery.data ? new Date(portfolioComparisonQuery.dataUpdatedAt).toISOString() : null,
      portfolioComparisonHistoryQuery.data ? new Date(portfolioComparisonHistoryQuery.dataUpdatedAt).toISOString() : null,
      attributionQuery.data ? new Date(attributionQuery.dataUpdatedAt).toISOString() : null,
      cachedPortfolioComparison ? cachedPortfolioComparisonCalculation?.lastUpdatedAt ?? null : null,
      cachedPortfolioComparisonHistory ? cachedPortfolioComparisonHistoryCalculation?.lastUpdatedAt ?? null : null,
      cachedPortfolioAttribution ? cachedPortfolioAttributionCalculation?.lastUpdatedAt ?? null : null,
    ].filter((value): value is string => Boolean(value));
    if (candidates.length === 0) return null;
    return candidates.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
  }, [
    attributionQuery.data,
    attributionQuery.dataUpdatedAt,
    cachedPortfolioAttribution,
    cachedPortfolioAttributionCalculation?.lastUpdatedAt,
    cachedPortfolioComparison,
    cachedPortfolioComparisonCalculation?.lastUpdatedAt,
    cachedPortfolioComparisonHistory,
    cachedPortfolioComparisonHistoryCalculation?.lastUpdatedAt,
    portfolioComparisonHistoryQuery.data,
    portfolioComparisonHistoryQuery.dataUpdatedAt,
    portfolioComparisonQuery.data,
    portfolioComparisonQuery.dataUpdatedAt,
  ]);
  const portfolioComparisonIsStale = isPortfolioComparisonSnapshotStale(portfolioComparisonRequestedSnapshot, comparisonCurrentSnapshot);
  const portfolioComparisonHistoryIsStale = isPortfolioComparisonHistorySnapshotStale(
    portfolioComparisonHistoryRequestedSnapshot,
    comparisonHistoryCurrentSnapshot,
  );
  const portfolioAttributionIsStale = isPortfolioAttributionSnapshotStale(
    portfolioAttributionRequestedSnapshot,
    attributionCurrentSnapshot,
  );
  const portfolioAnalysisIsStale = portfolioComparisonIsStale || portfolioComparisonHistoryIsStale || portfolioAttributionIsStale;
  const comparisonMetricsByTicker = useMemo<Record<string, PortfolioTickerMetrics>>(() => buildPortfolioTickerMetrics({
    watchlist,
    activeComparisonData: activeComparisonData ?? null,
    comparisonData: comparisonData ?? null,
    selectedSnapshotData: selectedSnapshotQuery.data,
    selectedHistoryPointSnapshotVersion: selectedHistoryPoint?.snapshot_version ?? null,
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
    selectedHistoryPoint?.snapshot_version,
    selectedSnapshotQuery.data,
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

  const portfolioSnapshotSummary = useMemo(() => {
    const stockRows = watchlist.map((stock) => comparisonMetricsByTicker[stock.ticker] ?? EMPTY_COMPARISON_METRICS);
    if (stockRows.length === 0) return null;
    const flaggedMetricsCount = stockRows.reduce((sum, row) => (
      sum
      + (row.expectedVsMarket.quality === "suspicious" || row.expectedVsMarket.quality === "invalid" ? 1 : 0)
      + (row.roicMinusWacc.quality === "suspicious" || row.roicMinusWacc.quality === "invalid" ? 1 : 0)
      + (row.dcfUpside.quality === "suspicious" || row.dcfUpside.quality === "invalid" ? 1 : 0)
    ), 0);
    const positiveSpreadCount = stockRows.filter((row) => (metricNumericValue(row.expectedVsMarket) ?? 0) > 0).length;
    const positiveEconomicSpreadCount = stockRows.filter((row) => (metricNumericValue(row.roicMinusWacc) ?? 0) > 0).length;
    const positiveDcfCount = stockRows.filter((row) => (metricNumericValue(row.dcfUpside) ?? 0) > 0).length;
    const highestSpreadRow = stockRows
      .filter((row) => !row.excludedFromRanking && metricNumericValue(row.expectedVsMarket) != null)
      .sort((left, right) => (metricNumericValue(right.expectedVsMarket) ?? -Infinity) - (metricNumericValue(left.expectedVsMarket) ?? -Infinity))[0] ?? null;
    return {
      stockCount: stockRows.length,
      flaggedMetricsCount,
      positiveSpreadCount,
      positiveEconomicSpreadCount,
      positiveDcfCount,
      highestSpreadTicker: highestSpreadRow?.ticker ?? "N/A",
      highestSpreadValue: highestSpreadRow ? metricNumericValue(highestSpreadRow.expectedVsMarket) : null,
    };
  }, [comparisonMetricsByTicker, watchlist]);
  const snapshotHistoryView = portfolioSnapshotHistoryViewState({
    comparisonHistoryData,
    isLoading: portfolioComparisonHistoryQuery.isLoading,
    isError: portfolioComparisonHistoryQuery.isError,
    recentSnapshotCount: recentSnapshotPoints.length,
  });
  const comparisonView = portfolioComparisonViewState({
    activeComparisonData,
    comparisonData,
    comparisonIsLoading: portfolioComparisonQuery.isLoading,
    comparisonIsError: portfolioComparisonQuery.isError,
    selectedHistoryPoint,
    selectedSnapshotIsLoading: selectedSnapshotQuery.isLoading,
    selectedSnapshotIsError: selectedSnapshotQuery.isError,
    hasSnapshotSummary: Boolean(portfolioSnapshotSummary),
  });
  const attributionView = portfolioAttributionViewState({
    attributionData,
    attributionIsLoading: attributionQuery.isLoading,
    attributionIsError: attributionQuery.isError,
    hasHoldings,
    canRunAttribution,
  });
  const watchlistView = portfolioWatchlistViewState({
    hasHoldings,
    holdingsView,
    watchlistIsLoading: watchlistQuery.isLoading,
    watchlistIsError: watchlistQuery.isError,
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
    if (!portfolioComparisonHistoryQuery.data || !portfolioComparisonHistoryRequestedSnapshot) return;
    writeSessionCache(PORTFOLIO_COMPARISON_HISTORY_CACHE_KEY, {
      snapshot: portfolioComparisonHistoryRequestedSnapshot,
      result: portfolioComparisonHistoryQuery.data,
      lastUpdatedAt: new Date(portfolioComparisonHistoryQuery.dataUpdatedAt).toISOString(),
    } satisfies CachedCalculation<PortfolioComparisonHistoryRequestSnapshot, CorporateComparisonHistoryResponse>);
  }, [portfolioComparisonHistoryQuery.data, portfolioComparisonHistoryQuery.dataUpdatedAt, portfolioComparisonHistoryRequestedSnapshot]);

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
      setMutationMessage(`Exported ${result.item_count} holdings to stock_targets.json from the DB-backed watchlist.`);
    },
    onError: (error) => {
      setMutationMessage(error instanceof Error ? error.message : "Failed to sync watchlist to JSON.");
    },
  });
  const deleteSnapshotMutation = useMutation({
    mutationFn: async (snapshotVersion: string) =>
      fetchApi<{ snapshot_version: string; deleted_rows: number }>("/corporate/comparison/snapshot-version", {
        method: "DELETE",
        params: { snapshot_version: snapshotVersion },
      }),
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

  const handleAddCandidate = async (company: CorporateCompany) => {
    const ticker = company.ticker.trim().toUpperCase();
    if (!ticker || watchlist.some((stock) => stock.ticker === ticker)) return;
    setMutationMessage(null);
    await addWatchlistMutation.mutateAsync({
      ticker,
      name: company.name || ticker,
      sector: company.sector ?? "",
      group_name: "browser",
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
        await queryClient.invalidateQueries({ queryKey: ["portfolio-comparison-history"] });
        setSelectedHistoryPoint(null);
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
            await queryClient.invalidateQueries({ queryKey: ["portfolio-comparison-history"] });
            setSelectedHistoryPoint(null);
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

  const handleRefreshPortfolioSnapshot = async () => {
    setPortfolioComparisonMessage(null);
    try {
      const refreshed = await savePortfolioSnapshot();
      await queryClient.invalidateQueries({ queryKey: ["portfolio-comparison-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-comparison-history"] });
      setSelectedHistoryPoint(null);
      setPortfolioComparisonMode("snapshot");
      setPortfolioComparisonMessage(`Saved portfolio snapshot for ${formatDateLabel(refreshed.snapshot.as_of_date)}.`);
    } catch (error) {
      setPortfolioComparisonMessage(error instanceof Error ? error.message : "Failed to save portfolio snapshot.");
    }
  };

  const handleDeleteSnapshotVersion = async (snapshotVersion: string) => {
    setPortfolioComparisonMessage(null);
    try {
      await deleteSnapshotMutation.mutateAsync(snapshotVersion);
      if (selectedHistoryPoint?.snapshot_version === snapshotVersion) {
        setSelectedHistoryPoint(null);
      }
      await queryClient.invalidateQueries({ queryKey: ["portfolio-comparison-history"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-comparison-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-comparison-snapshot-version", snapshotVersion] });
      setPortfolioComparisonMessage("Deleted the selected saved snapshot.");
    } catch (error) {
      setPortfolioComparisonMessage(error instanceof Error ? error.message : "Failed to delete the saved snapshot.");
    }
  };

  const handleRefreshPortfolioAnalysis = () => {
    if (!hasHoldings) {
      setPortfolioAnalysisMessage("Add holdings before refreshing portfolio analysis.");
      return;
    }

    setSelectedHistoryPoint(null);
    setPortfolioComparisonRequestedSnapshot(comparisonCurrentSnapshot);
    setPortfolioComparisonHistoryRequestedSnapshot(comparisonHistoryCurrentSnapshot);
    setPortfolioAttributionRequestedSnapshot(canRunAttribution ? attributionCurrentSnapshot : null);
    setPortfolioAnalysisRefreshToken(`${Date.now()}`);
    setPortfolioAnalysisMessage(
      canRunAttribution
        ? "Refreshing portfolio comparison, snapshot history, and attribution."
        : "Refreshing portfolio comparison and snapshot history. Attribution stays paused until saved weights are 100% or below.",
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

  const benchmarkQuickActions = PORTFOLIO_BENCHMARK_PRESETS.filter((preset) => ["sp500", "kospi", "kosdaq"].includes(preset.id));

  // Panel bodies: the sections that used to stack down the page, moved verbatim into
  // the rail-triggered side panels. Only the tile grid stays in the scrolling region.
  const snapshotPanelBody = (
    <>
      {hasHoldings && (
        <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
          <div className="flex flex-col gap-4 min-[1450px]:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[var(--text-primary)]">
                <InfoTooltip
                  label="Latest Snapshot Summary"
                  description="Daily comparison snapshot summary for the selected portfolio-side universe. This keeps the latest persisted stock-comparison record visible on the Portfolio page and points you back to the per-stock table for the meaningful comparison metrics."
                />
              </h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                Snapshot mode is the default daily record. Live mode lets you inspect the current portfolio-side comparison without replacing the saved daily snapshot.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
                  <InfoTooltip
                    label="Universe"
                    description="Portfolio + Benchmark uses the tracked holdings already on this page. Custom Universe keeps the same benchmark but lets you compare only the manual ticker list you provide, without rewriting the watchlist."
                  />
                  <select
                    aria-label="Portfolio comparison universe"
                    value={portfolioComparisonUniverse}
                    onChange={(event) => {
                      setSelectedHistoryPoint(null);
                      setPortfolioComparisonUniverse(event.target.value as PortfolioComparisonUniverse);
                    }}
                    className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)]"
                  >
                    <option value="portfolio_plus_benchmark">Portfolio + Benchmark</option>
                    <option value="custom">Custom Universe</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
                  <InfoTooltip
                    label="Benchmark"
                    description="Manual benchmark ticker input always wins. Presets are just fast selectors for common baselines. Whatever benchmark is active when you save a snapshot is stored with that snapshot for historical consistency."
                  />
                  <input
                    aria-label="Portfolio benchmark ticker"
                    value={portfolioComparisonBenchmarkTicker}
                    onChange={(event) => {
                      setSelectedHistoryPoint(null);
                      setPortfolioComparisonBenchmarkTicker(event.target.value.toUpperCase());
                    }}
                    className="w-24 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)]"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
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
                        setSelectedHistoryPoint(null);
                        setPortfolioComparisonBenchmarkTicker(selectedPreset.ticker);
                      }
                    }}
                    className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)]"
                  >
                    {PORTFOLIO_BENCHMARK_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                    <option value="custom">Manual ticker</option>
                  </select>
                </label>
                {portfolioComparisonUniverse === "custom" && (
                  <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
                    <InfoTooltip
                      label="Custom tickers"
                      description="Comma-separated tickers for the temporary comparison universe. These affect the comparison rows and saved snapshot payload only; they do not add holdings to the tracked watchlist."
                    />
                    <input
                      aria-label="Portfolio custom tickers"
                      value={portfolioComparisonCustomTickersInput}
                      onChange={(event) => {
                        setSelectedHistoryPoint(null);
                        setPortfolioComparisonCustomTickersInput(event.target.value.toUpperCase());
                      }}
                      placeholder="NVDA, TSLA"
                      className="w-48 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)]"
                    />
                  </label>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                <span className="font-semibold">Quick change</span>
                {benchmarkQuickActions.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setSelectedHistoryPoint(null);
                      setPortfolioComparisonBenchmarkTicker(preset.ticker);
                    }}
                    className={`rounded-full border px-3 py-1 font-semibold ${normalizedBenchmarkTicker === preset.ticker ? "border-[var(--accent)] bg-[var(--surface-muted)] text-[var(--text-primary)]" : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
                  >
                    {preset.label}
                  </button>
                ))}
                {portfolioComparisonCalculating && (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 font-semibold text-amber-800">
                    Calculating
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
                  <InfoTooltip
                    label="Source"
                    description="Persisted snapshot shows the latest saved daily record. Live calculation recomputes the comparison with the current controls and holdings but does not replace saved history until you explicitly use Save Current As Snapshot."
                  />
                  <select
                    aria-label="Portfolio comparison source"
                    value={portfolioComparisonMode}
                    onChange={(event) => {
                      const nextMode = event.target.value as "snapshot" | "live";
                      if (nextMode !== "snapshot") {
                        setSelectedHistoryPoint(null);
                      }
                      setPortfolioComparisonMode(nextMode);
                    }}
                    className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)]"
                  >
                    <option value="snapshot">Persisted snapshot</option>
                    <option value="live">Live calculation</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={handleRefreshPortfolioAnalysis}
                  className="inline-flex items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--surface)]"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${portfolioComparisonCalculating ? "animate-spin" : ""}`} />
                  Refresh Analysis
                </button>
                <button
                  type="button"
                  onClick={() => void handleRefreshPortfolioSnapshot()}
                  className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--surface)]"
                >
                  Save Current As Snapshot
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/corporate")}
                  className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  View Full Comparison
                </button>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-panel)] p-4 text-sm text-[var(--text-muted)] sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <span>{portfolioAnalysisDisplayLastUpdatedAt ? `Last updated ${formatSyncTimestamp(portfolioAnalysisDisplayLastUpdatedAt)}` : "Latest saved comparison snapshot loads automatically when holdings exist."}</span>
              {portfolioAnalysisMessage && <span>{portfolioAnalysisMessage}</span>}
            </div>
            {portfolioAnalysisIsStale && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                Showing stale analysis for prior inputs
              </span>
            )}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-3">
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--text-muted)]">
              <span className="font-semibold text-[var(--text-primary)]">Universe:</span> {portfolioComparisonUniverseHelpText(portfolioComparisonUniverse)}
            </div>
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--text-muted)]">
              <span className="font-semibold text-[var(--text-primary)]">Benchmark workflow:</span> Preset is currently {benchmarkPresetLabelForTicker(normalizedBenchmarkTicker)}. Manual ticker input stays available for index symbols or ETFs outside the preset list.
            </div>
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--text-muted)]">
              <span className="font-semibold text-[var(--text-primary)]">Snapshot workflow:</span> Live mode is review-only. Saved history updates only when you press <span className="font-semibold text-[var(--text-primary)]">Save Current As Snapshot</span> or opt in from allocation changes below.
            </div>
          </div>
          <div className="mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-panel)] p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-primary)]">Saved Snapshot List</h3>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Review the most recent persisted portfolio comparison snapshots directly from the page, then open the full history modal when you need the full timeline.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSnapshotHistoryOpen(true)}
                className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                View All Saved Snapshots
              </button>
            </div>
            {snapshotHistoryView.showLoading && (
              <div className="mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)]">
                <LoadingState variant="spinner" label="Loading saved snapshots..." />
              </div>
            )}
            {snapshotHistoryView.showError && (
              <div className="mt-3">
                <StatusPanel
                  title="Saved Snapshot List Unavailable"
                  message="Could not load the saved snapshot list for this benchmark and universe."
                  tone="warning"
                />
              </div>
            )}
            {snapshotHistoryView.showIdle && (
              <div className="mt-3 rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--surface-muted)]">
                <EmptyState
                  title="Saved snapshot history stays idle until you refresh portfolio analysis."
                  description="Refresh portfolio analysis to load the latest persisted snapshot versions for this review context."
                />
              </div>
            )}
            {snapshotHistoryView.showEmpty && (
              <div className="mt-3 rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--surface-muted)]">
                <EmptyState
                  title="No saved snapshots are available yet"
                  description="No saved snapshots are available yet for the current review context."
                />
              </div>
            )}
            {snapshotHistoryView.showList && (
              <div className="mt-3 space-y-2">
                {recentSnapshotPoints.map((point) => {
                  const isActive = point.snapshot_version === (selectedHistoryPoint?.snapshot_version ?? activeSnapshotMeta?.snapshot_version ?? "");
                  return (
                    <div
                      key={`snapshot-list-${point.snapshot_version}`}
                      className={`flex flex-col gap-2 rounded-[var(--radius)] border p-3 text-sm sm:flex-row sm:items-center sm:justify-between ${
                        isActive ? "border-[var(--accent)]/50 bg-[var(--surface-muted)]" : "border-[var(--border)] bg-[var(--bg-surface)]"
                      }`}
                    >
                      <div className="space-y-1">
                        <p className="font-semibold text-[var(--text-primary)]">
                          {formatDateLabel(point.as_of_date)} - {point.snapshot_source}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                          Benchmark {point.benchmark_ticker}. Stocks summarized: {point.stock_count}.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedHistoryPoint(point);
                            setPortfolioComparisonMode("snapshot");
                          }}
                          className={`inline-flex items-center justify-center rounded-[var(--radius)] border px-3 py-2 text-xs font-semibold ${
                            isActive
                              ? "border-[var(--accent)] bg-[var(--surface-muted)] text-[var(--text-primary)]"
                              : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                          }`}
                        >
                          {isActive ? "Selected Snapshot" : "Review Snapshot"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteSnapshotVersion(point.snapshot_version)}
                          disabled={deleteSnapshotMutation.isPending && deleteSnapshotMutation.variables === point.snapshot_version}
                          className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--delta-down)] disabled:opacity-50"
                        >
                          {deleteSnapshotMutation.isPending && deleteSnapshotMutation.variables === point.snapshot_version ? "Removing..." : "Remove Snapshot"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {comparisonView.showSelectedSnapshotLoading && selectedHistoryPoint && (
            <div className="mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)]">
              <LoadingState
                variant="spinner"
                label={`Loading selected snapshot for ${formatDateLabel(selectedHistoryPoint.as_of_date)}...`}
              />
            </div>
          )}
          {comparisonView.showSelectedSnapshotError && (
            <div className="mt-3">
              <StatusPanel
                title="Selected Snapshot Unavailable"
                message="Could not load the selected saved snapshot version. Clearing the history selection will return to the latest snapshot."
                tone="warning"
              />
            </div>
          )}

          {comparisonView.showLoading && (
            <div className="mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)]">
              <LoadingState variant="spinner" label="Loading portfolio snapshot summary..." />
            </div>
          )}

          {comparisonView.showError && (
            <div className="mt-4">
              <StatusPanel
                title="Portfolio Snapshot Summary Unavailable"
                message="Could not load the latest portfolio comparison snapshot."
                tone="warning"
              />
            </div>
          )}

          {comparisonView.showEmpty && (
            <div className="mt-4 rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--surface-muted)]">
              <EmptyState
                title="Portfolio comparison is unavailable."
                description="No latest saved snapshot or cached comparison result is available for the current holdings yet. Use `Refresh Analysis` to request a fresh comparison run."
              />
            </div>
          )}

          {comparisonView.showSummary && activeComparisonData && portfolioSnapshotSummary && (
            <>
              <PortfolioSnapshotSummary
                activeComparisonData={activeComparisonData}
                portfolioSnapshotSummary={portfolioSnapshotSummary}
                selectedHistoryPoint={selectedHistoryPoint}
                setSelectedHistoryPoint={setSelectedHistoryPoint}
                formatDateLabel={formatDateLabel}
                portfolioComparisonUniverseLabel={portfolioComparisonUniverseLabel}
                metricToneClass={metricToneClass}
                formatMetricPercent={formatMetricPercent}
                formatSyncTimestamp={formatSyncTimestamp}
                router={router}
                setSnapshotHistoryOpen={setSnapshotHistoryOpen}
              />
            </>
          )}
        </section>
      )}
    </>
  );

  const attributionPanelBody = (
    <>
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
          message={`Saved watchlist allocations currently sum to ${(totalStoredWeight * 100).toFixed(1)}%. Reduce total assigned weight to 100% or below before attribution can run.`}
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
      <section ref={allocationSectionRef} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">Portfolio Allocation Workspace</h2>
          <p className="text-sm text-[var(--text-muted)]">
            Use the stock browser on the left to add names, then adjust allocation percentages inline on the right. Slider moves and double-click manual edits save automatically, and the total investment amount drives the money-based summaries below.
          </p>
        </div>

        <div className="mt-4 grid min-w-72 grid-cols-1 gap-2 sm:grid-cols-5">
          <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
            <div className="text-[var(--text-muted)]">Tracked Names</div>
            <div className="mt-1 font-bold text-[var(--text-primary)]">{watchlist.length}</div>
          </div>
          <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
            <div className="text-[var(--text-muted)]">Allocated Names</div>
            <div className="mt-1 font-bold text-[var(--text-primary)]">{allocatedHoldingsCount}</div>
          </div>
          <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
            <div className="text-[var(--text-muted)]">Total Investment</div>
            <div className="mt-1 font-bold text-[var(--text-primary)]">{formatCurrencyCompact(totalInvestmentAmount)}</div>
          </div>
          <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
            <div className="text-[var(--text-muted)]">Invested Capital</div>
            <div className="mt-1 font-bold text-[var(--text-primary)]">{formatCurrencyCompact(allocationSummary.allocatedAmount)}</div>
            <div className="mt-1 text-[length:var(--type-caption)] text-[var(--text-muted)]">{formatWeightPercent(investedWeight)} allocated</div>
          </div>
          <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
            <div className="text-[var(--text-muted)]">Implied Cash</div>
            <div className="mt-1 font-bold text-[var(--text-primary)]">{formatCurrencyCompact(totalInvestmentAmount * impliedCashWeight)}</div>
            <div className="mt-1 text-[length:var(--type-caption)] text-[var(--text-muted)]">{formatWeightPercent(impliedCashWeight)} unallocated</div>
          </div>
          <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
            <div className="text-[var(--text-muted)]">Final Profit</div>
            <div className={`mt-1 font-bold ${metricToneClass(allocationSummary.finalProfit)}`}>
              {formatCurrencyCompact(allocationSummary.finalProfit)}
            </div>
            <div className="mt-1 text-[length:var(--type-caption)] text-[var(--text-muted)]">
              Fee-aware using {(portfolioPreferences.transaction_fee_rate * 100).toFixed(1)}% exit fee
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
            syncStatus={syncStatusQuery.data}
            formatSyncTimestamp={formatSyncTimestamp}
            formatSectorLabel={sectorLabel}
          />

          <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-panel)] p-4">
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

  const holdingsPanelBody = (
    <>
      {watchlistView.showError && (
        <StatusPanel
          title="Portfolio Data Unavailable"
          message="Could not load watchlist from backend. Verify backend connectivity and retry."
          tone="warning"
        />
      )}

      {watchlistView.showEmpty && (
        <StatusPanel
          title="No Holdings Yet"
          message="Add at least one asset to the tracking watchlist, then assign portfolio weights below when you want attribution insights."
        />
      )}
      {/* Holdings toolbar: section title, explanatory tooltip, and card/table view toggle. */}
      <section className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">
            <InfoTooltip
              label="Watchlist Holdings"
              description="This section is the tracking watchlist: holdings, current close, day-over-day percentage change, and a recent price sparkline. Good/bad follows local convention: red indicates price gain, blue indicates price loss."
            />
          </h2>
          <p className="text-sm text-[var(--text-muted)]">
            Tracking list for holdings and price or news drill-down. Weighting, implied cash, snapshots, and attribution stay in the portfolio-testing section below.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ViewToggle value={holdingsView} onChange={setHoldingsView} />
          <ActionButton
            label="Add"
            size="sm"
            onClick={() => requestAllocationFocus(null)}
          />
          <ActionButton
            label={syncWatchlistMutation.isPending ? "Syncing..." : "Sync"}
            size="sm"
            loading={syncWatchlistMutation.isPending}
            onClick={() => {
              setMutationMessage(null);
              void syncWatchlistMutation.mutateAsync();
            }}
          />
        </div>
      </section>
      {watchlistView.showSectorFilter && (
        <section className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Sector Filter</h3>
            <p className="text-sm text-[var(--text-muted)]">
              Group holdings by sector in both views. Use this to isolate volatility clusters quickly, then reset to all sectors when you want the full holdings surface back.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSectorFilter("All Sectors")}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${activeSectorFilter === "All Sectors" ? "border-[var(--accent)] bg-[var(--surface-muted)] text-[var(--text-primary)]" : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
            >
              All Sectors
            </button>
            {availableSectors.map((sector) => (
              <button
                key={sector}
                type="button"
                onClick={() => setSectorFilter(sector)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${activeSectorFilter === sector ? "border-[var(--accent)] bg-[var(--surface-muted)] text-[var(--text-primary)]" : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
              >
                {sector}
              </button>
            ))}
          </div>
        </section>
      )}
      {/* Holdings body: skeleton, card grid, table, or empty state depending on data and view mode. */}
      {watchlistView.showSkeleton ? (
        <WatchlistSkeletonGrid />
      ) : watchlistView.showChartCards ? (
        <section className="space-y-4">
          {watchlistSectorGroups.map((group) => (
            <div key={group.sector} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
              <div className="mb-4">
                <h3 className="text-sm font-bold text-[var(--text-primary)]">{group.sector}</h3>
                <p className="text-xs text-[var(--text-muted)]">{group.holdings.length} holding{group.holdings.length === 1 ? "" : "s"}</p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
                {group.holdings.map((stock) => {
                  const deltaPct = stock.delta?.delta_pct ?? 0;
                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedStockContext({ ticker: stock.ticker, fallbackStock: stock })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedStockContext({ ticker: stock.ticker, fallbackStock: stock });
                        }
                      }}
                      key={stock.ticker}
                      className="group relative block bg-[var(--surface-panel)] rounded-[var(--radius)] border border-[var(--border)] p-4 text-left transition-all hover:border-[var(--accent)] hover:shadow-[var(--shadow-card-hover)]"
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDeleteHolding(stock);
                        }}
                        disabled={deleteWatchlistMutation.isPending && deleteWatchlistMutation.variables === stock.ticker}
                        className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-xs font-semibold text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--delta-down)] group-hover:opacity-100 group-focus-within:opacity-100 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {deleteWatchlistMutation.isPending && deleteWatchlistMutation.variables === stock.ticker ? "Removing" : "Remove"}
                      </button>
                      <div className="flex flex-col justify-between items-start mb-2">
                        <StockIdentity stock={stock} />
                        <div className="text-right flex flex-row justify-between items-end gap-4">
                          <div className="font-semibold tabular-nums">
                            {stock.last_close.toLocaleString(undefined, {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 1,
                            })}$
                          </div>
                          <DeltaBadge value={deltaPct} className="mt-1" />
                          <p className="sr-only">{portfolioStatus("change", deltaPct)}</p>
                        </div>
                      </div>

                      <div className="mt-4 pt-2 border-t border-[var(--border)]/40">
                        <Sparkline
                          data={stock.sparkline}
                          height={30}
                          color={deltaPct >= 0 ? "var(--delta-up)" : "var(--delta-down)"}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      ) : watchlistView.showTableGroups ? (
        <section className="space-y-4">
          {watchlistSectorGroups.map((group) => {
            const isCollapsed = collapsedSectors[group.sector] ?? false;
            return (
              <div key={group.sector} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                <button
                  type="button"
                  onClick={() => setCollapsedSectors((current) => ({ ...current, [group.sector]: !isCollapsed }))}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <div>
                    <h3 className="text-sm font-bold text-[var(--text-primary)]">{group.sector}</h3>
                    <p className="text-xs text-[var(--text-muted)]">{group.holdings.length} holding{group.holdings.length === 1 ? "" : "s"}</p>
                  </div>
                  {isCollapsed ? <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" /> : <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />}
                </button>
                {!isCollapsed && (
                  <div className="mt-4">
                    <HoldingsTable
                      watchlist={group.holdings}
                      comparisonMetricsByTicker={comparisonMetricsByTicker}
                      onSelect={(stock) => setSelectedStockContext({ ticker: stock.ticker, fallbackStock: stock })}
                      onDelete={(stock) => void handleDeleteHolding(stock)}
                      deletingTicker={deleteWatchlistMutation.isPending ? deleteWatchlistMutation.variables ?? null : null}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ) : null}
    </>
  );

  return (
    <ErrorBoundary
      fallbackTitle="Portfolio Command Center Failure"
      fallbackMessage="Portfolio attribution UI failed to render safely."
    >
      <PortfolioShell
        rail={[
          { id: "snapshot", icon: <Camera className="h-4 w-4" />, label: "Latest snapshot summary" },
          { id: "attribution", icon: <PieChart className="h-4 w-4" />, label: "Attribution" },
          { id: "allocation", icon: <SlidersHorizontal className="h-4 w-4" />, label: "Allocation workspace" },
          { id: "holdings", icon: <TableIcon className="h-4 w-4" />, label: "Holdings table" },
          {
            id: "refresh-news",
            icon: <RefreshCw className={`h-4 w-4 ${refreshNews.isPending ? "animate-spin" : ""}`} />,
            label: "Refresh news for visible stocks",
          },
        ]}
        onRailAction={(id) => {
          if (id !== "refresh-news") return false;
          if (!refreshNews.isPending) refreshNews.mutate();
          return true;
        }}
        openPanel={openPanel}
        onOpenPanelChange={setOpenPanel}
        panels={{
          snapshot: { title: "Latest Snapshot Summary", body: snapshotPanelBody },
          attribution: { title: "Attribution", body: attributionPanelBody },
          allocation: { title: "Portfolio Allocation Workspace", body: allocationPanelBody },
          holdings: { title: "Watchlist Holdings", body: holdingsPanelBody },
        }}
      >
        <div className="px-4 pt-4">
          {/* Header: page identity plus attribution date range and export controls. */}
          <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-col self-start">
              <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">Portfolio</h1>
              <p className="text-[var(--text-muted)] mt-1">
                Volatility-first portfolio command center for expected return comparison and investment testing
              </p>
            </div>
            <div className="flex flex-col gap-3 lg:items-end">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--text-muted)]">
                  <InfoTooltip
                    label="Holding Start Date"
                    description="Sets the starting point for return, attribution, and beta calculations. Use the date the stock was added or the position was first held; this prevents multi-year winners from showing inflated returns when the actual holding period is shorter."
                  />
                  <input
                    type="date"
                    value={holdingStartDate}
                    onChange={(event) => setHoldingStartDate(event.target.value)}
                    max={attributionAsOfDate || new Date().toISOString().slice(0, 10)}
                    className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--text-muted)]">
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
                    className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  />
                </label>
              </div>
              <ExportButton tickers={tickers} weights={weights} benchmark={debouncedBenchmarkTicker} period="5y" currency="USD" dateFrom={holdingStartDate} asOfDate={attributionAsOfDate} />
            </div>
          </header>
        </div>
        {/* Mutation feedback lives in the shell, not in a panel: its writers are spread
            across the holdings panel (Sync, delete), the stock detail modal (sector edit,
            add to portfolio) and the allocation panel, and only one panel mounts at a time. */}
        {mutationMessage ? (
          <p data-testid="portfolio-mutation-message" className="px-4 pt-3 text-sm text-[var(--text-muted)]">
            {mutationMessage}
          </p>
        ) : null}
        {/* Same reason: normalize-weights and save-allocation both write this from the
            allocation panel, but it used to render only inside the snapshot panel, so
            "Failed to update the snapshot after saving allocation changes." was never seen. */}
        {portfolioComparisonMessage ? (
          <p data-testid="portfolio-comparison-message" className="px-4 pt-3 text-sm text-[var(--text-muted)]">
            {portfolioComparisonMessage}
          </p>
        ) : null}
        {refreshSummary ? (
          <p data-testid="news-refresh-summary" className="px-4 pt-3 text-[length:var(--type-helper)] text-[var(--text-muted)]">
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
          <p data-testid="news-load-error" className="px-4 pt-3 text-[length:var(--type-helper)] text-[var(--delta-down)]">
            Could not load news for the visible stocks. The headlines below are missing, not absent — press Refresh to try again.
          </p>
        ) : null}
        <StockTileGrid
          stocks={watchlist}
          newsByTicker={bulkNewsQuery.data?.tickers ?? {}}
          filter={gridFilter}
          onFilterChange={setGridFilter}
          search={gridSearch}
          onSearchChange={setGridSearch}
          onOpenStock={openStockDetail}
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
          onRemoveFromWatchlist={(stock) => void handleDeleteHolding(stock)}
          onClose={() => setSelectedStockContext(null)}
        />
      )}
      {snapshotHistoryOpen && (
        <SnapshotHistoryModal
          history={comparisonHistoryData ?? undefined}
          loading={portfolioComparisonHistoryQuery.isLoading && !comparisonHistoryData}
          error={portfolioComparisonHistoryQuery.isError && !comparisonHistoryData}
          activeSnapshotVersion={activeSnapshotMeta?.snapshot_version ?? ""}
          deletingSnapshotVersion={deleteSnapshotMutation.isPending ? deleteSnapshotMutation.variables ?? null : null}
          onSelectSnapshot={(point) => {
            setSelectedHistoryPoint(point);
            setPortfolioComparisonMode("snapshot");
            setSnapshotHistoryOpen(false);
          }}
          onDeleteSnapshot={(point) => void handleDeleteSnapshotVersion(point.snapshot_version)}
          onClose={() => setSnapshotHistoryOpen(false)}
        />
      )}
    </ErrorBoundary>
  );
}
