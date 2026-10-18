import type { MessageKey } from "@/lib/i18n/translate";
import type { CorrelationResult, SharedSimulationResult, ValuationResult } from "./types";
import type { MonteCarloTab } from "./tabs";

export type RunStatus = "idle" | "loading" | "error" | "cancelled";

export type RunStatusView = {
  state: "empty" | "running" | "failed" | "cancelled" | "ready";
  labelKey: MessageKey;
  progress: number | null;
};

// Maps a run's status (and whether an earlier result exists) to the status line. Progress is set only while running.
export function runStatusView(status: RunStatus, progress: number, hasResult: boolean): RunStatusView {
  if (status === "loading") {
    return { state: "running", labelKey: "monteCarlo.status.running", progress: clampPercent(progress) };
  }
  if (status === "error") return { state: "failed", labelKey: "monteCarlo.status.failed", progress: null };
  if (status === "cancelled") return { state: "cancelled", labelKey: "monteCarlo.status.cancelled", progress: null };
  if (hasResult) return { state: "ready", labelKey: "monteCarlo.status.ready", progress: null };
  return { state: "empty", labelKey: "monteCarlo.status.empty", progress: null };
}

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

// The previous figure's text, shown beside the current one. Null when there is nothing to compare or the text is unchanged.
export function beforeText(
  previous: number | null | undefined,
  current: number | null,
  format: (n: number) => string,
): string | null {
  if (previous == null || !Number.isFinite(previous)) return null;
  if (current == null || !Number.isFinite(current)) return null;
  const before = format(previous);
  return before === format(current) ? null : before;
}

// The figure values a run's tab showed when that run started, keyed by figure key.
export type FigureSnapshot = { tab: MonteCarloTab; values: Record<string, number | null> };

// A figure's previous text: only the tab that started the before run shows one.
export function previousFigure(
  before: FigureSnapshot | null,
  tab: MonteCarloTab,
  key: string,
  current: number | null,
  format: (n: number) => string,
): string | null {
  return before?.tab === tab ? beforeText(before.values[key], current, format) : null;
}

// Each tab's figure values, keyed as its ResultHeader figures are. The sections render them and a run snapshots them.
export function pathFigureValues(simulation: SharedSimulationResult | null) {
  return {
    median: simulation?.terminalMedian ?? null,
    expectedReturn: simulation?.medianExpectedReturn ?? null,
    lossProbability: simulation?.raw.risk_metrics.loss_probability ?? null,
    sharpe: simulation?.raw.risk_metrics.sharpe_ratio ?? null,
  };
}

export function valuationFigureValues(result: ValuationResult | null) {
  const summary = result?.fair_value_summary;
  return {
    median: summary?.fair_value_median ?? null,
    undervaluation: summary?.undervaluation_probability ?? null,
    upside: summary?.upside_potential ?? null,
    interval80: summary?.fair_value_p10 ?? null,
  };
}

export function correlationFigureValues(result: CorrelationResult | null) {
  const summary = result?.optimal_summary;
  return {
    optimalMu: summary?.optimal_return ?? null,
    portfolioSigma: summary?.optimal_volatility ?? null,
    diversification: summary?.diversification_effect ?? null,
    optimalSharpe: summary?.optimal_sharpe ?? null,
  };
}
