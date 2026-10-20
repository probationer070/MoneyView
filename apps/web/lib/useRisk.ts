"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { useLocale } from "@/lib/i18n/locale";
import type {
  LabelOut, MoversDayOut, RiskAlertDetail, RiskAlertSummary, RiskLatest, SurgeEventDetailOut, SurgeEventOut,
  ThemeLevelPoint,
} from "../../../packages/shared-types";

// Client hooks for /api/v1/risk (risk UI spec §6). The screens only display these values; nothing is computed here.
const FIVE_MINUTES = 5 * 60 * 1000;
const HISTORY_LIMIT = 500;

export const RISK_LATEST_KEY = ["risk-latest"] as const;

export function useRiskLatest() {
  return useQuery({
    queryKey: RISK_LATEST_KEY,
    queryFn: () => fetchApi<RiskLatest>("/risk/latest"),
    refetchInterval: FIVE_MINUTES,
    retry: 1,
  });
}

/** One alert's detail. `all` asks for every stored card instead of the first 10. Disabled while id is null. */
export function useRiskAlert(id: number | null, { all = false }: { all?: boolean } = {}) {
  return useQuery({
    queryKey: ["risk-alert", id, all],
    queryFn: () => fetchApi<RiskAlertDetail>(`/risk/alerts/${id}`, all ? { params: { cards: "all" } } : {}),
    enabled: id !== null,
    retry: 1,
  });
}

export function useRiskHistory() {
  return useQuery({
    queryKey: ["risk-history"],
    queryFn: () => fetchApi<RiskAlertSummary[]>("/risk/history", { params: { limit: HISTORY_LIMIT } }),
    retry: 1,
  });
}

export function useSurgeHistory() {
  return useQuery({
    queryKey: ["risk-surge-history"],
    queryFn: () => fetchApi<SurgeEventOut[]>("/risk/surge/history", { params: { limit: HISTORY_LIMIT } }),
    retry: 1,
  });
}

export function useSurgeEvent(id: number | null) {
  return useQuery({
    queryKey: ["risk-surge-event", id],
    queryFn: () => fetchApi<SurgeEventDetailOut>(`/risk/surge/events/${id}`),
    enabled: id !== null,
    retry: 1,
  });
}

/** Days of yesterday's-gainers lists. Dates are YYYY-MM-DD; an omitted bound uses the API default. */
export function useMovers(range: { from?: string; to?: string } = {}) {
  const params: Record<string, string> = {};
  if (range.from) params.from = range.from;
  if (range.to) params.to = range.to;
  return useQuery({
    queryKey: ["risk-movers", range.from ?? null, range.to ?? null],
    queryFn: () => fetchApi<MoversDayOut[]>("/risk/movers", { params }),
    retry: 1,
  });
}

/** A theme's (or ^SOX's) level rebased to 100 at the first returned day. Disabled while theme is null. */
export function useThemeLevel(theme: string | null, from?: string, to?: string) {
  const params: Record<string, string> = {};
  if (from) params.from = from;
  if (to) params.to = to;
  return useQuery({
    queryKey: ["risk-theme-level", theme, from ?? null, to ?? null],
    queryFn: () => fetchApi<ThemeLevelPoint[]>(`/risk/themes/${encodeURIComponent(theme ?? "")}/level`, { params }),
    enabled: theme !== null,
    retry: 1,
  });
}

interface WatchlistThemeOut { id: string; ko: string; en: string }

/**
 * A theme id → its label in the current locale, from GET /portfolio/watchlist/themes. That list has
 * no ^SOX, so a caller passes the label the risk API sent (`apiLabel`) and it is used when the id is
 * not in the list. With neither, the id itself is shown.
 */
export function useThemeLabels(): (id: string, apiLabel?: LabelOut) => string {
  const { locale } = useLocale();
  const { data } = useQuery({
    queryKey: ["risk-theme-labels"],
    queryFn: () => fetchApi<WatchlistThemeOut[]>("/portfolio/watchlist/themes"),
    staleTime: Infinity,
    retry: 1,
  });
  return useCallback(
    (id: string, apiLabel?: LabelOut) => {
      const found = data?.find((theme) => theme.id === id);
      if (found) return found[locale];
      return apiLabel ? apiLabel[locale] : id;
    },
    [data, locale],
  );
}
