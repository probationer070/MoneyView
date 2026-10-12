/** Mirrors `apps/api/models/schema_parts/signals.py`. */
export type SignalState = "triggered" | "near" | "not_triggered" | "stale";
export type ManualState = Exclude<SignalState, "stale">;
export interface ScenarioProbs { a: number; b: number; c: number }
export interface SignalResult {
  rule_id: string; label_ko: string; label_en: string; direction: "A" | "B" | null; kind: string | null;
  state: SignalState; value: number | null; observed_at: string | null; threshold: number | null;
  note: string; contribution: ScenarioProbs | null;
}
export interface SignalSnapshot {
  iso_week: string; run_at: string; rules_version: string; probs: ScenarioProbs;
  previous_probs: ScenarioProbs | null; results: SignalResult[]; failures: string[];
}
export interface SignalHistoryPoint { iso_week: string; run_at: string; rules_version: string; a: number; b: number; c: number }
export interface SignalRule { id: string; kind: string; direction: "A" | "B"; label: { ko: string; en: string } }
export interface SignalRules { version: string; scenario: Record<string, unknown>; rules: SignalRule[] }
export interface ManualInputSaved { iso_week: string; snapshot: SignalSnapshot | null }
