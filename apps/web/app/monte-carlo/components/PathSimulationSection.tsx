"use client";

import type { PathSimulationInput, SharedSimulationResult } from "../lib/types";
import { Download, Loader2, Play, Square } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { ActionButton } from "@/components/ui/ActionButton";
import {
  AXIS_LINE_STYLE,
  AXIS_TICK_STYLE,
  CHART_MARGIN,
  CHART_REFERENCE_COLORS,
  DEFAULT_TOOLTIP_PROPS,
  GRID_STYLE,
  PERCENTILE_FILL_SEQUENCE,
  PERCENTILE_SERIES_COLORS,
  fmtYearsTick,
  seriesColor,
} from "@/lib/chartConfig";
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
      progressTone="surface"
      errorMessage={errorMessage}
      errorFallbackMessage="Worker simulation failed."
      cancelledMessage="Simulation cancelled."
      controls={(
        <div className="flex flex-col gap-2 lg:flex-row">
          <section className="grid grid-cols-2 gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 lg:grid-cols-4">
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
                className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--surface)] px-5 py-3 text-sm font-black text-white disabled:opacity-60"
              >
                {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Run Path Simulation
              </button>
              <button
                type="button"
                onClick={cancelPathSimulation}
                disabled={status !== "loading"}
                className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-5 py-3 text-sm font-black text-[var(--text-primary)] disabled:opacity-50"
              >
                <Square className="h-4 w-4" />
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      helper={(
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-sm text-[var(--text-muted)]">
          <span className="font-bold text-[var(--text-primary)]">Execution mode:</span>{" "}
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
            { label: "Simulations", value: input.simulationCount.toLocaleString() },
            { label: "Median terminal", value: krwTenThousands(sharedSimulation?.terminalMedian ?? input.initialInvestment) },
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
        <MetricCard label="Median terminal value" value={krwTenThousands(sharedSimulation?.terminalMedian ?? input.initialInvestment)} detail="50th percentile ending value in 10,000 KRW units" />
        <MetricCard label="Expected return" value={pct(sharedSimulation?.medianExpectedReturn ?? 0)} detail="Computed from the median terminal value relative to principal" />
        <MetricCard label="Loss probability" value={pct(sharedSimulation?.raw.risk_metrics.loss_probability ?? 0)} detail="Probability terminal value ends below principal" />
        <MetricCard label="Sharpe ratio" value={numberText(sharedSimulation?.raw.risk_metrics.sharpe_ratio ?? 0)} detail={`Annualized Sharpe with rf = ${pct(input.riskFreeRate)}`} />
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <PercentileIndicator label="5%-95%" value={`${krwTenThousands(sharedSimulation?.terminalP05 ?? input.initialInvestment)} - ${krwTenThousands(sharedSimulation?.terminalP95 ?? input.initialInvestment)}`} colorClass="bg-emerald-500" description="The widest displayed confidence interval. About 90% of simulated terminal outcomes fall between the 5th and 95th percentiles." />
        <PercentileIndicator label="10%-90%" value={`${krwTenThousands(sharedSimulation?.terminalP10 ?? input.initialInvestment)} - ${krwTenThousands(sharedSimulation?.terminalP90 ?? input.initialInvestment)}`} colorClass="bg-teal-500" description="A slightly tighter confidence interval. About 80% of simulated terminal outcomes fall between the 10th and 90th percentiles." />
        <PercentileIndicator label="25%-75%" value={`${krwTenThousands(sharedSimulation?.terminalP25 ?? input.initialInvestment)} - ${krwTenThousands(sharedSimulation?.terminalP75 ?? input.initialInvestment)}`} colorClass="bg-slate-500" description="The interquartile range. It captures the middle 50% of simulated outcomes and shows the most typical dispersion." />
        <PercentileIndicator label="Median" value={krwTenThousands(sharedSimulation?.terminalMedian ?? input.initialInvestment)} colorClass="bg-black" description="The 50th percentile terminal value. Half of simulations finish above this value and half finish below it." />
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
              <LegendItem label="Profit Paths" lineClass="bg-emerald-500" />
              <LegendItem label="Loss Paths" lineClass="bg-slate-500" />
              <LegendItem label="Average Path" lineClass="bg-black" />
              <LegendItem label="Principal Line" lineClass="bg-amber-500" />
            </div>
          )}
        >
          <LineChart data={sharedSimulation?.pathChartData ?? []} margin={CHART_MARGIN}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="time" type="number" domain={[0, input.investmentHorizonYears]} ticks={yearlyTicks} tickFormatter={fmtYearsTick} tick={AXIS_TICK_STYLE} axisLine={AXIS_LINE_STYLE} tickLine={false} />
            <YAxis tickFormatter={(value) => `${Math.round(value / TEN_THOUSAND_KRW)}`} tick={AXIS_TICK_STYLE} axisLine={AXIS_LINE_STYLE} tickLine={false} />
            <Tooltip {...DEFAULT_TOOLTIP_PROPS} formatter={(value) => krwTenThousands(Number(value ?? 0))} labelFormatter={(label) => `${label} years`} />
            {sharedSimulation?.pathKeys.map((key, index) => (
              <Line key={key} dataKey={key} stroke={seriesColor(index)} strokeOpacity={0.5} dot={false} />
            ))}
            <Line type="monotone" dataKey="average_path" stroke={CHART_REFERENCE_COLORS.baseline} strokeWidth={2} dot={false} />
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
              <LegendItem label="5%-95%" lineClass="bg-emerald-500" />
              <LegendItem label="10%-90%" lineClass="bg-teal-500" />
              <LegendItem label="25%-75%" lineClass="bg-slate-500" />
              <LegendItem label="Median" lineClass="bg-black" />
            </div>
          )}
        >
          <AreaChart data={sharedSimulation?.pathSummary ?? []} margin={CHART_MARGIN}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="time" type="number" domain={[0, input.investmentHorizonYears]} ticks={yearlyTicks} tickFormatter={fmtYearsTick} tick={AXIS_TICK_STYLE} axisLine={AXIS_LINE_STYLE} tickLine={false} />
            <YAxis tickFormatter={(value) => `${Math.round(value / TEN_THOUSAND_KRW)}`} tick={AXIS_TICK_STYLE} axisLine={AXIS_LINE_STYLE} tickLine={false} />
            <Tooltip {...DEFAULT_TOOLTIP_PROPS} formatter={(value) => krwTenThousands(Number(value ?? 0))} labelFormatter={(label) => `${label} years`} />
            <Area type="monotone" dataKey="p95" stroke={PERCENTILE_FILL_SEQUENCE[0]} fill={PERCENTILE_FILL_SEQUENCE[0]} fillOpacity={0.2} />
            <Area type="monotone" dataKey="p90" stroke={PERCENTILE_FILL_SEQUENCE[1]} fill={PERCENTILE_FILL_SEQUENCE[1]} fillOpacity={0.16} />
            <Area type="monotone" dataKey="p75" stroke={PERCENTILE_FILL_SEQUENCE[2]} fill={PERCENTILE_FILL_SEQUENCE[2]} fillOpacity={0.14} />
            <Area type="monotone" dataKey="p05" stroke="#ffffff" fill="#ffffff" fillOpacity={1} />
            <Area type="monotone" dataKey="p10" stroke="#ffffff" fill="#ffffff" fillOpacity={1} />
            <Area type="monotone" dataKey="p25" stroke="#ffffff" fill="#ffffff" fillOpacity={1} />
            <Line type="monotone" dataKey="p50" stroke={PERCENTILE_SERIES_COLORS.p50} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="p05" stroke={PERCENTILE_SERIES_COLORS.p05} dot={false} />
            <Line type="monotone" dataKey="p10" stroke={PERCENTILE_SERIES_COLORS.p10} dot={false} />
            <Line type="monotone" dataKey="p25" stroke={PERCENTILE_SERIES_COLORS.p25} dot={false} />
            <Line type="monotone" dataKey="p75" stroke={PERCENTILE_SERIES_COLORS.p75} dot={false} />
            <Line type="monotone" dataKey="p90" stroke={PERCENTILE_SERIES_COLORS.p90} dot={false} />
            <Line type="monotone" dataKey="p95" stroke={PERCENTILE_SERIES_COLORS.p95} dot={false} />
          </AreaChart>
        </ChartGuard>
      </section>

      {/* Compact echo of the active simulation assumptions */}
      <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5">
        <h2 className="text-lg font-black text-[var(--text-primary)]">Simulation Setup</h2>
        <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-[var(--text-muted)] md:grid-cols-2 xl:grid-cols-4">
          <div>Principal: {krwTenThousands(input.initialInvestment)}</div>
          <div>Annual return: {pct(input.expectedAnnualReturn)}</div>
          <div>Annual volatility: {pct(input.annualVolatility)}</div>
          <div>Horizon: {input.investmentHorizonYears} years</div>
          <div>Simulations: {input.simulationCount.toLocaleString()}</div>
          <div>Jump probability: {pct(input.jumpProbabilityMonthly)} per month</div>
          <div>Jump intensity: {numberText(input.jumpIntensityMultiplier)}x volatility shock</div>
          <div>Risk-free rate: {pct(input.riskFreeRate)}</div>
        </div>
      </section>
    </MonteCarloRunPanel>
  );
}
