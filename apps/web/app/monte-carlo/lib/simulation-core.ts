import type { MonteCarloResult, PathSimulationInput } from "./types";

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

function percentile(values: ArrayLike<number>, pct: number) {
  if (values.length === 0) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const index = (pct / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function normalPdf(x: number, mean: number, std: number) {
  if (std <= 0) return 0;
  const z = (x - mean) / std;
  return Math.exp(-0.5 * z * z) / (std * Math.sqrt(2 * Math.PI));
}

function normalCdf(x: number, mean: number, std: number) {
  if (std <= 0) return 0;
  return 0.5 * (1 + erf((x - mean) / (std * Math.sqrt(2))));
}

function erf(x: number) {
  const sign = x >= 0 ? 1 : -1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

function histogram(values: ArrayLike<number>, bins = 32) {
  if (values.length === 0) return [];
  let min = values[0];
  let max = values[0];
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const width = max === min ? 1 : (max - min) / bins;
  const counts = Array.from({ length: bins }, () => 0);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const rawIndex = width === 0 ? 0 : Math.floor((value - min) / width);
    const bucketIndex = Math.max(0, Math.min(bins - 1, rawIndex));
    counts[bucketIndex] += 1;
  }
  return counts.map((count, index) => {
    const left = min + width * index;
    const right = left + width;
    const midpoint = (left + right) / 2;
    return {
      return: Number((midpoint * 100).toFixed(4)),
      frequency: Number((count / Math.max(values.length, 1)).toFixed(6)),
      count,
      loss_bucket: midpoint < 0 ? 1 : 0,
    };
  });
}

export function runSharedMonteCarloSimulation(
  input: PathSimulationInput,
  onProgress?: ProgressCallback,
  isCancelled?: CancelCheck,
): MonteCarloResult {
  const effectiveExecutionMode =
    input.executionMode === "summary" || input.simulationCount >= 20_000 ? "summary" : "interactive";
  const random = mulberry32(input.seed);
  const stepsPerYear = 252;
  const steps = Math.max(1, Math.round(input.investmentHorizonYears * stepsPerYear));
  const dt = input.investmentHorizonYears / steps;
  const drift = ((input.expectedAnnualReturn / 100) - 0.5 * (input.annualVolatility / 100) ** 2) * dt;
  const diffusionScale = (input.annualVolatility / 100) * Math.sqrt(dt);
  const jumpLambda = -12 * Math.log(Math.max(1 - input.jumpProbabilityMonthly / 100, 1e-9));
  const jumpMean = -(input.annualVolatility / 100) * input.jumpIntensityMultiplier;
  const jumpVolatility = Math.max((input.annualVolatility / 100) * 0.35, 0.02);
  const pathCount = input.simulationCount;
  const samplePathCount = Math.min(effectiveExecutionMode === "summary" ? 8 : 20, pathCount);
  const targetCheckpointCount = effectiveExecutionMode === "summary" ? 41 : 81;
  const checkpointStride = Math.max(1, Math.floor(steps / Math.max(targetCheckpointCount - 1, 1)));
  const checkpointSteps: number[] = [0];
  for (let step = checkpointStride; step < steps; step += checkpointStride) {
    checkpointSteps.push(step);
  }
  if (checkpointSteps.at(-1) !== steps) checkpointSteps.push(steps);
  const checkpointIndexByStep = new Map(checkpointSteps.map((step, index) => [step, index]));

  const samplePaths = Array.from({ length: samplePathCount }, () => new Float64Array(checkpointSteps.length));
  const percentileColumns = Array.from({ length: checkpointSteps.length }, () => new Float64Array(pathCount));
  const terminalReturns = new Float64Array(pathCount);

  onProgress?.(2);
  for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
    if (isCancelled?.()) {
      throw new Error("Simulation cancelled");
    }
    let value = input.initialInvestment;
    let checkpointIndex = 0;
    percentileColumns[checkpointIndex][pathIndex] = value;
    if (pathIndex < samplePathCount) samplePaths[pathIndex][checkpointIndex] = value;
    for (let step = 1; step <= steps; step += 1) {
      const shock = boxMuller(random);
      const jumpOccurs = random() < jumpLambda * dt;
      const jump = jumpOccurs ? jumpMean + boxMuller(random) * jumpVolatility : 0;
      value *= Math.exp(drift + diffusionScale * shock + jump);
      const maybeCheckpointIndex = checkpointIndexByStep.get(step);
      if (maybeCheckpointIndex !== undefined) {
        checkpointIndex = maybeCheckpointIndex;
        percentileColumns[checkpointIndex][pathIndex] = value;
        if (pathIndex < samplePathCount) samplePaths[pathIndex][checkpointIndex] = value;
      }
    }
    terminalReturns[pathIndex] = value / input.initialInvestment - 1;
    if (pathIndex % Math.max(1, Math.floor(pathCount / 24)) === 0) {
      onProgress?.(5 + Math.round((pathIndex / pathCount) * 60));
    }
  }

  const pathSummary: Array<Record<string, number>> = [];
  const sampledPathRows: Array<Record<string, number>> = [];
  for (const [checkpointIndex, step] of checkpointSteps.entries()) {
    const column = percentileColumns[checkpointIndex];
    const summaryRow = {
      time: Number(((step / steps) * input.investmentHorizonYears).toFixed(4)),
      mean: Number((column.reduce((sum, value) => sum + value, 0) / column.length).toFixed(4)),
      p05: Number(percentile(column, 5).toFixed(4)),
      p10: Number(percentile(column, 10).toFixed(4)),
      p25: Number(percentile(column, 25).toFixed(4)),
      p50: Number(percentile(column, 50).toFixed(4)),
      p75: Number(percentile(column, 75).toFixed(4)),
      p90: Number(percentile(column, 90).toFixed(4)),
      p95: Number(percentile(column, 95).toFixed(4)),
    };
    pathSummary.push(summaryRow);
    const pathRow: Record<string, number> = { time: summaryRow.time };
    for (let pathIndex = 0; pathIndex < samplePathCount; pathIndex += 1) {
      pathRow[`path_${pathIndex + 1}`] = Number(samplePaths[pathIndex][checkpointIndex].toFixed(4));
    }
    sampledPathRows.push(pathRow);
  }
  onProgress?.(72);

  const meanReturn = terminalReturns.reduce((sum, value) => sum + value, 0) / terminalReturns.length;
  const medianReturn = percentile(terminalReturns, 50);
  const variance = terminalReturns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) / Math.max(terminalReturns.length - 1, 1);
  const std = Math.sqrt(Math.max(variance, 0));
  const losses = terminalReturns.map((value) => -value);
  const var95 = percentile(losses, 95);
  const var99 = percentile(losses, 99);
  const cvar95Values = losses.filter((value) => value >= var95);
  const cvar99Values = losses.filter((value) => value >= var99);
  const downside = terminalReturns.filter((value) => value < 0);
  const downsideDeviation = downside.length ? Math.sqrt(downside.reduce((sum, value) => sum + value * value, 0) / downside.length) : 0;
  const excessReturn = meanReturn - (input.riskFreeRate / 100) * input.investmentHorizonYears;
  const sortino = downsideDeviation > 0 ? excessReturn / downsideDeviation : 0;
  const annualizedReturn = meanReturn > -1 && input.investmentHorizonYears > 0 ? (1 + meanReturn) ** (1 / input.investmentHorizonYears) - 1 : meanReturn;
  const annualizedVolatility = input.investmentHorizonYears > 0 ? std / Math.sqrt(input.investmentHorizonYears) : std;
  const sharpe = annualizedVolatility > 0 ? (annualizedReturn - input.riskFreeRate / 100) / annualizedVolatility : 0;
  const skewness = std > 0 ? terminalReturns.reduce((sum, value) => sum + ((value - meanReturn) / std) ** 3, 0) / terminalReturns.length : 0;
  const excessKurtosis = std > 0 ? terminalReturns.reduce((sum, value) => sum + ((value - meanReturn) / std) ** 4, 0) / terminalReturns.length - 3 : 0;
  const kurtosis = excessKurtosis + 3;
  let minReturn = terminalReturns[0];
  let maxReturn = terminalReturns[0];
  for (let index = 1; index < terminalReturns.length; index += 1) {
    const value = terminalReturns[index];
    if (value < minReturn) minReturn = value;
    if (value > maxReturn) maxReturn = value;
  }
  const riskMetrics = {
    mean_return: Number((meanReturn * 100).toFixed(4)),
    median_return: Number((medianReturn * 100).toFixed(4)),
    volatility: Number((std * 100).toFixed(4)),
    annualized_return: Number((annualizedReturn * 100).toFixed(4)),
    annualized_volatility: Number((annualizedVolatility * 100).toFixed(4)),
    sharpe_ratio: Number(sharpe.toFixed(4)),
    var95: Number((var95 * 100).toFixed(4)),
    var99: Number((var99 * 100).toFixed(4)),
    cvar95: Number((((cvar95Values.reduce((sum, value) => sum + value, 0) / Math.max(cvar95Values.length, 1))) * 100).toFixed(4)),
    cvar99: Number((((cvar99Values.reduce((sum, value) => sum + value, 0) / Math.max(cvar99Values.length, 1))) * 100).toFixed(4)),
    sortino_ratio: Number(sortino.toFixed(4)),
    skewness: Number(skewness.toFixed(4)),
    kurtosis: Number(kurtosis.toFixed(4)),
    excess_kurtosis: Number(excessKurtosis.toFixed(4)),
    max_return: Number((maxReturn * 100).toFixed(4)),
    min_return: Number((minReturn * 100).toFixed(4)),
    loss_probability: Number(((terminalReturns.filter((value) => value < 0).length / terminalReturns.length) * 100).toFixed(4)),
  };

  const histogramRows = histogram(terminalReturns);
  const low = percentile(terminalReturns, 1);
  const high = percentile(terminalReturns, 99);
  const normalFitRows = Array.from({ length: 80 }, (_, index) => {
    const x = low + ((high - low) * index) / 79;
    return {
      return: Number((x * 100).toFixed(4)),
      density: Number(normalPdf(x, meanReturn, std).toFixed(6)),
    };
  });
  const cdfComparison = Array.from({ length: 50 }, (_, index) => {
    const quantile = 1 + (98 * index) / 49;
    const simulated = percentile(terminalReturns, quantile);
    return {
      return: Number((simulated * 100).toFixed(4)),
      simulated_cdf: Number((quantile / 100).toFixed(4)),
      normal_cdf: Number(normalCdf(simulated, meanReturn, std).toFixed(4)),
    };
  });
  onProgress?.(100);

  return {
    ticker: "KRW-PORT",
    model: "Browser Monte Carlo shared engine: GBM + jump-diffusion for path, risk, and return distribution tabs",
    execution_mode: effectiveExecutionMode,
    path_summary: pathSummary,
    sample_paths: sampledPathRows,
    risk_metrics: riskMetrics,
    histogram: histogramRows,
    normal_fit: normalFitRows,
    cdf_comparison: cdfComparison,
  };
}
