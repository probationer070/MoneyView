"use client";

import { Card } from "@/components/ui/Card";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { Sparkline } from "@/components/ui/Sparkline";

interface SparklineCardProps {
  title: string;
  ticker: string;
  value: string;
  deltaPct: number;
  sparkline: number[];
  periodLabel?: string | null;
  onOpen: () => void;
}

export function SparklineCard({
  title,
  ticker,
  value,
  deltaPct,
  sparkline,
  periodLabel,
  onOpen,
}: SparklineCardProps) {
  const sparklineColor = deltaPct >= 0 ? "var(--delta-up)" : "var(--delta-down)";

  return (
    <Card padding="lg" hoverable as="article" className="h-full">
      <button
        type="button"
        onClick={onOpen}
        className="flex h-full w-full flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-info)] focus-visible:ring-offset-2"
        aria-label={`Open detail for ${title}`}
      >
        <div className="mb-[var(--space-4)] flex items-start justify-between gap-[var(--space-4)]">
          <div className="min-w-0">
            <h3 className="truncate text-[length:var(--type-card-title)] font-semibold text-[var(--text-primary)]">{title}</h3>
            <span className="text-[length:var(--type-caption)] uppercase tracking-wide text-[var(--text-muted)]">{ticker}</span>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[length:var(--type-metric-md)] font-bold tabular-nums text-[var(--text-primary)]">{value}</div>
            <DeltaBadge value={deltaPct} className="mt-[var(--space-1)]" />
          </div>
        </div>

        <div className="mt-auto border-t border-[var(--border-soft)] pt-[var(--space-4)]">
          <Sparkline data={sparkline} color={sparklineColor} />
        </div>

        <div className="mt-[var(--space-4)] flex items-center justify-between text-[length:var(--type-helper)] text-[var(--text-muted)]">
          <span>Detail available</span>
          <span>{periodLabel ?? "Snapshot"}</span>
        </div>
      </button>
    </Card>
  );
}
