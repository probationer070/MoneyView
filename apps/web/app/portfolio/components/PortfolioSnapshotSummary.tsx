"use client";

import { formatNumber } from "@/lib/format";
import { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { CorporateComparisonHistoryPoint } from "../page";

export interface SnapshotMeta {
  as_of_date: string;
  mode: string;
  comparison_universe: string;
  benchmark_ticker: string;
  generated_at: string;
  custom_tickers: string[];
}

export interface ComparisonData {
  snapshot: SnapshotMeta;
  market_expected_return: number;
  stock_expected_return_method: string;
  comparison_reference_return_method: string;
}

export interface SnapshotSummary {
  positiveSpreadCount: number;
  /** Holdings with an implied return (not refused, not pre-v3): the denominator. */
  impliedSpreadCount: number;
  stockCount: number;
  positiveEconomicSpreadCount: number;
  highestSpreadValue: number | null;
  highestSpreadTicker: string;
  flaggedMetricsCount: number;
}

interface PortfolioSnapshotSummaryProps {
  activeComparisonData: ComparisonData;
  portfolioSnapshotSummary: SnapshotSummary;
  selectedHistoryPoint: CorporateComparisonHistoryPoint | null;
  setSelectedHistoryPoint: (point: CorporateComparisonHistoryPoint | null) => void;
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
        <div className="mt-4 flex flex-col gap-2 border border-[var(--brand-soft)] bg-[var(--surface)] p-3 type-body text-[var(--ink-muted)] lg:flex-row lg:items-center lg:justify-between">
          <p>
            Reviewing saved snapshot from {/* M2: inline emphasis inside a sentence; the weight separates the label from the text */}<span className="font-semibold text-[var(--ink)]">{formatDateLabel(selectedHistoryPoint.as_of_date)}</span>.
            Stock modal metrics and table values now follow that selected snapshot until you clear it. The saved benchmark and universe from that snapshot stay locked for review even if you change the current controls.
          </p>
          <button
            type="button"
            onClick={() => setSelectedHistoryPoint(null)}
            className="inline-flex items-center justify-center rounded-[var(--radius-1)] border border-[var(--line)] px-3 py-2 type-small text-[var(--ink-muted)] hover:text-[var(--ink)]"
          >
            Clear History Selection
          </button>
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
        <div className="bg-[var(--surface)] p-3 type-small">
          <div className="text-[var(--ink-muted)]">As Of</div>
          <div className="type-mono mt-1 text-[var(--ink)]">
            {formatDateLabel(activeComparisonData.snapshot.as_of_date)}
          </div>
        </div>
        <div className="bg-[var(--surface)] p-3 type-small">
          <div className="text-[var(--ink-muted)]">Source</div>
          <div className="type-mono mt-1 overflow-inline-ellipsis capitalize text-[var(--ink)]" title={activeComparisonData.snapshot.mode}>
            {activeComparisonData.snapshot.mode}
          </div>
        </div>
        <div className="bg-[var(--surface)] p-3 type-small">
          <div className="text-[var(--ink-muted)]">Universe</div>
          <div className="type-mono mt-1 overflow-inline-ellipsis text-[var(--ink)]" title={portfolioComparisonUniverseLabel(activeComparisonData.snapshot.comparison_universe)}>
            {portfolioComparisonUniverseLabel(activeComparisonData.snapshot.comparison_universe)}
          </div>
        </div>
        <div className="bg-[var(--surface)] p-3 type-small">
          <div className="text-[var(--ink-muted)]">Benchmark</div>
          <div className="type-mono mt-1 overflow-inline-ellipsis text-[var(--ink)]" title={activeComparisonData.snapshot.benchmark_ticker}>
            {activeComparisonData.snapshot.benchmark_ticker}
          </div>
        </div>
        <div data-testid="summary-beats-wacc" className="bg-[var(--surface)] p-3 type-small">
          <div className="text-[var(--ink-muted)]">Beats WACC (implied return)</div>
          <div className="type-mono mt-1 text-[var(--ink)]">
            {portfolioSnapshotSummary.impliedSpreadCount === 0
              ? "None recorded"
              : `${portfolioSnapshotSummary.positiveSpreadCount} / ${portfolioSnapshotSummary.impliedSpreadCount}`}
          </div>
        </div>
        <div className="bg-[var(--surface)] p-3 type-small">
          <div className="text-[var(--ink-muted)]">Positive ROIC - WACC</div>
          <div className="type-figure-md mt-1 text-[var(--ink)]">
            {portfolioSnapshotSummary.positiveEconomicSpreadCount} / {portfolioSnapshotSummary.stockCount}
          </div>
        </div>
        <div className="bg-[var(--surface)] p-3 type-small">
          <div className="text-[var(--ink-muted)]">Top implied return vs WACC</div>
          <div className={`type-mono mt-1 ${metricToneClass(portfolioSnapshotSummary.highestSpreadValue)}`}>
            {portfolioSnapshotSummary.highestSpreadTicker} {portfolioSnapshotSummary.highestSpreadValue == null ? "" : `(${formatMetricPercent(portfolioSnapshotSummary.highestSpreadValue)})`}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2 type-body text-[var(--ink-muted)] lg:flex-row lg:items-center lg:justify-between">
        <p>
          Market expected return: {formatNumber(activeComparisonData.market_expected_return / 100, "percent", { digits: 2 })}. Primary stock return: {activeComparisonData.stock_expected_return_method.replaceAll("_", " ")}. Reference return: {activeComparisonData.comparison_reference_return_method.replaceAll("_", " ")}.
        </p>
        <p title={activeComparisonData.snapshot.generated_at}>
          Generated: {formatSyncTimestamp(activeComparisonData.snapshot.generated_at)}. Holdings summarized: {portfolioSnapshotSummary.stockCount}.
        </p>
      </div>
      <div className="mt-3 border border-[var(--status-warning-border)] bg-[var(--status-warning-surface)] p-3 type-body text-[var(--status-warning-ink)]">
        Portfolio-level averages for implied return vs WACC, `ROIC - WACC`, and DCF value vs price are intentionally demoted here. Per-stock values can be distorted by outliers, so the table view below is now the primary comparison surface.
        {portfolioSnapshotSummary.flaggedMetricsCount > 0 && ` ${portfolioSnapshotSummary.flaggedMetricsCount} metric value(s) are currently flagged as outliers and render as N/A in the table.`}
      </div>
      <div className="mt-3 border border-[var(--line)] bg-[var(--surface)] p-3 type-body text-[var(--ink-muted)]">
        <p>
          {/* M2: inline emphasis inside a sentence; the weight separates the label from the text */}<span className="font-semibold text-[var(--ink)]">Benchmark context:</span> `S&P 500` is the default portfolio reference because it is the clearest broad-market baseline for cross-market comparison. Korea presets remain available when you want local-market benchmarking.
        </p>
      </div>
      {activeComparisonData.snapshot.comparison_universe === "custom" && (
        <p className="mt-2 type-body text-[var(--ink-muted)]">
          {/* M2: inline emphasis inside a sentence; the weight separates the label from the text */}<span className="font-semibold text-[var(--ink)]">Custom tickers:</span>{" "}
          <span className="overflow-mono-block rounded-[var(--radius-2)] bg-[var(--surface)] px-2 py-1 type-small text-[var(--ink)]" title={activeComparisonData.snapshot.custom_tickers.join(", ") || "None"}>
            {activeComparisonData.snapshot.custom_tickers.join(", ") || "None"}
          </span>
        </p>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => router.push("/corporate")}
          className="inline-flex items-center justify-center rounded-[var(--radius-1)] border border-[var(--line)] px-3 py-2 type-small text-[var(--ink-muted)] hover:text-[var(--ink)]"
        >
          Open Full Comparison View
        </button>
        <button
          type="button"
          onClick={() => setSnapshotHistoryOpen(true)}
          className="inline-flex items-center justify-center rounded-[var(--radius-1)] border border-[var(--line)] px-3 py-2 type-small text-[var(--ink-muted)] opacity-60"
        >
          Open Snapshot History
        </button>
      </div>
    </>
  );
}
