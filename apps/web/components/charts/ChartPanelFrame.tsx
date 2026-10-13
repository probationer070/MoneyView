"use client";

import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useT } from "@/lib/i18n/locale";

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
  emptyTitle,
  emptyDescription,
  staleLabel,
  lastUpdatedLabel,
  className = "",
  children,
}: ChartPanelFrameProps) {
  const t = useT();
  return (
    <section className={`border border-[var(--line)] bg-[var(--surface-raised)] p-5 ${className}`}>
      {title ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="type-panel-title text-[var(--ink)]">{title}</h2>
            {description ? <p className="type-small text-[var(--ink-muted)]">{description}</p> : null}
          </div>
          {staleLabel ? <StatusBadge status="stale" label={staleLabel} /> : null}
        </div>
      ) : null}

      {lastUpdatedLabel ? (
        <p className="mt-2 type-small text-[var(--ink-muted)]">{lastUpdatedLabel}</p>
      ) : null}

      {loading ? (
        <div className="mt-4">
          <LoadingState variant="skeleton" />
        </div>
      ) : errorMessage ? (
        <div className="mt-4">
          <ErrorState title={t("common.chartUnavailable")} message={errorMessage} />
        </div>
      ) : empty ? (
        <div className="mt-4 flex min-h-[220px] items-center justify-center border border-dashed border-[var(--line)] bg-[var(--surface)]">
          <EmptyState title={emptyTitle ?? t("common.noData")} description={emptyDescription ?? t("common.noDataHint")} />
        </div>
      ) : (
        children
      )}
    </section>
  );
}
