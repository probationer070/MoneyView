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
      <div className="border border-[var(--line)] p-3">
        <p className="type-small text-[var(--ink-secondary)]">
          Gap to fair value at decision
        </p>
        <p className="type-mono text-[var(--ink)]">
          {decision.dcf_implied_return_pct === null
            ? "—"
            : fmtPct(decision.dcf_implied_return_pct, 1)}
        </p>
        <p className="type-small text-[var(--ink-muted)]">no horizon</p>
        {decision.figures_unavailable_reason && (
          <p className="mt-1 type-small text-[var(--ink-secondary)]">
            {decision.figures_unavailable_reason}
          </p>
        )}
      </div>

      <div className="border border-[var(--line)] p-3">
        <p className="type-small text-[var(--ink-secondary)]">Price move</p>
        <p className="type-mono text-[var(--ink)]">
          {outcome.price_move_pct === null ? "—" : fmtPct(outcome.price_move_pct, 1)}
        </p>
        <p className="type-small text-[var(--ink-muted)]">
          {outcome.price_date
            ? `${outcome.decided_on} → ${outcome.price_date}`
            : `from ${outcome.decided_on}`}
        </p>
        {outcome.reason && (
          <p className="mt-1 type-small text-[var(--ink-secondary)]">{outcome.reason}</p>
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
          className="border border-[var(--line)] bg-[var(--surface-raised)] p-5"
        >
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="type-panel-title text-[var(--ink)]">{decision.ticker}</h3>
            <span className="rounded-[var(--radius-2)] border border-[var(--line)] px-2 py-0.5 type-caption uppercase text-[var(--ink-secondary)]">
              {decision.action}
            </span>
            <span className="type-small text-[var(--ink-muted)]">{decision.outcome.decided_on}</span>
          </div>
          <p className="mt-2 type-body text-[var(--ink)]">
            {decision.memo}
          </p>
          <FigurePair decision={decision} />
        </article>
      ))}
    </div>
  );
}
