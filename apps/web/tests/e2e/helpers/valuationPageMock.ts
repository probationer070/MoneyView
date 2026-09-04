import type { Page } from "@playwright/test";
import { API_PREFIX, json } from "./mockUtils";
import type { VerdictPanel } from "../../../app/valuation/verdictTypes";

// BOTH row states are present on purpose: two computed, two refused. A fixture
// where every row computes would pass against a UI that drops refusals -- and
// refusal is the majority state in the real data (2 of 4 rows refuse for every
// one of the 139 watchlist tickers as of 2026-09-04).
export const VERDICT_FIXTURE: VerdictPanel = {
  ticker: "AEP",
  direction:
    "Testing UNDERVALUATION. Each row states the basis it was compared against, and those bases differ.",
  rows: {
    drawdown: {
      value: -0.09395437797260045,
      comparison: "peer mean -12.9%",
      source: "own window: last 252 of 2513 bars; peers: 8 of 8 within 2025-09-04..2026-09-03",
      reason: null,
    },
    volume: {
      value: 1.1951446405779511,
      comparison: null,
      source: "own bars: 90/252 bars",
      reason: null,
    },
    trailing_pe: {
      value: null,
      comparison: null,
      source: "Damodaran",
      reason: "no_vintage: no industry benchmark data has been loaded",
    },
    dcf_gap: {
      value: null,
      comparison: null,
      source: "conservative case",
      reason: "no_vintage: no industry benchmark data has been loaded",
    },
  },
};

export const WATCHLIST_FIXTURE = [
  { ticker: "AEP", name: "American Electric Power", sector: "Utilities" },
  { ticker: "AAPL", name: "Apple", sector: "Technology" },
];

export interface ValuationMockOptions {
  panel?: VerdictPanel;
  /** Non-200 makes the verdict request fail, for the error-state test. */
  verdictStatus?: number;
  /** Hold the watchlist response open, to prove the panel never waits on it. */
  stallWatchlist?: boolean;
}

export async function mockValuationApi(page: Page, options: ValuationMockOptions = {}) {
  const panel = options.panel ?? VERDICT_FIXTURE;
  const verdictStatus = options.verdictStatus ?? 200;

  await page.route(`**${API_PREFIX}/portfolio/watchlist`, async (route) => {
    if (options.stallWatchlist) {
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
    // A BARE ARRAY, not the {status, data} envelope -- that is what this
    // endpoint actually returns, and fetchApi passes it through unchanged.
    return json(route, WATCHLIST_FIXTURE);
  });

  await page.route(`**${API_PREFIX}/valuation/verdict/**`, async (route) => {
    if (verdictStatus !== 200) {
      return json(route, { detail: "boom" }, verdictStatus);
    }
    return json(route, { status: "ok", data: panel, meta: {} });
  });
}
