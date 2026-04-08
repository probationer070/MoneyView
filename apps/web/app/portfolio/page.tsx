"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
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

// Domain models returned by the portfolio, detail, and news endpoints.
interface WatchlistDelta {
  delta_pct: number;
}

interface PortfolioStock {
  ticker: string;
  name: string;
  sector: string;
  group_name: string;
  last_close: number;
  delta: WatchlistDelta;
  sparkline: number[];
}

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
  onSelect,
}: {
  watchlist: PortfolioStock[];
  onSelect: (stock: PortfolioStock) => void;
}) {
  return (
    <section className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-panel)] shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-[var(--surface-muted)] text-left text-[var(--text-muted)]">
          <tr>
            <th className="px-4 py-3 font-semibold">Company</th>
            <th className="px-4 py-3 font-semibold">Ticker</th>
            <th className="px-4 py-3 font-semibold">Sector</th>
            <th className="px-4 py-3 text-right font-semibold">Last Close</th>
            <th className="px-4 py-3 text-right font-semibold">Change</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]/60">
          {watchlist.map((stock) => {
            const deltaPct = stock.delta?.delta_pct ?? 0;
            return (
              <tr
                key={stock.ticker}
                className="cursor-pointer hover:bg-[var(--surface-muted)]/50"
                onClick={() => onSelect(stock)}
              >
                <td className="px-4 py-3 font-bold text-[var(--text-primary)]">{stock.name || stock.ticker}</td>
                <td className="px-4 py-3 text-xs font-light tracking-wide text-[var(--text-muted)]">{stock.ticker}</td>
                <td className="px-4 py-3 text-[var(--text-muted)]">{stock.sector || "UNCLASSIFIED"}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {stock.last_close.toLocaleString(undefined, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}
                </td>
                <td className="px-4 py-3 text-right">
                  <DeltaBadge value={deltaPct} />
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

// Detail modal loads OHLCV history and paginated ticker news for the selected holding.
function StockDetailModal({
  stock,
  onClose,
}: {
  stock: PortfolioStock;
  onClose: () => void;
}) {
  const newsContainerRef = useRef<HTMLDivElement | null>(null);
  const newsPageSize = 5;

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

  const prices = useMemo(() => detailQuery.data?.prices ?? [], [detailQuery.data?.prices]);
  const candles = useMemo(() => transformToTVCandles(prices), [prices]);
  const volume = useMemo(() => transformToTVVolume(prices), [prices]);
  const news = newsQuery.data?.pages.flat() ?? detailQuery.data?.news ?? [];
  const currentPrice = prices.at(-1)?.close ?? stock.last_close;
  const previousPrice = prices.length > 1 ? prices[prices.length - 2].close : currentPrice;
  const priceChangePct = previousPrice ? ((currentPrice - previousPrice) / previousPrice) * 100 : 0;
  const priceTone = priceChangePct >= 0 ? "text-[var(--delta-up)]" : "text-[var(--delta-down)]";

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
            <h3 className="mb-3 text-sm font-bold text-[var(--text-primary)]">
              <InfoTooltip
                label="OHLC Candlestick + Volume"
                description="Candles encode open, high, low, and close for each trading day. Volume bars at the bottom show trading activity and are colored by close versus open."
              />
            </h3>
            {detailQuery.isLoading ? (
              <div className="h-[520px] animate-pulse rounded-[var(--radius)] bg-gray-100" />
            ) : candles.length > 0 ? (
              <TVChart
                data={candles}
                volumeData={volume}
                height={520}
                tickerName={stock.ticker}
                colorAccent="var(--accent)"
                upColor="#EF5350"
                downColor="#4589E5"
              />
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
                    className={`block rounded-[var(--radius)] border border-[var(--border)] bg-white p-3 text-sm shadow-sm transition-colors hover:border-[var(--accent)] ${
                      today
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
  const [holdingsView, setHoldingsView] = useState<ViewMode>("chart");
  const [selectedStock, setSelectedStock] = useState<PortfolioStock | null>(null);
  const [holdingStartDate, setHoldingStartDate] = useState("");
  const [attributionAsOfDate, setAttributionAsOfDate] = useState("");

  // Watchlist query is the source for holdings, attribution inputs, and detail entry points.
  const watchlistQuery = useQuery<PortfolioStock[]>({
    queryKey: ["portfolio-watchlist"],
    queryFn: () => fetchApi<PortfolioStock[]>("/portfolio/watchlist"),
    staleTime: 1000 * 60,
  });

  const tickers = useMemo(
    () => (watchlistQuery.data ?? []).slice(0, 5).map((row) => row.ticker),
    [watchlistQuery.data],
  );
  const weights = useMemo(
    () => (tickers.length ? tickers.map(() => 1 / tickers.length) : []),
    [tickers],
  );

  // Attribution query posts an equal-weight portfolio against the S&P 500 benchmark.
  const attributionQuery = useQuery<AttributionResult>({
    queryKey: ["portfolio-attribution", tickers.join(","), "5y", "^GSPC", "USD", holdingStartDate, attributionAsOfDate],
    enabled: tickers.length > 0,
    queryFn: () =>
      fetchApi<AttributionResult>("/portfolio/attribution", {
        method: "POST",
        body: JSON.stringify({
          tickers,
          weights,
          benchmark: "^GSPC",
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

  const watchlist = watchlistQuery.data ?? [];
  // Chart adapters convert domain attribution data into display-ready allocation/effects datasets.
  const allocationData = attributionQuery.data ? toAllocationDonutData(attributionQuery.data) : [];
  const waterfallData = attributionQuery.data ? toAttributionWaterfallData(attributionQuery.data) : [];
  const hasHoldings = tickers.length > 0;
  const shouldShowAttribution = hasHoldings && !attributionQuery.isError;

  return (
    <ErrorBoundary
      fallbackTitle="Portfolio Command Center Failure"
      fallbackMessage="Portfolio attribution UI failed to render safely."
    >
      <div className="space-y-6 animate-in fade-in duration-500">
        {/* Header: page identity plus attribution date range and export controls. */}
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">Portfolio</h1>
            <p className="text-[var(--text-muted)] mt-1">
              Attribution-focused portfolio command center
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
            <ExportButton tickers={tickers} weights={weights} benchmark="^GSPC" period="5y" currency="USD" dateFrom={holdingStartDate} asOfDate={attributionAsOfDate} />
          </div>
        </header>

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
                    Benchmark: {attributionQuery.data.metadata.benchmark}. Return window: {holdingStartDate || "5-year lookback start"} to {attributionAsOfDate || "latest available market date"}. Methodology: portfolio holdings are equal-weighted in this view, then compared against benchmark return over the selected period. If user-provided benchmark weights exist, the engine uses them directly; otherwise it uses the opted-in provider-derived sector proxy and labels the limitation in the data quality metadata.
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
            message="Add at least one asset to watchlist to generate portfolio attribution insights."
          />
        )}

        {!attributionQuery.isLoading && !hasHoldings && !watchlistQuery.isError && (
          <StatusPanel
            title="Attribution Pending Portfolio"
            message="Attribution charts will appear once watchlist has holdings and weights."
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
                label="Holdings"
                description="Each card shows current close, day-over-day percentage change, and a recent price sparkline. Good/bad follows local convention: red indicates price gain, blue indicates price loss."
              />
            </h2>
            <p className="text-sm text-[var(--text-muted)]">Click a holding for OHLC, volume, and latest stock news.</p>
          </div>
          <ViewToggle value={holdingsView} onChange={setHoldingsView} />
        </section>

        {/* Holdings body: skeleton, card grid, table, or empty state depending on data and view mode. */}
        {watchlistQuery.isLoading ? (
          <WatchlistSkeletonGrid />
        ) : watchlist.length > 0 && holdingsView === "chart" ? (
          <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {watchlist.map((stock) => {
              const deltaPct = stock.delta?.delta_pct ?? 0;
              return (
                <button
                  type="button"
                  onClick={() => setSelectedStock(stock)}
                  key={stock.ticker}
                  className="group block bg-[var(--surface-panel)] rounded-[var(--radius)] border border-[var(--border)] p-4 text-left shadow-sm hover:shadow-md transition-all hover:border-[var(--accent)]"
                >
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
                </button>
              );
            })}
          </section>
        ) : watchlist.length > 0 ? (
          <HoldingsTable watchlist={watchlist} onSelect={setSelectedStock} />
        ) : null}

        {/* Stock detail modal renders on demand when a holding is selected. */}
        {selectedStock && (
          <StockDetailModal stock={selectedStock} onClose={() => setSelectedStock(null)} />
        )}
      </div>
    </ErrorBoundary>
  );
}
