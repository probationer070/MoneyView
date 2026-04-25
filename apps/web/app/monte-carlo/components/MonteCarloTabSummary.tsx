"use client";

import type { ReactNode } from "react";
import { StatusBadge, type StatusVariant } from "@/components/ui/StatusBadge";

type SummaryItem = {
  label: string;
  value: string;
};

type Props = {
  title: string;
  description: string;
  status: StatusVariant;
  statusLabel?: string;
  items: SummaryItem[];
  actions?: ReactNode;
};

export function MonteCarloTabSummary({
  title,
  description,
  status,
  statusLabel,
  items,
  actions,
}: Props) {
  return (
    <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-black text-[var(--text-primary)]">{title}</h2>
            <StatusBadge status={status} label={statusLabel} />
          </div>
          <p className="text-sm text-[var(--text-muted)]">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-3">
            <div className="text-[length:var(--type-caption)] font-bold uppercase tracking-wide text-[var(--text-muted)]">{item.label}</div>
            <div className="mt-1 text-sm font-black text-[var(--text-primary)]">{item.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
