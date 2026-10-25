import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { useRiskAlert, useRiskLatest } from "@/lib/useRisk";
import type { Bar, DetailProfile, LatestMovers, MoveExplanation, NewsHistoryResult, NewsRow } from "./types";

// Client hooks for the stock detail screen. Fetching is client-side so the screen can be tested with mocked routes.
const FIVE_MINUTES = 5 * 60 * 1000;

interface BarRow extends Bar { dividends?: number; stock_splits?: number }

export function useDetailBars(ticker: string) {
  return useQuery({
    queryKey: ["detail-bars", ticker],
    queryFn: async (): Promise<Bar[]> => {
      const rows = await fetchApi<BarRow[]>(`/detail/${encodeURIComponent(ticker)}/ohlcv`, { params: { period: "5y" } });
      return rows.map(({ date, open, high, low, close, volume }) => ({ date, open, high, low, close, volume }));
    },
    staleTime: FIVE_MINUTES,
    retry: 1,
  });
}

export function useDetailProfile(ticker: string) {
  return useQuery({
    queryKey: ["detail-profile", ticker],
    queryFn: () => fetchApi<DetailProfile>(`/detail/${encodeURIComponent(ticker)}/profile`),
    staleTime: FIVE_MINUTES,
    retry: 1,
  });
}

export function useLatestMovers() {
  return useQuery({
    queryKey: ["detail-movers-latest"],
    queryFn: () => fetchApi<LatestMovers>("/detail/movers/latest"),
    staleTime: FIVE_MINUTES,
    retry: 1,
  });
}

const MOVE_KEY = "detail-move";
const NEWS_KEY = "detail-news";
const NEWS_WINDOW_DAYS = 2;
const LATEST_NEWS = 20;
const DATED_NEWS = 50;

export function useMoveExplanation(ticker: string, date: string | null) {
  return useQuery({
    queryKey: [MOVE_KEY, ticker, date],
    queryFn: () => fetchApi<MoveExplanation>(`/detail/${encodeURIComponent(ticker)}/move/${date}`),
    enabled: date !== null,
    staleTime: FIVE_MINUTES,
    retry: 1,
  });
}

/** `date` shifted by whole days, as YYYY-MM-DD. */
export function shiftDate(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

function newsParams(date: string | null): Record<string, string | number> {
  return date === null
    ? { limit: LATEST_NEWS }
    : { from: shiftDate(date, -NEWS_WINDOW_DAYS), to: shiftDate(date, NEWS_WINDOW_DAYS), limit: DATED_NEWS };
}

/**
 * The news column's two groups: this ticker's rows and its theme's rows. With a date, the day and two days
 * either side (the window the find-news search covers); without one, the latest 20.
 */
export function useDetailNews(ticker: string, themeId: string | null, date: string | null) {
  const stock = useQuery({
    queryKey: [NEWS_KEY, ticker, "stock", date],
    queryFn: () => fetchApi<NewsRow[]>("/news/feed", { params: { ticker, ...newsParams(date) } }),
    staleTime: FIVE_MINUTES,
    retry: 1,
  });
  const theme = useQuery({
    queryKey: [NEWS_KEY, ticker, "theme", themeId, date],
    queryFn: () => fetchApi<NewsRow[]>("/news/feed", { params: { topic: `theme:${themeId}`, ...newsParams(date) } }),
    enabled: themeId !== null,
    staleTime: FIVE_MINUTES,
    retry: 1,
  });
  return { stock, theme };
}

/** Searches the news archive around a date. A search that ran (or was cached) refreshes the card and the news column. */
export function useFindNews(ticker: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (date: string) =>
      fetchApi<NewsHistoryResult>("/news/history", { method: "POST", body: JSON.stringify({ ticker, date }) }),
    onSuccess: (result) => {
      if (result.status !== "searched_now" && result.status !== "cached") return;
      void client.invalidateQueries({ queryKey: [MOVE_KEY, ticker] });
      void client.invalidateQueries({ queryKey: [NEWS_KEY, ticker] });
    },
  });
}

/**
 * Whether the open alert lists this ticker. Reads the alert's full decks (?cards=all), not the ten cards
 * /risk/latest carries, so a ticker ranked below tenth still gets its badge.
 */
export function useAlertBadge(ticker: string): "crash" | "candidate" | null {
  const latest = useRiskLatest();
  const open = latest.data?.alert;
  const detail = useRiskAlert(open && open.status === "open" ? open.id : null, { all: true });
  if (!detail.data) return null;
  if (detail.data.crash.cards.some((card) => card.ticker === ticker)) return "crash";
  if (detail.data.candidates.cards.some((card) => card.ticker === ticker)) return "candidate";
  return null;
}
