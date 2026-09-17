"use client";

import type { ReactNode } from "react";
import TVChart, { NO_LINE_SERIES, type TVLineSeries } from "@/components/charts/TVChart";
import type { EventGranularity } from "@/components/charts/primitives/EventLinesPrimitive";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import type { TVCandle, TVVolume } from "@/lib/transformers";
import { ChartPanelFrame } from "@/components/charts/ChartPanelFrame";
import { useMarketEvents } from "@/lib/useMarketEvents";
import { EventFilter } from "@/components/charts/EventFilter";

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
}: OHLCVChartCardProps) {
  const hasToggle = Boolean(timeframe && timeframeOptions && onTimeframeChange);

  const { lines } = useMarketEvents();

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
            ariaLabel={`${title} timeframe`}
            value={timeframe!}
            onChange={onTimeframeChange!}
            options={timeframeOptions!}
          />
        ) : null}
        <EventFilter testId="chart-events-filter" />
        {actions}
      </div>
      {/* Canvas lines are invisible to assistive tech and unlabelled to a sighted reader; this list
          is their legend and the only textual record of what is drawn. */}
      {lines.length > 0 ? (
        <div data-testid="chart-events-legend" className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
          {lines.map((line) => (
            <span
              key={line.id}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-2 py-1"
              title={line.note || undefined}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: line.color }} />
              {line.label} · {line.date}
            </span>
          ))}
        </div>
      ) : null}
      {legend ? <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">{legend}</div> : null}

      <div className="mt-4 rounded-[var(--radius)] border border-[var(--border)]/60 bg-[var(--surface-muted)] p-2">
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
        />
      </div>

      {footer ? <div className="mt-4">{footer}</div> : null}
    </ChartPanelFrame>
  );
}
