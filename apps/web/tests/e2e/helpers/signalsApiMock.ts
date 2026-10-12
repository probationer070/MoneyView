import type { Page } from "@playwright/test";

const result = (rule_id: string, state: string, extra: Record<string, unknown> = {}) => ({
  rule_id, label_ko: rule_id, label_en: rule_id, direction: "B", kind: "level_streak", state,
  value: 5.55, observed_at: "2026-10-09", threshold: 5.5, note: "", contribution: null, ...extra,
});

export const SNAPSHOT = {
  iso_week: "2026-W41", run_at: "2026-10-10T00:00:00+00:00", rules_version: "v2",
  probs: { a: 0.25, b: 0.5, c: 0.25 }, previous_probs: { a: 0.3, b: 0.45, c: 0.25 },
  previous_iso_week: "2026-W40", failures: [],
  results: [
    result("b_tnx_sticky", "triggered", { contribution: { a: -0.05, b: 0.02, c: 0.03 } }),
    result("b_brent_spike", "stale", { value: null, note: "FRED DCOILBRENTEU: no observation in the last 30 days" }),
  ],
};
export const HISTORY = [
  { iso_week: "2026-W39", run_at: "", rules_version: "v1", a: 0.35, b: 0.45, c: 0.2 },
  { iso_week: "2026-W40", run_at: "", rules_version: "v1", a: 0.3, b: 0.45, c: 0.25 },
  { iso_week: "2026-W41", run_at: "", rules_version: "v2", a: 0.25, b: 0.5, c: 0.25 },
];
const manualRule = (id: string, en: string) => ({ id, kind: "manual", direction: "B", label: { ko: id, en } });
const RULES = { version: "v2", scenario: {}, rules: [
  manualRule("m_capex_reaction", "Capex raised, stock fell"),
  manualRule("m_iran_strike", "Iran strikes resume"),
  manualRule("m_breadth", "Market breadth improving"),
] };

export interface SignalsMockOptions {
  runFailures?: string[];
  latestFailures?: string[];
  noSnapshot?: boolean;
  emptyHistory?: boolean;
  runFails?: boolean;
  manualFails?: boolean;
  /** Every automatic rule stale: the snapshot carries no evidence. */
  allStale?: boolean;
  /** A save reply whose snapshot is null: the saved week has no snapshot yet. */
  manualNullSnapshot?: boolean;
  /** A run whose snapshot judges the Iran signal as near, at a later run time. */
  runAddsIranNear?: boolean;
}

export async function mockSignalsApi(page: Page, options: SignalsMockOptions = {}) {
  const calls = { run: 0, manual: [] as { url: string; method: string; body: unknown }[] };
  const base = options.allStale
    ? { ...SNAPSHOT, results: SNAPSHOT.results.map((r) => ({ ...r, state: "stale" })) }
    : SNAPSHOT;
  let latest: unknown = options.noSnapshot ? null : { ...base, failures: options.latestFailures ?? [] };
  const ok = (data: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", data, meta: {} }) });
  await page.route("**/api/v1/signals/latest", (r) => r.fulfill(ok(latest)));
  await page.route("**/api/v1/signals/history**", (r) => r.fulfill(ok(options.emptyHistory ? [] : HISTORY)));
  await page.route("**/api/v1/signals/rules", (r) => r.fulfill(ok(RULES)));
  await page.route("**/api/v1/signals/run", (r) => {
    calls.run += 1;
    if (options.runFails) return r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ status: "error", data: null, meta: {} }) });
    const ran = options.runAddsIranNear
      ? { ...SNAPSHOT, run_at: "2026-10-11T00:00:00+00:00", results: [...SNAPSHOT.results, result("m_iran_strike", "near")] }
      : SNAPSHOT;
    if (options.runAddsIranNear) latest = ran;   // the stored week, as GET /latest would return it
    return r.fulfill(ok({ ...ran, failures: options.runFailures ?? [] }));
  });
  await page.route("**/api/v1/signals/manual/*", (r) => {
    calls.manual.push({ url: r.request().url(), method: r.request().method(), body: r.request().postDataJSON() });
    if (options.manualFails) return r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ status: "error", data: null, meta: {} }) });
    if (options.manualNullSnapshot) return r.fulfill(ok({ iso_week: "2026-W41", snapshot: null }));
    latest = { ...SNAPSHOT, probs: { a: 0.2, b: 0.55, c: 0.25 } };
    return r.fulfill(ok({ iso_week: "2026-W41", snapshot: latest }));
  });
  return calls;
}
