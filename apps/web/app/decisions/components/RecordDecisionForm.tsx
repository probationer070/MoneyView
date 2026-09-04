"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchApi } from "@/lib/api";
import { DECISION_ACTIONS, type DecisionAction } from "../decisionTypes";

/**
 * Posts {ticker, action, memo} and NOTHING else. The server captures the
 * figures itself (spec 4): a browser-posted number could be stale or rounded
 * for display and would be stored as what the user believed, undetectably.
 * The request model is extra="forbid", so adding a field here is a 422.
 */
export function RecordDecisionForm() {
  const queryClient = useQueryClient();
  const [ticker, setTicker] = useState("");
  const [action, setAction] = useState<DecisionAction>("buy");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: { ticker: string; action: string; memo: string }) =>
      fetchApi<{ id: number }>("/decisions", {
        method: "POST",
        body: JSON.stringify(body),
        monitor: { operation: "frontend.mutation.record_decision", component: "decisions_page" },
      }),
    onSuccess: () => {
      // The list and its computed outcomes both come from this key.
      void queryClient.invalidateQueries({ queryKey: ["decisions"] });
      setTicker("");
      setMemo("");
      setError(null);
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Could not record the decision."),
  });

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ticker.trim()) {
      setError("A ticker is required.");
      return;
    }
    if (!memo.trim()) {
      // Mirrors the server's own rule so the user sees it without a round trip.
      setError("A memo is required: a decision without a reason is a snapshot.");
      return;
    }
    setError(null);
    mutation.mutate({ ticker: ticker.trim(), action, memo: memo.trim() });
  };

  return (
    <section className="mb-6 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <h2 className="text-sm font-bold text-[var(--text-primary)]">Record a decision</h2>
      {/* A real <form>, not a click handler on a bare button: Enter submits,
          the controls are announced as a group, and the browser supplies the
          semantics instead of custom interaction code. */}
      <form onSubmit={submit} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Ticker
          <input
            value={ticker}
            onChange={(event) => setTicker(event.target.value)}
            className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-transparent px-2 py-1 text-[var(--text-primary)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Action
          <select
            value={action}
            onChange={(event) => setAction(event.target.value as DecisionAction)}
            className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-transparent px-2 py-1 text-[var(--text-primary)]"
          >
            {DECISION_ACTIONS.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Memo
          <input
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-transparent px-2 py-1 text-[var(--text-primary)]"
          />
        </label>
        <button
          type="submit"
          disabled={mutation.isPending}
          aria-busy={mutation.isPending}
          className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] disabled:opacity-50"
        >
          {mutation.isPending ? "Recording…" : "Record decision"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-xs text-[var(--chart-negative)]">{error}</p>
      )}
    </section>
  );
}
