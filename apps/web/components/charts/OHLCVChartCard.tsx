"use client";

import type { ReactNode } from "react";
import TVChart, { type TVLineSeries } from "@/components/charts/TVChart";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import type { TVCandle, TVVolume } from "@/lib/transformers";
import { ChartPanelFrame } from "@/components/charts/ChartPanelFrame";

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
        {actions}
      </div>
      {legend ? <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">{legend}</div> : null}

      <div className="mt-4 rounded-[var(--radius)] border border-[var(--border)]/60 bg-[var(--surface-muted)] p-2">
        <TVChart
          data={data}
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
