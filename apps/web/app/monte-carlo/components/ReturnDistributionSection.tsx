"use client";

import type { SharedSimulationResult } from "../lib/types";
import { Download } from "lucide-react";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { ActionButton } from "@/components/ui/ActionButton";
import { MonteCarloTabSummary } from "./MonteCarloTabSummary";
import { MetricCard, numberText, pct } from "./shared";
import { HistogramPanel, type HistogramBin } from "@/components/charts/HistogramPanel";

type Props = {
  sharedSimulation: SharedSimulationResult | null;
  exportReturnHistogramCsv: () => void;
  exportReturnCdfCsv: () => void;
};

export function ReturnDistributionSection({ sharedSimulation, exportReturnHistogramCsv, exportReturnCdfCsv }: Props) {
  if (!sharedSimulation) {
    return (
      <div className="space-y-6">
        <MonteCarloTabSummary
          title="Return Distribution Summary"
          description="Return Distribution is fed by the shared path run. It does not trigger a separate simulation."
          status="idle"
          statusLabel="Waiting for path results"
          items={[
            { label: "Source tab", value: "Path Simulation" },
            { label: "Dependency", value: "Shared histogram + CDF" },
            { label: "Run state", value: "No analysis run yet" },
            { label: "Exports", value: "Unavailable until path run" },
          ]}
        />
        <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--bg-surface)] p-10 text-center text-sm text-[var(--text-muted)]">
          Run the shared simulation first. Return Distribution uses the same terminal distribution and moments as the Path and Risk tabs.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <MonteCarloTabSummary
        title="Return Distribution Summary"
        description="This tab reuses the shared path output and keeps its histogram and CDF exports at the same summary boundary before the charts."
        status="live"
        statusLabel="Using shared path results"
        items={[
          { label: "Mean return", value: pct(sharedSimulation.raw.risk_metrics.mean_return) },
          { label: "Volatility", value: pct(sharedSimulation.raw.risk_metrics.volatility) },
          { label: "Kurtosis", value: numberText(sharedSimulation.raw.risk_metrics.kurtosis) },
          { label: "Samples", value: sharedSimulation.raw.histogram.length.toLocaleString() },
        ]}
        actions={(
          <>
            <ActionButton label="Export Histogram CSV" size="sm" onClick={exportReturnHistogramCsv} icon={<Download className="h-4 w-4" />} />
            <ActionButton label="Export CDF CSV" size="sm" onClick={exportReturnCdfCsv} icon={<Download className="h-4 w-4" />} />
          </>
        )}
      />

      {/* Distribution moment summary */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Mean return" value={pct(sharedSimulation.raw.risk_metrics.mean_return)} detail="Average terminal return across all simulations" />
        <MetricCard label="Std. deviation" value={pct(sharedSimulation.raw.risk_metrics.volatility)} detail="Dispersion of terminal returns" />
        <MetricCard label="Kurtosis" value={numberText(sharedSimulation.raw.risk_metrics.kurtosis)} detail="Fourth-moment tail heaviness of the terminal return distribution" />
        <MetricCard label="Maximum return" value={pct(sharedSimulation.raw.risk_metrics.max_return)} detail="Best simulated terminal return" />
        <MetricCard label="Minimum return" value={pct(sharedSimulation.raw.risk_metrics.min_return)} detail="Worst simulated terminal return" />
      </section>

      {/* Histogram plus fitted normal overlay */}
      <HistogramPanel
        title="Return Histogram with Fitted Normal Curve"
        description="Simulated terminal return histogram with the fitted normal distribution overlaid for tail-shape comparison."
        data={sharedSimulation.returnDistributionChartData as unknown as HistogramBin[]}
      />

      {/* Simulated versus fitted cumulative distribution comparison */}
      <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5 shadow-sm">
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
