"use client";

import type { PathSimulationInput, SharedSimulationResult } from "../lib/types";
import { AlertTriangle, Download, Loader2, Play, Square } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  CHART_INITIAL_DIMENSION,
  LegendItem,
  MetricCard,
  NumericField,
  PercentileIndicator,
  SelectField,
  TEN_THOUSAND_KRW,
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
  yearlyTicks,
  update,
  runPathSimulation,
  cancelPathSimulation,
  exportSummaryCsv,
  exportPercentileConeCsv,
  exportSamplePathsCsv,
  exportTerminalDistributionCsv,
}: Props) {
  return (
    <div className="space-y-6">
      {/* Input controls and run/cancel actions */}
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
              className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--surface)] px-5 py-3 text-sm font-black text-white shadow-sm disabled:opacity-60"
            >
              {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Run Path Simulation
            </button>
            <button
              type="button"
              onClick={cancelPathSimulation}
              disabled={status !== "loading"}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-white px-5 py-3 text-sm font-black text-[var(--text-primary)] shadow-sm disabled:opacity-50"
            >
              <Square className="h-4 w-4" />
              Cancel
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 text-sm text-[var(--text-muted)] shadow-sm">
        <span className="font-bold text-[var(--text-primary)]">Execution mode:</span>{" "}
        {(sharedSimulation?.raw.execution_mode ?? input.executionMode) === "interactive"
          ? "Interactive keeps a richer path sample for the path chart."
          : "Large Summary keeps percentile summaries, terminal distribution, and a small path sample to avoid storing large path matrices."}
        {input.executionMode === "interactive" && sharedSimulation?.raw.execution_mode === "summary" ? " Large runs are automatically promoted to Large Summary mode." : ""}
      </div>

      {status === "loading" && (
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-sm font-bold text-[var(--text-primary)]">
            <span>Worker progress</span>
            <span>{progress}%</span>
          </div>
          <div className="mt-3 h-3 rounded-full bg-slate-100">
            <div className="h-3 rounded-full bg-[var(--surface)] transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="flex items-center gap-2 rounded-[var(--radius)] border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          <AlertTriangle className="h-4 w-4" />
          {errorMessage ?? "Worker simulation failed."}
        </div>
      )}

      {status === "cancelled" && (
        <div className="flex items-center gap-2 rounded-[var(--radius)] border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-700">
          <AlertTriangle className="h-4 w-4" />
          Simulation cancelled.
        </div>
      )}

      {sharedSimulation && (
        <section className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-black text-[var(--text-primary)]">Export Results</h2>
              <p className="text-xs text-[var(--text-muted)]">
                Download the shared simulation output as CSV files. Current mode:{" "}
                <span className="font-bold text-[var(--text-primary)]">{sharedSimulation.raw.execution_mode}</span>.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <button type="button" onClick={exportSummaryCsv} className="inline-flex items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-white px-4 py-2 text-sm font-black text-[var(--text-primary)] shadow-sm">
                <Download className="h-4 w-4" />
                summary.csv
              </button>
              <button type="button" onClick={exportPercentileConeCsv} className="inline-flex items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-white px-4 py-2 text-sm font-black text-[var(--text-primary)] shadow-sm">
                <Download className="h-4 w-4" />
                percentile_cone.csv
              </button>
              <button type="button" onClick={exportSamplePathsCsv} className="inline-flex items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-white px-4 py-2 text-sm font-black text-[var(--text-primary)] shadow-sm">
                <Download className="h-4 w-4" />
                sample_paths.csv
              </button>
              <button type="button" onClick={exportTerminalDistributionCsv} className="inline-flex items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-white px-4 py-2 text-sm font-black text-[var(--text-primary)] shadow-sm">
                <Download className="h-4 w-4" />
                terminal_distribution.csv
              </button>
            </div>
          </div>
        </section>
      )}

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
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-[var(--text-primary)]">GBM + Jump-Diffusion Simulated Paths</h2>
          <p className="text-xs text-[var(--text-muted)]">A subset of simulated KRW investment paths under drift, diffusion, and jump shocks.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <LegendItem label="Profit Paths" lineClass="bg-emerald-500" />
            <LegendItem label="Loss Paths" lineClass="bg-slate-500" />
            <LegendItem label="Average Path" lineClass="bg-black" />
            <LegendItem label="Principal Line" lineClass="bg-amber-500" />
          </div>
          <div className="mt-4 h-80">
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={CHART_INITIAL_DIMENSION}>
              <LineChart data={sharedSimulation?.pathChartData ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" type="number" domain={[0, input.investmentHorizonYears]} ticks={yearlyTicks} tickFormatter={(value) => `${value}Y`} />
                <YAxis tickFormatter={(value) => `${Math.round(value / TEN_THOUSAND_KRW)}`} />
                <Tooltip formatter={(value) => krwTenThousands(Number(value ?? 0))} labelFormatter={(label) => `${label} years`} />
                {sharedSimulation?.pathKeys.map((key, index) => (
                  <Line key={key} dataKey={key} stroke={index % 2 === 0 ? "#60caad" : "#64748b"} strokeOpacity={0.5} dot={false} />
                ))}
                <Line type="monotone" dataKey="average_path" stroke="#111827" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="principal_line" stroke="#f59e0b" strokeDasharray="6 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-[var(--text-primary)]">Percentile Cone</h2>
          <p className="text-xs text-[var(--text-muted)]">Confidence interval labels: 5%-95%, 10%-90%, 25%-75%, and Median.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <LegendItem label="5%-95%" lineClass="bg-emerald-500" />
            <LegendItem label="10%-90%" lineClass="bg-teal-500" />
            <LegendItem label="25%-75%" lineClass="bg-slate-500" />
            <LegendItem label="Median" lineClass="bg-black" />
          </div>
          <div className="mt-4 h-80">
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={CHART_INITIAL_DIMENSION}>
              <AreaChart data={sharedSimulation?.pathSummary ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" type="number" domain={[0, input.investmentHorizonYears]} ticks={yearlyTicks} tickFormatter={(value) => `${value}Y`} />
                <YAxis tickFormatter={(value) => `${Math.round(value / TEN_THOUSAND_KRW)}`} />
                <Tooltip formatter={(value) => krwTenThousands(Number(value ?? 0))} labelFormatter={(label) => `${label} years`} />
                <Area type="monotone" dataKey="p95" stroke="#60caad" fill="#60caad" fillOpacity={0.2} />
                <Area type="monotone" dataKey="p90" stroke="#14b8a6" fill="#14b8a6" fillOpacity={0.16} />
                <Area type="monotone" dataKey="p75" stroke="#64748b" fill="#64748b" fillOpacity={0.14} />
                <Area type="monotone" dataKey="p05" stroke="#ffffff" fill="#ffffff" fillOpacity={1} />
                <Area type="monotone" dataKey="p10" stroke="#ffffff" fill="#ffffff" fillOpacity={1} />
                <Area type="monotone" dataKey="p25" stroke="#ffffff" fill="#ffffff" fillOpacity={1} />
                <Line type="monotone" dataKey="p50" stroke="#111827" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="p05" stroke="#ef4444" dot={false} />
                <Line type="monotone" dataKey="p10" stroke="#f97316" dot={false} />
                <Line type="monotone" dataKey="p25" stroke="#64748b" dot={false} />
                <Line type="monotone" dataKey="p75" stroke="#64748b" dot={false} />
                <Line type="monotone" dataKey="p90" stroke="#14b8a6" dot={false} />
                <Line type="monotone" dataKey="p95" stroke="#16a34a" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Compact echo of the active simulation assumptions */}
      <section className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm">
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
    </div>
  );
}
