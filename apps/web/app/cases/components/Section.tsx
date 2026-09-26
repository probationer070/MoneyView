import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { CaseApiError } from "../casesApi";

export function Section({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <section
      data-testid={testId}
      aria-labelledby={`${testId}-title`}
      className="mb-6 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5"
    >
      <h2 id={`${testId}-title`} className="text-sm font-bold text-[var(--text-primary)]">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * The state contract every section follows. Loading renders nothing partial. A 4xx is the
 * server refusing on the model's own terms: its words are the content, in ordinary text, never
 * an error colour and never a zero. Anything else is a failure.
 * Returns null once the query has data, so the caller renders the result.
 */
export function QueryStatus<T>({ query, what, testId }: { query: UseQueryResult<T, unknown>; what: string; testId: string }) {
  if (query.isPending) {
    return <p role="status" className="text-sm text-[var(--text-secondary)]">Loading {what}…</p>;
  }
  if (query.isError) {
    const error = query.error;
    if (error instanceof CaseApiError && error.isRefusal) {
      return <p data-testid={`${testId}-refusal`} className="text-sm text-[var(--text-secondary)]">{error.detail}</p>;
    }
    return <p role="alert" className="text-sm text-[var(--chart-negative)]">Could not load {what}.</p>;
  }
  return null;
}
