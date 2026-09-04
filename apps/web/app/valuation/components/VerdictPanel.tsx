"use client";

import { SIGNAL_LABELS, SIGNAL_UNIT_NOTE, formatSignalValue } from "../verdictFormat";
import { SIGNAL_ORDER, type SignalName, type VerdictPanel } from "../verdictTypes";

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
  return (
    <section data-testid="verdict-panel" className="flex flex-col gap-4">
      {/* Framing, rendered as prose. Not a headline verdict. */}
      <p
        data-testid="verdict-direction"
        className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-xs leading-relaxed text-[var(--text-secondary)]"
      >
        {panel.direction}
      </p>

      {SIGNAL_ORDER.map((name) => {
        const row = panel.rows[name];
        if (!row) return null;
        return <SignalRow key={name} name={name} row={panel.rows[name]} />;
      })}
    </section>
  );
}

function SignalRow({ name, row }: { name: SignalName; row: VerdictPanel["rows"][string] }) {
  const refused = row.value === null;
  return (
    <article
      data-testid={`verdict-row-${name}`}
      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">{SIGNAL_LABELS[name]}</h3>
        {!refused && (
          <p className="text-lg font-bold text-[var(--text-primary)]">
            {formatSignalValue(name, row.value as number)}
          </p>
        )}
      </div>

      {!refused && (
        <p className="text-xs text-[var(--text-muted)]">{SIGNAL_UNIT_NOTE[name]}</p>
      )}

      {/* Verbatim: this is the backend's own attribution wording. */}
      {row.comparison && (
        <p className="mt-2 text-[length:var(--type-body)] text-[var(--text-primary)]">
          {row.comparison}
        </p>
      )}

      {/* Content, not an error state. */}
      {row.reason && (
        <p className="mt-2 text-[length:var(--type-body)] text-[var(--text-primary)]">
          {row.reason}
        </p>
      )}

      {/* ALWAYS, in full, on every row. Never behind a click. */}
      <p className="mt-3 text-xs text-[var(--text-secondary)]">{row.source}</p>
    </article>
  );
}
