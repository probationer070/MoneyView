"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import TVChart from "@/components/charts/TVChart";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { ViewToggle, type ViewMode } from "@/components/ui/ViewToggle";
import { type RawOHLCV, transformToTVCandles, transformToTVVolume } from "@/lib/transformers";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { ModalShell } from "@/components/ui/ModalShell";
import { LoadingState } from "@/components/ui/LoadingState";
import { SparklineCard } from "@/components/data/SparklineCard";

export interface MarketIndexQuote {
  name: string;
  ticker: string;
  instrument_type?: string;
  last_close: number | null;
  delta: {
    delta_pct: number;
    delta_abs?: number | null;
  };
  sparkline: number[];
  period?: string | null;
}

interface MarketHistoryBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TechnicalIndicators {
  ticker: string;
  rsi_14: number | null;
  macd: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  bb_upper: number | null;
  bb_mid: number | null;
  bb_lower: number | null;
  ma_20: number | null;
  ma_50: number | null;
  ma_200: number | null;
  as_of_date: string | null;
}

interface MarketVolumeSummary {
  latest_volume: number | null;
  average_20d_volume: number | null;
  average_60d_volume: number | null;
  volume_vs_20d_pct: number | null;
  as_of_date: string | null;
}

interface MarketDataQuality {
  source: string;
  freshness_status: string;
  used_live_refresh: boolean;
  used_stale_cache_fallback: boolean;
  requested_period: string;
  last_updated: string | null;
  latest_trading_date: string | null;
  detail_note: string;
}

interface MarketRegimeContext {
  regime_label: string;
  regime_summary: string;
  equity_advancers: number;
  equity_decliners: number;
  breadth_ratio: number | null;
  equity_index_count: number;
  risk_on_signals: number;
  risk_off_signals: number;
  signal_count: number;
}

interface MarketIndexDetail {
  name: string;
  ticker: string;
  instrument_type: string;
  unit_label: string | null;
  base_asset: string | null;
  quote_asset: string | null;
  period: string;
  as_of_date: string | null;
  last_close: number | null;
  daily_history: MarketHistoryBar[];
  monthly_history: MarketHistoryBar[];
  daily_indicators: TechnicalIndicators;
  monthly_indicators: TechnicalIndicators;
  volume_summary: MarketVolumeSummary;
  data_quality: MarketDataQuality;
  market_regime: MarketRegimeContext | null;
}

type InstrumentType = "index" | "commodity" | "fx" | "crypto";

function formatNumber(value: number | null | undefined, fractionDigits = 1) {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function formatSignedNumber(value: number | null | undefined, fractionDigits = 1) {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${value >= 0 ? "+" : ""}${formatNumber(value, fractionDigits)}`;
}

function formatInteger(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return Math.round(value).toLocaleString();
}

function summarizeTrend(data: number[]) {
  if (data.length < 2) {
    return { direction: "flat", changePct: null as number | null };
  }
  const start = data[0];
  const end = data[data.length - 1];
  if (!start) {
    return { direction: "flat", changePct: null as number | null };
  }
  const changePct = ((end - start) / start) * 100;
  return {
    direction: changePct > 0 ? "up" : changePct < 0 ? "down" : "flat",
    changePct,
  };
}

function instrumentLabel(instrumentType: string | undefined) {
  if (instrumentType === "commodity") return "Commodity";
  if (instrumentType === "fx") return "FX";
  if (instrumentType === "crypto") return "Crypto";
  return "Index";
}

function normalizeInstrumentType(instrumentType: string | undefined): InstrumentType {
  if (instrumentType === "commodity" || instrumentType === "fx" || instrumentType === "crypto") {
    return instrumentType;
  }
  return "index";
}

function buildInstrumentContext(detail: MarketIndexDetail | undefined, deltaPct: number) {
  const instrumentType = detail?.instrument_type ?? "index";
  if (instrumentType === "commodity") {
    return {
      title: "Commodity Context",
      description: "Commodity detail should emphasize units, inflation sensitivity, and growth-cycle interpretation rather than equity-market breadth language.",
      bullets: [
        `Unit framing: ${detail?.unit_label ?? "Commodity price units"} matter more than stock-style benchmark framing.`,
        deltaPct >= 0 ? "Directional move: price pressure is rising in the current snapshot." : "Directional move: price pressure is easing in the current snapshot.",
        "Interpretation: read this alongside inflation, growth, and supply-shock context before mapping it into portfolio implications.",
        "Daily first, monthly second: use daily indicators for tactical moves and monthly indicators for regime shifts in the commodity cycle.",
      ],
    };
  }
  if (instrumentType === "fx") {
    const pairLabel = detail?.base_asset && detail?.quote_asset ? `${detail.base_asset}/${detail.quote_asset}` : "FX pair";
    return {
      title: "FX Context",
      description: "FX detail should focus on pair interpretation, local-currency translation, and macro rate sensitivity rather than stock-market breadth.",
      bullets: [
        `Pair framing: ${pairLabel} reads as quote-currency value per base-currency unit.`,
        deltaPct >= 0 ? `${pairLabel} is strengthening in the current snapshot.` : `${pairLabel} is weakening in the current snapshot.`,
        "Interpretation: connect the move to rate differentials, dollar strength, and imported-inflation pressure before treating it as a generic risk-on signal.",
        "Daily first, monthly second: daily indicators help with tactical momentum while monthly indicators show persistent currency regime shifts.",
      ],
    };
  }
  if (instrumentType === "crypto") {
    return {
      title: "Crypto Context",
      description: "Crypto detail should emphasize volatility regime, liquidity sensitivity, and stronger caution around stale or partial data.",
      bullets: [
        `Unit framing: ${detail?.unit_label ?? "Crypto quote units"} can move with outsized volatility relative to traditional macro assets.`,
        deltaPct >= 0 ? "Directional move: speculative appetite is strengthening in the current snapshot." : "Directional move: speculative appetite is softening in the current snapshot.",
        "Interpretation: crypto moves can overshoot macro narratives, so compare this with portfolio risk appetite rather than reading it like a broad equity index.",
        "Daily first, monthly second: daily indicators help with volatility bursts while monthly indicators better frame cycle durability.",
      ],
    };
  }
  return {
    title: "Index Context",
    description: "Use this view the same way Portfolio uses stock detail: start from the overview grid, then open an item when you need to inspect the move in more depth.",
    bullets: [
      "Broad-market reference: suitable for comparing portfolio return versus market regime.",
      deltaPct >= 0 ? "Directional move: risk-on bias in the current snapshot." : "Directional move: risk-off pressure in the current snapshot.",
      "Interpretation: combine with Portfolio attribution before treating the day move as stock-picking skill.",
      "Daily first, monthly second: use daily indicators for tactical inspection and monthly indicators for regime-level confirmation.",
    ],
  };
}

const MARKET_MOVING_AVERAGE_WINDOWS = [20, 50, 200] as const;
const MARKET_MOVING_AVERAGE_COLORS: Record<(typeof MARKET_MOVING_AVERAGE_WINDOWS)[number], string> = {
  20: "#F97316",
  50: "#10B981",
  200: "#3B82F6",
};

function buildMovingAverageSeries(data: RawOHLCV[], windowSize: (typeof MARKET_MOVING_AVERAGE_WINDOWS)[number]) {
  const sorted = [...data].sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
  return sorted.flatMap((bar, index) => {
    if (index + 1 < windowSize) return [];
    const slice = sorted.slice(index + 1 - windowSize, index + 1);
    const average = slice.reduce((sum, item) => sum + item.close, 0) / slice.length;
    return [{ time: bar.date, value: average }];
  });
}

function buildIndicatorSection(
  instrumentType: InstrumentType,
  timeframe: "daily" | "monthly",
  indicators: TechnicalIndicators,
) {
  const windowSuffix = timeframe === "daily" ? "D" : "M";
  const timeframeLabel = timeframe === "daily" ? "Daily" : "Monthly";

  if (instrumentType === "commodity") {
    return {
      title: `${timeframeLabel} Commodity Signals`,
      description:
        timeframe === "daily"
          ? "Commodity panels emphasize momentum, price-range pressure, and rolling trend anchors rather than stock-style benchmark wording."
          : "Monthly commodity signals help distinguish shorter inflation shocks from more persistent supply-and-demand cycle shifts.",
      rows: [
        { label: "RSI-14", value: indicators.rsi_14 },
        { label: "Trend Spread", value: indicators.macd },
        { label: "Trend Signal", value: indicators.macd_signal },
        { label: "Trend Histogram", value: indicators.macd_hist },
        { label: "Upper Range Band", value: indicators.bb_upper },
        { label: "Mid Range Band", value: indicators.bb_mid },
        { label: "Lower Range Band", value: indicators.bb_lower },
        { label: `Trend Avg ${20}${windowSuffix}`, value: indicators.ma_20 },
        { label: `Trend Avg ${50}${windowSuffix}`, value: indicators.ma_50 },
        { label: `Trend Avg ${200}${windowSuffix}`, value: indicators.ma_200 },
      ],
    };
  }

  if (instrumentType === "fx") {
    return {
      title: `${timeframeLabel} FX Signals`,
      description:
        timeframe === "daily"
          ? "FX panels frame the same technical inputs as pair momentum, trading range, and currency translation pressure."
          : "Monthly FX signals are better for regime shifts in rate differentials and dollar strength than for short tactical noise.",
      rows: [
        { label: "RSI-14", value: indicators.rsi_14 },
        { label: "Pair Momentum", value: indicators.macd },
        { label: "Pair Signal", value: indicators.macd_signal },
        { label: "Momentum Gap", value: indicators.macd_hist },
        { label: "Upper Pair Range", value: indicators.bb_upper },
        { label: "Mid Pair Range", value: indicators.bb_mid },
        { label: "Lower Pair Range", value: indicators.bb_lower },
        { label: `${20}${windowSuffix} Pair Average`, value: indicators.ma_20 },
        { label: `${50}${windowSuffix} Pair Average`, value: indicators.ma_50 },
        { label: `${200}${windowSuffix} Pair Average`, value: indicators.ma_200 },
      ],
    };
  }

  if (instrumentType === "crypto") {
    return {
      title: `${timeframeLabel} Crypto Signals`,
      description:
        timeframe === "daily"
          ? "Crypto panels emphasize volatility, momentum bursts, and liquidity-sensitive swings using the same backend indicator set."
          : "Monthly crypto signals help separate short squeezes from broader cycle persistence and drawdown recovery.",
      rows: [
        { label: "RSI-14", value: indicators.rsi_14 },
        { label: "Momentum Spread", value: indicators.macd },
        { label: "Momentum Signal", value: indicators.macd_signal },
        { label: "Momentum Histogram", value: indicators.macd_hist },
        { label: "Upper Volatility Band", value: indicators.bb_upper },
        { label: "Mid Volatility Band", value: indicators.bb_mid },
        { label: "Lower Volatility Band", value: indicators.bb_lower },
        { label: `${20}${windowSuffix} Cycle Average`, value: indicators.ma_20 },
        { label: `${50}${windowSuffix} Cycle Average`, value: indicators.ma_50 },
        { label: `${200}${windowSuffix} Cycle Average`, value: indicators.ma_200 },
      ],
    };
  }

  return {
    title: `${timeframeLabel} Indicators`,
    description:
      timeframe === "daily"
        ? "Calculated from daily closes so the market modal can be read the same way as a portfolio holding drill-down."
        : "Calculated from monthly closes so regime-level confirmation is separated from day-to-day market noise.",
    rows: [
      { label: "RSI-14", value: indicators.rsi_14 },
      { label: "MACD", value: indicators.macd },
      { label: "MACD Signal", value: indicators.macd_signal },
      { label: "MACD Hist", value: indicators.macd_hist },
      { label: "Bollinger Upper", value: indicators.bb_upper },
      { label: "Bollinger Mid", value: indicators.bb_mid },
      { label: "Bollinger Lower", value: indicators.bb_lower },
      { label: "MA 20", value: indicators.ma_20 },
      { label: "MA 50", value: indicators.ma_50 },
      { label: "MA 200", value: indicators.ma_200 },
    ],
  };
}

function IndicatorGrid({
  instrumentType,
  timeframe,
  indicators,
}: {
  instrumentType: InstrumentType;
  timeframe: "daily" | "monthly";
  indicators: TechnicalIndicators;
}) {
  const section = buildIndicatorSection(instrumentType, timeframe, indicators);

  return (
    <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-[var(--text-primary)]">{section.title}</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{section.description}</p>
        </div>
        <div className="text-xs text-[var(--text-muted)]">
          As of <span className="font-semibold text-[var(--text-primary)]">{indicators.as_of_date ?? "N/A"}</span>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {section.rows.map((row) => (
          <div key={row.label} className="rounded-[var(--radius)] border border-[var(--border)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{row.label}</p>
            <p className="mt-2 text-lg font-bold tabular-nums text-[var(--text-primary)]">{formatNumber(row.value, 2)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function MarketDetailModal({ item, onClose }: { item: MarketIndexQuote; onClose: () => void }) {
  const trendSummary = useMemo(() => summarizeTrend(item.sparkline), [item.sparkline]);
  const chartColor = (item.delta.delta_pct ?? 0) >= 0 ? "var(--delta-up)" : "var(--delta-down)";
  const [chartTimeframe, setChartTimeframe] = useState<"daily" | "monthly">("daily");
  const detailQuery = useQuery<MarketIndexDetail>({
    queryKey: ["market-index-detail", item.ticker],
    queryFn: () =>
      fetchApi<MarketIndexDetail>(`/market/index/${encodeURIComponent(item.ticker)}/detail`, {
        params: { period: item.period ?? "5y" },
      }),
    staleTime: 1000 * 60,
  });
  const detail = detailQuery.data;
  const chartBars = useMemo<RawOHLCV[]>(
    () => (chartTimeframe === "monthly" ? detail?.monthly_history ?? [] : detail?.daily_history ?? []),
    [chartTimeframe, detail?.daily_history, detail?.monthly_history],
  );
  const candles = useMemo(() => transformToTVCandles(chartBars), [chartBars]);
  const volume = useMemo(() => transformToTVVolume(chartBars), [chartBars]);
  const movingAverageSeries = useMemo(
    () =>
      MARKET_MOVING_AVERAGE_WINDOWS.map((windowSize) => ({
        title: `${windowSize}${chartTimeframe === "monthly" ? "M" : "D"} MA`,
        color: MARKET_MOVING_AVERAGE_COLORS[windowSize],
        data: buildMovingAverageSeries(chartBars, windowSize),
      })),
    [chartBars, chartTimeframe],
  );
  const volumeSummary = detail?.volume_summary ?? null;
  const normalizedInstrumentType = normalizeInstrumentType(detail?.instrument_type ?? item.instrument_type);
  const contextBlock = useMemo(() => buildInstrumentContext(detail, item.delta.delta_pct ?? 0), [detail, item.delta.delta_pct]);
  const warningMessages = useMemo(() => {
    if (!detail) return [];
    const warnings: string[] = [];
    if (detail.data_quality.freshness_status === "stale_cache" || detail.data_quality.used_stale_cache_fallback) {
      warnings.push("This market detail is using stale cached history because a live refresh was unavailable.");
    }
    if (detail.data_quality.used_live_refresh) {
      warnings.push("This market detail required a live refresh because the stored history did not pass freshness or coverage checks.");
    }
    if (detail.monthly_history.length === 0) {
      warnings.push("Monthly history is not available for this instrument yet, so the monthly chart and indicators are incomplete.");
    }
    if (detail.instrument_type === "fx" && (volumeSummary?.latest_volume ?? 0) <= 0) {
      warnings.push("Daily volume is not provided for this FX pair, so volume metrics are intentionally shown as unavailable.");
    }
    return warnings;
  }, [detail, volumeSummary?.latest_volume]);

  // Escape key and scroll-lock are handled by ModalShell.

  const modalSubtitle = `${item.ticker} · ${instrumentLabel(detail?.instrument_type ?? item.instrument_type)}${detail?.unit_label ? ` · ${detail.unit_label}` : ""}`;

  return (
    <ModalShell
      open
      onClose={onClose}
      title={item.name}
      subtitle={modalSubtitle}
      size="xl"
    >
      <div className="space-y-5">
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Quick market detail</h3>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                Stay in the overview workflow here, or open the canonical detail route for a standalone deep-dive view.
              </p>
            </div>
            <Link
              href={`/detail/${encodeURIComponent(item.ticker)}`}
              className="inline-flex min-h-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)] px-[var(--space-4)] text-[length:var(--type-label)] font-medium text-[var(--text-primary)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-info)] focus-visible:ring-offset-1"
            >
              View Full Detail
            </Link>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Current Value</p>
              <p className="mt-2 text-3xl font-black tabular-nums text-[var(--text-primary)]">{formatNumber(item.last_close)}</p>
            </div>
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Absolute Change</p>
              <p className={`mt-2 text-3xl font-black tabular-nums ${(item.delta.delta_abs ?? 0) >= 0 ? "text-[var(--delta-up)]" : "text-[var(--delta-down)]"}`}>
                {formatSignedNumber(item.delta.delta_abs)}
              </p>
            </div>
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Percent Change</p>
              <div className="mt-3">
                <DeltaBadge value={item.delta.delta_pct} />
              </div>
            </div>
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Observed Trend</p>
              <p className="mt-2 text-lg font-bold text-[var(--text-primary)]">
                {trendSummary.direction === "up" ? "Uptrend" : trendSummary.direction === "down" ? "Downtrend" : "Flat trend"}
              </p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {trendSummary.changePct == null ? "Not enough history in the current payload." : `${formatSignedNumber(trendSummary.changePct)}% over the visible sparkline range`}
              </p>
            </div>
          </section>

          {detailQuery.isLoading && (
            <Card><LoadingState variant="skeleton" label="Loading indicator detail..." /></Card>
          )}

          {detailQuery.isError && (
            <Card>
              <ErrorState
                title="Market Detail Unavailable"
                message="The market overview loaded, but the expanded detail request failed for this instrument."
              />
            </Card>
          )}

          {warningMessages.length > 0 ? (
            <section className="rounded-[var(--radius)] border border-amber-300 bg-amber-50 p-4">
              <h3 className="text-lg font-bold text-amber-950">Detail Warnings</h3>
              <div className="mt-3 space-y-2 text-sm text-amber-950">
                {warningMessages.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            </section>
          ) : null}

          <section className="grid gap-5 lg:grid-cols-[1.7fr_1fr]">
            <div className="space-y-5">
              <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-bold text-[var(--text-primary)]">OHLCV Chart</h3>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                      Candlesticks, volume, and moving averages use the same chart stack as the Portfolio stock modal, with daily and monthly review modes.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <div className="inline-flex rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-1 text-xs">
                      <button
                        type="button"
                        onClick={() => setChartTimeframe("daily")}
                        className={`rounded-[calc(var(--radius)-4px)] px-3 py-1 font-semibold ${chartTimeframe === "daily" ? "bg-[var(--bg-surface)] text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}
                      >
                        Daily
                      </button>
                      <button
                        type="button"
                        onClick={() => setChartTimeframe("monthly")}
                        className={`rounded-[calc(var(--radius)-4px)] px-3 py-1 font-semibold ${chartTimeframe === "monthly" ? "bg-[var(--bg-surface)] text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}
                      >
                        Monthly
                      </button>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
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
                <div className="mt-4 rounded-[var(--radius)] border border-[var(--border)]/60 bg-[var(--surface-muted)] p-2">
                  {candles.length > 0 ? (
                    <TVChart
                      data={candles}
                      volumeData={volume}
                      lineSeriesData={movingAverageSeries}
                      height={420}
                      tickerName={`${item.name} ${chartTimeframe}`}
                      colorAccent={chartColor}
                    />
                  ) : (
                    <div className="flex h-[420px] items-center justify-center text-sm text-[var(--text-muted)]">
                      No OHLCV history available for the selected timeframe.
                    </div>
                  )}
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[var(--radius)] border border-[var(--border)] p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Timeframe</p>
                    <p className="mt-2 text-lg font-bold text-[var(--text-primary)]">{chartTimeframe === "daily" ? "Daily bars" : "Monthly bars"}</p>
                  </div>
                  <div className="rounded-[var(--radius)] border border-[var(--border)] p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Points</p>
                    <p className="mt-2 text-lg font-bold text-[var(--text-primary)]">{chartBars.length}</p>
                  </div>
                  <div className="rounded-[var(--radius)] border border-[var(--border)] p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Requested Window</p>
                    <p className="mt-2 text-lg font-bold text-[var(--text-primary)]">{detail?.period ?? item.period ?? "5y"}</p>
                  </div>
                </div>
              </section>

              {detail ? <IndicatorGrid instrumentType={normalizedInstrumentType} timeframe="daily" indicators={detail.daily_indicators} /> : null}
              {detail ? <IndicatorGrid instrumentType={normalizedInstrumentType} timeframe="monthly" indicators={detail.monthly_indicators} /> : null}
            </div>

            <div className="space-y-5">
              <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                <h3 className="text-lg font-bold text-[var(--text-primary)]">Daily Volume</h3>
                <p className="mt-2 text-sm text-[var(--text-muted)]">
                  Volume is shown on the daily series only. Monthly context remains price-first to avoid hiding turnover spikes inside long aggregates.
                </p>
                <div className="mt-4 grid gap-3">
                  <div className="rounded-[var(--radius)] border border-[var(--border)] p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Latest Volume</p>
                    <p className="mt-2 text-lg font-bold tabular-nums text-[var(--text-primary)]">{formatInteger(volumeSummary?.latest_volume)}</p>
                  </div>
                  <div className="rounded-[var(--radius)] border border-[var(--border)] p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">20D Avg Volume</p>
                    <p className="mt-2 text-lg font-bold tabular-nums text-[var(--text-primary)]">{formatInteger(volumeSummary?.average_20d_volume)}</p>
                  </div>
                  <div className="rounded-[var(--radius)] border border-[var(--border)] p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">60D Avg Volume</p>
                    <p className="mt-2 text-lg font-bold tabular-nums text-[var(--text-primary)]">{formatInteger(volumeSummary?.average_60d_volume)}</p>
                  </div>
                  <div className="rounded-[var(--radius)] border border-[var(--border)] p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Vs 20D Avg</p>
                    <p className={`mt-2 text-lg font-bold tabular-nums ${(volumeSummary?.volume_vs_20d_pct ?? 0) >= 0 ? "text-[var(--delta-up)]" : "text-[var(--delta-down)]"}`}>
                      {formatSignedNumber(volumeSummary?.volume_vs_20d_pct, 2)}%
                    </p>
                  </div>
                </div>
              </section>

              <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                <h3 className="text-lg font-bold text-[var(--text-primary)]">{contextBlock.title}</h3>
                <p className="mt-2 text-sm text-[var(--text-muted)]">{contextBlock.description}</p>
                {detail?.instrument_type === "index" && detail.market_regime ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[var(--radius)] border border-[var(--border)] p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Regime</p>
                      <p className="mt-2 text-lg font-bold text-[var(--text-primary)]">{detail.market_regime.regime_label.replaceAll("_", " ")}</p>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">{detail.market_regime.regime_summary}</p>
                    </div>
                    <div className="rounded-[var(--radius)] border border-[var(--border)] p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Breadth</p>
                      <p className="mt-2 text-lg font-bold text-[var(--text-primary)]">
                        {detail.market_regime.equity_advancers}/{detail.market_regime.equity_index_count} advancers
                      </p>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">
                        Breadth ratio: {detail.market_regime.breadth_ratio == null ? "N/A" : formatNumber(detail.market_regime.breadth_ratio * 100, 0)}%
                      </p>
                    </div>
                    <div className="rounded-[var(--radius)] border border-[var(--border)] p-3 sm:col-span-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Cross-Asset Signals</p>
                      <p className="mt-2 text-lg font-bold text-[var(--text-primary)]">
                        {detail.market_regime.risk_on_signals} risk-on / {detail.market_regime.risk_off_signals} risk-off
                      </p>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">
                        Derived from tracked equities, gold, USD/KRW, and bitcoin so index detail has a broader regime read than price-only direction.
                      </p>
                    </div>
                  </div>
                ) : null}
                <ul className="mt-3 space-y-2 text-sm text-[var(--text-primary)]">
                  {contextBlock.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </section>

              <section className="rounded-[var(--radius)] border border-amber-300 bg-amber-50 p-4">
                <h3 className="text-lg font-bold text-amber-950">Data Quality</h3>
                <div className="mt-3 space-y-3 text-sm text-amber-950">
                  <div>
                    <p className="font-semibold">Source</p>
                    <p>{detail?.data_quality.source ?? "N/A"}</p>
                  </div>
                  <div>
                    <p className="font-semibold">Last updated</p>
                    <p>{detail?.data_quality.last_updated ?? "N/A"}</p>
                  </div>
                  <div>
                    <p className="font-semibold">Latest trading date</p>
                    <p>{detail?.data_quality.latest_trading_date ?? detail?.as_of_date ?? "N/A"}</p>
                  </div>
                  <div>
                    <p className="font-semibold">Freshness</p>
                    <p>{detail?.data_quality.freshness_status ?? "unknown"}</p>
                  </div>
                  <div>
                    <p className="font-semibold">Coverage</p>
                    <p>Daily volume, daily indicators, and monthly indicators are loaded on demand when you open the modal.</p>
                  </div>
                  <div>
                    <p className="font-semibold">Fallback note</p>
                    <p>{detail?.data_quality.detail_note ?? "No detail note available."}</p>
                  </div>
                </div>
              </section>
            </div>
          </section>
      </div>
    </ModalShell>
  );
}

export function MarketOverviewClient({
  indices,
  fetchError = null,
}: {
  indices: MarketIndexQuote[];
  fetchError?: string | null;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("chart");
  const [selectedIndex, setSelectedIndex] = useState<MarketIndexQuote | null>(null);

  if (fetchError) {
    return (
      <ErrorState
        title="Market Overview Unavailable"
        message={fetchError}
      />
    );
  }

  if (indices.length === 0) {
    return (
      <EmptyState
        title="No market data available"
        description="Ensure the FastAPI backend is running and discoverable."
      />
    );
  }

  return (
    <>
      <section className="space-y-4">
        <Card>
          <SectionHeader
            title="Market Dashboard"
            description="Scan the market in graph view, switch to table view for fast comparison, then open any item for a deeper read."
            actions={<ViewToggle value={viewMode} onChange={setViewMode} />}
          />
        </Card>

        {viewMode === "chart" ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {indices.map((idx) => (
              <SparklineCard
                key={idx.ticker}
                title={idx.name}
                ticker={idx.ticker}
                value={idx.last_close == null ? "N/A" : formatNumber(idx.last_close)}
                deltaPct={idx.delta.delta_pct}
                sparkline={idx.sparkline}
                periodLabel={idx.period}
                onOpen={() => setSelectedIndex(idx)}
              />
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)]">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-[var(--border)] text-sm">
                <thead className="bg-[var(--surface-muted)]">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-[var(--text-muted)]">Instrument</th>
                    <th className="px-4 py-3 text-right font-semibold text-[var(--text-muted)]">Current</th>
                    <th className="px-4 py-3 text-right font-semibold text-[var(--text-muted)]">Abs Change</th>
                    <th className="px-4 py-3 text-right font-semibold text-[var(--text-muted)]">Pct Change</th>
                    <th className="px-4 py-3 text-left font-semibold text-[var(--text-muted)]">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {indices.map((idx) => (
                    <tr key={idx.ticker} className="hover:bg-[var(--surface-muted)]/60">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setSelectedIndex(idx)}
                          className="text-left"
                          aria-label={`Open detail for ${idx.name} from table`}
                        >
                          <div className="font-semibold text-[var(--text-primary)]">{idx.name}</div>
                          <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{idx.ticker}</div>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-[var(--text-primary)]">{formatNumber(idx.last_close)}</td>
                      <td className={`px-4 py-3 text-right font-semibold tabular-nums ${(idx.delta.delta_abs ?? 0) >= 0 ? "text-[var(--delta-up)]" : "text-[var(--delta-down)]"}`}>
                        {formatSignedNumber(idx.delta.delta_abs)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DeltaBadge value={idx.delta.delta_pct} className="justify-end" />
                      </td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">Market snapshot API</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {selectedIndex ? <MarketDetailModal item={selectedIndex} onClose={() => setSelectedIndex(null)} /> : null}
    </>
  );
}
