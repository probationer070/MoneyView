"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import type { SignalHistoryPoint } from "../../../../../packages/shared-types";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { DEFAULT_AXIS_PROPS, GRID_STYLE, withTooltipProps } from "@/lib/chartConfig";
import { useT } from "@/lib/i18n/locale";
import { rulesVersionBreaks } from "@/lib/signals";
import { tokens } from "@/lib/tokens.generated";

// No subject series here, so --chart-1 is left out; --chart-4 stays the "Other" grey (DESIGN.md).
const SERIES = [
  { key: "a", stroke: tokens.chart["2"] },
  { key: "b", stroke: tokens.chart["3"] },
  { key: "c", stroke: tokens.chart["5"] },
] as const;

export function ProbabilityTrendChart({ history }: { history: SignalHistoryPoint[] }) {
  const t = useT();
  const breaks = rulesVersionBreaks(history);
  return (
    <section aria-label="trend" className="border border-[var(--line)] bg-[var(--surface-raised)] p-5">
      <h2 className="type-panel-title mb-2 text-[var(--ink)]">{t("signals.trend")}</h2>
      <div className="h-64" data-testid="trend-chart">
        <ResponsiveChart className="h-full w-full" minWidth={1} minHeight={1} monitorName="signals_trend">
          <LineChart data={history}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="iso_week" {...DEFAULT_AXIS_PROPS} />
            <YAxis domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} {...DEFAULT_AXIS_PROPS} />
            <Tooltip {...withTooltipProps()} formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`} />
            <Legend />
            {SERIES.map((s) => <Line key={s.key} dataKey={s.key} name={s.key.toUpperCase()} stroke={s.stroke} dot={false} isAnimationActive={false} />)}
            {breaks.map((w) => <ReferenceLine key={w} x={w} strokeDasharray="4 4" stroke={tokens.line.strong} label={t("signals.trendRulesChanged")} />)}
          </LineChart>
        </ResponsiveChart>
      </div>
    </section>
  );
}
