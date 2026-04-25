"use client";

import clsx from "clsx";
import type { MetricQuality } from "../../../../packages/shared-types";

const styles: Record<MetricQuality, { dot: string; text: string; bg: string; label: string }> = {
  ok: { dot: "bg-[var(--state-success)]", text: "text-[var(--state-success)]", bg: "bg-[var(--state-success)]/10", label: "OK" },
  estimated: { dot: "bg-[var(--state-warning)]", text: "text-[var(--state-warning)]", bg: "bg-[var(--state-warning)]/10", label: "Estimated" },
  stale: { dot: "bg-[var(--state-warning)]", text: "text-[var(--state-warning)]", bg: "bg-[var(--state-warning)]/10", label: "Stale" },
  suspicious: { dot: "bg-[var(--state-error)]", text: "text-[var(--state-error)]", bg: "bg-[var(--state-error)]/10", label: "Suspicious" },
  invalid: { dot: "bg-[var(--state-error)]", text: "text-[var(--state-error)]", bg: "bg-[var(--state-error)]/10", label: "Invalid" },
  missing: { dot: "bg-[var(--text-disabled)]", text: "text-[var(--text-muted)]", bg: "bg-[var(--bg-subtle)]", label: "Missing" },
};

export function MetricQualityBadge({ quality, className }: { quality: MetricQuality; className?: string }) {
  const style = styles[quality];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-0.5 text-[length:var(--type-caption)] font-medium leading-tight",
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
