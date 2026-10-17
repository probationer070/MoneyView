"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AXIS_LINE_STYLE,
  AXIS_TICK_STYLE,
  CHART_MARGIN,
  DEFAULT_PERCENTILE_BAR_COLORS,
  DEFAULT_TOOLTIP_PROPS,
  fmtNum,
  fmtPlain,
  GRID_STYLE,
} from "@/lib/chartConfig";
import { ChartPanelFrame } from "@/components/charts/ChartPanelFrame";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";

export interface PercentileData {
  percentile: string;
  value: number;
  /** Optional specific color for this percentile, else falls back to default logic */
  color?: string;
}

interface PercentileBandPanelProps {
  data: PercentileData[];
  title?: string;
  description?: string;
  /** Pixels, or "fill" to take the height the parent gives (never below the chart minimum). */
  height?: number | "fill";
  valueLabel?: string;
  valueFormatter?: (value: number) => string;
  /** Y tick labels; absent, the ticks keep the plain number format. */
  yTickFormatter?: (value: number) => string;
  /** Unit title on the Y axis; absent, the axis has no title. */
  yAxisLabel?: string;
  loading?: boolean;
  errorMessage?: string | null;
  staleLabel?: string;
  lastUpdatedLabel?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function PercentileBandPanel({
  data,
  title,
  description,
  height = 320,
  valueLabel = "Value",
  valueFormatter = (val) => fmtNum(val, 2),
  yTickFormatter,
  yAxisLabel,
  loading = false,
  errorMessage,
  staleLabel,
  lastUpdatedLabel,
  emptyTitle = "No percentile data available",
  emptyDescription = "Run an analysis or refresh the data to generate percentile bands.",
}: PercentileBandPanelProps) {
  const fill = height === "fill";
  return (
    <ErrorBoundary>
      <ChartPanelFrame
        title={title}
        description={description}
        loading={loading}
        errorMessage={errorMessage}
        staleLabel={staleLabel}
        lastUpdatedLabel={lastUpdatedLabel}
        empty={!data || data.length === 0}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
        className="h-full flex flex-col"
      >
        <div
          className={fill ? "mt-4 min-h-[var(--component-chart-min-height)] flex-1" : "mt-4 flex-grow"}
          style={fill ? undefined : { minHeight: height }}
        >
          <ResponsiveChart className="h-full w-full" minWidth={1} minHeight={1}>
            <BarChart data={data} margin={CHART_MARGIN}>
              <CartesianGrid {...GRID_STYLE} vertical={false} />
              <XAxis
                dataKey="percentile"
                tick={AXIS_TICK_STYLE}
                axisLine={AXIS_LINE_STYLE}
                tickLine={false}
              />
              <YAxis
                tickFormatter={yTickFormatter ?? ((val) => fmtPlain(Number(val)))}
                label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: "insideLeft", style: AXIS_TICK_STYLE } : undefined}
                tick={AXIS_TICK_STYLE}
                axisLine={AXIS_LINE_STYLE}
                tickLine={false}
              />
              <Tooltip
                {...DEFAULT_TOOLTIP_PROPS}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                content={(props: any) => {
                  const { active, payload, label } = props;
                  if (!active || !payload || payload.length === 0) return null;
                  return (
                    <div style={DEFAULT_TOOLTIP_PROPS.contentStyle}>
                      <div style={DEFAULT_TOOLTIP_PROPS.labelStyle}>{label}</div>
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {payload.map((entry: any, index: number) => (
                        <div key={`item-${index}`} style={DEFAULT_TOOLTIP_PROPS.itemStyle}>
                          {/* rounded-full: dot */}
                          <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: entry.color }} />
                          {valueLabel}: {valueFormatter(Number(entry.value))}
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              <Bar dataKey="value">
                {data.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.color || DEFAULT_PERCENTILE_BAR_COLORS[index % DEFAULT_PERCENTILE_BAR_COLORS.length]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveChart>
        </div>
      </ChartPanelFrame>
    </ErrorBoundary>
  );
}
