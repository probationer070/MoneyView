import type { MetricQuality } from "../../../../packages/shared-types";
import type {
  CorporateComparisonResponse,
  CorporateComparisonSnapshotMeta,
  PortfolioComparisonUniverse,
  PortfolioStock,
} from "./page";

export type PortfolioMetricSourceMode =
  | "selected_snapshot"
  | "snapshot"
  | "live"
  | "cached"
  | "unavailable";

export interface PortfolioMetricValue {
  value: number | null;
  displayValue: string;
  quality: MetricQuality;
  reason?: string;
}

export interface PortfolioTickerMetrics {
  ticker: string;
  roicMinusWacc: PortfolioMetricValue;
  dcfUpside: PortfolioMetricValue;
  expectedVsMarket: PortfolioMetricValue;
  volatility: PortfolioMetricValue;
  currentPrice: number | null;
  sourceMode: PortfolioMetricSourceMode;
  asOf: string | null;
  snapshotVersion: string | null;
  warnings: string[];
  excludedFromRanking: boolean;
}

const METRIC_OUTLIER_ABS = 500;

function isMetricOutlier(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) || Math.abs(value) > METRIC_OUTLIER_ABS;
}

function formatMetricPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${Number(value).toFixed(2)}%`;
}

function buildUnavailableMetric(reason: string): PortfolioMetricValue {
  return {
    value: null,
    displayValue: "N/A",
    quality: "missing",
    reason,
  };
}

function buildNumericMetric(
  value: number | null | undefined,
  {
    sourceMode,
    missingReason,
    suspiciousReason,
    stale,
    estimated = false,
  }: {
    sourceMode: PortfolioMetricSourceMode;
    missingReason: string;
    suspiciousReason: string;
    stale: boolean;
    estimated?: boolean;
  },
): PortfolioMetricValue {
  if (value == null || !Number.isFinite(value)) {
    return buildUnavailableMetric(missingReason);
  }
  if (Math.abs(value) > METRIC_OUTLIER_ABS) {
    return {
      value,
      displayValue: formatMetricPercent(value),
      quality: "suspicious",
      reason: suspiciousReason,
    };
  }
  return {
    value,
    displayValue: formatMetricPercent(value),
    quality: stale ? "stale" : estimated ? "estimated" : "ok",
    reason: stale
      ? sourceMode === "cached"
        ? "Using cached comparison metrics while fresher data is unavailable."
        : "Using the latest available stale comparison snapshot."
      : estimated
        ? "Estimated from local sparkline history rather than comparison API output."
        : undefined,
  };
}

export function buildPortfolioDisplayMetric(
  value: number | null | undefined,
  {
    missingReason,
    suspiciousReason,
  }: {
    missingReason: string;
    suspiciousReason: string;
  },
): PortfolioMetricValue {
  return buildNumericMetric(value, {
    sourceMode: "snapshot",
    missingReason,
    suspiciousReason,
    stale: false,
  });
}

function unavailableReasonForSource(sourceMode: PortfolioMetricSourceMode) {
  switch (sourceMode) {
    case "selected_snapshot":
      return "No selected comparison snapshot row for this ticker.";
    case "snapshot":
      return "No latest comparison snapshot for this ticker.";
    case "live":
      return "Latest live comparison unavailable for this ticker.";
    case "cached":
      return "No cached comparison result for this ticker.";
    default:
      return "No portfolio comparison data has been loaded yet.";
  }
}

function comparisonSourceMode(args: {
  selectedHistoryPointSnapshotVersion: string | null;
  selectedSnapshotData: CorporateComparisonResponse | undefined;
  comparisonData: CorporateComparisonResponse | null;
  comparisonQueryHasData: boolean;
}): PortfolioMetricSourceMode {
  if (args.selectedHistoryPointSnapshotVersion && args.selectedSnapshotData) return "selected_snapshot";
  if (args.comparisonQueryHasData && args.comparisonData?.snapshot.mode === "live") return "live";
  if (args.comparisonQueryHasData && args.comparisonData?.snapshot.mode === "snapshot") return "snapshot";
  if (args.comparisonData) return "cached";
  return "unavailable";
}

export function metricToneClass(metric: PortfolioMetricValue) {
  if (metric.quality === "invalid" || metric.quality === "missing") return "text-amber-700";
  if (metric.quality === "suspicious") return "text-amber-700";
  if ((metric.value ?? 0) === 0) return "text-[var(--text-muted)]";
  return (metric.value ?? 0) > 0 ? "text-[var(--delta-up)]" : "text-[var(--delta-down)]";
}

export function volatilityToneClass(metric: PortfolioMetricValue) {
  if (metric.quality === "invalid" || metric.quality === "missing" || metric.quality === "suspicious") return "text-amber-700";
  const value = metric.value ?? 0;
  if (value >= 35) return "text-[var(--delta-down)]";
  if (value >= 20) return "text-amber-700";
  return "text-[var(--state-success)]";
}

export function metricDisplayTitle(metric: PortfolioMetricValue) {
  if (metric.reason) return `${metric.displayValue} - ${metric.reason}`;
  return metric.displayValue;
}

export function metricSubtitle(metric: PortfolioMetricValue) {
  return metric.reason ?? null;
}

export function metricNumericValue(metric: PortfolioMetricValue) {
  return metric.quality === "invalid" || metric.quality === "missing" || metric.quality === "suspicious"
    ? null
    : metric.value;
}

export function buildPortfolioTickerMetrics(args: {
  watchlist: PortfolioStock[];
  activeComparisonData: CorporateComparisonResponse | null;
  comparisonData: CorporateComparisonResponse | null;
  selectedSnapshotData: CorporateComparisonResponse | undefined;
  selectedHistoryPointSnapshotVersion: string | null;
  portfolioComparisonUniverse: PortfolioComparisonUniverse;
  portfolioComparisonQueryHasData: boolean;
  activeSnapshotMeta: CorporateComparisonSnapshotMeta | null;
  estimateVolatilityFromSparkline: (sparkline: number[]) => number | null;
}): Record<string, PortfolioTickerMetrics> {
  const sourceMode = comparisonSourceMode({
    selectedHistoryPointSnapshotVersion: args.selectedHistoryPointSnapshotVersion,
    selectedSnapshotData: args.selectedSnapshotData,
    comparisonData: args.comparisonData,
    comparisonQueryHasData: args.portfolioComparisonQueryHasData,
  });
  const rowsByTicker = new Map(
    (args.activeComparisonData?.rows ?? [])
      .filter((row) => row.group_name !== "benchmark")
      .map((row) => [row.ticker, row] as const),
  );
  return args.watchlist.reduce<Record<string, PortfolioTickerMetrics>>((acc, stock) => {
    const row = rowsByTicker.get(stock.ticker);
    const stale = Boolean(args.activeSnapshotMeta?.snapshot_is_stale) || sourceMode === "cached";
    const warnings: string[] = [];
    if (stale) {
      warnings.push(
        sourceMode === "cached"
          ? "Using cached comparison metrics while fresher data is unavailable."
          : "Using the latest available stale comparison snapshot.",
      );
    }
    if (!row && args.portfolioComparisonUniverse === "custom") {
      warnings.push("Ticker is excluded from the current custom comparison universe.");
    }

    const missingComparisonReason = !row && args.portfolioComparisonUniverse === "custom"
      ? "Ticker is excluded from the current custom comparison universe."
      : unavailableReasonForSource(sourceMode);
    const volatilityEstimate = args.estimateVolatilityFromSparkline(stock.sparkline ?? []);
    const metrics: PortfolioTickerMetrics = {
      ticker: stock.ticker,
      roicMinusWacc: row
        ? buildNumericMetric(row.roic_minus_wacc, {
          sourceMode,
          missingReason: "Missing ROIC or WACC input for this ticker.",
          suspiciousReason: "ROIC - WACC falls outside the sanity range and is excluded from ranking.",
          stale,
        })
        : buildUnavailableMetric(missingComparisonReason),
      dcfUpside: row
        ? buildNumericMetric(row.dcf_implied_return, {
          sourceMode,
          missingReason: "Missing DCF output for this ticker.",
          suspiciousReason: "DCF upside falls outside the sanity range and is excluded from ranking.",
          stale,
        })
        : buildUnavailableMetric(missingComparisonReason),
      expectedVsMarket: row
        ? buildNumericMetric(row.expected_return_spread, {
          sourceMode,
          missingReason: "Missing expected-return comparison for this ticker.",
          suspiciousReason: "Expected vs Market falls outside the sanity range and is excluded from ranking.",
          stale,
        })
        : buildUnavailableMetric(missingComparisonReason),
      volatility: buildNumericMetric(volatilityEstimate, {
        sourceMode,
        missingReason: "Not enough price history to estimate volatility.",
        suspiciousReason: "Volatility estimate falls outside the sanity range and is excluded from ranking.",
        stale: false,
        estimated: volatilityEstimate != null,
      }),
      currentPrice: row?.current_price ?? stock.last_close ?? null,
      sourceMode,
      asOf: args.activeSnapshotMeta?.as_of_date ?? null,
      snapshotVersion: args.activeSnapshotMeta?.snapshot_version ?? null,
      warnings,
      excludedFromRanking: Boolean(
        [row?.roic_minus_wacc, row?.dcf_implied_return, row?.expected_return_spread].some((value) => isMetricOutlier(value)),
      ),
    };
    acc[stock.ticker] = metrics;
    return acc;
  }, {});
}
