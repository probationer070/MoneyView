"use client";

import { Card } from "@/components/ui/Card";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { Sparkline } from "@/components/ui/Sparkline";
import { useT } from "@/lib/i18n/locale";

interface SparklineCardProps {
  title: string;
  ticker: string;
  /** Preformatted by the caller (formatNumber); "—" when missing. */
  value: string;
  /** Percent units: 1.24 means +1.24%. */
  deltaPct: number;
  sparkline: number[];
  periodLabel?: string | null;
  onOpen: () => void;
}

// Market spec §2.2: about 233x134 in the overview's five-column grid. The whole card is the button,
// so the "Detail available" footer is gone; the period label sits beside the ticker. The English
// aria-label "Open detail for …" is what tests and the design-capture mask find the cards by.
export function SparklineCard({ title, ticker, value, deltaPct, sparkline, periodLabel, onOpen }: SparklineCardProps) {
  const t = useT();
  return (
    <Card padding="sm" hoverable as="article" className="h-full">
      <button
        type="button"
        onClick={onOpen}
        className="flex h-full w-full flex-col gap-2 rounded-[var(--radius-1)] text-left"
        aria-label={t("market.card.open", { title })}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate type-panel-title text-[var(--ink)]">{title}</h3>
            <div className="type-caption flex items-baseline gap-1 uppercase text-[var(--ink-muted)]">
              <span>{ticker}</span>
              <span aria-hidden="true">·</span>
              <span>{periodLabel ?? t("market.card.snapshot")}</span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="type-figure-md text-[var(--ink)]">{value}</div>
            <DeltaBadge value={deltaPct} className="mt-1" />
          </div>
        </div>
        <div className="mt-auto border-t border-[var(--grid)] pt-2">
          <Sparkline data={sparkline} />
        </div>
      </button>
    </Card>
  );
}
