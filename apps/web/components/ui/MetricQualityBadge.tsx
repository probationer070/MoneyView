"use client";

import clsx from "clsx";
import type { MetricQuality } from "../../../../packages/shared-types";

const styles: Record<MetricQuality, { dot: string; text: string; bg: string; label: string }> = {
  ok: { dot: "bg-[var(--status-success-ink)]", text: "text-[var(--status-success-ink)]", bg: "bg-[var(--status-success-surface)]", label: "OK" },
  estimated: { dot: "bg-[var(--status-warning-ink)]", text: "text-[var(--status-warning-ink)]", bg: "bg-[var(--status-warning-surface)]", label: "Estimated" },
  stale: { dot: "bg-[var(--status-warning-ink)]", text: "text-[var(--status-warning-ink)]", bg: "bg-[var(--status-warning-surface)]", label: "Stale" },
  suspicious: { dot: "bg-[var(--status-error-ink)]", text: "text-[var(--status-error-ink)]", bg: "bg-[var(--status-error-surface)]", label: "Suspicious" },
  invalid: { dot: "bg-[var(--status-error-ink)]", text: "text-[var(--status-error-ink)]", bg: "bg-[var(--status-error-surface)]", label: "Invalid" },
  missing: { dot: "bg-[var(--ink-disabled)]", text: "text-[var(--ink-muted)]", bg: "bg-[var(--surface)]", label: "Missing" },
};

export function MetricQualityBadge({ quality, className, title }: { quality: MetricQuality; className?: string; title?: string }) {
  const style = styles[quality];
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-2)] px-2 py-0.5 type-caption",
        style.bg,
        style.text,
        className,
      )}
    >
      <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", style.dot)} />
      {style.label}
    </span>
  );
}
