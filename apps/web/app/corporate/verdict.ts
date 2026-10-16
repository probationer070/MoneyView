import type { DcfSummary } from "../../../../packages/shared-types";
import { bridgedEstimatedValue, bridgedUpsidePct } from "@/lib/bridgeQuality";
import type { LabelKey } from "@/lib/i18n/labels";

// The backend's DCF status (corporate_dcf.py:321-323), translated only (spec D5): the frontend
// adds no threshold. Anything else is shown as sent.
const STATUS_LABELS: Record<string, LabelKey> = {
  Undervalued: "undervalued",
  Overvalued: "overvalued",
  "Bridge Incomplete": "bridgeIncomplete",
};

export function verdictLabelKey(status: string): LabelKey | null {
  // Own keys only: a status of "constructor" must not resolve to Object's prototype.
  return Object.hasOwn(STATUS_LABELS, status) ? STATUS_LABELS[status] : null;
}

export type VerdictState = "idle" | "streaming" | "valued" | "refused";

/** Everything the verdict block and the header strip show, decided once (spec §2.2, §2A). */
export interface VerdictView {
  state: VerdictState;
  streaming: boolean;
  /** Intrinsic value per share; null when the bridge did not resolve or nothing is valued. */
  intrinsic: number | null;
  /** Upside in percent against that per-share value; null on the same conditions. */
  upside: number | null;
  /** Enterprise value, shown only beside an empty per-share slot. A value restored from an older session cache can lack it. */
  enterpriseValue: number | null;
  currentPrice: number | null;
  /** The backend's status, translated by VerdictStatusLabel; "" unless valued. */
  status: string;
  refusalText: string | null;
}

export function verdictView(dcf: DcfSummary | null, streaming: boolean, refusalText: string | null): VerdictView {
  const state: VerdictState = refusalText !== null ? "refused" : dcf ? "valued" : streaming ? "streaming" : "idle";
  const shown = state === "valued" ? dcf : null; // a refusal hides any value still held
  return {
    state,
    streaming,
    intrinsic: shown ? bridgedEstimatedValue(shown) : null,
    upside: shown ? bridgedUpsidePct(shown) : null,
    enterpriseValue: shown && typeof shown.enterprise_value === "number" ? shown.enterprise_value : null,
    currentPrice: shown ? shown.current_price : null,
    status: shown ? shown.status : "",
    refusalText,
  };
}
