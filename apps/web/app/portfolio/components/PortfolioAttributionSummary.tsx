"use client";

import dynamic from "next/dynamic";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import type { AttributionResult, toAllocationDonutData, toAttributionWaterfallData } from "@/lib/transformers";

type AllocationDonutData = ReturnType<typeof toAllocationDonutData>;
type AttributionWaterfallData = ReturnType<typeof toAttributionWaterfallData>;

interface PortfolioAttributionSummaryProps {
  attributionData: AttributionResult;
  allocationData: AllocationDonutData;
  waterfallData: AttributionWaterfallData;
  holdingStartDate: string;
  attributionAsOfDate: string;
}

function ChartLoadingPanel({ title }: { title: string }) {
  return (
    <section className="min-h-[320px] min-w-0 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-panel)] p-4">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      <div className="mt-3 h-[220px] animate-pulse rounded bg-[var(--surface-muted)]" />
    </section>
  );
}

const AllocationDonut = dynamic(
  () => import("@/components/charts/AllocationDonut").then((mod) => mod.AllocationDonut),
  {
    loading: () => <ChartLoadingPanel title="Sector Allocation" />,
    ssr: false,
  },
);

const AttributionWaterfall = dynamic(
  () => import("@/components/charts/AttributionWaterfall").then((mod) => mod.AttributionWaterfall),
  {
    loading: () => <ChartLoadingPanel title="Attribution Effects (%)" />,
    ssr: false,
  },
);

function portfolioStatus(label: string, value: number) {
  if (!Number.isFinite(value)) return `${label} is unavailable because the attribution engine did not return a finite value.`;
  if (Math.abs(value) < 0.0001) return `${label} is approximately neutral.`;
  return value > 0 ? `${label} is positive.` : `${label} is negative.`;
}

function benchmarkMethodLabel(method?: string | null) {
  if (!method) return "Direct benchmark or default provider data";
  return method.replace(/_/g, " ");
}

export function PortfolioAttributionSummary({
  attributionData,
  allocationData,
  waterfallData,
  holdingStartDate,
  attributionAsOfDate,
}: PortfolioAttributionSummaryProps) {
  return (
    <>
      <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
          <p className="text-xs text-[var(--text-muted)]">
            <InfoTooltip
              label="Portfolio Return"
              description={`Definition: total weighted return earned by the selected holdings over the attribution period. Formula: Portfolio Return = sum(weight_i x holding return_i). Step 1: calculate each holding's period return from its start and end prices. Step 2: multiply each holding return by its portfolio weight. Step 3: sum the weighted holding returns. Current status: ${portfolioStatus("return", attributionData.totals.portfolio_return)}.`}
            />
          </p>
          <p className="text-xl font-bold mt-1">
            {(attributionData.totals.portfolio_return * 100).toFixed(1)}%
          </p>
        </div>
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
          <p className="text-xs text-[var(--text-muted)]">
            <InfoTooltip
              label="Benchmark Return"
              description="Definition: return of the benchmark used as the comparison hurdle for the portfolio. Formula: Benchmark Return = sum(benchmark weight_i x benchmark/sector return_i), or direct benchmark index return when constituent weights are available. Step 1: identify the benchmark and period. Step 2: use direct benchmark returns or mapped proxy sector returns. Step 3: aggregate benchmark-weighted returns into one comparison return."
            />
          </p>
          <p className="text-xl font-bold mt-1">
            {(attributionData.totals.benchmark_return * 100).toFixed(1)}%
          </p>
        </div>
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
          <p className="text-xs text-[var(--text-muted)]">
            <InfoTooltip
              label="Active Return"
              description={`Definition: excess return produced by the portfolio versus the benchmark. Formula: Active Return = Portfolio Return - Benchmark Return. Step 1: compute the portfolio weighted return. Step 2: compute the benchmark return over the same period and currency. Step 3: subtract benchmark return from portfolio return; positive means outperformance and negative means underperformance. Current status: ${portfolioStatus("active", attributionData.active_return)}.`}
            />
          </p>
          <p className="text-xl font-bold mt-1">
            {(attributionData.active_return * 100).toFixed(1)}%
          </p>
        </div>
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
          <p className="text-xs text-[var(--text-muted)]">
            <InfoTooltip
              label="Beta"
              description={`Definition: sensitivity of portfolio returns to benchmark returns. Formula: Beta = covariance(portfolio returns, benchmark returns) / variance(benchmark returns). Step 1: align portfolio and benchmark return observations over the same dates. Step 2: measure how the portfolio co-moves with the benchmark. Step 3: divide that co-movement by benchmark variance. Around 1.0 is market-like; above 1.2 is higher benchmark sensitivity. Current status: ${portfolioStatus("beta", attributionData.risk_metrics.beta)}.`}
            />
          </p>
          <p className="text-xl font-bold mt-1">
            {attributionData.risk_metrics.beta.toFixed(1)}
          </p>
        </div>
      </section>

      <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <h2 className="text-sm font-bold text-[var(--text-primary)]">
              <InfoTooltip
                label="Benchmark Selection Criteria"
                description="The current portfolio view selects ^GSPC as the broad-market benchmark because the watchlist is modeled as a diversified equity basket and the S&P 500 offers market-cap-weighted US large-cap breadth. Sector matching is handled through attribution sectors and an explicit proxy when true benchmark constituent weights are unavailable."
              />
            </h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Benchmark: {attributionData.metadata.benchmark}. Return window: {holdingStartDate || "5-year lookback start"} to {attributionAsOfDate || "latest available market date"}. Methodology: this portfolio view uses saved watchlist allocations when any positive weights exist; otherwise it falls back to an equal-weight basket. If user-provided benchmark weights exist, the engine uses them directly; otherwise it uses the opted-in provider-derived sector proxy and labels the limitation in the data quality metadata.
            </p>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Calculation basis: Brinson-Fachler arithmetic attribution decomposes active return into allocation, selection, and interaction effects. Sector correlation is reviewed through the sector attribution mapping; this build does not run a live correlation optimizer for benchmark selection.
            </p>
          </div>
          <div className="grid min-w-56 grid-cols-2 gap-2 text-xs">
            <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3">
              <div className="text-[var(--text-muted)]">Weight Source</div>
              <div className="mt-1 font-bold text-[var(--text-primary)]">
                {attributionData.metadata.benchmark_weights_source.replace("_", " ")}
              </div>
            </div>
            <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3">
              <div className="text-[var(--text-muted)]">Proxy Method</div>
              <div className="mt-1 font-bold text-[var(--text-primary)]">
                {benchmarkMethodLabel(attributionData.metadata.data_quality?.benchmark_proxy_method)}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AllocationDonut data={allocationData} />
        <AttributionWaterfall data={waterfallData} sectorBreakdowns={attributionData.sector_breakdowns} />
      </section>
    </>
  );
}
