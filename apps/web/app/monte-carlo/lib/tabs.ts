import { tabStateKey } from "@/lib/tabState";

/** Display order of the five Simulation Lab tabs. */
export const MONTE_CARLO_TABS = ["path", "risk", "distribution", "valuation", "correlation"] as const;

export type MonteCarloTab = (typeof MONTE_CARLO_TABS)[number];

/** sessionStorage key "moneyview.tab.monteCarlo.tab"; useTabState stores the value as JSON. */
export const MONTE_CARLO_TAB_KEY = tabStateKey("monteCarlo", "tab");

/** A stored value is only honoured when it is one of the five keys; includes() cannot be fooled by "constructor". */
export function isMonteCarloTab(value: unknown): value is MonteCarloTab {
  return typeof value === "string" && (MONTE_CARLO_TABS as readonly string[]).includes(value);
}
