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
    <div className={clsx("flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 text-[length:var(--type-helper)]", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[var(--text-muted)] font-medium">Status</span>
        <StatusBadge status={freshness} />
      </div>
      {lastUpdated && (
        <div className="flex items-center justify-between">
          <span className="text-[var(--text-muted)]">Last Updated</span>
          <span className="text-[var(--text-primary)]">{lastUpdated}</span>
        </div>
      )}
      {source && (
        <div className="flex items-center justify-between">
          <span className="text-[var(--text-muted)]">Source</span>
          <span className="text-[var(--text-primary)]">{source}</span>
        </div>
      )}
      {coverage && (
        <div className="flex items-center justify-between">
          <span className="text-[var(--text-muted)]">Coverage</span>
          <span className="text-[var(--text-primary)]">{coverage}</span>
        </div>
      )}
    </div>
  );
}
