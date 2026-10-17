"use client";

import type { SharedSimulationResult } from "../lib/types";
import { useState } from "react";
import { ReferenceLine } from "recharts";
import { CHART_COLORS } from "@/lib/chartConfig";
import { MISSING } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import { HistogramPanel, type HistogramBin } from "@/components/charts/HistogramPanel";
import { PercentileBandPanel } from "@/components/charts/PercentileBandPanel";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { ResultHeader, type ResultFigure } from "./ResultHeader";
import { RunNotice } from "./RunNotice";
import { WarningBanner } from "./WarningBanner";
import { LegendItem, SummaryRow, numberText, pct } from "./shared";
import { formatKrwCompact, krwAxis } from "../lib/krwFormat";
import { runStatusView, type RunStatus } from "../lib/resultModel";

type Props = {
  sharedSimulation: SharedSimulationResult | null;
  initialInvestment: number;
  status: RunStatus;
  progress: number;
  errorMessage: string | null;
  warnings: string[];
  onOpenPath: () => void;
  exportRiskSummaryCsv: () => void;
  exportRiskHistogramCsv: () => void;
};

type RiskView = "var" | "percentiles";

// No rail: the risk figures come from the path run. Before a run the figures read a dash and the tab asks for one.
export function RiskAnalysisSection({
  sharedSimulation,
  initialInvestment,
  status,
  progress,
  errorMessage,
  warnings,
  onOpenPath,
  exportRiskSummaryCsv,
  exportRiskHistogramCsv,
}: Props) {
  const { locale } = useLocale();
  const t = useT();
  const [view, setView] = useState<RiskView>("var");
  const risk = sharedSimulation?.raw.risk_metrics;
  const lossWon = (lossPercent: number | undefined) => (sharedSimulation && lossPercent !== undefined ? initialInvestment * (lossPercent / 100) : null);
  const level = (lossPercent: number) => pct(lossPercent, locale);

  const figures: ResultFigure[] = [
    { key: "var95", label: t("monteCarlo.risk.figures.var95"), value: lossWon(risk?.var95), format: (n) => formatKrwCompact(n, locale), hint: risk ? t("monteCarlo.risk.hints.var", { level: level(risk.var95) }) : undefined },
    { key: "var99", label: t("monteCarlo.risk.figures.var99"), value: lossWon(risk?.var99), format: (n) => formatKrwCompact(n, locale), hint: risk ? t("monteCarlo.risk.hints.var", { level: level(risk.var99) }) : undefined },
    { key: "cvar95", label: t("monteCarlo.risk.figures.cvar95"), value: lossWon(risk?.cvar95), format: (n) => formatKrwCompact(n, locale), hint: t("monteCarlo.risk.hints.cvar95") },
    { key: "maxDrawdown", label: t("monteCarlo.risk.figures.maxDrawdown"), value: sharedSimulation?.medianMaxDrawdown ?? null, format: (n) => pct(n, locale), hint: t("monteCarlo.risk.hints.maxDrawdown") },
    { key: "sortino", label: t("monteCarlo.risk.figures.sortino"), value: risk?.sortino_ratio ?? null, format: (n) => numberText(n, locale), hint: t("monteCarlo.risk.hints.sortino") },
    { key: "skewness", label: t("monteCarlo.risk.figures.skewness"), value: risk?.skewness ?? null, format: (n) => numberText(n, locale), hint: t("monteCarlo.risk.hints.skewness") },
  ];

  const percentileData = sharedSimulation ? [
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
  })) : [];

  const cell = (value: number | undefined, format: (n: number) => string) => (value === undefined ? MISSING : format(value));
  const summaryRows = [
    { label: t("monteCarlo.risk.summary.mean"), value: cell(risk?.mean_return, (n) => pct(n, locale)) },
    { label: t("monteCarlo.risk.summary.median"), value: cell(risk?.median_return, (n) => pct(n, locale)) },
    { label: t("monteCarlo.risk.summary.stdev"), value: cell(risk?.volatility, (n) => pct(n, locale)) },
    { label: t("monteCarlo.risk.summary.sharpe"), value: cell(risk?.sharpe_ratio, (n) => numberText(n, locale)) },
    { label: t("monteCarlo.risk.summary.sortino"), value: cell(risk?.sortino_ratio, (n) => numberText(n, locale)) },
    { label: t("monteCarlo.risk.summary.skewness"), value: cell(risk?.skewness, (n) => numberText(n, locale)) },
    { label: t("monteCarlo.risk.summary.kurtosis"), value: cell(risk?.excess_kurtosis, (n) => numberText(n, locale)) },
    { label: t("monteCarlo.risk.summary.var95"), value: cell(lossWon(risk?.var95) ?? undefined, (n) => formatKrwCompact(n, locale)) },
    { label: t("monteCarlo.risk.summary.var99"), value: cell(lossWon(risk?.var99) ?? undefined, (n) => formatKrwCompact(n, locale)) },
    { label: t("monteCarlo.risk.summary.cvar95"), value: cell(lossWon(risk?.cvar95) ?? undefined, (n) => formatKrwCompact(n, locale)) },
  ];

  const varInvalid = sharedSimulation ? t("monteCarlo.risk.var.invalid") : t("monteCarlo.risk.empty.title");
  const percentilesInvalid = sharedSimulation ? t("monteCarlo.risk.percentiles.invalid") : t("monteCarlo.risk.empty.title");

  return (
    <div data-testid="mc-risk" className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto lg:overflow-visible">
      <ResultHeader
        status={runStatusView(status, progress, sharedSimulation !== null)}
        figures={figures}
        exports={sharedSimulation ? [
          { key: "risk-summary", label: t("monteCarlo.risk.exports.summary"), onSelect: exportRiskSummaryCsv },
          { key: "risk-histogram", label: t("monteCarlo.risk.exports.histogram"), onSelect: exportRiskHistogramCsv },
        ] : []}
        source={sharedSimulation ? { label: t("monteCarlo.shared.basedOnPath"), openLabel: t("monteCarlo.shared.openPath"), onOpen: onOpenPath } : undefined}
        prompt={!sharedSimulation && status !== "loading" ? { text: t("monteCarlo.shared.runFirst"), actionLabel: t("monteCarlo.shared.openPath"), onAction: onOpenPath } : undefined}
      />

      {status === "error" ? <RunNotice tone="error">{errorMessage ?? t("monteCarlo.path.runFailed")}</RunNotice> : null}
      <WarningBanner title={t("monteCarlo.path.warningsTitle")} warnings={warnings} />

      <section className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="flex min-h-0 min-w-0 flex-col gap-3 lg:col-span-2">
          <div>
            <ToggleGroup
              ariaLabel={t("monteCarlo.risk.view.aria")}
              size="sm"
              value={view}
              onChange={(next) => setView(next === "percentiles" ? "percentiles" : "var")}
              options={[
                { value: "var", label: t("monteCarlo.risk.view.var") },
                { value: "percentiles", label: t("monteCarlo.risk.view.percentiles") },
              ]}
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            {view === "var" ? (
              <HistogramPanel
                height="fill"
                title={t("monteCarlo.risk.var.title")}
                description={t("monteCarlo.risk.var.description")}
                data={(sharedSimulation?.raw.histogram ?? []) as unknown as HistogramBin[]}
                emptyTitle={varInvalid}
                emptyDescription={sharedSimulation ? t("monteCarlo.risk.var.invalidHint") : t("monteCarlo.risk.empty.hint")}
                legend={(
                  <div className="flex flex-wrap gap-3">
                    <LegendItem label={t("monteCarlo.risk.legend.lossBuckets")} lineClass="bg-[var(--down)]" />
                    <LegendItem label={t("monteCarlo.risk.legend.gainBuckets")} lineClass="bg-[var(--up)]" />
                    <LegendItem label={t("monteCarlo.risk.legend.var95")} lineClass="bg-[var(--status-warning-ink)]" />
                    <LegendItem label={t("monteCarlo.risk.legend.var99")} lineClass="bg-[var(--brand)]" />
                    <LegendItem label={t("monteCarlo.risk.legend.cvar95")} lineClass="bg-[var(--ink)]" />
                  </div>
                )}
              >
                {sharedSimulation ? (
                  <>
                    <ReferenceLine x={-sharedSimulation.raw.risk_metrics.var95} stroke="var(--status-warning-ink)" label="VaR 95" />
                    <ReferenceLine x={-sharedSimulation.raw.risk_metrics.var99} stroke="var(--brand)" label="VaR 99" />
                    <ReferenceLine x={-sharedSimulation.raw.risk_metrics.cvar95} stroke={CHART_COLORS.ink} strokeDasharray="6 4" label="CVaR 95" />
                  </>
                ) : null}
              </HistogramPanel>
            ) : (
              <PercentileBandPanel
                height="fill"
                title={t("monteCarlo.risk.percentiles.title")}
                description={t("monteCarlo.risk.percentiles.description")}
                data={percentileData}
                valueLabel={t("monteCarlo.units.terminalValue")}
                valueFormatter={(val) => formatKrwCompact(val, locale)}
                yTickFormatter={krwAxis(locale).tick}
                yAxisLabel={t(krwAxis(locale).unitKey)}
                emptyTitle={percentilesInvalid}
                emptyDescription={sharedSimulation ? t("monteCarlo.risk.percentiles.invalidHint") : t("monteCarlo.risk.empty.hint")}
              />
            )}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col border border-[var(--line)] bg-[var(--surface-raised)] p-5">
          <h2 className="type-panel-title text-[var(--ink)]">{t("monteCarlo.risk.summary.title")}</h2>
          <div className="mt-4 min-h-0 flex-1 overflow-auto border border-[var(--line)]">
            <table className="w-full">
              <tbody>
                {summaryRows.map((row) => <SummaryRow key={row.label} label={row.label} value={row.value} />)}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
