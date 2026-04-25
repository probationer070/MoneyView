````markdown
# MoneyView Redesign / Fix Plan Based on Newly Identified Issues

## Core Problem Summary

The current MoneyView issues are not only UI bugs.
They reveal four deeper system problems:

1. ROIC/WACC calculations are not auditable enough.
2. Portfolio table and stock modal metrics do not consistently receive refreshed or valid latest data.
3. Long snapshot/version labels overflow their containers.
4. Monte Carlo chart rendering is structurally broken across all visualization panels.

The redesign should treat these as:
- data validation problem
- API contract problem
- UI rendering resilience problem
- chart system standardization problem

---

# 1. ROIC / WACC Auditability Redesign

## Problem

ROIC is calculated automatically from Yahoo Finance data, but the user cannot currently verify which raw fields were used.

This makes it impossible to determine whether extreme ROIC values are caused by:
- missing Yahoo Finance fields
- wrong field mapping
- wrong denominator
- unit mismatch
- negative or near-zero invested capital
- calculation bug

## Required Fix

Every ROIC and WACC result must expose calculation inputs.

## New Requirement

For every ticker, expose a "Calculation Audit" view showing:

### ROIC Inputs
- operating income / EBIT
- tax rate
- NOPAT
- total debt
- total equity
- cash and equivalents
- invested capital
- beginning invested capital
- ending invested capital
- average invested capital
- final ROIC value
- quality status
- warnings

### WACC Inputs
- risk-free rate
- beta
- equity risk premium
- country risk premium
- cost of equity
- total debt
- market cap
- debt weight
- equity weight
- cost of debt
- tax rate
- final WACC value
- quality status
- warnings

## Suggested API Shape

```json
{
  "ticker": "AAPL",
  "roic": {
    "value": 0.214,
    "display_value": "21.4%",
    "quality": "ok",
    "warnings": [],
    "inputs_used": {
      "operating_income": 114000000000,
      "tax_rate": 0.156,
      "nopat": 96200000000,
      "total_debt": 108000000000,
      "total_equity": 74000000000,
      "cash_and_equivalents": 62000000000,
      "invested_capital_beginning": 116000000000,
      "invested_capital_ending": 120000000000,
      "average_invested_capital": 118000000000
    },
    "source": "yfinance",
    "as_of": "2026-04-25",
    "calculation_version": "roic_v2_average_invested_capital"
  }
}
````

## UI Requirement

Add audit access in:

1. Individual stock detail modal
2. Corporate Analysis calculation detail modal
3. Portfolio table row action
4. Any ROIC/WACC metric card tooltip or detail drawer

## Display Rule

Never show suspicious ROIC as a normal decision metric.

If ROIC is invalid:

```text
ROIC: N/A
Reason: Invested capital missing or unstable
```

If suspicious:

```text
ROIC: 124.2% [Suspicious]
Open audit
```

---

# 2. Fix Portfolio Table N/A Metrics

## Problem

In:

* individual stock modal
* Watchlist Holdings table view

The following fields are always or frequently shown as `N/A`:

1. ROIC - WACC
2. DCF Upside
3. Expected vs Market
4. Volatility

## Likely Causes

Possible causes include:

* table view uses stale watchlist-only data
* metrics are calculated in Corporate Comparison API but not merged into Portfolio table rows
* stock modal fetches price/news but not valuation comparison metrics
* latest snapshot data is not being used
* API response shape does not include these fields
* frontend field names mismatch backend response names
* missing refresh after comparison snapshot update

## Required Redesign

Create a unified per-ticker metric model used by both:

* Watchlist Holdings table
* Stock Detail Modal

## Suggested Model

```ts
type PortfolioTickerMetrics = {
  ticker: string;

  roicMinusWacc: MetricValue;
  dcfUpside: MetricValue;
  expectedVsMarket: MetricValue;
  volatility: MetricValue;

  sourceMode: "live" | "snapshot" | "cached" | "unavailable";
  asOf: string | null;
  snapshotVersion?: string | null;
  warnings: string[];
};

type MetricValue = {
  value: number | null;
  displayValue: string;
  quality: "ok" | "estimated" | "stale" | "suspicious" | "invalid" | "missing";
  reason?: string;
};
```

## Required Backend Change

Portfolio endpoints should either:

### Option A — Enrich existing watchlist response

`GET /api/v1/portfolio/watchlist`

returns:

```json
{
  "ticker": "AAPL",
  "name": "Apple Inc.",
  "sector": "Technology",
  "weight": 0.05,
  "metrics": {
    "roic_minus_wacc": {...},
    "dcf_upside": {...},
    "expected_vs_market": {...},
    "volatility": {...}
  }
}
```

### Option B — Add dedicated endpoint

```text
GET /api/v1/portfolio/watchlist/metrics?source=latest
```

Recommended:

* Option B is cleaner if calculation is heavy.
* Option A is easier if metrics are already cached.

## Refresh Policy

Use the latest available data in this order:

1. selected saved snapshot, if user is in snapshot review mode
2. latest corporate comparison snapshot
3. live corporate comparison API
4. cached stale result
5. unavailable with reason

## UI Rule

Do not display plain `N/A` without explanation.

Instead:

```text
N/A
Missing ROIC input
```

or:

```text
N/A
No latest comparison snapshot
```

---

# 3. Snapshot / Long Text Overflow Fix

## Problem

Strings like:

```text
2026-04-25|portfolio_plus_benchmark|^GSPC||2026-04-25T03:39:56.913751+00:00
```

overflow outside their card, modal, or block.

## Required UI Fix

All long identifiers, timestamps, snapshot keys, and source labels must be overflow-safe.

## CSS Policy

Apply reusable class:

```css
.text-overflow-safe {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.text-single-line-ellipsis {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.monospace-id {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.4;
}
```

## Usage Rules

### For table cells:

Use single-line ellipsis.

```tsx
<td className="text-single-line-ellipsis" title={snapshotKey}>
  {snapshotKey}
</td>
```

### For cards/modals:

Use wrapped safe text.

```tsx
<div className="text-overflow-safe monospace-id">
  {snapshotKey}
</div>
```

### For timestamps:

Prefer formatted display:

```text
2026-04-25 12:39 KST
```

and move full ISO string to tooltip/audit view.

## Design Rule

Human-readable display first.
Raw technical identifier second.
Full raw value only in audit/detail view.

---

# 4. Monte Carlo Chart Rendering Failure Redesign

## Problem

All Monte Carlo visualizations fail:

* GBM + Jump-Diffusion Simulated Paths
* Percentile Cone
* VaR / CVaR Risk Distribution
* Terminal Value Percentiles
* Return Histogram with Fitted Normal Curve
* CDF Comparison
* Fair Value Distribution
* Efficient Frontier
* Spearman rho Sensitivity

This suggests a systemic chart rendering problem, not isolated chart bugs.

## Reference

Use previous resolution pattern from:

```text
corporate-diagnostics-graph-rendering-resolution.txt
```

Likely areas to compare:

* data shape normalization
* chart container dimensions
* SSR/client-only rendering
* invalid NaN/null values
* Recharts ResponsiveContainer parent height
* field name mismatch
* array length mismatch

## Required Redesign

Create a standardized Monte Carlo chart data pipeline.

```text
worker result
→ normalize result
→ validate chart data
→ remove NaN/null/Infinity
→ provide empty/error state
→ render chart with fixed-height container
```

---

# 5. Monte Carlo Chart Data Contracts

Each chart must have an explicit input contract.

## 5.1 Simulated Paths

```ts
type SimulatedPathPoint = {
  step: number;
  p5?: number;
  p25?: number;
  p50: number;
  p75?: number;
  p95?: number;
  pathSamples?: Record<string, number>;
};
```

## 5.2 Percentile Cone

```ts
type PercentileConePoint = {
  step: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
};
```

## 5.3 VaR / CVaR Distribution

```ts
type RiskDistributionBin = {
  binStart: number;
  binEnd: number;
  frequency: number;
  density?: number;
  isVarRegion?: boolean;
  isCvarRegion?: boolean;
};
```

## 5.4 Terminal Value Percentiles

```ts
type TerminalPercentilePoint = {
  percentile: "P5" | "P25" | "P50" | "P75" | "P95";
  value: number;
};
```

## 5.5 Return Histogram

```ts
type ReturnHistogramBin = {
  returnValue: number;
  frequency: number;
  normalFit?: number;
};
```

## 5.6 CDF Comparison

```ts
type CdfPoint = {
  returnValue: number;
  empiricalCdf: number;
  normalCdf: number;
};
```

## 5.7 Fair Value Distribution

```ts
type FairValueBin = {
  value: number;
  frequency: number;
};
```

## 5.8 Efficient Frontier

```ts
type EfficientFrontierPoint = {
  volatility: number;
  expectedReturn: number;
  sharpeRatio?: number;
  isOptimal?: boolean;
};
```

## 5.9 Spearman Rho Sensitivity

```ts
type SpearmanSensitivityPoint = {
  rho: number;
  portfolioVolatility: number;
  portfolioReturn?: number;
  diversificationBenefit?: number;
};
```

---

# 6. Shared Chart Guard

Add a reusable chart guard component.

```tsx
type ChartGuardProps<T> = {
  data: T[] | null | undefined;
  isLoading?: boolean;
  error?: unknown;
  minPoints?: number;
  children: (validData: T[]) => React.ReactNode;
};

function ChartGuard<T>({
  data,
  isLoading,
  error,
  minPoints = 1,
  children,
}: ChartGuardProps<T>) {
  if (isLoading) return <ChartLoadingState />;
  if (error) return <ChartErrorState error={error} />;
  if (!data || data.length < minPoints) return <ChartEmptyState />;

  const validData = data.filter((row) =>
    Object.values(row as Record<string, unknown>).every((value) =>
      typeof value === "number" ? Number.isFinite(value) : true
    )
  );

  if (validData.length < minPoints) return <ChartInvalidState />;

  return children(validData);
}
```

## Required Rule

Every Monte Carlo chart must use this guard.

---

# 7. Fixed Chart Containers

Recharts often fails when parent height is missing.

Use a standard chart container:

```tsx
function ChartFrame({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <section className="mv-card">
      <header className="mv-section-header">
        <h3>{title}</h3>
      </header>
      <div className="mv-chart-frame">
        {children}
      </div>
    </section>
  );
}
```

```css
.mv-chart-frame {
  width: 100%;
  height: 360px;
  min-height: 360px;
  position: relative;
}
```

For compact charts:

```css
.mv-chart-frame-sm {
  height: 240px;
  min-height: 240px;
}
```

---

# 8. Monte Carlo Worker Result Validation

Before setting state from worker output:

```ts
function validateSimulationResult(result: unknown): SimulationResult {
  // 1. Check required arrays
  // 2. Remove NaN / Infinity
  // 3. Ensure matching lengths
  // 4. Generate fallback derived arrays if missing
  // 5. Attach warnings
}
```

## Required Result State

```ts
type SimulationResultState = {
  status: "idle" | "running" | "success" | "error" | "canceled";
  result: SimulationResult | null;
  warnings: string[];
  generatedAt: string | null;
};
```

---

# 9. Redesign Priority

## Priority 1 — Data correctness and auditability

Fix first:

* ROIC/WACC input visibility
* ROIC/WACC quality flags
* invalid metric suppression
* Portfolio table metric refresh

Reason:
These affect investment interpretation.

## Priority 2 — Monte Carlo rendering recovery

Fix:

* shared chart guard
* fixed chart container
* normalized data contracts
* worker result validation

Reason:
Entire Monte Carlo tab is currently visually broken.

## Priority 3 — Layout overflow safety

Fix:

* snapshot key overflow
* timestamp formatting
* table ellipsis
* audit-only raw technical strings

Reason:
Lower risk, but affects perceived polish and usability.

---

# 10. Implementation Phases

## Phase A — ROIC/WACC Audit Patch

* Add raw input display for ROIC/WACC
* Add metric quality metadata
* Add invalid/suspicious flags
* Add audit modal or expandable calculation section

## Phase B — Portfolio Metric Refresh Patch

* Identify source of N/A fields
* Connect Watchlist Holdings table to latest comparison/valuation metrics
* Update stock detail modal to fetch same enriched metric model
* Show reason when metric is unavailable

## Phase C — Overflow UI Patch

* Add overflow-safe utility classes
* Apply to snapshot/version/timestamp fields
* Format timestamps for human display
* Move raw strings into tooltip/detail views

## Phase D — Monte Carlo Chart Recovery

* Compare against previous corporate diagnostics graph fix
* Add fixed chart containers
* Add ChartGuard
* Normalize all Monte Carlo chart datasets
* Add empty/error states per chart

## Phase E — Hardening

* Add tests for:

  * NaN/Infinity chart data
  * missing Yahoo fields
  * near-zero invested capital
  * long snapshot strings
  * empty Monte Carlo results

---

# 11. Final Redesign Principle

MoneyView should not silently show:

* impossible financial metrics
* unexplained N/A values
* broken charts
* overflowing technical IDs

Instead, every failure should become:

```text
visible
explainable
bounded
auditable
recoverable
```

