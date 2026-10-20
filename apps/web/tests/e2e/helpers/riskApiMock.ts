import type { Page } from "@playwright/test";
import type {
  RiskAlertDetail, RiskAlertSummary, RiskLatest, RiskWarning, SurgeLatestOut, SurgeThemeOut,
} from "../../../../../packages/shared-types";
import { cloneFixture } from "./mockUtils";

// Typed fixtures for GET /api/v1/risk/latest (packages/shared-types/risk.ts), one per signal-strip state
// of the risk UI spec §2. A type change in risk.ts breaks this file at typecheck, not at run time.

export type RiskScenario = "neutral" | "risk" | "surge" | "both" | "pending" | "error";

const warning = (id: string, en: string, ko: string, state: RiskWarning["state"]): RiskWarning => ({
  id, label: { ko, en }, state, value: state === "unknown" ? null : 1.2, unit: "pct_level",
  rule: { ko: `${ko} 기준`, en: `${en} rule` }, observed_at: "2026-10-19",
});

export const WARNINGS: RiskWarning[] = [
  warning("W1", "Credit spread", "신용 스프레드", "on"),
  warning("W2", "Volatility", "변동성", "on"),
  warning("W3", "Yield jump", "금리 급등", "off"),
  warning("W4", "Breadth days", "하락 종목 일수", "off"),
  warning("W5", "Claims", "실업수당 청구", "off"),
  warning("W7", "Drawdown", "고점 대비 하락", "unknown"),
];

export const ALERT: RiskAlertDetail = {
  id: 12, origin: "live", rules_version: "v3", status: "open", start_date: "2026-10-14", release_date: null,
  w1_proxy: false, trigger_themes: ["semis", "^SOX", "ai_infra"],
  themes: [
    {
      theme: "semis", label: { ko: "반도체 장비와 소재 공급망 전체", en: "Semiconductor equipment and materials" },
      via: "theme", joined_date: "2026-10-14", left_date: null, dd20_at_join: -11.2, fwd5: null, fwd10: null, fwd20: null,
      max_dd10: null,
    },
    {
      theme: "^SOX", label: { ko: "필라델피아 반도체(SOX)", en: "Philadelphia Semiconductor (SOX)" },
      via: "sox", joined_date: "2026-10-14", left_date: null, dd20_at_join: -9.8, fwd5: null, fwd10: null, fwd20: null,
      max_dd10: null,
    },
    {
      theme: "ai_infra", label: { ko: "AI 인프라", en: "AI infrastructure" },
      via: "theme", joined_date: "2026-10-15", left_date: null, dd20_at_join: -10.1, fwd5: null, fwd10: null, fwd20: null,
      max_dd10: null,
    },
  ],
  warnings_at_start: WARNINGS.map((w) => ({ id: w.id, state: w.state, value: w.value })),
  crash: { as_of: "2026-10-19", total: 0, cards: [] },
  candidates: { as_of: "2026-10-19", total: 0, cards: [] },
  start_snapshot: { crash: [], candidates: [] },
  outcome: { primary_theme: "semis", fwd5: null, fwd10: null, fwd20: null, useful: null },
  news: [], macro_figures: [], news_shortfall: 0, news_note: null,
};

export const LAST_ALERT: RiskAlertSummary = {
  id: 9, origin: "backfill", rules_version: "v3", status: "released", start_date: "2026-03-02", release_date: "2026-03-20",
  days: 14, trigger_themes: ["semis"], theme_count: 1, warnings_at_start: ["W1"], primary_theme: "semis",
  fwd5: -3.1, fwd10: -4.4, fwd20: -2.0, useful: true, w1_proxy: false, max_dd10: -6.2,
  trigger_labels: [{ id: "semis", label: { ko: "반도체", en: "Semiconductors" } }],
};

const surgeTheme = (theme: string, en: string, ko: string, eventId: number, shown: boolean): SurgeThemeOut => ({
  theme, label: { ko, en }, event_id: eventId, start_date: "2026-10-16", shown,
  components: { magnitude_z: 2.4, accel_pct: 1.8, accel_rank: 2, breadth_pct: 80, rsi: 68 }, overheated: false,
  leaders: [{ ticker: "NVDA", name: "NVIDIA", return5_pct: 12.4 }],
});

const COMPONENTS_INFO: SurgeLatestOut["components_info"] = (["magnitude", "accel", "breadth", "rsi"] as const).map((id) => ({
  id, label: { ko: id, en: id }, rule: { ko: `${id} 기준`, en: `${id} rule` },
}));

export const SURGE_QUIET: SurgeLatestOut = {
  banner: false, cap_share: 0.04, components_info: COMPONENTS_INFO, banner_since: null,
  themes: [surgeTheme("robotics", "Robotics", "로봇", 41, false)],
};

export const SURGE_BANNER: SurgeLatestOut = {
  banner: true, cap_share: 0.26, components_info: COMPONENTS_INFO, banner_since: "2026-10-16",
  themes: [
    surgeTheme("semis", "Semiconductors", "반도체", 42, true),
    surgeTheme("^SOX", "Philadelphia Semiconductor (SOX)", "필라델피아 반도체(SOX)", 43, true),
    surgeTheme("robotics", "Robotics", "로봇", 41, false),
  ],
};

export const NEUTRAL: RiskLatest = {
  as_of: "2026-10-19", evaluated_at: "2026-10-19T22:10:00+00:00", rules_version: "v3", backfill: "done",
  data: { bars_coverage: 0.98, fred_errors: [] }, warnings: WARNINGS, warnings_on: 2, warnings_total: 6,
  alert: null, last_alert: LAST_ALERT, surge: SURGE_QUIET,
  movers: {
    as_of: "2026-10-19",
    items: [{ rank: 1, ticker: "MU", name: "Micron Technology", theme: "semis", return_pct: 6.4, close: 171.2, return5_pct: 9.8, rsi: 71 }],
  },
};

export const LATEST: Record<Exclude<RiskScenario, "error">, RiskLatest> = {
  neutral: NEUTRAL,
  risk: { ...NEUTRAL, warnings_on: 4, alert: ALERT, last_alert: null },
  surge: { ...NEUTRAL, surge: SURGE_BANNER },
  both: { ...NEUTRAL, warnings_on: 4, alert: ALERT, last_alert: null, surge: SURGE_BANNER },
  pending: {
    ...NEUTRAL, as_of: null, evaluated_at: null, backfill: "running", data: null, warnings: [], warnings_on: 0,
    alert: null, last_alert: null, surge: null, movers: null,
  },
};

/** Registers after any page mock, so it answers /api/v1/risk/latest first. "error" answers 500. */
export async function mockRisk(page: Page, scenario: RiskScenario) {
  await page.route("**/api/v1/risk/latest", (route) =>
    scenario === "error"
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "boom" }) })
      : route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ status: "ok", data: cloneFixture(LATEST[scenario]), meta: {} }),
      }));
}
