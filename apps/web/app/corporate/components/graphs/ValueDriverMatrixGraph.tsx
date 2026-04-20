"use client";

import { CartesianGrid, Cell, ReferenceLine, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
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
    <div className="lg:col-span-2 rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm">
      <button
        type="button"
        onClick={() => onOpenDetail("valueDriverMatrix")}
        className="text-left text-sm font-bold text-[var(--text-primary)] underline decoration-dotted underline-offset-4 hover:text-[var(--surface)]"
      >
        <InfoTooltip
          label="4-Quadrant Value Driver Matrix"
          description="X-axis is growth. Y-axis is ROIC minus WACC. Bubble size approximates FCFF magnitude, highlighting value creation or destruction."
        />
      </button>
      <div className="h-72 min-h-72 min-w-0">
        <ResponsiveChart minWidth={1} minHeight={1}>
          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis type="number" dataKey="growth" name="Growth" tick={{ fill: "var(--text-muted)" }} />
            <YAxis type="number" dataKey="spread" name="ROIC - WACC" tick={{ fill: "var(--text-muted)" }} />
            <ZAxis type="number" dataKey="fcff" range={[90, 520]} name="FCFF" />
            <ReferenceLine y={0} stroke="#444444" />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} />
            <Scatter data={valueMatrix} name="Capital efficiency">
              {valueMatrix.map((entry) => (
                <Cell key={entry.name} fill={entry.name === companyName ? "var(--accent)" : "#9DA5A2"} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveChart>
      </div>
    </div>
  );
}
