"use client";

import {
  Bar,
  CartesianGrid,
  Cell,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
  Line,
  ComposedChart,
} from "recharts";
import {
  AXIS_LINE_STYLE,
  AXIS_TICK_STYLE,
  CHART_COLORS,
  CHART_MARGIN,
  DEFAULT_TOOLTIP_PROPS,
  fmtPct,
  GRID_STYLE,
} from "@/lib/chartConfig";
import { ChartPanelFrame } from "@/components/charts/ChartPanelFrame";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";

export interface HistogramBin {
  return: number;
  frequency: number;
  loss_bucket?: number;
  normal_scaled?: number;
}

interface HistogramPanelProps {
  data: HistogramBin[];
  title?: string;
  description?: string;
  height?: number;
  xAxisLabel?: string;
  legend?: React.ReactNode;
  children?: React.ReactNode;
  loading?: boolean;
  errorMessage?: string | null;
  staleLabel?: string;
  lastUpdatedLabel?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function HistogramPanel({
  data,
  title,
  description,
  height = 320,
  xAxisLabel = "Return",
  legend,
  children,
  loading = false,
  errorMessage,
  staleLabel,
  lastUpdatedLabel,
  emptyTitle = "No histogram data available",
  emptyDescription = "Run an analysis or refresh the data to populate this distribution.",
}: HistogramPanelProps) {
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
      >
        {legend && <div className="mt-3">{legend}</div>}
        <div className="mt-4" style={{ height }}>
          <ResponsiveChart minWidth={1} minHeight={1}>
            <ComposedChart data={data} margin={CHART_MARGIN}>
              <CartesianGrid {...GRID_STYLE} vertical={false} />
              <XAxis
                dataKey="return"
                tickFormatter={(val) => `${Math.round(Number(val))}%`}
                tick={AXIS_TICK_STYLE}
                axisLine={AXIS_LINE_STYLE}
                tickLine={false}
              />
              <YAxis
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
                      <div style={DEFAULT_TOOLTIP_PROPS.labelStyle}>{`${xAxisLabel}: ${fmtPct(Number(label))}`}</div>
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {payload.map((entry: any, index: number) => (
                        <div key={`item-${index}`} style={DEFAULT_TOOLTIP_PROPS.itemStyle}>
                          <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: entry.color }} />
                          {entry.name}: {Number(entry.value).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              <ReferenceLine x={0} stroke={CHART_COLORS.ink} />
              <Bar dataKey="frequency" name="Frequency">
                {data.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={Number(entry.loss_bucket) === 1 ? CHART_COLORS.negative : CHART_COLORS.positive}
                  />
                ))}
              </Bar>
              {data.some((d) => d.normal_scaled !== undefined) && (
                <Line
                  type="monotone"
                  dataKey="normal_scaled"
                  name="Normal Fit"
                  stroke={CHART_COLORS.ink}
                  strokeWidth={2}
                  dot={false}
                  activeDot={false}
                />
              )}
              {children}
            </ComposedChart>
          </ResponsiveChart>
        </div>
      </ChartPanelFrame>
    </ErrorBoundary>
  );
}
