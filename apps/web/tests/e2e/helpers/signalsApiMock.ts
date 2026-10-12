import type { Page } from "@playwright/test";

const result = (rule_id: string, state: string, extra: Record<string, unknown> = {}) => ({
  rule_id, label_ko: rule_id, label_en: rule_id, direction: "B", kind: "level_streak", state,
  value: 5.55, observed_at: "2026-10-09", threshold: 5.5, note: "", contribution: null, ...extra,
});

export const SNAPSHOT = {
  iso_week: "2026-W41", run_at: "2026-10-10T00:00:00+00:00", rules_version: "v2",
  probs: { a: 0.25, b: 0.5, c: 0.25 }, previous_probs: { a: 0.3, b: 0.45, c: 0.25 }, failures: [],
  results: [
    result("b_tnx_sticky", "triggered", { contribution: { a: -0.05, b: 0.02, c: 0.03 } }),
    result("b_brent_spike", "stale", { value: null }),
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

export async function mockSignalsApi(page: Page) {
  const calls = { run: 0, manual: [] as { url: string; body: unknown }[] };
  let latest: unknown = SNAPSHOT;
  const ok = (data: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", data, meta: {} }) });
  await page.route("**/api/v1/signals/latest", (r) => r.fulfill(ok(latest)));
  await page.route("**/api/v1/signals/history**", (r) => r.fulfill(ok(HISTORY)));
  await page.route("**/api/v1/signals/rules", (r) => r.fulfill(ok(RULES)));
  await page.route("**/api/v1/signals/run", (r) => { calls.run += 1; return r.fulfill(ok(SNAPSHOT)); });
  await page.route("**/api/v1/signals/manual/*", (r) => {
    calls.manual.push({ url: r.request().url(), body: r.request().postDataJSON() });
    latest = { ...SNAPSHOT, probs: { a: 0.2, b: 0.55, c: 0.25 } };
    return r.fulfill(ok({ iso_week: "2026-W41", snapshot: latest }));
  });
  return calls;
}
