"use client";

import { Area, AreaChart, CartesianGrid, Line, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { GRID_STYLE, fmtPctTick, withAxisProps, withCategoryAxisProps, withTooltipProps } from "@/lib/chartConfig";
import { type DetailKey, type RiskReturnPoint, numberText, pct2 } from "./shared";

export function RiskReturnMinardGraph({
  derivedSpread,
  successProbability,
  riskReturn,
  onOpenDetail,
}: {
  derivedSpread: number;
  successProbability: number;
  riskReturn: RiskReturnPoint[];
  onOpenDetail: (key: DetailKey) => void;
}) {
  return (
    <div className="lg:col-span-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-[var(--text-primary)]">Risk-Return Minard Chart</h3>
          <button
            type="button"
            onClick={() => onOpenDetail("riskReturnMinard")}
            className="mt-1 text-left text-xs text-[var(--text-muted)] underline decoration-dotted underline-offset-4 hover:text-[var(--surface)]"
          >
            <InfoTooltip
              label="Open scenario path details"
              description="X-axis moves across risk exposure segments: Inflation, FX, Demand, and Margin. The NPV path approximates expected return under each exposure; stroke thickness represents success probability, and the area layer indicates failure probability."
            />
          </button>
        </div>
        <button
          type="button"
          onClick={() => onOpenDetail("failureProbability")}
          className="text-left text-xs text-[var(--text-muted)] underline decoration-dotted underline-offset-4 transition hover:text-[var(--surface)]"
        >
          Line thickness proxy: success probability. Area: failure distribution.
        </button>
      </div>
      <div className="h-80 min-h-80 min-w-0">
        <ResponsiveChart className="h-full w-full" minWidth={1} minHeight={1}>
          <AreaChart data={riskReturn} margin={{ top: 20, right: 24, bottom: 0, left: 0 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="risk" {...withCategoryAxisProps()} />
            <YAxis {...withAxisProps({ tickFormatter: (value: number | string) => fmtPctTick(Number(value), 0) })} />
            <Tooltip {...withTooltipProps()} formatter={(value, name) => (name === "Failure probability" ? pct2(Number(value)) : numberText(Number(value)))} />
            <ReferenceLine y={0} stroke="#444444" />
            <Area type="monotone" dataKey="fail" name="Failure probability" stroke="#9DA5A2" fill="#9DA5A2" fillOpacity={0.22} />
            <Line type="monotone" dataKey="npv" name="NPV path" stroke={derivedSpread >= 0 ? "var(--accent)" : "var(--delta-down)"} strokeWidth={Math.max(2, successProbability / 18)} dot={{ r: 4 }} />
          </AreaChart>
        </ResponsiveChart>
      </div>
    </div>
  );
}
