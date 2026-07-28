# Finance Logic SOP

Purpose: define MoneyView's financial modeling standards so analytics are explainable, testable, and not falsely precise.

## General Principles

- A model explains uncertainty; it does not predict the future.
- Use explicit assumptions for currency, benchmark, return frequency, rebalancing, and missing data.
- Avoid double-counting risk. Do not penalize the same risk in both discount rates and probability/scenario adjustments.
- Prefer ranges, decompositions, and reconciliations over single-point claims.
- Keep financial math in `apps/api`, `apps/api/core`, or `packages/core_finance`, never in `apps/web`.

## Portfolio Attribution

Initial model: arithmetic Brinson-Fachler.

For segment `i`:

```text
Allocation_i = (w_p_i - w_b_i) * (r_b_i - r_b_total)
Selection_i = w_b_i * (r_p_i - r_b_i)
Interaction_i = (w_p_i - w_b_i) * (r_p_i - r_b_i)
```

Required invariant:

```text
sum(Allocation + Selection + Interaction) = Portfolio Return - Benchmark Return
```

Contracts must state:

- return frequency
- BOP/EOP weight assumption
- benchmark and benchmark weight source
- currency and FX policy
- corporate action policy
- sector taxonomy
- missing-data policy

Synthetic fallback data is acceptable only for deterministic testing or explicitly flagged exploratory mode. Business reports should surface data-quality metadata.

## Risk Metrics

Default Phase 5 profile:

- Beta: rolling 252 trading days where enough data exists
- VaR: historical, 95% confidence, 1-day horizon
- Expected Shortfall: historical, 95% confidence, 1-day horizon

Risk outputs must include method, confidence level, and horizon in either schema or metadata.

## Corporate Valuation

Core formulas:

```text
FCFF = EBIT * (1 - tax_rate) + depreciation - capex - delta_nwc
growth = reinvestment_rate * ROIC
terminal_value = terminal_cash_flow / (WACC - terminal_growth_rate)
```

Rules:

- WACC must be greater than terminal growth in Gordon-growth terminal value.
- Use market values for capital structure when available.
- Prefer bottom-up beta over naive regression beta.
- Use segment-specific hurdle rates when business risk materially differs by segment.

## Data Quality

Every analytics pipeline should define:

- missing-data behavior
- outlier behavior
- frequency alignment
- currency normalization
- source priority
- reproducibility key or payload version

Tests should include normal cases, edge cases, missing data, currency mismatches, and reconciliation invariants.
