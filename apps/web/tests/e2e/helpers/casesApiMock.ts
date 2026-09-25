import type { Page } from "@playwright/test";
import { API_PREFIX, RECORDS_SYNC_OFF, json } from "./mockUtils";
import type {
  CaseRecord, CaseSummary, DiffResult, RunResult, SimulateResult,
} from "../../../app/cases/caseTypes";

// Three cases: a conservative parent, a fork of it, and an unrelated ticker. The list tests
// need all three: a filter test against one ticker cannot see a filter that does nothing.
export const CASE_SUMMARIES: CaseSummary[] = [
  { id: 1, case_name: "conservative_AAPL_2026-01-01", ticker: "AAPL", as_of_date: "2026-09-04", base_year: 2025, target_year: 2035, parent_case_id: null },
  { id: 2, case_name: "AAPL higher margin", ticker: "AAPL", as_of_date: "2026-09-04", base_year: 2025, target_year: 2035, parent_case_id: 1 },
  { id: 3, case_name: "conservative_MSFT_2026-01-01", ticker: "MSFT", as_of_date: "2026-09-04", base_year: 2025, target_year: 2035, parent_case_id: null },
];

function record(summary: CaseSummary, overrides: Record<string, unknown> = {}): CaseRecord {
  return {
    ...summary,
    riskfree_rate: 0.042, wacc_initial: 0.09, wacc_stable: 0.074, wacc_converge_from: 5,
    marginal_tax_rate: 0.25, effective_tax_rate: 0.15, nol_balance: 0, roic_stable: 0.12,
    terminal_growth: 0.03, cash: 100, debt: 50, ipo_proceeds: 0, shares_basic: 100, shares_new: 0,
    segments: [{
      id: summary.id * 10, name: "Core", base_revenue: 1000, base_margin: 0.2, tam_target: null,
      market_share_target: null, revenue_target: 2000, margin_target: 0.28,
      sales_to_capital_early: 2, sales_to_capital_late: 3, ramp_start_year: 1,
      initial_growth: null, waypoint_gap_fraction: null,
      narratives: [{ input_field: "base_margin", claim: "trailing three-year margin", evidence_source: "10-K", confidence: "derived", three_p: "probable" }],
    }],
    ...overrides,
  };
}

export const CASE_RECORDS: Record<number, CaseRecord> = {
  1: record(CASE_SUMMARIES[0]),
  2: record(CASE_SUMMARIES[1], { wacc_stable: 0.081 }),
  3: record(CASE_SUMMARIES[2]),
};

const years = 10;
const series = (start: number, step: number) => Array.from({ length: years }, (_, i) => start + step * i);

export const RUN_RESULT: RunResult = {
  case_id: 1, case_name: "conservative_AAPL_2026-01-01", base_year: 2025, target_year: 2035,
  segments: [{ name: "Core", revenue: series(1100, 100), margin: series(0.21, 0.007), ebit: series(231, 30), reinvestment: series(50, 5) }],
  revenue: series(1100, 100), ebit: series(231, 30), tax: series(35, 5), reinvestment: series(50, 5),
  fcff: series(146, 20), wacc: series(0.09, -0.0016),
  terminal_value_share_pct: 66.31, enterprise_value: 4946.3, equity_value: 4996.3,
  value_per_share_basic: 49.96, value_per_share_diluted: 49.96,
};

export const DIFF_RESULT: DiffResult = {
  case_id: 2, parent_case_id: 1, metric: "value_per_share_diluted",
  parent_value_per_share_diluted: 49.96, case_value_per_share_diluted: 52.32,
  total_difference: 2.36, method: "shapley", changed_input_count: 3,
  contributions: [
    { input: "case.wacc_stable", from: 0.074, to: 0.081, contribution: -6.14 },
    { input: "segment.Core.base_margin", from: 0.2, to: 0.22, contribution: 0.5 },
    { input: "segment.Core.margin_target", from: 0.28, to: 0.35, contribution: 8.0 },
  ],
};

export const SIMULATE_RESULT: SimulateResult = {
  case_id: 1, metric: "value_per_share_diluted", seed: 1234,
  runs_requested: 2000, runs_valid: 1934, runs_refused: 66, refused_fraction: 0.033,
  refusals: [{ code: "terminal_spread", count: 66, message: "WACC must exceed terminal growth" }],
  p10: 41.2, p50: 49.1, p90: 57.8, mean: 49.4,
  histogram: Array.from({ length: 32 }, (_, i) => ({ lower: 35 + i, upper: 36 + i, count: 10 + (i % 7) })),
  association_among_accepted_samples: [
    { input: "case.wacc_stable", spearman: -0.81 },
    { input: "segment.Core.margin_target", spearman: 0.42 },
  ],
};

// Keys ABSENT, exactly as case_simulate returns them at or above the cap.
export const SIMULATE_SUPPRESSED: SimulateResult = {
  case_id: 1, metric: "value_per_share_diluted", seed: 99,
  runs_requested: 2000, runs_valid: 1500, runs_refused: 500, refused_fraction: 0.25,
  refusals: [{ code: "terminal_spread", count: 500, message: "WACC must exceed terminal growth" }],
};

export interface CasesMockOptions {
  cases?: CaseSummary[];
  listStatus?: number;
  runStatus?: number;
  runDetail?: string;
  diffStatus?: number;
  diffDetail?: string;
  diffResult?: DiffResult;
  forkStatus?: number;
  forkDetail?: string;
  simulateResult?: SimulateResult;
}

export interface CasesMockStats {
  forkPosts: Array<Record<string, unknown>>;
  simulatePosts: Array<Record<string, unknown>>;
}

export async function mockCasesApi(page: Page, options: CasesMockOptions = {}): Promise<CasesMockStats> {
  const stats: CasesMockStats = { forkPosts: [], simulatePosts: [] };
  const cases = [...(options.cases ?? CASE_SUMMARIES)];
  const records: Record<number, CaseRecord> = { ...CASE_RECORDS };

  await page.route(`**${API_PREFIX}/valuation/cases**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`${API_PREFIX}/valuation/cases`.length);
    const method = request.method();

    if (path === "" && method === "GET") {
      if (options.listStatus) return json(route, { detail: "internal server error" }, options.listStatus);
      return json(route, { status: "ok", data: cases, meta: {} });
    }
    const match = /^\/(\d+)(\/(run|diff|fork|simulate))?$/.exec(path);
    if (!match) return json(route, { detail: "Not Found" }, 404);
    const id = Number(match[1]);
    const action = match[3];

    if (!action) {
      const found = records[id];
      return found ? json(route, { status: "ok", data: found, meta: {} })
                   : json(route, { detail: `no valuation case with id ${id}` }, 404);
    }
    if (action === "run") {
      if (options.runStatus) return json(route, { detail: options.runDetail ?? "engine refused" }, options.runStatus);
      return json(route, { status: "ok", data: { ...RUN_RESULT, case_id: id }, meta: {} });
    }
    if (action === "diff") {
      if (options.diffStatus) return json(route, { detail: options.diffDetail ?? "refused" }, options.diffStatus);
      return json(route, { status: "ok", data: options.diffResult ?? DIFF_RESULT, meta: {} });
    }
    if (action === "fork") {
      const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      stats.forkPosts.push(body);
      if (options.forkStatus) return json(route, { detail: options.forkDetail ?? "refused" }, options.forkStatus);
      const newId = Math.max(...cases.map((c) => c.id)) + 1;
      const parent = cases.find((c) => c.id === id)!;
      const summary = { ...parent, id: newId, case_name: String(body.case_name), parent_case_id: id };
      cases.push(summary);
      records[newId] = record(summary);
      return json(route, { status: "ok", data: { id: newId }, meta: {} });
    }
    const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
    stats.simulatePosts.push(body);
    const result = options.simulateResult ?? SIMULATE_RESULT;
    return json(route, { status: "ok", data: { ...result, seed: typeof body.seed === "number" ? body.seed : result.seed }, meta: {} });
  });

  await page.route(`**${API_PREFIX}/sync/status`, async (route) =>
    json(route, { status: "ok", data: { watchlist: {}, records: RECORDS_SYNC_OFF }, meta: {} }),
  );
  return stats;
}
