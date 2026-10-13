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
  const sparklineColor = deltaPct >= 0 ? "var(--up)" : "var(--down)";

  return (
    <Card padding="lg" hoverable as="article" className="h-full">
      <button
        type="button"
        onClick={onOpen}
        className="flex h-full w-full flex-col rounded-[var(--radius-1)] text-left"
        aria-label={`Open detail for ${title}`}
      >
        <div className="mb-[var(--space-4)] flex items-start justify-between gap-[var(--space-4)]">
          <div className="min-w-0">
            <h3 className="truncate type-panel-title text-[var(--ink)]">{title}</h3>
            <span className="type-caption uppercase text-[var(--ink-muted)]">{ticker}</span>
          </div>
          <div className="shrink-0 text-right">
            <div className="type-figure-md tabular-nums text-[var(--ink)]">{value}</div>
            <DeltaBadge value={deltaPct} className="mt-[var(--space-1)]" />
          </div>
        </div>

        <div className="mt-auto border-t border-[var(--grid)] pt-[var(--space-4)]">
          <Sparkline data={sparkline} color={sparklineColor} />
        </div>

        <div className="mt-[var(--space-4)] flex items-center justify-between type-small text-[var(--ink-muted)]">
          <span>Detail available</span>
          <span>{periodLabel ?? "Snapshot"}</span>
        </div>
      </button>
    </Card>
  );
}
