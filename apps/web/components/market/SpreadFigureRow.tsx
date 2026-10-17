"use client";

import { formatNumber, MISSING } from "@/lib/format";
import { RollingNumber } from "@/components/ui/RollingNumber";
import { useLocale, useT } from "@/lib/i18n/locale";
import { DEFAULT_SPREAD_WINDOW_DAYS, useMarketSpreads } from "@/lib/useMarketSpreads";
import { FigureText } from "./FigureText";
import { spreadFigure, withFigures } from "./marketModel";

/**
 * Spec §2.3: the latest theme spreads in one row under the cards, each with the tickers it is
 * computed from. Loading, failed, empty and refused are four different facts, and each is stated,
 * by the same rules as SpreadsSection. A figure opens the Spreads tab. Test ids never start with
 * "spread-card-": market-spreads.spec.ts counts the chart cards by that prefix.
 */
export function SpreadFigureRow({ onOpenSpreads }: { onOpenSpreads: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const { spreads, isLoading, isError } = useMarketSpreads();
  const state = isLoading ? "loading" : isError ? "error" : spreads.length === 0 ? "empty" : "ready";

  return (
    <section data-testid="spread-figures" data-state={state} className="flex flex-col gap-1 border-t border-[var(--line)] pt-3">
      <p className="type-caption uppercase text-[var(--ink-muted)]">
        <FigureText parts={withFigures(t("market.spreads.figuresCaption"), { days: formatNumber(DEFAULT_SPREAD_WINDOW_DAYS, "integer", { locale }) })} />
      </p>
      {state === "loading" ? (
        <p role="status" className="type-small text-[var(--ink-muted)]">{t("market.spreads.loading")}</p>
      ) : state === "error" ? (
        <p role="alert" className="type-small text-[var(--status-error-ink)]">{t("market.spreads.error")}</p>
      ) : state === "empty" ? (
        <p className="type-small text-[var(--ink-muted)]">{t("market.spreads.empty")}</p>
      ) : (
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {spreads.map(spreadFigure).map((figure) => (
            <button
              key={figure.id}
              type="button"
              data-testid={`spread-figure-${figure.id}`}
              data-state={figure.refused ? "refused" : "computed"}
              onClick={onOpenSpreads}
              className="inline-flex items-baseline gap-2 rounded-[var(--radius-1)] text-left text-[var(--ink-secondary)] hover:text-[var(--ink)]"
            >
              <span className="type-label">{figure.label}</span>
              <span data-part="value" className="type-mono text-[var(--ink)]">
                {figure.refused ? t("market.spreads.unavailable") : figure.latest === null ? MISSING : (
                  <RollingNumber value={figure.latest} format={(n) => formatNumber(n, "price", { digits: 1, locale })} enter />
                )}
              </span>
              <span data-part="pair" className="type-caption text-[var(--ink-muted)]">{figure.pair}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
