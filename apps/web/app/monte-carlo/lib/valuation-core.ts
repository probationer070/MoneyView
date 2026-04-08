import type { ValuationInput, ValuationResult } from "./types";

type ProgressCallback = (progress: number) => void;
type CancelCheck = () => boolean;

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function boxMuller(random: () => number) {
  const u1 = Math.max(random(), 1e-12);
  const u2 = random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function percentile(values: number[], pct: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (pct / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function histogram(values: number[], bins = 32) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = max === min ? 1 : (max - min) / bins;
  const counts = Array.from({ length: bins }, () => 0);
  for (const value of values) {
    const rawIndex = width === 0 ? 0 : Math.floor((value - min) / width);
    const index = Math.max(0, Math.min(bins - 1, rawIndex));
    counts[index] += 1;
  }
  return counts.map((count, index) => {
    const left = min + width * index;
    const right = left + width;
    const midpoint = (left + right) / 2;
    return {
      fair_value: Number(midpoint.toFixed(0)),
      frequency: Number((count / Math.max(values.length, 1)).toFixed(6)),
      count,
      undervalued_bucket: midpoint > 0 ? 1 : 0,
    };
  });
}

export function runValuationMonteCarlo(
  input: ValuationInput,
  onProgress?: ProgressCallback,
  isCancelled?: CancelCheck,
): ValuationResult {
  const random = mulberry32(input.seed);
  const fairValues = new Array<number>(input.simulationCount).fill(0);
  const baseTargetPer = Math.max(input.currentPrice / Math.max(input.baseEps, 1), 1);
  const forecastYears = Math.max(1, Math.round(input.forecastPeriodYears));
  onProgress?.(3);

  for (let index = 0; index < input.simulationCount; index += 1) {
    if (isCancelled?.()) throw new Error("Valuation simulation cancelled");

    const growthRate = Math.max(
      input.averageGrowthRate / 100 + boxMuller(random) * (input.growthUncertainty / 100),
      -0.8,
    );
    const discountRate = Math.max(
      input.discountRate / 100 + boxMuller(random) * (input.discountRateUncertainty / 100),
      0.03,
    );
    const terminalGrowthRate = Math.min(input.terminalGrowthRate / 100, discountRate - 0.005);
    const targetPer = Math.max(baseTargetPer + boxMuller(random) * input.targetPerUncertainty, 1);

    let fairValue = 0;
    let eps = input.baseEps;
    for (let year = 1; year <= forecastYears; year += 1) {
      const appliedGrowth = year === forecastYears ? terminalGrowthRate : growthRate;
      eps *= 1 + appliedGrowth;
      fairValue += eps / (1 + discountRate) ** year;
    }

    const terminalPrice = eps * targetPer;
    fairValue += terminalPrice / (1 + discountRate) ** forecastYears;
    fairValues[index] = fairValue;

    if (index % Math.max(1, Math.floor(input.simulationCount / 20)) === 0) {
      onProgress?.(5 + Math.round((index / input.simulationCount) * 85));
    }
  }

  const mean = fairValues.reduce((sum, value) => sum + value, 0) / fairValues.length;
  const variance = fairValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(fairValues.length - 1, 1);
  const std = Math.sqrt(Math.max(variance, 0));
  const median = percentile(fairValues, 50);
  const undervaluationProbability = fairValues.filter((value) => value > input.currentPrice).length / fairValues.length;
  const percentilePosition = fairValues.filter((value) => value <= input.currentPrice).length / fairValues.length;
  const zScore = std > 0 ? (mean - input.currentPrice) / std : 0;
  const upsidePotential = input.currentPrice > 0 ? (median / input.currentPrice - 1) * 100 : 0;
  onProgress?.(100);

  return {
    ticker: input.ticker.toUpperCase(),
    model: "Worker-side EPS/PER Monte Carlo valuation engine",
    valuation_distribution: histogram(fairValues),
    fair_value_summary: {
      current_price: Number(input.currentPrice.toFixed(0)),
      fair_value_mean: Number(mean.toFixed(0)),
      fair_value_median: Number(median.toFixed(0)),
      fair_value_p05: Number(percentile(fairValues, 5).toFixed(0)),
      fair_value_p10: Number(percentile(fairValues, 10).toFixed(0)),
      fair_value_p25: Number(percentile(fairValues, 25).toFixed(0)),
      fair_value_p75: Number(percentile(fairValues, 75).toFixed(0)),
      fair_value_p90: Number(percentile(fairValues, 90).toFixed(0)),
      fair_value_p95: Number(percentile(fairValues, 95).toFixed(0)),
      fair_value_std: Number(std.toFixed(0)),
      undervaluation_probability: Number((undervaluationProbability * 100).toFixed(4)),
      upside_potential: Number(upsidePotential.toFixed(4)),
      z_score: Number(zScore.toFixed(4)),
      percentile_position: Number((percentilePosition * 100).toFixed(4)),
    },
  };
}
