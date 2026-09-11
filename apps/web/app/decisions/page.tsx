"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { useDevMonitorPageLoad } from "@/hooks/useDevMonitorPageLoad";
import { DecisionList } from "./components/DecisionList";
import { DecisionOutcomeScatter } from "./components/DecisionOutcomeScatter";
import { RecordDecisionForm } from "./components/RecordDecisionForm";
import type { DecisionRow } from "./decisionTypes";

export default function DecisionsPage() {
  useDevMonitorPageLoad({ component: "decisions_page" });

  const decisionsQuery = useQuery<DecisionRow[]>({
    queryKey: ["decisions"],
    queryFn: () => fetchApi<DecisionRow[]>("/decisions", {
      monitor: { operation: "frontend.query.decisions", component: "decisions_page" },
    }),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // The same query key Valuation uses, so navigating between the two tabs reuses one
  // cached watchlist rather than paying that request twice -- it fetches a live quote per
  // ticker and takes 2-3.5s in production.
  const watchlistQuery = useQuery<{ ticker: string; name: string }[]>({
    queryKey: ["watchlist-tickers"],
    queryFn: () => fetchApi<{ ticker: string; name: string }[]>("/portfolio/watchlist", {
      monitor: { operation: "frontend.query.watchlist_tickers", component: "decisions_page" },
    }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const decisions = decisionsQuery.data ?? [];

  return (
    <div className="p-6">
      <PageHeader
        title="Decision Log"
        subtitle="What was believed about a ticker, when, and why. Figures are captured by the server at record time and never edited."
      />
      <RecordDecisionForm watchlist={watchlistQuery.data ?? []} />
      {!decisionsQuery.isLoading && !decisionsQuery.isError && (
        <DecisionOutcomeScatter decisions={decisions} />
      )}
      {/* The state contract in Global Constraints, in order. Loading and error
          render NOTHING that implies a count: "0 decisions" or "none recorded
          yet" on a failed request states an answer the request never returned. */}
      {decisionsQuery.isLoading && (
        <p role="status" className="text-[var(--text-secondary)]">Loading decisions…</p>
      )}
      {decisionsQuery.isError && (
        <p role="alert" className="text-[var(--chart-negative)]">Could not load decisions.</p>
      )}
      {!decisionsQuery.isLoading && !decisionsQuery.isError && decisions.length === 0 && (
        <p className="text-[var(--text-secondary)]">No decisions recorded yet.</p>
      )}
      {!decisionsQuery.isLoading && !decisionsQuery.isError && (
        <DecisionList decisions={decisions} />
      )}
    </div>
  );
}
