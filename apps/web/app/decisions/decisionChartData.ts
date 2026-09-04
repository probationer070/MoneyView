import type { DecisionRow } from "./decisionTypes";

export interface DecisionPoint {
  id: number;
  ticker: string;
  /** Gap to fair value at decision, percent, NO horizon. */
  gapPct: number;
  /** Price move over decidedOn -> priceDate, percent. */
  movePct: number;
  decidedOn: string;
  priceDate: string;
}

export interface DecisionPartition {
  points: DecisionPoint[];
  total: number;
  /**
   * The model valued the ticker, but the outcome is unavailable. Named for the
   * STATE, not for today's cause of it: `outcome.reason` is a free-form string
   * and "no bar with a close after X" is only its current value. A field called
   * `awaitingBar` would bake one reason into the domain model and go quietly
   * wrong the day the API adds a second.
   */
  outcomeUnavailable: number;
  /** The model could not value the ticker at all, so there is no gap to plot. */
  figuresUnavailable: number;
}

/**
 * Split decisions into what can be a point and what cannot, keeping the counts.
 *
 * A point needs BOTH axes. Dropping the rest silently would let the chart
 * report on a subset while looking like it reports on the log -- so the counts
 * travel with the points and the caption renders them.
 */
export function partitionDecisions(decisions: DecisionRow[]): DecisionPartition {
  const points: DecisionPoint[] = [];
  let outcomeUnavailable = 0;
  let figuresUnavailable = 0;

  for (const decision of decisions) {
    const gapPct = decision.dcf_implied_return_pct;
    const movePct = decision.outcome.price_move_pct;
    const priceDate = decision.outcome.price_date;

    if (gapPct === null) {
      figuresUnavailable += 1;
      continue;
    }
    // The third clause is what narrows `priceDate` to `string`, so a point
    // cannot exist without the period it is measured over. See the
    // plottability invariant in the plan's Global Constraints.
    if (movePct === null || priceDate === null) {
      outcomeUnavailable += 1;
      continue;
    }
    points.push({
      id: decision.id,
      ticker: decision.ticker,
      gapPct,
      movePct,
      decidedOn: decision.outcome.decided_on,
      priceDate,
    });
  }

  return { points, total: decisions.length, outcomeUnavailable, figuresUnavailable };
}
