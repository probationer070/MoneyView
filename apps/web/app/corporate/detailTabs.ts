import type { CalculationDetailKey } from "./components/calculationDetailTypes";
import { ASSUMPTION_ROWS } from "./assumptionRows";
import type { PeerField } from "./peerRank";

export const DETAIL_TABS = ["summary", "steps", "trend", "peers", "sensitivity", "raw"] as const;
export type DetailTabKey = (typeof DETAIL_TABS)[number];

/** Plan N1: /corporate/metrics/{t}/history carries annual values for these two only. */
export const TREND_FIELDS: Partial<Record<CalculationDetailKey, "annual_growth_rates" | "annual_roic">> = {
  growth: "annual_growth_rates",
  roic: "annual_roic",
};

/** The comparison-row field each metric is positioned on in the Peers tab (spec §4, part A). */
export const PEER_FIELDS: Partial<Record<CalculationDetailKey, PeerField>> = {
  roic: "roic",
  wacc: "wacc",
  spread: "roic_minus_wacc",
  backendDcf: "dcf_implied_return",
  backendFairValue: "dcf_implied_return",
};

export function availableDetailTabs(key: CalculationDetailKey): DetailTabKey[] {
  return DETAIL_TABS.filter((tab) => {
    if (tab === "trend") return Object.hasOwn(TREND_FIELDS, key);
    if (tab === "peers") return Object.hasOwn(PEER_FIELDS, key);
    if (tab === "sensitivity") return ASSUMPTION_ROWS.some((row) => row.key === key);
    return true;
  });
}

/** The remembered tab when this metric has it, else Summary (spec §4). It never writes the memory. */
export function resolveDetailTab(stored: unknown, available: readonly DetailTabKey[]): DetailTabKey {
  return typeof stored === "string" && (available as readonly string[]).includes(stored) ? (stored as DetailTabKey) : "summary";
}
