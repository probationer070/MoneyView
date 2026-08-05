# MoneyView Chart System

> Chart families, rendering standards, and visual rules for all data visualizations in MoneyView.

---

## 1. Chart Technology Stack

| Library | Usage | Status |
|---|---|---|
| **Recharts** | Bar, line, area, composed, pie/donut, radar, waterfall | Active |
| **lightweight-charts** | OHLCV candlestick + volume | Active via `TVChart.tsx` |
| **Custom SVG/CSS** | Sparklines, heatmaps, simple indicators | Active via `Sparkline.tsx` and heatmap panels |
| D3 | Avoid unless clearly necessary | Not used |

**Rule**: Minimize D3. Prefer Recharts or simple SVG/CSS. Add D3 only when Recharts cannot express the required visualization.

---

## 2. Chart Design Principles

1. Charts sit on `--bg-surface` or a visually equivalent near-white surface.
2. Gridlines stay thin and low-noise using `--chart-grid`.
3. Legends stay restrained and compact.
4. Axis styling stays secondary to the data.
5. Annotations are only used when they explain thresholds, targets, or outliers.
6. Avoid overly saturated fills; prefer controlled opacity for bands and areas.
7. Use the product delta convention consistently: positive and negative movement must remain visually distinct.
8. All charts render through `ResponsiveChart`, `ResponsiveContainer`, or an equivalent measured wrapper.
9. No 3D effects.
10. Tooltip styling stays consistent across chart families.
11. A result object is **not** enough to justify rendering a chart; render only after the input has been validated for that panel.

---

## 3. Chart Families by Page

### 3.1 Market Overview

| Chart | Component | Library | Purpose |
|---|---|---|---|
| Sparkline | `Sparkline.tsx` | Custom SVG | Trend cue in market cards |
| OHLCV Candlestick | `TVChart.tsx` | lightweight-charts | Full price chart in detail modal |
| Volume Bars | inside `TVChart` | lightweight-charts | Volume context below candlestick |

**Sparkline spec**:
- Height: 32-40px
- Stroke: `--chart-primary`, 1.5px
- No axes, labels, or grid
- Fill: none
- Purpose: triage cue, not analytical reading

**OHLCV spec**:
- Up candle: `--chart-positive`
- Down candle: `--chart-negative`
- Volume bars: muted and lower opacity
- Grid: horizontal only
- Daily/monthly toggle via `ToggleGroup`
- Moving average overlays use stable secondary colors

### 3.2 Portfolio

| Chart | Component | Library | Purpose |
|---|---|---|---|
| Allocation Donut | `AllocationDonut.tsx` | Recharts PieChart | Weight distribution |
| Attribution Waterfall | `AttributionWaterfall.tsx` | Recharts ComposedChart | Contribution breakdown |
| Sparkline | `Sparkline.tsx` | Custom SVG | Per-holding trend in cards |
| KPI Strip | `MetricGrid` and KPI components | UI primitives | Top-line attribution numbers |

**Donut spec**:
- Inner radius: 60% of outer radius
- Colors: stable palette order
- Center label shows total or active category context
- Hover lifts the active segment slightly
- Legend stays compact below chart

**Waterfall spec**:
- Positive bars and negative bars are visually distinct
- Connector lines use a subdued axis/label tone
- Total bar uses the primary accent
- Labels sit above or below bars in caption sizing
- Horizontal layout with categories on the X axis

### 3.3 Corporate Analysis

| Chart | Component | Library | Purpose |
|---|---|---|---|
| Company Status | `CompanyStatusGraph.tsx` | Recharts | Lifecycle / governance snapshot |
| Hurdle Rate Decomposition | `HurdleRateDecompositionGraph.tsx` | Recharts ComposedChart | Cost-of-capital breakdown |
| Beta + WACC Curve | `BetaWaccCurveGraph.tsx` | Recharts | Leverage sensitivity |
| Value Driver Matrix | `ValueDriverMatrixGraph.tsx` | Recharts | ROIC vs growth positioning |
| DCF Core Modules | `DcfCoreModulesGraph.tsx` | Recharts | Valuation decomposition |
| Diagnostic Radar | `DiagnosticRadar.tsx` | Recharts RadarChart | Multi-dimension profile |
| Tornado | `TornadoChart.tsx` | Recharts BarChart | Sensitivity ranking |

**Diagnostic board layout**:
- 2-column grid on desktop, single column on mobile
- Each chart sits in its own `Card` or panel frame
- Charts may be clickable to open the Calculation Detail Modal
- Click affordance must be visible and intentional, not implied by hover alone

### 3.4 Monte Carlo

| Chart | Component | Library | Purpose |
|---|---|---|---|
| Simulated Paths | page section chart | Recharts LineChart | Multiple path trajectories |
| Percentile Cone | `PercentileBandPanel.tsx` | Recharts AreaChart | P5/P25/P50/P75/P95 fan |
| Return Histogram | `HistogramPanel.tsx` | Recharts BarChart | Distribution with normal overlay |
| CDF Comparison | page section chart | Recharts LineChart | Simulated vs normal CDF |
| VaR/CVaR Distribution | page section chart | Recharts AreaChart | Tail-risk highlight |
| Fair Value Histogram | `HistogramPanel.tsx` | Recharts BarChart | Corporate valuation distribution |
| Efficient Frontier | page section chart | Recharts ScatterChart | Risk-return frontier plot |
| Correlation Heatmap | `HeatmapPanel.tsx` | Custom SVG/CSS | NxN matrix visualization |

**Guard rule for all Monte Carlo charts**:
- Raw worker output is never treated as render-ready.
- Page-level normalization validates and sanitizes the payload before chart props are built.
- If normalization yields no usable rows, the panel renders `empty` or `invalid-data` instead of a blank chart region.
- Warning copy stays visible when the chart is partially recovered from malformed data.

**Simulated paths spec**:
- Sample a limited set of visible paths from the full run
- Individual sample paths use low-opacity strokes
- Median path uses the strongest line treatment
- No labels for every path

**Percentile cone spec**:
- Outer band: P5-P95
- Inner band: P25-P75
- Median line stays visually dominant
- Grid stays low-noise

**Histogram spec**:
- Bars use a stable distribution fill
- Overlay curve or marker lines remain readable against the bars
- Labels use caption sizing
- Invalid histogram bins must be dropped before render

**Heatmap spec**:
- Cell colors come from the defined heat scale
- White or subtle borders separate cells
- Text color must stay legible against the cell fill
- Diagonal cells are intentionally treated as self-correlation

### 3.5 News Feed

No analytical charts. The news feed is text-first by design.

---

## 4. Shared Chart Configuration

### 4.1 Recharts Defaults

```typescript
const CHART_MARGIN = { top: 8, right: 16, bottom: 8, left: 16 };

const AXIS_STYLE = {
  tick: { fontSize: 11, fill: "var(--chart-label)" },
  axisLine: { stroke: "var(--chart-grid)" },
  tickLine: false,
};

const GRID_STYLE = {
  stroke: "var(--chart-grid)",
  strokeDasharray: "3 3",
  vertical: false,
};

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: "var(--bg-surface)",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--radius-sm)",
    fontSize: 12,
    padding: "8px 12px",
  },
  labelStyle: { fontWeight: 600, marginBottom: 4 },
};
```

### 4.2 Numeric Formatting

| Format | Pattern | Example | Usage |
|---|---|---|---|
| Percent | `+0.00%` / `-0.00%` | `+3.42%` | Delta, returns, rates |
| Currency | locale-aware currency | `$1,634.00` | Prices, portfolio values |
| Ratio | `0.00` | `1.12` | Beta, Sharpe, Sortino |
| Large number | `#,##0` | `1,234,567` | Volume, market cap |
| Compact | `1.2M` / `3.4B` | `1.2M` | Axis labels when space is tight |

### 4.3 Color Assignment Rules

When a chart needs more series than the named palette:

1. Use the named chart colors first.
2. Derive lighter or lower-opacity variants in a controlled way.
3. Never use random or auto-generated colors.
4. Categorical assignments should stay stable across renders.

---

## 5. Chart Sizing Rules

| Context | Min Height | Preferred Height | Max Width |
|---|---|---|---|
| Sparkline in card | 32px | 40px | Card width |
| KPI-adjacent mini chart | 80px | 120px | 50% of card |
| Standard chart card | 240px | 320px | Column width |
| OHLCV main chart | 320px | 400px | Modal or page width |
| Full-width diagnostic | 280px | 360px | Column width |
| Heatmap | matrix-dependent | matrix-dependent | Panel width |

All charts must use a measured wrapper with percentage width and a fixed or minimum height.

---

## 6. Chart Interaction Rules

### 6.1 Tooltip
- Show on hover on desktop and tap on mobile when supported
- Display formatted value, label, and series name
- Follow cursor or touch focus with edge-aware positioning

### 6.2 Click-through
- Clickable chart elements show `cursor: pointer`
- Click action opens the Calculation Detail Modal or navigates to a detail route
- Non-interactive charts must not imply click behavior

### 6.3 Zoom and Pan
- OHLCV chart may support zoom/pan through lightweight-charts interactions
- Standard Recharts charts remain static and are controlled through toggles or filters instead

### 6.4 Export
- Charts that support export show an `ExportButton` in the header
- Supported exports are PNG and CSV where applicable

---

## 7. Chart Empty, Error, and Guard States

| State | Visual |
|---|---|
| No data | `EmptyState` inside the chart card |
| Loading | Skeleton rectangle matching chart dimensions |
| Error | `ErrorState` inside the chart card with retry button |
| Invalid data | `ChartGuard` or equivalent explanatory panel |
| Insufficient data | Render only if the remaining normalized subset is still meaningful; otherwise fall back to guarded empty/invalid treatment |

Never render a chart with zero usable data points. A blank chart shell is considered a design failure.

---

## 8. Implementation Priority

### Phase 1 - Already implemented
- Sparkline
- TVChart (OHLCV)
- AllocationDonut
- AttributionWaterfall
- DiagnosticRadar
- TornadoChart
- HurdleRateDecompositionGraph
- ResponsiveChart wrapper

### Phase 2 - Core new charts
1. `HistogramPanel`
2. `PercentileBandPanel`
3. `HeatmapPanel`
4. `ChartGuard` or an equivalent guard boundary for Monte Carlo chart panels

### Phase 3 - Extended charts
1. Efficient frontier scatter plot
2. CDF comparison line chart
3. VaR/CVaR tail-risk area chart
4. Simulated paths multi-line chart

### Phase 4 - Polish
1. Standardize all existing charts to use shared config constants
2. Add consistent tooltip styling across all charts
3. Add export support to charts that lack it
4. Audit axis formatting for numeric consistency
5. Verify every Monte Carlo chart path degrades explicitly for invalid or partially recovered data
