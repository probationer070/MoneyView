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
