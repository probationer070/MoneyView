import type { ScenarioProbs, SignalHistoryPoint } from "../../../packages/shared-types";

export type Scenario = keyof ScenarioProbs;

export function deltaPp(current: number, previous: number | null): number | null {
  return previous === null ? null : Math.round((current - previous) * 1000) / 10;
}

export function formatDelta(pp: number | null): string {
  if (pp === null) return "—";
  if (pp > 0) return `▲ ${pp.toFixed(1)}%p`;
  if (pp < 0) return `▼ ${Math.abs(pp).toFixed(1)}%p`;
  return "0.0%p";
}

export function formatProb(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

export function mostLikely(probs: ScenarioProbs): Scenario {
  return (["a", "b", "c"] as const).reduce<Scenario>((best, s) => (probs[s] > probs[best] ? s : best), "a");
}

/** Weeks whose rules_version differs from the week before: probability moves there may come
 * from a rules.yaml edit rather than from the market. */
export function rulesVersionBreaks(history: SignalHistoryPoint[]): string[] {
  return history.filter((p, i) => i > 0 && p.rules_version !== history[i - 1].rules_version).map((p) => p.iso_week);
}
