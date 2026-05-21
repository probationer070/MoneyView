# Risk-Return Minard Chart

This document explains how the Risk-Return Minard chart is calculated in MoneyView today.

## What The Chart Is

The Risk-Return Minard chart is a frontend scenario visualization used in Corporate Analysis.

It is not a textbook portfolio frontier and it is not a backend valuation model.

Its purpose is to show:

- how strong the current value-creation setup looks
- how that setup behaves across a few named risk segments
- how success and failure probabilities visually relate to the expected-return path

Important boundary:

- this chart is a heuristic UI diagnostic
- it is not empirically calibrated
- it should not be treated as a statistically valid probability model
- it should not be treated as a true net present value model

## Where The Logic Lives

The current implementation is defined in:

- `apps/web/app/corporate/page.tsx`
- `apps/web/app/corporate/components/graphs/RiskReturnMinardGraph.tsx`
- `apps/web/app/corporate/buildCalculationDetails.ts`

## Inputs Used

The chart depends on the current realtime assumption state:

- `roic`
- `wacc`
- `growth`
- `esgPenalty`

From those assumptions, the page first computes:

```text
spread = roic - wacc
```

This `spread` is the core value-creation input for the chart.

Interpretation:

- positive spread means operating returns exceed the capital hurdle
- negative spread means the business is not covering its required return

## Step 1. Calculate Success Probability

MoneyView calculates a scenario-style success score with this formula:

```text
successProbability = clamp(55 + spread x 2.3 + growth - esgPenalty x 0.25, 5, 95)
```

Where:

- `55` is the base score anchor
- `spread x 2.3` rewards higher `ROIC - WACC`
- `growth` adds support from the growth assumption
- `esgPenalty x 0.25` reduces the score for agency or governance risk
- `clamp(..., 5, 95)` prevents unrealistic extremes

This means:

- stronger spread raises the score
- stronger growth raises the score
- larger ESG or agency penalty lowers the score

Methodological caveats:

- the coefficients `2.3` and `0.25` are frontend heuristics, not empirically estimated parameters
- `spread`, `growth`, and `esgPenalty` are combined into one score for directional diagnostics, not because they are proven to be commensurate in a strict valuation model
- the output is percentage-shaped, but it is not a probability derived from a stochastic distribution or observed frequency model
- the ESG penalty has a deliberately damped effect in the current implementation, so it should not be interpreted as a complete governance-risk model

## Step 2. Calculate Failure Probability

Failure probability is the complement of success probability:

```text
failureProbability = 100 - successProbability
```

This is the base downside layer shown as the chart area.

## Step 3. Build Segment Scenarios

The chart uses four fixed risk exposure segments:

- `Inflation`
- `FX`
- `Demand`
- `Margin`

For each segment, the app creates a scenario point with:

- `risk`: segment label on the X-axis
- `npv`: return-path proxy on the Y-axis
- `success`: segment-level success probability proxy
- `fail`: segment-level failure probability proxy

### Inflation

```text
npv = spread x 12 - 18
success = successProbability - 12
fail = 100 - successProbability + 12
```

### FX

```text
npv = spread x 10 - 6
success = successProbability - 5
fail = 100 - successProbability + 5
```

### Demand

```text
npv = spread x 9 + growth
success = successProbability
fail = 100 - successProbability
```

### Margin

```text
npv = spread x 11 + roic
success = successProbability + 4
fail = 96 - successProbability
```

Important implementation detail:

- these are heuristic scenario formulas used for visual diagnostics
- they are not discounted cash flow outputs
- `npv` here is a return-path proxy used by the chart, not a full audited NPV model
- the per-segment multipliers and offsets are scenario weights, not econometrically fitted sensitivities
- the four segments are not modeled as independent real-world risk factors; they are named comparison lenses

## Step 4. Render The Chart

The chart component renders the scenario dataset like this:

- X-axis: risk exposure segment name
- Y-axis: `npv`
- line: `npv` path across segments
- line thickness: scaled from `successProbability`
- area layer: `fail`

The line thickness uses:

```text
strokeWidth = max(2, successProbability / 18)
```

That means:

- higher success probability creates a thicker line
- lower success probability keeps the line thinner
- the line never becomes thinner than `2`

The line color also reacts to spread:

- positive `spread` uses the positive accent color
- negative `spread` uses the downside color

Visual caveat:

- line thickness is a qualitative emphasis device, not a precise encoded measure
- small thickness differences may be hard to distinguish visually
- thicker lines can bias interpretation, so the chart should be read with the numeric detail modal when precision matters

## Full Calculation Flow

In shorthand, the current chart calculation is:

```text
spread = roic - wacc
successProbability = clamp(55 + spread x 2.3 + growth - esgPenalty x 0.25, 5, 95)
failureProbability = 100 - successProbability

Inflation npv = spread x 12 - 18
FX npv = spread x 10 - 6
Demand npv = spread x 9 + growth
Margin npv = spread x 11 + roic
```

Then the segment dataset is rendered as a Minard-style path:

- line path for `npv`
- thickness proxy for success
- area for failure

## Worked Example

Assume:

- `roic = 15`
- `wacc = 9`
- `growth = 6`
- `esgPenalty = 8`

### 1. Spread

```text
spread = 15 - 9 = 6
```

### 2. Success probability

```text
successProbability = clamp(55 + 6 x 2.3 + 6 - 8 x 0.25, 5, 95)
successProbability = clamp(55 + 13.8 + 6 - 2, 5, 95)
successProbability = 72.8
```

### 3. Failure probability

```text
failureProbability = 100 - 72.8 = 27.2
```

### 4. Segment points

```text
Inflation npv = 6 x 12 - 18 = 54
Inflation success = 72.8 - 12 = 60.8
Inflation fail = 27.2 + 12 = 39.2
```

```text
FX npv = 6 x 10 - 6 = 54
FX success = 72.8 - 5 = 67.8
FX fail = 27.2 + 5 = 32.2
```

```text
Demand npv = 6 x 9 + 6 = 60
Demand success = 72.8
Demand fail = 27.2
```

```text
Margin npv = 6 x 11 + 15 = 81
Margin success = 72.8 + 4 = 76.8
Margin fail = 96 - 72.8 = 23.2
```

### 5. Stroke width

```text
strokeWidth = max(2, 72.8 / 18) = 4.04
```

So this example would render:

- a relatively thick line
- positive-color line styling
- lower failure area than a weak-spread case
- strongest scenario emphasis in the `Margin` segment

## How To Read The Chart Safely

- Treat it as a comparative scenario chart, not a precise valuation output.
- The chart is frontend-defined and assumption-sensitive.
- A strong path with weak success probability should still be treated as fragile.
- The chart is most useful when compared before and after assumption changes.
- Do not interpret `successProbability` as an audited probability of business success.
- Do not interpret `npv` as a discounted cash flow net present value.
- Do not assume Inflation, FX, Demand, and Margin are independent risk drivers in this chart.

## Known Limitations

- The current formula coefficients are heuristic constants rather than measured model parameters.
- Segment-specific offsets such as `-18` and `-6` are scenario-shaping constants and do not currently have a documented empirical calibration.
- Segment adjustments are not reclamped after applying per-segment offsets.
- The chart uses finance-heavy labels like `successProbability` and `npv` even though the underlying calculations are simplified scenario proxies.
- ESG and agency effects are represented as one damped linear penalty, which is materially simpler than a full governance-risk framework.

## Relationship To Other Metrics

- `Spread` comes from `ROIC - WACC`
- `Success Probability` is a frontend scenario score
- `Risk-Return Minard` uses both of those to build a segment path
- `DCF` is a separate valuation flow and should not be confused with this chart

## Related Files

- [Corporate Analysis Tab](./corporate-analysis-tab.md)
- [Visualization Metrics](./architecture/visualization-metrics.md)
- [DCF Valuation](./dcf-valuation.md)
