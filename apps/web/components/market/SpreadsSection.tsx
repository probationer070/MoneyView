"use client";

import { useMemo } from "react";
import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import TVChart from "@/components/charts/TVChart";
import { EventFilter } from "@/components/charts/EventFilter";
import type { EventLineSpec } from "@/components/charts/primitives/EventLinesPrimitive";
import { useMarketEvents } from "@/lib/useMarketEvents";
import { useMarketSpreads } from "@/lib/useMarketSpreads";
import type { MarketSpread } from "@/lib/useMarketSpreads";
import type { TVCandle } from "@/lib/transformers";

/**
 * A spread series has one value per date, but TVChart draws candles. Flat OHLC on the same
 * value renders the line without a second chart stack -- the shape is a line either way,
 * and reusing TVChart means the I-C1 event lines overlay these charts for free.
 */
function toCandles(spread: MarketSpread): TVCandle[] {
  return spread.series.map((point) => ({
    time: point.date,
    open: point.value,
    high: point.value,
    low: point.value,
    close: point.value,
  }));
}

function SpreadCard({
  spread,
  events,
}: {
  spread: MarketSpread;
  events: EventLineSpec[];
}) {
  const t = useT();
  const { locale } = useLocale();
  const candles = useMemo(() => toCandles(spread), [spread]);
  const window = t("market.spreads.window", { days: spread.requested_window_days });

  return (
    <div
      data-testid={`spread-card-${spread.id}`}
      className="border border-[var(--line)] bg-[var(--surface-raised)] p-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="type-label text-[var(--ink)]">{spread.label}</span>
        {spread.latest !== null ? (
          <span className="type-mono text-[var(--ink)]">{formatNumber(spread.latest, "price", { digits: 1, locale })}</span>
        ) : null}
      </div>

      {/* The proxy is named, always. A figure labelled only "AI" asserts a fact about AI;
          naming the tickers lets a reader reject the proxy instead. */}
      <span className="type-small mt-0.5 block text-[var(--ink-muted)]">
        {t("market.spreads.pair", { numerator: spread.numerator, denominator: spread.denominator, window })}
      </span>

      {spread.refused_reason ? (
        // Refusal is a stated fact, so it is rendered as one: never an empty chart, never a
        // line flat at 100 (indistinguishable from a real result showing no movement), and
        // never a hidden card.
        <div className="type-small mt-3 border border-[var(--line)] bg-[var(--surface)] p-3">
          <span className="type-label block text-[var(--ink)]">{t("market.spreads.unavailable")}</span>
          <span className="block text-[var(--ink-muted)]">{t("market.spreads.reason", { reason: spread.refused_reason })}</span>
        </div>
      ) : (
        <div data-testid={`spread-chart-${spread.id}`} className="mt-3">
          {/* The event lines overlay these charts too -- reading the 28 Feb 2026 line against
              the defence spread is the reason both features exist on this page. */}
          <TVChart
            data={candles}
            events={events}
            height={140}
            tickerName={`${spread.label} spread`}
          />
        </div>
      )}
    </div>
  );
}

export function SpreadsSection() {
  const t = useT();
  const { spreads, isLoading, isError } = useMarketSpreads();
  const { lines } = useMarketEvents();

  return (
    <section
      data-testid="spreads-section"
      className="border border-[var(--line)] bg-[var(--surface-raised)] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="type-panel-title text-[var(--ink)]">{t("market.spreads.title")}</h3>
        <EventFilter testId="spreads-events-filter" />
      </div>
      <p className="type-body mt-1 text-[var(--ink-muted)]">
        {t("market.spreads.description")}
      </p>
      {/* Loading, failed and empty are three different facts, and each is stated. They used
          to render identically -- as nothing -- so a broken endpoint or the slow first
          request of the day could not be told apart from a page with no spreads. */}
      {isLoading ? (
        <p data-testid="spreads-loading" role="status" className="type-body mt-4 text-[var(--ink-muted)]">
          {t("market.spreads.loading")}
        </p>
      ) : isError ? (
        <p role="alert" className="type-body mt-4 text-[var(--status-error-ink)]">
          {t("market.spreads.error")}
        </p>
      ) : spreads.length === 0 ? (
        <p data-testid="spreads-empty" className="type-body mt-4 text-[var(--ink-muted)]">
          {t("market.spreads.empty")}
        </p>
      ) : (
        <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {spreads.map((spread) => (
            <SpreadCard key={spread.id} spread={spread} events={lines} />
          ))}
        </div>
      )}
    </section>
  );
}
