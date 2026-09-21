"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { buildEventLines } from "@/lib/eventLines";
import type { EventLineSpec } from "@/components/charts/primitives/EventLinesPrimitive";
import type { EventCategory, MarketEvent } from "../../../packages/shared-types";

export type { EventCategory, MarketEvent };

export const MARKET_EVENTS_KEY = ["market-events"] as const;
export const EVENT_CATEGORIES_KEY = ["market-event-categories"] as const;

export type EventsStatus = "loading" | "ready" | "unavailable";

// Stable empties: TVChart is React.memo and compares `events` by identity, so a fresh [] per render
// would re-render every chart on every unrelated parent render.
const NO_EVENTS: MarketEvent[] = [];
const NO_CATEGORIES: EventCategory[] = [];
const NO_LINES: EventLineSpec[] = [];

/**
 * Events, categories, and the lines every chart draws, under two shared query keys so all charts
 * on all pages read one cache and one global filter.
 *
 * A failure draws no lines -- an overlay must never take a price chart down -- but it is reported
 * as `unavailable`, so the filter can say so instead of looking like "no events".
 */
export function useMarketEvents() {
  const eventsQuery = useQuery({
    queryKey: MARKET_EVENTS_KEY,
    queryFn: () => fetchApi<MarketEvent[]>("/market/events"),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const categoriesQuery = useQuery({
    queryKey: EVENT_CATEGORIES_KEY,
    queryFn: () => fetchApi<EventCategory[]>("/market/event-categories"),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const events = eventsQuery.data ?? NO_EVENTS;
  const categories = categoriesQuery.data ?? NO_CATEGORIES;
  const status: EventsStatus =
    eventsQuery.isError || categoriesQuery.isError
      ? "unavailable"
      : eventsQuery.data === undefined || categoriesQuery.data === undefined
        ? "loading"
        : "ready";

  const lines = useMemo(
    () => (status === "ready" ? buildEventLines(events, categories) : NO_LINES),
    [status, events, categories],
  );
  const visibleCount = useMemo(() => categories.filter((category) => category.visible).length, [categories]);

  const { refetch: refetchEvents } = eventsQuery;
  const { refetch: refetchCategories } = categoriesQuery;
  const refetch = useCallback(() => {
    void refetchEvents();
    void refetchCategories();
  }, [refetchEvents, refetchCategories]);

  return { events, categories, lines, status, visibleCount, refetch, dataUpdatedAt: eventsQuery.dataUpdatedAt };
}
