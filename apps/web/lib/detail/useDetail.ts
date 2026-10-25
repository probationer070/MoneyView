import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import type { Bar, DetailProfile, LatestMovers } from "./types";

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
