"use client";

import { StatusBadge } from "@/components/ui/StatusBadge";
import clsx from "clsx";

interface DataQualityPanelProps {
  freshness: "live" | "stale" | "idle" | "error";
  lastUpdated?: string;
  source?: string;
  coverage?: string;
  className?: string;
}

export function DataQualityPanel({
  freshness,
  lastUpdated,
  source,
  coverage,
  className
}: DataQualityPanelProps) {
  return (
    <div className={clsx("flex flex-col gap-2 border border-[var(--line)] bg-[var(--surface-raised)] p-4 type-small", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[var(--ink-muted)]">Status</span>
        <StatusBadge status={freshness} />
      </div>
      {lastUpdated && (
        <div className="flex items-center justify-between">
          <span className="text-[var(--ink-muted)]">Last Updated</span>
          <span className="text-[var(--ink)]">{lastUpdated}</span>
        </div>
      )}
      {source && (
        <div className="flex items-center justify-between">
          <span className="text-[var(--ink-muted)]">Source</span>
          <span className="text-[var(--ink)]">{source}</span>
        </div>
      )}
      {coverage && (
        <div className="flex items-center justify-between">
          <span className="text-[var(--ink-muted)]">Coverage</span>
          <span className="text-[var(--ink)]">{coverage}</span>
        </div>
      )}
    </div>
  );
}
