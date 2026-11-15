import { formatNumber } from "@/lib/format";
import type { MetricQuality } from "../../../../packages/shared-types";
import { impliedReturnRefusalText } from "@/lib/impliedReturn";
import { englishTr, type Tr } from "@/app/cases/caseFields";
import type {
  CorporateComparisonResponse,
  CorporateComparisonSnapshotMeta,
  PortfolioComparisonUniverse,
  PortfolioStock,
} from "./page";

export type PortfolioMetricSourceMode =
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
  impliedVsWacc: PortfolioMetricValue;
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
  return formatNumber(Number(value) / 100, "percent", { digits: 2 });
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
    t = englishTr,
  }: {
    sourceMode: PortfolioMetricSourceMode;
    missingReason: string;
    suspiciousReason: string;
    stale: boolean;
    estimated?: boolean;
    t?: Tr;
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
        ? t("portfolio.metricReason.staleCached")
        : t("portfolio.metricReason.staleSnapshot")
      : estimated
        ? t("portfolio.metricReason.estimatedSparkline")
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

function unavailableReasonForSource(sourceMode: PortfolioMetricSourceMode, t: Tr = englishTr) {
  switch (sourceMode) {
    case "snapshot":
      return t("portfolio.metricReason.noSnapshot");
    case "live":
      return t("portfolio.metricReason.liveUnavailable");
    case "cached":
      return t("portfolio.metricReason.noCached");
    default:
      return t("portfolio.metricReason.noComparisonLoaded");
  }
}

function comparisonSourceMode(args: {
  comparisonData: CorporateComparisonResponse | null;
  comparisonQueryHasData: boolean;
}): PortfolioMetricSourceMode {
  if (args.comparisonQueryHasData && args.comparisonData?.snapshot.mode === "live") return "live";
  if (args.comparisonQueryHasData && args.comparisonData?.snapshot.mode === "snapshot") return "snapshot";
  if (args.comparisonData) return "cached";
  return "unavailable";
}

export function metricToneClass(metric: PortfolioMetricValue) {
  if (metric.quality === "invalid" || metric.quality === "missing") return "text-[var(--status-warning-ink)]";
  if (metric.quality === "suspicious") return "text-[var(--status-warning-ink)]";
  if ((metric.value ?? 0) === 0) return "text-[var(--ink-muted)]";
  return (metric.value ?? 0) > 0 ? "text-[var(--up)]" : "text-[var(--down)]";
}

export function volatilityToneClass(metric: PortfolioMetricValue) {
  if (metric.quality === "invalid" || metric.quality === "missing" || metric.quality === "suspicious") return "text-[var(--status-warning-ink)]";
  const value = metric.value ?? 0;
  if (value >= 35) return "text-[var(--down)]";
  if (value >= 20) return "text-[var(--status-warning-ink)]";
  return "text-[var(--status-success-ink)]";
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
  portfolioComparisonUniverse: PortfolioComparisonUniverse;
  portfolioComparisonQueryHasData: boolean;
  activeSnapshotMeta: CorporateComparisonSnapshotMeta | null;
  estimateVolatilityFromSparkline: (sparkline: number[]) => number | null;
  t?: Tr;
}): Record<string, PortfolioTickerMetrics> {
  const t = args.t ?? englishTr;
  const sourceMode = comparisonSourceMode({
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
          ? t("portfolio.metricReason.staleCached")
          : t("portfolio.metricReason.staleSnapshot"),
      );
    }
    if (!row && args.portfolioComparisonUniverse === "custom") {
      warnings.push(t("portfolio.metricReason.excludedCustom"));
    }

    const missingComparisonReason = !row && args.portfolioComparisonUniverse === "custom"
      ? t("portfolio.metricReason.excludedCustom")
      : unavailableReasonForSource(sourceMode, t);
    const volatilityEstimate = args.estimateVolatilityFromSparkline(stock.sparkline ?? []);
    const metrics: PortfolioTickerMetrics = {
      ticker: stock.ticker,
      roicMinusWacc: row
        ? buildNumericMetric(row.roic_minus_wacc, {
          sourceMode,
          missingReason: t("portfolio.metricReason.missingRoicWacc"),
          suspiciousReason: t("portfolio.metricReason.suspiciousRoicWacc"),
          stale,
          t,
        })
        : buildUnavailableMetric(missingComparisonReason),
      dcfUpside: row
        ? buildNumericMetric(row.dcf_implied_return, {
          sourceMode,
          missingReason: row.dcf_refusal ? impliedReturnRefusalText(row.dcf_refusal, "en", t) : t("portfolio.metricReason.missingDcf"),
          suspiciousReason: t("portfolio.metricReason.suspiciousDcf"),
          stale,
          t,
        })
        : buildUnavailableMetric(missingComparisonReason),
      impliedVsWacc: row
        ? buildNumericMetric(row.implied_return_spread, {
          sourceMode,
          // Says why: a refusal code, or "not recorded before metric v3" when there is none.
          missingReason: impliedReturnRefusalText(row.implied_return_refusal, "en", t),
          suspiciousReason: t("portfolio.metricReason.suspiciousImpliedWacc"),
          stale,
          t,
        })
        : buildUnavailableMetric(missingComparisonReason),
      volatility: buildNumericMetric(volatilityEstimate, {
        sourceMode,
        missingReason: t("portfolio.metricReason.volatilityMissing"),
        suspiciousReason: t("portfolio.metricReason.suspiciousVolatility"),
        stale: false,
        estimated: volatilityEstimate != null,
        t,
      }),
      currentPrice: row?.current_price ?? stock.last_close ?? null,
      sourceMode,
      asOf: args.activeSnapshotMeta?.as_of_date ?? null,
      snapshotVersion: args.activeSnapshotMeta?.snapshot_version ?? null,
      warnings,
      excludedFromRanking: Boolean(
        // Outliers only: a refused or unrecorded (null) metric is not an outlier, and ranking
        // already skips rows without a value.
        [row?.roic_minus_wacc, row?.dcf_implied_return, row?.implied_return_spread].some((value) => value != null && isMetricOutlier(value)),
      ),
    };
    acc[stock.ticker] = metrics;
    return acc;
  }, {});
}
