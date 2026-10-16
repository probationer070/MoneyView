"use client";

import { CartesianGrid, Cell, ReferenceLine, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { GRID_STYLE, fmtPctTick, withAxisProps, withTooltipProps } from "@/lib/chartConfig";
import { type DetailKey, type ValueMatrixPoint } from "./shared";

export function ValueDriverMatrixGraph({
  companyName,
  valueMatrix,
  onOpenDetail,
}: {
  companyName: string;
  valueMatrix: ValueMatrixPoint[];
  onOpenDetail: (key: DetailKey) => void;
}) {
  return (
    <div className="border border-[var(--line)] bg-[var(--surface-raised)] p-5">
      <div className="min-w-0">
        <h3 className="type-panel-title text-[var(--ink)]">4-Quadrant Value Driver Matrix</h3>
        <button
          type="button"
          onClick={() => onOpenDetail("valueDriverMatrix")}
          className="type-small mt-1 text-left text-[var(--ink-muted)] underline decoration-dotted underline-offset-4 hover:text-[var(--brand-text)]"
        >
          <InfoTooltip
            label="Open matrix interpretation details"
            description="X-axis is growth. Y-axis is ROIC minus WACC. Bubble size approximates FCFF magnitude, highlighting value creation or destruction."
          />
        </button>
      </div>
      <div className="h-56 min-h-56 min-w-0">
        <ResponsiveChart className="h-full w-full" minWidth={1} minHeight={1}>
          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis type="number" dataKey="growth" name="Growth" {...withAxisProps({ tickFormatter: (value: number | string) => fmtPctTick(Number(value), 0) })} />
            <YAxis type="number" dataKey="spread" name="ROIC - WACC" {...withAxisProps({ tickFormatter: (value: number | string) => fmtPctTick(Number(value), 0) })} />
            <ZAxis type="number" dataKey="fcff" range={[90, 520]} name="FCFF" />
            <ReferenceLine y={0} stroke="var(--ink)" />
            <Tooltip {...withTooltipProps({ cursor: { strokeDasharray: "3 3" } })} />
            <Scatter data={valueMatrix} name="Capital efficiency">
              {valueMatrix.map((entry) => (
                <Cell key={entry.name} fill={entry.name === companyName ? "var(--chart-1)" : "var(--chart-4)"} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveChart>
      </div>
    </div>
  );
}
