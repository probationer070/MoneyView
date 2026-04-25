"use client";

import type { DcfFullReport } from "../../../../../packages/shared-types";
import type { BenchmarkPreset } from "@/lib/benchmarkPresets";
import { Bar, BarChart, CartesianGrid, Cell, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { GRID_STYLE, fmtCurrencyCompactTick, fmtPctTick, withAxisProps, withCategoryAxisProps, withTooltipProps } from "@/lib/chartConfig";
import { CorporateComparisonTable } from "./CorporateComparisonTable";
import type { CalculationDetailKey } from "./calculationDetailTypes";

type ComparisonSortKey = "roic_minus_wacc" | "dcf_value" | "expected_return_spread";
type ComparisonUniverse = "watchlist_plus_benchmark" | "custom";

interface ComparisonRow {
  ticker: string;
  name: string;
  sector: string;
  group_name: string;
  weight: number;
  roic_minus_wacc: number;
  dcf_value: number;
  current_price: number;
  dcf_implied_return: number;
  capm_expected_return: number;
  market_expected_return: number;
  expected_return_spread: number;
  has_price_data: boolean;
}

interface ComparisonData {
  market_expected_return: number;
  risk_free_rate: number;
  equity_risk_premium: number;
  stock_expected_return_method: string;
  comparison_reference_return_method: string;
  snapshot: {
    comparison_universe: "portfolio_plus_benchmark" | "watchlist_plus_benchmark" | "custom";
    benchmark_ticker: string;
    custom_tickers: string[];
    generated_at: string;
  };
  rows: ComparisonRow[];
}

interface ComparisonBarRow {
  ticker: string;
  roic_minus_wacc: number;
  expected_return_spread: number;
  isSelected: boolean;
}

interface ComparisonScatterRow {
  ticker: string;
  current_price: number;
  dcf_value: number;
  expected_return_spread: number;
  bubble_size: number;
}

interface WatchlistCoverage {
  isSynchronized: boolean;
  liveWatchlistCount: number;
  registryCount: number;
  missingTickers: string[];
}

export function TargetStockComparisonSection({
  comparisonData,
  comparisonDisplayLastUpdatedAt,
  comparisonIsStale,
  comparisonUniverse,
  comparisonBenchmarkTicker,
  comparisonBenchmarkOptions,
  comparisonCustomTickersInput,
  comparisonSortKey,
  comparisonSortDirection,
  onComparisonUniverseChange,
  onComparisonBenchmarkTickerChange,
  onComparisonCustomTickersInputChange,
  onComparisonSortKeyChange,
  onComparisonSortDirectionChange,
  onRefreshComparison,
  onVerifyWatchlistSync,
  onOpenPortfolio,
  watchlistCoverage,
  watchlistSyncLoading,
  comparisonIsLoading,
  comparisonIsFetching,
  comparisonIsError,
  sortedComparisonRows,
  selectedComparisonTicker,
  selectedComparisonSector,
  similarComparisonBarData,
  similarComparisonScatterPeers,
  similarComparisonScatterSelected,
  currentTicker,
  onSelectTicker,
  onOpenCalculationForTicker,
  bulkDcfReportsLoading,
  bulkDcfReportsError,
  bulkDcfReports,
  bulkDcfReportsLastUpdatedAt,
  onCalculateAllDcfReports,
  formatPct2,
  formatMoney,
  formatDateTime,
  formatComparisonUniverseLabel,
}: {
  comparisonData: ComparisonData | null;
  comparisonDisplayLastUpdatedAt: string | null;
  comparisonIsStale: boolean;
  comparisonUniverse: ComparisonUniverse;
  comparisonBenchmarkTicker: string;
  comparisonBenchmarkOptions: BenchmarkPreset[];
  comparisonCustomTickersInput: string;
  comparisonSortKey: ComparisonSortKey;
  comparisonSortDirection: "desc" | "asc";
  onComparisonUniverseChange: (value: ComparisonUniverse) => void;
  onComparisonBenchmarkTickerChange: (value: string) => void;
  onComparisonCustomTickersInputChange: (value: string) => void;
  onComparisonSortKeyChange: (value: ComparisonSortKey) => void;
  onComparisonSortDirectionChange: (value: "desc" | "asc") => void;
  onRefreshComparison: () => void;
  onVerifyWatchlistSync: () => void;
  onOpenPortfolio: () => void;
  watchlistCoverage: WatchlistCoverage;
  watchlistSyncLoading: boolean;
  comparisonIsLoading: boolean;
  comparisonIsFetching: boolean;
  comparisonIsError: boolean;
  sortedComparisonRows: ComparisonRow[];
  selectedComparisonTicker: string;
  selectedComparisonSector: string;
  similarComparisonBarData: ComparisonBarRow[];
  similarComparisonScatterPeers: ComparisonScatterRow[];
  similarComparisonScatterSelected: ComparisonScatterRow[];
  currentTicker: string;
  onSelectTicker: (ticker: string) => void;
  onOpenCalculationForTicker: (ticker: string, key: CalculationDetailKey) => void;
  bulkDcfReportsLoading: boolean;
  bulkDcfReportsError: string | null;
  bulkDcfReports: DcfFullReport[];
  bulkDcfReportsLastUpdatedAt: string | null;
  onCalculateAllDcfReports: () => void;
  formatPct2: (value: number) => string;
  formatMoney: (value: number) => string;
  formatDateTime: (value: string) => string;
  formatComparisonUniverseLabel: (value: ComparisonUniverse | "portfolio_plus_benchmark") => string;
}) {
  const selectedBenchmarkLabel = comparisonBenchmarkOptions.find((preset) => preset.ticker === comparisonBenchmarkTicker)?.label ?? comparisonBenchmarkTicker;

  return (
    <section className="mt-4 col-span-6 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 xl:max-w-2xl">
          <h2 className="text-sm font-bold text-[var(--text-primary)]">
            <InfoTooltip
              label="Target Stock Comparison"
              description="Lightweight watchlist comparison for tracked names and ad-hoc custom universes. Weighted portfolio testing, implied cash, snapshots, and saved history live on the Portfolio page."
            />
          </h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Market expected return formula: risk-free rate + equity risk premium = {comparisonData ? formatPct2(comparisonData.market_expected_return) : "Refresh to calculate"}.
          </p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            This screen stays in live comparison mode. If you need saved weights, implied cash, persisted snapshots, or snapshot history, continue in the Portfolio workflow.
          </p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Corporate Analysis now checks the live Watchlist Holdings feed against the company registry on each refresh so mismatches are visible before you compare names.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:max-w-md xl:justify-end">
          <button
            type="button"
            onClick={onRefreshComparison}
            disabled={comparisonIsFetching}
            className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-bold text-[var(--text-primary)] disabled:opacity-60"
          >
            Refresh comparison
          </button>
          <button
            type="button"
            onClick={onVerifyWatchlistSync}
            disabled={watchlistSyncLoading}
            className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-bold text-[var(--text-primary)] disabled:opacity-60"
          >
            Verify Watchlist Sync
          </button>
          <span className="text-xs text-[var(--text-muted)]">
            {comparisonDisplayLastUpdatedAt ? `Last updated ${formatDateTime(comparisonDisplayLastUpdatedAt)}` : "Not calculated yet"}
          </span>
          {comparisonIsStale && (
            <span className="rounded-full bg-amber-100 px-2 py-1 text-[length:var(--type-caption)] font-bold text-amber-800">
              Stale
            </span>
          )}
        </div>
        <div className="min-w-0 flex flex-col gap-2 xl:items-end">
          <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
            <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3">
              <div className="text-[var(--text-muted)]">Risk-free</div>
              <div className="mt-1 font-bold text-[var(--text-primary)]">{comparisonData ? formatPct2(comparisonData.risk_free_rate) : "Refresh to calculate"}</div>
            </div>
            <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3">
              <div className="text-[var(--text-muted)]">ERP</div>
              <div className="mt-1 font-bold text-[var(--text-primary)]">{comparisonData ? formatPct2(comparisonData.equity_risk_premium) : "Refresh to calculate"}</div>
            </div>
            <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3">
              <div className="text-[var(--text-muted)]">Stock Return Method</div>
              <div className="mt-1 font-bold text-[var(--text-primary)]">
                {comparisonData ? comparisonData.stock_expected_return_method.replaceAll("_", " ") : "Refresh to calculate"}
              </div>
            </div>
            <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3">
              <div className="text-[var(--text-muted)]">Reference Method</div>
              <div className="mt-1 font-bold text-[var(--text-primary)]">
                {comparisonData ? comparisonData.comparison_reference_return_method.replaceAll("_", " ") : "Refresh to calculate"}
              </div>
            </div>
            <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3">
              <div className="text-[var(--text-muted)]">Comparison Type</div>
              <div className="mt-1 font-bold text-[var(--text-primary)]">Live watchlist comparison</div>
            </div>
            <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3">
              <div className="text-[var(--text-muted)]">Portfolio Tools</div>
              <button
                type="button"
                onClick={onOpenPortfolio}
                className="mt-1 text-left font-bold text-[var(--delta-up)] underline decoration-dotted underline-offset-4"
              >
                Open Portfolio Testing
              </button>
            </div>
            <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3">
              <div className="text-[var(--text-muted)]">Universe</div>
              <div className="mt-1 font-bold text-[var(--text-primary)]">
                {comparisonData ? formatComparisonUniverseLabel(comparisonData.snapshot.comparison_universe) : formatComparisonUniverseLabel(comparisonUniverse)}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:justify-end">
            <label className="flex w-full min-w-0 flex-col items-start gap-1 text-xs font-semibold text-[var(--text-muted)] sm:w-auto sm:flex-row sm:items-center">
              Universe
              <select
                aria-label="Comparison universe"
                value={comparisonUniverse}
                onChange={(event) => onComparisonUniverseChange(event.target.value as ComparisonUniverse)}
                className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] sm:w-auto"
              >
                <option value="watchlist_plus_benchmark">Watchlist + Benchmark</option>
                <option value="custom">Custom Universe</option>
              </select>
            </label>
            <label className="flex w-full min-w-0 flex-col items-start gap-1 text-xs font-semibold text-[var(--text-muted)] sm:w-auto sm:flex-row sm:items-center">
              Benchmark
              <select
                aria-label="Comparison benchmark"
                value={comparisonBenchmarkTicker}
                onChange={(event) => onComparisonBenchmarkTickerChange(event.target.value)}
                className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] sm:w-auto"
              >
                {comparisonBenchmarkOptions.map((preset) => (
                  <option key={preset.id} value={preset.ticker}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            {comparisonUniverse === "custom" && (
              <label className="flex w-full min-w-0 flex-col items-start gap-1 text-xs font-semibold text-[var(--text-muted)] sm:w-auto sm:flex-row sm:items-center">
                Custom tickers
                <input
                  aria-label="Custom tickers"
                  value={comparisonCustomTickersInput}
                  onChange={(event) => onComparisonCustomTickersInputChange(event.target.value.toUpperCase())}
                  placeholder="AAPL, MSFT, NVDA"
                  className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] sm:w-48"
                />
              </label>
            )}
            <label className="flex w-full min-w-0 flex-col items-start gap-1 text-xs font-semibold text-[var(--text-muted)] sm:w-auto sm:flex-row sm:items-center">
              Sort by
              <select
                aria-label="Sort by"
                value={comparisonSortKey}
                onChange={(event) => onComparisonSortKeyChange(event.target.value as ComparisonSortKey)}
                className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] sm:w-auto"
              >
                <option value="expected_return_spread">Expected return spread</option>
                <option value="roic_minus_wacc">ROIC - WACC</option>
                <option value="dcf_value">DCF value</option>
              </select>
            </label>
            <label className="flex w-full min-w-0 flex-col items-start gap-1 text-xs font-semibold text-[var(--text-muted)] sm:w-auto sm:flex-row sm:items-center">
              Direction
              <select
                aria-label="Direction"
                value={comparisonSortDirection}
                onChange={(event) => onComparisonSortDirectionChange(event.target.value as "desc" | "asc")}
                className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] sm:w-auto"
              >
                <option value="desc">High to low</option>
                <option value="asc">Low to high</option>
              </select>
            </label>
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            Benchmark: {comparisonData?.snapshot.benchmark_ticker ?? comparisonBenchmarkTicker}. {comparisonData ? `Generated live at ${formatDateTime(comparisonData.snapshot.generated_at)}.` : "Refresh comparison to calculate the live peer set."} Portfolio snapshots and saved history are managed from the Portfolio page only.
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            Selected benchmark preset: {selectedBenchmarkLabel} ({comparisonBenchmarkTicker}).
          </div>
          {(comparisonData?.snapshot.comparison_universe ?? comparisonUniverse) === "custom" && (
            <div className="text-xs text-[var(--text-muted)]">
              Custom tickers: {(comparisonData?.snapshot.custom_tickers ?? comparisonCustomTickersInput.split(",").map((ticker) => ticker.trim()).filter(Boolean)).join(", ") || "None"}.
            </div>
          )}
        </div>
      </div>

      <div className={`mt-4 rounded-[var(--radius)] border px-4 py-3 text-sm ${watchlistCoverage.isSynchronized
        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
        : "border-amber-200 bg-amber-50 text-amber-900"
        }`}>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="font-bold">Watchlist Holdings Sync</div>
            <div className="mt-1">
              Checked {watchlistCoverage.liveWatchlistCount} live watchlist holding{watchlistCoverage.liveWatchlistCount === 1 ? "" : "s"} against {watchlistCoverage.registryCount} corporate registry name{watchlistCoverage.registryCount === 1 ? "" : "s"}.
            </div>
            <div className="mt-1">
              {watchlistCoverage.isSynchronized
                ? "All live watchlist tickers are available inside Corporate Analysis."
                : `Missing from Corporate Analysis: ${watchlistCoverage.missingTickers.join(", ")}.`}
            </div>
          </div>
          <div className="text-xs font-semibold">
            {watchlistSyncLoading ? "Verifying..." : watchlistCoverage.isSynchronized ? "Synchronized" : "Needs refresh"}
          </div>
        </div>
      </div>

      {comparisonIsLoading && !comparisonData && (
        <div className="mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)]">
          <LoadingState variant="spinner" label="Loading comparison rows..." />
        </div>
      )}

      {comparisonIsError && (
        <div className="mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)]">
          <ErrorState
            title="Target Stock Comparison Unavailable"
            message="Target stock comparison is currently unavailable."
          />
        </div>
      )}

      {!comparisonData && !comparisonIsFetching && !comparisonIsError && (
        <div className="mt-4 rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--surface-muted)]">
          <EmptyState
            title="Comparison stays idle on first load. Adjust the universe if needed, then click `Refresh comparison` to calculate."
            description="Comparison rows, spread charts, and batch DCF actions remain idle until you refresh."
          />
        </div>
      )}

      {comparisonData && sortedComparisonRows.length > 0 && (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-panel)] p-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-bold text-[var(--text-primary)]">Similar Stocks Spread View</h3>
                <p className="text-sm text-[var(--text-muted)]">
                  Compares {selectedComparisonTicker || currentTicker} with {selectedComparisonSector || "the current comparison universe"}. When there are not enough same-sector names, the chart falls back to the active comparison rows.
                </p>
              </div>
              <ResponsiveChart className="mt-4 h-[320px]" minWidth={1} minHeight={1}>
                <BarChart data={similarComparisonBarData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid {...GRID_STYLE} />
                  <XAxis dataKey="ticker" {...withCategoryAxisProps()} />
                  <YAxis {...withAxisProps({ tickFormatter: (value: number | string) => fmtPctTick(Number(value), 0), width: 52 })} />
                  <Tooltip
                    {...withTooltipProps()}
                    formatter={(value, name) => {
                      const numericValue = typeof value === "number" ? value : Number(value ?? 0);
                      return [`${numericValue.toFixed(2)}%`, name === "roic_minus_wacc" ? "ROIC - WACC" : "Expected return spread"];
                    }}
                  />
                  <Bar dataKey="roic_minus_wacc" name="roic_minus_wacc" radius={[6, 6, 0, 0]}>
                    {similarComparisonBarData.map((row) => (
                      <Cell key={`${row.ticker}-roic`} fill={row.isSelected ? "#0F766E" : "#60CAAD"} />
                    ))}
                  </Bar>
                  <Bar dataKey="expected_return_spread" name="expected_return_spread" radius={[6, 6, 0, 0]}>
                    {similarComparisonBarData.map((row) => (
                      <Cell key={`${row.ticker}-spread`} fill={row.isSelected ? "#1D4ED8" : "#94A3B8"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveChart>
            </section>

            <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-panel)] p-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-bold text-[var(--text-primary)]">Price Vs Fair Value Map</h3>
                <p className="text-sm text-[var(--text-muted)]">
                  DCF fair value sits on the vertical axis and current price sits on the horizontal axis. Bubble size expands with the expected-return spread so outliers stand out quickly.
                </p>
              </div>
              <ResponsiveChart className="mt-4 h-[320px]" minWidth={1} minHeight={1}>
                <ScatterChart margin={{ top: 8, right: 16, bottom: 12, left: 8 }}>
                  <CartesianGrid {...GRID_STYLE} />
                  <XAxis
                    type="number"
                    dataKey="current_price"
                    name="Current price"
                    {...withAxisProps({ tickFormatter: (value: number | string) => fmtCurrencyCompactTick(Number(value)) })}
                    domain={["auto", "auto"]}
                  />
                  <YAxis
                    type="number"
                    dataKey="dcf_value"
                    name="DCF value"
                    {...withAxisProps({ tickFormatter: (value: number | string) => fmtCurrencyCompactTick(Number(value)), width: 76 })}
                    domain={["auto", "auto"]}
                  />
                  <ZAxis type="number" dataKey="bubble_size" range={[80, 260]} />
                  <Tooltip
                    {...withTooltipProps({ cursor: { strokeDasharray: "3 3" } })}
                    formatter={(value, name) => {
                      const numericValue = typeof value === "number" ? value : Number(value ?? 0);
                      if (name === "expected_return_spread") return [`${numericValue.toFixed(2)}%`, "Expected return spread"];
                      return [formatMoney(numericValue), name === "current_price" ? "Current price" : "DCF value"];
                    }}
                  />
                  <Scatter data={similarComparisonScatterPeers} fill="#94A3B8" name="Peer set" />
                  <Scatter data={similarComparisonScatterSelected} fill="#0F766E" name="Selected ticker" />
                </ScatterChart>
              </ResponsiveChart>
            </section>
          </div>

          <CorporateComparisonTable
            rows={sortedComparisonRows}
            currentTicker={currentTicker}
            onSelectTicker={onSelectTicker}
            onOpenCalculationForTicker={onOpenCalculationForTicker}
            formatPct2={formatPct2}
            formatMoney={formatMoney}
          />

          <div className="mt-4">
            <button
              type="button"
              onClick={onCalculateAllDcfReports}
              disabled={bulkDcfReportsLoading || sortedComparisonRows.filter((row) => row.group_name !== "benchmark").length === 0}
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-bold text-[var(--text-primary)] disabled:opacity-60"
            >
              {bulkDcfReportsLoading ? "Calculating all reports..." : "Calculate All Reports"}
            </button>
          </div>

          {(bulkDcfReportsLoading || bulkDcfReportsError || bulkDcfReports.length > 0) && (
            <section className="mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-panel)] p-4">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">Batch DCF Reports</h3>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">
                    Calculates backend full reports for every non-benchmark stock currently shown in Target Stock Comparison.
                  </p>
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  {bulkDcfReportsLastUpdatedAt ? `Last calculated ${formatDateTime(bulkDcfReportsLastUpdatedAt)}` : "No batch reports calculated yet"}
                </div>
              </div>
              {bulkDcfReportsLoading && (
                <div className="mt-4 text-sm text-[var(--text-muted)]">Calculating full reports for the current comparison universe...</div>
              )}
              {bulkDcfReportsError && (
                <div className="mt-4 rounded-[var(--radius)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {bulkDcfReportsError}
                </div>
              )}
              {!bulkDcfReportsLoading && bulkDcfReports.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--surface-muted)] text-left text-[var(--text-muted)]">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Ticker</th>
                        <th className="px-4 py-3 font-semibold">Report ID</th>
                        <th className="px-4 py-3 text-right font-semibold">Fair Value</th>
                        <th className="px-4 py-3 text-right font-semibold">Current Price</th>
                        <th className="px-4 py-3 text-right font-semibold">Upside</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]/60">
                      {bulkDcfReports.map((report) => (
                        <tr key={report.summary.report_id}>
                          <td className="px-4 py-3 font-bold text-[var(--text-primary)]">
                            <button
                              type="button"
                              onClick={() => onSelectTicker(report.summary.ticker)}
                              className="rounded underline decoration-dotted underline-offset-4"
                            >
                              {report.summary.ticker}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-[var(--text-muted)]">{report.summary.report_id}</td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatMoney(report.summary.estimated_value)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatMoney(report.summary.current_price)}</td>
                          <td className={`px-4 py-3 text-right font-semibold tabular-nums ${report.summary.upside_pct >= 0 ? "text-[var(--delta-up)]" : "text-[var(--delta-down)]"}`}>
                            {formatPct2(report.summary.upside_pct)}
                          </td>
                          <td className="px-4 py-3 text-[var(--text-muted)]">{report.summary.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
