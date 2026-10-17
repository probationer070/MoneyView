"use client";

import type { SharedSimulationResult } from "../lib/types";
import { Download } from "lucide-react";
import { ReferenceLine } from "recharts";
import { ActionButton } from "@/components/ui/ActionButton";
import { CHART_COLORS } from "@/lib/chartConfig";
import { useLocale, useT } from "@/lib/i18n/locale";
import { MonteCarloTabSummary } from "./MonteCarloTabSummary";
import { LegendItem, MetricCard, SummaryRow, WarningNotice, krwLossFromPercent, numberText, pct } from "./shared";
import { formatKrwCompact, krwAxis } from "../lib/krwFormat";
import { HistogramPanel, type HistogramBin } from "@/components/charts/HistogramPanel";
import { PercentileBandPanel } from "@/components/charts/PercentileBandPanel";

type Props = {
  sharedSimulation: SharedSimulationResult | null;
  initialInvestment: number;
  warnings: string[];
  exportRiskSummaryCsv: () => void;
  exportRiskHistogramCsv: () => void;
};

export function RiskAnalysisSection({ sharedSimulation, initialInvestment, warnings, exportRiskSummaryCsv, exportRiskHistogramCsv }: Props) {
  const { locale } = useLocale();
  const t = useT();

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
        <div className="border border-dashed border-[var(--line)] bg-[var(--surface-raised)] p-10 text-center type-body text-[var(--ink-muted)]">
          Run the Path Simulation tab first. Risk Analysis is calculated automatically from the same simulation results.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <WarningNotice warnings={warnings} title="Risk output normalization warnings" />

      <MonteCarloTabSummary
        title="Risk Analysis Summary"
        description="This tab reuses the shared path run and keeps risk exports in the same top boundary before the distribution and percentile cards."
        status="live"
        statusLabel="Using shared path results"
        items={[
          { label: "Execution mode", value: sharedSimulation.raw.execution_mode },
          { label: "Loss probability", value: pct(sharedSimulation.raw.risk_metrics.loss_probability, locale) },
          { label: "Max drawdown", value: pct(sharedSimulation.medianMaxDrawdown, locale) },
          { label: "CVaR 95%", value: krwLossFromPercent(initialInvestment, sharedSimulation.raw.risk_metrics.cvar95, locale) },
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
        <MetricCard label="VaR 95%" value={krwLossFromPercent(initialInvestment, sharedSimulation.raw.risk_metrics.var95, locale)} detail={`Loss threshold at ${pct(sharedSimulation.raw.risk_metrics.var95, locale)}`} />
        <MetricCard label="VaR 99%" value={krwLossFromPercent(initialInvestment, sharedSimulation.raw.risk_metrics.var99, locale)} detail={`Loss threshold at ${pct(sharedSimulation.raw.risk_metrics.var99, locale)}`} />
        <MetricCard label="CVaR 95%" value={krwLossFromPercent(initialInvestment, sharedSimulation.raw.risk_metrics.cvar95, locale)} detail="Expected tail loss beyond VaR 95%" />
        <MetricCard label="Maximum drawdown" value={pct(sharedSimulation.medianMaxDrawdown, locale)} detail="Largest peak-to-trough decline of the median path" />
        <MetricCard label="Sortino ratio" value={numberText(sharedSimulation.raw.risk_metrics.sortino_ratio, locale)} detail="Downside-risk-adjusted return" />
        <MetricCard label="Skewness" value={numberText(sharedSimulation.raw.risk_metrics.skewness, locale)} detail="Terminal return asymmetry" />
      </section>

      {/* Loss distribution view with VaR / CVaR markers */}
      <HistogramPanel
        title="VaR / CVaR Risk Distribution"
        description="Terminal return distribution with principal, VaR 95, VaR 99, and CVaR 95 thresholds marked on the loss side."
        data={sharedSimulation.raw.histogram as unknown as HistogramBin[]}
        emptyTitle="Risk distribution data is invalid"
        emptyDescription="The shared simulation result did not contain a chart-safe histogram, so the risk distribution panel was withheld instead of rendering blank."
        legend={
          <div className="flex flex-wrap gap-3">
            <LegendItem label="Loss buckets" lineClass="bg-[var(--down)]" />
            <LegendItem label="Gain buckets" lineClass="bg-[var(--up)]" />
            <LegendItem label="VaR 95" lineClass="bg-[var(--status-warning-ink)]" />
            <LegendItem label="VaR 99" lineClass="bg-[var(--brand)]" />
            <LegendItem label="CVaR 95" lineClass="bg-[var(--ink)]" />
          </div>
        }
      >
        <ReferenceLine x={-sharedSimulation.raw.risk_metrics.var95} stroke="var(--status-warning-ink)" label="VaR 95" />
        <ReferenceLine x={-sharedSimulation.raw.risk_metrics.var99} stroke="var(--brand)" label="VaR 99" />
        <ReferenceLine x={-sharedSimulation.raw.risk_metrics.cvar95} stroke={CHART_COLORS.ink} strokeDasharray="6 4" label="CVaR 95" />
      </HistogramPanel>

      {/* Terminal percentile chart and summary table */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PercentileBandPanel
          title="Terminal Value Percentiles"
          description="Each percentile is shown as its own terminal-value bar."
          data={[
            { percentile: "P5", value: sharedSimulation.terminalP05 },
            { percentile: "P10", value: sharedSimulation.terminalP10 },
            { percentile: "P25", value: sharedSimulation.terminalP25 },
            { percentile: "P50", value: sharedSimulation.terminalMedian },
            { percentile: "P75", value: sharedSimulation.terminalP75 },
            { percentile: "P90", value: sharedSimulation.terminalP90 },
            { percentile: "P95", value: sharedSimulation.terminalP95 },
          ].map((d, i) => ({
            ...d,
            // Tails in down (lower) and up (upper), the median in ink, the interior in chart-1.
            color: [
              CHART_COLORS.negative,
              CHART_COLORS.negative,
              CHART_COLORS.primary,
              CHART_COLORS.ink,
              CHART_COLORS.primary,
              CHART_COLORS.positive,
              CHART_COLORS.positive,
            ][i],
          }))}
          valueLabel={t("monteCarlo.units.terminalValue")}
          valueFormatter={(val) => formatKrwCompact(val, locale)}
          yTickFormatter={krwAxis(locale).tick}
          yAxisLabel={t(krwAxis(locale).unitKey)}
          emptyTitle="Terminal percentile data is invalid"
          emptyDescription="The shared simulation result did not contain chart-safe terminal percentile values."
        />

        <div className="border border-[var(--line)] bg-[var(--surface-raised)] p-5">
          <h2 className="type-panel-title text-[var(--ink)]">Statistical Summary</h2>
          <div className="mt-4 overflow-hidden border border-[var(--line)]">
            <table className="w-full">
              <tbody>
                <SummaryRow label="Mean" value={pct(sharedSimulation.raw.risk_metrics.mean_return, locale)} />
                <SummaryRow label="Median" value={pct(sharedSimulation.raw.risk_metrics.median_return, locale)} />
                <SummaryRow label="Standard deviation" value={pct(sharedSimulation.raw.risk_metrics.volatility, locale)} />
                <SummaryRow label="Sharpe ratio" value={numberText(sharedSimulation.raw.risk_metrics.sharpe_ratio, locale)} />
                <SummaryRow label="Sortino ratio" value={numberText(sharedSimulation.raw.risk_metrics.sortino_ratio, locale)} />
                <SummaryRow label="Skewness" value={numberText(sharedSimulation.raw.risk_metrics.skewness, locale)} />
                <SummaryRow label="Excess kurtosis" value={numberText(sharedSimulation.raw.risk_metrics.excess_kurtosis, locale)} />
                <SummaryRow label="VaR 95%" value={krwLossFromPercent(initialInvestment, sharedSimulation.raw.risk_metrics.var95, locale)} />
                <SummaryRow label="VaR 99%" value={krwLossFromPercent(initialInvestment, sharedSimulation.raw.risk_metrics.var99, locale)} />
                <SummaryRow label="CVaR 95%" value={krwLossFromPercent(initialInvestment, sharedSimulation.raw.risk_metrics.cvar95, locale)} />
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
