

````markdown
# MoneyView ROIC / WACC Data Quality & Calculation Redesign Plan

## 1. Problem Summary

MoneyView currently calculates ROIC and WACC using financial data pulled from Yahoo Finance / yfinance.

Observed issue:
- ROIC sometimes returns extremely unrealistic values:
  - +100,000% or higher
  - -300,000% or lower

This should be treated as a data-quality or calculation-stability problem, not as a valid financial signal.

---

# 2. Most Likely Causes

## 2.1 Missing Financial Statement Fields

Yahoo Finance data may be missing key values such as:
- EBIT
- Operating Income
- Tax Provision
- Total Debt
- Total Equity
- Cash
- Working Capital
- Invested Capital fields

If a missing value is silently converted to:
- `0`
- `None → 0`
- empty string → 0
- NaN filled with 0

then formulas can explode.

Example:
```text
ROIC = NOPAT / Invested Capital
````

If:

```text
NOPAT = 500,000,000
Invested Capital = 1,000
```

Then:

```text
ROIC = 500,000x = 50,000,000%
```

This is mathematically valid but financially meaningless.

---

## 2.2 Near-Zero or Negative Invested Capital

ROIC denominator is the most dangerous part.

Common denominator options:

```text
Invested Capital = Total Debt + Total Equity - Cash
```

or:

```text
Invested Capital = Net Working Capital + Net PP&E + Other Operating Assets
```

Problem cases:

* negative shareholder equity
* large cash balance
* tiny debt + equity base
* missing debt field
* missing equity field
* financial companies with unusual balance sheets
* ADRs / foreign stocks with incomplete data

If invested capital becomes:

* near zero
* negative
* artificially small

ROIC becomes unstable.

---

## 2.3 Incorrect Mixing of Annual, Quarterly, and TTM Data

ROIC requires numerator and denominator consistency.

Bad example:

```text
NOPAT = annual EBIT after tax
Invested Capital = latest quarterly balance sheet
```

This can be acceptable if intentional, but must be documented.

Very bad example:

```text
NOPAT = quarterly EBIT
Invested Capital = annual balance sheet
```

or:

```text
NOPAT = TTM EBIT
Invested Capital = single quarterly snapshot with missing fields
```

This causes distorted ratios.

---

## 2.4 Wrong Field Mapping from Yahoo Finance

Yahoo/yfinance fields may not map consistently across companies.

Examples:

* EBIT may equal Operating Income for some companies
* Operating Income may be missing or mapped unexpectedly
* financial companies may use different statement structures
* foreign listings may expose incomplete fields

Therefore, relying on one field name is fragile.

---

## 2.5 Sector-Specific Incompatibility

ROIC is not equally reliable for every sector.

Problematic categories:

* banks
* insurance companies
* REITs
* asset managers
* highly leveraged financial firms
* companies with negative equity
* distressed companies

For banks and insurers, "invested capital" is not directly comparable to industrial companies.

MoneyView should not apply the same ROIC model blindly to all tickers.

---

## 2.6 Unit Scaling Problems

Yahoo-style financial data may be returned as:

* raw dollars
* thousands
* millions
* already-normalized values
* mixed depending on field/source

If EBIT is in raw dollars but invested capital is in millions, ROIC can be overstated by 1,000,000x.

Example:

```text
EBIT = 10,000,000,000
Invested Capital = 50,000
```

Wrong result:

```text
ROIC = 200,000 = 20,000,000%
```

---

## 2.7 Sign Convention Problems

CapEx, debt, cash flow, and working capital fields may appear with different sign conventions.

Examples:

* CapEx may be negative in cash flow statement
* debt reduction may be negative
* working capital changes can flip sign

If the formula assumes one sign convention but the source uses another, outputs become distorted.

---

# 3. Why WACC Can Also Become Wrong

WACC itself may not explode as dramatically as ROIC, but it can become wrong because of unstable inputs.

## 3.1 Beta Problems

Beta may be:

* missing
* stale
* based on different lookback windows
* unstable for illiquid stocks
* distorted for foreign listings

## 3.2 Cost of Debt Problems

Cost of debt may be estimated from:

```text
interest expense / total debt
```

This fails when:

* interest expense is missing
* total debt is zero
* total debt is near zero
* interest expense has unusual sign
* company recently refinanced debt

## 3.3 Capital Structure Problems

WACC requires:

```text
E / (E + D)
D / (E + D)
```

If:

* market cap is missing
* debt is missing
* debt is zero but interest exists
* equity value is tiny
* currency is mixed

then WACC becomes unreliable.

---

# 4. Immediate Fix: Do Not Return Raw Extreme ROIC

## 4.1 Add Validation Gate

Before showing ROIC, MoneyView should validate:

```text
EBIT exists
tax_rate exists or can be safely estimated
invested_capital exists
invested_capital is not near zero
invested_capital is positive
currency units are consistent
sector is compatible
```

If validation fails:

```text
ROIC = N/A
quality_flag = "invalid"
reason = "Invested capital unavailable or unstable"
```

Do NOT show extreme values as if they were valid.

---

## 4.2 Add Plausibility Bounds

Suggested display policy:

```text
If ROIC < -100% or ROIC > 100%:
    mark as outlier
    hide from default dashboard
    show only in audit/detail view
```

More conservative:

```text
If ROIC < -50% or ROIC > 80%:
    mark as suspicious
```

Important:

* Do not hard-delete the value
* Keep it in audit view
* But do not use it for ranking or decision cards

---

## 4.3 Add Denominator Floor

Example:

```python
MIN_INVESTED_CAPITAL_ABS = 1_000_000

if abs(invested_capital) < MIN_INVESTED_CAPITAL_ABS:
    return invalid("Invested capital too small")
```

Better:

```python
if abs(invested_capital) < 0.01 * revenue:
    return invalid("Invested capital too small relative to revenue")
```

This prevents denominator explosion.

---

# 5. Recommended ROIC Calculation Policy

## 5.1 Preferred Formula

Use:

```text
ROIC = NOPAT / Average Invested Capital
```

Where:

```text
NOPAT = Operating Income × (1 - normalized tax rate)
```

And:

```text
Average Invested Capital =
(Invested Capital_beginning + Invested Capital_ending) / 2
```

Use average invested capital instead of a single ending balance.

---

## 5.2 Invested Capital Definition

Recommended industrial-company definition:

```text
Invested Capital = Total Debt + Total Equity - Cash & Equivalents
```

Alternative operating definition:

```text
Invested Capital =
Net Working Capital + Net PP&E + Other Operating Assets
```

MoneyView should support both definitions but use one default.

Recommended default:

```text
Debt + Equity - Cash
```

because it is easier to derive from Yahoo balance sheet fields.

---

## 5.3 Tax Rate Policy

Avoid raw tax rate if it is unstable.

Bad:

```text
tax_rate = tax_provision / pretax_income
```

This explodes when pretax income is near zero or negative.

Recommended:

```text
normalized_tax_rate = clamp(raw_tax_rate, 0.0, 0.35)
```

or:

```text
if raw_tax_rate invalid:
    use default sector/country tax rate
```

---

# 6. Recommended WACC Calculation Policy

## 6.1 Cost of Equity

```text
Cost of Equity = Risk-Free Rate + Beta × ERP + CRP
```

Validation:

* beta must exist
* beta should be clamped or winsorized
* ERP should come from configurable assumptions
* CRP should be optional

Suggested beta bounds:

```text
0.3 <= beta <= 3.0
```

If outside:

```text
quality_flag = suspicious
```

---

## 6.2 Cost of Debt

Preferred:

```text
Cost of Debt = Interest Expense / Average Total Debt
```

Validation:

```text
if debt <= 0:
    cost_of_debt = 0
    debt_weight = 0
```

If interest expense missing:

```text
use synthetic spread model
```

Fallback:

```text
cost_of_debt = risk_free_rate + default_spread
```

---

## 6.3 Capital Weights

Use market weights:

```text
Equity Value = Market Cap
Debt Value = Total Debt
V = Equity Value + Debt Value
```

Validation:

```text
if V <= 0:
    WACC = invalid
```

---

# 7. Data Quality Layer Design

MoneyView should introduce a dedicated financial data quality layer before formulas run.

## 7.1 New Module

Suggested file:

```text
packages/core_finance/data_quality.py
```

or backend side:

```text
apps/api/services/financial_data_quality.py
```

Better architecture:

* backend normalizes raw Yahoo data
* core engine validates formula inputs

Recommended split:

```text
apps/api/services/financial_statement_normalizer.py
packages/core_finance/validation.py
```

---

## 7.2 Normalized Financial Statement Object

Create a canonical model:

```python
class NormalizedFinancials(BaseModel):
    ticker: str
    period_type: Literal["annual", "ttm", "quarterly"]
    currency: str | None

    operating_income: float | None
    ebit: float | None
    pretax_income: float | None
    tax_provision: float | None

    total_debt: float | None
    total_equity: float | None
    cash_and_equivalents: float | None
    invested_capital: float | None

    revenue: float | None
    market_cap: float | None
    beta: float | None

    source: Literal["yfinance", "manual", "cache"]
    quality_score: float
    warnings: list[str]
```

---

## 7.3 Quality Flags

Every calculated metric should return both value and quality metadata.

Example:

```python
class MetricResult(BaseModel):
    value: float | None
    unit: Literal["ratio", "percent", "currency"]
    quality: Literal["ok", "estimated", "stale", "suspicious", "invalid"]
    warnings: list[str]
    inputs_used: dict[str, float | None]
```

Example response:

```json
{
  "roic": {
    "value": null,
    "unit": "ratio",
    "quality": "invalid",
    "warnings": [
      "Invested capital is near zero",
      "ROIC suppressed due to unstable denominator"
    ],
    "inputs_used": {
      "operating_income": 1200000000,
      "tax_rate": 0.21,
      "invested_capital": 1000
    }
  }
}
```

---

# 8. UI Display Policy

## 8.1 Never Display Invalid Extreme Values as Normal

Instead of:

```text
ROIC: 300,000%
```

Display:

```text
ROIC: N/A
Data issue: invested capital too small or unavailable
```

or:

```text
ROIC: Suspicious
Open audit details
```

---

## 8.2 Add Metric Confidence Badges

Examples:

```text
ROIC 12.4%  [OK]
ROIC 48.2%  [Estimated]
ROIC N/A    [Invalid]
WACC 8.1%   [Assumption-based]
```

---

## 8.3 Add Calculation Audit Modal

For each suspicious metric, expose:

* formula used
* exact fields used
* raw source values
* normalized values
* warnings
* fallback assumptions
* timestamp
* source

This matches MoneyView's “audit layer” design.

---

# 9. Ranking / Comparison Policy

Do not rank companies using invalid or suspicious ROIC.

## 9.1 Comparison Table Rules

If ROIC invalid:

```text
ROIC - WACC = N/A
Expected return spread = N/A or low-confidence
```

If ROIC suspicious:

```text
show but exclude from default ranking
```

Recommended:

```text
ranking_status:
- included
- excluded_invalid_metric
- included_low_confidence
```

---

# 10. Snapshot Policy

When saving snapshots, store both:

```text
metric_value
metric_quality
metric_warnings
input_fields_used
calculation_version
```

This is critical.

Otherwise, historical snapshots become impossible to audit.

---

# 11. Backend API Design Change

## 11.1 Current Problem

Current API likely returns:

```json
{
  "roic": 1234.56,
  "wacc": 0.08
}
```

This is not enough.

## 11.2 Recommended API Shape

Return:

```json
{
  "ticker": "AAPL",
  "metrics": {
    "roic": {
      "value": 0.214,
      "display_value": "21.4%",
      "quality": "ok",
      "warnings": [],
      "inputs_used": {
        "operating_income": 114000000000,
        "tax_rate": 0.156,
        "average_invested_capital": 532000000000
      }
    },
    "wacc": {
      "value": 0.082,
      "display_value": "8.2%",
      "quality": "estimated",
      "warnings": ["Cost of debt estimated from fallback spread"],
      "inputs_used": {
        "risk_free_rate": 0.045,
        "beta": 1.22,
        "erp": 0.05,
        "debt_weight": 0.08
      }
    }
  }
}
```

---

# 12. Calculation Versioning

Add:

```text
calculation_version = "roic_v2_average_invested_capital"
```

Why:

* snapshots remain interpretable
* old results can be compared with new logic
* future formula changes do not silently rewrite history

---

# 13. Suggested Implementation Phases

## Phase 1 — Stop Extreme Values Immediately

* Add ROIC denominator validation
* Add plausibility bounds
* Display invalid/suspicious values as N/A
* Exclude invalid ROIC from ranking

## Phase 2 — Add MetricResult Wrapper

* Wrap ROIC, WACC, ROIC-WACC in quality metadata
* Add warnings
* Add inputs_used
* Add display_value

## Phase 3 — Normalize Yahoo Financials

* Build field mapping layer
* Add fallback hierarchy:

  * operating_income
  * EBIT
  * income_before_tax fallback only if explicitly marked
* Preserve raw source fields for audit

## Phase 4 — Rebuild ROIC

* Use NOPAT / average invested capital
* Add average beginning/ending balance support
* Add sector exclusions
* Add normalized tax rate logic

## Phase 5 — Rebuild WACC

* Normalize beta
* Estimate cost of debt safely
* Add fallback spread model
* Use market-value capital weights

## Phase 6 — UI Audit Layer

* Add confidence badges
* Add calculation audit modal
* Show raw inputs and warnings
* Explain why values are invalid or estimated

## Phase 7 — Snapshot Upgrade

* Store:

  * metric value
  * quality
  * warnings
  * inputs used
  * calculation version

---

# 14. Final Recommended Policy

MoneyView should treat ROIC and WACC as:

```text
calculated metrics with confidence metadata
```

not as raw numbers.

The correct design is:

```text
Raw Yahoo data
→ Normalize
→ Validate
→ Calculate
→ Quality-score
→ Display or suppress
→ Store with audit metadata
```

---

# 15. Final Rule

If a financial metric cannot explain its inputs, quality, and formula path:

```text
Do not show it as a decision-grade metric.
```

```
::contentReference[oaicite:1]{index=1}
```

[1]: https://github.com/ranaroussi/yfinance/issues/1044?utm_source=chatgpt.com "Wrong values for Ebit and missing values for Extraordinary ..."
