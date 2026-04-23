# MoneyView Chart System

> Chart families, rendering standards, and visual rules for all data visualizations in MoneyView.

---

## 1. Chart Technology Stack

| Library | Usage | Status |
|---|---|---|
| **Recharts** | Bar, line, area, composed, pie/donut, radar, waterfall | Active ✅ |
| **lightweight-charts** | OHLCV candlestick + volume | Active ✅ (via `TVChart.tsx`) |
| **Custom SVG/CSS** | Sparklines, heatmaps, simple indicators | Active ✅ (via `Sparkline.tsx`) |
| D3 | Avoid unless clearly necessary | Not used |

**Rule**: Minimize D3. Prefer Recharts or simple SVG/CSS. Add D3 only when Recharts cannot express the required visualization.

---

## 2. Chart Design Principles

1. **White or near-white background** — charts sit on `--bg-surface` (`#FFFFFF`)
2. **Thin gridlines** — use `--chart-grid` (`#F0F2EC`), 1px, dashed or dotted
3. **Restrained legend treatment** — inline labels or small legend below chart; no large colored boxes
4. **Low-noise axis styling** — axis lines in `--chart-label`, tick text in `type.caption`
5. **Annotations only when meaningful** — avoid decorative labels; annotate thresholds, targets, or outliers
6. **Avoid overly saturated fills** — use chart palette at reduced opacity for area fills (10–20%)
7. **Delta color convention** — red (`--chart-positive` / `--state-positive`) for up, blue (`--chart-negative` / `--state-negative`) for down
8. **Responsive container** — all charts use `ResponsiveChart` wrapper or `ResponsiveContainer` from Recharts
9. **No 3D effects** — all charts are flat 2D
10. **Consistent tooltip styling** — white background, `--border-default` border, `--radius-sm`, `type.helper` text

---

## 3. Chart Families by Page

### 3.1 Market Overview

| Chart | Component | Library | Purpose |
|---|---|---|---|
| Sparkline | `Sparkline.tsx` ✅ | Custom SVG | Trend cue in market cards |
| OHLCV Candlestick | `TVChart.tsx` ✅ | lightweight-charts | Full price chart in detail modal |
| Volume Bars | (inside TVChart) | lightweight-charts | Volume context below candlestick |

**Sparkline spec**:
- Height: 32–40px
- Stroke: `--chart-primary`, 1.5px
- No axes, no labels, no grid
- Fill: none (line only)
- Purpose: triage cue, not analytical reading

**OHLCV spec**:
- Up candle: `--chart-positive` (red) fill
- Down candle: `--chart-negative` (blue) fill
- Volume bars: `--chart-muted` at 40% opacity
- Grid: horizontal only, `--chart-grid`
- Daily/monthly toggle via `ToggleGroup`
- Moving average overlays: `--chart-secondary`, `--chart-tertiary`

### 3.2 Portfolio

| Chart | Component | Library | Purpose |
|---|---|---|---|
| Allocation Donut | `AllocationDonut.tsx` ✅ | Recharts PieChart | Weight distribution |
| Attribution Waterfall | `AttributionWaterfall.tsx` ✅ | Recharts ComposedChart | Contribution breakdown |
| Sparkline | `Sparkline.tsx` ✅ | Custom SVG | Per-holding trend in cards |
| KPI Strip | (MetricGrid) | — | Top-line attribution numbers |

**Donut spec**:
- Inner radius: 60% of outer radius
- Colors: cycle through `--chart-primary` → `--chart-ink` series
- Label: center shows total or category name
- Hover: segment lifts slightly (2px offset)
- Legend: small inline list below chart

**Waterfall spec**:
- Positive bars: `--chart-positive`
- Negative bars: `--chart-negative`
- Connector lines: `--chart-label`, 1px
- Total bar: `--chart-primary`
- Labels: above/below bars in `type.caption`
- Horizontal layout (categories on X axis)

### 3.3 Corporate Analysis

| Chart | Component | Library | Purpose |
|---|---|---|---|
| Company Status | DiagnosticWorkbench ✅ | Recharts | Lifecycle / governance snapshot |
| Hurdle Rate Decomposition | HurdleRateDecompositionGraph ✅ | Recharts ComposedChart | Cost-of-capital waterfall + regional context |
| Beta + WACC Curve | DiagnosticWorkbench ✅ | Recharts | Leverage sensitivity |
| Value Driver Matrix | DiagnosticWorkbench ✅ | Recharts | ROIC vs growth positioning |
| Risk-Return Minard | DiagnosticWorkbench ✅ | Recharts | Multi-variable encoded chart |
| DCF Core Modules | DCFWorkbench ✅ | Recharts | Valuation decomposition |
| Diagnostic Radar | `DiagnosticRadar.tsx` ✅ | Recharts RadarChart | Multi-dimension profile |
| Tornado | `TornadoChart.tsx` ✅ | Recharts BarChart | Sensitivity ranking |

**Diagnostic board layout**:
- 2-column grid on desktop, single column on mobile
- Each chart in its own `Card` with `type.card.title` header
- Charts are clickable → open Calculation Detail Modal
- Click affordance: dotted underline on title, cursor pointer

**Hurdle decomposition spec**:
- Stacked bar for cost components (risk-free, ERP, CRP, beta spread)
- Line overlay for regional comparison
- Colors: step through chart palette sequentially
- Bar labels: `type.caption`, percentage format

### 3.4 Monte Carlo

| Chart | Component | Library | Purpose |
|---|---|---|---|
| Simulated Paths | 🆕 | Recharts LineChart | Multiple path trajectories |
| Percentile Cone | 🆕 `PercentileBandPanel` | Recharts AreaChart | P5/P25/P50/P75/P95 fan |
| Return Histogram | 🆕 `HistogramPanel` | Recharts BarChart | Distribution with normal overlay |
| CDF Comparison | 🆕 | Recharts LineChart | Simulated vs normal CDF |
| VaR/CVaR Distribution | 🆕 | Recharts AreaChart | Tail-risk highlight |
| Fair Value Histogram | 🆕 `HistogramPanel` | Recharts BarChart | Corporate valuation distribution |
| Efficient Frontier | 🆕 | Recharts ScatterChart | Risk-return frontier plot |
| Correlation Heatmap | 🆕 `HeatmapPanel` | Custom SVG/CSS | NxN matrix visualization |

**Simulated paths spec**:
- Max visible paths: 50–100 (sample from full set)
- Path stroke: `--chart-tertiary` at 15% opacity
- Median path: `--chart-primary`, 2px
- P5/P95 paths: `--chart-secondary`, 1.5px, dashed
- No individual path labels
- X axis: time periods, Y axis: portfolio value

**Percentile cone spec**:
- Bands: P5–P95 (outer), P25–P75 (inner)
- Outer fill: `--chart-muted` at 20%
- Inner fill: `--chart-tertiary` at 30%
- Median line: `--chart-primary`, 2px solid
- Grid: horizontal only

**Histogram spec**:
- Bar fill: `--chart-secondary` at 60%
- Normal curve overlay: `--chart-primary`, 2px, dashed
- Current-price or mean marker: `--chart-ink`, vertical dashed line
- Labels: bin edges on X axis in `type.caption`

**Heatmap spec**:
- Cell colors: `--chart-heat-1` (cold/blue) → `--chart-heat-7` (hot/red)
- Cell border: `1px solid var(--bg-surface)` (white gap between cells)
- Cell text: correlation value in `type.table.body`, white on dark cells, dark on light cells
- Diagonal: highlighted or grayed out (self-correlation = 1.0)
- Row/column headers: `type.table.header`

### 3.5 News Feed

No analytical charts. The news feed is text-only by design.

---

## 4. Shared Chart Configuration

### 4.1 Recharts Defaults

```typescript
// Standard chart margins
const CHART_MARGIN = { top: 8, right: 16, bottom: 8, left: 16 };

// Standard axis styling
const AXIS_STYLE = {
  tick: { fontSize: 11, fill: 'var(--chart-label)' },
  axisLine: { stroke: 'var(--chart-grid)' },
  tickLine: false,
};

// Standard grid styling
const GRID_STYLE = {
  stroke: 'var(--chart-grid)',
  strokeDasharray: '3 3',
  vertical: false,  // horizontal gridlines only by default
};

// Standard tooltip styling
const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'var(--bg-surface)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 12,
    padding: '8px 12px',
  },
  labelStyle: { fontWeight: 600, marginBottom: 4 },
};
```

### 4.2 Numeric Formatting

| Format | Pattern | Example | Usage |
|---|---|---|---|
| Percent | `+0.00%` / `-0.00%` | `+3.42%` | Delta, returns, rates |
| Currency | `₩#,##0` or `$#,##0.00` | `₩2,634` | Prices, portfolio values |
| Ratio | `0.00` | `1.12` | Beta, Sharpe, Sortino |
| Large number | `#,##0` | `1,234,567` | Volume, market cap |
| Compact | `1.2M` / `3.4B` | `1.2M` | Axis labels when space is tight |

### 4.3 Color Assignment Rules

When a chart needs multiple series beyond the 6-color chart palette:

1. Use the 6 named chart colors first (`primary` → `ink`)
2. For additional series, derive lighter tints at 60% and 30% opacity
3. Never use random or auto-generated colors
4. For categorical data (sectors, instrument types), assign colors from the palette in a stable order

---

## 5. Chart Sizing Rules

| Context | Min Height | Preferred Height | Max Width |
|---|---|---|---|
| Sparkline (in card) | 32px | 40px | Card width |
| KPI-adjacent mini chart | 80px | 120px | 50% of card |
| Standard chart card | 240px | 320px | 100% of column |
| OHLCV main chart | 320px | 400px | 100% of modal/page |
| Full-width diagnostic | 280px | 360px | 100% of column |
| Heatmap | N × 48px | N × 56px | 100% of panel |

All charts must use `ResponsiveChart` or Recharts `ResponsiveContainer` with percentage width and fixed minimum height.

---

## 6. Chart Interaction Rules

### 6.1 Tooltip
- Show on hover (desktop) or tap (mobile)
- Display: formatted value, label, and series name
- Position: follow cursor with smart edge detection
- Dismiss: on mouse leave or tap outside

### 6.2 Click-through
- Chart elements that are clickable show `cursor: pointer`
- Click action opens the Calculation Detail Modal or navigates to detail
- Non-interactive charts do not show pointer cursor

### 6.3 Zoom and Pan
- OHLCV chart: scroll to zoom on time axis, drag to pan (lightweight-charts built-in)
- All other Recharts charts: no zoom/pan (static view)
- Use timeframe toggles (daily/monthly) instead of continuous zoom

### 6.4 Export
- Charts that support export show an `ExportButton` in the card header
- Export formats: PNG (screenshot), CSV (underlying data)
- Export uses the existing `ExportButton.tsx` component

---

## 7. Chart Empty and Error States

| State | Visual |
|---|---|
| No data | `EmptyState` inside the chart card — icon + "No data available" |
| Loading | Skeleton rectangle matching chart dimensions |
| Error | `ErrorState` inside the chart card with retry button |
| Insufficient data | Chart renders with available points + `StatusBadge(stale)` note |

Never render a chart with zero data points. Always fall back to the empty state.

---

## 8. Implementation Priority

### Phase 1 — Already implemented
- Sparkline ✅
- TVChart (OHLCV) ✅
- AllocationDonut ✅
- AttributionWaterfall ✅
- DiagnosticRadar ✅
- TornadoChart ✅
- HurdleRateDecompositionGraph ✅
- ResponsiveChart wrapper ✅

### Phase 2 — Core new charts
1. `HistogramPanel` (Monte Carlo return + valuation distributions)
2. `PercentileBandPanel` (Monte Carlo percentile cone)
3. `HeatmapPanel` (correlation matrix)

### Phase 3 — Extended charts
1. Efficient frontier scatter plot
2. CDF comparison line chart
3. VaR/CVaR tail-risk area chart
4. Simulated paths multi-line chart

### Phase 4 — Polish
1. Standardize all existing charts to use shared config constants
2. Add consistent tooltip styling across all charts
3. Add export support to charts that lack it
4. Audit axis formatting for numeric consistency
