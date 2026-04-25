# MoneyView Component System

> Complete component inventory and specification for the MoneyView design system.
> Components are organized by layer: global primitives, data display, and page-specific composites.

---

## 1. Component Architecture

```text
components/
  ui/                    # Global primitives (layout, navigation, feedback)
  data/                  # Data-display components (tables, metrics, timeline)
  market/                # Market Overview page-specific
  portfolio/             # Portfolio page-specific
  corporate/             # Corporate Analysis page-specific
  monte-carlo/           # Monte Carlo page-specific
  news/                  # News Feed page-specific
  charts/                # Chart adapters and rendering wrappers
  providers/             # Context providers
  workbenches/           # Legacy workbench composites
```

### Existing vs New

- `Existing`: already present in the codebase
- `Specified`: part of the design system and expected to exist or remain canonical

---

## 2. Global Primitives (`components/ui/`)

### 2.1 `AppShell`

- **File**: `components/ui/AppShell.tsx`
- **Status**: Existing
- **Purpose**: Root layout wrapper containing sidebar and main content area

### 2.2 `Sidebar`

- **File**: `components/ui/Sidebar.tsx`
- **Status**: Existing
- **Purpose**: Primary navigation with the five tab links

### 2.3 `PageHeader`

- **Status**: Specified
- **Purpose**: Standardized page-level header across all tabs

### 2.4 `SectionHeader`

- **Status**: Existing / canonical
- **Purpose**: Section-level header within a page

### 2.5 `Card`

- **Status**: Existing / canonical
- **Purpose**: Primary surface container for content blocks

### 2.6 `DenseTable`

- **Status**: Existing / canonical
- **Purpose**: High-density financial data table

### 2.7 `KPIBlock`

- **Status**: Existing / canonical
- **Purpose**: Single metric display with label, value, and optional delta or status

### 2.8 `StatusBadge`

- **Status**: Existing / canonical
- **Purpose**: Small label indicating a section or workflow state

### 2.9 `DeltaBadge`

- **File**: `components/ui/DeltaBadge.tsx`
- **Status**: Existing
- **Purpose**: Colored percent-change indicator

### 2.10 `EmptyState`

- **Status**: Existing / canonical
- **Purpose**: Placeholder when data is not yet available

### 2.11 `ErrorState`

- **Status**: Existing / canonical
- **Purpose**: Error display when a fetch or computation fails

### 2.12 `LoadingState`

- **Status**: Existing / canonical
- **Purpose**: Skeleton, spinner, or progress view for loading content

### 2.13 `ModalShell`

- **Status**: Existing / canonical
- **Purpose**: Standardized modal container for drill-down overlays

### 2.14 `FilterBar`

- **Status**: Existing / canonical
- **Purpose**: Horizontal bar for filter controls, sort selectors, and action buttons

### 2.15 `ViewToggle`

- **File**: `components/ui/ViewToggle.tsx`
- **Status**: Existing
- **Purpose**: Toggle between chart and table display modes

### 2.16 `ToggleGroup`

- **Status**: Existing / canonical
- **Purpose**: Multi-option toggle selector

### 2.17 `Tabs`

- **Status**: Existing / canonical
- **Purpose**: Horizontal tab strip for subsection navigation

### 2.18 `InlineField`

- **Status**: Existing / canonical
- **Purpose**: Compact label and input pairing for dense control panels

### 2.19 `ActionButton`

- **Status**: Existing / canonical
- **Purpose**: Primary action trigger such as Run, Refresh, Save, or Export

### 2.20 `IconButton`

- **Status**: Existing / canonical
- **Purpose**: Small square button with only an icon

### 2.21 `MetricQualityBadge`

- **File**: `components/ui/MetricQualityBadge.tsx`
- **Status**: Existing
- **Purpose**: Inline quality badge for audit-qualified metrics such as `ROIC`, `WACC`, and `ROIC - WACC`
- **Design rule**:
  - The badge reflects backend quality states such as `ok`, `estimated`, `stale`, `suspicious`, `invalid`, and `missing`
  - The frontend may style and shorten the copy, but it must not reinterpret the underlying quality level

### 2.22 `MetricAuditPanel`

- **File**: `components/ui/MetricAuditPanel.tsx`
- **Status**: Existing
- **Purpose**: Drill-down panel for auditable metric inputs, warnings, and calculation lineage
- **Usage**:
  - Corporate Calculation Detail Modal
  - Portfolio Stock Detail Modal

### 2.23 Additional Existing Primitives

| Component | File |
|---|---|
| `ErrorBoundary` | `components/ui/ErrorBoundary.tsx` |
| `ExportButton` | `components/ui/ExportButton.tsx` |
| `InfoTooltip` | `components/ui/InfoTooltip.tsx` |
| `ResponsiveChart` | `components/ui/ResponsiveChart.tsx` |
| `Sliders` | `components/ui/Sliders.tsx` |
| `Sparkline` | `components/ui/Sparkline.tsx` |

---

## 3. Data Display Components (`components/data/` or `components/charts/`)

### 3.1 `SparklineCard`

- **Status**: Specified
- **Purpose**: Compact card combining current value, delta, and sparkline
- **Composes**: `Card`, `KPIBlock`, `Sparkline`, `DeltaBadge`

### 3.2 `OHLCVChartCard`

- **Status**: Existing / canonical
- **Purpose**: Candlestick and volume chart wrapped in a card with timeframe controls

### 3.3 `HeatmapPanel`

- **Status**: Existing / canonical
- **Purpose**: Color-coded matrix for correlation data

### 3.4 `AttributionWaterfall`

- **Status**: Existing
- **Purpose**: Attribution waterfall showing contribution breakdown

### 3.5 `AllocationDonut`

- **Status**: Existing
- **Purpose**: Portfolio allocation donut chart

### 3.6 `HistogramPanel`

- **Status**: Existing / canonical
- **Purpose**: Distribution histogram with optional overlay curve

### 3.7 `PercentileBandPanel`

- **Status**: Existing / canonical
- **Purpose**: Fan chart showing percentile cones over time

### 3.8 `ComparisonTable`

- **Status**: Existing / canonical
- **Purpose**: Multi-entity comparison table with sortable metrics

### 3.9 `MetricGrid`

- **Status**: Existing / canonical
- **Purpose**: Grid layout of KPI components

### 3.10 `DataQualityPanel`

- **Status**: Existing / canonical
- **Purpose**: Standardized display of freshness, source, coverage, and fallback status

### 3.11 `TimelineList`

- **Status**: Existing / canonical
- **Purpose**: Vertical timeline of events or versions

### 3.12 `DiagnosticRadar`

- **Status**: Existing
- **Purpose**: Radar or spider chart for multi-dimension diagnostic view

### 3.13 `TornadoChart`

- **Status**: Existing
- **Purpose**: Horizontal bar chart for sensitivity analysis

### 3.14 `ChartPanelFrame`

- **File**: `components/charts/ChartPanelFrame.tsx`
- **Status**: Existing
- **Purpose**: Shared panel shell for chart title, description, header actions, and empty treatment

### 3.15 `ChartGuard`

- **File**: `apps/web/app/monte-carlo/components/ChartGuard.tsx`
- **Status**: Existing
- **Purpose**: Guard boundary for Monte Carlo charts so panels render `ready`, `empty`, or `invalid` explicitly instead of failing silently
- **Design rule**:
  - Use when a panel depends on normalized worker output
  - Keep warnings visible near the guarded chart
  - Do not let child charts decide silently whether the data is valid

---

## 4. Page-Specific Components

### 4.1 Portfolio

| Component | Purpose | Status |
|---|---|---|
| `PortfolioSnapshotSummary` | Current snapshot review context with as-of date, benchmark, universe, and snapshot controls | Existing |
| `PortfolioAllocationEditor` | Per-holding weight editing with normalize and apply actions | Existing |
| `PortfolioHoldingsGrid` | Card or table view of watchlist holdings with sparklines | Conceptual composition |
| `StockDetailModal` | Portfolio drill-down with OHLCV, comparison metrics, audit panel, history, and news | Existing |
| `SnapshotHistoryModal` | Snapshot version history and review context | Existing |

### 4.2 Corporate

| Component | Purpose | Status |
|---|---|---|
| `CorporateAssumptionsPanel` | Left-column control panel with editable assumptions and quality badges | Existing |
| `CorporateDiagnosticsSection` | Right-column zone of diagnostic chart modules | Existing |
| `CorporateComparisonTable` | Peer comparison with sort and benchmark controls | Existing |
| `CalculationDetailModal` | Drill-down modal for formulas, supporting rows, and audit panels | Existing |
| `RangeControl` | Slider-row primitive used inside the assumptions panel | Existing |

### 4.3 Monte Carlo

| Component | Purpose | Status |
|---|---|---|
| `MonteCarloRunPanel` | Shared input form with run/cancel/progress controls | Existing |
| `RiskAnalysisSection` | Risk metrics and distribution panels | Existing |
| `ReturnDistributionSection` | Histogram and CDF panels | Existing |
| `PathSimulationSection` | Sample path and percentile cone panels | Existing |
| `CorporateValuationSection` | Fair-value distribution and summary panels | Existing |
| `CorrelationModelSection` | Frontier, heatmap, and sensitivity panels | Existing |

### 4.4 News

| Component | Purpose | Status |
|---|---|---|
| `NewsFeedList` | Scrollable card feed with infinite loading | Existing |

---

## 5. Component Composition Rules

### 5.1 Composition over configuration

Prefer composing primitives over building monolithic components.

### 5.2 State ownership

- **Page components** own data fetching and mutation state.
- **Section components** receive data via props and own local UI state such as toggles or sort order.
- **Primitive components** are stateless or manage only internal interaction state.

### 5.3 Loading / empty / error pattern

Every data-displaying section must handle loading, error, and empty states explicitly.

### 5.4 Audit-qualified metric pattern

When a displayed metric has audit metadata:

- Show `MetricQualityBadge` near the value at the point of interpretation.
- Use `MetricAuditPanel` in modal drill-downs where the user needs inputs, warnings, and calculation version details.
- Keep the metric meaning backend-owned; the component system only defines where and how that metadata is surfaced.

### 5.5 Guarded chart pattern

For Monte Carlo and other normalization-sensitive panels:

- Normalize data at the page or section boundary.
- Pass an explicit guard state into `ChartGuard`.
- Render warning copy near the chart if recovery was partial.
- Do not allow a chart to fail silently because of malformed input arrays.

---

## 6. Implementation Priority

### Phase 1 - Foundation primitives
1. `PageHeader`
2. `SectionHeader`
3. `Card`
4. `KPIBlock`
5. `DenseTable`
6. `ModalShell`
7. `StatusBadge`
8. `EmptyState` / `ErrorState` / `LoadingState`
9. `ActionButton` / `IconButton`

### Phase 2 - Data display components
1. `SparklineCard`
2. `MetricGrid`
3. `ComparisonTable`
4. `HistogramPanel`
5. `HeatmapPanel`
6. `PercentileBandPanel`
7. `DataQualityPanel`
8. `TimelineList`
9. `MetricQualityBadge`
10. `MetricAuditPanel`
11. `ChartGuard`

### Phase 3 - Page-specific composites
1. `PortfolioSnapshotSummary`
2. `CorporateAssumptionsPanel`
3. `MonteCarloRunPanel`
4. `NewsFeedList`
5. Remaining page-specific components

---

## 7. File Naming Convention

```text
components/
  ui/
    PageHeader.tsx
    SectionHeader.tsx
    Card.tsx
    DenseTable.tsx
    KPIBlock.tsx
    StatusBadge.tsx
    ModalShell.tsx
    EmptyState.tsx
    ErrorState.tsx
    LoadingState.tsx
    FilterBar.tsx
    ToggleGroup.tsx
    Tabs.tsx
    InlineField.tsx
    ActionButton.tsx
    IconButton.tsx
    MetricQualityBadge.tsx
    MetricAuditPanel.tsx
  data/
    SparklineCard.tsx
    MetricGrid.tsx
    ComparisonTable.tsx
    DataQualityPanel.tsx
    TimelineList.tsx
  charts/
    OHLCVChartCard.tsx
    HeatmapPanel.tsx
    HistogramPanel.tsx
    PercentileBandPanel.tsx
    ChartPanelFrame.tsx
```

All components use PascalCase filenames matching the export name. Components are client components unless they are pure layout wrappers.
