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
