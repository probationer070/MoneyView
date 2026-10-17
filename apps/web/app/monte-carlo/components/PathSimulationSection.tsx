"use client";

import type { PathSimulationInput, SharedSimulationResult } from "../lib/types";
import { useMemo } from "react";
import { AlertTriangle, Square } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS_LINE_STYLE,
  AXIS_TICK_STYLE,
  CHART_COLORS,
  CHART_MARGIN,
  CHART_REFERENCE_COLORS,
  DEFAULT_TOOLTIP_PROPS,
  GRID_STYLE,
  fmtYearsTick,
} from "@/lib/chartConfig";
import { useLocale, useT } from "@/lib/i18n/locale";
import { tokens } from "@/lib/tokens.generated";
import { ChartGuard } from "./ChartGuard";
import { ResultHeader } from "./ResultHeader";
import { RunButton } from "./RunButton";
import { SimulationRail } from "./SimulationRail";
import { WarningBanner } from "./WarningBanner";
import { formatKrwCompact, krwAxis } from "../lib/krwFormat";
import { runStatusView } from "../lib/resultModel";
import { LegendItem, NumericField, SelectField, numberText, pct } from "./shared";

type Props = {
  input: PathSimulationInput;
  sharedSimulation: SharedSimulationResult | null;
  status: "idle" | "loading" | "error" | "cancelled";
  progress: number;
  errorMessage: string | null;
  warnings: string[];
  yearlyTicks: number[];
  update: <K extends keyof PathSimulationInput>(key: K, value: PathSimulationInput[K]) => void;
  runPathSimulation: () => Promise<void>;
  cancelPathSimulation: () => void;
  exportSummaryCsv: () => void;
  exportPercentileConeCsv: () => void;
  exportSamplePathsCsv: () => void;
  exportTerminalDistributionCsv: () => void;
};

export function PathSimulationSection({
  input,
  sharedSimulation,
  status,
  progress,
  errorMessage,
  warnings,
  yearlyTicks,
  update,
  runPathSimulation,
  cancelPathSimulation,
  exportSummaryCsv,
  exportPercentileConeCsv,
  exportSamplePathsCsv,
  exportTerminalDistributionCsv,
}: Props) {
  const { locale } = useLocale();
  const t = useT();
  // Each band is a stacked area: an invisible floor (the lower percentile) plus the band's width.
  const coneData = useMemo(() => (sharedSimulation?.pathSummary ?? []).map((row) => ({
    ...row,
    floor95: row.p05,
    width95: row.p95 - row.p05,
    floor90: row.p10,
    width90: row.p90 - row.p10,
    floor75: row.p25,
    width75: row.p75 - row.p25,
  })), [sharedSimulation]);
  // Opacity of a swatch that shows n stacked bands, as the chart composites them over the panel.
  const bandOpacity = (layers: number) => 1 - (1 - Number(tokens.chart["area-opacity"])) ** layers;

  const running = status === "loading";
  const mode = sharedSimulation?.raw.execution_mode ?? input.executionMode;
  const modeHelp = [
    t(mode === "interactive" ? "monteCarlo.path.help.interactive" : "monteCarlo.path.help.summary"),
    input.executionMode === "interactive" && sharedSimulation?.raw.execution_mode === "summary" ? t("monteCarlo.path.help.promoted") : "",
  ].filter(Boolean).join(" ");
  const range = (label: string, low: number | undefined, high: number | undefined) =>
    `${label} · ${formatKrwCompact(low, locale)}–${formatKrwCompact(high, locale)}`;
  const terminal = sharedSimulation;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
      <SimulationRail
        actions={(
          <>
            <RunButton label={t("monteCarlo.path.run")} onClick={() => void runPathSimulation()} running={running} testId="mc-run-path" />
            <button
              type="button"
              data-testid="mc-cancel-path"
              onClick={cancelPathSimulation}
              disabled={!running}
              className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-4 py-2 type-label text-[var(--ink)] disabled:opacity-50"
            >
              <Square aria-hidden="true" className="h-4 w-4" />
              {t("monteCarlo.path.cancel")}
            </button>
          </>
        )}
      >
        <NumericField label={t("monteCarlo.path.fields.initialInvestment")} value={input.initialInvestment} onChange={(value) => update("initialInvestment", value)} suffix="KRW" min={1_000_000} step={100_000} />
        <NumericField label={t("monteCarlo.path.fields.expectedReturn")} value={input.expectedAnnualReturn} onChange={(value) => update("expectedAnnualReturn", value)} suffix="%" step={0.5} />
        <NumericField label={t("monteCarlo.path.fields.volatility")} value={input.annualVolatility} onChange={(value) => update("annualVolatility", value)} suffix="%" step={0.5} />
        <NumericField label={t("monteCarlo.path.fields.horizon")} value={input.investmentHorizonYears} onChange={(value) => update("investmentHorizonYears", value)} suffix={t("monteCarlo.path.units.years")} min={1} step={1} />
        <NumericField label={t("monteCarlo.path.fields.simulations")} value={input.simulationCount} onChange={(value) => update("simulationCount", value)} min={100} step={100} />
        <div className="grid gap-1">
          <SelectField
            label={t("monteCarlo.path.fields.executionMode")}
            value={input.executionMode}
            onChange={(value) => update("executionMode", value as PathSimulationInput["executionMode"])}
            options={[
              { value: "interactive", label: t("monteCarlo.path.modes.interactive") },
              { value: "summary", label: t("monteCarlo.path.modes.summary") },
            ]}
          />
          <p className="type-small text-[var(--ink-muted)]">{modeHelp}</p>
        </div>
        <NumericField label={t("monteCarlo.path.fields.jumpProbability")} value={input.jumpProbabilityMonthly} onChange={(value) => update("jumpProbabilityMonthly", value)} suffix={t("monteCarlo.path.units.perMonth")} step={0.5} />
        <NumericField label={t("monteCarlo.path.fields.jumpIntensity")} value={input.jumpIntensityMultiplier} onChange={(value) => update("jumpIntensityMultiplier", value)} suffix="x" step={0.25} />
      </SimulationRail>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-auto lg:overflow-visible">
        <ResultHeader
          status={runStatusView(status, progress, sharedSimulation !== null)}
          figures={[
            { key: "median", label: t("monteCarlo.path.figures.median"), value: sharedSimulation?.terminalMedian ?? null, format: (n) => formatKrwCompact(n, locale), hint: t("monteCarlo.path.hints.median") },
            { key: "expectedReturn", label: t("monteCarlo.path.figures.expectedReturn"), value: sharedSimulation?.medianExpectedReturn ?? null, format: (n) => pct(n, locale), hint: t("monteCarlo.path.hints.expectedReturn") },
            { key: "lossProbability", label: t("monteCarlo.path.figures.lossProbability"), value: sharedSimulation?.raw.risk_metrics.loss_probability ?? null, format: (n) => pct(n, locale), hint: t("monteCarlo.path.hints.lossProbability") },
            { key: "sharpe", label: t("monteCarlo.path.figures.sharpe"), value: sharedSimulation?.raw.risk_metrics.sharpe_ratio ?? null, format: (n) => numberText(n, locale), hint: t("monteCarlo.path.hints.sharpe", { rate: pct(input.riskFreeRate, locale) }) },
          ]}
          exports={sharedSimulation ? [
            { key: "summary", label: t("monteCarlo.path.exports.summary"), onSelect: exportSummaryCsv },
            { key: "cone", label: t("monteCarlo.path.exports.cone"), onSelect: exportPercentileConeCsv },
            { key: "paths", label: t("monteCarlo.path.exports.paths"), onSelect: exportSamplePathsCsv },
            { key: "histogram", label: t("monteCarlo.path.exports.histogram"), onSelect: exportTerminalDistributionCsv },
          ] : []}
        />

        {status === "error" ? (
          <div className="flex shrink-0 items-center gap-2 border border-[var(--status-error-border)] bg-[var(--status-error-surface)] px-3 py-2 type-small text-[var(--status-error-ink)]">
            <AlertTriangle aria-hidden="true" className="h-4 w-4" />
            {errorMessage ?? t("monteCarlo.path.runFailed")}
          </div>
        ) : null}
        {status === "cancelled" ? (
          <div className="flex shrink-0 items-center gap-2 border border-[var(--status-warning-border)] bg-[var(--status-warning-surface)] px-3 py-2 type-small text-[var(--status-warning-ink)]">
            <AlertTriangle aria-hidden="true" className="h-4 w-4" />
            {t("monteCarlo.path.cancelledNote")}
          </div>
        ) : null}
        <WarningBanner title={t("monteCarlo.path.warningsTitle")} warnings={warnings} />

        {/* Primary visual outputs: sampled paths and percentile cone, filling the rest of the panel. */}
        <section className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]">
          <ChartGuard
            title={t("monteCarlo.path.paths.title")}
            description={t("monteCarlo.path.paths.description")}
            state={!sharedSimulation ? "empty" : sharedSimulation.pathChartData.length > 0 && sharedSimulation.pathKeys.length > 0 ? "ready" : "invalid"}
            emptyTitle={t("monteCarlo.path.paths.empty")}
            emptyDescription={t("monteCarlo.path.paths.emptyHint")}
            invalidTitle={t("monteCarlo.path.paths.invalid")}
            invalidDescription={t("monteCarlo.path.paths.invalidHint")}
            chartHeight="fill"
            legend={(
              <div className="flex flex-wrap gap-3">
                <LegendItem label={t("monteCarlo.path.legend.sampled")} lineClass="bg-[var(--chart-1)] opacity-50" />
                <LegendItem label={t("monteCarlo.path.legend.average")} lineClass="bg-[var(--ink)]" />
                <LegendItem label={t("monteCarlo.path.legend.principal")} lineClass="bg-[var(--brand)]" />
              </div>
            )}
          >
            <LineChart data={sharedSimulation?.pathChartData ?? []} margin={CHART_MARGIN}>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="time" type="number" domain={[0, input.investmentHorizonYears]} ticks={yearlyTicks} tickFormatter={fmtYearsTick} tick={AXIS_TICK_STYLE} axisLine={AXIS_LINE_STYLE} tickLine={false} />
              <YAxis tickFormatter={krwAxis(locale).tick} label={{ value: t(krwAxis(locale).unitKey), angle: -90, position: "insideLeft", style: AXIS_TICK_STYLE }} tick={AXIS_TICK_STYLE} axisLine={AXIS_LINE_STYLE} tickLine={false} />
              <Tooltip {...DEFAULT_TOOLTIP_PROPS} formatter={(value) => formatKrwCompact(Number(value ?? 0), locale)} labelFormatter={(label) => `${label} ${t("monteCarlo.path.units.years")}`} />
              {/* One colour for every sampled path: a per-index palette would make the paths look like categories. */}
              {sharedSimulation?.pathKeys.map((key) => (
                <Line key={key} dataKey={key} stroke={CHART_COLORS.primary} strokeOpacity={0.5} dot={false} />
              ))}
              <Line type="monotone" dataKey="average_path" stroke={CHART_COLORS.ink} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="principal_line" stroke={CHART_REFERENCE_COLORS.highlight} strokeDasharray="6 4" dot={false} />
            </LineChart>
          </ChartGuard>

          <ChartGuard
            title={t("monteCarlo.path.cone.title")}
            description={t("monteCarlo.path.cone.description")}
            state={!sharedSimulation ? "empty" : sharedSimulation.pathSummary.length > 0 ? "ready" : "invalid"}
            emptyTitle={t("monteCarlo.path.cone.empty")}
            emptyDescription={t("monteCarlo.path.cone.emptyHint")}
            invalidTitle={t("monteCarlo.path.cone.invalid")}
            invalidDescription={t("monteCarlo.path.cone.invalidHint")}
            chartHeight="fill"
            legend={(
              <div data-testid="mc-cone-legend" className="flex flex-wrap gap-x-3 gap-y-1">
                <LegendItem label={range("5%-95%", terminal?.terminalP05, terminal?.terminalP95)} lineClass="bg-[var(--chart-1)]" swatchOpacity={bandOpacity(1)} />
                <LegendItem label={range("10%-90%", terminal?.terminalP10, terminal?.terminalP90)} lineClass="bg-[var(--chart-1)]" swatchOpacity={bandOpacity(2)} />
                <LegendItem label={range("25%-75%", terminal?.terminalP25, terminal?.terminalP75)} lineClass="bg-[var(--chart-1)]" swatchOpacity={bandOpacity(3)} />
                <LegendItem label={`${t("monteCarlo.path.legend.median")} · ${formatKrwCompact(terminal?.terminalMedian, locale)}`} lineClass="bg-[var(--ink)]" />
              </div>
            )}
          >
            <AreaChart data={coneData} margin={CHART_MARGIN}>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="time" type="number" domain={[0, input.investmentHorizonYears]} ticks={yearlyTicks} tickFormatter={fmtYearsTick} tick={AXIS_TICK_STYLE} axisLine={AXIS_LINE_STYLE} tickLine={false} />
              <YAxis tickFormatter={krwAxis(locale).tick} label={{ value: t(krwAxis(locale).unitKey), angle: -90, position: "insideLeft", style: AXIS_TICK_STYLE }} tick={AXIS_TICK_STYLE} axisLine={AXIS_LINE_STYLE} tickLine={false} />
              <Tooltip {...DEFAULT_TOOLTIP_PROPS} formatter={(value) => formatKrwCompact(Number(value ?? 0), locale)} labelFormatter={(label) => `${label} ${t("monteCarlo.path.units.years")}`} />
              {/* Bands: chart-1 at the chart area opacity, nested 5-95, 10-90 and 25-75. The floors are invisible. */}
              <Area type="monotone" dataKey="floor95" stackId="band95" stroke="none" fill="none" tooltipType="none" legendType="none" />
              <Area type="monotone" dataKey="width95" stackId="band95" stroke="none" fill={CHART_COLORS.primary} fillOpacity={Number(tokens.chart["area-opacity"])} tooltipType="none" legendType="none" />
              <Area type="monotone" dataKey="floor90" stackId="band90" stroke="none" fill="none" tooltipType="none" legendType="none" />
              <Area type="monotone" dataKey="width90" stackId="band90" stroke="none" fill={CHART_COLORS.primary} fillOpacity={Number(tokens.chart["area-opacity"])} tooltipType="none" legendType="none" />
              <Area type="monotone" dataKey="floor75" stackId="band75" stroke="none" fill="none" tooltipType="none" legendType="none" />
              <Area type="monotone" dataKey="width75" stackId="band75" stroke="none" fill={CHART_COLORS.primary} fillOpacity={Number(tokens.chart["area-opacity"])} tooltipType="none" legendType="none" />
              {/* Tails in down (lower) and up (upper); the median in ink; the quartile edges in muted ink. */}
              <Line type="monotone" dataKey="p50" stroke={CHART_COLORS.ink} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="p05" stroke={CHART_COLORS.negative} dot={false} />
              <Line type="monotone" dataKey="p10" stroke={CHART_COLORS.negative} dot={false} />
              <Line type="monotone" dataKey="p25" stroke={CHART_COLORS.label} dot={false} />
              <Line type="monotone" dataKey="p75" stroke={CHART_COLORS.label} dot={false} />
              <Line type="monotone" dataKey="p90" stroke={CHART_COLORS.positive} dot={false} />
              <Line type="monotone" dataKey="p95" stroke={CHART_COLORS.positive} dot={false} />
            </AreaChart>
          </ChartGuard>
        </section>
      </div>
    </div>
  );
}
