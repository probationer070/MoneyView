"use client";

import { useMemo, useState, type ReactNode } from "react";
import TVChart, { NO_LINE_SERIES, type ChartMarker, type TVLineSeries } from "@/components/charts/TVChart";
import type { EventGranularity } from "@/components/charts/primitives/EventLinesPrimitive";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import type { TVCandle, TVVolume } from "@/lib/transformers";
import { ChartPanelFrame } from "@/components/charts/ChartPanelFrame";
import { useMarketEvents } from "@/lib/useMarketEvents";
import { EventFilter } from "@/components/charts/EventFilter";
import type { EventLineSpec } from "@/components/charts/primitives/EventLinesPrimitive";
import { useT } from "@/lib/i18n/locale";

const NO_LINES: EventLineSpec[] = [];

interface OHLCVChartCardProps {
  title: string;
  description?: string;
  data: TVCandle[];
  volumeData?: TVVolume[];
  lineSeriesData?: TVLineSeries[];
  height?: number;
  tickerName?: string;
  colorAccent?: string;
  upColor?: string;
  downColor?: string;
  timeframe?: string;
  /** Pass "month" when data holds monthly candles, so event lines land on the right candle. */
  eventGranularity?: EventGranularity;
  timeframeOptions?: Array<{ value: string; label: string }>;
  /** Accessible name of the timeframe group; defaults to "<title> timeframe". */
  timeframeLabel?: string;
  onTimeframeChange?: (value: string) => void;
  actions?: ReactNode;
  legend?: ReactNode;
  loading?: boolean;
  errorMessage?: string | null;
  staleLabel?: string;
  lastUpdatedLabel?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  footer?: ReactNode;
  /** "categories" (default) is the per-category filter; "single" is one on/off switch for all event lines. */
  eventToggle?: "categories" | "single";
  /** Big-move marks drawn on the candles, and the callback for a clicked mark. */
  markers?: ChartMarker[];
  onMarkerClick?: (date: string) => void;
}

export function OHLCVChartCard({
  title,
  description,
  data,
  volumeData,
  // The shared stable empty, not `[]`: this card re-renders on its own event state, and a fresh
  // array here reaches TVChart's identity-keyed setup effect and rebuilds the chart. See
  // NO_LINE_SERIES in TVChart.tsx.
  lineSeriesData = NO_LINE_SERIES,
  height = 420,
  tickerName,
  colorAccent,
  upColor,
  downColor,
  timeframe,
  eventGranularity,
  timeframeOptions,
  timeframeLabel,
  onTimeframeChange,
  actions,
  legend,
  loading = false,
  errorMessage,
  staleLabel,
  lastUpdatedLabel,
  emptyTitle = "No OHLCV data available",
  emptyDescription = "No OHLCV history is available for the selected timeframe.",
  footer,
  eventToggle = "categories",
  markers,
  onMarkerClick,
}: OHLCVChartCardProps) {
  const t = useT();
  const [eventsOn, setEventsOn] = useState(true);
  const hasToggle = Boolean(timeframe && timeframeOptions && onTimeframeChange);

  const { lines: allLines, status: eventsStatus } = useMarketEvents();
  const single = eventToggle === "single";
  // The shared stable empty keeps TVChart's memo from seeing a new array when the switch is off.
  const lines = single && !eventsOn ? NO_LINES : allLines;

  const categoryLegend = useMemo(() => {
    const byKey = new Map<string, { label: string; color: string; count: number }>();
    for (const line of lines) {
      const label = line.categoryLabel ?? "Events";
      const key = `${label}|${line.color}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        byKey.set(key, { label, color: line.color, count: 1 });
      }
    }
    return Array.from(byKey.entries()).map(([key, entry]) => ({ key, ...entry }));
  }, [lines]);

  return (
    <ChartPanelFrame
      title={title}
      description={description}
      loading={loading}
      errorMessage={errorMessage}
      staleLabel={staleLabel}
      lastUpdatedLabel={lastUpdatedLabel}
      empty={data.length === 0}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
    >
      <div className="flex flex-wrap gap-2">
        {hasToggle ? (
          <ToggleGroup
            size="sm"
            ariaLabel={timeframeLabel ?? `${title} timeframe`}
            value={timeframe!}
            onChange={onTimeframeChange!}
            options={timeframeOptions!}
          />
        ) : null}
        {single ? (
          <button
            type="button"
            data-testid="chart-events-toggle"
            data-status={eventsStatus}
            aria-pressed={eventsOn}
            onClick={() => setEventsOn((on) => !on)}
            className="rounded-[var(--radius-1)] border border-[var(--line)] px-3 py-1 type-small text-[var(--ink)] hover:bg-[var(--surface)]"
          >
            {eventsStatus === "unavailable" ? t("detail.eventsUnavailable") : eventsOn ? t("detail.eventsOn") : t("detail.eventsOff")}
          </button>
        ) : (
          <EventFilter testId="chart-events-filter" />
        )}
        {actions}
      </div>
      {/* Canvas lines are invisible to assistive tech and unlabelled to a sighted reader; this list
          is their legend and the only textual record of what is drawn -- the tooltip gives each
          event's detail. */}
      {!single && categoryLegend.length > 0 ? (
        <div data-testid="chart-events-legend" className="mt-3 flex flex-wrap gap-2 type-small text-[var(--ink-muted)]">
          {categoryLegend.map((entry) => (
            <span
              key={entry.key}
              data-testid="chart-events-legend-item"
              className="inline-flex items-center gap-2 rounded-[var(--radius-2)] border border-[var(--line)] px-2 py-1"
              title={`${entry.count} event(s) in this category`}
            >
              {/* rounded-full: dot */}
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.label}
            </span>
          ))}
        </div>
      ) : null}
      {legend ? <div className="mt-3 flex flex-wrap gap-2 type-small text-[var(--ink-muted)]">{legend}</div> : null}

      <div className="mt-4 border border-[var(--grid)] bg-[var(--surface)] p-2">
        <TVChart
          data={data}
          events={lines}
          eventGranularity={eventGranularity}
          volumeData={volumeData}
          lineSeriesData={lineSeriesData}
          height={height}
          tickerName={tickerName}
          colorAccent={colorAccent}
          upColor={upColor}
          downColor={downColor}
          markers={markers}
          onMarkerClick={onMarkerClick}
        />
      </div>

      {footer ? <div className="mt-4">{footer}</div> : null}
    </ChartPanelFrame>
  );
}
