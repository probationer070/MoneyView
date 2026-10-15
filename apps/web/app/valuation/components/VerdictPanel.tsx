"use client";

import { useLocale, useT, type Locale } from "@/lib/i18n/locale";
import { formatSignalValue } from "../verdictFormat";
import { SIGNAL_ORDER, type SignalName, type VerdictPanel, type VerdictRow } from "../verdictTypes";

type Translate = ReturnType<typeof useT>;

/**
 * The evidence panel. Computed and refused rows go through the SAME path:
 * refusal is the majority state in the real data (2 of 4 rows refuse for every
 * watchlist ticker as of 2026-09-04), so it is the main case, not a fallback.
 *
 * No badge, no score, no colour-coding, no sorting by magnitude. `direction` is
 * a fixed constant identical for every ticker; the backend deliberately
 * computes no verdict and neither does this component.
 */
export function VerdictPanelView({ panel }: { panel: VerdictPanel }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <section data-testid="verdict-panel" className="flex flex-col gap-4">
      {/* Names the subject. Plain: a ticker, not a verdict -- no badge, no colour. */}
      <h2 data-testid="verdict-ticker" className="type-panel-title text-[var(--ink)]">
        {panel.ticker}
      </h2>

      {/* Framing, rendered as prose. Not a headline verdict. */}
      <p
        data-testid="verdict-direction"
        className="border border-[var(--line)] bg-[var(--surface-raised)] p-4 type-small text-[var(--ink-secondary)]"
      >
        {panel.direction}
      </p>

      {SIGNAL_ORDER.map((name) => {
        const row = panel.rows[name];
        if (!row) return null;
        return <SignalRow key={name} name={name} row={panel.rows[name]} t={t} locale={locale} />;
      })}
    </section>
  );
}

function SignalRow({ name, row, t, locale }: { name: SignalName; row: VerdictRow; t: Translate; locale: Locale }) {
  const refused = row.value === null;
  return (
    <article
      data-testid={`verdict-row-${name}`}
      className="border border-[var(--line)] bg-[var(--surface-raised)] p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="type-panel-title text-[var(--ink)]">{t(`valuation.signal.${name}`)}</h3>
        {row.value !== null && (
          <p className="type-mono text-[var(--ink)]">
            {formatSignalValue(name, row.value, locale)}
          </p>
        )}
      </div>

      {!refused && (
        <p className="type-small text-[var(--ink-muted)]">{t(`valuation.unitNote.${name}`)}</p>
      )}

      {/* Verbatim: this is the backend's own attribution wording. */}
      {row.comparison && (
        <p className="mt-2 type-body text-[var(--ink)]">
          {row.comparison}
        </p>
      )}

      {/* Content, not an error state. */}
      {row.reason && (
        <p className="mt-2 type-body text-[var(--ink)]">
          {row.reason}
        </p>
      )}

      {/* ALWAYS, in full, on every row. Never behind a click. */}
      <p className="mt-3 type-small text-[var(--ink-secondary)]">{row.source}</p>
    </article>
  );
}
