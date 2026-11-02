import type { Page } from "@playwright/test";
import { API_PREFIX, RECORDS_SYNC_OFF, json } from "./mockUtils";
import type { DecisionRow } from "../../../app/decisions/decisionTypes";

// The three states a decision row can be in, taken from a real
// GET /api/v1/decisions response (2026-09-04). Every test below depends on all
// three being present: a fixture where every decision is plottable would pass
// against a chart that silently drops the others.
export const DECISION_FIXTURE: DecisionRow[] = [
  {
    id: 3, ticker: "ZZTOP", decided_at: "2026-09-04T01:58:55.618499+00:00",
    action: "pass", memo: "no data, recording the pass anyway",
    price_at_decision: null, dcf_value: null, dcf_implied_return_pct: null,
    roic: null, wacc: null, risk_free_rate: null, equity_risk_premium: null,
    metric_schema_version: null, figures_source: "unavailable",
    figures_unavailable_reason: "no stored price for ZZTOP: the model cannot value it at this time", edited_at: null,
    outcome: { decided_on: "2026-09-04", price_now: null, price_date: null,
               price_move_pct: null, reason: "no price recorded at decision time" },
  },
  {
    id: 2, ticker: "NVDA", decided_at: "2026-09-04T01:58:55.569987+00:00",
    action: "watch", memo: "rich, watching for a pullback",
    price_at_decision: 100.0, dcf_value: 150.0, dcf_implied_return_pct: 50.0,
    roic: 20.0, wacc: 10.0, risk_free_rate: 0.042, equity_risk_premium: 0.055,
    metric_schema_version: 2, figures_source: "corporate_comparison._dcf_snapshot",
    figures_unavailable_reason: null, edited_at: null,
    outcome: { decided_on: "2026-09-04", price_now: null, price_date: null,
               price_move_pct: null, reason: "no bar with a close after 2026-09-04" },
  },
  {
    id: 1, ticker: "MSFT", decided_at: "2026-09-04T01:58:55.548308+00:00",
    action: "buy", memo: "cheap on FCF",
    price_at_decision: 100.0, dcf_value: 150.0, dcf_implied_return_pct: 50.0,
    roic: 20.0, wacc: 10.0, risk_free_rate: 0.042, equity_risk_premium: 0.055,
    metric_schema_version: 2, figures_source: "corporate_comparison._dcf_snapshot",
    figures_unavailable_reason: null, edited_at: null,
    outcome: { decided_on: "2026-09-04", price_now: 120.0, price_date: "2099-01-01",
               price_move_pct: 20.0, reason: null },
  },
];

export type DecisionsMockStats = {
  posts: Array<Record<string, unknown>>;
  patches: Array<{ id: number; body: Record<string, unknown> }>;
  deletes: number[];
};

export interface DecisionsMockOptions {
  /** Override the fixture. Used to reach the empty and all-excluded states. */
  rows?: DecisionRow[];
  /** Make POST fail with this status, to exercise the server-rejection path. */
  postStatus?: number;
  /** Make GET fail with this status, to exercise the failed-load path. */
  getStatus?: number;
  /** Make PATCH /decisions/{id} fail with this status. */
  patchStatus?: number;
}

export async function mockDecisionsApi(
  page: Page,
  options: DecisionsMockOptions = {}
): Promise<DecisionsMockStats> {
  const stats: DecisionsMockStats = { posts: [], patches: [], deletes: [] };
  // MUTABLE on purpose. A successful POST appends here, so the refetch that
  // follows query invalidation returns a DIFFERENT list. Against a frozen
  // fixture the invalidation test cannot fail: the list looks identical
  // whether or not the query was ever invalidated.
  const rows: DecisionRow[] = [...(options.rows ?? DECISION_FIXTURE)];
  const postStatus = options.postStatus ?? 200;
  const getStatus = options.getStatus ?? 200;

  await page.route(`**${API_PREFIX}/decisions`, async (route) => {
    if (route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      stats.posts.push(body);

      if (postStatus !== 200) {
        // Shaped like a real FastAPI validation failure. `fetchApi` throws on
        // any non-ok response and never surfaces `detail`, so no test may
        // assert on this text -- it is here only so the body is realistic.
        return json(route, { detail: "action must be one of buy, sell, watch, pass" }, postStatus);
      }

      const id = Math.max(0, ...rows.map((row) => row.id)) + 1;
      rows.unshift({
        id,
        ticker: String(body.ticker ?? ""),
        decided_at: "2026-09-05T00:00:00.000000+00:00",
        action: String(body.action ?? "buy"),
        memo: String(body.memo ?? ""),
        price_at_decision: 200.0, dcf_value: 260.0, dcf_implied_return_pct: 30.0,
        roic: 18.0, wacc: 9.0, risk_free_rate: 0.042, equity_risk_premium: 0.055,
        metric_schema_version: 2, figures_source: "corporate_comparison._dcf_snapshot",
        figures_unavailable_reason: null, edited_at: null,
        outcome: { decided_on: "2026-09-05", price_now: null, price_date: null,
                   price_move_pct: null, reason: "no bar with a close after 2026-09-05" },
      });
      return json(route, { status: "ok", data: { id }, meta: {} });
    }

    if (getStatus !== 200) {
      return json(route, { detail: "internal server error" }, getStatus);
    }
    return json(route, { status: "ok", data: rows, meta: {} });
  });

  // Edit and delete of one decision. Mutates `rows`, so the refetch after invalidation shows the change.
  await page.route(`**${API_PREFIX}/decisions/*`, async (route) => {
    const id = Number(new URL(route.request().url()).pathname.split("/").pop());
    const index = rows.findIndex((row) => row.id === id);
    const method = route.request().method();
    if (method === "PATCH") {
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      stats.patches.push({ id, body });
      if ((options.patchStatus ?? 200) !== 200) return json(route, { detail: "memo is required" }, options.patchStatus ?? 422);
      if (index < 0) return json(route, { detail: `no decision with id ${id}` }, 404);
      rows[index] = { ...rows[index], action: String(body.action), memo: String(body.memo), edited_at: "2026-11-01T05:12:00+00:00" };
      return json(route, { status: "ok", data: rows[index], meta: {} });
    }
    if (method === "DELETE") {
      stats.deletes.push(id);
      if (index < 0) return json(route, { detail: `no decision with id ${id}` }, 404);
      rows.splice(index, 1);
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fallback();
  });

  // Records sync status line (RecordsSyncStatus): off by default, overridden per test.
  await page.route(`**${API_PREFIX}/sync/status`, async (route) =>
    json(route, { status: "ok", data: { watchlist: {}, records: RECORDS_SYNC_OFF }, meta: {} })
  );

  return stats;
}
