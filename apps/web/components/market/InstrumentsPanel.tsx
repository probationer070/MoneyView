"use client";

import { SparklineCard } from "@/components/data/SparklineCard";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { RollingNumber } from "@/components/ui/RollingNumber";
import { ViewToggle, type ViewMode } from "@/components/ui/ViewToggle";
import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import { FigureText } from "./FigureText";
import { ChangeFigureText } from "./ChangeFigureText";
import { changeFigure, instrumentNameKey, instrumentValueText, withFigures, type MarketIndexQuote } from "./marketModel";
import { SpreadFigureRow } from "./SpreadFigureRow";

interface InstrumentsPanelProps {
  indices: MarketIndexQuote[];
  fetchError: string | null;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onOpenDetail: (quote: MarketIndexQuote) => void;
  onOpenSpreads: () => void;
}

// Expansion spec §2.2: a toolbar (count + Graph|Table), the cards in seven columns or two four-column
// table halves, and the spread figures under either. Sized for the 1280x720 panel (plan "Height budget").
export function InstrumentsPanel({ indices, fetchError, viewMode, onViewModeChange, onOpenDetail, onOpenSpreads }: InstrumentsPanelProps) {
  const t = useT();
  const { locale } = useLocale();
  if (fetchError) return <ErrorState title={t("market.unavailableTitle")} message={fetchError} />;
  if (indices.length === 0) return <EmptyState title={t("market.emptyTitle")} description={t("market.emptyDescription")} />;
  const valueNode = (quote: MarketIndexQuote) => (
    <RollingNumber
      value={quote.last_close}
      format={(n) => instrumentValueText({ instrument_type: quote.instrument_type, last_close: n }, locale)}
      enter
    />
  );
  const nameOf = (quote: MarketIndexQuote) => {
    const key = instrumentNameKey(quote.ticker);
    return key === null ? quote.name : t(key);
  };
  const halves = [indices.slice(0, 7), indices.slice(7)];

  return (
    <div data-testid="market-instruments" className="flex flex-col gap-1">
      <div data-testid="market-instruments-toolbar" className="flex items-center justify-between gap-3">
        <p className="type-small text-[var(--ink-secondary)]">
          <FigureText parts={withFigures(t("market.instruments.count"), { count: formatNumber(indices.length, "integer", { locale }) })} />
        </p>
        <ViewToggle value={viewMode} onChange={onViewModeChange} />
      </div>

      {viewMode === "chart" ? (
        <div data-testid="market-cards" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {indices.map((quote, index) => (
            <SparklineCard
              key={quote.ticker}
              title={nameOf(quote)}
              ticker={quote.ticker}
              value={valueNode(quote)}
              index={index}
              day={changeFigure(quote.delta, quote.instrument_type)}
              month={changeFigure(quote.month_delta, quote.instrument_type)}
              sparkline={quote.sparkline}
              periodLabel={quote.period}
              onOpen={() => onOpenDetail(quote)}
            />
          ))}
        </div>
      ) : (
        <div data-testid="market-table" className="grid gap-3 xl:grid-cols-2">
          {halves.map((half, index) => (
            <div key={index} className="overflow-x-auto border border-[var(--line)] bg-[var(--surface-raised)]">
              <table className="min-w-full">
                <thead className="bg-[var(--surface)]">
                  <tr className="type-caption text-[var(--ink-muted)]">
                    <th className="h-8 px-3 text-left"><BilingualLabel k="instrument" /></th>
                    <th className="h-8 px-3 text-right"><BilingualLabel k="price" /></th>
                    <th className="h-8 px-3 text-right"><BilingualLabel k="change1d" /></th>
                    <th className="h-8 px-3 text-right"><BilingualLabel k="change1m" /></th>
                  </tr>
                </thead>
                <tbody>
                  {half.map((quote) => (
                    <tr key={quote.ticker} className="h-8 border-t border-[var(--grid)] hover:bg-[var(--surface)]">
                      <td className="px-3">
                        <button
                          type="button"
                          onClick={() => onOpenDetail(quote)}
                          aria-label={t("market.table.open", { name: nameOf(quote) })}
                          className="flex items-baseline gap-2 rounded-[var(--radius-1)] text-left"
                        >
                          <span className="type-body text-[var(--ink)]">{nameOf(quote)}</span>
                          <span className="type-caption uppercase text-[var(--ink-muted)]">{quote.ticker}</span>
                        </button>
                      </td>
                      <td className="type-mono px-3 text-right text-[var(--ink)]">{valueNode(quote)}</td>
                      <td className="px-3 text-right"><ChangeFigureText figure={changeFigure(quote.delta, quote.instrument_type)} /></td>
                      <td className="px-3 text-right"><ChangeFigureText figure={changeFigure(quote.month_delta, quote.instrument_type)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <SpreadFigureRow onOpenSpreads={onOpenSpreads} />
    </div>
  );
}
