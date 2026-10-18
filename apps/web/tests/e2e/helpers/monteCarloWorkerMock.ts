import type { Page } from "@playwright/test";

// Fixtures answer the Monte Carlo worker's three jobs. All numbers are won (path) or won per share (valuation).
export type PathFixture = Record<string, unknown>;

const TIMES = [0, 1, 2, 3, 4, 5];

// Terminal p50 is 9,640,000; every percentile column rises or falls monotonically so the cone is ordered.
const PATH_SUMMARY = TIMES.map((time) => ({
  time,
  mean: 10_000_000 - time * 70_000,
  p05: 10_000_000 - time * 400_000,
  p10: 10_000_000 - time * 300_000,
  p25: 10_000_000 - time * 150_000,
  p50: 10_000_000 - time * 72_000,
  p75: 10_000_000 + time * 120_000,
  p90: 10_000_000 + time * 300_000,
  p95: 10_000_000 + time * 420_000,
}));

export const PATH_FIXTURE: PathFixture = {
  ticker: "SIM",
  model: "mock",
  execution_mode: "interactive",
  path_summary: PATH_SUMMARY,
  sample_paths: TIMES.map((time) => {
    const row: Record<string, number> = { time };
    for (let index = 1; index <= 6; index += 1) row[`path_${index}`] = 10_000_000 + time * 100_000 * (index - 3);
    return row;
  }),
  risk_metrics: {
    loss_probability: 12,
    sharpe_ratio: 1.1,
    sortino_ratio: 1.0,
    skewness: 0.2,
    kurtosis: 3.4,
    max_return: 25,
    min_return: -12,
    var95: 6,
    var99: 9,
    cvar95: 11,
    mean_return: 10,
    median_return: 9,
    volatility: 18,
    excess_kurtosis: 0.4,
  },
  histogram: [
    { return: -15, frequency: 2, loss_bucket: 1 },
    { return: -10, frequency: 5, loss_bucket: 1 },
    { return: -5, frequency: 9, loss_bucket: 1 },
    { return: 5, frequency: 12, loss_bucket: 0 },
    { return: 10, frequency: 8, loss_bucket: 0 },
    { return: 15, frequency: 4, loss_bucket: 0 },
  ],
  normal_fit: [
    { return: -15, density: 0.02 },
    { return: -10, density: 0.05 },
    { return: -5, density: 0.09 },
    { return: 5, density: 0.12 },
    { return: 10, density: 0.08 },
    { return: 15, density: 0.04 },
  ],
  cdf_comparison: [
    { return: -15, simulated_cdf: 0.05, normal_cdf: 0.04 },
    { return: -10, simulated_cdf: 0.18, normal_cdf: 0.16 },
    { return: -5, simulated_cdf: 0.4, normal_cdf: 0.37 },
    { return: 5, simulated_cdf: 0.7, normal_cdf: 0.72 },
    { return: 10, simulated_cdf: 0.9, normal_cdf: 0.88 },
    { return: 15, simulated_cdf: 0.98, normal_cdf: 0.97 },
  ],
};

export const VALUATION_FIXTURE = {
  ticker: "SIM",
  model: "mock",
  valuation_distribution: [
    { fair_value: 36_000, frequency: 2 },
    { fair_value: 40_000, frequency: 5 },
    { fair_value: 44_000, frequency: 9 },
    { fair_value: 48_000, frequency: 14 },
    { fair_value: 52_000, frequency: 16 },
    { fair_value: 56_000, frequency: 12 },
    { fair_value: 60_000, frequency: 8 },
    { fair_value: 64_000, frequency: 5 },
    { fair_value: 68_000, frequency: 3 },
    { fair_value: 72_000, frequency: 1 },
  ],
  fair_value_summary: {
    current_price: 50_000,
    fair_value_mean: 50_400,
    fair_value_median: 50_000,
    fair_value_p05: 38_000,
    fair_value_p10: 41_200,
    fair_value_p25: 45_500,
    fair_value_p75: 54_800,
    fair_value_p90: 58_900,
    fair_value_p95: 62_000,
    fair_value_std: 7_600,
    undervaluation_probability: 48,
    upside_potential: 0.8,
    z_score: 0.05,
    percentile_position: 50,
  },
};

const ASSETS = ["Equity", "Bond", "Gold", "Cash"];

export const CORRELATION_FIXTURE = {
  model: "mock",
  assets: ASSETS,
  heatmap: ASSETS.flatMap((x, i) =>
    ASSETS.map((y, j) => ({ asset_x: x, asset_y: y, correlation: i === j ? 1 : Number((0.5 - Math.abs(i - j) * 0.2).toFixed(2)) })),
  ),
  efficient_frontier: Array.from({ length: 20 }, (_, index) => ({
    return: 4 + index * 0.4,
    risk: 5 + index * 0.5,
    sharpe: 0.5 + index * 0.02,
    is_optimal: index === 12 ? 1 : 0,
  })),
  spearman_sensitivity: ASSETS.map((asset, index) => ({ asset, spearman_rho_sensitivity: 0.4 - index * 0.2 })),
  covariance_summary: ASSETS.map((asset, index) => ({ asset, expected_return: 8 - index, volatility: 18 - index * 4 })),
  optimal_summary: { optimal_return: 9.2, optimal_volatility: 12.5, diversification_effect: 3.1, optimal_sharpe: 0.74 },
};

/** A path entry that answers its run with a worker error instead of a result. */
export function pathError(message: string): PathFixture {
  return { __mcError: message };
}

export type MonteCarloWorkerOptions = {
  /** One entry per path run, in order (the last repeats). Use pathError() for a run that fails. */
  path?: PathFixture[];
  /** One valuation result per run, in order (the last repeats). A single fixture answers every run. */
  valuation?: unknown | unknown[];
  correlation?: unknown;
  /** Withhold each run's result until the page calls window.__mcRelease(); every call releases the oldest held run. */
  hold?: boolean;
  /** Progress posted before the result. Default 50. */
  progress?: number;
};

/** Replaces window.Worker with a mock that answers run-path, run-valuation and run-correlation from fixtures. */
export async function installMonteCarloWorker(page: Page, options: MonteCarloWorkerOptions = {}): Promise<void> {
  const config = {
    path: options.path && options.path.length > 0 ? options.path : [PATH_FIXTURE],
    valuation: options.valuation === undefined ? [VALUATION_FIXTURE] : [options.valuation].flat(),
    correlation: options.correlation ?? CORRELATION_FIXTURE,
    hold: options.hold ?? false,
    progress: options.progress ?? 50,
  };

  await page.addInitScript((cfg) => {
    const w = window as unknown as {
      Worker: unknown;
      __mcCancelled: string[];
      __mcRelease: () => void;
    };
    w.__mcCancelled = [];
    let pathCalls = 0;
    let valuationCalls = 0;
    // Held runs queue up; each __mcRelease() call releases the oldest pending run only.
    const pending: Array<() => void> = [];
    w.__mcRelease = () => pending.shift()?.();

    class MockWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;

      private emit(data: unknown) {
        this.onmessage?.({ data } as MessageEvent);
      }

      postMessage(message: { type: string; requestId: string }) {
        if (message.type === "cancel") {
          w.__mcCancelled.push(message.requestId);
          return;
        }
        let reply: Record<string, unknown>;
        if (message.type === "run-path") {
          const index = Math.min(pathCalls, cfg.path.length - 1);
          pathCalls += 1;
          const entry = cfg.path[index] as Record<string, unknown>;
          reply = typeof entry.__mcError === "string" ? { type: "error", error: entry.__mcError } : { type: "result", result: entry };
        } else if (message.type === "run-valuation") {
          const result = cfg.valuation[Math.min(valuationCalls, cfg.valuation.length - 1)];
          valuationCalls += 1;
          reply = { type: "valuation-result", result };
        } else if (message.type === "run-correlation") {
          reply = { type: "correlation-result", result: cfg.correlation };
        } else {
          return;
        }
        window.setTimeout(() => this.emit({ type: "progress", requestId: message.requestId, progress: cfg.progress }), 0);
        const send = () => this.emit({ ...reply, requestId: message.requestId });
        if (cfg.hold) pending.push(() => window.setTimeout(send, 0));
        else window.setTimeout(send, 20);
      }

      terminate() {}
    }

    w.Worker = MockWorker;
  }, config);
}
