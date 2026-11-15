"use client";

import { formatNumber } from "@/lib/format";
import React, { useRef, useState, useMemo, useEffect } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { fetchApi } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n/locale";
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
  type WatchlistTheme,
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
  themes: WatchlistTheme[];
  onUpdateTheme: (stock: PortfolioStock, themeId: string) => Promise<void>;
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
  themes,
  onUpdateTheme,
  onRemoveFromWatchlist,
  onClose,
}: StockDetailModalProps) {
  const previousTickerRef = useRef(stock.ticker);
  const newsPageSize = 5;
  const [timeframe, setTimeframe] = useState<"daily" | "monthly">("daily");
  const [sectorDraft, setSectorDraft] = useState(stock.sector);
  const [savingSector, setSavingSector] = useState(false);
  const [sectorMessage, setSectorMessage] = useState<string | null>(null);
  const { locale } = useLocale();
  const t = useT();
  const [themeDraft, setThemeDraft] = useState(stock.theme);
  const [savingTheme, setSavingTheme] = useState(false);
  const [themeMessage, setThemeMessage] = useState<string | null>(null);
  
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
        title: timeframe === "monthly" ? t("portfolio.detail.chart.maMonthly", { window: windowSize }) : t("portfolio.detail.chart.ma", { window: windowSize }),
        color: MOVING_AVERAGE_COLORS[windowSize],
        data: buildMovingAverageSeries(chartPrices, windowSize),
      })),
    [chartPrices, timeframe, t],
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
    ? t("portfolio.detail.context.savedFrom", { date: formatDateLabel(snapshotMeta.as_of_date) })
    : t("portfolio.detail.context.liveMetrics");
    
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
          missingReason: t("portfolio.detail.metric.missingRoicWacc"),
          suspiciousReason: t("portfolio.detail.metric.suspiciousRoicWacc"),
        }),
        dcfUpside: buildPortfolioDisplayMetric(point.dcf_implied_return, {
          missingReason: point.dcf_refusal
            ? impliedReturnRefusalText(point.dcf_refusal)
            : t("portfolio.detail.metric.missingDcf"),
          suspiciousReason: t("portfolio.detail.metric.suspiciousDcf"),
        }),
        impliedVsWacc: buildPortfolioDisplayMetric(point.implied_return_spread, {
          // A code means refused in a v3 snapshot; no code means the snapshot predates v3.
          missingReason: impliedReturnRefusalText(point.implied_return_refusal),
          suspiciousReason: t("portfolio.detail.metric.suspiciousImpliedWacc"),
        }),
      };
      return acc;
    }, {})
  ), [snapshotTrendPoints, t]);
  const detailErrorMessage = detailQuery.error instanceof Error
    ? detailQuery.error.message
    : t("portfolio.detail.chart.unavailableFallback");
  const newsErrorMessage = newsQuery.error instanceof Error
    ? newsQuery.error.message
    : t("portfolio.detail.news.fallbackError", { ticker: stock.ticker });
  const timelineGroups = useMemo(() => (
    snapshotTrendPoints.length === 0
      ? []
      : [
          {
            id: `${stock.ticker}-history`,
            label: t("portfolio.detail.timeline.group"),
            items: snapshotTrendPoints.map((point) => {
              const metrics = snapshotTimelineMetrics[point.snapshot_version];
              return {
              id: point.snapshot_version,
              title: formatDateLabel(point.as_of_date),
              subtitle: t("portfolio.detail.timeline.against", { source: point.snapshot_source, benchmark: point.benchmark_ticker }),
              active: point.snapshot_version === activeSnapshotVersion,
              meta: (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span
                    className="overflow-inline-ellipsis max-w-full rounded-[var(--radius-2)] bg-[var(--surface)] px-2 py-1 type-caption text-[var(--ink)]"
                    title={point.snapshot_version}
                  >
                    {t("portfolio.detail.timeline.version", { version: point.snapshot_version })}
                  </span>
                  <span aria-hidden="true">•</span>
                  <span>{t("portfolio.detail.timeline.price", { price: formatCurrencyCompact(point.current_price) })}</span>
                </div>
              ),
              content: (
                <div className="grid grid-cols-2 gap-3 type-small md:grid-cols-4">
                  <div className="border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
                    <div className="text-[var(--ink-muted)]">{t("portfolio.detail.metric.roicWacc")}</div>
                    <div className={`type-figure-md mt-1 ${metricToneClass(metrics.roicMinusWacc)}`} title={metricDisplayTitle(metrics.roicMinusWacc)}>{metrics.roicMinusWacc.displayValue}</div>
                    {metricSubtitle(metrics.roicMinusWacc) ? <div className="mt-1 type-caption text-[var(--ink-muted)]">{metricSubtitle(metrics.roicMinusWacc)}</div> : null}
                  </div>
                  <div className="border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
                    <div className="text-[var(--ink-muted)]">{t("portfolio.detail.metric.dcf")}</div>
                    <div className={`type-figure-md mt-1 ${metricToneClass(metrics.dcfUpside)}`} title={metricDisplayTitle(metrics.dcfUpside)}>{metrics.dcfUpside.displayValue}</div>
                    {metricSubtitle(metrics.dcfUpside) ? <div className="mt-1 type-caption text-[var(--ink-muted)]">{metricSubtitle(metrics.dcfUpside)}</div> : null}
                  </div>
                  <div className="border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
                    <div className="text-[var(--ink-muted)]">{t("portfolio.detail.metric.impliedWacc")}</div>
                    <div className={`type-figure-md mt-1 ${metricToneClass(metrics.impliedVsWacc)}`} title={metricDisplayTitle(metrics.impliedVsWacc)}>{metrics.impliedVsWacc.displayValue}</div>
                    {metricSubtitle(metrics.impliedVsWacc) ? <div className="mt-1 type-caption text-[var(--ink-muted)]">{metricSubtitle(metrics.impliedVsWacc)}</div> : null}
                  </div>
                  <div className="border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
                    <div className="text-[var(--ink-muted)]">{t("portfolio.detail.metric.marketReturn")}</div>
                    <div className="type-figure-md mt-1 text-[var(--ink)]">{formatMetricPercent(point.market_expected_return)}</div>
                  </div>
                </div>
              ),
            };
            }),
          },
        ]
  ), [activeSnapshotVersion, snapshotTimelineMetrics, snapshotTrendPoints, stock.ticker, t]);

  useEffect(() => {
    const tickerChanged = previousTickerRef.current !== stock.ticker;
    previousTickerRef.current = stock.ticker;
    setSectorDraft(stock.sector);
    setThemeDraft(stock.theme);
    if (tickerChanged) {
      setSectorMessage(null);
      setThemeMessage(null);
    }
  }, [stock.sector, stock.theme, stock.ticker]);

  const handleSaveSector = async () => {
    const normalizedSector = sectorDraft.trim();
    if (normalizedSector === stock.sector.trim()) {
      setSectorMessage(t("portfolio.detail.sector.upToDate"));
      return;
    }
    setSavingSector(true);
    setSectorMessage(null);
    try {
      await onUpdateSector(stock, normalizedSector);
      setSectorMessage(t("portfolio.detail.sector.saved", { ticker: stock.ticker }));
    } catch (error) {
      setSectorMessage(error instanceof Error ? error.message : t("portfolio.detail.sector.failed"));
    } finally {
      setSavingSector(false);
    }
  };

  const handleSaveTheme = async () => {
    if (themeDraft === stock.theme) {
      setThemeMessage(t("portfolio.detail.theme.upToDate"));
      return;
    }
    setSavingTheme(true);
    setThemeMessage(null);
    try {
      await onUpdateTheme(stock, themeDraft);
      setThemeMessage(t("portfolio.detail.theme.saved", { ticker: stock.ticker }));
    } catch (error) {
      setThemeMessage(error instanceof Error ? error.message : t("portfolio.detail.theme.failed"));
    } finally {
      setSavingTheme(false);
    }
  };

  // A stored id the list does not know (a newer PC may have added it) stays visible as "Other".
  const storedThemeUnknown = stock.theme !== "" && !themes.some((theme) => theme.id === stock.theme);

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
          <h3 className="type-panel-title text-[var(--ink)]">{t("portfolio.detail.quickReview.title")}</h3>
          <p className="mt-1 type-body text-[var(--ink-muted)]">
            {t("portfolio.detail.quickReview.body")}
          </p>
        </div>
        <Link
          href={`/detail/${encodeURIComponent(stock.ticker)}`}
          className="inline-flex min-h-9 items-center justify-center border border-[var(--line)] px-[var(--space-4)] type-small text-[var(--ink)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--surface)]"
        >
          {t("portfolio.detail.quickReview.viewFull")}
        </Link>
      </section>

      <div className="flex flex-col mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-[var(--radius-2)] border border-[var(--line)] bg-[var(--surface)] px-3 py-1 type-small text-[var(--ink-muted)]">
            {t("portfolio.detail.sector.label")}
          </span>
          <input
            type="text"
            value={sectorDraft}
            onChange={(event) => setSectorDraft(event.target.value)}
            aria-label={t("portfolio.detail.sector.aria")}
            className="rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 type-body text-[var(--ink)]"
          />
          <button
            type="button"
            onClick={() => void handleSaveSector()}
            disabled={savingSector}
            className="inline-flex items-center justify-center rounded-[var(--radius-1)] border border-[var(--line)] px-3 py-2 type-small text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-50"
          >
            {savingSector ? t("portfolio.detail.sector.saving") : t("portfolio.detail.sector.save")}
          </button>
        </div>
        {sectorMessage && <p className="mt-2 type-small text-[var(--ink-muted)]">{sectorMessage}</p>}
      </div>

      {stock.id > 0 && (
        <div className="flex flex-col mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-[var(--radius-2)] border border-[var(--line)] bg-[var(--surface)] px-3 py-1 type-small text-[var(--ink-muted)]">
              {t("portfolio.detail.theme.label")}
            </span>
            <select
              value={themeDraft}
              onChange={(event) => setThemeDraft(event.target.value)}
              aria-label={t("portfolio.detail.theme.aria")}
              className="rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 type-body text-[var(--ink)]"
            >
              <option value="">{t("portfolio.detail.theme.none")}</option>
              {themes.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {locale === "ko" ? theme.ko : theme.en}
                </option>
              ))}
              {storedThemeUnknown && (
                <option value={stock.theme} disabled>
                  {t("portfolio.detail.theme.other")}
                </option>
              )}
            </select>
            <button
              type="button"
              onClick={() => void handleSaveTheme()}
              disabled={savingTheme}
              className="inline-flex items-center justify-center rounded-[var(--radius-1)] border border-[var(--line)] px-3 py-2 type-small text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-50"
            >
              {savingTheme ? t("portfolio.detail.theme.saving") : t("portfolio.detail.theme.save")}
            </button>
          </div>
          {themeMessage && <p className="mt-2 type-small text-[var(--ink-muted)]">{themeMessage}</p>}
        </div>
      )}

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 mb-4">
        <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="type-caption uppercase text-[var(--ink-muted)]">{t("portfolio.detail.stat.price")}</div>
          <div className="mt-2 type-figure-md tabular-nums text-[var(--ink)]">
            {currentPriceLabel}
          </div>
        </div>
        <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="type-caption uppercase text-[var(--ink-muted)]">{t("portfolio.detail.stat.dayDelta")}</div>
          <div className={`mt-2 type-figure-md tabular-nums ${priceTone}`}>
            {priceChangePct >= 0 ? "+" : ""}{formatNumber(priceChangePct / 100, "percent", { digits: 1 })}
          </div>
        </div>
        <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="type-caption uppercase text-[var(--ink-muted)]">{t("portfolio.detail.stat.sector")}</div>
          <div className="mt-2 type-panel-title text-[var(--ink)]">{stock.sector || t("portfolio.detail.stat.unassigned")}</div>
        </div>
        <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="type-caption uppercase text-[var(--ink-muted)]">{t("portfolio.detail.stat.weight")}</div>
          <div className="mt-2 type-figure-md tabular-nums text-[var(--ink)]">{formatNumber(stock.weight, "percent", { digits: 1 })}</div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(22rem,1fr)]">
        <section data-testid="stock-detail-chart" className="lg:col-span-1 border border-[var(--line)] bg-[var(--surface-raised)] p-4">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="type-panel-title text-[var(--ink)]">
                <InfoTooltip
                  label={t("portfolio.detail.chart.title")}
                  description={t("portfolio.detail.chart.description")}
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
                    ? t("portfolio.detail.action.reviewWeight")
                    : t("portfolio.detail.action.addToPortfolio")
                  : t("portfolio.detail.action.addToPortfolio")}
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
                  {t("portfolio.detail.action.removeFromWatchlist")}
                </button>
              )}
            </div>
          </div>
          <OHLCVChartCard
            title={t("portfolio.detail.chart.title")}
            description={t("portfolio.detail.chart.description")}
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
              { value: "daily", label: t("portfolio.detail.chart.daily") },
              { value: "monthly", label: t("portfolio.detail.chart.monthly") },
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
            emptyDescription={t("portfolio.detail.chart.noHistory")}
          />
          {detailQuery.isError ? (
            <ErrorState
              title={t("portfolio.detail.chart.unavailable")}
              message={detailErrorMessage}
            />
          ) : !detailQuery.isLoading && candles.length === 0 ? (
            <StatusPanel title={t("portfolio.detail.chart.noPriceData")} message={t("portfolio.detail.chart.noHistory")} tone="warning" />
          ) : null}
        </section>

        {/* lg:h-0 + lg:min-h-full: the chart sets the row height and the news scrolls inside it,
            instead of stretching to the full left column and leaving empty space below the list. */}
        <section data-testid="stock-detail-news" className="flex min-h-[24rem] flex-col border border-[var(--line)] bg-[var(--surface-raised)] p-4 lg:h-0 lg:min-h-full">
          <h3 className="type-panel-title text-[var(--ink)]">
            <InfoTooltip
              label={t("portfolio.detail.news.title")}
              description={t("portfolio.detail.news.description")}
            />
          </h3>
          <p className="mt-1 type-small text-[var(--ink-muted)]">{t("portfolio.detail.news.intro", { ticker: stock.ticker })}</p>
          <div className="mt-4 min-h-0 flex-1">
            {newsQuery.isLoading ? (
              <EmptyState title={t("portfolio.detail.news.loading")} />
            ) : newsQuery.isError && stockNewsItems.length === 0 ? (
              <ErrorState title={t("portfolio.detail.news.unavailable")} message={newsErrorMessage} />
            ) : stockNewsItems.length === 0 ? (
              <EmptyState title={t("portfolio.detail.news.emptyTitle")} description={t("portfolio.detail.news.emptyBody", { ticker: stock.ticker })} />
            ) : (
              <NewsFeedList
                fill
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
      {!detailQuery.isError && !detailQuery.isLoading && candles.length > 0 && (
        <div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
              <div className="flex items-center justify-between gap-2 type-caption uppercase text-[var(--ink-muted)]">
                <span>{t("portfolio.detail.metric.roicWacc")}</span>
                {metricAuditQuery.data ? <MetricQualityBadge quality={metricAuditQuery.data.spread.quality} /> : null}
              </div>
              <div className={`mt-2 type-figure-md tabular-nums ${metricToneClass(comparisonMetrics.roicMinusWacc)}`} title={metricDisplayTitle(comparisonMetrics.roicMinusWacc)}>
                {metricAuditQuery.data ? formatAuditMetricValue(metricAuditQuery.data.spread) : comparisonMetrics.roicMinusWacc.displayValue}
              </div>
              <p className="mt-2 type-small text-[var(--ink-muted)]">
                {metricAuditQuery.data ? metricAuditReason(metricAuditQuery.data.spread) : metricSubtitle(comparisonMetrics.roicMinusWacc) ?? t("portfolio.detail.metric.roicWaccHelp")}
              </p>
            </div>
            <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
              <div className="flex items-center justify-between gap-2 type-caption uppercase text-[var(--ink-muted)]">
                <span>{t("portfolio.detail.metric.dcf")}</span>
                <MetricQualityBadge quality={comparisonMetrics.dcfUpside.quality} />
              </div>
              <div className={`mt-2 type-figure-md tabular-nums ${metricToneClass(comparisonMetrics.dcfUpside)}`} title={metricDisplayTitle(comparisonMetrics.dcfUpside)}>
                {comparisonMetrics.dcfUpside.displayValue}
              </div>
              <p className="mt-2 type-small text-[var(--ink-muted)]">
                {metricSubtitle(comparisonMetrics.dcfUpside) ?? t("portfolio.detail.metric.dcfHelp")}
              </p>
            </div>
            <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
              <div className="flex items-center justify-between gap-2 type-caption uppercase text-[var(--ink-muted)]">
                <span>{t("portfolio.detail.metric.impliedWacc")}</span>
                <MetricQualityBadge quality={comparisonMetrics.impliedVsWacc.quality} />
              </div>
              <div className={`mt-2 type-figure-md tabular-nums ${metricToneClass(comparisonMetrics.impliedVsWacc)}`} title={metricDisplayTitle(comparisonMetrics.impliedVsWacc)}>
                {comparisonMetrics.impliedVsWacc.displayValue}
              </div>
              <p className="mt-2 type-small text-[var(--ink-muted)]">
                {metricSubtitle(comparisonMetrics.impliedVsWacc) ?? t("portfolio.detail.metric.impliedHelp")}
              </p>
            </div>
            <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
              <div className="flex items-center justify-between gap-2 type-caption uppercase text-[var(--ink-muted)]">
                <span>{t("portfolio.detail.metric.volatility")}</span>
                <MetricQualityBadge quality={comparisonMetrics.volatility.quality} />
              </div>
              <div className={`mt-2 type-figure-md tabular-nums ${comparisonMetrics.volatility.quality === "missing" || comparisonMetrics.volatility.quality === "invalid" || comparisonMetrics.volatility.quality === "suspicious" ? "text-[var(--status-warning-ink)]" : "text-[var(--ink)]"}`} title={metricDisplayTitle(comparisonMetrics.volatility)}>
                {comparisonMetrics.volatility.displayValue}
              </div>
              <p className="mt-2 type-small text-[var(--ink-muted)]">
                {metricSubtitle(comparisonMetrics.volatility) ?? t("portfolio.detail.metric.volatilityHelp")}
              </p>
            </div>
          </div>
          <div className="mt-3 border border-[var(--line)] bg-[var(--surface-raised)] p-4">
            <div className="flex flex-col gap-1">
              <h4 className="type-panel-title text-[var(--ink)]">{t("portfolio.detail.context.title")}</h4>
              <p className="type-body text-[var(--ink-muted)]">
                {t("portfolio.detail.context.body", { label: snapshotContextLabel })}
              </p>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="border border-[var(--line)] bg-[var(--surface)] p-3 type-small">
                <div className="text-[var(--ink-muted)]">{t("portfolio.detail.context.asOf")}</div>
                <div className="type-mono mt-1 text-[var(--ink)]">
                  {snapshotMeta ? formatDateLabel(snapshotMeta.as_of_date) : t("portfolio.detail.context.liveValue")}
                </div>
              </div>
              <div className="border border-[var(--line)] bg-[var(--surface)] p-3 type-small">
                <div className="text-[var(--ink-muted)]">{t("portfolio.detail.context.source")}</div>
                <div className="type-mono mt-1 overflow-inline-ellipsis capitalize text-[var(--ink)]" title={snapshotMeta?.snapshot_source ?? snapshotMeta?.mode ?? "live"}>
                  {snapshotMeta?.snapshot_source ?? snapshotMeta?.mode ?? "live"}
                </div>
              </div>
              <div className="border border-[var(--line)] bg-[var(--surface)] p-3 type-small">
                <div className="text-[var(--ink-muted)]">{t("portfolio.detail.context.universe")}</div>
                <div className="type-mono mt-1 overflow-inline-ellipsis text-[var(--ink)]" title={portfolioComparisonUniverseLabel(effectiveComparisonUniverse)}>
                  {portfolioComparisonUniverseLabel(effectiveComparisonUniverse)}
                </div>
              </div>
              <div className="border border-[var(--line)] bg-[var(--surface)] p-3 type-small">
                <div className="text-[var(--ink-muted)]">{t("portfolio.detail.context.benchmark")}</div>
                <div className="type-mono mt-1 overflow-inline-ellipsis text-[var(--ink)]" title={effectiveComparisonBenchmarkTicker}>{effectiveComparisonBenchmarkTicker}</div>
              </div>
              <div className="border border-[var(--line)] bg-[var(--surface)] p-3 type-small">
                <div className="text-[var(--ink-muted)]">{t("portfolio.detail.context.version")}</div>
                <div className="mt-1 overflow-mono-block text-[var(--ink)]" title={activeSnapshotVersion || t("portfolio.detail.context.liveValue")}>{activeSnapshotVersion || t("portfolio.detail.context.liveValue")}</div>
              </div>
            </div>
            {sparklineTrendPct != null && (
              <p className="mt-3 type-body text-[var(--ink-muted)]">
                {t("portfolio.detail.trend", { value: `${sparklineTrendPct >= 0 ? "+" : ""}${formatNumber(sparklineTrendPct / 100, "percent", { digits: 2 })}` })}
              </p>
            )}
          </div>
          {flaggedComparisonMetricCount > 0 && (
            <div className="mt-3 border border-[var(--status-warning-border)] bg-[var(--status-warning-surface)] p-3 type-body text-[var(--status-warning-ink)]">
              {flaggedComparisonMetricCount === 1 ? t("portfolio.detail.flagged.one", { ticker: stock.ticker }) : t("portfolio.detail.flagged.many", { ticker: stock.ticker, count: flaggedComparisonMetricCount })}{/* M2: inline emphasis inside a sentence; the weight separates the label from the text */}{/* M2: inline emphasis inside a sentence; the weight separates the label from the text */}<span className="font-semibold">N/A</span>{t("portfolio.detail.flagged.tail")}
            </div>
          )}
          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            {metricAuditQuery.isLoading ? (
              <div className="xl:col-span-2">
                <EmptyState title={t("portfolio.detail.audit.loading")} />
              </div>
            ) : metricAuditQuery.isError ? (
              <div className="xl:col-span-2">
                <ErrorState title={t("portfolio.detail.audit.unavailable")} message={t("portfolio.detail.audit.unavailableBody", { ticker: stock.ticker })} />
              </div>
            ) : (
              <>
                <MetricAuditPanel audit={metricAuditQuery.data ?? null} metric="roic" title={t("portfolio.detail.audit.roicTitle")} />
                <MetricAuditPanel audit={metricAuditQuery.data ?? null} metric="wacc" title={t("portfolio.detail.audit.waccTitle")} />
              </>
            )}
          </div>
          <div className="mt-4 border border-[var(--line)] bg-[var(--surface-raised)] p-4">
            <div className="flex flex-col gap-1">
              <h4 className="type-panel-title text-[var(--ink)]">{t("portfolio.detail.timeline.title")}</h4>
              <p className="type-small text-[var(--ink-muted)]">
                {t("portfolio.detail.timeline.intro", { ticker: stock.ticker })}
              </p>
              {snapshotMeta?.mode === "snapshot" && (
                <p className="type-small text-[var(--ink-muted)]">
                  {t("portfolio.detail.timeline.context", { date: formatDateLabel(snapshotMeta.as_of_date), universe: portfolioComparisonUniverseLabel(effectiveComparisonUniverse), benchmark: effectiveComparisonBenchmarkTicker })}
                </p>
              )}
            </div>
            {stockSnapshotHistoryQuery.isLoading ? (
              <div className="mt-3">
                <EmptyState title={t("portfolio.detail.timeline.loading")} />
              </div>
            ) : stockSnapshotHistoryQuery.isError ? (
              <div className="mt-3">
                <ErrorState title={t("portfolio.detail.timeline.unavailable")} message={t("portfolio.detail.timeline.unavailableBody")} />
              </div>
            ) : timelineGroups.length === 0 ? (
              <div className="mt-3">
                <EmptyState title={t("portfolio.detail.timeline.emptyTitle")} description={t("portfolio.detail.timeline.emptyBody")} />
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="border border-[var(--line)] bg-[var(--surface)] p-3">
                    <div className="type-caption uppercase text-[var(--ink-muted)]">{t("portfolio.detail.timeline.savedSnapshots")}</div>
                    <div className="mt-1 type-panel-title text-[var(--ink)]">{snapshotTrendPoints.length}</div>
                    <p className="mt-1 type-small text-[var(--ink-muted)]">{t("portfolio.detail.timeline.savedSnapshotsBody", { ticker: stock.ticker })}</p>
                  </div>
                  <div className="border border-[var(--line)] bg-[var(--surface)] p-3">
                    <div className="type-caption uppercase text-[var(--ink-muted)]">{t("portfolio.detail.timeline.spreadTrend")}</div>
                    <div data-testid="implied-spread-trend-delta" className={`mt-1 type-panel-title ${expectedSpreadTrendDelta == null ? "text-[var(--ink-muted)]" : expectedSpreadTrendDelta > 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}>{formatMetricPercent(expectedSpreadTrendDelta)}</div>
                    <p className="mt-1 type-small text-[var(--ink-muted)]">{t("portfolio.detail.timeline.spreadTrendBody")}</p>
                  </div>
                  <div className="border border-[var(--line)] bg-[var(--surface)] p-3">
                    <div className="type-caption uppercase text-[var(--ink-muted)]">{t("portfolio.detail.timeline.sparkline")}</div>
                    <div className="mt-2 h-10">
                      <Sparkline
                        data={stock.sparkline}
                        height={40}
                      />
                    </div>
                    <p className="mt-1 type-small text-[var(--ink-muted)]">{t("portfolio.detail.timeline.sparklineBody")}</p>
                  </div>
                </div>
                <TimelineList groups={timelineGroups} />
              </div>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
