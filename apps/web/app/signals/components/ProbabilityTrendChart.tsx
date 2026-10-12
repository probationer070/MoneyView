"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import type { SignalHistoryPoint } from "../../../../../packages/shared-types";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { DEFAULT_AXIS_PROPS, GRID_STYLE } from "@/lib/chartConfig";
import { rulesVersionBreaks } from "@/lib/signals";
import { SIGNALS_COPY as T } from "../copy";

// Existing tokens. The design-system plan remaps these to chart.series.* with every other chart.
const SERIES = [
  { key: "a", stroke: "var(--chart-secondary)" },
  { key: "b", stroke: "var(--state-warning)" },
  { key: "c", stroke: "var(--state-error)" },
] as const;

export function ProbabilityTrendChart({ history }: { history: SignalHistoryPoint[] }) {
  const breaks = rulesVersionBreaks(history);
  return (
    <section aria-label="trend">
      <h2 className="mb-2 text-sm font-semibold">{T.trend}</h2>
      <div className="h-64" data-testid="trend-chart">
        <ResponsiveChart className="h-full w-full" minWidth={1} minHeight={1} monitorName="signals_trend">
          <LineChart data={history}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="iso_week" {...DEFAULT_AXIS_PROPS} />
            <YAxis domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} {...DEFAULT_AXIS_PROPS} />
            <Tooltip formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`} />
            <Legend />
            {SERIES.map((s) => <Line key={s.key} dataKey={s.key} name={s.key.toUpperCase()} stroke={s.stroke} dot={false} isAnimationActive={false} />)}
            {breaks.map((w) => <ReferenceLine key={w} x={w} strokeDasharray="4 4" stroke="var(--border-strong)" label={T.trendRulesChanged} />)}
          </LineChart>
        </ResponsiveChart>
      </div>
    </section>
  );
}
