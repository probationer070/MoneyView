# Damodaran-style fair value for any stock — design

Status: approved by the owner 2026-10-26 ("좋은 것 같은데"). Branch `feat/offering-shares` carries the
IPO-share solve this builds on.

## 1. Why

The owner wants every stock to show a fair value per share the way Aswath Damodaran values
SpaceX: a story turned into revenue growth, a target margin, reinvestment efficiency and a cost of
capital, discounted over ten years, bridged to equity and divided by shares.

What exists does not do that:

- `conservative_<T>_<vintage>` cases take the WORSE of the company's figure and the top-five
  industries of its sector on every input. That is a floor by design: on 2026-10-26 it put 28 of 30
  watchlist names 34-95% below price (NVDA $24.6 against $211, AAPL $91.5 against $347.7).
- TSM came out at $4,078 against $418.5 because its statements are in TWD and its price is a USD ADR.

## 2. What it is

A second case builder, beside the conservative one, that values a company against its OWN
Damodaran industry with central (not worst-of) assumptions. Damodaran's own template
(`fcffsimpleginzu`) uses the same shape: company figures where they exist, industry averages as the
defaults where they do not. The conservative case stays as the floor.

Case name: `damodaran_<TICKER>_<vintage>_FY<latest statement year>`. A repeat request for the same
name returns the stored case. New statements or a new vintage make a new case.

## 3. Inputs and rules (all rates are fractions, money in billions)

| Input | Rule | Source |
| --- | --- | --- |
| base revenue, base margin | latest fiscal year in the stored statements | `build_company_baseline` |
| company growth `g_c` | revenue CAGR over the last 3 fiscal years in the statements (fewer if fewer exist, at least 2 years of revenue) | statements, NOT `metrics.growth` (that falls back to a hard-coded table) |
| growth, years 1-5 `g` | `clamp((g_c + g_ind) / 2, -0.05, 0.25)` | `g_ind` = own industry `revenue_growth` |
| growth, years 6-10 | linear from `g` to the riskfree rate in year 10 | Damodaran's default |
| revenue target (year 10) | `base × (1+g)^5 × Π_{t=6..10} (1 + g_t)`, `g_t = g + (rf − g)(t−5)/5` | |
| margin target (year 10) | `(base_margin + industry operating_margin) / 2` | |
| sales to capital, early and late | own industry `sales_to_capital` | |
| WACC | starts at the company's measured WACC, converges from year 6 to own industry `cost_of_capital` | `metrics.wacc`; refuse when it is the fallback default |
| effective tax rate | own industry `effective_tax_rate`, ramping to the marginal 25% | |
| terminal return `roic_stable` | the lower of own industry `after_tax_roc` and the implied marginal return `margin_target × (1 − 25%) × sales_to_capital` (the engine refuses a terminal return above it; the conservative builder takes the same lower) | |
| terminal growth | riskfree rate; when the terminal return does not exceed the stable WACC, terminal growth 0 — growth at a return at or below the cost of capital adds no value (Damodaran's no-excess-return default), and with no growth the return no longer moves the value | |
| equity bridge | cash, debt, diluted shares from `load_equity_bridge`; no IPO | |

## 4. Refusals (a reason, never a substituted number)

- `currency_mismatch`: the statement currency (`financialCurrency`, newly stored on quote facts)
  differs from the price currency. Unknown statement currency (rows fetched before this change)
  does not refuse.
- `default_metrics`: the WACC came from the hard-coded fallback table, not a measurement.
- `no_growth_history`: fewer than 2 fiscal years of positive revenue.
- every refusal the existing baseline, own-industry lookup and engine already raise.

## 5. Output contract

`POST /api/v1/valuation/fair-value/{ticker}` (idempotent, creates the case once):

```json
{"ticker": "AAPL", "case_id": 41, "created": false, "vintage": "2026-01-01",
 "value_per_share": 182.4, "price": 347.7, "price_date": "2026-10-23",
 "gap_pct": -47.5,
 "floor_value_per_share": 91.5,
 "assumptions": [{"field": "growth_1_5", "value": 0.071, "claim": "..."}]}
```

- `gap_pct` is `(value - price) / price x 100`. `floor_value_per_share` is the conservative case's,
  or null when there is none.
- 422 with the refusal reason; 409 `no_vintage` (same as the conservative route).
- `price` from the latest stored close; null `price`/`gap_pct` when there are no bars.

## 6. Where it shows

1. Corporate header: beside the DCF intrinsic value, "Damodaran fair value $X (±Y% vs price)",
   or the refusal in words.
2. /valuation: a fair-value block with value, floor, price, gap and the assumptions list, and a
   link to the stored case on /cases so the owner can fork it and change the story.

## 7. Not in scope

Analyst growth estimates (no data source), options and RSU dilution, probability of failure,
segment splits for listed companies, a holdings-table column.
