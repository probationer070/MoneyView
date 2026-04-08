import type { CorrelationInput, CorrelationResult } from "./types";

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

function cholesky(matrix: number[][]) {
  const size = matrix.length;
  const lower = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let sum = 0;
      for (let index = 0; index < column; index += 1) {
        sum += lower[row][index] * lower[column][index];
      }
      if (row === column) {
        lower[row][column] = Math.sqrt(Math.max(matrix[row][row] - sum, 1e-12));
      } else {
        lower[row][column] = (matrix[row][column] - sum) / Math.max(lower[column][column], 1e-12);
      }
    }
  }
  return lower;
}

function multiplyMatrixVector(matrix: number[][], vector: number[]) {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

function spearmanRho(x: number[], y: number[]) {
  const rank = (values: number[]) =>
    values
      .map((value, index) => ({ value, index }))
      .sort((a, b) => a.value - b.value)
      .reduce((ranks, item, rankIndex) => {
        ranks[item.index] = rankIndex + 1;
        return ranks;
      }, new Array<number>(values.length));
  const rankX = rank(x);
  const rankY = rank(y);
  const meanX = rankX.reduce((sum, value) => sum + value, 0) / rankX.length;
  const meanY = rankY.reduce((sum, value) => sum + value, 0) / rankY.length;
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let index = 0; index < rankX.length; index += 1) {
    const dx = rankX[index] - meanX;
    const dy = rankY[index] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  return numerator / Math.max(Math.sqrt(denomX * denomY), 1e-12);
}

export function runCorrelationMonteCarlo(
  input: CorrelationInput,
  onProgress?: ProgressCallback,
  isCancelled?: CancelCheck,
): CorrelationResult {
  const random = mulberry32(input.seed);
  const assets = input.assets.map((asset) => asset.name);
  const expected = input.assets.map((asset) => asset.expectedReturn / 100);
  const volatility = input.assets.map((asset) => asset.volatility / 100);
  const corr = input.correlationMatrix;
  const chol = cholesky(corr);
  const frontier: Array<{ return: number; risk: number; sharpe: number; is_optimal?: number; weights: number[] }> = [];
  const frontierCount = 400;

  onProgress?.(3);
  for (let index = 0; index < frontierCount; index += 1) {
    if (isCancelled?.()) throw new Error("Correlation simulation cancelled");
    const weightsRaw = assets.map(() => Math.max(random(), 1e-6));
    const totalWeight = weightsRaw.reduce((sum, value) => sum + value, 0);
    const weights = weightsRaw.map((value) => value / totalWeight);
    const portfolioReturn = expected.reduce((sum, value, assetIndex) => sum + value * weights[assetIndex], 0);
    let portfolioVariance = 0;
    for (let i = 0; i < assets.length; i += 1) {
      for (let j = 0; j < assets.length; j += 1) {
        portfolioVariance += weights[i] * weights[j] * volatility[i] * volatility[j] * corr[i][j];
      }
    }
    const portfolioRisk = Math.sqrt(Math.max(portfolioVariance, 0));
    const sharpe = (portfolioReturn - 0.03) / Math.max(portfolioRisk, 1e-6);
    frontier.push({
      return: Number((portfolioReturn * 100).toFixed(4)),
      risk: Number((portfolioRisk * 100).toFixed(4)),
      sharpe: Number(sharpe.toFixed(4)),
      weights,
    });
    if (index % Math.max(1, Math.floor(frontierCount / 12)) === 0) {
      onProgress?.(5 + Math.round((index / frontierCount) * 35));
    }
  }

  const optimal = frontier.reduce((best, current) => (current.sharpe > best.sharpe ? current : best), frontier[0]);
  optimal.is_optimal = 1;
  const averageStandaloneVolatility = volatility.reduce((sum, value) => sum + value, 0) / volatility.length;
  const diversificationEffect = (averageStandaloneVolatility - optimal.risk / 100) * 100;

  const heatmap = assets.flatMap((assetY, rowIndex) =>
    assets.map((assetX, columnIndex) => ({
      asset_x: assetX,
      asset_y: assetY,
      correlation: Number(corr[rowIndex][columnIndex].toFixed(4)),
    })),
  );

  const assetScenarioReturns = assets.map(() => new Array<number>(input.simulationCount).fill(0));
  const portfolioScenarioReturns = new Array<number>(input.simulationCount).fill(0);
  for (let scenarioIndex = 0; scenarioIndex < input.simulationCount; scenarioIndex += 1) {
    if (isCancelled?.()) throw new Error("Correlation simulation cancelled");
    const shocks = assets.map(() => boxMuller(random));
    const correlatedShocks = multiplyMatrixVector(chol, shocks);
    const realizedReturns = correlatedShocks.map((shock, assetIndex) => expected[assetIndex] + shock * volatility[assetIndex]);
    for (let assetIndex = 0; assetIndex < assets.length; assetIndex += 1) {
      assetScenarioReturns[assetIndex][scenarioIndex] = realizedReturns[assetIndex];
    }
    portfolioScenarioReturns[scenarioIndex] = realizedReturns.reduce(
      (sum, value, assetIndex) => sum + value * optimal.weights[assetIndex],
      0,
    );
    if (scenarioIndex % Math.max(1, Math.floor(input.simulationCount / 12)) === 0) {
      onProgress?.(40 + Math.round((scenarioIndex / Math.max(input.simulationCount, 1)) * 55));
    }
  }

  const spearmanSensitivityActual = assets.map((asset, assetIndex) => ({
    asset,
    spearman_rho_sensitivity: Number(spearmanRho(assetScenarioReturns[assetIndex], portfolioScenarioReturns).toFixed(4)),
  }));

  onProgress?.(100);
  return {
    model: "Worker-side portfolio correlation engine with Cholesky decomposition",
    assets,
    heatmap,
    efficient_frontier: frontier
      .map((point) => ({
        return: point.return,
        risk: point.risk,
        sharpe: point.sharpe,
        is_optimal: point.is_optimal,
      }))
      .sort((a, b) => a.risk - b.risk),
    spearman_sensitivity: spearmanSensitivityActual,
    covariance_summary: assets.map((asset, index) => ({
      asset,
      expected_return: Number((expected[index] * 100).toFixed(4)),
      volatility: Number((volatility[index] * 100).toFixed(4)),
    })),
    optimal_summary: {
      optimal_return: optimal.return,
      optimal_volatility: optimal.risk,
      diversification_effect: Number(diversificationEffect.toFixed(4)),
      optimal_sharpe: optimal.sharpe,
    },
  };
}
