"use client";

import { useState, type ReactNode } from "react";
import TVChart, { type TVLineSeries } from "@/components/charts/TVChart";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import type { TVCandle, TVVolume } from "@/lib/transformers";
import { ChartPanelFrame } from "@/components/charts/ChartPanelFrame";
import { useMarketEvents } from "@/lib/useMarketEvents";

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
  lineSeriesData = [],
  height = 420,
  tickerName,
  colorAccent,
  upColor,
  downColor,
  timeframe,
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

  // Default on: the lines exist to be noticed, and a marker you have to go and enable is a
  // marker you forget is available. The toggle is here because a chart crowded with context
  // is worth being able to clear back to bare price.
  const [showEvents, setShowEvents] = useState(true);
  const { events, lines } = useMarketEvents();

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
        {lines.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowEvents((shown) => !shown)}
            aria-pressed={showEvents}
            data-testid="chart-events-toggle"
            className={`rounded-[var(--radius-sm)] border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-info)] ${
              showEvents
                ? "border-[var(--state-warning)] text-[var(--state-warning)]"
                : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            Market events
          </button>
        ) : null}
        {actions}
      </div>
      {/* The lines are canvas pixels, so assistive tech cannot see them at all and a sighted
          reader has nothing telling them what an unlabelled vertical line means. The same
          list serves as the legend and as the only textual record of what is drawn. */}
      {showEvents && events.length > 0 ? (
        <div
          data-testid="chart-events-legend"
          className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]"
        >
          {events.map((event) => (
            <span
              key={event.id}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-2 py-1"
              title={event.note || undefined}
            >
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--state-warning)]" />
              {event.label} · {event.start_date}
            </span>
          ))}
        </div>
      ) : null}
      {legend ? <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">{legend}</div> : null}

      <div className="mt-4 rounded-[var(--radius)] border border-[var(--border)]/60 bg-[var(--surface-muted)] p-2">
        <TVChart
          data={data}
          events={lines}
          showEvents={showEvents}
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
