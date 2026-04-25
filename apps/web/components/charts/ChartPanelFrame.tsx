"use client";

import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { StatusBadge } from "@/components/ui/StatusBadge";

interface ChartPanelFrameProps {
  title?: string;
  description?: string;
  loading?: boolean;
  errorMessage?: string | null;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  staleLabel?: string;
  lastUpdatedLabel?: string | null;
  className?: string;
  children: ReactNode;
}

export function ChartPanelFrame({
  title,
  description,
  loading = false,
  errorMessage,
  empty = false,
  emptyTitle = "No data available",
  emptyDescription = "Run an analysis or refresh the data to see results here.",
  staleLabel,
  lastUpdatedLabel,
  className = "",
  children,
}: ChartPanelFrameProps) {
  return (
    <section className={`rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5 ${className}`}>
      {title ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-[length:var(--type-section-title)] font-black text-[var(--text-primary)]">{title}</h2>
            {description ? <p className="text-[length:var(--type-helper)] text-[var(--text-muted)]">{description}</p> : null}
          </div>
          {staleLabel ? <StatusBadge status="stale" label={staleLabel} /> : null}
        </div>
      ) : null}

      {lastUpdatedLabel ? (
        <p className="mt-2 text-[length:var(--type-helper)] text-[var(--text-muted)]">{lastUpdatedLabel}</p>
      ) : null}

      {loading ? (
        <div className="mt-4">
          <LoadingState variant="skeleton" />
        </div>
      ) : errorMessage ? (
        <div className="mt-4">
          <ErrorState title="Chart Unavailable" message={errorMessage} />
        </div>
      ) : empty ? (
        <div className="mt-4 flex min-h-[220px] items-center justify-center rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--surface-muted)]">
          <EmptyState title={emptyTitle} description={emptyDescription} />
        </div>
      ) : (
        children
      )}
    </section>
  );
}
