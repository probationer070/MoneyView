"use client";

import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { GRID_STYLE, fmtPctTick, fmtRatioTick, withAxisProps, withCategoryAxisProps, withTooltipProps } from "@/lib/chartConfig";
import { type BetaPoint, type DetailKey, type WaccCurvePoint, pct } from "./shared";

export function BetaWaccCurveGraph({
  assumptionsDebtRatio,
  betaTreemapProxy,
  waccCurve,
  onOpenDetail,
}: {
  assumptionsDebtRatio: number;
  betaTreemapProxy: BetaPoint[];
  waccCurve: WaccCurvePoint[];
  onOpenDetail: (key: DetailKey) => void;
}) {
  return (
    <div className="border border-[var(--line)] bg-[var(--surface-raised)] p-5">
      <button
        type="button"
        onClick={() => onOpenDetail("betaWaccCurve")}
        className="type-panel-title text-left text-[var(--ink)] underline decoration-dotted underline-offset-4 hover:text-[var(--brand)]"
      >
        <InfoTooltip
          label="Bottom-up Beta + WACC U-Curve"
          description="Industry Beta is pure sector business risk. Operating Beta (Unlevered) is asset risk excluding financial structure. Financial Beta adds leverage risk from debt through the Hamada formula."
        />
      </button>
      <div className="grid h-56 min-h-56 min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
        <ResponsiveChart minWidth={1} minHeight={1}>
          <BarChart data={betaTreemapProxy}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="name" {...withCategoryAxisProps()} />
            <YAxis {...withAxisProps({ tickFormatter: (value: number | string) => fmtRatioTick(Number(value), 2) })} />
            <Tooltip {...withTooltipProps()} />
            <Bar dataKey="beta" name="Beta">
              {betaTreemapProxy.map((entry) => (
                <Cell key={entry.name} fill={entry.beta > 1.3 ? "var(--ink)" : "var(--chart-1)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveChart>
        <ResponsiveChart minWidth={1} minHeight={1}>
          <LineChart data={waccCurve}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="debt" {...withAxisProps({ tickFormatter: (value: number | string) => fmtPctTick(Number(value), 0) })} />
            <YAxis {...withAxisProps({ tickFormatter: (value: number | string) => fmtPctTick(Number(value), 0) })} />
            <Tooltip {...withTooltipProps()} formatter={(value) => pct(Number(value))} />
            <Line type="monotone" dataKey="wacc" stroke="var(--brand)" strokeWidth={3} dot={false} />
            <ReferenceLine x={assumptionsDebtRatio} stroke="var(--ink)" strokeDasharray="4 4" />
          </LineChart>
        </ResponsiveChart>
      </div>
    </div>
  );
}
