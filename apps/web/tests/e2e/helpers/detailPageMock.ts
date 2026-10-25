import type { Page } from "@playwright/test";
import type { Bar, DetailProfile, LatestMovers, MoveExplanation, NewsRow } from "../../../lib/detail/types";
import { mockEventsApi } from "./eventsApiMock";
import { json } from "./mockUtils";
import { mockRisk, type RiskScenario } from "./riskApiMock";
import type { RiskAlertDetail, RiskLatest } from "../../../../../packages/shared-types";

/** The last bar's date in makeBars, so planted dates are fixed. */
export const LAST_BAR_DATE = "2026-10-23";

/** A planted move: the date's close is the previous close times (1 + returnPct/100); volume is base times volumeMultiple. */
export interface PlantedMove { date: string; returnPct: number; volumeMultiple: number }

export const DEFAULT_PLANTED: PlantedMove[] = [
  { date: "2026-10-08", returnPct: -6.2, volumeMultiple: 3 },
  { date: "2026-09-15", returnPct: 5, volumeMultiple: 2.5 },
];

function nextSeed(seed: number): number {
  return (seed * 1664525 + 1013904223) % 4294967296;
}

/** The n weekdays ending at `end`, ascending. */
function weekdaysEnding(end: string, n: number): string[] {
  const days: string[] = [];
  const cursor = new Date(`${end}T00:00:00Z`);
  while (days.length < n) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return days.reverse();
}

/** n deterministic daily bars ending at LAST_BAR_DATE (a seeded walk), with the planted moves on their fixed dates. */
export function makeBars(n: number, opts: { seed?: number; start?: number; planted?: PlantedMove[] } = {}): Bar[] {
  let seed = opts.seed ?? 7;
  let close = opts.start ?? 100;
  const planted = new Map((opts.planted ?? DEFAULT_PLANTED).map((move) => [move.date, move]));
  return weekdaysEnding(LAST_BAR_DATE, n).map((date) => {
    seed = nextSeed(seed);
    const drift = ((seed / 4294967296) - 0.5) * 0.03;
    seed = nextSeed(seed);
    const base = 1_000_000 * (0.8 + 0.4 * (seed / 4294967296));
    const move = planted.get(date);
    const previous = close;
    close = previous * (1 + (move ? move.returnPct / 100 : drift));
    return {
      date,
      open: previous,
      high: Math.max(previous, close) * 1.004,
      low: Math.min(previous, close) * 0.996,
      close,
      volume: Math.round(base * (move ? move.volumeMultiple : 1)),
    };
  });
}

export const MOVER_THEME = { id: "ai_semis", label: { en: "AI semiconductors", ko: "AI 반도체" } };
const mover = (ticker: string, return_pct: number) => ({ ticker, name: `${ticker} Corp`, theme: MOVER_THEME, return_pct });

export const MOVERS_LATEST: LatestMovers = {
  date: "2026-10-23",
  up: [mover("INTC", 6.1), mover("NVDA", 4.2), mover("AMD", 3.3), mover("AVGO", 2.4), mover("TSM", 1.8)],
  down: [mover("AAPL", -5.5), mover("MSFT", -4.1), mover("ORCL", -3.2), mover("CRM", -2.7), mover("ADBE", -1.9)],
};

export interface DetailMockOptions {
  /** Bars for every ticker; default makeBars(260). */
  bars?: Bar[];
  /** Profile overrides by ticker; a ticker not listed is a watchlist stock named "<ticker> Inc". ^GSPC is never on the watchlist. */
  profiles?: Record<string, DetailProfile>;
  movers?: LatestMovers;
  /** Move responses by date; a date not listed gets DEFAULT_MOVE. */
  moves?: Record<string, Partial<MoveExplanation> | (() => Partial<MoveExplanation>)>;
  /** News rows for a feed call; default none. `topic` is set for the theme group, `ticker` for the stock group. */
  feed?: (query: { ticker: string | null; topic: string | null; from: string | null; to: string | null }) => NewsRow[];
  /** Bodies for successive POST /news/history calls; the last one repeats. Default: searched_now. */
  history?: Array<{ status: string; retry_after?: string | null }>;
  /** Risk latest scenario or object; default "neutral" (no open alert). */
  risk?: RiskScenario | RiskLatest;
  /** The alert detail served for GET /risk/alerts/{id}?cards=all (any id). */
  alertAll?: RiskAlertDetail;
}

/** What the page asked of the mocked endpoints, for assertions. */
export interface DetailMockLog {
  feed: string[];
  history: unknown[];
  alertQueries: string[];
}

export const DEFAULT_MOVE: MoveExplanation = {
  ticker: "AAPL", date: "", return_pct: -6.2, price_ratio: 3.1, volume_ratio: 2.4, market: null, theme: null,
  peers: [], events: [], alerts: [], news: null,
};

const THEME = { id: "ai", label: { en: "AI Infrastructure", ko: "AI 인프라" } };

function profileFor(ticker: string, overrides?: Record<string, DetailProfile>): DetailProfile {
  if (overrides?.[ticker]) return overrides[ticker];
  if (ticker.startsWith("^")) return { ticker, in_watchlist: false, name: null, sector: null, theme: null };
  return { ticker, in_watchlist: true, name: `${ticker} Inc`, sector: "Technology", theme: THEME };
}

/** Mocks everything /detail/{ticker} calls: bars, profile, movers, the index, risk, events, news and the move card. */
export async function mockDetailPage(page: Page, _ticker: string, options: DetailMockOptions = {}): Promise<DetailMockLog> {
  const log: DetailMockLog = { feed: [], history: [], alertQueries: [] };
  const bars = options.bars ?? makeBars(260);
  await mockRisk(page, options.risk ?? "neutral");
  if (options.alertAll) {
    const detail = options.alertAll;
    await page.route(/\/api\/v1\/risk\/alerts\/\d+(\?.*)?$/, (route) => {
      const url = new URL(route.request().url());
      log.alertQueries.push(url.search);
      return json(route, url.searchParams.get("cards") === "all" ? detail : { ...detail, crash: { ...detail.crash, cards: detail.crash.cards.slice(0, 10) } });
    });
  }
  await mockEventsApi(page);
  await page.route("**/api/v1/news/feed**", (route) => {
    const url = new URL(route.request().url());
    log.feed.push(url.search);
    const query = { ticker: url.searchParams.get("ticker"), topic: url.searchParams.get("topic"), from: url.searchParams.get("from"), to: url.searchParams.get("to") };
    return json(route, options.feed ? options.feed(query) : []);
  });
  await page.route("**/api/v1/news/history", (route) => {
    const sequence = options.history ?? [{ status: "searched_now" }];
    log.history.push(route.request().postDataJSON());
    const body = sequence[Math.min(log.history.length - 1, sequence.length - 1)];
    return json(route, { status: "ok", data: { ticker: "AAPL", start: "", end: "", truncated: false, searched: [], articles: [], retry_after: null, ...body }, meta: {} });
  });
  await page.route("**/api/v1/market/index/*", (route) => json(route, bars));
  await page.route("**/api/v1/detail/**", (route) => {
    const parts = decodeURIComponent(new URL(route.request().url()).pathname).split("/").slice(4);
    if (parts[0] === "movers" && parts[1] === "latest") return json(route, options.movers ?? MOVERS_LATEST);
    const [ticker, kind, date] = parts;
    if (kind === "ohlcv") return json(route, bars);
    if (kind === "profile") return json(route, profileFor(ticker, options.profiles));
    if (kind === "move") {
      const planted = options.moves?.[date];
      return json(route, { ...DEFAULT_MOVE, ticker, date, ...(typeof planted === "function" ? planted() : planted) });
    }
    return route.fallback();
  });
  return log;
}
