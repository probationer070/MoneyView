"use client";

import React, { useRef, useState, useMemo, useEffect } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { fetchApi } from "@/lib/api";
import { 
  transformToTVCandles, 
  transformToTVVolume, 
} from "@/lib/transformers";
import { OHLCVChartCard } from "@/components/charts/OHLCVChartCard";
import { type TVLineSeries } from "@/components/charts/TVChart";
import { TimelineList } from "@/components/data/TimelineList";
import { ModalShell } from "@/components/ui/ModalShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { MetricAuditPanel } from "@/components/ui/MetricAuditPanel";
import { MetricQualityBadge } from "@/components/ui/MetricQualityBadge";

import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { Sparkline } from "@/components/ui/Sparkline";
import { NewsFeedList } from "@/app/news/components/NewsFeedList";
import { formatAuditMetricValue, metricAuditReason } from "@/lib/metricAudit";
import type { CorporateMetricAudit } from "../../../../../packages/shared-types";

import { 
  type PortfolioStock, 
  type CorporateComparisonSnapshotMeta, 
  type PortfolioComparisonUniverse,
  type CorporateComparisonStockHistoryResponse,
  type StockDetail,
  type NewsArticle,
  formatDateLabel,
  portfolioComparisonUniverseLabel,
  formatMetricPercent,
  formatCurrencyCompact,
  summarizeSparklineTrend,
  StatusPanel,
  aggregateMonthlyBars,
  buildMovingAverageSeries,
  MOVING_AVERAGE_WINDOWS,
  MOVING_AVERAGE_COLORS
} from "../page";
import {
  buildPortfolioDisplayMetric,
  metricDisplayTitle,
  metricSubtitle,
  metricToneClass,
  type PortfolioTickerMetrics,
} from "../portfolioMetrics";

export interface StockDetailModalProps {
  stock: PortfolioStock;
  isInWatchlist: boolean;
  comparisonMetrics: PortfolioTickerMetrics;
  snapshotMeta: CorporateComparisonSnapshotMeta | null;
  comparisonUniverse: PortfolioComparisonUniverse;
  comparisonBenchmarkTicker: string;
  comparisonCustomTickersInput: string;
  activeSnapshotVersion: string;
  onAddToPortfolio: (stock: PortfolioStock) => void;
  onUpdateSector: (stock: PortfolioStock, nextSector: string) => Promise<void>;
  onRemoveFromWatchlist: (stock: PortfolioStock) => void;
  onClose: () => void;
}

type MovingAverageWindow = (typeof MOVING_AVERAGE_WINDOWS)[number];

export function StockDetailModal({
  stock,
  isInWatchlist,
  comparisonMetrics,
  snapshotMeta,
  comparisonUniverse,
  comparisonBenchmarkTicker,
  comparisonCustomTickersInput,
  activeSnapshotVersion,
  onAddToPortfolio,
  onUpdateSector,
  onRemoveFromWatchlist,
  onClose,
}: StockDetailModalProps) {
  const previousTickerRef = useRef(stock.ticker);
  const newsPageSize = 5;
  const [timeframe, setTimeframe] = useState<"daily" | "monthly">("daily");
  const [sectorDraft, setSectorDraft] = useState(stock.sector);
  const [savingSector, setSavingSector] = useState(false);
  const [sectorMessage, setSectorMessage] = useState<string | null>(null);
  
  const effectiveComparisonUniverse = snapshotMeta?.comparison_universe ?? comparisonUniverse;
  const effectiveComparisonBenchmarkTicker = snapshotMeta?.benchmark_ticker ?? comparisonBenchmarkTicker;
  const effectiveComparisonCustomTickersInput = snapshotMeta?.custom_tickers.join(", ") ?? comparisonCustomTickersInput;

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
    enabled: true,
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
  const metricAuditQuery = useQuery<CorporateMetricAudit>({
    queryKey: ["portfolio-stock-metric-audit", stock.ticker],
    queryFn: ({ signal }) =>
      fetchApi<CorporateMetricAudit>(`/corporate/metrics/${stock.ticker}/audit`, { signal }),
    staleTime: 5 * 60_000,
  });

  const prices = useMemo(() => detailQuery.data?.prices ?? [], [detailQuery.data?.prices]);
  const chartPrices = useMemo(
    () => (timeframe === "monthly" ? aggregateMonthlyBars(prices) : prices),
    [prices, timeframe],
  );
  const candles = useMemo(() => transformToTVCandles(chartPrices), [chartPrices]);
  const volume = useMemo(() => transformToTVVolume(chartPrices), [chartPrices]);
  const movingAverageSeries = useMemo<TVLineSeries[]>(
    () =>
      MOVING_AVERAGE_WINDOWS.map((windowSize: MovingAverageWindow) => ({
        title: `${windowSize}${timeframe === "monthly" ? "M" : "D"} MA`,
        color: MOVING_AVERAGE_COLORS[windowSize],
        data: buildMovingAverageSeries(chartPrices, windowSize),
      })),
    [chartPrices, timeframe],
  );
  const news = useMemo(
    () => newsQuery.data?.pages.flat() ?? detailQuery.data?.news ?? [],
    [detailQuery.data?.news, newsQuery.data?.pages],
  );
  const currentPrice = prices.at(-1)?.close ?? stock.last_close;
  const previousPrice = prices.length > 1 ? prices[prices.length - 2].close : currentPrice;
  const priceChangePct = previousPrice ? ((currentPrice - previousPrice) / previousPrice) * 100 : 0;
  const priceTone = priceChangePct >= 0 ? "text-[var(--delta-up)]" : "text-[var(--delta-down)]";
  const sparklineTrendPct = summarizeSparklineTrend(stock.sparkline);
  
  const snapshotContextLabel = snapshotMeta?.mode === "snapshot"
    ? `Saved snapshot metrics from ${formatDateLabel(snapshotMeta.as_of_date)}`
    : "Live comparison metrics";
    
  const snapshotTrendPoints = useMemo(
    () => stockSnapshotHistoryQuery.data?.points ?? [],
    [stockSnapshotHistoryQuery.data?.points],
  );
  const flaggedComparisonMetricCount = [
    comparisonMetrics.roicMinusWacc,
    comparisonMetrics.dcfUpside,
    comparisonMetrics.expectedVsMarket,
  ].filter((metric) => metric.quality === "suspicious" || metric.quality === "invalid").length;
  
  const earliestSnapshotTrendPoint = snapshotTrendPoints.at(-1) ?? null;
  const latestSnapshotTrendPoint = snapshotTrendPoints[0] ?? null;
  const expectedSpreadTrendDelta = latestSnapshotTrendPoint && earliestSnapshotTrendPoint
    ? latestSnapshotTrendPoint.expected_return_spread - earliestSnapshotTrendPoint.expected_return_spread
    : null;
  const stockNewsItems = useMemo(
    () => news.map((item, index) => ({ ...item, id: item.id ?? index + 1 })),
    [news],
  );
  const snapshotTimelineMetrics = useMemo(() => (
    snapshotTrendPoints.reduce<Record<string, {
      roicMinusWacc: ReturnType<typeof buildPortfolioDisplayMetric>;
      dcfUpside: ReturnType<typeof buildPortfolioDisplayMetric>;
      expectedVsMarket: ReturnType<typeof buildPortfolioDisplayMetric>;
    }>>((acc, point) => {
      acc[point.snapshot_version] = {
        roicMinusWacc: buildPortfolioDisplayMetric(point.roic_minus_wacc, {
          missingReason: "Saved snapshot is missing ROIC - WACC for this ticker.",
          suspiciousReason: "Saved snapshot ROIC - WACC falls outside the sanity range.",
        }),
        dcfUpside: buildPortfolioDisplayMetric(point.dcf_implied_return, {
          missingReason: "Saved snapshot is missing DCF upside for this ticker.",
          suspiciousReason: "Saved snapshot DCF upside falls outside the sanity range.",
        }),
        expectedVsMarket: buildPortfolioDisplayMetric(point.expected_return_spread, {
          missingReason: "Saved snapshot is missing Expected vs Market for this ticker.",
          suspiciousReason: "Saved snapshot Expected vs Market falls outside the sanity range.",
        }),
      };
      return acc;
    }, {})
  ), [snapshotTrendPoints]);
  const detailErrorMessage = detailQuery.error instanceof Error
    ? detailQuery.error.message
    : "Could not load OHLC history and supporting stock detail data for this ticker.";
  const newsErrorMessage = newsQuery.error instanceof Error
    ? newsQuery.error.message
    : `Could not load filtered headlines for ${stock.ticker}.`;
  const timelineGroups = useMemo(() => (
    snapshotTrendPoints.length === 0
      ? []
      : [
          {
            id: `${stock.ticker}-history`,
            label: "Saved Snapshot History",
            items: snapshotTrendPoints.map((point) => {
              const metrics = snapshotTimelineMetrics[point.snapshot_version];
              return {
              id: point.snapshot_version,
              title: formatDateLabel(point.as_of_date),
              subtitle: `${point.snapshot_source} snapshot against ${point.benchmark_ticker}`,
              active: point.snapshot_version === activeSnapshotVersion,
              meta: (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span
                    className="overflow-inline-ellipsis max-w-full rounded-[var(--radius-sm)] bg-[var(--surface-muted)] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)]"
                    title={point.snapshot_version}
                  >
                    Version {point.snapshot_version}
                  </span>
                  <span aria-hidden="true">•</span>
                  <span>Price {formatCurrencyCompact(point.current_price)}</span>
                </div>
              ),
              content: (
                <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                  <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                    <div className="text-[var(--text-muted)]">ROIC - WACC</div>
                    <div className={`mt-1 font-bold tabular-nums ${metricToneClass(metrics.roicMinusWacc)}`} title={metricDisplayTitle(metrics.roicMinusWacc)}>{metrics.roicMinusWacc.displayValue}</div>
                    {metricSubtitle(metrics.roicMinusWacc) ? <div className="mt-1 text-[11px] leading-tight text-[var(--text-muted)]">{metricSubtitle(metrics.roicMinusWacc)}</div> : null}
                  </div>
                  <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                    <div className="text-[var(--text-muted)]">DCF Upside</div>
                    <div className={`mt-1 font-bold tabular-nums ${metricToneClass(metrics.dcfUpside)}`} title={metricDisplayTitle(metrics.dcfUpside)}>{metrics.dcfUpside.displayValue}</div>
                    {metricSubtitle(metrics.dcfUpside) ? <div className="mt-1 text-[11px] leading-tight text-[var(--text-muted)]">{metricSubtitle(metrics.dcfUpside)}</div> : null}
                  </div>
                  <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                    <div className="text-[var(--text-muted)]">Expected vs Market</div>
                    <div className={`mt-1 font-bold tabular-nums ${metricToneClass(metrics.expectedVsMarket)}`} title={metricDisplayTitle(metrics.expectedVsMarket)}>{metrics.expectedVsMarket.displayValue}</div>
                    {metricSubtitle(metrics.expectedVsMarket) ? <div className="mt-1 text-[11px] leading-tight text-[var(--text-muted)]">{metricSubtitle(metrics.expectedVsMarket)}</div> : null}
                  </div>
                  <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                    <div className="text-[var(--text-muted)]">Market Return</div>
                    <div className="mt-1 font-bold tabular-nums text-[var(--text-primary)]">{formatMetricPercent(point.market_expected_return)}</div>
                  </div>
                </div>
              ),
            };
            }),
          },
        ]
  ), [activeSnapshotVersion, snapshotTimelineMetrics, snapshotTrendPoints, stock.ticker]);

  useEffect(() => {
    const tickerChanged = previousTickerRef.current !== stock.ticker;
    previousTickerRef.current = stock.ticker;
    setSectorDraft(stock.sector);
    if (tickerChanged) {
      setSectorMessage(null);
    }
  }, [stock.sector, stock.ticker]);

  const handleSaveSector = async () => {
    const normalizedSector = sectorDraft.trim();
    if (normalizedSector === stock.sector.trim()) {
      setSectorMessage("Sector is already up to date.");
      return;
    }
    setSavingSector(true);
    setSectorMessage(null);
    try {
      await onUpdateSector(stock, normalizedSector);
      setSectorMessage(`Saved sector for ${stock.ticker}.`);
    } catch (error) {
      setSectorMessage(error instanceof Error ? error.message : "Failed to save sector.");
    } finally {
      setSavingSector(false);
    }
  };

  const headerRight = (
    <>
      <p className={`text-2xl font-black tabular-nums ${priceTone}`}>
        ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
      </p>
      <p className={`text-sm font-bold ${priceTone}`}>
        {priceChangePct >= 0 ? "+" : ""}{priceChangePct.toFixed(1)}%
      </p>
    </>
  );

  return (
    <ModalShell
      open={true}
      onClose={onClose}
      title={stock.name || stock.ticker}
      subtitle={stock.ticker}
      size="full"
      headerRightContent={headerRight}
    >
      <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Quick portfolio review</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Stay in the portfolio workflow here, or open the canonical detail route for full standalone ticker analysis.
          </p>
        </div>
        <Link
          href={`/detail/${encodeURIComponent(stock.ticker)}`}
          className="inline-flex min-h-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)] px-[var(--space-4)] text-[length:var(--type-label)] font-medium text-[var(--text-primary)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-info)] focus-visible:ring-offset-1"
        >
          View Full Detail
        </Link>
      </section>

      <div className="flex flex-col mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--text-muted)]">
            Sector
          </span>
          <input
            type="text"
            value={sectorDraft}
            onChange={(event) => setSectorDraft(event.target.value)}
            aria-label="Stock sector"
            className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
          />
          <button
            type="button"
            onClick={() => void handleSaveSector()}
            disabled={savingSector}
            className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            {savingSector ? "Saving sector..." : "Save Sector"}
          </button>
        </div>
        {sectorMessage && <p className="mt-2 text-xs text-[var(--text-muted)]">{sectorMessage}</p>}
      </div>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 mb-4">
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Price</div>
          <div className="mt-2 text-2xl font-black tabular-nums text-[var(--text-primary)]">
            ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
          </div>
        </div>
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Day Delta</div>
          <div className={`mt-2 text-2xl font-black tabular-nums ${priceTone}`}>
            {priceChangePct >= 0 ? "+" : ""}{priceChangePct.toFixed(1)}%
          </div>
        </div>
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Sector</div>
          <div className="mt-2 text-lg font-black text-[var(--text-primary)]">{stock.sector || "Unassigned"}</div>
        </div>
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Weight</div>
          <div className="mt-2 text-2xl font-black tabular-nums text-[var(--text-primary)]">{(stock.weight * 100).toFixed(1)}%</div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(22rem,1fr)]">
        <section className="lg:col-span-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
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
              <button
                type="button"
                onClick={() => onAddToPortfolio(stock)}
                className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                {isInWatchlist
                  ? stock.weight > 0
                    ? "Review Portfolio Weight"
                    : "Add To Portfolio"
                  : "Add To Portfolio"}
              </button>
              {isInWatchlist && (
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
              )}
            </div>
          </div>
          <OHLCVChartCard
            title="OHLC Candlestick + Volume"
            description="Candles encode open, high, low, and close for each selected period. Volume bars show traded activity. Moving averages use 5, 20, 60, and 120 period closes, recalculated from daily or monthly bars depending on the selected timeframe."
            data={candles}
            volumeData={volume}
            lineSeriesData={movingAverageSeries}
            height={520}
            tickerName={stock.ticker}
            colorAccent="var(--delta-up)"
            upColor="var(--delta-up)"
            downColor="var(--delta-down)"
            loading={detailQuery.isLoading}
            timeframe={timeframe}
            onTimeframeChange={(value) => setTimeframe(value as "daily" | "monthly")}
            timeframeOptions={[
              { value: "daily", label: "Daily" },
              { value: "monthly", label: "Monthly" },
            ]}
            legend={movingAverageSeries.map((series) => (
              <span
                key={series.title}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-2 py-1"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.color }} />
                {series.title}
              </span>
            ))}
            emptyDescription="No OHLC history is available for this ticker yet."
          />
          {detailQuery.isError ? (
            <ErrorState
              title="Stock Detail Unavailable"
              message={detailErrorMessage}
            />
          ) : !detailQuery.isLoading && candles.length > 0 ? (
            <>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    <span>ROIC - WACC</span>
                    {metricAuditQuery.data ? <MetricQualityBadge quality={metricAuditQuery.data.spread.quality} /> : null}
                  </div>
                  <div className={`mt-2 text-2xl font-black tabular-nums ${metricToneClass(comparisonMetrics.roicMinusWacc)}`} title={metricDisplayTitle(comparisonMetrics.roicMinusWacc)}>
                    {metricAuditQuery.data ? formatAuditMetricValue(metricAuditQuery.data.spread) : comparisonMetrics.roicMinusWacc.displayValue}
                  </div>
                  <p className="mt-2 text-xs text-[var(--text-muted)]">
                    {metricAuditQuery.data ? metricAuditReason(metricAuditQuery.data.spread) : metricSubtitle(comparisonMetrics.roicMinusWacc) ?? "Positive values imply returns on invested capital are exceeding the current capital cost estimate."}
                  </p>
                </div>
                <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    <span>DCF Upside</span>
                    <MetricQualityBadge quality={comparisonMetrics.dcfUpside.quality} />
                  </div>
                  <div className={`mt-2 text-2xl font-black tabular-nums ${metricToneClass(comparisonMetrics.dcfUpside)}`} title={metricDisplayTitle(comparisonMetrics.dcfUpside)}>
                    {comparisonMetrics.dcfUpside.displayValue}
                  </div>
                  <p className="mt-2 text-xs text-[var(--text-muted)]">
                    {metricSubtitle(comparisonMetrics.dcfUpside) ?? "Snapshot-side upside or downside versus current price."}
                  </p>
                </div>
                <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    <span>Expected vs Market</span>
                    <MetricQualityBadge quality={comparisonMetrics.expectedVsMarket.quality} />
                  </div>
                  <div className={`mt-2 text-2xl font-black tabular-nums ${metricToneClass(comparisonMetrics.expectedVsMarket)}`} title={metricDisplayTitle(comparisonMetrics.expectedVsMarket)}>
                    {comparisonMetrics.expectedVsMarket.displayValue}
                  </div>
                  <p className="mt-2 text-xs text-[var(--text-muted)]">
                    {metricSubtitle(comparisonMetrics.expectedVsMarket) ?? "Spread between the stock return expectation and the market reference return used in the saved comparison snapshot."}
                  </p>
                </div>
                <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    <span>Volatility</span>
                    <MetricQualityBadge quality={comparisonMetrics.volatility.quality} />
                  </div>
                  <div className={`mt-2 text-2xl font-black tabular-nums ${comparisonMetrics.volatility.quality === "missing" || comparisonMetrics.volatility.quality === "invalid" || comparisonMetrics.volatility.quality === "suspicious" ? "text-amber-700" : "text-[var(--text-primary)]"}`} title={metricDisplayTitle(comparisonMetrics.volatility)}>
                    {comparisonMetrics.volatility.displayValue}
                  </div>
                  <p className="mt-2 text-xs text-[var(--text-muted)]">
                    {metricSubtitle(comparisonMetrics.volatility) ?? "Estimated from recent local price history for quick portfolio comparison."}
                  </p>
                </div>
              </div>
              <div className="mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-panel)] p-4">
                <div className="flex flex-col gap-1">
                  <h4 className="text-sm font-bold text-[var(--text-primary)]">Snapshot Context</h4>
                  <p className="text-sm text-[var(--text-muted)]">
                    {snapshotContextLabel}. This is the review frame for the stock-level comparison metrics shown in this modal.
                  </p>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3 text-xs">
                    <div className="text-[var(--text-muted)]">As Of</div>
                    <div className="mt-1 font-bold text-[var(--text-primary)]">
                      {snapshotMeta ? formatDateLabel(snapshotMeta.as_of_date) : "Live"}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3 text-xs">
                    <div className="text-[var(--text-muted)]">Source</div>
                    <div className="mt-1 overflow-inline-ellipsis font-bold capitalize text-[var(--text-primary)]" title={snapshotMeta?.snapshot_source ?? snapshotMeta?.mode ?? "live"}>
                      {snapshotMeta?.snapshot_source ?? snapshotMeta?.mode ?? "live"}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3 text-xs">
                    <div className="text-[var(--text-muted)]">Universe</div>
                    <div className="mt-1 overflow-inline-ellipsis font-bold text-[var(--text-primary)]" title={portfolioComparisonUniverseLabel(effectiveComparisonUniverse)}>
                      {portfolioComparisonUniverseLabel(effectiveComparisonUniverse)}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3 text-xs">
                    <div className="text-[var(--text-muted)]">Benchmark</div>
                    <div className="mt-1 overflow-inline-ellipsis font-bold text-[var(--text-primary)]" title={effectiveComparisonBenchmarkTicker}>{effectiveComparisonBenchmarkTicker}</div>
                  </div>
                  <div className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3 text-xs">
                    <div className="text-[var(--text-muted)]">Version</div>
                    <div className="mt-1 overflow-mono-block text-[var(--text-primary)]" title={activeSnapshotVersion || "Live"}>{activeSnapshotVersion || "Live"}</div>
                  </div>
                </div>
                {sparklineTrendPct != null && (
                  <p className="mt-3 text-sm text-[var(--text-muted)]">
                    Recent price trend: {sparklineTrendPct >= 0 ? "+" : ""}{sparklineTrendPct.toFixed(2)}%.
                  </p>
                )}
              </div>
              {flaggedComparisonMetricCount > 0 && (
                <div className="mt-3 rounded-[var(--radius)] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  {flaggedComparisonMetricCount} stock metric value{flaggedComparisonMetricCount === 1 ? "" : "s"} for {stock.ticker} {flaggedComparisonMetricCount === 1 ? "is" : "are"} currently flagged as outlier data and rendered as <span className="font-semibold">N/A</span>. Treat the price chart and saved snapshot history as the primary review context until fresher fundamentals are available.
                </div>
              )}
              <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                {metricAuditQuery.isLoading ? (
                  <div className="xl:col-span-2">
                    <EmptyState title="Loading ROIC/WACC audit..." />
                  </div>
                ) : metricAuditQuery.isError ? (
                  <div className="xl:col-span-2">
                    <ErrorState title="Metric Audit Unavailable" message={`Could not load ROIC/WACC audit inputs for ${stock.ticker}.`} />
                  </div>
                ) : (
                  <>
                    <MetricAuditPanel audit={metricAuditQuery.data ?? null} metric="roic" title="ROIC Audit" />
                    <MetricAuditPanel audit={metricAuditQuery.data ?? null} metric="wacc" title="WACC Audit" />
                  </>
                )}
              </div>
              <div className="mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                <div className="flex flex-col gap-1">
                  <h4 className="text-sm font-bold text-[var(--text-primary)]">Stock History Timeline</h4>
                  <p className="text-xs text-[var(--text-muted)]">
                    Review how saved comparison metrics changed across persisted snapshots for {stock.ticker}.
                  </p>
                  {snapshotMeta?.mode === "snapshot" && (
                    <p className="text-xs text-[var(--text-muted)]">
                      Review context: {formatDateLabel(snapshotMeta.as_of_date)} snapshot, {portfolioComparisonUniverseLabel(effectiveComparisonUniverse)}, benchmark {effectiveComparisonBenchmarkTicker}.
                    </p>
                  )}
                </div>
                {stockSnapshotHistoryQuery.isLoading ? (
                  <div className="mt-3">
                    <EmptyState title="Loading stock history timeline..." />
                  </div>
                ) : stockSnapshotHistoryQuery.isError ? (
                  <div className="mt-3">
                    <ErrorState title="Stock History Unavailable" message="Could not load saved snapshot trend data for this stock." />
                  </div>
                ) : timelineGroups.length === 0 ? (
                  <div className="mt-3">
                    <EmptyState title="No saved stock history yet" description="Saved comparison history will appear here once snapshot versions exist for this ticker." />
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                        <div className="text-[length:var(--type-caption)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Saved Snapshots</div>
                        <div className="mt-1 text-lg font-black text-[var(--text-primary)]">{snapshotTrendPoints.length}</div>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">Persisted comparison rows currently available for {stock.ticker}.</p>
                      </div>
                      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                        <div className="text-[length:var(--type-caption)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Expected Spread Trend</div>
                        <div className={`mt-1 text-lg font-black ${expectedSpreadTrendDelta == null ? "text-[var(--text-muted)]" : expectedSpreadTrendDelta > 0 ? "text-[var(--delta-up)]" : "text-[var(--delta-down)]"}`}>{formatMetricPercent(expectedSpreadTrendDelta)}</div>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">Latest versus oldest saved expected-return spread in this history.</p>
                      </div>
                      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                        <div className="text-[length:var(--type-caption)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Recent Price Sparkline</div>
                        <div className="mt-2 h-10">
                          <Sparkline
                            data={stock.sparkline}
                            height={40}
                            color={priceChangePct >= 0 ? "var(--delta-up)" : "var(--delta-down)"}
                          />
                        </div>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">Recent price path alongside the saved comparison timeline.</p>
                      </div>
                    </div>
                    <TimelineList groups={timelineGroups} />
                  </div>
                )}
              </div>
            </>
          ) : !detailQuery.isLoading ? (
            <StatusPanel title="No Price Data" message="No OHLC history is available for this ticker yet." tone="warning" />
          ) : null}
        </section>

        <section className="flex min-h-[24rem] flex-col rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
          <h3 className="text-sm font-bold text-[var(--text-primary)]">
            <InfoTooltip
              label="Ticker News Feed (filtered)"
              description="Latest stock-specific headlines crawled from Google News RSS and stored locally by ticker. This section stays filtered to the selected holding."
            />
          </h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Filtered news for {stock.ticker}, ordered by date with today highlights preserved.</p>
          <div className="mt-4 min-h-0 flex-1">
            {newsQuery.isLoading ? (
              <EmptyState title="Loading filtered news..." />
            ) : newsQuery.isError && stockNewsItems.length === 0 ? (
              <ErrorState title="Filtered News Unavailable" message={newsErrorMessage} />
            ) : stockNewsItems.length === 0 ? (
              <EmptyState title="No stock-specific news found" description={`No filtered headlines are available for ${stock.ticker} yet.`} />
            ) : (
              <NewsFeedList
                items={stockNewsItems}
                hasNextPage={newsQuery.hasNextPage}
                isFetchingNextPage={newsQuery.isFetchingNextPage}
                onFetchNextPage={() => {
                  void newsQuery.fetchNextPage();
                }}
              />
            )}
          </div>
        </section>
      </div>
    </ModalShell>
  );
}
