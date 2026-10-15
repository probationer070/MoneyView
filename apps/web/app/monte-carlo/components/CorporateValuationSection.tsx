"use client";

import type { ValuationInput, ValuationResult } from "../lib/types";
import { Download, Loader2, Play, Square } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ActionButton } from "@/components/ui/ActionButton";
import { fieldInputClass } from "@/components/ui/InlineField";
import { MonteCarloRunPanel } from "./MonteCarloRunPanel";
import { MonteCarloTabSummary } from "./MonteCarloTabSummary";
import { ChartGuard } from "./ChartGuard";
import { CHART_COLORS, GRID_STYLE, fmtCompactThousands, withAxisProps, withTooltipProps } from "@/lib/chartConfig";
import { formatNumber } from "@/lib/format";
import { useLocale } from "@/lib/i18n/locale";
import { MetricCard, NumericField, SummaryRow, WarningNotice, krw, numberText, pct } from "./shared";

type Props = {
  valuationInput: ValuationInput;
  valuationResult: ValuationResult | null;
  valuationStatus: "idle" | "loading" | "error" | "cancelled";
  valuationProgress: number;
  warnings: string[];
  valuationPriceLookupStatus: "idle" | "loading" | "fetching" | "success" | "not_found" | "error";
  valuationPriceLookupMessage: string | null;
  updateValuation: <K extends keyof ValuationInput>(key: K, value: ValuationInput[K]) => void;
  onValuationTickerBlur: () => void;
  runValuationSimulation: () => void;
  cancelValuationSimulation: () => void;
  exportValuationSummaryCsv: () => void;
  exportValuationDistributionCsv: () => void;
};

export function CorporateValuationSection({
  valuationInput,
  valuationResult,
  valuationStatus,
  valuationProgress,
  warnings,
  valuationPriceLookupStatus,
  valuationPriceLookupMessage,
  updateValuation,
  onValuationTickerBlur,
  runValuationSimulation,
  cancelValuationSimulation,
  exportValuationSummaryCsv,
  exportValuationDistributionCsv,
}: Props) {
  const { locale } = useLocale();
  const summaryStatus = valuationStatus === "loading"
    ? "in-progress"
    : valuationStatus === "error"
      ? "error"
      : valuationStatus === "cancelled"
        ? "canceled"
        : valuationResult
          ? "live"
          : "idle";
  const summaryLabel = valuationStatus === "loading"
    ? "Running valuation"
    : valuationStatus === "error"
      ? "Run failed"
      : valuationStatus === "cancelled"
        ? "Run canceled"
        : valuationResult
          ? "Results ready"
          : "No analysis run yet";

  return (
    <MonteCarloRunPanel
      controls={(
        <section className="grid grid-cols-1 gap-4 border border-[var(--line)] bg-[var(--surface)] p-4 lg:grid-cols-5">
          <label className="type-label grid gap-1 text-[var(--ink)]">
            Ticker
            <input
              value={valuationInput.ticker}
              onChange={(event) => updateValuation("ticker", event.target.value.toUpperCase())}
              onBlur={onValuationTickerBlur}
              className={fieldInputClass}
            />
          </label>
          <label className="type-label grid gap-1 text-[var(--ink)]">
            Current stock price
            <div className="flex items-center gap-2 rounded-[var(--radius-1)] border border-[var(--line-strong)] bg-[var(--surface-sunken)] px-3 py-2">
              <input
                type="number"
                value={valuationInput.currentPrice}
                min={1000}
                step={100}
                onChange={(event) => updateValuation("currentPrice", Number(event.target.value))}
                className="type-mono w-full bg-transparent text-[var(--ink)] outline-none"
              />
              <span className="type-small text-[var(--ink-muted)]">KRW</span>
              {valuationPriceLookupStatus === "loading" || valuationPriceLookupStatus === "fetching" ? (
                <Loader2 className="h-4 w-4 animate-spin text-[var(--ink-muted)]" />
              ) : null}
            </div>
            {valuationPriceLookupMessage ? (
              <span
                className={
                  valuationPriceLookupStatus === "not_found" || valuationPriceLookupStatus === "error"
                    ? "type-caption text-[var(--status-error-ink)]"
                    : "type-caption text-[var(--ink-muted)]"
                }
              >
                {valuationPriceLookupMessage}
              </span>
            ) : null}
          </label>
          <NumericField label="Base EPS" value={valuationInput.baseEps} onChange={(value) => updateValuation("baseEps", value)} step={50} min={100} suffix="KRW" />
          <NumericField label="Average growth rate" value={valuationInput.averageGrowthRate} onChange={(value) => updateValuation("averageGrowthRate", value)} step={0.5} suffix="%" />
          <NumericField label="Growth uncertainty" value={valuationInput.growthUncertainty} onChange={(value) => updateValuation("growthUncertainty", value)} step={0.25} suffix="%" />
          <NumericField label="Discount rate (WACC)" value={valuationInput.discountRate} onChange={(value) => updateValuation("discountRate", value)} step={0.25} suffix="%" />
          <NumericField label="WACC uncertainty" value={valuationInput.discountRateUncertainty} onChange={(value) => updateValuation("discountRateUncertainty", value)} step={0.25} suffix="%" />
          <NumericField label="Terminal growth rate" value={valuationInput.terminalGrowthRate} onChange={(value) => updateValuation("terminalGrowthRate", value)} step={0.25} suffix="%" />
          <NumericField label="Forecast period" value={valuationInput.forecastPeriodYears} onChange={(value) => updateValuation("forecastPeriodYears", value)} step={1} min={1} suffix="years" />
          <NumericField label="Target PER uncertainty" value={valuationInput.targetPerUncertainty} onChange={(value) => updateValuation("targetPerUncertainty", value)} step={0.25} min={0.25} suffix="x" />
          <NumericField label="Simulation Count" value={valuationInput.simulationCount} onChange={(value) => updateValuation("simulationCount", value)} step={100} min={500} />
          <div className="flex flex-col justify-end gap-2">
            <button
              type="button"
              onClick={runValuationSimulation}
              disabled={valuationStatus === "loading"}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-1)] bg-[var(--brand)] px-5 py-3 type-label text-[var(--on-brand)] disabled:opacity-60"
            >
              {valuationStatus === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Run Valuation
            </button>
            <button
              type="button"
              onClick={cancelValuationSimulation}
              disabled={valuationStatus !== "loading"}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-5 py-3 type-label text-[var(--ink)] disabled:opacity-50"
            >
              <Square className="h-4 w-4" />
              Cancel
            </button>
          </div>
        </section>
      )}
      status={valuationStatus}
      progress={valuationProgress}
      progressLabel="Valuation worker progress"
      errorFallbackMessage="Valuation simulation failed."
      cancelledMessage="Valuation simulation cancelled."
      summary={(
        <MonteCarloTabSummary
          title="Corporate Valuation Summary"
          description="Run controls stay above, while valuation summary and exports stay anchored here before the distribution and statistics cards."
          status={summaryStatus}
          statusLabel={summaryLabel}
          items={[
            { label: "Ticker", value: valuationInput.ticker || "No ticker" },
            { label: "Current price", value: krw(valuationInput.currentPrice, locale) },
            { label: "Simulations", value: formatNumber(valuationInput.simulationCount, "integer", { locale }) },
            { label: "Median fair value", value: valuationResult ? krw(valuationResult.fair_value_summary.fair_value_median, locale) : "Pending" },
          ]}
          actions={valuationResult ? (
            <>
              <ActionButton label="Export Summary CSV" size="sm" onClick={exportValuationSummaryCsv} icon={<Download className="h-4 w-4" />} />
              <ActionButton label="Export Distribution CSV" size="sm" onClick={exportValuationDistributionCsv} icon={<Download className="h-4 w-4" />} />
            </>
          ) : undefined}
        />
      )}
      hasResult={Boolean(valuationResult)}
      emptyState={(
        <div className="border border-dashed border-[var(--line)] bg-[var(--surface-raised)] p-10 text-center type-body text-[var(--ink-muted)]">
          Run the valuation engine to generate fair value distribution, undervaluation probability, z-score, and DCF uncertainty summaries.
        </div>
      )}
      resultContent={valuationResult ? (
        <div className="space-y-6">
          <WarningNotice warnings={warnings} title="Valuation-output normalization warnings" />

          {/* Top-line valuation outputs */}
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Median Fair Value" value={krw(valuationResult.fair_value_summary.fair_value_median, locale)} detail="50th percentile fair value across valuation simulations" />
            <MetricCard label="Undervaluation Probability" value={pct(valuationResult.fair_value_summary.undervaluation_probability, locale)} detail="Probability fair value exceeds current market price" />
            <MetricCard label="Upside Potential" value={pct(valuationResult.fair_value_summary.upside_potential, locale)} detail="Median fair value relative to the current stock price" />
            <MetricCard label="80% Confidence Interval" value={`${krw(valuationResult.fair_value_summary.fair_value_p10, locale)} - ${krw(valuationResult.fair_value_summary.fair_value_p90, locale)}`} detail="P10 to P90 fair value interval" />
          </section>

          {/* Distribution chart and tabular valuation summary */}
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <ChartGuard
                title="Fair Value Distribution"
                description="Single-stock Monte Carlo fair value distribution using EPS growth, discount-rate uncertainty, and target PER uncertainty."
                state={valuationResult.valuation_distribution.length > 0 ? "ready" : "invalid"}
                emptyTitle="No fair-value distribution yet"
                emptyDescription="Run the valuation engine to generate a fair-value distribution."
                invalidTitle="Fair-value distribution data is invalid"
                invalidDescription="The worker result did not contain a chart-safe valuation distribution, so the panel was withheld instead of rendering blank."
                chartHeight={320}
              >
                <BarChart data={valuationResult.valuation_distribution}>
                  <CartesianGrid {...GRID_STYLE} />
                  <XAxis dataKey="fair_value" {...withAxisProps({ tickFormatter: (value: number | string) => fmtCompactThousands(Number(value)) })} />
                  <YAxis {...withAxisProps()} />
                  <Tooltip {...withTooltipProps()} formatter={(value) => formatNumber(Number(value), "percent", { digits: 2, locale })} labelFormatter={(label) => krw(Number(label), locale)} />
                  <ReferenceLine x={valuationResult.fair_value_summary.current_price} stroke={CHART_COLORS.ink} label="Current Price" />
                  <Bar dataKey="frequency" fill={CHART_COLORS.primary} />
                </BarChart>
              </ChartGuard>
            </div>

            <div className="border border-[var(--line)] bg-[var(--surface-raised)] p-5">
              <h2 className="type-panel-title text-[var(--ink)]">Valuation Statistics</h2>
              <div className="mt-4 overflow-hidden border border-[var(--line)]">
                <table className="w-full">
                  <tbody>
                    <SummaryRow label="Current Price" value={krw(valuationResult.fair_value_summary.current_price, locale)} />
                    <SummaryRow label="Mean Fair Value" value={krw(valuationResult.fair_value_summary.fair_value_mean, locale)} />
                    <SummaryRow label="Std. deviation" value={krw(valuationResult.fair_value_summary.fair_value_std, locale)} />
                    <SummaryRow label="P05" value={krw(valuationResult.fair_value_summary.fair_value_p05, locale)} />
                    <SummaryRow label="P10" value={krw(valuationResult.fair_value_summary.fair_value_p10, locale)} />
                    <SummaryRow label="P25" value={krw(valuationResult.fair_value_summary.fair_value_p25, locale)} />
                    <SummaryRow label="Median" value={krw(valuationResult.fair_value_summary.fair_value_median, locale)} />
                    <SummaryRow label="P75" value={krw(valuationResult.fair_value_summary.fair_value_p75, locale)} />
                    <SummaryRow label="P90" value={krw(valuationResult.fair_value_summary.fair_value_p90, locale)} />
                    <SummaryRow label="P95" value={krw(valuationResult.fair_value_summary.fair_value_p95, locale)} />
                    <SummaryRow label="Undervaluation Probability" value={pct(valuationResult.fair_value_summary.undervaluation_probability, locale)} />
                    <SummaryRow label="Z-score" value={numberText(valuationResult.fair_value_summary.z_score, locale)} />
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    />
  );
}
