# MoneyView Component System

> Complete component inventory and specification for the MoneyView design system.
> Components are organized by layer: global primitives → data display → page-specific.

---

## 1. Component Architecture

```
components/
  ui/                    # Global primitives (layout, navigation, feedback)
  data/                  # Data-display components (charts, tables, metrics)
  market/                # Market Overview page-specific
  portfolio/             # Portfolio page-specific
  corporate/             # Corporate Analysis page-specific
  monte-carlo/           # Monte Carlo page-specific
  news/                  # News Feed page-specific
  charts/                # Chart adapters (Recharts, lightweight-charts wrappers)
  providers/             # Context providers
  workbenches/           # Legacy workbench composites (DCF, Diagnostics)
```

### Existing vs New

Components marked with ✅ already exist in the codebase.
Components marked with 🆕 are new specifications for implementation.

---

## 2. Global Primitives (`components/ui/`)

### 2.1 AppShell ✅

**File**: `components/ui/AppShell.tsx`

**Purpose**: Root layout wrapper containing sidebar + main content area.

**Current implementation**: Flex layout with sidebar toggle for mobile.

**Props**: `children: ReactNode`

**Behavior**:
- Fixed sidebar on desktop (`lg:ml-64`)
- Slide-in sidebar on mobile with overlay
- Hamburger toggle at top-left on mobile
- Auto-close sidebar on resize to desktop

---

### 2.2 SidebarNav ✅

**File**: `components/ui/Sidebar.tsx`

**Purpose**: Primary navigation with five tab links.

**Current implementation**: Five nav items with Lucide icons, active state highlighting.

**Nav items**:
| Route | Label | Icon | Mode |
|---|---|---|---|
| `/` | Market Overview | `LayoutDashboard` | Scanner |
| `/portfolio` | Portfolio | `PieChart` | Operator |
| `/news` | News Feed | `Newspaper` | Reader |
| `/corporate` | Corporate Analysis | `Building2` | Modeler |
| `/monte-carlo` | Monte Carlo | `Orbit` | Lab |

**Design rules**:
- Active item: `--state-info` background, white text
- Hover: subtle background shift
- Brand mark at top: `MoneyView` with Activity icon
- Footer: `Powered by FastAPI & Next.js`

---

### 2.3 PageHeader 🆕

**Purpose**: Standardized page-level header across all five tabs.

**Props**:
```typescript
interface PageHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;        // small label above title (e.g. "Monte Carlo investment analysis")
  actions?: ReactNode;      // right-aligned action buttons
}
```

**Structure**:
```
┌─────────────────────────────────────────────┐
│ [eyebrow]                        [actions]  │
│ Title                                       │
│ subtitle                                    │
└─────────────────────────────────────────────┘
```

**Typography**: title uses `type.page.title`, subtitle uses `type.body` in `text.muted`.

---

### 2.4 SectionHeader 🆕

**Purpose**: Section-level header within a page.

**Props**:
```typescript
interface SectionHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;      // view toggle, filter, refresh button
}
```

**Typography**: title uses `type.section.title`, description uses `type.helper`.

---

### 2.5 Card 🆕

**Purpose**: Primary surface container for all content blocks.

**Props**:
```typescript
interface CardProps {
  children: ReactNode;
  padding?: 'sm' | 'md' | 'lg';   // maps to space.3, space.4, space.5
  hoverable?: boolean;              // adds hover shadow
  onClick?: () => void;
  className?: string;
}
```

**Visual spec**:
- Background: `--bg-surface`
- Border: `1px solid var(--border-default)`
- Radius: `--radius-md`
- Shadow: `none` (default), `0 1px 3px rgba(0,0,0,0.04)` (hover if `hoverable`)
- Padding: `space.4` (default)

---

### 2.6 DenseTable 🆕

**Purpose**: High-density data table for financial data display.

**Props**:
```typescript
interface DenseTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  sortable?: boolean;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  stickyHeader?: boolean;
}

interface ColumnDef<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  render?: (value: any, row: T) => ReactNode;
}
```

**Visual spec**:
- Header: `type.table.header`, `--bg-subtle` background, uppercase
- Body: `type.table.body`, `--bg-surface` background
- Row height: `40px` (dense) or `48px` (standard)
- Row hover: `--bg-subtle`
- Row click cursor: pointer if `onRowClick` provided
- Numeric columns: right-aligned, `tabular-nums`
- Dividers: `1px solid var(--border-soft)`

---

### 2.7 KPIBlock 🆕

**Purpose**: Single metric display with label, value, and optional delta.

**Props**:
```typescript
interface KPIBlockProps {
  label: string;
  value: string | number;
  delta?: number;              // percent change
  deltaDirection?: 'up' | 'down' | 'neutral';
  size?: 'sm' | 'md' | 'lg';  // maps to type.metric scales
  onClick?: () => void;
  loading?: boolean;
}
```

**Structure**:
```
┌──────────────┐
│ Label         │  type.label, text.muted
│ 1,234.56      │  type.metric.value.lg or .md
│ ▲ +2.34%      │  DeltaBadge
└──────────────┘
```

---

### 2.8 StatusBadge 🆕

**Purpose**: Small label indicating state (stale, live, error, loading, idle).

**Props**:
```typescript
interface StatusBadgeProps {
  status: 'live' | 'stale' | 'idle' | 'loading' | 'error' | 'unavailable' | 'saved' | 'canceled';
  label?: string;
}
```

**Color mapping**:
| Status | Background | Text |
|---|---|---|
| `live` | `state.success/10%` | `state.success` |
| `stale` | `state.warning/10%` | `state.warning` |
| `idle` | `bg.subtle` | `text.muted` |
| `loading` | `state.info/10%` | `state.info` |
| `error` | `state.error/10%` | `state.error` |
| `unavailable` | `bg.subtle` | `text.disabled` |
| `saved` | `state.info/10%` | `state.info` |
| `canceled` | `state.warning/10%` | `text.muted` |

---

### 2.9 DeltaBadge ✅

**File**: `components/ui/DeltaBadge.tsx`

**Purpose**: Colored percent-change indicator following red-up / blue-down convention.

---

### 2.10 EmptyState 🆕

**Purpose**: Placeholder when data is not yet available.

**Props**:
```typescript
interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;   // e.g. "Add holding" button
}
```

---

### 2.11 ErrorState 🆕

**Purpose**: Error display when a data fetch or computation fails.

**Props**:
```typescript
interface ErrorStateProps {
  title?: string;        // defaults to "Something went wrong"
  message: string;
  retryAction?: () => void;
}
```

---

### 2.12 LoadingState 🆕

**Purpose**: Skeleton or spinner for loading content.

**Props**:
```typescript
interface LoadingStateProps {
  variant: 'skeleton' | 'spinner' | 'progress';
  label?: string;
  progress?: number;    // 0–100 for progress variant
}
```

---

### 2.13 ModalShell 🆕

**Purpose**: Standardized modal container for all drill-down overlays.

**Props**:
```typescript
interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  size?: 'md' | 'lg' | 'xl' | 'full';
  children: ReactNode;
}
```

**Visual spec**:
- Backdrop: `rgba(0,0,0,0.40)`
- Surface: `--bg-elevated`
- Radius: `--radius-lg`
- Shadow: `0 4px 24px rgba(0,0,0,0.08)`
- Max width: `640px` (md), `840px` (lg), `1080px` (xl), `calc(100vw - 48px)` (full)
- Max height: `calc(100vh - 48px)` with scroll
- Header: sticky, with close button (X icon)
- Transition: `duration.slow` fade + scale

---

### 2.14 FilterBar 🆕

**Purpose**: Horizontal bar containing filter controls, sort selectors, and action buttons.

**Props**:
```typescript
interface FilterBarProps {
  children: ReactNode;   // composed of selects, toggles, buttons
  sticky?: boolean;
}
```

---

### 2.15 ViewToggle ✅

**File**: `components/ui/ViewToggle.tsx`

**Purpose**: Toggle between Chart and Table display modes.

---

### 2.16 ToggleGroup 🆕

**Purpose**: Multi-option toggle selector (e.g., sub-tab selection in Monte Carlo).

**Props**:
```typescript
interface ToggleGroupProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  size?: 'sm' | 'md';
}
```

---

### 2.17 Tabs 🆕

**Purpose**: Horizontal tab strip for sub-section navigation.

**Props**:
```typescript
interface TabsProps {
  items: { key: string; label: string; icon?: ReactNode }[];
  activeKey: string;
  onChange: (key: string) => void;
}
```

---

### 2.18 InlineField 🆕

**Purpose**: Compact label + input pairing for dense control panels (Corporate assumptions, Monte Carlo inputs).

**Props**:
```typescript
interface InlineFieldProps {
  label: string;
  helperText?: string;
  children: ReactNode;    // input, select, or slider
}
```

---

### 2.19 ActionButton 🆕

**Purpose**: Primary action trigger (Run, Refresh, Save, Export).

**Props**:
```typescript
interface ActionButtonProps {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}
```

**Visual spec**:
- Primary: `--state-info` background, white text
- Secondary: transparent, `--border-default` border, `--text-primary` text
- Danger: `--state-error` background, white text
- Height: `36px` (md), `32px` (sm)
- Radius: `--radius-md`

---

### 2.20 IconButton 🆕

**Purpose**: Small square button with only an icon (close, settings, expand).

**Props**:
```typescript
interface IconButtonProps {
  icon: ReactNode;
  onClick: () => void;
  label: string;          // aria-label, required
  size?: 'sm' | 'md';
}
```

---

### 2.21 Additional Existing Primitives

| Component | File | Status |
|---|---|---|
| `ErrorBoundary` | `components/ui/ErrorBoundary.tsx` | ✅ |
| `ExportButton` | `components/ui/ExportButton.tsx` | ✅ |
| `InfoTooltip` | `components/ui/InfoTooltip.tsx` | ✅ |
| `ResponsiveChart` | `components/ui/ResponsiveChart.tsx` | ✅ |
| `Sliders` | `components/ui/Sliders.tsx` | ✅ |
| `Sparkline` | `components/ui/Sparkline.tsx` | ✅ |

---

## 3. Data Display Components (`components/data/` or `components/charts/`)

### 3.1 SparklineCard 🆕

**Purpose**: Compact card combining current value, delta, and sparkline. Used in Market Overview card grid and Portfolio holdings.

**Composes**: `Card` + `KPIBlock` + `Sparkline` + `DeltaBadge`

---

### 3.2 OHLCVChartCard 🆕

**Purpose**: Candlestick + volume chart wrapped in a card with timeframe controls.

**Composes**: `Card` + `TVChart` (existing) + timeframe `ToggleGroup`

**Current**: `TVChart.tsx` exists wrapping lightweight-charts.

---

### 3.3 HeatmapPanel 🆕

**Purpose**: Color-coded matrix for correlation data, using `chart.heat.1–7` scale.

**Usage**: Monte Carlo correlation model, potential market cross-correlation.

---

### 3.4 WaterfallPanel ✅

**File**: `components/charts/AttributionWaterfall.tsx`

**Purpose**: Attribution waterfall showing contribution breakdown.

---

### 3.5 DonutPanel ✅

**File**: `components/charts/AllocationDonut.tsx`

**Purpose**: Portfolio allocation donut chart.

---

### 3.6 HistogramPanel 🆕

**Purpose**: Distribution histogram with optional fitted curve overlay.

**Usage**: Monte Carlo return distribution, corporate valuation fair-value distribution.

---

### 3.7 PercentileBandPanel 🆕

**Purpose**: Fan chart showing percentile cones over time.

**Usage**: Monte Carlo path simulation percentile cone.

---

### 3.8 ComparisonTable 🆕

**Purpose**: Multi-entity comparison table with sortable metrics.

**Extends**: `DenseTable` with comparison-specific column presets (ticker, value, spread, return metrics).

**Usage**: Corporate peer comparison, portfolio snapshot comparison.

---

### 3.9 MetricGrid 🆕

**Purpose**: Grid layout of `KPIBlock` components, typically 3–4 per row.

**Props**:
```typescript
interface MetricGridProps {
  metrics: KPIBlockProps[];
  columns?: 2 | 3 | 4;
}
```

---

### 3.10 DataQualityPanel 🆕

**Purpose**: Standardized display of data freshness, source, coverage, and fallback status.

**Usage**: Market detail modal, Corporate analysis refresh state.

---

### 3.11 TimelineList 🆕

**Purpose**: Vertical timeline of events or versions (snapshot history, news chronology).

**Usage**: Snapshot history modal, stock detail modal history section.

---

### 3.12 DiagnosticRadar ✅

**File**: `components/charts/DiagnosticRadar.tsx`

**Purpose**: Radar/spider chart for multi-dimension diagnostic view.

---

### 3.13 TornadoChart ✅

**File**: `components/charts/TornadoChart.tsx`

**Purpose**: Horizontal bar chart for sensitivity analysis.

---

## 4. Page-Specific Components

### 4.1 Portfolio (`components/portfolio/`)

| Component | Purpose | Status |
|---|---|---|
| `PortfolioSnapshotSummary` | Current snapshot review context with as-of date, benchmark, universe | 🆕 |
| `PortfolioAllocationEditor` | Per-holding weight editing with normalize + apply actions | 🆕 |
| `PortfolioHoldingsGrid` | Card or table view of watchlist holdings with sparklines | 🆕 |
| `AttributionSummaryBoard` | KPI cards + donut + waterfall composed into attribution zone | 🆕 |

### 4.2 Corporate (`components/corporate/`)

| Component | Purpose | Status |
|---|---|---|
| `CorporateAssumptionsPanel` | Left-column control panel with all editable assumptions | 🆕 |
| `CorporateDiagnosticsBoard` | Right-column grid of diagnostic chart modules | 🆕 |
| `CorporateComparisonTable` | Bottom-zone peer comparison with sort and benchmark controls | 🆕 |

### 4.3 Monte Carlo (`components/monte-carlo/`)

| Component | Purpose | Status |
|---|---|---|
| `MonteCarloRunPanel` | Shared input form + run/cancel + progress + result surface | 🆕 |
| `RiskMetricsBoard` | VaR, CVaR, Sortino, drawdown metric cards | 🆕 |
| `CorrelationMatrixEditor` | Editable NxN matrix input for correlation model | 🆕 |

### 4.4 News (`components/news/`)

| Component | Purpose | Status |
|---|---|---|
| `NewsFeedList` | Scrollable card feed with infinite loading | 🆕 |

---

## 5. Component Composition Rules

### 5.1 Composition over configuration

Prefer composing primitives over building monolithic components:

```
// Good: composed from primitives
<Card>
  <SectionHeader title="Attribution" actions={<ViewToggle />} />
  <MetricGrid metrics={attributionKPIs} columns={4} />
  <AttributionWaterfall data={waterfall} />
</Card>

// Avoid: one big component with many props
<AttributionSection
  title="Attribution"
  viewToggle={true}
  kpis={attributionKPIs}
  waterfallData={waterfall}
/>
```

### 5.2 State ownership

- **Page components** own data fetching and mutation state (React Query)
- **Section components** receive data via props, own local UI state (toggles, sorts)
- **Primitive components** are stateless or manage only internal interaction state

### 5.3 Loading / empty / error pattern

Every data-displaying section must handle three states:

```typescript
if (isLoading) return <LoadingState variant="skeleton" />;
if (error) return <ErrorState message={error.message} retryAction={refetch} />;
if (!data?.length) return <EmptyState title="No data available" />;
return <ActualContent data={data} />;
```

---

## 6. Implementation Priority

### Phase 1 — Foundation primitives
1. `PageHeader`
2. `SectionHeader`
3. `Card`
4. `KPIBlock`
5. `DenseTable`
6. `ModalShell`
7. `StatusBadge`
8. `EmptyState` / `ErrorState` / `LoadingState`
9. `ActionButton` / `IconButton`

### Phase 2 — Data display components
1. `SparklineCard`
2. `MetricGrid`
3. `ComparisonTable`
4. `HistogramPanel`
5. `HeatmapPanel`
6. `PercentileBandPanel`
7. `DataQualityPanel`
8. `TimelineList`

### Phase 3 — Page-specific composites
1. `PortfolioSnapshotSummary`
2. `CorporateAssumptionsPanel`
3. `MonteCarloRunPanel`
4. `NewsFeedList`
5. Remaining page-specific components

---

## 7. File Naming Convention

```
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
```

All components use PascalCase filenames matching the export name.
All components are client components (`"use client"`) unless they are pure layout wrappers.
