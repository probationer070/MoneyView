"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import type { MarketRegimeContext } from "../../../packages/shared-types";

export type MarketRegimeStatus = "loading" | "ready" | "error";

export interface MarketRegimeState {
  status: MarketRegimeStatus;
  /** The payload when status is "ready"; null otherwise. */
  regime: MarketRegimeContext | null;
}

/**
 * The regime line in the Market Overview header (spec §2.5). Fetched in the browser, not on the
 * server, so a Playwright page.route can answer it. One request per mount while the cache is stale.
 * A failure is not retried (plan N10): the line says so instead of waiting through three retries.
 */
export function useMarketRegime(): MarketRegimeState {
  const query = useQuery({
    queryKey: ["market-regime"],
    queryFn: () => fetchApi<MarketRegimeContext>("/market/regime"),
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  if (query.isError) return { status: "error", regime: null };
  if (query.data === undefined) return { status: "loading", regime: null };
  return { status: "ready", regime: query.data };
}
