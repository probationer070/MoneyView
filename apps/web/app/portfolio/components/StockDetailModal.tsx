"use client";

import { formatNumber } from "@/lib/format";
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
import { impliedReturnRefusalText } from "@/lib/impliedReturn";
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
    queryFn: () => fetchApi<StockDetail>(`/portfolio/stock/${stock.ticker}?period=5y`, {
      monitor: {
        operation: "frontend.query.portfolio_stock_detail",
        component: "portfolio_stock_detail_modal",
        ticker: stock.ticker,
      },
    }),
  });

  const newsQuery = useInfiniteQuery<NewsArticle[]>({
    queryKey: ["stock-news", stock.ticker],
    queryFn: async ({ pageParam = 0 }) => {
      const offset = Number(pageParam);
      const existing = await fetchApi<NewsArticle[]>(
        `/news/feed?ticker=${stock.ticker}&limit=${newsPageSize}&offset=${offset}`,
        {
          monitor: {
            operation: "frontend.query.portfolio_stock_news_feed",
            component: "portfolio_stock_detail_modal",
            ticker: stock.ticker,
          },
        },
      );
      if (existing.length >= newsPageSize) return existing;

      await fetchApi<NewsArticle[]>(
        `/news/crawl/stock?ticker=${stock.ticker}&company_name=${encodeURIComponent(stock.name || stock.ticker)}&limit=${newsPageSize}&offset=${offset}`,
        {
          method: "POST",
          monitor: {
            operation: "frontend.query.portfolio_stock_news_crawl",
            component: "portfolio_stock_detail_modal",
            ticker: stock.ticker,
          },
        },
      );
      const refreshed = await fetchApi<NewsArticle[]>(
        `/news/feed?ticker=${stock.ticker}&limit=${newsPageSize}&offset=${offset}`,
        {
          monitor: {
            operation: "frontend.query.portfolio_stock_news_refresh",
            component: "portfolio_stock_detail_modal",
            ticker: stock.ticker,
          },
        },
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
        monitor: {
          operation: "frontend.query.portfolio_stock_snapshot_history",
          component: "portfolio_stock_detail_modal",
          ticker: stock.ticker,
        },
      }),
    staleTime: 60_000,
  });
  const metricAuditQuery = useQuery<CorporateMetricAudit>({
    queryKey: ["portfolio-stock-metric-audit", stock.ticker],
    queryFn: ({ signal }) =>
      fetchApi<CorporateMetricAudit>(`/corporate/metrics/${stock.ticker}/audit`, {
        signal,
        monitor: {
          operation: "frontend.query.portfolio_stock_metric_audit",
          component: "portfolio_stock_detail_modal",
          ticker: stock.ticker,
        },
      }),
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
  // `last_close` is null when no bar carries a usable close, so this can be null even
  // though the price series usually supplies it. Guarded once here rather than at each of
  // the three render sites below.
  const currentPrice = prices.at(-1)?.close ?? stock.last_close;
  const previousPrice = prices.length > 1 ? prices[prices.length - 2].close : currentPrice;
  const priceChangePct =
    currentPrice !== null && previousPrice ? ((currentPrice - previousPrice) / previousPrice) * 100 : 0;
  const currentPriceLabel =
    currentPrice === null
      ? "—"
      : `$${formatNumber(currentPrice, "price", { digits: 1 })}`;
  const priceTone = priceChangePct >= 0 ? "text-[var(--up)]" : "text-[var(--down)]";
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
    comparisonMetrics.impliedVsWacc,
  ].filter((metric) => metric.quality === "suspicious" || metric.quality === "invalid").length;
  
  // Between the latest and oldest points that RECORDED an implied return: a pre-v3 or refused
  // point has none, and subtracting across it would compare two different quantities. One
  // pre-v3 point used to blank the delta even when several recorded points existed.
  const recordedSpreadPoints = snapshotTrendPoints.filter((point) => point.implied_return_spread != null);
  const expectedSpreadTrendDelta = recordedSpreadPoints.length >= 2
    ? (recordedSpreadPoints[0].implied_return_spread as number) - (recordedSpreadPoints[recordedSpreadPoints.length - 1].implied_return_spread as number)
    : null;
  const stockNewsItems = useMemo(
    () => news.map((item, index) => ({ ...item, id: item.id ?? index + 1 })),
    [news],
  );
  const snapshotTimelineMetrics = useMemo(() => (
    snapshotTrendPoints.reduce<Record<string, {
      roicMinusWacc: ReturnType<typeof buildPortfolioDisplayMetric>;
      dcfUpside: ReturnType<typeof buildPortfolioDisplayMetric>;
      impliedVsWacc: ReturnType<typeof buildPortfolioDisplayMetric>;
    }>>((acc, point) => {
      acc[point.snapshot_version] = {
        roicMinusWacc: buildPortfolioDisplayMetric(point.roic_minus_wacc, {
          missingReason: "Saved snapshot is missing ROIC - WACC for this ticker.",
          suspiciousReason: "Saved snapshot ROIC - WACC falls outside the sanity range.",
        }),
        dcfUpside: buildPortfolioDisplayMetric(point.dcf_implied_return, {
          missingReason: point.dcf_refusal
            ? impliedReturnRefusalText(point.dcf_refusal)
            : "Saved snapshot is missing DCF value vs price for this ticker.",
          suspiciousReason: "Saved snapshot DCF value vs price falls outside the sanity range.",
        }),
        impliedVsWacc: buildPortfolioDisplayMetric(point.implied_return_spread, {
          // A code means refused in a v3 snapshot; no code means the snapshot predates v3.
          missingReason: impliedReturnRefusalText(point.implied_return_refusal),
          suspiciousReason: "Saved snapshot implied return vs WACC falls outside the sanity range.",
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
                    className="overflow-inline-ellipsis max-w-full rounded-[var(--radius-2)] bg-[var(--surface)] px-2 py-1 type-caption text-[var(--ink)]"
                    title={point.snapshot_version}
                  >
                    Version {point.snapshot_version}
                  </span>
                  <span aria-hidden="true">•</span>
                  <span>Price {formatCurrencyCompact(point.current_price)}</span>
                </div>
              ),
              content: (
                <div className="grid grid-cols-2 gap-3 type-small md:grid-cols-4">
                  <div className="border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
                    <div className="text-[var(--ink-muted)]">ROIC - WACC</div>
                    <div className={`type-figure-md mt-1 ${metricToneClass(metrics.roicMinusWacc)}`} title={metricDisplayTitle(metrics.roicMinusWacc)}>{metrics.roicMinusWacc.displayValue}</div>
                    {metricSubtitle(metrics.roicMinusWacc) ? <div className="mt-1 type-caption text-[var(--ink-muted)]">{metricSubtitle(metrics.roicMinusWacc)}</div> : null}
                  </div>
                  <div className="border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
                    <div className="text-[var(--ink-muted)]">DCF value vs price (one-off gap)</div>
                    <div className={`type-figure-md mt-1 ${metricToneClass(metrics.dcfUpside)}`} title={metricDisplayTitle(metrics.dcfUpside)}>{metrics.dcfUpside.displayValue}</div>
                    {metricSubtitle(metrics.dcfUpside) ? <div className="mt-1 type-caption text-[var(--ink-muted)]">{metricSubtitle(metrics.dcfUpside)}</div> : null}
                  </div>
                  <div className="border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
                    <div className="text-[var(--ink-muted)]">Implied return vs WACC (pts per year)</div>
                    <div className={`type-figure-md mt-1 ${metricToneClass(metrics.impliedVsWacc)}`} title={metricDisplayTitle(metrics.impliedVsWacc)}>{metrics.impliedVsWacc.displayValue}</div>
                    {metricSubtitle(metrics.impliedVsWacc) ? <div className="mt-1 type-caption text-[var(--ink-muted)]">{metricSubtitle(metrics.impliedVsWacc)}</div> : null}
                  </div>
                  <div className="border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
                    <div className="text-[var(--ink-muted)]">Market Return</div>
                    <div className="type-figure-md mt-1 text-[var(--ink)]">{formatMetricPercent(point.market_expected_return)}</div>
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
      <p className={`type-figure-md tabular-nums ${priceTone}`}>
        {currentPriceLabel}
      </p>
      <p className={`type-mono ${priceTone}`}>
        {priceChangePct >= 0 ? "+" : ""}{formatNumber(priceChangePct / 100, "percent", { digits: 1 })}
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
      <section className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-[var(--line)] bg-[var(--surface-raised)] p-4">
        <div>
          <h3 className="type-panel-title text-[var(--ink)]">Quick portfolio review</h3>
          <p className="mt-1 type-body text-[var(--ink-muted)]">
            Stay in the portfolio workflow here, or open the canonical detail route for full standalone ticker analysis.
          </p>
        </div>
        <Link
          href={`/detail/${encodeURIComponent(stock.ticker)}`}
          className="inline-flex min-h-9 items-center justify-center border border-[var(--line)] px-[var(--space-4)] type-small text-[var(--ink)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--surface)]"
        >
          View Full Detail
        </Link>
      </section>

      <div className="flex flex-col mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-[var(--radius-2)] border border-[var(--line)] bg-[var(--surface)] px-3 py-1 type-small text-[var(--ink-muted)]">
            Sector
          </span>
          <input
            type="text"
            value={sectorDraft}
            onChange={(event) => setSectorDraft(event.target.value)}
            aria-label="Stock sector"
            className="rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 type-body text-[var(--ink)]"
          />
          <button
            type="button"
            onClick={() => void handleSaveSector()}
            disabled={savingSector}
            className="inline-flex items-center justify-center rounded-[var(--radius-1)] border border-[var(--line)] px-3 py-2 type-small text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-50"
          >
            {savingSector ? "Saving sector..." : "Save Sector"}
          </button>
        </div>
        {sectorMessage && <p className="mt-2 type-small text-[var(--ink-muted)]">{sectorMessage}</p>}
      </div>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 mb-4">
        <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="type-caption uppercase text-[var(--ink-muted)]">Price</div>
          <div className="mt-2 type-figure-md tabular-nums text-[var(--ink)]">
            {currentPriceLabel}
          </div>
        </div>
        <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="type-caption uppercase text-[var(--ink-muted)]">Day Delta</div>
          <div className={`mt-2 type-figure-md tabular-nums ${priceTone}`}>
            {priceChangePct >= 0 ? "+" : ""}{formatNumber(priceChangePct / 100, "percent", { digits: 1 })}
          </div>
        </div>
        <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="type-caption uppercase text-[var(--ink-muted)]">Sector</div>
          <div className="mt-2 type-panel-title text-[var(--ink)]">{stock.sector || "Unassigned"}</div>
        </div>
        <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="type-caption uppercase text-[var(--ink-muted)]">Weight</div>
          <div className="mt-2 type-figure-md tabular-nums text-[var(--ink)]">{formatNumber(stock.weight, "percent", { digits: 1 })}</div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(22rem,1fr)]">
        <section className="lg:col-span-1 border border-[var(--line)] bg-[var(--surface-raised)] p-4">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="type-panel-title text-[var(--ink)]">
                <InfoTooltip
                  label="OHLC Candlestick + Volume"
                  description="Candles encode open, high, low, and close for each selected period. Volume bars show traded activity. Moving averages use 5, 20, 60, and 120 period closes, recalculated from daily or monthly bars depending on the selected timeframe."
                />
              </h3>
              <div className="mt-2 flex flex-wrap gap-2 type-small text-[var(--ink-muted)]">
                {movingAverageSeries.map((series) => (
                  <span
                    key={series.title}
                    className="inline-flex items-center gap-2 rounded-[var(--radius-2)] border border-[var(--line)] px-2 py-1"
                  >
                    {/* rounded-full: dot */}<span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.color }} />
                    {series.title}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onAddToPortfolio(stock)}
                className="inline-flex items-center justify-center rounded-[var(--radius-1)] border border-[var(--line)] px-3 py-2 type-small text-[var(--ink-muted)] hover:text-[var(--ink)]"
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
                  className="inline-flex items-center justify-center rounded-[var(--radius-1)] border border-[var(--status-error-border)] bg-[var(--status-error-surface)] px-3 py-2 type-small text-[var(--status-error-ink)] hover:bg-[var(--status-error-surface)]"
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
            colorAccent="var(--up)"
            upColor="var(--up)"
            downColor="var(--down)"
            loading={detailQuery.isLoading}
            timeframe={timeframe}
            eventGranularity={timeframe === "monthly" ? "month" : "day"}
            onTimeframeChange={(value) => setTimeframe(value as "daily" | "monthly")}
            timeframeOptions={[
              { value: "daily", label: "Daily" },
              { value: "monthly", label: "Monthly" },
            ]}
            legend={movingAverageSeries.map((series) => (
              <span
                key={series.title}
                className="inline-flex items-center gap-2 rounded-[var(--radius-2)] border border-[var(--line)] px-2 py-1"
              >
                {/* rounded-full: dot */}<span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.color }} />
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
                <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
                  <div className="flex items-center justify-between gap-2 type-caption uppercase text-[var(--ink-muted)]">
                    <span>ROIC - WACC</span>
                    {metricAuditQuery.data ? <MetricQualityBadge quality={metricAuditQuery.data.spread.quality} /> : null}
                  </div>
                  <div className={`mt-2 type-figure-md tabular-nums ${metricToneClass(comparisonMetrics.roicMinusWacc)}`} title={metricDisplayTitle(comparisonMetrics.roicMinusWacc)}>
                    {metricAuditQuery.data ? formatAuditMetricValue(metricAuditQuery.data.spread) : comparisonMetrics.roicMinusWacc.displayValue}
                  </div>
                  <p className="mt-2 type-small text-[var(--ink-muted)]">
                    {metricAuditQuery.data ? metricAuditReason(metricAuditQuery.data.spread) : metricSubtitle(comparisonMetrics.roicMinusWacc) ?? "Positive values imply returns on invested capital are exceeding the current capital cost estimate."}
                  </p>
                </div>
                <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
                  <div className="flex items-center justify-between gap-2 type-caption uppercase text-[var(--ink-muted)]">
                    <span>DCF value vs price (one-off gap)</span>
                    <MetricQualityBadge quality={comparisonMetrics.dcfUpside.quality} />
                  </div>
                  <div className={`mt-2 type-figure-md tabular-nums ${metricToneClass(comparisonMetrics.dcfUpside)}`} title={metricDisplayTitle(comparisonMetrics.dcfUpside)}>
                    {comparisonMetrics.dcfUpside.displayValue}
                  </div>
                  <p className="mt-2 type-small text-[var(--ink-muted)]">
                    {metricSubtitle(comparisonMetrics.dcfUpside) ?? "Snapshot-side upside or downside versus current price."}
                  </p>
                </div>
                <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
                  <div className="flex items-center justify-between gap-2 type-caption uppercase text-[var(--ink-muted)]">
                    <span>Implied return vs WACC (pts per year)</span>
                    <MetricQualityBadge quality={comparisonMetrics.impliedVsWacc.quality} />
                  </div>
                  <div className={`mt-2 type-figure-md tabular-nums ${metricToneClass(comparisonMetrics.impliedVsWacc)}`} title={metricDisplayTitle(comparisonMetrics.impliedVsWacc)}>
                    {comparisonMetrics.impliedVsWacc.displayValue}
                  </div>
                  <p className="mt-2 type-small text-[var(--ink-muted)]">
                    {metricSubtitle(comparisonMetrics.impliedVsWacc) ?? "The annual return today's market price implies for the whole business, minus its WACC, from the saved comparison snapshot."}
                  </p>
                </div>
                <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
                  <div className="flex items-center justify-between gap-2 type-caption uppercase text-[var(--ink-muted)]">
                    <span>Volatility</span>
                    <MetricQualityBadge quality={comparisonMetrics.volatility.quality} />
                  </div>
                  <div className={`mt-2 type-figure-md tabular-nums ${comparisonMetrics.volatility.quality === "missing" || comparisonMetrics.volatility.quality === "invalid" || comparisonMetrics.volatility.quality === "suspicious" ? "text-[var(--status-warning-ink)]" : "text-[var(--ink)]"}`} title={metricDisplayTitle(comparisonMetrics.volatility)}>
                    {comparisonMetrics.volatility.displayValue}
                  </div>
                  <p className="mt-2 type-small text-[var(--ink-muted)]">
                    {metricSubtitle(comparisonMetrics.volatility) ?? "Estimated from recent local price history for quick portfolio comparison."}
                  </p>
                </div>
              </div>
              <div className="mt-3 border border-[var(--line)] bg-[var(--surface-raised)] p-4">
                <div className="flex flex-col gap-1">
                  <h4 className="type-panel-title text-[var(--ink)]">Snapshot Context</h4>
                  <p className="type-body text-[var(--ink-muted)]">
                    {snapshotContextLabel}. This is the review frame for the stock-level comparison metrics shown in this modal.
                  </p>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="border border-[var(--line)] bg-[var(--surface)] p-3 type-small">
                    <div className="text-[var(--ink-muted)]">As Of</div>
                    <div className="type-mono mt-1 text-[var(--ink)]">
                      {snapshotMeta ? formatDateLabel(snapshotMeta.as_of_date) : "Live"}
                    </div>
                  </div>
                  <div className="border border-[var(--line)] bg-[var(--surface)] p-3 type-small">
                    <div className="text-[var(--ink-muted)]">Source</div>
                    <div className="type-mono mt-1 overflow-inline-ellipsis capitalize text-[var(--ink)]" title={snapshotMeta?.snapshot_source ?? snapshotMeta?.mode ?? "live"}>
                      {snapshotMeta?.snapshot_source ?? snapshotMeta?.mode ?? "live"}
                    </div>
                  </div>
                  <div className="border border-[var(--line)] bg-[var(--surface)] p-3 type-small">
                    <div className="text-[var(--ink-muted)]">Universe</div>
                    <div className="type-mono mt-1 overflow-inline-ellipsis text-[var(--ink)]" title={portfolioComparisonUniverseLabel(effectiveComparisonUniverse)}>
                      {portfolioComparisonUniverseLabel(effectiveComparisonUniverse)}
                    </div>
                  </div>
                  <div className="border border-[var(--line)] bg-[var(--surface)] p-3 type-small">
                    <div className="text-[var(--ink-muted)]">Benchmark</div>
                    <div className="type-mono mt-1 overflow-inline-ellipsis text-[var(--ink)]" title={effectiveComparisonBenchmarkTicker}>{effectiveComparisonBenchmarkTicker}</div>
                  </div>
                  <div className="border border-[var(--line)] bg-[var(--surface)] p-3 type-small">
                    <div className="text-[var(--ink-muted)]">Version</div>
                    <div className="mt-1 overflow-mono-block text-[var(--ink)]" title={activeSnapshotVersion || "Live"}>{activeSnapshotVersion || "Live"}</div>
                  </div>
                </div>
                {sparklineTrendPct != null && (
                  <p className="mt-3 type-body text-[var(--ink-muted)]">
                    Recent price trend: {sparklineTrendPct >= 0 ? "+" : ""}{formatNumber(sparklineTrendPct / 100, "percent", { digits: 2 })}.
                  </p>
                )}
              </div>
              {flaggedComparisonMetricCount > 0 && (
                <div className="mt-3 border border-[var(--status-warning-border)] bg-[var(--status-warning-surface)] p-3 type-body text-[var(--status-warning-ink)]">
                  {flaggedComparisonMetricCount} stock metric value{flaggedComparisonMetricCount === 1 ? "" : "s"} for {stock.ticker} {flaggedComparisonMetricCount === 1 ? "is" : "are"} currently flagged as outlier data and rendered as {/* M2: inline emphasis inside a sentence; the weight separates the label from the text */}{/* M2: inline emphasis inside a sentence; the weight separates the label from the text */}<span className="font-semibold">N/A</span>. Treat the price chart and saved snapshot history as the primary review context until fresher fundamentals are available.
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
              <div className="mt-4 border border-[var(--line)] bg-[var(--surface-raised)] p-4">
                <div className="flex flex-col gap-1">
                  <h4 className="type-panel-title text-[var(--ink)]">Stock History Timeline</h4>
                  <p className="type-small text-[var(--ink-muted)]">
                    Review how saved comparison metrics changed across persisted snapshots for {stock.ticker}.
                  </p>
                  {snapshotMeta?.mode === "snapshot" && (
                    <p className="type-small text-[var(--ink-muted)]">
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
                      <div className="border border-[var(--line)] bg-[var(--surface)] p-3">
                        <div className="type-caption uppercase text-[var(--ink-muted)]">Saved Snapshots</div>
                        <div className="mt-1 type-panel-title text-[var(--ink)]">{snapshotTrendPoints.length}</div>
                        <p className="mt-1 type-small text-[var(--ink-muted)]">Persisted comparison rows currently available for {stock.ticker}.</p>
                      </div>
                      <div className="border border-[var(--line)] bg-[var(--surface)] p-3">
                        <div className="type-caption uppercase text-[var(--ink-muted)]">Implied return vs WACC trend</div>
                        <div data-testid="implied-spread-trend-delta" className={`mt-1 type-panel-title ${expectedSpreadTrendDelta == null ? "text-[var(--ink-muted)]" : expectedSpreadTrendDelta > 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}>{formatMetricPercent(expectedSpreadTrendDelta)}</div>
                        <p className="mt-1 type-small text-[var(--ink-muted)]">Latest versus oldest saved implied return vs WACC, only between snapshots that recorded it.</p>
                      </div>
                      <div className="border border-[var(--line)] bg-[var(--surface)] p-3">
                        <div className="type-caption uppercase text-[var(--ink-muted)]">Recent Price Sparkline</div>
                        <div className="mt-2 h-10">
                          <Sparkline
                            data={stock.sparkline}
                            height={40}
                          />
                        </div>
                        <p className="mt-1 type-small text-[var(--ink-muted)]">Recent price path alongside the saved comparison timeline.</p>
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

        <section className="flex min-h-[24rem] flex-col border border-[var(--line)] bg-[var(--surface-raised)] p-4">
          <h3 className="type-panel-title text-[var(--ink)]">
            <InfoTooltip
              label="Ticker News Feed (filtered)"
              description="Latest stock-specific headlines crawled from Google News RSS and stored locally by ticker. This section stays filtered to the selected holding."
            />
          </h3>
          <p className="mt-1 type-small text-[var(--ink-muted)]">Filtered news for {stock.ticker}, ordered by date with today highlights preserved.</p>
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
