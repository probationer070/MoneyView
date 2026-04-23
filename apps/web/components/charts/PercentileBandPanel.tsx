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
  height?: number;
  valueLabel?: string;
  valueFormatter?: (value: number) => string;
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
  loading = false,
  errorMessage,
  staleLabel,
  lastUpdatedLabel,
  emptyTitle = "No percentile data available",
  emptyDescription = "Run an analysis or refresh the data to generate percentile bands.",
}: PercentileBandPanelProps) {
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
        <div className="mt-4 flex-grow" style={{ minHeight: height }}>
          <ResponsiveChart minWidth={1} minHeight={1}>
            <BarChart data={data} margin={CHART_MARGIN}>
              <CartesianGrid {...GRID_STYLE} vertical={false} />
              <XAxis
                dataKey="percentile"
                tick={AXIS_TICK_STYLE}
                axisLine={AXIS_LINE_STYLE}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(val) => fmtPlain(Number(val))}
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
                          <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: entry.color }} />
                          {valueLabel}: {valueFormatter(Number(entry.value))}
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
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
