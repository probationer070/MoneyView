/** One daily bar from GET /detail/{ticker}/ohlcv, ascending by date. */
export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DetailTheme {
  id: string;
  label: { en: string; ko: string };
}

/** GET /detail/{ticker}/profile. Everything but ticker and in_watchlist is null off the watchlist. */
export interface DetailProfile {
  ticker: string;
  in_watchlist: boolean;
  name: string | null;
  sector: string | null;
  theme: DetailTheme | null;
}

export interface MoverRow {
  ticker: string;
  name: string;
  theme: DetailTheme | null;
  return_pct: number;
}

/** GET /detail/movers/latest. return_pct is in percent units (1.2 is +1.2%). */
export interface LatestMovers {
  date: string | null;
  up: MoverRow[];
  down: MoverRow[];
}

export interface MovePeer { ticker: string; name: string; return_pct: number }
export interface MoveAlert { id: number; kind: "risk" | "surge"; role: "start" | "ongoing" | "end" }

/** GET /detail/{ticker}/move/{date}. Percent units; null where the server could not compute or the ticker is off the watchlist. */
export interface MoveExplanation {
  ticker: string;
  date: string;
  return_pct: number;
  price_ratio: number | null;
  volume_ratio: number | null;
  market: { ticker: string; return_pct: number } | null;
  theme: { id: string; label: { en: string; ko: string }; return_pct: number } | null;
  peers: MovePeer[];
  events: Array<{ category: string; title: string }>;
  alerts: MoveAlert[];
  /** stored: this ticker's articles within two days of the date; searched: that window was searched before. Null off the watchlist. */
  news: { stored: number; searched: boolean } | null;
}

/** One row of GET /news/feed. published_at is null when only the day is known. */
export interface NewsRow {
  id: number | null;
  headline: string;
  url: string;
  source: string;
  published_date: string;
  published_at: string | null;
}

export type HistoryStatus = "searched_now" | "cached" | "blocked" | "daily_limit" | "failed";

/** POST /news/history, the fields the screen reads. */
export interface NewsHistoryResult {
  status: HistoryStatus;
  retry_after: string | null;
}
