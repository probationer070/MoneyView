"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { fetchApi } from "@/lib/api";
import { useDevMonitorPageLoad } from "@/hooks/useDevMonitorPageLoad";
import TVChart from "@/components/charts/TVChart";
import { EventFilter } from "@/components/charts/EventFilter";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { type ViewMode } from "@/components/ui/ViewToggle";
import { SEGMENT_BUTTON, SEGMENT_CONTAINER, SEGMENT_SELECTED, SEGMENT_UNSELECTED } from "@/components/ui/ToggleGroup";
import { type RawOHLCV, transformToTVCandles, transformToTVVolume } from "@/lib/transformers";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { ModalShell } from "@/components/ui/ModalShell";
import { LoadingState } from "@/components/ui/LoadingState";
import { InstrumentsPanel } from "@/components/market/InstrumentsPanel";
import { SpreadsSection } from "@/components/market/SpreadsSection";
import { MarketHeader } from "@/components/market/MarketHeader";
import { SignalStrip } from "@/components/risk/SignalStrip";
import { MarketPageTabs, useMarketPageTab } from "@/components/market/MarketPageTabs";
import { TONE_CLASS } from "@/components/market/MarketRegimeLine";
import { FigureText } from "@/components/market/FigureText";
import { useMarketEvents } from "@/lib/useMarketEvents";
import { formatNumber, MISSING } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/i18n/translate";
import { tokens } from "@/lib/tokens.generated";
import type { MarketRegimeContext } from "../../../../packages/shared-types";
import { instrumentNameKey, instrumentValueText, regimeView, withFigures, type MarketIndexQuote } from "@/components/market/marketModel";

export type { MarketIndexQuote };

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

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

type InstrumentType = "index" | "commodity" | "fx" | "crypto" | "sector" | "rate";

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

function instrumentLabel(instrumentType: string | undefined, t: Translate) {
  if (instrumentType === "commodity") return t("market.detail.instrument.commodity");
  if (instrumentType === "fx") return t("market.detail.instrument.fx");
  if (instrumentType === "crypto") return t("market.detail.instrument.crypto");
  if (instrumentType === "sector") return t("market.detail.instrument.sector");
  if (instrumentType === "rate") return t("market.detail.instrument.rate");
  return t("market.detail.instrument.index");
}

function normalizeInstrumentType(instrumentType: string | undefined): InstrumentType {
  if (
    instrumentType === "commodity" ||
    instrumentType === "fx" ||
    instrumentType === "crypto" ||
    instrumentType === "sector" ||
    instrumentType === "rate"
  ) {
    return instrumentType;
  }
  return "index";
}

function buildInstrumentContext(detail: MarketIndexDetail | undefined, ticker: string, deltaPct: number, t: Translate) {
  const instrumentType = detail?.instrument_type ?? "index";
  const rising = deltaPct >= 0;
  if (instrumentType === "commodity") {
    return {
      title: t("market.detail.context.commodity.title"),
      description: t("market.detail.context.commodity.description"),
      bullets: [
        t("market.detail.context.commodity.unit", { unit: detail?.unit_label ?? t("market.detail.context.commodity.unitFallback") }),
        rising ? t("market.detail.context.commodity.up") : t("market.detail.context.commodity.down"),
        t("market.detail.context.commodity.interpretation"),
        t("market.detail.context.commodity.daily"),
      ],
    };
  }
  if (instrumentType === "fx") {
    const pairLabel = detail?.base_asset && detail?.quote_asset ? `${detail.base_asset}/${detail.quote_asset}` : t("market.detail.context.fx.pairFallback");
    return {
      title: t("market.detail.context.fx.title"),
      description: t("market.detail.context.fx.description"),
      bullets: [
        t("market.detail.context.fx.pair", { pair: pairLabel }),
        rising ? t("market.detail.context.fx.up", { pair: pairLabel }) : t("market.detail.context.fx.down", { pair: pairLabel }),
        t("market.detail.context.fx.interpretation"),
        t("market.detail.context.fx.daily"),
      ],
    };
  }
  if (instrumentType === "crypto") {
    return {
      title: t("market.detail.context.crypto.title"),
      description: t("market.detail.context.crypto.description"),
      bullets: [
        t("market.detail.context.crypto.unit", { unit: detail?.unit_label ?? t("market.detail.context.crypto.unitFallback") }),
        rising ? t("market.detail.context.crypto.up") : t("market.detail.context.crypto.down"),
        t("market.detail.context.crypto.interpretation"),
        t("market.detail.context.crypto.daily"),
      ],
    };
  }
  if (instrumentType === "sector") {
    return {
      title: t("market.detail.context.sector.title"),
      description: t("market.detail.context.sector.description"),
      bullets: [
        t("market.detail.context.sector.proxy", { ticker }),
        rising ? t("market.detail.context.sector.up") : t("market.detail.context.sector.down"),
        t("market.detail.context.sector.interpretation"),
        t("market.detail.context.index.daily"),
      ],
    };
  }
  if (instrumentType === "rate") {
    // Three bullets, not four: rate.description is already the card description, and repeating it as a bullet would show the same sentence twice.
    return {
      title: t("market.detail.context.rate.title"),
      description: t("market.detail.context.rate.description"),
      bullets: [
        t("market.detail.context.rate.reference"),
        rising ? t("market.detail.context.rate.up") : t("market.detail.context.rate.down"),
        t("market.detail.context.index.daily"),
      ],
    };
  }
  return {
    title: t("market.detail.context.index.title"),
    description: t("market.detail.context.index.description"),
    bullets: [
      t("market.detail.context.index.reference"),
      rising ? t("market.detail.context.index.up") : t("market.detail.context.index.down"),
      t("market.detail.context.index.interpretation"),
      t("market.detail.context.index.daily"),
    ],
  };
}

const MARKET_MOVING_AVERAGE_WINDOWS = [20, 50, 200] as const;
// The three average lines take the chart palette in order (DESIGN.md: chart-1 is the subject).
const MARKET_MOVING_AVERAGE_COLORS: Record<(typeof MARKET_MOVING_AVERAGE_WINDOWS)[number], string> = {
  20: tokens.chart["1"],
  50: tokens.chart["2"],
  200: tokens.chart["3"],
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

interface IndicatorKeys {
  title: MessageKey;
  descDaily: MessageKey;
  descMonthly: MessageKey;
  macd: MessageKey;
  macdSignal: MessageKey;
  macdHist: MessageKey;
  bbUpper: MessageKey;
  bbMid: MessageKey;
  bbLower: MessageKey;
  /** The 20, 50 and 200 labels; the three non-index types use one {window} template for all three. */
  ma: [MessageKey, MessageKey, MessageKey];
}

const INDEX_INDICATOR_KEYS = {
  title: "market.detail.indicators.index.title",
  descDaily: "market.detail.indicators.index.descDaily",
  descMonthly: "market.detail.indicators.index.descMonthly",
  macd: "market.detail.indicators.index.macd",
  macdSignal: "market.detail.indicators.index.macdSignal",
  macdHist: "market.detail.indicators.index.macdHist",
  bbUpper: "market.detail.indicators.index.bbUpper",
  bbMid: "market.detail.indicators.index.bbMid",
  bbLower: "market.detail.indicators.index.bbLower",
  ma: ["market.detail.indicators.index.ma20", "market.detail.indicators.index.ma50", "market.detail.indicators.index.ma200"],
} as const satisfies IndicatorKeys;

const INDICATOR_KEYS = {
  index: INDEX_INDICATOR_KEYS,
  sector: INDEX_INDICATOR_KEYS,
  rate: INDEX_INDICATOR_KEYS,
  commodity: {
    title: "market.detail.indicators.commodity.title",
    descDaily: "market.detail.indicators.commodity.descDaily",
    descMonthly: "market.detail.indicators.commodity.descMonthly",
    macd: "market.detail.indicators.commodity.macd",
    macdSignal: "market.detail.indicators.commodity.macdSignal",
    macdHist: "market.detail.indicators.commodity.macdHist",
    bbUpper: "market.detail.indicators.commodity.bbUpper",
    bbMid: "market.detail.indicators.commodity.bbMid",
    bbLower: "market.detail.indicators.commodity.bbLower",
    ma: ["market.detail.indicators.commodity.ma", "market.detail.indicators.commodity.ma", "market.detail.indicators.commodity.ma"],
  },
  fx: {
    title: "market.detail.indicators.fx.title",
    descDaily: "market.detail.indicators.fx.descDaily",
    descMonthly: "market.detail.indicators.fx.descMonthly",
    macd: "market.detail.indicators.fx.macd",
    macdSignal: "market.detail.indicators.fx.macdSignal",
    macdHist: "market.detail.indicators.fx.macdHist",
    bbUpper: "market.detail.indicators.fx.bbUpper",
    bbMid: "market.detail.indicators.fx.bbMid",
    bbLower: "market.detail.indicators.fx.bbLower",
    ma: ["market.detail.indicators.fx.ma", "market.detail.indicators.fx.ma", "market.detail.indicators.fx.ma"],
  },
  crypto: {
    title: "market.detail.indicators.crypto.title",
    descDaily: "market.detail.indicators.crypto.descDaily",
    descMonthly: "market.detail.indicators.crypto.descMonthly",
    macd: "market.detail.indicators.crypto.macd",
    macdSignal: "market.detail.indicators.crypto.macdSignal",
    macdHist: "market.detail.indicators.crypto.macdHist",
    bbUpper: "market.detail.indicators.crypto.bbUpper",
    bbMid: "market.detail.indicators.crypto.bbMid",
    bbLower: "market.detail.indicators.crypto.bbLower",
    ma: ["market.detail.indicators.crypto.ma", "market.detail.indicators.crypto.ma", "market.detail.indicators.crypto.ma"],
  },
} as const satisfies Record<InstrumentType, IndicatorKeys>;

/** "20D" or "50M" in English; the suffix comes from the catalog, so Korean reads "20일" or "50개월". */
function windowLabel(size: number, timeframe: "daily" | "monthly", t: Translate) {
  return `${size}${t(timeframe === "daily" ? "market.detail.windowDay" : "market.detail.windowMonth")}`;
}

function buildIndicatorSection(
  instrumentType: InstrumentType,
  timeframe: "daily" | "monthly",
  indicators: TechnicalIndicators,
  t: Translate,
) {
  const keys: IndicatorKeys = INDICATOR_KEYS[instrumentType];
  const ma = (index: 0 | 1 | 2, size: number) => t(keys.ma[index], { window: windowLabel(size, timeframe, t) });

  return {
    title: t(keys.title, { timeframe: t(timeframe === "daily" ? "market.detail.daily" : "market.detail.monthly") }),
    description: t(timeframe === "daily" ? keys.descDaily : keys.descMonthly),
    rows: [
      { label: t("market.detail.indicators.rsi"), value: indicators.rsi_14 },
      { label: t(keys.macd), value: indicators.macd },
      { label: t(keys.macdSignal), value: indicators.macd_signal },
      { label: t(keys.macdHist), value: indicators.macd_hist },
      { label: t(keys.bbUpper), value: indicators.bb_upper },
      { label: t(keys.bbMid), value: indicators.bb_mid },
      { label: t(keys.bbLower), value: indicators.bb_lower },
      { label: ma(0, 20), value: indicators.ma_20 },
      { label: ma(1, 50), value: indicators.ma_50 },
      { label: ma(2, 200), value: indicators.ma_200 },
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
  const t = useT();
  const { locale } = useLocale();
  const section = buildIndicatorSection(instrumentType, timeframe, indicators, t);

  return (
    <section className="border border-[var(--line)] bg-[var(--surface-raised)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="type-panel-title text-[var(--ink)]">{section.title}</h3>
          <p className="type-body mt-1 text-[var(--ink-muted)]">{section.description}</p>
        </div>
        <div className="type-small text-[var(--ink-muted)]">
          <FigureText parts={withFigures(t("market.detail.asOf"), { date: indicators.as_of_date ?? MISSING })} />
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {section.rows.map((row) => (
          <div key={row.label} className="border border-[var(--line)] p-3">
            <p className="type-caption uppercase text-[var(--ink-muted)]">{row.label}</p>
            <p className="type-mono mt-2 text-[var(--ink)]">{formatNumber(row.value, "price", { digits: 2, locale })}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// The regime sentence is the catalog's, keyed by the same label mapping as the header (plan N7).
const REGIME_SUMMARY_KEY = { up: "riskOn", neutral: "mixed", down: "riskOff" } as const;

function MarketDetailModal({ item, onClose }: { item: MarketIndexQuote; onClose: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const trendSummary = useMemo(() => summarizeTrend(item.sparkline), [item.sparkline]);
  const chartColor = (item.delta.delta_pct ?? 0) >= 0 ? "var(--up)" : "var(--down)";
  const [chartTimeframe, setChartTimeframe] = useState<"daily" | "monthly">("daily");
  const { lines: eventLines } = useMarketEvents();
  const detailQuery = useQuery<MarketIndexDetail>({
    queryKey: ["market-index-detail", item.ticker],
    queryFn: () =>
      fetchApi<MarketIndexDetail>(`/market/index/${encodeURIComponent(item.ticker)}/detail`, {
        params: { period: item.period ?? "5y" },
        monitor: {
          operation: "frontend.query.market_index_detail",
          component: "market_detail_modal",
          ticker: item.ticker,
        },
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
        title: t("market.detail.maLegend", { window: windowLabel(windowSize, chartTimeframe, t) }),
        color: MARKET_MOVING_AVERAGE_COLORS[windowSize],
        data: buildMovingAverageSeries(chartBars, windowSize),
      })),
    [chartBars, chartTimeframe, t],
  );
  const volumeSummary = detail?.volume_summary ?? null;
  const normalizedInstrumentType = normalizeInstrumentType(detail?.instrument_type ?? item.instrument_type);
  const contextBlock = useMemo(() => buildInstrumentContext(detail, item.ticker, item.delta.delta_pct ?? 0, t), [detail, item.ticker, item.delta.delta_pct, t]);
  const warningMessages = useMemo(() => {
    if (!detail) return [];
    const warnings: string[] = [];
    if (detail.data_quality.freshness_status === "stale_cache" || detail.data_quality.used_stale_cache_fallback) {
      warnings.push(t("market.detail.warnings.staleCache"));
    }
    if (detail.data_quality.used_live_refresh) {
      warnings.push(t("market.detail.warnings.liveRefresh"));
    }
    if (detail.monthly_history.length === 0) {
      warnings.push(t("market.detail.warnings.noMonthly"));
    }
    if (detail.instrument_type === "fx" && (volumeSummary?.latest_volume ?? 0) <= 0) {
      warnings.push(t("market.detail.warnings.fxVolume"));
    }
    if (detail.instrument_type === "rate" && (volumeSummary?.latest_volume ?? 0) <= 0) {
      warnings.push(t("market.detail.warnings.rateVolume"));
    }
    return warnings;
  }, [detail, volumeSummary?.latest_volume, t]);

  // The tile label and sentence follow the header's regime mapping; the backend's own sentence is not shown.
  const regime = detail?.instrument_type === "index" ? detail.market_regime : null;
  const regimeState = regimeView({ status: "ready", regime });

  // Escape key and scroll-lock are handled by ModalShell.

  const modalSubtitle = `${item.ticker} · ${instrumentLabel(detail?.instrument_type ?? item.instrument_type, t)}${detail?.unit_label ? ` · ${detail.unit_label}` : ""}`;
  const nameKey = instrumentNameKey(item.ticker);
  const displayName = nameKey === null ? item.name : t(nameKey);
  const integer = (value: number | null | undefined) => formatNumber(value, "integer", { locale });
  const volumeVsAverage = volumeSummary?.volume_vs_20d_pct;

  return (
    <ModalShell
      open
      onClose={onClose}
      title={displayName}
      subtitle={modalSubtitle}
      size="xl"
    >
      <div className="space-y-5">
          <section className="flex flex-wrap items-center justify-between gap-3 border border-[var(--line)] bg-[var(--surface-raised)] p-4">
            <div>
              <h3 className="type-label text-[var(--ink)]">{t("market.detail.quick")}</h3>
              <p className="type-body mt-1 text-[var(--ink-muted)]">
                {t("market.detail.quickBody")}
              </p>
            </div>
            <Link
              href={`/detail/${encodeURIComponent(item.ticker)}`}
              className="type-label inline-flex min-h-9 items-center justify-center rounded-[var(--radius-1)] border border-[var(--line)] px-[var(--space-4)] text-[var(--ink)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--surface)]"
            >
              {t("market.detail.viewFull")}
            </Link>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="border border-[var(--line)] bg-[var(--surface-raised)] p-4">
              <p className="type-caption uppercase text-[var(--ink-muted)]">{t("market.detail.currentValue")}</p>
              <p className="type-figure-md mt-2 text-[var(--ink)]">{instrumentValueText(item, locale)}</p>
            </div>
            <div className="border border-[var(--line)] bg-[var(--surface-raised)] p-4">
              <p className="type-caption uppercase text-[var(--ink-muted)]">{t("market.detail.absoluteChange")}</p>
              <p className={`type-figure-md mt-2 ${(item.delta.delta_abs ?? 0) >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}>
                {formatNumber(item.delta.delta_abs, "price", { digits: 1, signed: true, locale })}
              </p>
            </div>
            <div className="border border-[var(--line)] bg-[var(--surface-raised)] p-4">
              <p className="type-caption uppercase text-[var(--ink-muted)]">{t("market.detail.percentChange")}</p>
              <div className="mt-3">
                <DeltaBadge value={item.delta.delta_pct} />
              </div>
            </div>
            <div className="border border-[var(--line)] bg-[var(--surface-raised)] p-4">
              <p className="type-caption uppercase text-[var(--ink-muted)]">{t("market.detail.observedTrend")}</p>
              <p className="type-panel-title mt-2 text-[var(--ink)]">
                {trendSummary.direction === "up" ? t("market.detail.uptrend") : trendSummary.direction === "down" ? t("market.detail.downtrend") : t("market.detail.flatTrend")}
              </p>
              <p className="type-body mt-1 text-[var(--ink-muted)]">
                {trendSummary.changePct == null
                  ? t("market.detail.trendNoHistory")
                  : <FigureText parts={withFigures(t("market.detail.trendRange"), { change: formatNumber(trendSummary.changePct / 100, "percent", { signed: true, locale }) })} />}
              </p>
            </div>
          </section>

          {detailQuery.isLoading && (
            <Card><LoadingState variant="skeleton" label={t("market.detail.loadingIndicators")} /></Card>
          )}

          {detailQuery.isError && (
            <Card>
              <ErrorState
                title={t("market.detail.unavailableTitle")}
                message={t("market.detail.unavailableBody")}
              />
            </Card>
          )}

          {warningMessages.length > 0 ? (
            <section className="border border-[var(--status-warning-border)] bg-[var(--status-warning-surface)] p-4">
              <h3 className="type-panel-title text-[var(--status-warning-ink)]">{t("market.detail.warningsTitle")}</h3>
              <div className="type-body mt-3 space-y-2 text-[var(--status-warning-ink)]">
                {warningMessages.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            </section>
          ) : null}

          <section className="grid gap-5 lg:grid-cols-[1.7fr_1fr]">
            <div className="space-y-5">
              <section className="border border-[var(--line)] bg-[var(--surface-raised)] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="type-panel-title text-[var(--ink)]">{t("market.detail.chartTitle")}</h3>
                    <p className="type-body mt-1 text-[var(--ink-muted)]">
                      {t("market.detail.chartDescription")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <div className={SEGMENT_CONTAINER}>
                      <button
                        type="button"
                        onClick={() => setChartTimeframe("daily")}
                        className={clsx(SEGMENT_BUTTON, chartTimeframe === "daily" ? SEGMENT_SELECTED : SEGMENT_UNSELECTED)}
                      >
                        {t("market.detail.daily")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setChartTimeframe("monthly")}
                        className={clsx(SEGMENT_BUTTON, chartTimeframe === "monthly" ? SEGMENT_SELECTED : SEGMENT_UNSELECTED)}
                      >
                        {t("market.detail.monthly")}
                      </button>
                    </div>
                    <EventFilter testId="market-events-filter" />
                  </div>
                </div>
                <div className="type-caption mt-3 flex flex-wrap gap-2 text-[var(--ink-muted)]">
                  {movingAverageSeries.map((series) => (
                    <span
                      key={series.title}
                      className="inline-flex items-center gap-2 rounded-[var(--radius-2)] border border-[var(--line)] px-2 py-1"
                    >
                      {/* rounded-full: dot */}
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.color }} />
                      {series.title}
                    </span>
                  ))}
                </div>
                <div className="mt-4 border border-[var(--line)] bg-[var(--surface)] p-2">
                  {candles.length > 0 ? (
                    <TVChart
                      data={candles}
                      volumeData={volume}
                      lineSeriesData={movingAverageSeries}
                      height={420}
                      tickerName={`${displayName} ${chartTimeframe}`}
                      colorAccent={chartColor}
                      upColor="var(--up)"
                      events={eventLines}
                      eventGranularity={chartTimeframe === "monthly" ? "month" : "day"}
                    />
                  ) : (
                    <div className="type-body flex h-[420px] items-center justify-center text-[var(--ink-muted)]">
                      {t("market.detail.chartEmpty")}
                    </div>
                  )}
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="border border-[var(--line)] p-3">
                    <p className="type-caption uppercase text-[var(--ink-muted)]">{t("market.detail.timeframe")}</p>
                    <p className="type-panel-title mt-2 text-[var(--ink)]">{chartTimeframe === "daily" ? t("market.detail.dailyBars") : t("market.detail.monthlyBars")}</p>
                  </div>
                  <div className="border border-[var(--line)] p-3">
                    <p className="type-caption uppercase text-[var(--ink-muted)]">{t("market.detail.points")}</p>
                    <p className="type-mono mt-2 text-[var(--ink)]">{integer(chartBars.length)}</p>
                  </div>
                  <div className="border border-[var(--line)] p-3">
                    <p className="type-caption uppercase text-[var(--ink-muted)]">{t("market.detail.requestedWindow")}</p>
                    <p className="type-mono mt-2 text-[var(--ink)]">{detail?.period ?? item.period ?? "5y"}</p>
                  </div>
                </div>
              </section>

              {detail ? <IndicatorGrid instrumentType={normalizedInstrumentType} timeframe="daily" indicators={detail.daily_indicators} /> : null}
              {detail ? <IndicatorGrid instrumentType={normalizedInstrumentType} timeframe="monthly" indicators={detail.monthly_indicators} /> : null}
            </div>

            <div className="space-y-5">
              <section className="border border-[var(--line)] bg-[var(--surface-raised)] p-4">
                <h3 className="type-panel-title text-[var(--ink)]">{t("market.detail.dailyVolume")}</h3>
                <p className="type-body mt-2 text-[var(--ink-muted)]">
                  {t("market.detail.volumeNote")}
                </p>
                <div className="mt-4 grid gap-3">
                  <div className="border border-[var(--line)] p-3">
                    <p className="type-caption uppercase text-[var(--ink-muted)]">{t("market.detail.latestVolume")}</p>
                    <p className="type-mono mt-2 text-[var(--ink)]">{integer(volumeSummary?.latest_volume)}</p>
                  </div>
                  <div className="border border-[var(--line)] p-3">
                    <p className="type-caption uppercase text-[var(--ink-muted)]">{t("market.detail.avg20Volume")}</p>
                    <p className="type-mono mt-2 text-[var(--ink)]">{integer(volumeSummary?.average_20d_volume)}</p>
                  </div>
                  <div className="border border-[var(--line)] p-3">
                    <p className="type-caption uppercase text-[var(--ink-muted)]">{t("market.detail.avg60Volume")}</p>
                    <p className="type-mono mt-2 text-[var(--ink)]">{integer(volumeSummary?.average_60d_volume)}</p>
                  </div>
                  <div className="border border-[var(--line)] p-3">
                    <p className="type-caption uppercase text-[var(--ink-muted)]">{t("market.detail.vsAvg20")}</p>
                    {/* volume_vs_20d_pct is in percent units (12.34 = +12.34%); formatNumber's percent kind takes a fraction. */}
                    <p className={`type-mono mt-2 ${(volumeVsAverage ?? 0) >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}>
                      {formatNumber(volumeVsAverage == null ? null : volumeVsAverage / 100, "percent", { digits: 2, signed: true, locale })}
                    </p>
                  </div>
                </div>
              </section>

              <section className="border border-[var(--line)] bg-[var(--surface-raised)] p-4">
                <h3 className="type-panel-title text-[var(--ink)]">{contextBlock.title}</h3>
                <p className="type-body mt-2 text-[var(--ink-muted)]">{contextBlock.description}</p>
                {detail?.instrument_type === "index" && detail.market_regime ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="border border-[var(--line)] p-3">
                      <p className="type-caption uppercase text-[var(--ink-muted)]">{t("market.detail.regime")}</p>
                      <p className={clsx("type-panel-title mt-2", regimeState.kind === "ready" ? TONE_CLASS[regimeState.tone] : "text-[var(--ink)]")}>
                        {regimeState.kind === "ready" ? t(regimeState.labelKey) : t("market.regime.unknown")}
                      </p>
                      <p className="type-body mt-1 text-[var(--ink-muted)]">
                        {regimeState.kind === "ready"
                          ? t(`market.detail.regimeSummary.${REGIME_SUMMARY_KEY[regimeState.tone]}`)
                          : t("market.detail.regimeSummary.unknown")}
                      </p>
                    </div>
                    <div className="border border-[var(--line)] p-3">
                      <p className="type-caption uppercase text-[var(--ink-muted)]">{t("market.detail.breadth")}</p>
                      <p className="type-panel-title mt-2 text-[var(--ink)]">
                        <FigureText parts={withFigures(t("market.detail.breadthAdvancers"), { breadth: `${integer(detail.market_regime.equity_advancers)}/${integer(detail.market_regime.equity_index_count)}` })} />
                      </p>
                      <p className="type-body mt-1 text-[var(--ink-muted)]">
                        <FigureText parts={withFigures(t("market.detail.breadthRatio"), { ratio: formatNumber(detail.market_regime.breadth_ratio, "percent", { digits: 0, locale }) })} />
                      </p>
                    </div>
                    <div className="border border-[var(--line)] p-3 sm:col-span-2">
                      <p className="type-caption uppercase text-[var(--ink-muted)]">{t("market.detail.crossAsset")}</p>
                      <p className="type-panel-title mt-2 text-[var(--ink)]">
                        <FigureText parts={withFigures(t("market.detail.crossAssetSignals"), { on: integer(detail.market_regime.risk_on_signals), off: integer(detail.market_regime.risk_off_signals) })} />
                      </p>
                      <p className="type-body mt-1 text-[var(--ink-muted)]">
                        {t("market.detail.crossAssetNote")}
                      </p>
                    </div>
                  </div>
                ) : null}
                <ul className="type-body mt-3 space-y-2 text-[var(--ink)]">
                  {contextBlock.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </section>

              <section className="border border-[var(--status-warning-border)] bg-[var(--status-warning-surface)] p-4">
                <h3 className="type-panel-title text-[var(--status-warning-ink)]">{t("market.detail.dataQuality")}</h3>
                <div className="type-body mt-3 space-y-3 text-[var(--status-warning-ink)]">
                  <div>
                    <p className="type-label">{t("market.detail.source")}</p>
                    <p>{detail?.data_quality.source ?? MISSING}</p>
                  </div>
                  <div>
                    <p className="type-label">{t("market.detail.lastUpdated")}</p>
                    <p>{detail?.data_quality.last_updated ?? MISSING}</p>
                  </div>
                  <div>
                    <p className="type-label">{t("market.detail.latestTradingDate")}</p>
                    <p>{detail?.data_quality.latest_trading_date ?? detail?.as_of_date ?? MISSING}</p>
                  </div>
                  <div>
                    <p className="type-label">{t("market.detail.freshness")}</p>
                    <p>{detail?.data_quality.freshness_status ?? t("market.detail.freshnessUnknown")}</p>
                  </div>
                  <div>
                    <p className="type-label">{t("market.detail.coverage")}</p>
                    <p>{t("market.detail.coverageBody")}</p>
                  </div>
                  <div>
                    <p className="type-label">{t("market.detail.fallbackNote")}</p>
                    <p>{detail?.data_quality.detail_note ?? t("market.detail.noDetailNote")}</p>
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
  useDevMonitorPageLoad({ component: "market" });
  const [pageTab, setPageTab] = useMarketPageTab();
  const [viewMode, setViewMode] = useState<ViewMode>("chart");
  const [selectedIndex, setSelectedIndex] = useState<MarketIndexQuote | null>(null);
  // Risk UI spec §2: the strip opens the signal panel (the panel itself arrives with plan Task 4).
  const [signalsOpen, setSignalsOpen] = useState(false);

  // Spec §1: the page column is the viewport minus AppShell's pads. The header and the tab bar keep
  // their height; the tab panel takes the rest and scrolls inside itself. A failed or empty index
  // fetch is stated inside the Instruments panel, and the Spreads tab stays reachable (plan N6).
  return (
    <>
      <div
        data-testid="market-page"
        className="mx-auto flex h-[calc(100dvh_-_var(--main-pad-top,0px)_-_var(--main-pad-bottom,0px))] max-w-7xl flex-col"
      >
        <div className="mb-2 shrink-0">
          <SignalStrip onOpen={() => setSignalsOpen(true)} expanded={signalsOpen} />
        </div>
        <MarketHeader />
        <MarketPageTabs
          active={pageTab}
          onChange={setPageTab}
          instruments={
            <InstrumentsPanel
              indices={indices}
              fetchError={fetchError}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onOpenDetail={setSelectedIndex}
              onOpenSpreads={() => setPageTab("spreads")}
            />
          }
          spreads={<SpreadsSection />}
        />
      </div>

      {selectedIndex ? <MarketDetailModal item={selectedIndex} onClose={() => setSelectedIndex(null)} /> : null}
    </>
  );
}
