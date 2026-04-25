# MoneyView Design Spec Addendum

> Clarifications to the five core design documents.
> Read alongside: Design Tokens, Component System, Page Wireframes, Interaction Rules, and Chart System.

---

## 1. Definition of Done by Phase

Each phase is **done** only when the feature behavior, state handling, and verification expectations below are all satisfied.

### Phase 1 - Foundations

**Done when:**
- `globals.css` contains the semantic token aliases required by the design-token system without breaking existing variables.
- `PageHeader`, `SectionHeader`, `Card`, `KPIBlock`, `DenseTable`, and `ModalShell` are implemented and exported from `components/ui/`.
- `StatusBadge`, `EmptyState`, `ErrorState`, and `LoadingState` cover their intended variants.
- `ActionButton` and `IconButton` accept the documented props and render correctly.
- New primitives do not introduce raw color values where tokens should be used.
- `npm.cmd run lint` and `npx tsc --noEmit` pass.

### Phase 2 - Core Page Scaffolds

**Done when:**
- Market Overview renders in both card and table view using `SparklineCard` and `DenseTable`-style primitives.
- Portfolio page zones keep analysis, holdings, and allocation concerns separated.
- Corporate page preserves the left assumptions / right diagnostics structure.
- Monte Carlo sub-tabs share a consistent input/result framing model.
- News Feed typography follows the design-token scale for headline and metadata text.
- All five pages cover loading, empty, and error states.
- `npm.cmd run lint`, `npx tsc --noEmit`, and `npm.cmd run build` pass.

### Phase 3 - Deep Components

**Done when:**
- `PortfolioSnapshotSummary` shows as-of date, version, benchmark, universe, and control actions correctly.
- `PortfolioAllocationEditor` supports row-level editing, normalization, and apply actions.
- `CorporateAssumptionsPanel` renders sliders, selectors, refresh state, and last-updated context.
- `CorporateComparisonTable` sorts and filters correctly.
- `MetricQualityBadge` and `MetricAuditPanel` expose audit-qualified metric state without redefining backend meaning.
- `HistogramPanel`, `HeatmapPanel`, and `PercentileBandPanel` use shared chart config and tokenized color rules.
- Tests exist for components that own non-trivial local state.
- `npm.cmd run lint`, `npx tsc --noEmit`, and `npm.cmd run build` pass.

### Phase 4 - Modal Depth

**Done when:**
- `StockDetailModal` opens from Portfolio holdings with OHLCV, metric cards, audit context, snapshot context, history, and news sections.
- `CalculationDetailModal` opens from Corporate KPI or chart actions and shows formula, result, data lineage, supporting rows, and export affordances where relevant.
- `SnapshotHistoryModal` opens from Portfolio snapshot summary and preserves snapshot review context.
- Modal drill-downs remain accessible, dismissible, and independently scrollable.
- Modal content handles loading, empty, and error states internally.
- `npm.cmd run lint`, `npx tsc --noEmit`, and `npm.cmd run build` pass.

### Phase 5 - Polish

**Done when:**
- Every major data section has consistent loading, empty, error, and stale or warning treatment where applicable.
- Monte Carlo chart panels use explicit guard-driven states instead of silent blank renders.
- Typography and spacing no longer rely on ad hoc raw values where tokens should exist.
- Shared tooltip and axis rules are applied consistently.
- Responsive layout is verified at 375px, 768px, and 1280px without broken grids or hidden critical data.
- Accessibility issues for keyboard navigation and aria labeling are resolved.
- `npm.cmd run lint`, `npx tsc --noEmit`, and `npm.cmd run build` pass clean.

---

## 2. Migration Strategy

The migration to the token-based component system remains a **non-destructive additive approach**:

- existing CSS variables in `globals.css` are preserved while semantic aliases are added
- new components target semantic tokens from the start
- touched components are migrated as part of the same feature or bug-fix change
- legacy aliases are only removed after references have been eliminated

This avoids a big-bang refactor and keeps the build green while feature work continues.

---

## 3. Token Adoption Policy

### 3.1 What tokens govern

All of the following should come from a token or documented design variable:

| Category | Covered by Tokens |
|---|---|
| Colors | Backgrounds, text, borders, state colors, chart colors |
| Spacing | Margin, padding, and gap values tied to the scale |
| Border radius | All radius values |
| Border width and color | Border shorthand and individual properties |
| Shadow | Box-shadow values |
| Typography | Font size, weight, and line-height |
| Motion | Transition duration and easing |

### 3.2 What is exempt

- Computed chart geometry that must remain numeric
- SVG attribute cases that cannot use CSS variables cleanly
- Small sizing arithmetic inside chart wrappers

### 3.3 Enforcement

- Raw hex values or ad hoc spacing in component code should be flagged in review unless there is a justified exception.
- Audit and warning states must use consistent token-backed semantics rather than one-off color decisions.

### 3.4 Adoption order

1. New components use tokens immediately.
2. Modified components migrate touched values in the same change.
3. Untouched components wait for deliberate cleanup.

---

## 4. Modal vs. Route Principles

MoneyView uses both page routes and modal drill-downs. They serve different jobs.

### Use a modal when:

- the content is a depth layer on top of the current page
- the user needs to return to the same workflow state after closing
- the content is short to medium depth
- the trigger comes from a card, row, KPI, or chart inside a page

Examples:
- Stock Detail Modal
- Calculation Detail Modal
- Snapshot History Modal

### Use a route when:

- the content is a standalone destination
- the user may want URL sharing or browser history semantics
- the surface is deep enough to justify a full page

Examples:
- `/detail/[ticker]`
- `/corporate`
- `/portfolio`

### Coexistence rule

`/detail/[ticker]` remains the canonical deep-detail destination. The Stock Detail Modal is a workflow-preserving subset, not a replacement for the route.

---

## 5. Scope of Responsive Support

### 5.1 Supported breakpoints

| Tier | Width | Target devices |
|---|---|---|
| Mobile | `375px - 767px` | Phone portrait |
| Tablet | `768px - 1023px` | Tablet, phone landscape |
| Desktop | `1024px - 1440px` | Laptop, standard desktop |
| Wide | `> 1440px` | Large monitor |

MoneyView remains **desktop-primary**. Corporate, Portfolio, and Monte Carlo are expected to degrade gracefully on smaller screens rather than matching desktop density.

### 5.2 Per-tab responsive scope

| Tab | Mobile | Tablet | Desktop | Wide |
|---|---|---|---|---|
| Market Overview | Single-column card stack | 2-column grid | 3-4 column grid | Wider grid with max-width |
| Portfolio | Stacked zones | Stacked zones | Stacked zones with wider cards | Max-width centered |
| Corporate | Stacked panels, usable not optimal | Stacked panels | 35/65 split | Wider diagnostics board |
| Monte Carlo | Stacked input/result, usable not optimal | Stacked or 40/60 | 40/60 split | 35/65 split |
| News Feed | Single column | Centered column | Centered max-width column | Same with wider cap |

### 5.3 Responsive rules

1. No horizontal viewport overflow.
2. Sidebar collapses on mobile and tablet.
3. Modals use a constrained viewport-width calculation on mobile.
4. Dense data tables may scroll horizontally instead of silently dropping columns.
5. Charts use measured responsive wrappers with fixed or minimum heights.
6. Critical controls and results must remain readable at 375px.

### 5.4 Out of scope

- Native mobile apps
- PWA installability
- Full offline support
- Touch-optimized chart gestures beyond the chart library defaults
- Print-specific stylesheet design

---

## 6. Current Alignment Additions

These clarifications should remain aligned with the architecture docs and live UI:

- audit-qualified metric displays belong in the design system now, not as one-off Corporate or Portfolio exceptions
- `MetricQualityBadge` is the compact surface for quality state at the point of interpretation
- `MetricAuditPanel` is the modal-level surface for inputs, warnings, and calculation lineage
- Monte Carlo chart sections must use guard-driven rendering when normalized worker output is incomplete or malformed
- blank chart shells are considered a product-design failure, not a harmless fallback
