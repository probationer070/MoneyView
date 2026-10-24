import type { Page } from "@playwright/test";
import type {
  CandidateCardOut, CrashCardOut, DeckOut, MoverOut, MoversDayOut, RiskAlertDetail, RiskAlertSummary, RiskLatest,
  RiskWarning, SurgeEventOut, SurgeLatestOut, SurgeThemeOut,
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
  components: { magnitude_z: 2.4, accel_pct: 0.31, accel_rank: 0.97, breadth_pct: 80, rsi: 68 }, overheated: false,
  leaders: [
    { ticker: "NVDA", name: "NVIDIA", return5_pct: 12.4 },
    { ticker: "AMD", name: "Advanced Micro Devices", return5_pct: 9.1 },
    { ticker: "AVGO", name: "Broadcom", return5_pct: 7.7 },
    { ticker: "MU", name: "Micron Technology", return5_pct: 6.0 },
    { ticker: "TSM", name: "TSMC", return5_pct: null },
  ],
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

// Deck fixtures for the signal panel (plan Tasks 3-4). The API sends at most 10 cards and the full count in `total`.
export function crashCard(n: number): CrashCardOut {
  return {
    ticker: `CR${n}`, name: `Crash Stock ${n}`, theme: n % 2 === 0 ? "^SOX" : "semis", drawdown_pct: -30 + n,
    high_date: "2026-09-25", high_close: 210.4, close: 171.2, closes_30d: [210.4, 204.1, 196.3, 188.0, 171.2],
    headlines: n === 1 ? [{ title: "Chip stocks slide on export curbs", url: "https://example.com/c1", published_date: "2026-10-18", lang: "en" }] : [],
  };
}

export function candidateCard(n: number): CandidateCardOut {
  return {
    ticker: `CA${n}`, name: `Candidate Stock ${n}`, theme: "ai_infra", pct_from_high63: -0.7, corr: 0.85,
    corr_with: "^SOX", corr_with_name: "SOX",
  };
}

/** A deck as the API sends it: `total` cards exist, the first min(total, 10) are listed. */
export function deck<Card>(total: number, card: (n: number) => Card): DeckOut<Card> {
  return { as_of: "2026-10-19", total, cards: Array.from({ length: Math.min(total, 10) }, (_, i) => card(i + 1)) };
}

export const MOVERS: MoverOut[] = [1, 2, 3, 4, 5].map((rank) => ({
  rank, ticker: `MV${rank}`, name: `Mover Stock ${rank}`, theme: "robotics", return_pct: 10 - rank, close: 100 + rank,
  return5_pct: 12 - rank, rsi: 70 - rank,
}));

/** The released alert that `NEUTRAL.last_alert` points at, as GET /alerts/9 sends it. */
export const LAST_ALERT_DETAIL: RiskAlertDetail = {
  ...ALERT, id: 9, origin: "backfill", status: "released", start_date: "2026-03-02", release_date: "2026-03-20",
  trigger_themes: ["semis"], themes: [ALERT.themes[0]],
  crash: { as_of: "2026-03-02", total: 2, cards: [{ ...crashCard(1), ticker: "OLD1", name: "Old Crash 1" }, { ...crashCard(3), ticker: "OLD2", name: "Old Crash 2" }] },
  candidates: { as_of: "2026-03-02", total: 1, cards: [{ ...candidateCard(1), ticker: "OLDC", name: "Old Candidate" }] },
};

const ALERT_DETAILS: Record<number, RiskAlertDetail> = { [ALERT.id]: ALERT, [LAST_ALERT_DETAIL.id]: LAST_ALERT_DETAIL };

/** GET /portfolio/watchlist/themes, which the cards use to name theme ids. It has no ^SOX entry. */
export const WATCHLIST_THEMES = [
  { id: "semis", ko: "반도체", en: "Semiconductors" },
  { id: "ai_infra", ko: "AI 인프라", en: "AI infrastructure" },
  { id: "robotics", ko: "로봇", en: "Robotics" },
];

const ok = (data: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", data, meta: {} }) });

/**
 * Registers after any page mock, so it answers /api/v1/risk/latest first. "error" answers 500. A RiskLatest
 * object is served as is. Also answers GET /risk/alerts/{id} (404 for an unknown id) and the watchlist themes.
 */
export async function mockRisk(page: Page, scenario: RiskScenario | RiskLatest) {
  await page.route("**/api/v1/portfolio/watchlist/themes", (route) => route.fulfill(ok(cloneFixture(WATCHLIST_THEMES))));
  await page.route(/\/api\/v1\/risk\/alerts\/\d+(\?.*)?$/, (route) => {
    const id = Number(new URL(route.request().url()).pathname.split("/").pop());
    const detail = ALERT_DETAILS[id];
    return detail
      ? route.fulfill(ok(cloneFixture(detail)))
      : route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: `unknown alert ${id}` }) });
  });
  await page.route("**/api/v1/risk/latest", (route) =>
    scenario === "error"
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "boom" }) })
      : route.fulfill(ok(cloneFixture(typeof scenario === "string" ? LATEST[scenario] : scenario))));
}

/** Marks the fixtures' alert and surge banner as already seen, so the signal panel does not open by itself. */
export async function markSignalsSeen(page: Page) {
  await page.addInitScript(([alertId, since]) => {
    window.localStorage.setItem(`mv.risk.seen.alert:${alertId}`, "1");
    window.localStorage.setItem(`mv.risk.seen.surge:${since}`, "1");
  }, [String(ALERT.id), String(SURGE_BANNER.banner_since)]);
}

// Records page fixtures (/alerts, plan Task 5). The API filters to the current rules version, so every row here is v3.
const OPEN_ALERT_SUMMARY: RiskAlertSummary = {
  id: ALERT.id, origin: "live", rules_version: "v3", status: "open", start_date: "2026-10-14", release_date: null,
  days: 4, trigger_themes: ["semis", "^SOX", "ai_infra"], theme_count: 3, warnings_at_start: ["W1", "W2", "W3", "W4"],
  primary_theme: "semis", fwd5: null, fwd10: null, fwd20: null, useful: null, w1_proxy: false, max_dd10: null,
  trigger_labels: [
    { id: "semis", label: { ko: "반도체", en: "Semiconductors" } },
    { id: "^SOX", label: { ko: "필라델피아 반도체(SOX)", en: "Philadelphia Semiconductor (SOX)" } },
    { id: "ai_infra", label: { ko: "AI 인프라", en: "AI infrastructure" } },
  ],
};

/** An older live alert with long, unrounded figures, so the CSV can prove it does not round. */
export const OLD_ALERT_SUMMARY: RiskAlertSummary = {
  id: 5, origin: "live", rules_version: "v3", status: "released", start_date: "2025-06-10", release_date: "2025-06-30",
  days: 14, trigger_themes: ["ai_infra", "semis"], theme_count: 2, warnings_at_start: ["W2", "W5"],
  primary_theme: "ai_infra", fwd5: -2.123456789, fwd10: -7.4123456, fwd20: 1.5, useful: true, w1_proxy: false,
  max_dd10: -7.4123456,
  trigger_labels: [
    { id: "ai_infra", label: { ko: "AI 인프라", en: "AI infrastructure" } },
    { id: "semis", label: { ko: "반도체", en: "Semiconductors" } },
  ],
};

/** GET /history, newest first as the API sends it. LAST_ALERT (id 9) is the backfill-origin row. */
export const HISTORY: RiskAlertSummary[] = [OPEN_ALERT_SUMMARY, LAST_ALERT, OLD_ALERT_SUMMARY];

const SURGE_COMPONENTS = { magnitude_z: 2.4, accel_pct: 0.31, accel_rank: 0.97, breadth_pct: 80, rsi: 68 };
const surgeEvent = (id: number, theme: string, en: string, ko: string, rest: Partial<SurgeEventOut>): SurgeEventOut => ({
  id, origin: "live", rules_version: "v3", theme, label: { ko, en }, start_date: "2026-10-16", end_date: null,
  end_reason: null, shown: true, components: SURGE_COMPONENTS, overheated_on: null, fwd5: null, fwd10: null,
  fwd20: null, max_runup10: null, leaders: [], ...rest,
});

/** GET /surge/history: two open events (one never on the banner) and an ended backfill event. */
export const SURGE_HISTORY: SurgeEventOut[] = [
  surgeEvent(42, "semis", "Semiconductors", "반도체", {}),
  surgeEvent(41, "robotics", "Robotics", "로봇", { shown: false }),
  surgeEvent(30, "ai_infra", "AI infrastructure", "AI 인프라", {
    origin: "backfill", start_date: "2026-05-04", end_date: "2026-05-20", end_reason: "below_ema",
    overheated_on: "2026-05-12", fwd5: 4.25, fwd10: 8.5, fwd20: -1.75, max_runup10: 9.3333333,
  }),
];

/** GET /movers?from=2016-01-04: one row per day, oldest first as the API sends it. */
export const MOVERS_DAYS: MoversDayOut[] = [
  { date: "2026-03-03", items: MOVERS.map((m) => ({ ...m, ticker: `OM${m.rank}`, name: `Old Mover ${m.rank}`, return_pct: 20.125 - m.rank })) },
  { date: "2026-10-16", items: MOVERS },
  { date: "2026-10-19", items: MOVERS.map((m) => ({ ...m, ticker: `NM${m.rank}`, name: `New Mover ${m.rank}` })) },
];

/** Answers the three list calls the records page makes once each. */
export async function mockRiskRecords(page: Page) {
  await page.route(/\/api\/v1\/risk\/history(\?.*)?$/, (route) => route.fulfill(ok(cloneFixture(HISTORY))));
  await page.route(/\/api\/v1\/risk\/surge\/history(\?.*)?$/, (route) => route.fulfill(ok(cloneFixture(SURGE_HISTORY))));
  await page.route(/\/api\/v1\/risk\/movers(\?.*)?$/, (route) => route.fulfill(ok(cloneFixture(MOVERS_DAYS))));
}
