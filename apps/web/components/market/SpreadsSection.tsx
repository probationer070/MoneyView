"use client";

import { useMemo, useState } from "react";
import TVChart from "@/components/charts/TVChart";
import { EventsToggle } from "@/components/charts/EventsToggle";
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
  showEvents,
}: {
  spread: MarketSpread;
  events: EventLineSpec[];
  showEvents: boolean;
}) {
  const candles = useMemo(() => toCandles(spread), [spread]);
  const window = `${spread.requested_window_days}d`;

  return (
    <div
      data-testid={`spread-card-${spread.id}`}
      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-bold text-[var(--text-primary)]">{spread.label}</span>
        {spread.latest !== null ? (
          <span className="tabular-nums text-[var(--text-primary)]">{spread.latest.toFixed(1)}</span>
        ) : null}
      </div>

      {/* The proxy is named, always. A figure labelled only "AI" asserts a fact about AI;
          naming the tickers lets a reader reject the proxy instead. */}
      <span className="mt-0.5 block text-[length:var(--type-helper)] text-[var(--text-muted)]">
        {spread.numerator} vs {spread.denominator} · {window}
      </span>

      {spread.refused_reason ? (
        // Refusal is a stated fact, so it is rendered as one: never an empty chart, never a
        // line flat at 100 (indistinguishable from a real result showing no movement), and
        // never a hidden card.
        <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-[length:var(--type-helper)]">
          <span className="block font-semibold text-[var(--text-primary)]">Unavailable</span>
          <span className="block text-[var(--text-muted)]">Reason: {spread.refused_reason}</span>
        </div>
      ) : (
        <div data-testid={`spread-chart-${spread.id}`} className="mt-3">
          {/* The event lines overlay these charts too -- reading the 28 Feb 2026 line against
              the defence spread is the reason both features exist on this page. */}
          <TVChart
            data={candles}
            events={events}
            showEvents={showEvents}
            height={140}
            tickerName={`${spread.label} spread`}
          />
        </div>
      )}
    </div>
  );
}

export function SpreadsSection() {
  const { spreads } = useMarketSpreads();
  const { lines } = useMarketEvents();
  const [showEvents, setShowEvents] = useState(true);
  if (spreads.length === 0) return null;

  return (
    <section
      data-testid="spreads-section"
      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-lg font-bold text-[var(--text-primary)]">Themes and policy spreads</h3>
        {lines.length > 0 ? (
          <EventsToggle
            pressed={showEvents}
            onToggle={() => setShowEvents((shown) => !shown)}
            testId="spreads-events-toggle"
          />
        ) : null}
      </div>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Relative strength against a benchmark, indexed to 100 at the start of each window. Each
        card names the tickers it is computed from — the theme names are proxies, not measurements.
      </p>
      <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
        {spreads.map((spread) => (
          <SpreadCard key={spread.id} spread={spread} events={lines} showEvents={showEvents} />
        ))}
      </div>
    </section>
  );
}
