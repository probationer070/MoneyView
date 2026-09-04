"use client";

import { fmtPct } from "@/lib/chartConfig";
import type { DecisionRow } from "../decisionTypes";

// NOTE: `fmtPct` already prepends "+" for non-negative values
// (lib/chartConfig.ts) -- do NOT add a sign wrapper around it, or every
// positive figure renders as "++50.0%".

/**
 * The two figures are deliberately rendered as a PAIR with separate basis
 * lines. They share a unit and nothing else: the gap is total upside with no
 * horizon, the move is a change over a stated period. Presenting them without
 * their bases is what would invite someone to subtract one from the other.
 */
function FigurePair({ decision }: { decision: DecisionRow }) {
  const { outcome } = decision;
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="rounded-[var(--radius-sm)] border border-[var(--border-default)] p-3">
        <p className="text-xs font-medium text-[var(--text-secondary)]">
          Gap to fair value at decision
        </p>
        <p className="text-lg font-bold text-[var(--text-primary)]">
          {decision.dcf_implied_return_pct === null
            ? "—"
            : fmtPct(decision.dcf_implied_return_pct, 1)}
        </p>
        <p className="text-xs text-[var(--text-muted)]">no horizon</p>
        {decision.figures_unavailable_reason && (
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {decision.figures_unavailable_reason}
          </p>
        )}
      </div>

      <div className="rounded-[var(--radius-sm)] border border-[var(--border-default)] p-3">
        <p className="text-xs font-medium text-[var(--text-secondary)]">Price move</p>
        <p className="text-lg font-bold text-[var(--text-primary)]">
          {outcome.price_move_pct === null ? "—" : fmtPct(outcome.price_move_pct, 1)}
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          {outcome.price_date
            ? `${outcome.decided_on} → ${outcome.price_date}`
            : `from ${outcome.decided_on}`}
        </p>
        {outcome.reason && (
          <p className="mt-1 text-xs text-[var(--text-secondary)]">{outcome.reason}</p>
        )}
      </div>
    </div>
  );
}

export function DecisionList({ decisions }: { decisions: DecisionRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      {decisions.map((decision) => (
        <article
          key={decision.id}
          data-testid={`decision-card-${decision.id}`}
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5"
        >
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-bold text-[var(--text-primary)]">{decision.ticker}</h3>
            <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5 text-xs uppercase tracking-wide text-[var(--text-secondary)]">
              {decision.action}
            </span>
            <span className="text-xs text-[var(--text-muted)]">{decision.outcome.decided_on}</span>
          </div>
          <p className="mt-2 text-[length:var(--type-body)] text-[var(--text-primary)]">
            {decision.memo}
          </p>
          <FigurePair decision={decision} />
        </article>
      ))}
    </div>
  );
}
