"use client";

import type { LookupMessage, ValuationInput, ValuationResult } from "../lib/types";
import { Loader2 } from "lucide-react";
import clsx from "clsx";
import { Bar, BarChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { fieldInputClass } from "@/components/ui/InlineField";
import { CHART_COLORS, GRID_STYLE, fmtCompactThousands, withAxisProps, withTooltipProps } from "@/lib/chartConfig";
import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import { CancelButton } from "./CancelButton";
import { ChartGuard } from "./ChartGuard";
import { ResultHeader, type ResultFigure } from "./ResultHeader";
import { RunButton } from "./RunButton";
import { RunNotice } from "./RunNotice";
import { SimulationRail } from "./SimulationRail";
import { WarningBanner } from "./WarningBanner";
import { NumericField, SummaryRow, numberText, pct } from "./shared";
import { formatKrwRange, krw } from "../lib/krwFormat";
import { runStatusView } from "../lib/resultModel";

type Props = {
  valuationInput: ValuationInput;
  valuationResult: ValuationResult | null;
  valuationStatus: "idle" | "loading" | "error" | "cancelled";
  valuationProgress: number;
  warnings: string[];
  valuationPriceLookupStatus: "idle" | "loading" | "fetching" | "success" | "not_found" | "error";
  valuationPriceLookupMessage: LookupMessage;
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
  const t = useT();
  const running = valuationStatus === "loading";
  const summary = valuationResult?.fair_value_summary;
  const lookupText = valuationPriceLookupMessage === null
    ? null
    : "raw" in valuationPriceLookupMessage
      ? valuationPriceLookupMessage.raw
      : t(valuationPriceLookupMessage.key, valuationPriceLookupMessage.vars);
  const lookupFailed = valuationPriceLookupStatus === "not_found" || valuationPriceLookupStatus === "error";

  const figures: ResultFigure[] = [
    { key: "median", label: t("monteCarlo.valuation.figures.median"), value: summary?.fair_value_median ?? null, format: (n) => krw(n, locale), hint: t("monteCarlo.valuation.hints.median") },
    { key: "undervaluation", label: t("monteCarlo.valuation.figures.undervaluation"), value: summary?.undervaluation_probability ?? null, format: (n) => pct(n, locale), hint: t("monteCarlo.valuation.hints.undervaluation") },
    { key: "upside", label: t("monteCarlo.valuation.figures.upside"), value: summary?.upside_potential ?? null, format: (n) => pct(n, locale), hint: t("monteCarlo.valuation.hints.upside") },
    { key: "interval80", label: t("monteCarlo.valuation.figures.interval80"), value: summary?.fair_value_p10 ?? null, format: (lo) => formatKrwRange(lo, summary?.fair_value_p90 ?? null, locale), hint: t("monteCarlo.valuation.hints.interval80") },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
      <SimulationRail
        actions={(
          <>
            <RunButton label={t("monteCarlo.valuation.run")} onClick={runValuationSimulation} running={running} testId="mc-run-valuation" />
            <CancelButton label={t("monteCarlo.valuation.cancel")} onClick={cancelValuationSimulation} disabled={!running} testId="mc-cancel-valuation" />
          </>
        )}
      >
        <div className="grid gap-1">
          <label className="type-label grid gap-1 text-[var(--ink)]">
            {t("monteCarlo.valuation.fields.ticker")}
            <input
              value={valuationInput.ticker}
              onChange={(event) => updateValuation("ticker", event.target.value.toUpperCase())}
              onBlur={onValuationTickerBlur}
              className={fieldInputClass}
            />
          </label>
          {lookupText ? (
            <p
              role="status"
              data-testid="mc-price-lookup"
              className={clsx("type-caption", lookupFailed ? "text-[var(--status-error-ink)]" : "text-[var(--ink-muted)]")}
            >
              {lookupText}
            </p>
          ) : null}
        </div>
        <label className="type-label grid gap-1 text-[var(--ink)]">
          {t("monteCarlo.valuation.fields.currentPrice")}
          <div className="flex items-center gap-2 rounded-[var(--radius-1)] border border-[var(--line-strong)] bg-[var(--surface-sunken)] px-3 py-2">
            <input
              type="number"
              value={valuationInput.currentPrice}
              min={1000}
              step={100}
              onChange={(event) => updateValuation("currentPrice", Number(event.target.value))}
              className="type-mono w-full bg-transparent text-[var(--ink)] outline-none"
            />
            <span className="type-small text-[var(--ink-muted)]">{t("monteCarlo.units.krw")}</span>
            {valuationPriceLookupStatus === "loading" || valuationPriceLookupStatus === "fetching" ? (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--ink-muted)]" />
            ) : null}
          </div>
        </label>
        <NumericField label={t("monteCarlo.valuation.fields.baseEps")} value={valuationInput.baseEps} onChange={(value) => updateValuation("baseEps", value)} step={50} min={100} suffix={t("monteCarlo.units.krw")} />
        <NumericField label={t("monteCarlo.valuation.fields.averageGrowthRate")} value={valuationInput.averageGrowthRate} onChange={(value) => updateValuation("averageGrowthRate", value)} step={0.5} suffix="%" />
        <NumericField label={t("monteCarlo.valuation.fields.growthUncertainty")} value={valuationInput.growthUncertainty} onChange={(value) => updateValuation("growthUncertainty", value)} step={0.25} suffix="%" />
        <NumericField label={t("monteCarlo.valuation.fields.discountRate")} value={valuationInput.discountRate} onChange={(value) => updateValuation("discountRate", value)} step={0.25} suffix="%" />
        <NumericField label={t("monteCarlo.valuation.fields.discountRateUncertainty")} value={valuationInput.discountRateUncertainty} onChange={(value) => updateValuation("discountRateUncertainty", value)} step={0.25} suffix="%" />
        <NumericField label={t("monteCarlo.valuation.fields.terminalGrowthRate")} value={valuationInput.terminalGrowthRate} onChange={(value) => updateValuation("terminalGrowthRate", value)} step={0.25} suffix="%" />
        <NumericField label={t("monteCarlo.valuation.fields.forecastPeriod")} value={valuationInput.forecastPeriodYears} onChange={(value) => updateValuation("forecastPeriodYears", value)} step={1} min={1} suffix={t("monteCarlo.path.units.years")} />
        <NumericField label={t("monteCarlo.valuation.fields.targetPerUncertainty")} value={valuationInput.targetPerUncertainty} onChange={(value) => updateValuation("targetPerUncertainty", value)} step={0.25} min={0.25} suffix="x" />
        <NumericField label={t("monteCarlo.valuation.fields.simulationCount")} value={valuationInput.simulationCount} onChange={(value) => updateValuation("simulationCount", value)} step={100} min={500} />
      </SimulationRail>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-auto lg:overflow-visible">
        <ResultHeader
          status={runStatusView(valuationStatus, valuationProgress, valuationResult !== null)}
          figures={figures}
          exports={valuationResult ? [
            { key: "valuation-summary", label: t("monteCarlo.valuation.exports.summary"), onSelect: exportValuationSummaryCsv },
            { key: "valuation-distribution", label: t("monteCarlo.valuation.exports.distribution"), onSelect: exportValuationDistributionCsv },
          ] : []}
        />

        {valuationStatus === "error" ? <RunNotice tone="error">{t("monteCarlo.valuation.runFailed")}</RunNotice> : null}
        {valuationStatus === "cancelled" ? <RunNotice tone="warning">{t("monteCarlo.valuation.cancelledNote")}</RunNotice> : null}
        <WarningBanner title={t("monteCarlo.valuation.warningsTitle")} warnings={warnings} />

        <section className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="flex min-h-0 min-w-0 flex-col lg:col-span-2">
            <ChartGuard
              title={t("monteCarlo.valuation.distribution.title")}
              description={t("monteCarlo.valuation.distribution.description")}
              state={!valuationResult ? "empty" : valuationResult.valuation_distribution.length > 0 ? "ready" : "invalid"}
              emptyTitle={t("monteCarlo.valuation.distribution.empty")}
              emptyDescription={t("monteCarlo.valuation.distribution.emptyHint")}
              invalidTitle={t("monteCarlo.valuation.distribution.invalid")}
              invalidDescription={t("monteCarlo.valuation.distribution.invalidHint")}
              chartHeight="fill"
            >
              <BarChart data={valuationResult?.valuation_distribution ?? []}>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="fair_value" {...withAxisProps({ tickFormatter: (value: number | string) => fmtCompactThousands(Number(value)) })} />
                <YAxis {...withAxisProps()} />
                <Tooltip {...withTooltipProps()} formatter={(value) => formatNumber(Number(value), "percent", { digits: 2, locale })} labelFormatter={(label) => krw(Number(label), locale)} />
                {summary ? <ReferenceLine x={summary.current_price} stroke={CHART_COLORS.ink} label={t("monteCarlo.valuation.distribution.currentPrice")} /> : null}
                <Bar dataKey="frequency" fill={CHART_COLORS.primary} />
              </BarChart>
            </ChartGuard>
          </div>

          <div className="flex min-h-0 min-w-0 flex-col border border-[var(--line)] bg-[var(--surface-raised)] p-5">
            <h2 className="type-panel-title text-[var(--ink)]">{t("monteCarlo.valuation.statistics.title")}</h2>
            <div className="mt-4 min-h-0 flex-1 overflow-auto border border-[var(--line)]">
              {summary ? (
                <table className="w-full">
                  <tbody>
                    <SummaryRow label={t("monteCarlo.valuation.statistics.currentPrice")} value={krw(summary.current_price, locale)} />
                    <SummaryRow label={t("monteCarlo.valuation.statistics.mean")} value={krw(summary.fair_value_mean, locale)} />
                    <SummaryRow label={t("monteCarlo.valuation.statistics.stdev")} value={krw(summary.fair_value_std, locale)} />
                    <SummaryRow label={t("monteCarlo.valuation.statistics.p05")} value={krw(summary.fair_value_p05, locale)} />
                    <SummaryRow label={t("monteCarlo.valuation.statistics.p10")} value={krw(summary.fair_value_p10, locale)} />
                    <SummaryRow label={t("monteCarlo.valuation.statistics.p25")} value={krw(summary.fair_value_p25, locale)} />
                    <SummaryRow label={t("monteCarlo.valuation.statistics.median")} value={krw(summary.fair_value_median, locale)} />
                    <SummaryRow label={t("monteCarlo.valuation.statistics.p75")} value={krw(summary.fair_value_p75, locale)} />
                    <SummaryRow label={t("monteCarlo.valuation.statistics.p90")} value={krw(summary.fair_value_p90, locale)} />
                    <SummaryRow label={t("monteCarlo.valuation.statistics.p95")} value={krw(summary.fair_value_p95, locale)} />
                    <SummaryRow label={t("monteCarlo.valuation.statistics.undervaluation")} value={pct(summary.undervaluation_probability, locale)} />
                    <SummaryRow label={t("monteCarlo.valuation.statistics.zScore")} value={numberText(summary.z_score, locale)} />
                  </tbody>
                </table>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
