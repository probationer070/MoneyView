"use client";

import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { CHART_INITIAL_DIMENSION, type BetaPoint, type DetailKey, type WaccCurvePoint, pct } from "./shared";

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
    <div className="lg:col-span-2 rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm">
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
        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={CHART_INITIAL_DIMENSION}>
          <BarChart data={betaTreemapProxy}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="name" tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
            <YAxis tick={{ fill: "var(--text-muted)" }} />
            <Tooltip />
            <Bar dataKey="beta" name="Beta" radius={[4, 4, 0, 0]}>
              {betaTreemapProxy.map((entry) => (
                <Cell key={entry.name} fill={entry.beta > 1.3 ? "#444444" : "#60CAAD"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={CHART_INITIAL_DIMENSION}>
          <LineChart data={waccCurve}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="debt" tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
            <YAxis tick={{ fill: "var(--text-muted)" }} />
            <Tooltip formatter={(value) => pct(Number(value))} />
            <Line type="monotone" dataKey="wacc" stroke="var(--accent)" strokeWidth={3} dot={false} />
            <ReferenceLine x={assumptionsDebtRatio} stroke="#444444" strokeDasharray="4 4" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
