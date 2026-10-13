import { isBridgeUnresolved } from "@/lib/bridgeQuality";
import type { CorporateComparisonRowApi } from "./corporateTypes";

export type PeerField = "roic" | "wacc" | "roic_minus_wacc" | "dcf_implied_return";

export type PeerRank =
  | { state: "absent" }
  | { state: "noValue" }
  | { state: "ranked"; value: number; rank: number; count: number; min: number; max: number; position: number };

function peerValue(row: CorporateComparisonRowApi, field: PeerField): number | null {
  // An unresolved bridge makes the backend send dcf_implied_return = 0.0 (a hardcoded value,
  // corporate_comparison.py), not a measured upside: never rank it (lib/bridgeQuality.ts).
  if (field === "dcf_implied_return" && isBridgeUnresolved(row.bridge_quality)) return null;
  const value = row[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Where `ticker` sits among the non-benchmark rows of the current comparison, high to low. */
export function peerRank(rows: readonly CorporateComparisonRowApi[], field: PeerField, ticker: string): PeerRank {
  const peers = rows.filter((row) => row.group_name !== "benchmark");
  const self = peers.find((row) => row.ticker.toUpperCase() === ticker.toUpperCase());
  if (!self) return { state: "absent" };
  const value = peerValue(self, field);
  if (value === null) return { state: "noValue" };
  const values = peers.map((row) => peerValue(row, field)).filter((v): v is number => v !== null);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    state: "ranked",
    value,
    rank: values.filter((v) => v > value).length + 1,
    count: values.length,
    min,
    max,
    position: max === min ? 0.5 : (value - min) / (max - min),
  };
}
