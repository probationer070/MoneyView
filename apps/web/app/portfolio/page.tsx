"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { fetchApi } from "@/lib/api";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { Sparkline } from "@/components/ui/Sparkline";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { AllocationDonut } from "@/components/charts/AllocationDonut";
import { AttributionWaterfall } from "@/components/charts/AttributionWaterfall";
import TVChart from "@/components/charts/TVChart";
import {
  AttributionResult,
  RawOHLCV,
  toAllocationDonutData,
  toAttributionWaterfallData,
  transformToTVCandles,
  transformToTVVolume,
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

// Domain models returned by the portfolio, detail, and news endpoints.
interface WatchlistDelta {
  delta_pct: number;
}

interface PortfolioStock {
  ticker: string;
  name: string;
  sector: string;
  group_name: string;
  weight: number;
  last_close: number;
  delta: WatchlistDelta;
  sparkline: number[];
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

interface CorporateComparisonSnapshotMeta {
  mode: "snapshot" | "live";
  as_of_date: string;
  generated_at: string;
  snapshot_version: string;
  snapshot_versions_for_day: number;
  snapshot_available: boolean;
  snapshot_source: string;
  comparison_universe: string;
  benchmark_ticker: string;
  custom_tickers: string[];
  snapshot_cadence: string;
  snapshot_retention_days: number;
  snapshot_is_stale: boolean;
}

interface CorporateComparisonResponse {
  market_expected_return: number;
  risk_free_rate: number;
  equity_risk_premium: number;
  stock_expected_return_method: string;
  comparison_reference_return_method: string;
  snapshot: CorporateComparisonSnapshotMeta;
  rows: CorporateComparisonRow[];
}

interface CorporateComparisonHistoryPoint {
  as_of_date: string;
  generated_at: string;
  snapshot_version: string;
  snapshot_versions_for_day: number;
  snapshot_source: string;
  comparison_universe: string;
  benchmark_ticker: string;
  stock_count: number;
  average_expected_return_spread: number;
  average_roic_minus_wacc: number;
  average_dcf_value: number;
  market_expected_return: number;
}

interface CorporateComparisonHistoryResponse {
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

interface CorporateComparisonStockHistoryResponse {
  ticker: string;
  comparison_universe: string;
  benchmark_ticker: string;
  custom_tickers: string[];
  points: CorporateComparisonStockHistoryPoint[];
}

type PortfolioComparisonUniverse = "portfolio_plus_benchmark" | "custom";

interface NewsArticle {
  id: number | null;
  ticker: string | null;
  headline: string;
  url: string;
  source: string;
  published_date: string;
  sentiment: string;
  importance: number;
}

interface StockDetail {
  ticker: string;
  prices: RawOHLCV[];
  news: NewsArticle[];
}

interface SectorGroup {
  sector: string;
  holdings: PortfolioStock[];
}

interface PortfolioComparisonMetrics {
  roicMinusWacc: number | null;
  dcfUpside: number | null;
  expectedVsMarket: number | null;
  currentPrice: number | null;
  volatility: number | null;
}

const PORTFOLIO_DATE_FILTERS_STORAGE_KEY = "moneyview.portfolio.dateFilters.v1";

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
const MOVING_AVERAGE_WINDOWS = [5, 20, 60, 120] as const;
const MOVING_AVERAGE_COLORS: Record<(typeof MOVING_AVERAGE_WINDOWS)[number], string> = {
  5: "#F97316",
  20: "#10B981",
  60: "#3B82F6",
  120: "#111827",
};

// Loading placeholders keep the attribution dashboard stable while API requests resolve.
function KpiSkeletonCard() {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 animate-pulse">
      <div className="h-3 w-24 bg-gray-200 rounded mb-3" />
      <div className="h-7 w-20 bg-gray-200 rounded" />
    </div>
  );
}

function ChartSkeleton({ title }: { title: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 shadow-sm h-[320px] animate-pulse">
      <div className="h-4 w-36 bg-gray-200 rounded mb-5" />
      <div className="h-[250px] w-full bg-gray-100 rounded" />
      <span className="sr-only">{title}</span>
    </div>
  );
}

function WatchlistSkeletonGrid() {
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, idx) => (
        <div
          key={`watchlist-skeleton-${idx}`}
          className="bg-white rounded-[var(--radius)] border border-[var(--border)] p-4 shadow-sm animate-pulse"
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
          <div className="h-8 w-full bg-gray-100 rounded" />
        </div>
      ))}
    </section>
  );
}

// Shared empty/error state panel for watchlist and attribution engine failures.
function StatusPanel({
  title,
  message,
  tone = "neutral",
}: {
  title: string;
  message: string;
  tone?: "neutral" | "warning";
}) {
  const toneClasses =
    tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-[var(--border)] bg-white text-[var(--text-primary)]";

  return (
    <div className={`rounded-[var(--radius)] border p-6 ${toneClasses}`}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-sm mt-2 opacity-80">{message}</p>
    </div>
  );
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

// Table layout for holdings when the user switches away from card view.
function HoldingsTable({
  watchlist,
  comparisonMetricsByTicker,
  onSelect,
  onDelete,
  deletingTicker,
}: {
  watchlist: PortfolioStock[];
  comparisonMetricsByTicker: Record<string, PortfolioComparisonMetrics>;
  onSelect: (stock: PortfolioStock) => void;
  onDelete: (stock: PortfolioStock) => void;
  deletingTicker?: string | null;
}) {
  return (
    <section className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-panel)] shadow-sm">
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
            <th className="hidden px-4 py-3 text-right font-semibold lg:table-cell">Allocation</th>
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
                  <div className="mt-1 text-[11px] text-[var(--text-muted)] lg:hidden">{sectorLabel(stock.sector)}</div>
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
                <td className={`px-4 py-3 text-right font-semibold tabular-nums ${metricToneClass(metrics.roicMinusWacc)}`}>
                  {formatMetricPercent(metrics.roicMinusWacc)}
                </td>
                <td className={`px-4 py-3 text-right font-semibold tabular-nums ${metricToneClass(metrics.dcfUpside)}`}>
                  {formatMetricPercent(metrics.dcfUpside)}
                </td>
                <td className={`px-4 py-3 text-right font-semibold tabular-nums ${metricToneClass(metrics.expectedVsMarket)}`}>
                  {formatMetricPercent(metrics.expectedVsMarket)}
                </td>
                <td className={`hidden px-4 py-3 text-right font-semibold tabular-nums md:table-cell ${volatilityToneClass(metrics.volatility)}`}>
                  {formatMetricPercent(metrics.volatility)}
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
function isToday(dateText: string) {
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

function benchmarkMethodLabel(method?: string | null) {
  if (method === "equal_sector_proxy") return "Equal-sector proxy";
  return method ?? "Direct benchmark profile";
}

function formatWeightPercent(weight: number) {
  return `${(weight * 100).toFixed(1)}%`;
}

function isMetricOutlier(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) || Math.abs(value) > 500;
}

function formatMetricPercent(value: number | null | undefined) {
  if (isMetricOutlier(value)) return "N/A";
  return `${Number(value).toFixed(2)}%`;
}

function formatCurrencyCompact(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}

function metricToneClass(value: number | null | undefined) {
  if (isMetricOutlier(value)) return "text-amber-700";
  if (value === 0) return "text-[var(--text-muted)]";
  return Number(value) > 0 ? "text-[var(--surface)]" : "text-[var(--delta-down)]";
}

function volatilityToneClass(value: number | null | undefined) {
  if (isMetricOutlier(value)) return "text-amber-700";
  if ((value ?? 0) >= 35) return "text-[var(--delta-down)]";
  if ((value ?? 0) >= 20) return "text-amber-700";
  return "text-[var(--surface)]";
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

function summarizeSparklineTrend(sparkline: number[]) {
  if (sparkline.length < 2) return null;
  const first = sparkline[0];
  const last = sparkline.at(-1) ?? first;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null;
  return ((last - first) / first) * 100;
}

const EMPTY_COMPARISON_METRICS: PortfolioComparisonMetrics = {
  roicMinusWacc: null,
  dcfUpside: null,
  expectedVsMarket: null,
  currentPrice: null,
  volatility: null,
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

function formatDateLabel(value: string) {
  if (!value) return "N/A";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function portfolioComparisonUniverseLabel(value: string) {
  if (value === "custom") return "Custom Universe";
  return "Portfolio + Benchmark";
}

function portfolioComparisonUniverseHelpText(value: PortfolioComparisonUniverse) {
  if (value === "custom") {
    return "Custom Universe compares the selected benchmark against only the tickers you enter below. Use it when you want to test a short candidate list without changing the tracked watchlist.";
  }
  return "Portfolio + Benchmark uses the current tracked holdings as the stock comparison set and keeps the benchmark as the external hurdle rate.";
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

function aggregateMonthlyBars(data: RawOHLCV[]) {
  const monthly = new Map<string, RawOHLCV>();
  for (const bar of data) {
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

function buildMovingAverageSeries(data: RawOHLCV[], windowSize: (typeof MOVING_AVERAGE_WINDOWS)[number]) {
  const sorted = [...data].sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
  return sorted.flatMap((bar, index) => {
    if (index + 1 < windowSize) return [];
    const slice = sorted.slice(index + 1 - windowSize, index + 1);
    const average = slice.reduce((sum, item) => sum + item.close, 0) / windowSize;
    return [{ time: bar.date, value: average }];
  });
}

function SnapshotHistoryModal({
  history,
  loading,
  error,
  activeSnapshotVersion,
  onSelectSnapshot,
  onClose,
}: {
  history: CorporateComparisonHistoryResponse | undefined;
  loading: boolean;
  error: boolean;
  activeSnapshotVersion: string;
  onSelectSnapshot: (point: CorporateComparisonHistoryPoint) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-[var(--radius)] bg-[var(--bg-primary)] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-[var(--border)] bg-white p-5">
          <div>
            <h2 className="text-2xl font-bold text-[var(--text-primary)]">Snapshot History</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Timeline for {history?.comparison_universe.replaceAll("_", " ") || "portfolio plus benchmark"} against {history?.benchmark_ticker || DEFAULT_PORTFOLIO_BENCHMARK_TICKER}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius)] border border-[var(--border)] p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            aria-label="Close snapshot history"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[calc(88vh-88px)] overflow-y-auto p-5">
          {loading && <p className="text-sm text-[var(--text-muted)]">Loading snapshot history...</p>}
          {error && <StatusPanel title="Snapshot History Unavailable" message="Could not load saved portfolio snapshot history." tone="warning" />}
          {!loading && !error && (history?.points.length ?? 0) === 0 && (
            <p className="text-sm text-[var(--text-muted)]">No saved portfolio snapshots are available yet.</p>
          )}
          {!loading && !error && (history?.points.length ?? 0) > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--surface-muted)] text-left text-[var(--text-muted)]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">As Of</th>
                    <th className="px-4 py-3 font-semibold">Source</th>
                    <th className="px-4 py-3 text-right font-semibold">Versions</th>
                    <th className="px-4 py-3 text-right font-semibold">Holdings</th>
                    <th className="px-4 py-3 text-right font-semibold">Avg Spread</th>
                    <th className="px-4 py-3 text-right font-semibold">Avg ROIC - WACC</th>
                    <th className="px-4 py-3 text-right font-semibold">Avg DCF</th>
                    <th className="px-4 py-3 text-right font-semibold">Market Return</th>
                    <th className="px-4 py-3 text-right font-semibold">Review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]/60">
                  {history?.points.map((point) => {
                    const isActive = point.snapshot_version === activeSnapshotVersion;
                    return (
                    <tr key={`history-${point.snapshot_version}`} className={isActive ? "bg-[var(--surface-muted)]/60" : undefined}>
                      <td className="px-4 py-3 font-bold text-[var(--text-primary)]">{formatDateLabel(point.as_of_date)}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{point.snapshot_source}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{point.snapshot_versions_for_day}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{point.stock_count}</td>
                      <td className={`px-4 py-3 text-right font-bold tabular-nums ${point.average_expected_return_spread >= 0 ? "text-[var(--surface)]" : "text-[var(--delta-down)]"}`}>{point.average_expected_return_spread.toFixed(2)}%</td>
                      <td className={`px-4 py-3 text-right font-bold tabular-nums ${point.average_roic_minus_wacc >= 0 ? "text-[var(--surface)]" : "text-[var(--delta-down)]"}`}>{point.average_roic_minus_wacc.toFixed(2)}%</td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums">${point.average_dcf_value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{point.market_expected_return.toFixed(2)}%</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => onSelectSnapshot(point)}
                          className={`inline-flex items-center justify-center rounded-[var(--radius)] border px-3 py-1 text-xs font-semibold ${
                            isActive
                              ? "border-[var(--accent)] bg-[var(--surface-muted)] text-[var(--text-primary)]"
                              : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                          }`}
                        >
                          {isActive ? "Selected" : "Review Snapshot"}
                        </button>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Detail modal loads OHLCV history and paginated ticker news for the selected holding.
function StockDetailModal({
  stock,
  comparisonMetrics,
  snapshotMeta,
  comparisonUniverse,
  comparisonBenchmarkTicker,
  comparisonCustomTickersInput,
  activeSnapshotVersion,
  onAddToPortfolio,
  onRemoveFromWatchlist,
  onClose,
}: {
  stock: PortfolioStock;
  comparisonMetrics: PortfolioComparisonMetrics;
  snapshotMeta: CorporateComparisonSnapshotMeta | null;
  comparisonUniverse: PortfolioComparisonUniverse;
  comparisonBenchmarkTicker: string;
  comparisonCustomTickersInput: string;
  activeSnapshotVersion: string;
  onAddToPortfolio: (stock: PortfolioStock) => void;
  onRemoveFromWatchlist: (stock: PortfolioStock) => void;
  onClose: () => void;
}) {
  const newsContainerRef = useRef<HTMLDivElement | null>(null);
  const newsPageSize = 5;
  const [timeframe, setTimeframe] = useState<"daily" | "monthly">("daily");
  const [snapshotTrendOpen, setSnapshotTrendOpen] = useState(false);
  const effectiveComparisonUniverse = snapshotMeta?.comparison_universe ?? comparisonUniverse;
  const effectiveComparisonBenchmarkTicker = snapshotMeta?.benchmark_ticker ?? comparisonBenchmarkTicker;
  const effectiveComparisonCustomTickersInput = snapshotMeta?.custom_tickers.join(", ") ?? comparisonCustomTickersInput;

  // Price history powers the TradingView chart; news is fetched lazily and crawled if needed.
  const detailQuery = useQuery<StockDetail>({
    queryKey: ["portfolio-stock-detail", stock.ticker],
    queryFn: () => fetchApi<StockDetail>(`/portfolio/stock/${stock.ticker}?period=5y`),
  });

  const newsQuery = useInfiniteQuery<NewsArticle[]>({
    queryKey: ["stock-news", stock.ticker],
    queryFn: async ({ pageParam = 0 }) => {
      const offset = Number(pageParam);
      const existing = await fetchApi<NewsArticle[]>(
        `/news/feed?ticker=${stock.ticker}&limit=${newsPageSize}&offset=${offset}`,
      );
      if (existing.length >= newsPageSize) return existing;

      await fetchApi<NewsArticle[]>(
        `/news/crawl/stock?ticker=${stock.ticker}&company_name=${encodeURIComponent(stock.name || stock.ticker)}&limit=${newsPageSize}&offset=${offset}`,
        { method: "POST" },
      );
      const refreshed = await fetchApi<NewsArticle[]>(
        `/news/feed?ticker=${stock.ticker}&limit=${newsPageSize}&offset=${offset}`,
      );
      if (refreshed.length > 0) return refreshed;
      if (existing.length > 0) return existing;
      return [];
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (
      lastPage.length === newsPageSize ? allPages.length * newsPageSize : undefined
    ),
    staleTime: 1000 * 60 * 10,
  });
  const stockSnapshotHistoryQuery = useQuery<CorporateComparisonStockHistoryResponse>({
    queryKey: [
      "portfolio-stock-snapshot-history",
      stock.ticker,
      effectiveComparisonUniverse,
      effectiveComparisonBenchmarkTicker,
      effectiveComparisonCustomTickersInput,
      snapshotMeta?.snapshot_version ?? "",
    ],
    enabled: snapshotTrendOpen,
    queryFn: ({ signal }) =>
      fetchApi<CorporateComparisonStockHistoryResponse>("/corporate/comparison/stock-history", {
        signal,
        params: {
          ticker: stock.ticker,
          comparison_universe: effectiveComparisonUniverse,
          benchmark_ticker: effectiveComparisonBenchmarkTicker,
          custom_tickers: effectiveComparisonUniverse === "custom" ? effectiveComparisonCustomTickersInput : "",
          limit: 30,
        },
      }),
    staleTime: 60_000,
  });

  const prices = useMemo(() => detailQuery.data?.prices ?? [], [detailQuery.data?.prices]);
  const chartPrices = useMemo(
    () => (timeframe === "monthly" ? aggregateMonthlyBars(prices) : prices),
    [prices, timeframe],
  );
  const candles = useMemo(() => transformToTVCandles(chartPrices), [chartPrices]);
  const volume = useMemo(() => transformToTVVolume(chartPrices), [chartPrices]);
  const movingAverageSeries = useMemo(
    () =>
      MOVING_AVERAGE_WINDOWS.map((windowSize) => ({
        title: `${windowSize}${timeframe === "monthly" ? "M" : "D"} MA`,
        color: MOVING_AVERAGE_COLORS[windowSize],
        data: buildMovingAverageSeries(chartPrices, windowSize),
      })),
    [chartPrices, timeframe],
  );
  const news = newsQuery.data?.pages.flat() ?? detailQuery.data?.news ?? [];
  const currentPrice = prices.at(-1)?.close ?? stock.last_close;
  const previousPrice = prices.length > 1 ? prices[prices.length - 2].close : currentPrice;
  const priceChangePct = previousPrice ? ((currentPrice - previousPrice) / previousPrice) * 100 : 0;
  const priceTone = priceChangePct >= 0 ? "text-[var(--delta-up)]" : "text-[var(--delta-down)]";
  const sparklineTrendPct = summarizeSparklineTrend(stock.sparkline);
  const snapshotContextLabel = snapshotMeta?.mode === "snapshot"
    ? `Saved snapshot metrics from ${formatDateLabel(snapshotMeta.as_of_date)}`
    : "Live comparison metrics";
  const snapshotTrendPoints = stockSnapshotHistoryQuery.data?.points ?? [];
  const flaggedComparisonMetricCount = [
    comparisonMetrics.roicMinusWacc,
    comparisonMetrics.dcfUpside,
    comparisonMetrics.expectedVsMarket,
  ].filter((value) => isMetricOutlier(value)).length;
  const earliestSnapshotTrendPoint = snapshotTrendPoints.at(-1) ?? null;
  const latestSnapshotTrendPoint = snapshotTrendPoints[0] ?? null;
  const expectedSpreadTrendDelta = latestSnapshotTrendPoint && earliestSnapshotTrendPoint
    ? latestSnapshotTrendPoint.expected_return_spread - earliestSnapshotTrendPoint.expected_return_spread
    : null;

  // Lock background scrolling while the modal is open and allow Escape to close it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-[var(--radius)] bg-[var(--bg-primary)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-[var(--border)] bg-white p-5">
          <div>
            <h2 className="text-2xl font-bold text-[var(--text-primary)]">{stock.name || stock.ticker}</h2>
            <p className="text-sm font-light tracking-wide text-[var(--text-muted)]">{stock.ticker}</p>
          </div>
          <div className="ml-auto mr-4 text-right">
            <p className={`text-2xl font-black tabular-nums ${priceTone}`}>
              ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            </p>
            <p className={`text-sm font-bold ${priceTone}`}>
              {priceChangePct >= 0 ? "+" : ""}{priceChangePct.toFixed(1)}%
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius)] border border-[var(--border)] p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            aria-label="Close stock detail"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal body: price/volume chart on the left, stock-specific news feed on the right. */}
        <div className="grid max-h-[calc(92vh-82px)] grid-cols-1 gap-4 overflow-y-auto p-5 lg:grid-cols-3">
          <section className="lg:col-span-2 rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-primary)]">
                  <InfoTooltip
                    label="OHLC Candlestick + Volume"
                    description="Candles encode open, high, low, and close for each selected period. Volume bars show traded activity. Moving averages use 5, 20, 60, and 120 period closes, recalculated from daily or monthly bars depending on the selected timeframe."
                  />
                </h3>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
                  {movingAverageSeries.map((series) => (
                    <span
                      key={series.title}
                      className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-2 py-1"
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.color }} />
                      {series.title}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="inline-flex rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setTimeframe("daily")}
                    className={`rounded-[calc(var(--radius)-4px)] px-3 py-1 font-semibold ${timeframe === "daily" ? "bg-white text-[var(--text-primary)] shadow-sm" : "text-[var(--text-muted)]"}`}
                  >
                    Daily
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimeframe("monthly")}
                    className={`rounded-[calc(var(--radius)-4px)] px-3 py-1 font-semibold ${timeframe === "monthly" ? "bg-white text-[var(--text-primary)] shadow-sm" : "text-[var(--text-muted)]"}`}
                  >
                    Monthly
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setSnapshotTrendOpen((current) => !current)}
                  className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  {snapshotTrendOpen ? "Hide Snapshot History" : "Open Snapshot History"}
                </button>
                <button
                  type="button"
                  onClick={() => onAddToPortfolio(stock)}
                  className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  {stock.weight > 0 ? "Review Portfolio Weight" : "Add To Portfolio Test"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onRemoveFromWatchlist(stock);
                    onClose();
                  }}
                  className="inline-flex items-center justify-center rounded-[var(--radius)] border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                >
                  Remove From Watchlist
                </button>
              </div>
            </div>
            {detailQuery.isLoading ? (
              <div className="h-[520px] animate-pulse rounded-[var(--radius)] bg-gray-100" />
            ) : candles.length > 0 ? (
              <>
                <TVChart
                  data={candles}
                  volumeData={volume}
                  lineSeriesData={movingAverageSeries}
                  height={520}
                  tickerName={stock.ticker}
                  colorAccent="var(--accent)"
                  upColor="#EF5350"
                  downColor="#4589E5"
                />
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">ROIC - WACC</div>
                    <div className={`mt-2 text-2xl font-black tabular-nums ${metricToneClass(comparisonMetrics.roicMinusWacc)}`}>
                      {formatMetricPercent(comparisonMetrics.roicMinusWacc)}
                    </div>
                    <p className="mt-2 text-xs text-[var(--text-muted)]">
                      Positive values imply returns on invested capital are exceeding the current capital cost estimate.
                    </p>
                  </div>
                  <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">DCF Upside</div>
                    <div className={`mt-2 text-2xl font-black tabular-nums ${metricToneClass(comparisonMetrics.dcfUpside)}`}>
                      {formatMetricPercent(comparisonMetrics.dcfUpside)}
                    </div>
                    <p className="mt-2 text-xs text-[var(--text-muted)]">
                      Snapshot-side upside or downside versus current price, filtered for outlier values before display.
                    </p>
                  </div>
                  <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Expected vs Market</div>
                    <div className={`mt-2 text-2xl font-black tabular-nums ${metricToneClass(comparisonMetrics.expectedVsMarket)}`}>
                      {formatMetricPercent(comparisonMetrics.expectedVsMarket)}
                    </div>
                    <p className="mt-2 text-xs text-[var(--text-muted)]">
                      Spread between the stock return expectation and the market reference return used in the saved comparison snapshot.
                    </p>
                  </div>
                </div>
                <div className="mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-panel)] p-3 text-sm text-[var(--text-muted)]">
                  <span className="font-semibold text-[var(--text-primary)]">Metric source:</span> {snapshotContextLabel}.
                  {snapshotMeta?.snapshot_source && ` Source: ${snapshotMeta.snapshot_source}.`}
                  {activeSnapshotVersion && ` Version: ${activeSnapshotVersion}.`}
                  {sparklineTrendPct != null && ` Recent price trend: ${sparklineTrendPct >= 0 ? "+" : ""}${sparklineTrendPct.toFixed(2)}%.`}
                </div>
                {flaggedComparisonMetricCount > 0 && (
                  <div className="mt-3 rounded-[var(--radius)] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    {flaggedComparisonMetricCount} stock metric value{flaggedComparisonMetricCount === 1 ? "" : "s"} for {stock.ticker} {flaggedComparisonMetricCount === 1 ? "is" : "are"} currently flagged as outlier data and rendered as <span className="font-semibold">N/A</span>. Treat the price chart and saved snapshot history as the primary review context until fresher fundamentals are available.
                  </div>
                )}
                {snapshotTrendOpen && (
                  <div className="mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-white p-4">
                    <div className="flex flex-col gap-1">
                      <h4 className="text-sm font-bold text-[var(--text-primary)]">Snapshot History Drill-down</h4>
                      <p className="text-xs text-[var(--text-muted)]">
                        Review how saved comparison metrics changed across the latest persisted daily snapshots for {stock.ticker}. The currently selected snapshot row stays highlighted.
                      </p>
                      {snapshotMeta?.mode === "snapshot" && (
                        <p className="text-xs text-[var(--text-muted)]">
                          Review context: {formatDateLabel(snapshotMeta.as_of_date)} snapshot, {portfolioComparisonUniverseLabel(effectiveComparisonUniverse)}, benchmark {effectiveComparisonBenchmarkTicker}.
                        </p>
                      )}
                    </div>
                    {stockSnapshotHistoryQuery.isLoading && (
                      <p className="mt-3 text-sm text-[var(--text-muted)]">Loading snapshot trend...</p>
                    )}
                    {stockSnapshotHistoryQuery.isError && (
                      <div className="mt-3">
                        <StatusPanel
                          title="Snapshot Trend Unavailable"
                          message="Could not load saved snapshot trend data for this stock."
                          tone="warning"
                        />
                      </div>
                    )}
                    {!stockSnapshotHistoryQuery.isLoading && !stockSnapshotHistoryQuery.isError && snapshotTrendPoints.length === 0 && (
                      <p className="mt-3 text-sm text-[var(--text-muted)]">No saved snapshot trend data is available for this stock yet.</p>
                    )}
                    {!stockSnapshotHistoryQuery.isLoading && !stockSnapshotHistoryQuery.isError && snapshotTrendPoints.length > 0 && (
                      <div className="mt-3 space-y-3">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Saved Snapshots</div>
                            <div className="mt-1 text-lg font-black text-[var(--text-primary)]">{snapshotTrendPoints.length}</div>
                            <p className="mt-1 text-xs text-[var(--text-muted)]">
                              Persisted comparison rows currently available for {stock.ticker}.
                            </p>
                          </div>
                          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Expected Spread Trend</div>
                            <div className={`mt-1 text-lg font-black ${metricToneClass(expectedSpreadTrendDelta)}`}>
                              {formatMetricPercent(expectedSpreadTrendDelta)}
                            </div>
                            <p className="mt-1 text-xs text-[var(--text-muted)]">
                              Latest versus oldest saved expected-return spread in this drill-down.
                            </p>
                          </div>
                          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Recent Price Sparkline</div>
                            <div className="mt-2 h-10">
                              <Sparkline
                                data={stock.sparkline}
                                height={40}
                                color={priceChangePct >= 0 ? "var(--delta-up)" : "var(--delta-down)"}
                              />
                            </div>
                            <p className="mt-1 text-xs text-[var(--text-muted)]">
                              Watchlist-side price path shown next to the saved comparison history.
                            </p>
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                          <thead className="bg-[var(--surface-muted)] text-left text-[var(--text-muted)]">
                            <tr>
                              <th className="px-3 py-2 font-semibold">As Of</th>
                              <th className="px-3 py-2 font-semibold">Source</th>
                              <th className="px-3 py-2 text-right font-semibold">Price</th>
                              <th className="px-3 py-2 text-right font-semibold">ROIC - WACC</th>
                              <th className="px-3 py-2 text-right font-semibold">DCF Upside</th>
                              <th className="px-3 py-2 text-right font-semibold">Expected vs Market</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--border)]/60">
                            {snapshotTrendPoints.map((point) => (
                              <tr key={`${stock.ticker}-${point.snapshot_version}`} className={point.snapshot_version === activeSnapshotVersion ? "bg-[var(--surface-muted)]/60" : undefined}>
                                <td className="px-3 py-2 font-semibold text-[var(--text-primary)]">{formatDateLabel(point.as_of_date)}</td>
                                <td className="px-3 py-2 text-[var(--text-muted)]">{point.snapshot_source}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{formatCurrencyCompact(point.current_price)}</td>
                                <td className={`px-3 py-2 text-right font-semibold tabular-nums ${metricToneClass(point.roic_minus_wacc)}`}>{formatMetricPercent(point.roic_minus_wacc)}</td>
                                <td className={`px-3 py-2 text-right font-semibold tabular-nums ${metricToneClass(point.dcf_implied_return)}`}>{formatMetricPercent(point.dcf_implied_return)}</td>
                                <td className={`px-3 py-2 text-right font-semibold tabular-nums ${metricToneClass(point.expected_return_spread)}`}>{formatMetricPercent(point.expected_return_spread)}</td>
                              </tr>
                            ))}
                          </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <StatusPanel title="No Price Data" message="No OHLC history is available for this ticker yet." tone="warning" />
            )}
          </section>

          <section className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 shadow-sm">
            <h3 className="text-sm font-bold text-[var(--text-primary)]">
              <InfoTooltip
                label="Stock News"
                description="Latest stock-specific headlines crawled from Google News RSS and stored locally by ticker. Rows published today receive a gradient left border."
              />
            </h3>
            <div
              ref={newsContainerRef}
              onScroll={(event) => {
                const target = event.currentTarget;
                if (
                  target.scrollTop + target.clientHeight >= target.scrollHeight - 24 &&
                  newsQuery.hasNextPage &&
                  !newsQuery.isFetchingNextPage
                ) {
                  newsQuery.fetchNextPage();
                }
              }}
              className="mt-4 max-h-[500px] space-y-3 overflow-y-auto pr-1"
            >
              {newsQuery.isLoading && <p className="text-sm text-[var(--text-muted)]">Loading news...</p>}
              {!newsQuery.isLoading && news.length === 0 && (
                <p className="text-sm text-[var(--text-muted)]">No stock-specific news found.</p>
              )}
              {news.map((item, index) => {
                const today = isToday(item.published_date);
                return (
                  <a
                    key={`${item.url}-${index}`}
                    href={item.url || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`block rounded-[var(--radius)] border border-[var(--border)] bg-white p-3 text-sm shadow-sm transition-colors hover:border-[var(--accent)] ${today
                      ? "border-l-4 border-l-transparent [border-image:linear-gradient(to_bottom,#60CAAD,#444444)_1]"
                      : "border-l-4 border-l-[var(--border)]"
                      }`}
                  >
                    <p className="font-semibold leading-snug text-[var(--text-primary)]">{item.headline}</p>
                    <p className="mt-2 text-xs text-[var(--text-muted)]">{item.published_date || "Unknown date"}</p>
                  </a>
                );
              })}
              {newsQuery.isFetchingNextPage && (
                <p className="py-2 text-center text-xs text-[var(--text-muted)]">Loading 5 more articles...</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function PortfolioPage() {
  // Page state tracks the holdings presentation mode and the currently opened detail modal.
  const queryClient = useQueryClient();
  const router = useRouter();
  const initialDateFilters = readStoredPortfolioDateFilters();
  const [holdingsView, setHoldingsView] = useState<ViewMode>("chart");
  const [selectedStock, setSelectedStock] = useState<PortfolioStock | null>(null);
  const [holdingStartDate, setHoldingStartDate] = useState(initialDateFilters.holdingStartDate);
  const [attributionAsOfDate, setAttributionAsOfDate] = useState(initialDateFilters.attributionAsOfDate);
  const [newTicker, setNewTicker] = useState("");
  const [newName, setNewName] = useState("");
  const [newSector, setNewSector] = useState("");
  const [addToWatchlistOnly, setAddToWatchlistOnly] = useState(true);
  const [newWeightPercent, setNewWeightPercent] = useState("");
  const [weightDrafts, setWeightDrafts] = useState<Record<string, string>>({});
  const [importJsonArmed, setImportJsonArmed] = useState(false);
  const [mutationMessage, setMutationMessage] = useState<string | null>(null);
  const [portfolioComparisonMode, setPortfolioComparisonMode] = useState<"snapshot" | "live">("snapshot");
  const [portfolioComparisonUniverse, setPortfolioComparisonUniverse] = useState<PortfolioComparisonUniverse>("portfolio_plus_benchmark");
  const [portfolioComparisonBenchmarkTicker, setPortfolioComparisonBenchmarkTicker] = useState(DEFAULT_PORTFOLIO_BENCHMARK_TICKER);
  const [portfolioComparisonCustomTickersInput, setPortfolioComparisonCustomTickersInput] = useState("NVDA, TSLA");
  const [portfolioComparisonMessage, setPortfolioComparisonMessage] = useState<string | null>(null);
  const [snapshotHistoryOpen, setSnapshotHistoryOpen] = useState(false);
  const [selectedHistoryPoint, setSelectedHistoryPoint] = useState<CorporateComparisonHistoryPoint | null>(null);
  const [allocationModelOpen, setAllocationModelOpen] = useState(false);
  const [applyAllocationToSnapshot, setApplyAllocationToSnapshot] = useState(false);
  const [sectorFilter, setSectorFilter] = useState("All Sectors");
  const [collapsedSectors, setCollapsedSectors] = useState<Record<string, boolean>>({});
  const allocationSectionRef = useRef<HTMLElement | null>(null);
  const weightInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const normalizedBenchmarkTicker = portfolioComparisonBenchmarkTicker.trim().toUpperCase() || DEFAULT_PORTFOLIO_BENCHMARK_TICKER;
  const normalizedCustomTickersInput = portfolioComparisonCustomTickersInput.toUpperCase();
  const debouncedBenchmarkTicker = useDebounce(normalizedBenchmarkTicker, 400);
  const debouncedCustomTickersInput = useDebounce(normalizedCustomTickersInput, 400);

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
    queryFn: () => fetchApi<PortfolioStock[]>("/portfolio/watchlist"),
    staleTime: 1000 * 60,
  });
  const syncStatusQuery = useQuery<WatchlistSyncStatus>({
    queryKey: ["portfolio-watchlist-sync-status"],
    queryFn: () => fetchApi<WatchlistSyncStatus>("/portfolio/watchlist/sync-status"),
    staleTime: 1000 * 30,
  });

  const watchlist = watchlistQuery.data ?? EMPTY_WATCHLIST;
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
  const weights = useMemo(() => {
    if (tickers.length === 0) return [];
    if (usingStoredWeights) return storedWeights;
    return tickers.map(() => 1 / tickers.length);
  }, [storedWeights, tickers, usingStoredWeights]);
  const hasHoldings = watchlist.length > 0;
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
  const portfolioComparisonQuery = useQuery<CorporateComparisonResponse>({
    queryKey: ["portfolio-comparison-summary", portfolioComparisonMode, portfolioComparisonUniverse, debouncedBenchmarkTicker, debouncedCustomTickersInput],
    enabled: hasHoldings,
    queryFn: ({ signal }) =>
      fetchApi<CorporateComparisonResponse>("/corporate/comparison", {
        signal,
        params: {
          mode: portfolioComparisonMode,
          comparison_universe: portfolioComparisonUniverse,
          benchmark_ticker: debouncedBenchmarkTicker,
          custom_tickers: portfolioComparisonUniverse === "custom" ? debouncedCustomTickersInput : "",
        },
      }),
    staleTime: 60_000,
  });
  const portfolioComparisonHistoryQuery = useQuery<CorporateComparisonHistoryResponse>({
    queryKey: ["portfolio-comparison-history", portfolioComparisonUniverse, debouncedBenchmarkTicker, debouncedCustomTickersInput],
    enabled: hasHoldings,
    queryFn: ({ signal }) =>
      fetchApi<CorporateComparisonHistoryResponse>("/corporate/comparison/history", {
        signal,
        params: {
          comparison_universe: portfolioComparisonUniverse,
          benchmark_ticker: debouncedBenchmarkTicker,
          custom_tickers: portfolioComparisonUniverse === "custom" ? debouncedCustomTickersInput : "",
          limit: 30,
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
    }),
    staleTime: 60_000,
  });

  // Attribution uses saved watchlist weights when present, otherwise falls back to equal weight.
  const attributionQuery = useQuery<AttributionResult>({
    queryKey: ["portfolio-attribution", tickers.join(","), weights.join(","), "5y", debouncedBenchmarkTicker, "USD", holdingStartDate, attributionAsOfDate],
    enabled: canRunAttribution,
    queryFn: () =>
      fetchApi<AttributionResult>("/portfolio/attribution", {
        method: "POST",
        body: JSON.stringify({
          tickers,
          weights,
          benchmark: debouncedBenchmarkTicker,
          period: "5y",
          currency: "USD",
          date_from: holdingStartDate || null,
          as_of_date: attributionAsOfDate || null,
          attribution_method: "brinson_fachler_arithmetic",
          allow_synthetic_fallback: true,
          allow_benchmark_proxy: true,
        }),
      }),
    placeholderData: (previous) => previous,
  });

  // Chart adapters convert domain attribution data into display-ready allocation/effects datasets.
  const allocationData = attributionQuery.data ? toAllocationDonutData(attributionQuery.data) : [];
  const waterfallData = attributionQuery.data ? toAttributionWaterfallData(attributionQuery.data) : [];
  const shouldShowAttribution = hasHoldings && !attributionQuery.isError;
  const activeComparisonData = portfolioComparisonMode === "snapshot" && selectedSnapshotQuery.data
    ? selectedSnapshotQuery.data
    : portfolioComparisonQuery.data;
  const activeSnapshotMeta = activeComparisonData?.snapshot ?? null;
  const recentSnapshotPoints = portfolioComparisonHistoryQuery.data?.points.slice(0, 3) ?? [];
  const portfolioComparisonCalculating = normalizedBenchmarkTicker !== debouncedBenchmarkTicker
    || (portfolioComparisonUniverse === "custom" && normalizedCustomTickersInput !== debouncedCustomTickersInput)
    || portfolioComparisonQuery.isFetching
    || selectedSnapshotQuery.isFetching;
  const comparisonMetricsByTicker = useMemo<Record<string, PortfolioComparisonMetrics>>(() => {
    const portfolioComparisonRows = activeComparisonData?.rows ?? [];
    return portfolioComparisonRows
      .filter((row) => row.group_name !== "benchmark")
      .reduce<Record<string, PortfolioComparisonMetrics>>((acc, row) => {
        acc[row.ticker] = {
          roicMinusWacc: row.roic_minus_wacc,
          dcfUpside: row.dcf_implied_return,
          expectedVsMarket: row.expected_return_spread,
          currentPrice: row.current_price,
          volatility: estimateVolatilityFromSparkline(
            watchlist.find((stock) => stock.ticker === row.ticker)?.sparkline ?? [],
          ),
        };
        return acc;
      }, {});
  }, [activeComparisonData?.rows, watchlist]);

  const portfolioSnapshotSummary = useMemo(() => {
    const stockRows = activeComparisonData?.rows.filter((row) => row.group_name !== "benchmark") ?? [];
    if (stockRows.length === 0) return null;
    const flaggedMetricsCount = stockRows.reduce((sum, row) => (
      sum
      + (isMetricOutlier(row.expected_return_spread) ? 1 : 0)
      + (isMetricOutlier(row.roic_minus_wacc) ? 1 : 0)
      + (isMetricOutlier(row.dcf_implied_return) ? 1 : 0)
    ), 0);
    const positiveSpreadCount = stockRows.filter((row) => !isMetricOutlier(row.expected_return_spread) && row.expected_return_spread > 0).length;
    const positiveEconomicSpreadCount = stockRows.filter((row) => !isMetricOutlier(row.roic_minus_wacc) && row.roic_minus_wacc > 0).length;
    const positiveDcfCount = stockRows.filter((row) => !isMetricOutlier(row.dcf_implied_return) && row.dcf_implied_return > 0).length;
    const highestSpreadRow = stockRows
      .filter((row) => !isMetricOutlier(row.expected_return_spread))
      .sort((left, right) => right.expected_return_spread - left.expected_return_spread)[0] ?? null;
    return {
      stockCount: stockRows.length,
      flaggedMetricsCount,
      positiveSpreadCount,
      positiveEconomicSpreadCount,
      positiveDcfCount,
      highestSpreadTicker: highestSpreadRow?.ticker ?? "N/A",
      highestSpreadValue: highestSpreadRow?.expected_return_spread ?? null,
    };
  }, [activeComparisonData?.rows]);

  const refreshPortfolioQueries = async () => {
    const refreshedWatchlist = await watchlistQuery.refetch();
    await syncStatusQuery.refetch();
    await queryClient.invalidateQueries({ queryKey: ["portfolio-attribution"] });
    await queryClient.refetchQueries({ queryKey: ["portfolio-attribution"], type: "active" });
    return refreshedWatchlist.data ?? [];
  };

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
      if (selectedStock?.ticker === ticker) {
        setSelectedStock(null);
      }
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
      const refreshedWatchlist = await refreshPortfolioQueries();
      setMutationMessage(`Imported ${result.item_count} holdings from stock_targets.json into the DB watchlist.`);
      if (selectedStock && !refreshedWatchlist.some((stock) => stock.ticker === selectedStock.ticker)) {
        setSelectedStock(null);
      }
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

  const updateWeightMutation = useMutation({
    mutationFn: async (payload: WatchlistItemPayload) =>
      fetchApi<WatchlistItemPayload>("/portfolio/watchlist", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: async (payload) => {
      setMutationMessage(`Saved allocation for ${payload.ticker}.`);
      await refreshPortfolioQueries();
    },
    onError: (error) => {
      setMutationMessage(error instanceof Error ? error.message : "Failed to save allocation.");
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

  const handleDeleteHolding = async (stock: PortfolioStock) => {
    setMutationMessage(null);
    await deleteWatchlistMutation.mutateAsync(stock.ticker);
  };

  const handleSaveWeight = async (stock: PortfolioStock) => {
    const nextPercent = Math.max(Number(weightDrafts[stock.ticker] ?? "0"), 0);
    setMutationMessage(null);
    await updateWeightMutation.mutateAsync({
      ticker: stock.ticker,
      name: stock.name,
      sector: stock.sector,
      group_name: stock.group_name,
      weight: nextPercent / 100,
    });
    if (applyAllocationToSnapshot) {
      try {
        const refreshed = await savePortfolioSnapshot();
        await queryClient.invalidateQueries({ queryKey: ["portfolio-comparison-summary"] });
        setSelectedHistoryPoint(null);
        setPortfolioComparisonMode("snapshot");
        setPortfolioComparisonMessage(`Saved allocation for ${stock.ticker} and updated the ${formatDateLabel(refreshed.snapshot.as_of_date)} snapshot.`);
      } catch (error) {
        setPortfolioComparisonMessage(error instanceof Error ? error.message : "Failed to update the snapshot after saving allocation.");
      }
    }
  };

  const handleNormalizeWeights = async () => {
    const normalized = normalizeWeightsToOne(watchlist.filter((stock) => stock.weight > 0));
    if (normalized.length === 0) {
      setMutationMessage("Assign positive weights before normalizing.");
      return;
    }

    setMutationMessage(null);
    for (const stock of normalized) {
      await updateWeightMutation.mutateAsync({
        ticker: stock.ticker,
        name: stock.name,
        sector: stock.sector,
        group_name: stock.group_name,
        weight: stock.weight,
      });
    }
    setMutationMessage("Normalized saved stock weights to 100.0% invested.");
    if (applyAllocationToSnapshot) {
      try {
        const refreshed = await savePortfolioSnapshot();
        await queryClient.invalidateQueries({ queryKey: ["portfolio-comparison-summary"] });
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

  const savePortfolioSnapshot = async () => (
    fetchApi<CorporateComparisonResponse>("/corporate/comparison/snapshot", {
      method: "POST",
      params: {
        comparison_universe: portfolioComparisonUniverse,
        benchmark_ticker: normalizedBenchmarkTicker,
        custom_tickers: portfolioComparisonUniverse === "custom" ? normalizedCustomTickersInput : "",
      },
    })
  );

  const handleRefreshPortfolioSnapshot = async () => {
    setPortfolioComparisonMessage(null);
    try {
      const refreshed = await savePortfolioSnapshot();
      await queryClient.invalidateQueries({ queryKey: ["portfolio-comparison-summary"] });
      setSelectedHistoryPoint(null);
      setPortfolioComparisonMode("snapshot");
      setPortfolioComparisonMessage(`Saved portfolio snapshot for ${formatDateLabel(refreshed.snapshot.as_of_date)}.`);
    } catch (error) {
      setPortfolioComparisonMessage(error instanceof Error ? error.message : "Failed to save portfolio snapshot.");
    }
  };

  const handleFocusAllocationForStock = (stock: PortfolioStock) => {
    setAllocationModelOpen(true);
    setMutationMessage(
      stock.weight > 0
        ? `${stock.ticker} already has a saved allocation. Adjust the weight below if needed.`
        : `Allocation controls opened for ${stock.ticker}. Set a positive weight to include it in portfolio testing.`,
    );
    requestAnimationFrame(() => {
      allocationSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      const input = weightInputRefs.current[stock.ticker];
      input?.focus();
      input?.select();
    });
  };

  const benchmarkQuickActions = PORTFOLIO_BENCHMARK_PRESETS.filter((preset) => ["sp500", "kospi", "kosdaq"].includes(preset.id));

  return (
    <ErrorBoundary
      fallbackTitle="Portfolio Command Center Failure"
      fallbackMessage="Portfolio attribution UI failed to render safely."
    >
      <div className="space-y-6 animate-in fade-in duration-500">
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
                  className="rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text-primary)]"
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
                  className="rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </label>
            </div>
            <ExportButton tickers={tickers} weights={weights} benchmark={debouncedBenchmarkTicker} period="5y" currency="USD" dateFrom={holdingStartDate} asOfDate={attributionAsOfDate} />
          </div>
        </header>

        {hasHoldings && (
          <section className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 shadow-sm">
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
                      className="rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-xs text-[var(--text-primary)]"
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
                      className="w-24 rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-xs text-[var(--text-primary)]"
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
                      className="rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-xs text-[var(--text-primary)]"
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
                        className="w-48 rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-xs text-[var(--text-primary)]"
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
                      className="rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-xs text-[var(--text-primary)]"
                    >
                      <option value="snapshot">Persisted snapshot</option>
                      <option value="live">Live calculation</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleRefreshPortfolioSnapshot()}
                    className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-black hover:border-[var(--surface)]"
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
              {portfolioComparisonHistoryQuery.isLoading && (
                <p className="mt-3 text-sm text-[var(--text-muted)]">Loading saved snapshots...</p>
              )}
              {portfolioComparisonHistoryQuery.isError && (
                <div className="mt-3">
                  <StatusPanel
                    title="Saved Snapshot List Unavailable"
                    message="Could not load the saved snapshot list for this benchmark and universe."
                    tone="warning"
                  />
                </div>
              )}
              {!portfolioComparisonHistoryQuery.isLoading && !portfolioComparisonHistoryQuery.isError && recentSnapshotPoints.length === 0 && (
                <p className="mt-3 text-sm text-[var(--text-muted)]">No saved snapshots are available yet for the current review context.</p>
              )}
              {!portfolioComparisonHistoryQuery.isLoading && !portfolioComparisonHistoryQuery.isError && recentSnapshotPoints.length > 0 && (
                <div className="mt-3 space-y-2">
                  {recentSnapshotPoints.map((point) => {
                    const isActive = point.snapshot_version === (selectedHistoryPoint?.snapshot_version ?? activeSnapshotMeta?.snapshot_version ?? "");
                    return (
                      <div
                        key={`snapshot-list-${point.snapshot_version}`}
                        className={`flex flex-col gap-2 rounded-[var(--radius)] border p-3 text-sm sm:flex-row sm:items-center sm:justify-between ${
                          isActive ? "border-[var(--accent)]/50 bg-[var(--surface-muted)]" : "border-[var(--border)] bg-white"
                        }`}
                      >
                        <div className="space-y-1">
                          <p className="font-semibold text-[var(--text-primary)]">
                            {formatDateLabel(point.as_of_date)} · {point.snapshot_source}
                          </p>
                          <p className="text-xs text-[var(--text-muted)]">
                            Benchmark {point.benchmark_ticker}. Versions that day: {point.snapshot_versions_for_day}. Stocks summarized: {point.stock_count}.
                          </p>
                        </div>
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
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {portfolioComparisonMessage && (
              <p className="mt-3 text-sm text-[var(--text-muted)]">{portfolioComparisonMessage}</p>
            )}
            {selectedHistoryPoint && selectedSnapshotQuery.isLoading && (
              <p className="mt-3 text-sm text-[var(--text-muted)]">
                Loading selected snapshot for {formatDateLabel(selectedHistoryPoint.as_of_date)}...
              </p>
            )}
            {selectedHistoryPoint && selectedSnapshotQuery.isError && (
              <div className="mt-3">
                <StatusPanel
                  title="Selected Snapshot Unavailable"
                  message="Could not load the selected saved snapshot version. Clearing the history selection will return to the latest snapshot."
                  tone="warning"
                />
              </div>
            )}

            {portfolioComparisonQuery.isLoading && (
              <p className="mt-4 text-sm text-[var(--text-muted)]">Loading portfolio snapshot summary...</p>
            )}

            {portfolioComparisonQuery.isError && (
              <div className="mt-4">
                <StatusPanel
                  title="Portfolio Snapshot Summary Unavailable"
                  message="Could not load the latest portfolio comparison snapshot."
                  tone="warning"
                />
              </div>
            )}

            {activeComparisonData && portfolioSnapshotSummary && (
              <>
                {selectedHistoryPoint && (
                  <div className="mt-4 flex flex-col gap-2 rounded-[var(--radius)] border border-[var(--accent)]/40 bg-[var(--surface-muted)] p-3 text-sm text-[var(--text-muted)] lg:flex-row lg:items-center lg:justify-between">
                    <p>
                      Reviewing saved snapshot from <span className="font-semibold text-[var(--text-primary)]">{formatDateLabel(selectedHistoryPoint.as_of_date)}</span>.
                      Stock modal metrics and table values now follow that selected snapshot until you clear it. The saved benchmark and universe from that snapshot stay locked for review even if you change the current controls.
                    </p>
                    <button
                      type="button"
                      onClick={() => setSelectedHistoryPoint(null)}
                      className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      Clear History Selection
                    </button>
                  </div>
                )}
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
                  <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
                    <div className="text-[var(--text-muted)]">As Of</div>
                    <div className="mt-1 font-bold text-[var(--text-primary)]">
                      {formatDateLabel(activeComparisonData.snapshot.as_of_date)}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
                    <div className="text-[var(--text-muted)]">Source</div>
                    <div className="mt-1 font-bold capitalize text-[var(--text-primary)]">
                      {activeComparisonData.snapshot.mode}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
                    <div className="text-[var(--text-muted)]">Universe</div>
                    <div className="mt-1 font-bold text-[var(--text-primary)]">
                      {portfolioComparisonUniverseLabel(activeComparisonData.snapshot.comparison_universe)}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
                    <div className="text-[var(--text-muted)]">Benchmark</div>
                    <div className="mt-1 font-bold text-[var(--text-primary)]">
                      {activeComparisonData.snapshot.benchmark_ticker}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
                    <div className="text-[var(--text-muted)]">Positive Spread</div>
                    <div className="mt-1 font-bold text-[var(--text-primary)]">
                      {portfolioSnapshotSummary.positiveSpreadCount} / {portfolioSnapshotSummary.stockCount}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
                    <div className="text-[var(--text-muted)]">Positive ROIC - WACC</div>
                    <div className="mt-1 font-bold text-[var(--text-primary)]">
                      {portfolioSnapshotSummary.positiveEconomicSpreadCount} / {portfolioSnapshotSummary.stockCount}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
                    <div className="text-[var(--text-muted)]">Top Spread</div>
                    <div className={`mt-1 font-bold ${metricToneClass(portfolioSnapshotSummary.highestSpreadValue)}`}>
                      {portfolioSnapshotSummary.highestSpreadTicker} {portfolioSnapshotSummary.highestSpreadValue == null ? "" : `(${formatMetricPercent(portfolioSnapshotSummary.highestSpreadValue)})`}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-2 text-sm text-[var(--text-muted)] lg:flex-row lg:items-center lg:justify-between">
                  <p>
                    Market expected return: {activeComparisonData.market_expected_return.toFixed(2)}%. Primary stock return: {activeComparisonData.stock_expected_return_method.replaceAll("_", " ")}. Reference return: {activeComparisonData.comparison_reference_return_method.replaceAll("_", " ")}.
                  </p>
                  <p>
                    Generated: {formatSyncTimestamp(activeComparisonData.snapshot.generated_at)}. Versions for this KST day: {activeComparisonData.snapshot.snapshot_versions_for_day}. Holdings summarized: {portfolioSnapshotSummary.stockCount}.
                  </p>
                </div>
                <div className="mt-3 rounded-[var(--radius)] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  Portfolio-level averages for spread, `ROIC - WACC`, and DCF upside are intentionally demoted here. Per-stock values can be distorted by outliers, so the table view below is now the primary comparison surface.
                  {portfolioSnapshotSummary.flaggedMetricsCount > 0 && ` ${portfolioSnapshotSummary.flaggedMetricsCount} metric value(s) are currently flagged as outliers and render as N/A in the table.`}
                </div>
                <div className="mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--text-muted)]">
                  <p>
                    <span className="font-semibold text-[var(--text-primary)]">Benchmark context:</span> `S&P 500` is the default portfolio reference because it is the clearest broad-market baseline for cross-market comparison. Korea presets remain available when you want local-market benchmarking.
                  </p>
                </div>
                {activeComparisonData.snapshot.comparison_universe === "custom" && (
                  <p className="mt-2 text-sm text-[var(--text-muted)]">
                    Custom tickers: {activeComparisonData.snapshot.custom_tickers.join(", ") || "None"}.
                  </p>
                )}
                {activeComparisonData.snapshot.snapshot_is_stale && (
                  <p className="mt-2 text-sm text-amber-800">
                    Current view is using the latest available saved snapshot because the current daily snapshot was not available.
                  </p>
                )}
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => router.push("/corporate")}
                    className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    Open Full Comparison View
                  </button>
                  <button
                    type="button"
                    onClick={() => setSnapshotHistoryOpen(true)}
                    className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] opacity-60"
                  >
                    Open Snapshot History
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {/* Attribution loading state: skeleton KPI cards and chart panels while results calculate. */}
        {attributionQuery.isLoading && hasHoldings && (
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
        {attributionQuery.data && shouldShowAttribution && (
          <>
            <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4">
                <p className="text-xs text-[var(--text-muted)]">
                  <InfoTooltip
                    label="Portfolio Return"
                    description={`Definition: total weighted return earned by the selected holdings over the attribution period. Formula: Portfolio Return = sum(weight_i x holding return_i). Step 1: calculate each holding's period return from its start and end prices. Step 2: multiply each holding return by its portfolio weight. Step 3: sum the weighted holding returns. Current status: ${portfolioStatus("return", attributionQuery.data.totals.portfolio_return)}.`}
                  />
                </p>
                <p className="text-xl font-bold mt-1">
                  {(attributionQuery.data.totals.portfolio_return * 100).toFixed(1)}%
                </p>
              </div>
              <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4">
                <p className="text-xs text-[var(--text-muted)]">
                  <InfoTooltip
                    label="Benchmark Return"
                    description="Definition: return of the benchmark used as the comparison hurdle for the portfolio. Formula: Benchmark Return = sum(benchmark weight_i x benchmark/sector return_i), or direct benchmark index return when constituent weights are available. Step 1: identify the benchmark and period. Step 2: use direct benchmark returns or mapped proxy sector returns. Step 3: aggregate benchmark-weighted returns into one comparison return."
                  />
                </p>
                <p className="text-xl font-bold mt-1">
                  {(attributionQuery.data.totals.benchmark_return * 100).toFixed(1)}%
                </p>
              </div>
              <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4">
                <p className="text-xs text-[var(--text-muted)]">
                  <InfoTooltip
                    label="Active Return"
                    description={`Definition: excess return produced by the portfolio versus the benchmark. Formula: Active Return = Portfolio Return - Benchmark Return. Step 1: compute the portfolio weighted return. Step 2: compute the benchmark return over the same period and currency. Step 3: subtract benchmark return from portfolio return; positive means outperformance and negative means underperformance. Current status: ${portfolioStatus("active", attributionQuery.data.active_return)}.`}
                  />
                </p>
                <p className="text-xl font-bold mt-1">
                  {(attributionQuery.data.active_return * 100).toFixed(1)}%
                </p>
              </div>
              <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4">
                <p className="text-xs text-[var(--text-muted)]">
                  <InfoTooltip
                    label="Beta"
                    description={`Definition: sensitivity of portfolio returns to benchmark returns. Formula: Beta = covariance(portfolio returns, benchmark returns) / variance(benchmark returns). Step 1: align portfolio and benchmark return observations over the same dates. Step 2: measure how the portfolio co-moves with the benchmark. Step 3: divide that co-movement by benchmark variance. Around 1.0 is market-like; above 1.2 is higher benchmark sensitivity. Current status: ${portfolioStatus("beta", attributionQuery.data.risk_metrics.beta)}.`}
                  />
                </p>
                <p className="text-xl font-bold mt-1">
                  {attributionQuery.data.risk_metrics.beta.toFixed(1)}
                </p>
              </div>
            </section>

            <section className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-3xl">
                  <h2 className="text-sm font-bold text-[var(--text-primary)]">
                    <InfoTooltip
                      label="Benchmark Selection Criteria"
                      description="The current portfolio view selects ^GSPC as the broad-market benchmark because the watchlist is modeled as a diversified equity basket and the S&P 500 offers market-cap-weighted US large-cap breadth. Sector matching is handled through attribution sectors and an explicit proxy when true benchmark constituent weights are unavailable."
                    />
                  </h2>
                  <p className="mt-2 text-sm text-[var(--text-muted)]">
                    Benchmark: {attributionQuery.data.metadata.benchmark}. Return window: {holdingStartDate || "5-year lookback start"} to {attributionAsOfDate || "latest available market date"}. Methodology: this portfolio view uses saved watchlist allocations when any positive weights exist; otherwise it falls back to an equal-weight basket. If user-provided benchmark weights exist, the engine uses them directly; otherwise it uses the opted-in provider-derived sector proxy and labels the limitation in the data quality metadata.
                  </p>
                  <p className="mt-2 text-sm text-[var(--text-muted)]">
                    Calculation basis: Brinson-Fachler arithmetic attribution decomposes active return into allocation, selection, and interaction effects. Sector correlation is reviewed through the sector attribution mapping; this build does not run a live correlation optimizer for benchmark selection.
                  </p>
                </div>
                <div className="grid min-w-56 grid-cols-2 gap-2 text-xs">
                  <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3">
                    <div className="text-[var(--text-muted)]">Weight Source</div>
                    <div className="mt-1 font-bold text-[var(--text-primary)]">
                      {attributionQuery.data.metadata.benchmark_weights_source.replace("_", " ")}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3">
                    <div className="text-[var(--text-muted)]">Proxy Method</div>
                    <div className="mt-1 font-bold text-[var(--text-primary)]">
                      {benchmarkMethodLabel(attributionQuery.data.metadata.data_quality?.benchmark_proxy_method)}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <AllocationDonut data={allocationData} />
              <AttributionWaterfall data={waterfallData} sectorBreakdowns={attributionQuery.data.sector_breakdowns} />
            </section>
          </>
        )}

        {/* Portfolio and attribution request states shown before the holdings section. */}
        {!watchlistQuery.isLoading && watchlistQuery.isError && (
          <StatusPanel
            title="Portfolio Data Unavailable"
            message="Could not load watchlist from backend. Verify backend connectivity and retry."
            tone="warning"
          />
        )}

        {!watchlistQuery.isLoading && !watchlistQuery.isError && watchlist.length === 0 && (
          <StatusPanel
            title="No Holdings Yet"
            message="Add at least one asset to the tracking watchlist, then assign portfolio weights below when you want attribution insights."
          />
        )}

        {!attributionQuery.isLoading && !hasHoldings && !watchlistQuery.isError && (
          <StatusPanel
            title="Attribution Pending Portfolio"
            message="Attribution charts will appear once the watchlist has at least one holding."
          />
        )}

        {weightsOverflow && (
          <StatusPanel
            title="Allocation Weights Exceed 100%"
            message={`Saved watchlist allocations currently sum to ${(totalStoredWeight * 100).toFixed(1)}%. Reduce total assigned weight to 100% or below before attribution can run.`}
            tone="warning"
          />
        )}

        {!attributionQuery.isLoading && attributionQuery.isError && hasHoldings && (
          <StatusPanel
            title="Attribution Engine Unavailable"
            message="Attribution request failed. Check API health or input constraints and retry."
            tone="warning"
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
          <ViewToggle value={holdingsView} onChange={setHoldingsView} />
        </section>

        <section className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <form onSubmit={handleAddHolding} className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-5">
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--text-muted)]">
                Ticker
                <input
                  type="text"
                  value={newTicker}
                  onChange={(event) => setNewTicker(event.target.value)}
                  placeholder="AAPL"
                  className="rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--text-muted)]">
                Name
                <input
                  type="text"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="Apple"
                  className="rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--text-muted)]">
                Sector
                <input
                  type="text"
                  value={newSector}
                  onChange={(event) => setNewSector(event.target.value)}
                  placeholder="Technology"
                  className="rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </label>
              <div className="flex flex-col justify-end gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                <label className="flex items-start gap-2 text-xs font-semibold text-[var(--text-muted)]">
                  <input
                    type="checkbox"
                    checked={addToWatchlistOnly}
                    onChange={(event) => setAddToWatchlistOnly(event.target.checked)}
                    aria-label="Add to Watchlist only"
                    className="mt-0.5"
                  />
                  <span>
                    Add to Watchlist only
                    <span className="mt-1 block text-[11px] font-normal text-[var(--text-muted)]">
                      Default keeps this name tracked at 0.0% until you opt into the portfolio model.
                    </span>
                  </span>
                </label>
              </div>
              <label className={`flex flex-col gap-1 text-xs font-semibold text-[var(--text-muted)] ${addToWatchlistOnly ? "opacity-60" : ""}`}>
                Initial Allocation %
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={newWeightPercent}
                  onChange={(event) => setNewWeightPercent(event.target.value)}
                  placeholder={addToWatchlistOnly ? "0.0" : "25.0"}
                  disabled={addToWatchlistOnly}
                  aria-label="Initial allocation percent"
                  className="rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] disabled:cursor-not-allowed disabled:bg-[var(--surface-muted)]"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={addWatchlistMutation.isPending}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  {addWatchlistMutation.isPending ? "Saving..." : "Save Manual Ticker"}
                </button>
              </div>
            </form>
            <div className="flex flex-col gap-2 lg:min-w-72">
              <button
                type="button"
                onClick={() => {
                  setMutationMessage(null);
                  void syncWatchlistMutation.mutateAsync();
                }}
                disabled={syncWatchlistMutation.isPending}
                className="inline-flex items-center justify-center gap-2 self-start rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncWatchlistMutation.isPending ? "animate-spin" : ""}`} />
                {syncWatchlistMutation.isPending ? "Exporting..." : "Export Watchlist To JSON"}
              </button>
              <label className="flex items-start gap-2 rounded-[var(--radius)] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <input
                  type="checkbox"
                  checked={importJsonArmed}
                  onChange={(event) => setImportJsonArmed(event.target.checked)}
                  aria-label="Arm destructive JSON import"
                  className="mt-0.5"
                />
                <span>I understand Import JSON replaces the DB watchlist from file and can overwrite saved weights.</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  void handleImportJson();
                }}
                disabled={resyncWatchlistMutation.isPending || !importJsonArmed}
                className="inline-flex items-center justify-center gap-2 self-start rounded-[var(--radius)] border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${resyncWatchlistMutation.isPending ? "animate-spin" : ""}`} />
                {resyncWatchlistMutation.isPending ? "Importing..." : "Import JSON Into DB"}
              </button>
            </div>
          </div>
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            Manual add is now explicit. Saving a ticker creates or updates a tracked holding and preserves any existing saved weight when <span className="font-semibold text-[var(--text-primary)]">Add to Watchlist only</span> stays on. Turn it off only when you want to seed an initial portfolio allocation immediately.
          </p>
          {existingTicker && (
            <div className="mt-2 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
              Already in Watchlist
            </div>
          )}
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Export writes the current DB-backed watchlist, including weights, into `stock_targets.json`. Import is the explicit replace-from-file path and stays intentionally destructive.
          </p>
          <p className="mt-2 text-sm text-amber-800">
            Warning: use `Export Watchlist To JSON` for the safe DB-to-file path. `Import JSON Into DB` is only for explicit file-driven replacement.
          </p>
          <div className="mt-3 rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--text-muted)]">
            <div>Last sync/import source: {syncStatusQuery.data?.source || "None recorded"}</div>
            <div>Last sync/import time: {formatSyncTimestamp(syncStatusQuery.data?.last_updated_at ?? "")}</div>
            <div>JSON path: {syncStatusQuery.data?.json_path || "Loading..."}</div>
          </div>
          {mutationMessage && (
            <p className="mt-3 text-sm text-[var(--text-muted)]">{mutationMessage}</p>
          )}
        </section>

        {watchlist.length > 0 && (
          <section className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 shadow-sm">
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

        {watchlist.length > 0 && (
          <section ref={allocationSectionRef} className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 shadow-sm">
            <button
              type="button"
              onClick={() => setAllocationModelOpen((current) => !current)}
              className="flex w-full items-start justify-between gap-4 text-left"
              aria-expanded={allocationModelOpen}
            >
              <div>
                <h3 className="text-sm font-bold text-[var(--text-primary)]">
                  Portfolio Allocation (Cash & Weight Control, Testing Purpose)
                </h3>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  This is a secondary testing tool. Keep it collapsed when you only want to review price volatility, expected returns, and the latest snapshot.
                </p>
              </div>
              <span className="mt-0.5 inline-flex items-center rounded-[var(--radius)] border border-[var(--border)] px-2 py-1 text-xs font-semibold text-[var(--text-muted)]">
                {allocationModelOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </span>
            </button>
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
                <div className="text-[var(--text-muted)]">Invested</div>
                <div className="mt-1 font-bold text-[var(--text-primary)]">{formatWeightPercent(investedWeight)}</div>
              </div>
              <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
                <div className="text-[var(--text-muted)]">Implied Cash</div>
                <div className="mt-1 font-bold text-[var(--text-primary)]">{formatWeightPercent(impliedCashWeight)}</div>
              </div>
              <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
                <div className="text-[var(--text-muted)]">Cash Treatment</div>
                <div className="mt-1 font-bold text-[var(--text-primary)]">0.0% return</div>
              </div>
            </div>
            {allocationModelOpen && (
              <>
                <div className="mt-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <p className="text-sm text-[var(--text-muted)]">
                    {usingStoredWeights
                      ? "Positive saved weights are active for portfolio testing. If total assigned is below 100.0%, the remaining balance is sent as an explicit CASH row."
                      : "No positive saved weights yet, so the portfolio test falls back to equal stock weights and no explicit cash row is used."}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">
                      <input
                        type="checkbox"
                        checked={applyAllocationToSnapshot}
                        onChange={(event) => setApplyAllocationToSnapshot(event.target.checked)}
                        aria-label="Apply allocation changes to snapshot"
                      />
                      Apply To Snapshot
                    </label>
                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--text-muted)]">
                      Testing-purpose controls
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleNormalizeWeights()}
                      disabled={updateWeightMutation.isPending || !usingStoredWeights || totalStoredWeight <= 0}
                      className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50"
                    >
                      Normalize To 100%
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  When enabled, saving an allocation or normalizing weights will also persist today&apos;s comparison snapshot using the current benchmark and universe settings. Default is OFF to keep testing edits separate from snapshot history.
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--surface-muted)] text-left text-[var(--text-muted)]">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Ticker</th>
                        <th className="px-4 py-3 font-semibold">Name</th>
                        <th className="px-4 py-3 text-right font-semibold">Saved Weight</th>
                        <th className="px-4 py-3 text-right font-semibold">Allocation %</th>
                        <th className="px-4 py-3 text-right font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]/60">
                      {watchlist.map((stock) => (
                        <tr key={`weight-${stock.ticker}`}>
                          <td className="px-4 py-3 font-bold text-[var(--text-primary)]">{stock.ticker}</td>
                          <td className="px-4 py-3 text-[var(--text-muted)]">{stock.name || stock.ticker}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatWeightPercent(stock.weight)}</td>
                          <td className="px-4 py-3 text-right">
                            <input
                              type="number"
                              min="0"
                              step="0.1"
                              ref={(element) => {
                                weightInputRefs.current[stock.ticker] = element;
                              }}
                              value={weightDrafts[stock.ticker] ?? (stock.weight * 100).toFixed(1)}
                              onChange={(event) => setWeightDrafts((current) => ({ ...current, [stock.ticker]: event.target.value }))}
                              className="w-28 rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-right text-sm text-[var(--text-primary)]"
                            />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => void handleSaveWeight(stock)}
                              disabled={updateWeightMutation.isPending}
                              className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50"
                            >
                              {updateWeightMutation.isPending ? "Saving..." : "Save"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}

        {/* Holdings body: skeleton, card grid, table, or empty state depending on data and view mode. */}
        {watchlistQuery.isLoading ? (
          <WatchlistSkeletonGrid />
        ) : watchlist.length > 0 && holdingsView === "chart" ? (
          <section className="space-y-4">
            {watchlistSectorGroups.map((group) => (
              <div key={group.sector} className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 shadow-sm">
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
                        onClick={() => setSelectedStock(stock)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedStock(stock);
                          }
                        }}
                        key={stock.ticker}
                        className="group relative block bg-[var(--surface-panel)] rounded-[var(--radius)] border border-[var(--border)] p-4 text-left shadow-sm hover:shadow-md transition-all hover:border-[var(--accent)]"
                      >
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDeleteHolding(stock);
                          }}
                          disabled={deleteWatchlistMutation.isPending && deleteWatchlistMutation.variables === stock.ticker}
                          className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-[var(--radius)] border border-[var(--border)] bg-white px-2 py-1 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--delta-down)] disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {deleteWatchlistMutation.isPending && deleteWatchlistMutation.variables === stock.ticker ? "Removing" : "Remove"}
                        </button>
                        <div className="flex justify-between items-start mb-2">
                          <StockIdentity stock={stock} />
                          <div className="text-right">
                            <div className="font-semibold tabular-nums">
                              {stock.last_close.toLocaleString(undefined, {
                                minimumFractionDigits: 1,
                                maximumFractionDigits: 1,
                              })}
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
        ) : watchlist.length > 0 ? (
          <section className="space-y-4">
            {watchlistSectorGroups.map((group) => {
              const isCollapsed = collapsedSectors[group.sector] ?? false;
              return (
                <div key={group.sector} className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 shadow-sm">
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
                        onSelect={setSelectedStock}
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

        {/* Stock detail modal renders on demand when a holding is selected. */}
        {selectedStock && (
          <StockDetailModal
            stock={selectedStock}
            comparisonMetrics={comparisonMetricsByTicker[selectedStock.ticker] ?? EMPTY_COMPARISON_METRICS}
            snapshotMeta={activeSnapshotMeta}
            comparisonUniverse={portfolioComparisonUniverse}
            comparisonBenchmarkTicker={debouncedBenchmarkTicker}
            comparisonCustomTickersInput={debouncedCustomTickersInput}
            activeSnapshotVersion={activeSnapshotMeta?.snapshot_version ?? ""}
            onAddToPortfolio={handleFocusAllocationForStock}
            onRemoveFromWatchlist={(stock) => void handleDeleteHolding(stock)}
            onClose={() => setSelectedStock(null)}
          />
        )}
        {snapshotHistoryOpen && (
          <SnapshotHistoryModal
            history={portfolioComparisonHistoryQuery.data}
            loading={portfolioComparisonHistoryQuery.isLoading}
            error={portfolioComparisonHistoryQuery.isError}
            activeSnapshotVersion={activeSnapshotMeta?.snapshot_version ?? ""}
            onSelectSnapshot={(point) => {
              setSelectedHistoryPoint(point);
              setPortfolioComparisonMode("snapshot");
              setSnapshotHistoryOpen(false);
            }}
            onClose={() => setSnapshotHistoryOpen(false)}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}
