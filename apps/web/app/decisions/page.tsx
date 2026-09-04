"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { useDevMonitorPageLoad } from "@/hooks/useDevMonitorPageLoad";
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

  const decisions = decisionsQuery.data ?? [];

  return (
    <div className="p-6">
      <PageHeader
        title="Decision Log"
        subtitle="What was believed about a ticker, when, and why. Figures are captured by the server at record time and never edited."
      />
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
    </div>
  );
}
