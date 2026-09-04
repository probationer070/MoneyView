"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchApi } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { useDevMonitorPageLoad } from "@/hooks/useDevMonitorPageLoad";
import { TickerPicker } from "./components/TickerPicker";
import type { VerdictPanel, WatchlistItem } from "./verdictTypes";

export default function ValuationPage() {
  useDevMonitorPageLoad({ component: "valuation_page" });
  const [ticker, setTicker] = useState<string | null>(null);

  // Suggestions only. Deliberately NOT awaited by anything below: this endpoint
  // fetches a live quote per ticker and takes 2-3.5s.
  const watchlistQuery = useQuery<WatchlistItem[]>({
    queryKey: ["watchlist-tickers"],
    queryFn: () => fetchApi<WatchlistItem[]>("/portfolio/watchlist", {
      monitor: { operation: "frontend.query.watchlist_tickers", component: "valuation_page" },
    }),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });

  const verdictQuery = useQuery<VerdictPanel>({
    queryKey: ["verdict", ticker],
    enabled: ticker !== null,
    queryFn: () => fetchApi<VerdictPanel>(`/valuation/verdict/${ticker}`, {
      monitor: { operation: "frontend.query.verdict", component: "valuation_page", ticker },
    }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="p-6">
      <PageHeader
        title="Valuation"
        subtitle="One evidence panel per ticker. Every row states the basis it was compared against, and a row that cannot be computed says why."
      />

      <TickerPicker items={watchlistQuery.data ?? []} onSubmit={setTicker} />

      {/* The state contract. Loading and error render NO rows and no partial
          panel: either would state an answer the request never returned. */}
      {ticker === null && (
        <p className="text-[var(--text-secondary)]">Choose a ticker to see its evidence panel.</p>
      )}
      {ticker !== null && verdictQuery.isLoading && (
        <p role="status" className="text-[var(--text-secondary)]">Loading the panel…</p>
      )}
      {ticker !== null && verdictQuery.isError && (
        <p role="alert" className="text-[var(--chart-negative)]">
          Could not load the panel for {ticker}.
        </p>
      )}
    </div>
  );
}
