"use client";

import type { SharedSimulationResult } from "../lib/types";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { ChartGuard } from "./ChartGuard";
import { CHART_COLORS, GRID_STYLE, fmtPctTick, withAxisProps, withTooltipProps } from "@/lib/chartConfig";
import { useLocale, useT } from "@/lib/i18n/locale";
import { HistogramPanel, type HistogramBin } from "@/components/charts/HistogramPanel";
import { ResultHeader, type ResultFigure } from "./ResultHeader";
import { RunNotice } from "./RunNotice";
import { WarningBanner } from "./WarningBanner";
import { numberText, pct } from "./shared";
import { runStatusView, type RunStatus } from "../lib/resultModel";

type Props = {
  sharedSimulation: SharedSimulationResult | null;
  status: RunStatus;
  progress: number;
  errorMessage: string | null;
  warnings: string[];
  onOpenPath: () => void;
  exportReturnHistogramCsv: () => void;
  exportReturnCdfCsv: () => void;
};

// No rail: the distribution comes from the path run. Histogram and CDF sit side by side and fill the chart area.
export function ReturnDistributionSection({
  sharedSimulation,
  status,
  progress,
  errorMessage,
  warnings,
  onOpenPath,
  exportReturnHistogramCsv,
  exportReturnCdfCsv,
}: Props) {
  const { locale } = useLocale();
  const t = useT();
  const risk = sharedSimulation?.raw.risk_metrics;

  const figures: ResultFigure[] = [
    { key: "mean", label: t("monteCarlo.distribution.figures.mean"), value: risk?.mean_return ?? null, format: (n) => pct(n, locale), hint: t("monteCarlo.distribution.hints.mean") },
    { key: "std", label: t("monteCarlo.distribution.figures.std"), value: risk?.volatility ?? null, format: (n) => pct(n, locale), hint: t("monteCarlo.distribution.hints.std") },
    { key: "kurtosis", label: t("monteCarlo.distribution.figures.kurtosis"), value: risk?.kurtosis ?? null, format: (n) => numberText(n, locale), hint: t("monteCarlo.distribution.hints.kurtosis") },
    { key: "max", label: t("monteCarlo.distribution.figures.max"), value: risk?.max_return ?? null, format: (n) => pct(n, locale), hint: t("monteCarlo.distribution.hints.max") },
    { key: "min", label: t("monteCarlo.distribution.figures.min"), value: risk?.min_return ?? null, format: (n) => pct(n, locale), hint: t("monteCarlo.distribution.hints.min") },
  ];

  const cdf = sharedSimulation?.raw.cdf_comparison ?? [];
  const cdfState = !sharedSimulation ? "empty" : cdf.length > 0 ? "ready" : "invalid";

  return (
    <div data-testid="mc-distribution" className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto lg:overflow-visible">
      <ResultHeader
        status={runStatusView(status, progress, sharedSimulation !== null)}
        figures={figures}
        exports={sharedSimulation ? [
          { key: "return-histogram", label: t("monteCarlo.distribution.exports.histogram"), onSelect: exportReturnHistogramCsv },
          { key: "return-cdf", label: t("monteCarlo.distribution.exports.cdf"), onSelect: exportReturnCdfCsv },
        ] : []}
        source={sharedSimulation ? { label: t("monteCarlo.shared.basedOnPath"), openLabel: t("monteCarlo.shared.openPath"), onOpen: onOpenPath } : undefined}
        prompt={!sharedSimulation && status !== "loading" ? { text: t("monteCarlo.shared.runFirst"), actionLabel: t("monteCarlo.shared.openPath"), onAction: onOpenPath } : undefined}
      />

      {status === "error" ? <RunNotice tone="error">{errorMessage ?? t("monteCarlo.path.runFailed")}</RunNotice> : null}
      <WarningBanner title={t("monteCarlo.path.warningsTitle")} warnings={warnings} />

      <section className="grid grid-cols-1 lg:min-h-0 lg:flex-1 gap-3 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]">
        <HistogramPanel
          height="fill"
          title={t("monteCarlo.distribution.histogram.title")}
          description={t("monteCarlo.distribution.histogram.description")}
          data={(sharedSimulation?.returnDistributionChartData ?? []) as unknown as HistogramBin[]}
          emptyTitle={sharedSimulation ? t("monteCarlo.distribution.histogram.invalid") : t("monteCarlo.distribution.empty.title")}
          emptyDescription={sharedSimulation ? t("monteCarlo.distribution.histogram.invalidHint") : t("monteCarlo.distribution.empty.hint")}
        />

        <ChartGuard
          title={t("monteCarlo.distribution.cdf.title")}
          description={t("monteCarlo.distribution.cdf.description")}
          state={cdfState}
          emptyTitle={t("monteCarlo.distribution.cdf.empty")}
          emptyDescription={t("monteCarlo.distribution.cdf.emptyHint")}
          invalidTitle={t("monteCarlo.distribution.cdf.invalid")}
          invalidDescription={t("monteCarlo.distribution.cdf.invalidHint")}
          chartHeight="fill"
        >
          <LineChart data={cdf}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="return" {...withAxisProps({ tickFormatter: (value: number | string) => fmtPctTick(Number(value), 0) })} />
            <YAxis domain={[0, 1]} {...withAxisProps()} />
            <Tooltip {...withTooltipProps()} />
            <Line type="monotone" dataKey="simulated_cdf" stroke={CHART_COLORS.primary} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="normal_cdf" stroke={CHART_COLORS.ink} strokeDasharray="6 4" dot={false} />
          </LineChart>
        </ChartGuard>
      </section>
    </div>
  );
}
