"use client";

import type { SharedSimulationResult } from "../lib/types";
import { Bar, ComposedChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { MetricCard, numberText, pct } from "./shared";

type Props = {
  sharedSimulation: SharedSimulationResult | null;
};

export function ReturnDistributionSection({ sharedSimulation }: Props) {
  if (!sharedSimulation) {
    return (
      <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-white p-10 text-center text-sm text-[var(--text-muted)]">
        Run the shared simulation first. Return Distribution uses the same terminal distribution and moments as the Path and Risk tabs.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Distribution moment summary */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Mean return" value={pct(sharedSimulation.raw.risk_metrics.mean_return)} detail="Average terminal return across all simulations" />
        <MetricCard label="Std. deviation" value={pct(sharedSimulation.raw.risk_metrics.volatility)} detail="Dispersion of terminal returns" />
        <MetricCard label="Kurtosis" value={numberText(sharedSimulation.raw.risk_metrics.kurtosis)} detail="Fourth-moment tail heaviness of the terminal return distribution" />
        <MetricCard label="Maximum return" value={pct(sharedSimulation.raw.risk_metrics.max_return)} detail="Best simulated terminal return" />
        <MetricCard label="Minimum return" value={pct(sharedSimulation.raw.risk_metrics.min_return)} detail="Worst simulated terminal return" />
      </section>

      {/* Histogram plus fitted normal overlay */}
      <section className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-[var(--text-primary)]">Return Histogram with Fitted Normal Curve</h2>
        <p className="text-xs text-[var(--text-muted)]">Simulated terminal return histogram with the fitted normal distribution overlaid for tail-shape comparison.</p>
        <div className="mt-4 h-80">
          <ResponsiveChart minWidth={1} minHeight={1}>
            <ComposedChart data={sharedSimulation.returnDistributionChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="return" tickFormatter={(value) => `${Math.round(Number(value))}%`} />
              <YAxis />
              <Tooltip formatter={(value) => Number(value).toFixed(4)} />
              <ReferenceLine x={0} stroke="#111827" />
              <Bar dataKey="frequency">
                {sharedSimulation.raw.histogram.map((row, index) => (
                  <Cell key={`${row.return}-${index}`} fill={Number(row.loss_bucket) === 1 ? "#ef4444" : "#60caad"} />
                ))}
              </Bar>
              <Line type="monotone" dataKey="normal_scaled" stroke="#111827" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveChart>
        </div>
      </section>

      {/* Simulated versus fitted cumulative distribution comparison */}
      <section className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-[var(--text-primary)]">CDF Comparison</h2>
        <p className="text-xs text-[var(--text-muted)]">Simulated cumulative distribution versus fitted normal cumulative distribution.</p>
        <div className="mt-4 h-80">
          <ResponsiveChart minWidth={1} minHeight={1}>
            <LineChart data={sharedSimulation.raw.cdf_comparison}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="return" tickFormatter={(value) => `${value}%`} />
              <YAxis domain={[0, 1]} />
              <Tooltip />
              <Line type="monotone" dataKey="simulated_cdf" stroke="#60caad" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="normal_cdf" stroke="#111827" strokeDasharray="6 4" dot={false} />
            </LineChart>
          </ResponsiveChart>
        </div>
      </section>
    </div>
  );
}
