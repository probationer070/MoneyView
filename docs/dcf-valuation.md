# DCF Valuation

This document explains how to calculate DCF value in general, and how MoneyView's backend DCF flow calculates its reported intrinsic value today.

## What DCF Means

DCF stands for Discounted Cash Flow.

The idea is simple:

1. Estimate the cash the business can generate in future years.
2. Discount those future cash flows back to today using a required return, usually `WACC`.
3. Add a terminal value for cash flows beyond the explicit forecast period.

In shorthand:

```text
DCF value = PV of explicit forecast cash flows + PV of terminal value
```

## Standard DCF Calculation

### 1. Start with FCFF

MoneyView uses `FCFF` as the core cash-flow input.

```text
FCFF = EBIT * (1 - tax_rate) + depreciation - capex - delta_nwc
```

Meaning:

- `EBIT * (1 - tax_rate)` converts operating profit into after-tax operating profit.
- `depreciation` is added back because it is non-cash.
- `capex` is subtracted because it is real reinvestment spending.
- `delta_nwc` is subtracted because working-capital growth consumes cash.

### 2. Estimate growth

The reusable finance module defines sustainable growth as:

```text
growth = reinvestment_rate * ROIC
```

Interpretation:

- higher reinvestment can support higher growth
- higher `ROIC` makes that growth more valuable
- growth is not automatically good if `ROIC < WACC`

### 3. Forecast explicit cash flows

For each forecast year:

```text
FCFF_t = FCFF_0 * (1 + growth)^t
```

If you forecast 5 years, you calculate `FCFF_1` through `FCFF_5`.

### 4. Discount each forecast year

Each future cash flow is discounted by `WACC`:

```text
PV_t = FCFF_t / (1 + WACC)^t
```

The explicit-period present value is:

```text
PV of explicit FCFF = sum(PV_t)
```

### 5. Calculate terminal value

After the explicit forecast period, the standard Gordon growth model is:

```text
terminal_value = terminal_cash_flow / (WACC - terminal_growth_rate)
```

Where:

```text
terminal_cash_flow = FCFF_last_year * (1 + terminal_growth_rate)
```

Important rule:

- `WACC` must be greater than `terminal_growth_rate`

Otherwise the Gordon growth formula is not valid.

### 6. Discount terminal value back to today

If the explicit forecast has `n` years:

```text
PV of terminal value = terminal_value / (1 + WACC)^n
```

### 7. Get enterprise value

```text
enterprise_value = PV of explicit FCFF + PV of terminal value
```

### 8. Convert to equity value per share

In a textbook DCF, the next step is usually:

```text
equity_value = enterprise_value - net_debt + non_operating_assets
intrinsic_value_per_share = equity_value / diluted_shares_outstanding
```

This is the standard way to turn enterprise value into a per-share fair value.

## MoneyView Backend DCF Flow

The current backend implementation lives in:

- `packages/core_finance/dcf.py`
- `apps/api/services/corporate_dcf.py`

### Reusable core formulas

The reusable finance module provides these formula primitives:

```text
FCFF = EBIT * (1 - tax_rate) + depreciation - capex - delta_nwc
growth = reinvestment_rate * ROIC
terminal_value = terminal_cash_flow / (WACC - terminal_growth_rate)
NPV = sum(CF_t / (1 + r)^t)
enterprise_value = PV explicit + PV terminal
```

These are the clean baseline DCF formulas used by tests in `tests/core_finance/test_dcf.py`.

### Current corporate endpoint behavior

The current corporate DCF service uses a 5-year explicit forecast and computes:

```text
projected_fcff_t = base_fcff * (1 + growth_used)^t
present_value_t = projected_fcff_t / (1 + wacc)^t
pv_fcff = sum(present_value_t)
```

Then it computes terminal value:

```text
terminal_cash_flow = projected_fcff_5 * (1 + terminal_growth)
terminal_value = terminal_cash_flow / (wacc - terminal_growth)
pv_terminal = terminal_value / (1 + wacc)^5
enterprise_value = pv_fcff + pv_terminal
```

### Current intrinsic value bridge

After enterprise value is computed, MoneyView now uses the standard enterprise-to-equity bridge when bridge inputs are available:

```text
equity_value = enterprise_value - net_debt + non_operating_assets
intrinsic_value_per_share = equity_value / diluted_shares_outstanding
```

The API keeps `estimated_value` for compatibility:

- when diluted share data is available, `estimated_value` is the intrinsic value per share
- when diluted share data is unavailable, `estimated_value` falls back to enterprise value and `bridge_quality` is marked as `missing`

`current_price` is used only for comparison when a per-share intrinsic value is available:

```text
upside_pct = (estimated_value - current_price) / current_price * 100
```

If the share bridge is missing, `upside_pct` is held at `0.0` and `status` is `Bridge Incomplete` rather than comparing enterprise value to a stock price. That means current market price no longer drives the intrinsic DCF value.

The full report still exposes `agency_discount` as a diagnostic field, but the current intrinsic valuation does not apply a post-hoc ESG haircut to enterprise value. ESG and governance risk should be handled by WACC policy, cash-flow scenarios, or explicit risk diagnostics instead of an unexplained scalar.

## Worked Example

Assume:

- `base_fcff = 100`
- `growth = 6%`
- `wacc = 10%`
- `terminal_growth = 3%`
- forecast length = 5 years

### Step 1. Forecast FCFF

```text
Year 1 = 100 * 1.06 = 106.00
Year 2 = 100 * 1.06^2 = 112.36
Year 3 = 100 * 1.06^3 = 119.10
Year 4 = 100 * 1.06^4 = 126.25
Year 5 = 100 * 1.06^5 = 133.82
```

### Step 2. Discount explicit cash flows

```text
PV Year 1 = 106.00 / 1.10^1 = 96.36
PV Year 2 = 112.36 / 1.10^2 = 92.86
PV Year 3 = 119.10 / 1.10^3 = 89.48
PV Year 4 = 126.25 / 1.10^4 = 86.26
PV Year 5 = 133.82 / 1.10^5 = 83.12
```

```text
PV of explicit FCFF = 448.08
```

### Step 3. Terminal value

```text
terminal_cash_flow = 133.82 * 1.03 = 137.84
terminal_value = 137.84 / (0.10 - 0.03) = 1,969.14
pv_terminal = 1,969.14 / 1.10^5 = 1,222.82
```

### Step 4. Enterprise value

```text
enterprise_value = 448.08 + 1,222.82 = 1,670.90
```

That `1,670.90` is the core DCF enterprise value from this simplified example.

If the same company has:

- `net_debt = 200`
- `non_operating_assets = 50`
- `diluted_shares_outstanding = 10`

Then:

```text
equity_value = 1,670.90 - 200 + 50 = 1,520.90
intrinsic_value_per_share = 1,520.90 / 10 = 152.09
```

## How To Read DCF Safely

- Small changes in `WACC` or terminal growth can move value a lot.
- If terminal value is most of the result, the estimate is fragile.
- Growth only creates value when returns on capital justify it.
- A DCF should be treated as an assumption-driven range, not a precise truth.

## Related Files

- [Corporate Analysis Tab](./corporate-analysis-tab.md)
- [DCF Partial Streaming](./architecture/dcf-streaming.md)
- [Finance Logic SOP](../guideline/sop/finance-logic.md)
