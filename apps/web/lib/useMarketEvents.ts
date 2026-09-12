"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import type { EventLineSpec } from "@/components/charts/primitives/EventLinesPrimitive";
import type { MarketEvent } from "../../../packages/shared-types";

export type { MarketEvent };

/**
 * The dated events charts draw as vertical lines.
 *
 * One shared query key, so every chart on a page reads the same cached response rather than
 * refetching per card. The events are committed reference data that only changes when the
 * repository does, hence the long stale time -- refetching them on window focus would be
 * pure noise.
 *
 * A failure yields an empty list rather than an error state: a chart with no event lines is
 * a normal chart, and a marker feature must not be able to take a price chart down.
 */
export function useMarketEvents() {
  const query = useQuery({
    queryKey: ["market-events"],
    queryFn: () => fetchApi<MarketEvent[]>("/market/events"),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  // Both arrays are memoised on the query data because TVChart is wrapped in React.memo and
  // compares `events` by identity. A fresh array on every render would make that comparison
  // always false, re-rendering the chart on every unrelated parent render -- which is the
  // exact cost the memo exists to avoid.
  const events = useMemo<MarketEvent[]>(() => query.data ?? [], [query.data]);
  const lines = useMemo<EventLineSpec[]>(
    () => events.map((event) => ({ id: event.id, label: event.label, date: event.start_date })),
    [events],
  );

  return { events, lines, isLoading: query.isLoading };
}
