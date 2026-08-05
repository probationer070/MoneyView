# Risk-Return Minard Chart — removed 2026-08-06

This chart and the two metrics it displayed were removed from Corporate Analysis. This file is
the record of what they were and why relabelling them was not enough. The implementation is in
git history; nothing here needs to be rebuilt.

## What Was Removed

- the `Success Probability` KPI card
- the `Failure Probability` calculation-detail modal
- the `Risk-Return Minard Chart` graph and its detail modal
- `apps/web/app/corporate/components/graphs/RiskReturnMinardGraph.tsx`
- the `successProbability` / `failureProbability` fields and the `risk_return_minard` series
  from the downloadable raw dataset

## Why

Three separate problems, none fixable by renaming.

**1. A probability that no model produced.**

```text
successProbability = clamp(55 + spread x 2.3 + growth - esgPenalty x 0.25, 5, 95)
```

A linear function of three assumption sliders. It was rendered as a percentage, always in the
positive colour regardless of value, and captioned "Above 60% is good". `55`, `2.3`, `0.25` and
the `5`–`95` clamp had no derivation. The complement, `100 - successProbability`, was labelled
a failure probability and drawn as a distribution area.

The prior version of this document disclosed all of that in a "Known Limitations" section. The
disclosure was accurate and the UI still said "Probability" in bold percent — a caveat in a doc
does not reach the person reading the card. Introducing a calibrated probability model was the
alternative, and there was no data to calibrate against.

**2. Segments with no per-segment data.**

The four "risk exposure segments" were Inflation, FX, Demand, and Margin. No inflation, FX, or
demand series entered the calculation. Each segment's Y value was the spread times a constant:

```text
Inflation = spread x 12 - 18
FX        = spread x 10 - 6
Demand    = spread x 9 + growth
Margin    = spread x 11 + roic
```

and each segment's success/failure pair was the page score plus a fixed offset (`-12`, `-5`,
`0`, `+4`). That fixed ladder made the chart's headline reading — which risk hurts most — a
constant: Inflation always worst, Margin always best, for every ticker and every setting of
every slider. The visual carried no ticker-specific information at all.

Documenting `12`, `10`, `9`, `11`, `-18`, `-6` as "scenario assumptions" would have meant
inventing a rationale for numbers that never had one. Real per-factor exposures would need
regressions against factor proxies — a modelling project, not a relabelling.

**3. `npv` was not an NPV.**

The Y series was named `npv`, tooltipped as approximating expected return, and plotted on a
percent-formatted axis. No cash flow was projected and nothing was discounted, so the axis
showed a percent of nothing. Renaming the data key would not have made the axis mean anything.

## What Replaced It

Nothing new was added. Value response to assumptions is covered by surfaces that measure it:

- **WACC x Terminal Growth Sensitivity** grid in the full DCF report — revalues the same
  projected FCFF across both axes and reports the terminal-value share at each point
- **Beta + WACC Curve** — leverage sensitivity of beta and WACC
- **4-Quadrant Value Driver Matrix** — growth against value creation

`ROIC - WACC` remains as its own KPI card. It was the chart's only real input and it is still
shown, with metric audit quality state attached.

## Related

- `ERROR-LOG.md`, entry dated 2026-08-06
- [Visualization Metrics](./architecture/visualization-metrics.md)
- [Corporate Analysis Tab](./tabs/corporate-analysis-tab.txt)
- [DCF Valuation](./dcf-valuation.md)
