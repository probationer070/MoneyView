"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import type { MarketSpread } from "../../../packages/shared-types";

export type { MarketSpread };

/**
 * Theme and policy spreads.
 *
 * Memoised on the query data: consumers pass slices of this into memoised chart components
 * that compare props by identity, and a fresh array each render defeats that comparison.
 *
 * A failure must never take Market Overview down, but it must not be swallowed either: it
 * used to be turned into an empty list, which the section then hid, so a broken endpoint
 * looked exactly like "no spreads". `isError` lets the section say so within itself.
 */
export function useMarketSpreads(windowDays = 90) {
  const query = useQuery({
    queryKey: ["market-spreads", windowDays],
    queryFn: () => fetchApi<MarketSpread[]>(`/market/spreads?window_days=${windowDays}`),
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const spreads = useMemo<MarketSpread[]>(() => query.data ?? [], [query.data]);
  return { spreads, isLoading: query.isLoading, isError: query.isError };
}
