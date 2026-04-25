import type {
  CdfComparisonPoint,
  CorrelationHeatmapPoint,
  CorrelationResult,
  EfficientFrontierPoint,
  HistogramPoint,
  MonteCarloResult,
  NormalFitPoint,
  PathSummaryPoint,
  SpearmanSensitivityPoint,
  ValuationDistributionPoint,
  ValuationResult,
} from "./types";

const MAX_WARNINGS = 10;

function addWarning(warnings: string[], message: string) {
  if (warnings.length >= MAX_WARNINGS || warnings.includes(message)) return;
  warnings.push(message);
}

function asFiniteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sanitizeNumber(value: unknown, fallback: number, warnings: string[], label: string) {
  const numeric = asFiniteNumber(value);
  if (numeric == null) {
    addWarning(warnings, `${label} was invalid and was reset to ${fallback}.`);
    return fallback;
  }
  return numeric;
}

function sanitizePathSummary(pathSummary: unknown, warnings: string[]): PathSummaryPoint[] {
  if (!Array.isArray(pathSummary)) {
    addWarning(warnings, "Path summary was missing from the worker result.");
    return [];
  }

  return pathSummary.flatMap((row, index) => {
    const point = row as Record<string, unknown>;
    const time = asFiniteNumber(point.time);
    const mean = asFiniteNumber(point.mean);
    const p05 = asFiniteNumber(point.p05);
    const p10 = asFiniteNumber(point.p10);
    const p25 = asFiniteNumber(point.p25);
    const p50 = asFiniteNumber(point.p50);
    const p75 = asFiniteNumber(point.p75);
    const p90 = asFiniteNumber(point.p90);
    const p95 = asFiniteNumber(point.p95);

    if ([time, mean, p05, p10, p25, p50, p75, p90, p95].some((value) => value == null)) {
      addWarning(warnings, `Dropped invalid percentile-cone row ${index + 1}.`);
      return [];
    }

    return [{
      time: time ?? 0,
      mean: mean ?? 0,
      p05: p05 ?? 0,
      p10: p10 ?? 0,
      p25: p25 ?? 0,
      p50: p50 ?? 0,
      p75: p75 ?? 0,
      p90: p90 ?? 0,
      p95: p95 ?? 0,
    }];
  });
}

function sanitizeHistogram(histogram: unknown, warnings: string[]): HistogramPoint[] {
  if (!Array.isArray(histogram)) {
    addWarning(warnings, "Histogram output was missing from the worker result.");
    return [];
  }

  return histogram.flatMap((row, index) => {
    const point = row as Record<string, unknown>;
    const returned = asFiniteNumber(point.return);
    const frequency = asFiniteNumber(point.frequency);
    if (returned == null || frequency == null) {
      addWarning(warnings, `Dropped invalid histogram row ${index + 1}.`);
      return [];
    }

    const lossBucket = asFiniteNumber(point.loss_bucket);
    const normalScaled = asFiniteNumber(point.normal_scaled);
    return [{
      return: returned,
      frequency,
      ...(lossBucket == null ? {} : { loss_bucket: lossBucket }),
      ...(normalScaled == null ? {} : { normal_scaled: normalScaled }),
    }];
  });
}

function sanitizeNormalFit(normalFit: unknown, warnings: string[]): NormalFitPoint[] {
  if (!Array.isArray(normalFit)) {
    addWarning(warnings, "Normal-fit overlay output was missing from the worker result.");
    return [];
  }

  return normalFit.flatMap((row, index) => {
    const point = row as Record<string, unknown>;
    const returned = asFiniteNumber(point.return);
    const density = asFiniteNumber(point.density);
    if (returned == null || density == null) {
      addWarning(warnings, `Dropped invalid normal-fit row ${index + 1}.`);
      return [];
    }
    return [{ return: returned, density }];
  });
}

function sanitizeCdf(cdf: unknown, warnings: string[]): CdfComparisonPoint[] {
  if (!Array.isArray(cdf)) {
    addWarning(warnings, "CDF comparison output was missing from the worker result.");
    return [];
  }

  return cdf.flatMap((row, index) => {
    const point = row as Record<string, unknown>;
    const returned = asFiniteNumber(point.return);
    const simulatedCdf = asFiniteNumber(point.simulated_cdf);
    const normalCdf = asFiniteNumber(point.normal_cdf);
    if ([returned, simulatedCdf, normalCdf].some((value) => value == null)) {
      addWarning(warnings, `Dropped invalid CDF row ${index + 1}.`);
      return [];
    }
    return [{
      return: returned ?? 0,
      simulated_cdf: simulatedCdf ?? 0,
      normal_cdf: normalCdf ?? 0,
    }];
  });
}

function sanitizeSamplePaths(
  samplePaths: unknown,
  pathSummary: PathSummaryPoint[],
  initialInvestment: number,
  warnings: string[],
) {
  if (!Array.isArray(samplePaths)) {
    addWarning(warnings, "Sample path output was missing from the worker result.");
    return { pathKeys: [] as string[], pathChartData: [] as Array<Record<string, number>> };
  }

  const firstValidRow = samplePaths.find((row) => {
    const point = row as Record<string, unknown>;
    return Object.keys(point).some((key) => key.startsWith("path_") && asFiniteNumber(point[key]) != null);
  }) as Record<string, unknown> | undefined;

  const pathKeys = firstValidRow
    ? Object.keys(firstValidRow).filter((key) => key.startsWith("path_") && asFiniteNumber(firstValidRow[key]) != null).slice(0, 12)
    : [];

  if (pathKeys.length === 0) {
    addWarning(warnings, "No valid simulated path series were returned.");
    return { pathKeys, pathChartData: [] as Array<Record<string, number>> };
  }

  const sanitizedRows = samplePaths.flatMap((row, index) => {
    const point = row as Record<string, unknown>;
    const time = asFiniteNumber(point.time);
    if (time == null) {
      addWarning(warnings, `Dropped invalid sample-path row ${index + 1}.`);
      return [];
    }

    const sanitized: Record<string, number> = { time };
    for (const pathKey of pathKeys) {
      const numeric = asFiniteNumber(point[pathKey]);
      if (numeric == null) {
        addWarning(warnings, `Dropped structurally incomplete sample-path row ${index + 1}.`);
        return [];
      }
      sanitized[pathKey] = numeric;
    }

    return [sanitized];
  });

  const sharedLength = Math.min(sanitizedRows.length, pathSummary.length);
  if (sanitizedRows.length !== pathSummary.length) {
    addWarning(warnings, "Path rows and percentile-cone rows had mismatched lengths and were trimmed to the shared range.");
  }

  const pathChartData = sanitizedRows.slice(0, sharedLength).map((row, index) => ({
    ...row,
    average_path: pathSummary[index]?.mean ?? initialInvestment,
    principal_line: initialInvestment,
  }));

  return { pathKeys, pathChartData };
}

export function normalizeMonteCarloResult(raw: MonteCarloResult, initialInvestment: number) {
  const warnings: string[] = [];
  const pathSummary = sanitizePathSummary(raw.path_summary, warnings);
  const histogram = sanitizeHistogram(raw.histogram, warnings);
  const normalFit = sanitizeNormalFit(raw.normal_fit, warnings);
  const cdfComparison = sanitizeCdf(raw.cdf_comparison, warnings);
  const { pathKeys, pathChartData } = sanitizeSamplePaths(raw.sample_paths, pathSummary, initialInvestment, warnings);

  const riskMetrics = Object.fromEntries(
    Object.entries(raw.risk_metrics ?? {}).map(([key, value]) => [
      key,
      sanitizeNumber(value, 0, warnings, `Risk metric \`${key}\``),
    ]),
  );

  return {
    result: {
      ...raw,
      path_summary: pathSummary,
      sample_paths: pathChartData.map((row) => (
        Object.fromEntries(
          Object.entries(row).filter(([key]) => key !== "average_path" && key !== "principal_line"),
        ) as Record<string, number>
      )),
      histogram,
      normal_fit: normalFit,
      cdf_comparison: cdfComparison,
      risk_metrics: riskMetrics,
    } satisfies MonteCarloResult,
    warnings,
    pathKeys,
    pathChartData,
    pathSummary,
  };
}

export function normalizeValuationResult(raw: ValuationResult) {
  const warnings: string[] = [];
  const valuationDistribution: ValuationDistributionPoint[] = Array.isArray(raw.valuation_distribution)
    ? raw.valuation_distribution.flatMap((row, index) => {
        const point = row as Record<string, unknown>;
        const fairValue = asFiniteNumber(point.fair_value);
        const frequency = asFiniteNumber(point.frequency);
        if (fairValue == null || frequency == null) {
          addWarning(warnings, `Dropped invalid fair-value distribution row ${index + 1}.`);
          return [];
        }
        return [{ fair_value: fairValue, frequency }];
      })
    : [];

  if (!Array.isArray(raw.valuation_distribution)) {
    addWarning(warnings, "Fair-value distribution output was missing from the worker result.");
  }

  return {
    result: {
      ...raw,
      valuation_distribution: valuationDistribution,
      fair_value_summary: {
        current_price: sanitizeNumber(raw.fair_value_summary?.current_price, 0, warnings, "Current price"),
        fair_value_mean: sanitizeNumber(raw.fair_value_summary?.fair_value_mean, 0, warnings, "Mean fair value"),
        fair_value_median: sanitizeNumber(raw.fair_value_summary?.fair_value_median, 0, warnings, "Median fair value"),
        fair_value_p05: sanitizeNumber(raw.fair_value_summary?.fair_value_p05, 0, warnings, "Fair value P05"),
        fair_value_p10: sanitizeNumber(raw.fair_value_summary?.fair_value_p10, 0, warnings, "Fair value P10"),
        fair_value_p25: sanitizeNumber(raw.fair_value_summary?.fair_value_p25, 0, warnings, "Fair value P25"),
        fair_value_p75: sanitizeNumber(raw.fair_value_summary?.fair_value_p75, 0, warnings, "Fair value P75"),
        fair_value_p90: sanitizeNumber(raw.fair_value_summary?.fair_value_p90, 0, warnings, "Fair value P90"),
        fair_value_p95: sanitizeNumber(raw.fair_value_summary?.fair_value_p95, 0, warnings, "Fair value P95"),
        fair_value_std: sanitizeNumber(raw.fair_value_summary?.fair_value_std, 0, warnings, "Fair value standard deviation"),
        undervaluation_probability: sanitizeNumber(raw.fair_value_summary?.undervaluation_probability, 0, warnings, "Undervaluation probability"),
        upside_potential: sanitizeNumber(raw.fair_value_summary?.upside_potential, 0, warnings, "Upside potential"),
        z_score: sanitizeNumber(raw.fair_value_summary?.z_score, 0, warnings, "Valuation z-score"),
        percentile_position: sanitizeNumber(raw.fair_value_summary?.percentile_position, 0, warnings, "Valuation percentile position"),
      },
    } satisfies ValuationResult,
    warnings,
  };
}

export function normalizeCorrelationResult(raw: CorrelationResult) {
  const warnings: string[] = [];

  const heatmap: CorrelationHeatmapPoint[] = Array.isArray(raw.heatmap)
    ? raw.heatmap.flatMap((row, index) => {
        const correlation = asFiniteNumber(row.correlation);
        if (!row.asset_x || !row.asset_y || correlation == null) {
          addWarning(warnings, `Dropped invalid heatmap row ${index + 1}.`);
          return [];
        }
        return [{ asset_x: row.asset_x, asset_y: row.asset_y, correlation }];
      })
    : [];

  const efficientFrontier: EfficientFrontierPoint[] = Array.isArray(raw.efficient_frontier)
    ? raw.efficient_frontier.flatMap((row, index) => {
        const returned = asFiniteNumber(row.return);
        const risk = asFiniteNumber(row.risk);
        const sharpe = asFiniteNumber(row.sharpe);
        if ([returned, risk, sharpe].some((value) => value == null)) {
          addWarning(warnings, `Dropped invalid efficient-frontier row ${index + 1}.`);
          return [];
        }
        return [{
          return: returned ?? 0,
          risk: risk ?? 0,
          sharpe: sharpe ?? 0,
          ...(row.is_optimal == null ? {} : { is_optimal: sanitizeNumber(row.is_optimal, 0, warnings, `Efficient frontier optimal flag ${index + 1}`) }),
        }];
      })
    : [];

  const spearmanSensitivity: SpearmanSensitivityPoint[] = Array.isArray(raw.spearman_sensitivity)
    ? raw.spearman_sensitivity.flatMap((row, index) => {
        const sensitivity = asFiniteNumber(row.spearman_rho_sensitivity);
        if (!row.asset || sensitivity == null) {
          addWarning(warnings, `Dropped invalid Spearman sensitivity row ${index + 1}.`);
          return [];
        }
        return [{ asset: row.asset, spearman_rho_sensitivity: sensitivity }];
      })
    : [];

  return {
    result: {
      ...raw,
      heatmap,
      efficient_frontier: efficientFrontier,
      spearman_sensitivity: spearmanSensitivity,
      covariance_summary: Array.isArray(raw.covariance_summary)
        ? raw.covariance_summary.map((row, index) => ({
            asset: row.asset,
            expected_return: sanitizeNumber(row.expected_return, 0, warnings, `Covariance summary return ${index + 1}`),
            volatility: sanitizeNumber(row.volatility, 0, warnings, `Covariance summary volatility ${index + 1}`),
          }))
        : [],
      optimal_summary: {
        optimal_return: sanitizeNumber(raw.optimal_summary?.optimal_return, 0, warnings, "Optimal return"),
        optimal_volatility: sanitizeNumber(raw.optimal_summary?.optimal_volatility, 0, warnings, "Optimal volatility"),
        diversification_effect: sanitizeNumber(raw.optimal_summary?.diversification_effect, 0, warnings, "Diversification effect"),
        optimal_sharpe: sanitizeNumber(raw.optimal_summary?.optimal_sharpe, 0, warnings, "Optimal Sharpe"),
      },
    } satisfies CorrelationResult,
    warnings,
  };
}
