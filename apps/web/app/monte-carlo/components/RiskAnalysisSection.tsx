"use client";

import type { SharedSimulationResult } from "../lib/types";
import { Download } from "lucide-react";
import { ReferenceLine } from "recharts";
import { ActionButton } from "@/components/ui/ActionButton";
import { MonteCarloTabSummary } from "./MonteCarloTabSummary";
import { LegendItem, MetricCard, SummaryRow, TEN_THOUSAND_KRW, krwLossFromPercent, numberText, pct } from "./shared";
import { HistogramPanel, type HistogramBin } from "@/components/charts/HistogramPanel";
import { PercentileBandPanel } from "@/components/charts/PercentileBandPanel";

type Props = {
  sharedSimulation: SharedSimulationResult | null;
  initialInvestment: number;
  exportRiskSummaryCsv: () => void;
  exportRiskHistogramCsv: () => void;
};

export function RiskAnalysisSection({ sharedSimulation, initialInvestment, exportRiskSummaryCsv, exportRiskHistogramCsv }: Props) {
  if (!sharedSimulation) {
    return (
      <div className="space-y-6">
        <MonteCarloTabSummary
          title="Risk Analysis Summary"
          description="Risk Analysis is a downstream readout of the shared path simulation. It does not own a separate run button."
          status="idle"
          statusLabel="Waiting for path results"
          items={[
            { label: "Source tab", value: "Path Simulation" },
            { label: "Dependency", value: "Shared simulation result" },
            { label: "Run state", value: "No analysis run yet" },
            { label: "Exports", value: "Unavailable until path run" },
          ]}
        />
        <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--bg-surface)] p-10 text-center text-sm text-[var(--text-muted)]">
          Run the Path Simulation tab first. Risk Analysis is calculated automatically from the same simulation results.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <MonteCarloTabSummary
        title="Risk Analysis Summary"
        description="This tab reuses the shared path run and keeps risk exports in the same top boundary before the distribution and percentile cards."
        status="live"
        statusLabel="Using shared path results"
        items={[
          { label: "Execution mode", value: sharedSimulation.raw.execution_mode },
          { label: "Loss probability", value: pct(sharedSimulation.raw.risk_metrics.loss_probability) },
          { label: "Max drawdown", value: pct(sharedSimulation.medianMaxDrawdown) },
          { label: "CVaR 95%", value: krwLossFromPercent(initialInvestment, sharedSimulation.raw.risk_metrics.cvar95) },
        ]}
        actions={(
          <>
            <ActionButton label="Export Risk Summary CSV" size="sm" onClick={exportRiskSummaryCsv} icon={<Download className="h-4 w-4" />} />
            <ActionButton label="Export Risk Histogram CSV" size="sm" onClick={exportRiskHistogramCsv} icon={<Download className="h-4 w-4" />} />
          </>
        )}
      />

      {/* Top-line downside and distribution-shape metrics */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="VaR 95%" value={krwLossFromPercent(initialInvestment, sharedSimulation.raw.risk_metrics.var95)} detail={`Loss threshold at ${pct(sharedSimulation.raw.risk_metrics.var95)}`} />
        <MetricCard label="VaR 99%" value={krwLossFromPercent(initialInvestment, sharedSimulation.raw.risk_metrics.var99)} detail={`Loss threshold at ${pct(sharedSimulation.raw.risk_metrics.var99)} in 10,000 KRW`} />
        <MetricCard label="CVaR 95%" value={krwLossFromPercent(initialInvestment, sharedSimulation.raw.risk_metrics.cvar95)} detail="Expected tail loss beyond VaR 95%" />
        <MetricCard label="Maximum drawdown" value={pct(sharedSimulation.medianMaxDrawdown)} detail="Largest peak-to-trough decline of the median path" />
        <MetricCard label="Sortino ratio" value={numberText(sharedSimulation.raw.risk_metrics.sortino_ratio)} detail="Downside-risk-adjusted return" />
        <MetricCard label="Skewness" value={numberText(sharedSimulation.raw.risk_metrics.skewness)} detail="Terminal return asymmetry" />
      </section>

      {/* Loss distribution view with VaR / CVaR markers */}
      <HistogramPanel
        title="VaR / CVaR Risk Distribution"
        description="Terminal return distribution with principal, VaR 95, VaR 99, and CVaR 95 thresholds marked on the loss side."
        data={sharedSimulation.raw.histogram as unknown as HistogramBin[]}
        legend={
          <div className="flex flex-wrap gap-3 text-xs font-bold text-[var(--text-muted)]">
            <LegendItem label="Loss buckets" lineClass="bg-red-500" />
            <LegendItem label="Gain buckets" lineClass="bg-emerald-500" />
            <LegendItem label="VaR 95" lineClass="bg-amber-500" />
            <LegendItem label="VaR 99" lineClass="bg-orange-600" />
            <LegendItem label="CVaR 95" lineClass="bg-black" />
          </div>
        }
      >
        <ReferenceLine x={-sharedSimulation.raw.risk_metrics.var95} stroke="#f59e0b" label="VaR 95" />
        <ReferenceLine x={-sharedSimulation.raw.risk_metrics.var99} stroke="#ea580c" label="VaR 99" />
        <ReferenceLine x={-sharedSimulation.raw.risk_metrics.cvar95} stroke="#111827" strokeDasharray="6 4" label="CVaR 95" />
      </HistogramPanel>

      {/* Terminal percentile chart and summary table */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PercentileBandPanel
          title="Terminal Value Percentiles"
          description="Each percentile is shown as its own terminal-value bar in 10,000 KRW units."
          data={[
            { percentile: "P5", value: Number((sharedSimulation.terminalP05 / TEN_THOUSAND_KRW).toFixed(2)) },
            { percentile: "P10", value: Number((sharedSimulation.terminalP10 / TEN_THOUSAND_KRW).toFixed(2)) },
            { percentile: "P25", value: Number((sharedSimulation.terminalP25 / TEN_THOUSAND_KRW).toFixed(2)) },
            { percentile: "P50", value: Number((sharedSimulation.terminalMedian / TEN_THOUSAND_KRW).toFixed(2)) },
            { percentile: "P75", value: Number((sharedSimulation.terminalP75 / TEN_THOUSAND_KRW).toFixed(2)) },
            { percentile: "P90", value: Number((sharedSimulation.terminalP90 / TEN_THOUSAND_KRW).toFixed(2)) },
            { percentile: "P95", value: Number((sharedSimulation.terminalP95 / TEN_THOUSAND_KRW).toFixed(2)) },
          ].map((d, i) => ({
            ...d,
            color: ["#ef4444", "#f97316", "#64748b", "#111827", "#64748b", "#14b8a6", "#16a34a"][i],
          }))}
          valueLabel="M KRW"
          valueFormatter={(val) => `${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
        />

        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5 shadow-sm">
          <h2 className="text-lg font-black text-[var(--text-primary)]">Statistical Summary</h2>
          <div className="mt-4 overflow-hidden rounded-[var(--radius)] border border-[var(--border)]">
            <table className="w-full text-sm">
              <tbody>
                <SummaryRow label="Mean" value={pct(sharedSimulation.raw.risk_metrics.mean_return)} />
                <SummaryRow label="Median" value={pct(sharedSimulation.raw.risk_metrics.median_return)} />
                <SummaryRow label="Standard deviation" value={pct(sharedSimulation.raw.risk_metrics.volatility)} />
                <SummaryRow label="Sharpe ratio" value={numberText(sharedSimulation.raw.risk_metrics.sharpe_ratio)} />
                <SummaryRow label="Sortino ratio" value={numberText(sharedSimulation.raw.risk_metrics.sortino_ratio)} />
                <SummaryRow label="Skewness" value={numberText(sharedSimulation.raw.risk_metrics.skewness)} />
                <SummaryRow label="Excess kurtosis" value={numberText(sharedSimulation.raw.risk_metrics.excess_kurtosis)} />
                <SummaryRow label="VaR 95%" value={krwLossFromPercent(initialInvestment, sharedSimulation.raw.risk_metrics.var95)} />
                <SummaryRow label="VaR 99%" value={krwLossFromPercent(initialInvestment, sharedSimulation.raw.risk_metrics.var99)} />
                <SummaryRow label="CVaR 95%" value={krwLossFromPercent(initialInvestment, sharedSimulation.raw.risk_metrics.cvar95)} />
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
