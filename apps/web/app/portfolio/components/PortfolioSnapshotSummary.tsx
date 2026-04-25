"use client";

import { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

export interface SnapshotMeta {
  as_of_date: string;
  mode: string;
  comparison_universe: string;
  benchmark_ticker: string;
  generated_at: string;
  snapshot_versions_for_day: number;
  custom_tickers: string[];
  snapshot_is_stale: boolean;
}

export interface ComparisonData {
  snapshot: SnapshotMeta;
  market_expected_return: number;
  stock_expected_return_method: string;
  comparison_reference_return_method: string;
}

export interface SnapshotSummary {
  positiveSpreadCount: number;
  stockCount: number;
  positiveEconomicSpreadCount: number;
  highestSpreadValue: number | null;
  highestSpreadTicker: string;
  flaggedMetricsCount: number;
}

export interface HistoryPoint {
  as_of_date: string;
  generated_at: string;
  snapshot_version: string;
  snapshot_versions_for_day: number;
  snapshot_source: string;
  comparison_universe: string;
  benchmark_ticker: string;
  stock_count: number;
  average_expected_return_spread: number;
  average_roic_minus_wacc: number;
  average_dcf_value: number;
  market_expected_return: number;
}

interface PortfolioSnapshotSummaryProps {
  activeComparisonData: ComparisonData;
  portfolioSnapshotSummary: SnapshotSummary;
  selectedHistoryPoint: HistoryPoint | null;
  setSelectedHistoryPoint: (point: HistoryPoint | null) => void;
  formatDateLabel: (date: string) => string;
  portfolioComparisonUniverseLabel: (universe: string) => string;
  metricToneClass: (value: number | null) => string;
  formatMetricPercent: (value: number) => string;
  formatSyncTimestamp: (timestamp: string) => string;
  router: AppRouterInstance;
  setSnapshotHistoryOpen: (open: boolean) => void;
}

export function PortfolioSnapshotSummary({
  activeComparisonData,
  portfolioSnapshotSummary,
  selectedHistoryPoint,
  setSelectedHistoryPoint,
  formatDateLabel,
  portfolioComparisonUniverseLabel,
  metricToneClass,
  formatMetricPercent,
  formatSyncTimestamp,
  router,
  setSnapshotHistoryOpen,
}: PortfolioSnapshotSummaryProps) {
  return (
    <>
      {selectedHistoryPoint && (
        <div className="mt-4 flex flex-col gap-2 rounded-[var(--radius)] border border-[var(--accent)]/40 bg-[var(--surface-muted)] p-3 text-sm text-[var(--text-muted)] lg:flex-row lg:items-center lg:justify-between">
          <p>
            Reviewing saved snapshot from <span className="font-semibold text-[var(--text-primary)]">{formatDateLabel(selectedHistoryPoint.as_of_date)}</span>.
            Stock modal metrics and table values now follow that selected snapshot until you clear it. The saved benchmark and universe from that snapshot stay locked for review even if you change the current controls.
          </p>
          <button
            type="button"
            onClick={() => setSelectedHistoryPoint(null)}
            className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Clear History Selection
          </button>
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
        <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
          <div className="text-[var(--text-muted)]">As Of</div>
          <div className="mt-1 font-bold text-[var(--text-primary)]">
            {formatDateLabel(activeComparisonData.snapshot.as_of_date)}
          </div>
        </div>
        <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
          <div className="text-[var(--text-muted)]">Source</div>
          <div className="mt-1 overflow-inline-ellipsis font-bold capitalize text-[var(--text-primary)]" title={activeComparisonData.snapshot.mode}>
            {activeComparisonData.snapshot.mode}
          </div>
        </div>
        <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
          <div className="text-[var(--text-muted)]">Universe</div>
          <div className="mt-1 overflow-inline-ellipsis font-bold text-[var(--text-primary)]" title={portfolioComparisonUniverseLabel(activeComparisonData.snapshot.comparison_universe)}>
            {portfolioComparisonUniverseLabel(activeComparisonData.snapshot.comparison_universe)}
          </div>
        </div>
        <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
          <div className="text-[var(--text-muted)]">Benchmark</div>
          <div className="mt-1 overflow-inline-ellipsis font-bold text-[var(--text-primary)]" title={activeComparisonData.snapshot.benchmark_ticker}>
            {activeComparisonData.snapshot.benchmark_ticker}
          </div>
        </div>
        <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
          <div className="text-[var(--text-muted)]">Positive Spread</div>
          <div className="mt-1 font-bold text-[var(--text-primary)]">
            {portfolioSnapshotSummary.positiveSpreadCount} / {portfolioSnapshotSummary.stockCount}
          </div>
        </div>
        <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
          <div className="text-[var(--text-muted)]">Positive ROIC - WACC</div>
          <div className="mt-1 font-bold text-[var(--text-primary)]">
            {portfolioSnapshotSummary.positiveEconomicSpreadCount} / {portfolioSnapshotSummary.stockCount}
          </div>
        </div>
        <div className="rounded-[var(--radius)] bg-[var(--surface-muted)] p-3 text-xs">
          <div className="text-[var(--text-muted)]">Top Spread</div>
          <div className={`mt-1 font-bold ${metricToneClass(portfolioSnapshotSummary.highestSpreadValue)}`}>
            {portfolioSnapshotSummary.highestSpreadTicker} {portfolioSnapshotSummary.highestSpreadValue == null ? "" : `(${formatMetricPercent(portfolioSnapshotSummary.highestSpreadValue)})`}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2 text-sm text-[var(--text-muted)] lg:flex-row lg:items-center lg:justify-between">
        <p>
          Market expected return: {activeComparisonData.market_expected_return.toFixed(2)}%. Primary stock return: {activeComparisonData.stock_expected_return_method.replaceAll("_", " ")}. Reference return: {activeComparisonData.comparison_reference_return_method.replaceAll("_", " ")}.
        </p>
        <p title={activeComparisonData.snapshot.generated_at}>
          Generated: {formatSyncTimestamp(activeComparisonData.snapshot.generated_at)}. Versions for this KST day: {activeComparisonData.snapshot.snapshot_versions_for_day}. Holdings summarized: {portfolioSnapshotSummary.stockCount}.
        </p>
      </div>
      <div className="mt-3 rounded-[var(--radius)] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Portfolio-level averages for spread, `ROIC - WACC`, and DCF upside are intentionally demoted here. Per-stock values can be distorted by outliers, so the table view below is now the primary comparison surface.
        {portfolioSnapshotSummary.flaggedMetricsCount > 0 && ` ${portfolioSnapshotSummary.flaggedMetricsCount} metric value(s) are currently flagged as outliers and render as N/A in the table.`}
      </div>
      <div className="mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--text-muted)]">
        <p>
          <span className="font-semibold text-[var(--text-primary)]">Benchmark context:</span> `S&P 500` is the default portfolio reference because it is the clearest broad-market baseline for cross-market comparison. Korea presets remain available when you want local-market benchmarking.
        </p>
      </div>
      {activeComparisonData.snapshot.comparison_universe === "custom" && (
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          <span className="font-semibold text-[var(--text-primary)]">Custom tickers:</span>{" "}
          <span className="overflow-mono-block rounded-[var(--radius-sm)] bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--text-primary)]" title={activeComparisonData.snapshot.custom_tickers.join(", ") || "None"}>
            {activeComparisonData.snapshot.custom_tickers.join(", ") || "None"}
          </span>
        </p>
      )}
      {activeComparisonData.snapshot.snapshot_is_stale && (
        <p className="mt-2 text-sm text-amber-800">
          Current view is using the latest available saved snapshot because the current daily snapshot was not available.
        </p>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => router.push("/corporate")}
          className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          Open Full Comparison View
        </button>
        <button
          type="button"
          onClick={() => setSnapshotHistoryOpen(true)}
          className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] opacity-60"
        >
          Open Snapshot History
        </button>
      </div>
    </>
  );
}
