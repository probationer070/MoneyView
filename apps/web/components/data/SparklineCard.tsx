"use client";

import { ChangeFigureText } from "@/components/market/ChangeFigureText";
import type { ChangeFigure } from "@/components/market/marketModel";
import { Card } from "@/components/ui/Card";
import { Sparkline } from "@/components/ui/Sparkline";
import { useT } from "@/lib/i18n/locale";

interface SparklineCardProps {
  title: string;
  ticker: string;
  /** Preformatted by the caller (formatNumber); "—" when missing. */
  value: string;
  /** The one-day and one-month changes, already resolved to percent / bp / missing. */
  day: ChangeFigure;
  month: ChangeFigure;
  sparkline: number[];
  periodLabel?: string | null;
  onOpen: () => void;
}

// Market expansion spec §2.2: about 150 wide in the overview's seven-column grid, so the card is a
// stack: title, ticker · period, value, the 1D and 1M changes, then the sparkline in what is left.
// The whole card is the button. The English aria-label "Open detail for …" is what tests and the
// design-capture mask find the cards by.
export function SparklineCard({ title, ticker, value, day, month, sparkline, periodLabel, onOpen }: SparklineCardProps) {
  const t = useT();
  return (
    <Card padding="sm" hoverable as="article" className="h-full">
      <button
        type="button"
        onClick={onOpen}
        className="flex h-full w-full flex-col gap-1 rounded-[var(--radius-1)] text-left"
        aria-label={t("market.card.open", { title })}
      >
        <div className="min-w-0">
          <h3 className="truncate type-panel-title text-[var(--ink)]">{title}</h3>
          <div className="type-caption flex items-baseline gap-1 uppercase text-[var(--ink-muted)]">
            <span>{ticker}</span>
            <span aria-hidden="true">·</span>
            <span>{periodLabel ?? t("market.card.snapshot")}</span>
          </div>
        </div>
        <div className="type-figure-md text-[var(--ink)]">{value}</div>
        <div className="type-caption flex flex-col gap-1 text-[var(--ink-muted)]">
          <span data-testid="change-1d" className="flex items-center justify-between gap-1">
            <span>{t("market.change.day")}</span>
            <ChangeFigureText figure={day} />
          </span>
          <span data-testid="change-1m" className="flex items-center justify-between gap-1">
            <span>{t("market.change.month")}</span>
            <ChangeFigureText figure={month} />
          </span>
        </div>
        <div className="min-h-6 flex-1 overflow-hidden border-t border-[var(--grid)] pt-1">
          <Sparkline data={sparkline} height={32} />
        </div>
      </button>
    </Card>
  );
}
