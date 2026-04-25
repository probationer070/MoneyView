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
    <div className="lg:col-span-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <button
        type="button"
        onClick={() => onOpenDetail("betaWaccCurve")}
        className="text-left text-sm font-bold text-[var(--text-primary)] underline decoration-dotted underline-offset-4 hover:text-[var(--surface)]"
      >
        <InfoTooltip
          label="Bottom-up Beta + WACC U-Curve"
          description="Industry Beta is pure sector business risk. Operating Beta (Unlevered) is asset risk excluding financial structure. Financial Beta adds leverage risk from debt through the Hamada formula."
        />
      </button>
      <div className="grid h-72 min-h-72 min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
        <ResponsiveChart minWidth={1} minHeight={1}>
          <BarChart data={betaTreemapProxy}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="name" {...withCategoryAxisProps()} />
            <YAxis {...withAxisProps({ tickFormatter: (value: number | string) => fmtRatioTick(Number(value), 2) })} />
            <Tooltip {...withTooltipProps()} />
            <Bar dataKey="beta" name="Beta" radius={[4, 4, 0, 0]}>
              {betaTreemapProxy.map((entry) => (
                <Cell key={entry.name} fill={entry.beta > 1.3 ? "#444444" : "#60CAAD"} />
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
            <Line type="monotone" dataKey="wacc" stroke="var(--accent)" strokeWidth={3} dot={false} />
            <ReferenceLine x={assumptionsDebtRatio} stroke="#444444" strokeDasharray="4 4" />
          </LineChart>
        </ResponsiveChart>
      </div>
    </div>
  );
}
