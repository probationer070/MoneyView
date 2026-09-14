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
 * A failure yields an empty list rather than an error state -- Market Overview must not go
 * down because a supplementary section could not load.
 */
export function useMarketSpreads(windowDays = 90) {
  const query = useQuery({
    queryKey: ["market-spreads", windowDays],
    queryFn: () => fetchApi<MarketSpread[]>(`/market/spreads?window_days=${windowDays}`),
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const spreads = useMemo<MarketSpread[]>(() => query.data ?? [], [query.data]);
  return { spreads, isLoading: query.isLoading };
}
