"use client";

import type { PathSimulationInput, SharedSimulationResult } from "../lib/types";
import { useMemo } from "react";
import { Download, Loader2, Play, Square } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { ActionButton } from "@/components/ui/ActionButton";
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
import { formatNumber } from "@/lib/format";
import { useLocale } from "@/lib/i18n/locale";
import { tokens } from "@/lib/tokens.generated";
import { MonteCarloRunPanel } from "./MonteCarloRunPanel";
import { MonteCarloTabSummary } from "./MonteCarloTabSummary";
import { ChartGuard } from "./ChartGuard";
import {
  LegendItem,
  MetricCard,
  NumericField,
  PercentileIndicator,
  SelectField,
  TEN_THOUSAND_KRW,
  WarningNotice,
  krwTenThousands,
  numberText,
  pct,
} from "./shared";

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
  const summaryStatus = status === "loading"
    ? "in-progress"
    : status === "error"
      ? "error"
      : status === "cancelled"
        ? "canceled"
        : sharedSimulation
          ? "live"
          : "idle";
  const summaryLabel = status === "loading"
    ? "Running path simulation"
    : status === "error"
      ? "Run failed"
      : status === "cancelled"
        ? "Run canceled"
        : sharedSimulation
          ? "Results ready"
          : "No analysis run yet";

  return (
    <MonteCarloRunPanel
      status={status}
      progress={progress}
      progressLabel="Worker progress"
      errorMessage={errorMessage}
      errorFallbackMessage="Worker simulation failed."
      cancelledMessage="Simulation cancelled."
      controls={(
        <div className="flex flex-col gap-2 lg:flex-row">
          <section className="grid grid-cols-2 gap-4 border border-[var(--line)] bg-[var(--surface)] p-4 lg:grid-cols-4">
            <NumericField label="Initial investment" value={input.initialInvestment} onChange={(value) => update("initialInvestment", value)} suffix="KRW" min={1_000_000} step={100_000} />
            <NumericField label="Expected annual return" value={input.expectedAnnualReturn} onChange={(value) => update("expectedAnnualReturn", value)} suffix="%" step={0.5} />
            <NumericField label="Annual volatility (sigma)" value={input.annualVolatility} onChange={(value) => update("annualVolatility", value)} suffix="%" step={0.5} />
            <NumericField label="Investment horizon" value={input.investmentHorizonYears} onChange={(value) => update("investmentHorizonYears", value)} suffix="years" min={1} step={1} />
            <NumericField label="Number of simulations" value={input.simulationCount} onChange={(value) => update("simulationCount", value)} min={100} step={100} />
            <SelectField
              label="Execution mode"
              value={input.executionMode}
              onChange={(value) => update("executionMode", value as PathSimulationInput["executionMode"])}
              options={[
                { value: "interactive", label: "Interactive" },
                { value: "summary", label: "Large Summary" },
              ]}
            />
            <NumericField label="Jump probability" value={input.jumpProbabilityMonthly} onChange={(value) => update("jumpProbabilityMonthly", value)} suffix="% / month" step={0.5} />
            <NumericField label="Jump intensity" value={input.jumpIntensityMultiplier} onChange={(value) => update("jumpIntensityMultiplier", value)} suffix="x" step={0.25} />
          </section>

          <div className="flex flex-col justify-between">
            <div className="flex flex-col justify-end gap-2">
              <button
                type="button"
                onClick={() => void runPathSimulation()}
                disabled={status === "loading"}
                className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-1)] bg-[var(--brand)] px-5 py-3 type-label text-[var(--on-brand)] disabled:opacity-60"
              >
                {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Run Path Simulation
              </button>
              <button
                type="button"
                onClick={cancelPathSimulation}
                disabled={status !== "loading"}
                className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-5 py-3 type-label text-[var(--ink)] disabled:opacity-50"
              >
                <Square className="h-4 w-4" />
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      helper={(
        <div className="border border-[var(--line)] bg-[var(--surface-raised)] p-4 type-body text-[var(--ink-muted)]">
          <span className="type-label text-[var(--ink)]">Execution mode:</span>{" "}
          {(sharedSimulation?.raw.execution_mode ?? input.executionMode) === "interactive"
            ? "Interactive keeps a richer path sample for the path chart."
            : "Large Summary keeps percentile summaries, terminal distribution, and a small path sample to avoid storing large path matrices."}
          {input.executionMode === "interactive" && sharedSimulation?.raw.execution_mode === "summary" ? " Large runs are automatically promoted to Large Summary mode." : ""}
        </div>
      )}
      summary={(
        <MonteCarloTabSummary
          title="Path Simulation Summary"
          description="The shared path engine drives the Path, Risk Analysis, and Return Distribution tabs. Exports are anchored here before the visual outputs."
          status={summaryStatus}
          statusLabel={summaryLabel}
          items={[
            { label: "Execution mode", value: sharedSimulation?.raw.execution_mode ?? input.executionMode },
            { label: "Horizon", value: `${input.investmentHorizonYears} years` },
            { label: "Simulations", value: formatNumber(input.simulationCount, "integer", { locale }) },
            { label: "Median terminal", value: krwTenThousands(sharedSimulation?.terminalMedian ?? input.initialInvestment, locale) },
          ]}
          actions={sharedSimulation ? (
            <>
              <ActionButton label="Export Summary CSV" size="sm" onClick={exportSummaryCsv} icon={<Download className="h-4 w-4" />} />
              <ActionButton label="Export Cone CSV" size="sm" onClick={exportPercentileConeCsv} icon={<Download className="h-4 w-4" />} />
              <ActionButton label="Export Paths CSV" size="sm" onClick={exportSamplePathsCsv} icon={<Download className="h-4 w-4" />} />
              <ActionButton label="Export Histogram CSV" size="sm" onClick={exportTerminalDistributionCsv} icon={<Download className="h-4 w-4" />} />
            </>
          ) : undefined}
        />
      )}
    >
      <WarningNotice warnings={warnings} title="Path output normalization warnings" />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Median terminal value" value={krwTenThousands(sharedSimulation?.terminalMedian ?? input.initialInvestment, locale)} detail="50th percentile ending value in 10,000 KRW units" />
        <MetricCard label="Expected return" value={pct(sharedSimulation?.medianExpectedReturn ?? 0, locale)} detail="Computed from the median terminal value relative to principal" />
        <MetricCard label="Loss probability" value={pct(sharedSimulation?.raw.risk_metrics.loss_probability ?? 0, locale)} detail="Probability terminal value ends below principal" />
        <MetricCard label="Sharpe ratio" value={numberText(sharedSimulation?.raw.risk_metrics.sharpe_ratio ?? 0, locale)} detail={`Annualized Sharpe with rf = ${pct(input.riskFreeRate, locale)}`} />
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <PercentileIndicator label="5%-95%" value={`${krwTenThousands(sharedSimulation?.terminalP05 ?? input.initialInvestment, locale)} - ${krwTenThousands(sharedSimulation?.terminalP95 ?? input.initialInvestment, locale)}`} colorClass="bg-[var(--chart-1)] opacity-40" description="The widest displayed confidence interval. About 90% of simulated terminal outcomes fall between the 5th and 95th percentiles." />
        <PercentileIndicator label="10%-90%" value={`${krwTenThousands(sharedSimulation?.terminalP10 ?? input.initialInvestment, locale)} - ${krwTenThousands(sharedSimulation?.terminalP90 ?? input.initialInvestment, locale)}`} colorClass="bg-[var(--chart-1)] opacity-70" description="A slightly tighter confidence interval. About 80% of simulated terminal outcomes fall between the 10th and 90th percentiles." />
        <PercentileIndicator label="25%-75%" value={`${krwTenThousands(sharedSimulation?.terminalP25 ?? input.initialInvestment, locale)} - ${krwTenThousands(sharedSimulation?.terminalP75 ?? input.initialInvestment, locale)}`} colorClass="bg-[var(--chart-1)]" description="The interquartile range. It captures the middle 50% of simulated outcomes and shows the most typical dispersion." />
        <PercentileIndicator label="Median" value={krwTenThousands(sharedSimulation?.terminalMedian ?? input.initialInvestment, locale)} colorClass="bg-[var(--ink)]" description="The 50th percentile terminal value. Half of simulations finish above this value and half finish below it." />
      </section>

      {/* Primary visual outputs: sampled paths and percentile cone */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartGuard
          title="GBM + Jump-Diffusion Simulated Paths"
          description="A subset of simulated KRW investment paths under drift, diffusion, and jump shocks."
          state={!sharedSimulation ? "empty" : sharedSimulation.pathChartData.length > 0 && sharedSimulation.pathKeys.length > 0 ? "ready" : "invalid"}
          emptyTitle="No path simulation data yet"
          emptyDescription="Run the path simulation to generate a sampled path view."
          invalidTitle="Path chart data is invalid"
          invalidDescription="The worker returned incomplete or non-finite sampled paths, so the chart was withheld instead of rendering a blank panel."
          chartHeight={320}
          legend={(
            <div className="flex flex-wrap gap-3">
              <LegendItem label="Sampled Paths" lineClass="bg-[var(--chart-1)] opacity-50" />
              <LegendItem label="Average Path" lineClass="bg-[var(--ink)]" />
              <LegendItem label="Principal Line" lineClass="bg-[var(--brand)]" />
            </div>
          )}
        >
          <LineChart data={sharedSimulation?.pathChartData ?? []} margin={CHART_MARGIN}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="time" type="number" domain={[0, input.investmentHorizonYears]} ticks={yearlyTicks} tickFormatter={fmtYearsTick} tick={AXIS_TICK_STYLE} axisLine={AXIS_LINE_STYLE} tickLine={false} />
            <YAxis tickFormatter={(value) => formatNumber(Math.round(value / TEN_THOUSAND_KRW), "integer", { locale })} tick={AXIS_TICK_STYLE} axisLine={AXIS_LINE_STYLE} tickLine={false} />
            <Tooltip {...DEFAULT_TOOLTIP_PROPS} formatter={(value) => krwTenThousands(Number(value ?? 0), locale)} labelFormatter={(label) => `${label} years`} />
            {/* One colour for every sampled path: a per-index palette would make the paths look like categories. */}
            {sharedSimulation?.pathKeys.map((key) => (
              <Line key={key} dataKey={key} stroke={CHART_COLORS.primary} strokeOpacity={0.5} dot={false} />
            ))}
            <Line type="monotone" dataKey="average_path" stroke={CHART_COLORS.ink} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="principal_line" stroke={CHART_REFERENCE_COLORS.highlight} strokeDasharray="6 4" dot={false} />
          </LineChart>
        </ChartGuard>

        <ChartGuard
          title="Percentile Cone"
          description="Confidence interval labels: 5%-95%, 10%-90%, 25%-75%, and Median."
          state={!sharedSimulation ? "empty" : sharedSimulation.pathSummary.length > 0 ? "ready" : "invalid"}
          emptyTitle="No percentile-cone data yet"
          emptyDescription="Run the path simulation to generate percentile bands."
          invalidTitle="Percentile-cone data is invalid"
          invalidDescription="The worker result did not include a chart-safe percentile summary, so the cone chart was withheld instead of rendering blank."
          chartHeight={320}
          legend={(
            <div className="flex flex-wrap gap-3">
              <LegendItem label="5%-95%" lineClass="bg-[var(--chart-1)] opacity-40" />
              <LegendItem label="10%-90%" lineClass="bg-[var(--chart-1)] opacity-70" />
              <LegendItem label="25%-75%" lineClass="bg-[var(--chart-1)]" />
              <LegendItem label="Median" lineClass="bg-[var(--ink)]" />
            </div>
          )}
        >
          <AreaChart data={coneData} margin={CHART_MARGIN}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="time" type="number" domain={[0, input.investmentHorizonYears]} ticks={yearlyTicks} tickFormatter={fmtYearsTick} tick={AXIS_TICK_STYLE} axisLine={AXIS_LINE_STYLE} tickLine={false} />
            <YAxis tickFormatter={(value) => formatNumber(Math.round(value / TEN_THOUSAND_KRW), "integer", { locale })} tick={AXIS_TICK_STYLE} axisLine={AXIS_LINE_STYLE} tickLine={false} />
            <Tooltip {...DEFAULT_TOOLTIP_PROPS} formatter={(value) => krwTenThousands(Number(value ?? 0), locale)} labelFormatter={(label) => `${label} years`} />
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

      {/* Compact echo of the active simulation assumptions */}
      <section className="border border-[var(--line)] bg-[var(--surface-raised)] p-5">
        <h2 className="type-panel-title text-[var(--ink)]">Simulation Setup</h2>
        <div className="mt-3 grid grid-cols-1 gap-2 type-body text-[var(--ink-muted)] md:grid-cols-2 xl:grid-cols-4">
          <div>Principal: {krwTenThousands(input.initialInvestment, locale)}</div>
          <div>Annual return: {pct(input.expectedAnnualReturn, locale)}</div>
          <div>Annual volatility: {pct(input.annualVolatility, locale)}</div>
          <div>Horizon: {input.investmentHorizonYears} years</div>
          <div>Simulations: {formatNumber(input.simulationCount, "integer", { locale })}</div>
          <div>Jump probability: {pct(input.jumpProbabilityMonthly, locale)} per month</div>
          <div>Jump intensity: {numberText(input.jumpIntensityMultiplier, locale)}x volatility shock</div>
          <div>Risk-free rate: {pct(input.riskFreeRate, locale)}</div>
        </div>
      </section>
    </MonteCarloRunPanel>
  );
}
