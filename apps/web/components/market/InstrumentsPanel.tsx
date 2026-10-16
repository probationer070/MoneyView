"use client";

import clsx from "clsx";
import { SparklineCard } from "@/components/data/SparklineCard";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { ViewToggle, type ViewMode } from "@/components/ui/ViewToggle";
import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import { FigureText } from "./FigureText";
import { withFigures, type MarketIndexQuote } from "./marketModel";
import { SpreadFigureRow } from "./SpreadFigureRow";

interface InstrumentsPanelProps {
  indices: MarketIndexQuote[];
  fetchError: string | null;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onOpenDetail: (quote: MarketIndexQuote) => void;
  onOpenSpreads: () => void;
}

const SIGN_TONE = {
  up: "text-[var(--up)]",
  down: "text-[var(--down)]",
  flat: "text-[var(--flat)]",
} as const;

/** The direction of a figure as printed at one decimal, like DeltaBadge: -0.04 prints "0.0" and is flat. */
function printedSign(value: number | null | undefined): keyof typeof SIGN_TONE {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.round(Math.abs(value) * 10) === 0) return "flat";
  return value > 0 ? "up" : "down";
}

// Spec §2.2: a toolbar (count + Graph|Table), the cards in five columns or a four-column table, and
// the spread figures under either. Sized for the 1280x720 panel (plan "Height budget").
export function InstrumentsPanel({ indices, fetchError, viewMode, onViewModeChange, onOpenDetail, onOpenSpreads }: InstrumentsPanelProps) {
  const t = useT();
  const { locale } = useLocale();
  if (fetchError) return <ErrorState title={t("market.unavailableTitle")} message={fetchError} />;
  if (indices.length === 0) return <EmptyState title={t("market.emptyTitle")} description={t("market.emptyDescription")} />;
  const price = (value: number | null | undefined) => formatNumber(value, "price", { digits: 1, locale });

  return (
    <div data-testid="market-instruments" className="flex flex-col gap-3">
      <div data-testid="market-instruments-toolbar" className="flex items-center justify-between gap-3">
        <p className="type-small text-[var(--ink-secondary)]">
          <FigureText parts={withFigures(t("market.instruments.count"), { count: formatNumber(indices.length, "integer", { locale }) })} />
        </p>
        <ViewToggle value={viewMode} onChange={onViewModeChange} />
      </div>

      {viewMode === "chart" ? (
        <div data-testid="market-cards" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {indices.map((quote) => (
            <SparklineCard
              key={quote.ticker}
              title={quote.name}
              ticker={quote.ticker}
              value={price(quote.last_close)}
              deltaPct={quote.delta.delta_pct}
              sparkline={quote.sparkline}
              periodLabel={quote.period}
              onOpen={() => onOpenDetail(quote)}
            />
          ))}
        </div>
      ) : (
        <div data-testid="market-table" className="overflow-x-auto border border-[var(--line)] bg-[var(--surface-raised)]">
          <table className="min-w-full">
            <thead className="bg-[var(--surface)]">
              <tr className="type-caption text-[var(--ink-muted)]">
                <th className="h-8 px-3 text-left"><BilingualLabel k="instrument" /></th>
                <th className="h-8 px-3 text-right"><BilingualLabel k="price" /></th>
                <th className="h-8 px-3 text-right"><BilingualLabel k="absChange" /></th>
                <th className="h-8 px-3 text-right"><BilingualLabel k="change" /></th>
              </tr>
            </thead>
            <tbody>
              {indices.map((quote) => (
                <tr key={quote.ticker} className="h-8 border-t border-[var(--grid)] hover:bg-[var(--surface)]">
                  <td className="px-3">
                    <button
                      type="button"
                      onClick={() => onOpenDetail(quote)}
                      aria-label={t("market.table.open", { name: quote.name })}
                      className="flex items-baseline gap-2 rounded-[var(--radius-1)] text-left"
                    >
                      <span className="type-body text-[var(--ink)]">{quote.name}</span>
                      <span className="type-caption uppercase text-[var(--ink-muted)]">{quote.ticker}</span>
                    </button>
                  </td>
                  <td className="type-mono px-3 text-right text-[var(--ink)]">{price(quote.last_close)}</td>
                  <td className={clsx("type-mono px-3 text-right", SIGN_TONE[printedSign(quote.delta.delta_abs)])}>
                    {formatNumber(quote.delta.delta_abs, "price", { digits: 1, signed: true, locale })}
                  </td>
                  <td className="px-3 text-right"><DeltaBadge value={quote.delta.delta_pct} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SpreadFigureRow onOpenSpreads={onOpenSpreads} />
    </div>
  );
}
