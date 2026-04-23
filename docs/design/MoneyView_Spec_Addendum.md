# MoneyView Design Spec — Addendum

> Clarifications to the five core design documents.
> Read alongside: Design Tokens, Component System, Page Wireframes, Interaction Rules, Chart System.

---

## 1. Definition of Done by Phase

Each phase is **done** when all conditions below are met. No phase is considered complete while a lint error, TypeScript error, or broken build remains.

---

### Phase 1 — Foundations

**Done when:**
- `globals.css` contains all semantic token aliases listed in Design Tokens §8 without removing any existing variable
- `PageHeader`, `SectionHeader`, `Card`, `KPIBlock`, `DenseTable`, `ModalShell` are implemented and exported from `components/ui/`
- `StatusBadge`, `EmptyState`, `ErrorState`, `LoadingState` are implemented with all variant states
- `ActionButton` and `IconButton` accept all specified props and render correctly
- All new components have no inline color values — all colors come from CSS token variables
- `npm run lint` and `npx tsc --noEmit` pass with zero errors

---

### Phase 2 — Core Page Scaffolds

**Done when:**
- Market Overview renders in both Card and Table view using `SparklineCard` and `DenseTable` primitives
- Portfolio page zones (Analysis, Holdings, Allocation) each use their designated section component boundary — no layout logic embedded inside data-fetch components
- Corporate page shows the 35/65 left/right split with `AssumptionsPanel` on the left and `DiagnosticsBoard` on the right
- Monte Carlo sub-tabs share a common layout wrapper with consistent input-left / result-right structure
- News Feed card list uses `type.body` and `type.caption` tokens for headline and metadata text
- All five pages pass targeted component tests for loading, empty, and error states
- `npm run lint`, `npx tsc --noEmit`, and `npm run build` pass

---

### Phase 3 — Deep Components

**Done when:**
- `PortfolioSnapshotSummary` correctly shows as-of date, version, benchmark, universe, and all control buttons
- `PortfolioAllocationEditor` allows per-row weight editing, normalize action, and apply action with optimistic UI
- `CorporateAssumptionsPanel` renders all sliders and selectors, with refresh state badge and last-updated timestamp
- `CorporateComparisonTable` sorts, filters by universe, and routes to Portfolio correctly
- `HistogramPanel`, `HeatmapPanel`, `PercentileBandPanel` render with the shared chart config constants and correct color tokens
- All new charts handle empty, loading, and error states without crashing
- Tests added for any component that owns non-trivial local state (e.g., weight editing, sort order)
- `npm run lint`, `npx tsc --noEmit`, and `npm run build` pass

---

### Phase 4 — Modal Depth

**Done when:**
- `Stock Detail Modal` opens from Portfolio holdings with OHLCV chart, metric cards, snapshot context, history, and news sections
- `Calculation Detail Modal` opens from any Corporate KPI or chart click, displaying formula, result, data lineage, supporting rows, and CSV export buttons
- `Snapshot History Modal` opens from Portfolio snapshot summary, groups saved versions by date, and locks benchmark/universe context when a version is under review
- All three modals are accessible: focus-trapped, Escape-dismissible, and backdrop-clickable to close
- All three modals handle loading and error states internally
- `npm run lint`, `npx tsc --noEmit`, and `npm run build` pass

---

### Phase 5 — Polish

**Done when:**
- Every data section across all five pages has a consistent loading skeleton, empty state, error state, and stale badge where applicable
- Spacing audit confirms no section uses ad-hoc pixel values instead of token variables
- Typography audit confirms no section uses raw font sizes not from the type scale
- All chart tooltips use the shared `TOOLTIP_STYLE` config
- All chart axis labels use `type.caption` sizing (11px)
- Responsive layout tested at 375px (mobile), 768px (tablet), and 1280px (desktop) — no overflow, no broken grids
- No accessibility violations for keyboard navigation or missing aria labels
- `npm run lint`, `npx tsc --noEmit`, and `npm run build` pass clean

---

## 2. Migration Strategy

The migration from the current codebase to the token-based component system follows a **non-destructive additive approach**: all existing CSS variables in `globals.css` are preserved unchanged, and semantic aliases are added alongside them in a single commit so no existing component breaks. New components are built exclusively against semantic token names from day one. Existing components are migrated opportunistically — when a component is touched for a feature change or bug fix, its inline color values and spacing are updated to use tokens as part of that same change, not as a separate pass. This means the codebase will have a mixed state during Phases 1–3, where some components use `var(--border)` and others use `var(--border-default)`, both pointing to the same underlying value. A final token cleanup pass in Phase 5 resolves all aliases and removes the legacy variable names once no component references them. This strategy avoids a big-bang refactor, keeps `npm run build` green throughout, and allows feature work to continue in parallel with the migration.

---

## 3. Token Adoption Policy

### What tokens govern
All of the following must come from a CSS token variable. No raw values are permitted:

| Category | Covered by Tokens |
|---|---|
| Colors | All backgrounds, text, borders, state, chart colors |
| Spacing | All margin, padding, gap values that map to the 8-step scale |
| Border radius | All `border-radius` values |
| Border width and color | All `border` shorthand or individual properties |
| Shadow | All `box-shadow` values |
| Font size, weight, line-height | All typographic properties |
| Transition duration and easing | All `transition` properties |

### What is exempt

- Chart computed values (e.g., Recharts `cx`, `cy`, `r` geometry) that require numbers, not strings
- SVG attribute values that cannot accept CSS variables (e.g., some `stroke-width` attributes in SVG elements)
- One-off pixel nudges inside `ResponsiveContainer` or `ResponsiveChart` for sizing arithmetic

### Enforcement

- Component PRs that introduce a raw hex color or non-token spacing value will be flagged in code review
- The phrase `"#` in component files is a signal to check whether a token exists
- The phrase `px` for padding/margin outside of the size arithmetic exemption is a signal to check the spacing scale

### Adoption order

1. New components: use tokens from the first line of code
2. Modified components: migrate all touched values as part of the change
3. Untouched components: leave until Phase 5 cleanup pass

---

## 4. Modal vs. Route Principles

MoneyView currently has a `/detail/[ticker]` route and several modal use cases. This section defines when to use each pattern.

### Use a Modal when:
- The content is a **depth layer** on top of the current page — the user needs to return to the same page state after closing
- The context is **triggered by a table row or card click** within a page
- The content is **short to medium depth** (KPIs, a chart, a few sections)
- The user is **in the middle of a workflow** (e.g., reviewing portfolio allocations, then opening a stock detail)
- Example: Stock Detail Modal, Calculation Detail Modal, Snapshot History Modal

### Use a Route when:
- The content is a **standalone destination** that makes sense as a browser-navigable URL
- The content is **deep** (full page of charts, multiple tabs, rich interaction)
- The user may want to **share a link** to the specific view
- **Bookmark or back-button behavior** is expected
- Example: `/detail/[ticker]` page, `/corporate`, `/portfolio`

### Current position: coexistence policy

The `/detail/[ticker]` route **stays** as the canonical deep-detail destination. It is not replaced by a modal.

The **Stock Detail Modal** is a lighter surface — a subset of the full detail route content — that opens from within Portfolio holdings. Its purpose is to give the user quick context without abandoning the Portfolio page. It does not need to be feature-equivalent to the route.

**Cross-reference contract:**
- Stock Detail Modal may include a "View Full Detail" link that navigates to `/detail/[ticker]`
- The route `/detail/[ticker]` remains independently accessible from the sidebar or any direct link
- No modal should attempt to replicate the full route; if it needs route-level depth, link to the route instead

### Rule summary

| Signal | Pattern |
|---|---|
| Triggered by row/card click on same page | Modal |
| Needs back-button / URL sharing | Route |
| Stays in current workflow context | Modal |
| Full analytical surface with multiple sub-sections | Route |
| Subset of detail for quick review | Modal with "View Full" link |

---

## 5. Scope of Responsive Support

### Supported breakpoints

| Tier | Width | Target devices |
|---|---|---|
| Mobile | `375px – 767px` | Phone portrait |
| Tablet | `768px – 1023px` | Tablet, phone landscape |
| Desktop | `1024px – 1440px` | Laptop, standard desktop |
| Wide | `> 1440px` | Large monitor |

MoneyView is **desktop-primary**. The analytical density of the Corporate, Portfolio, and Monte Carlo tabs is designed for a wide viewport. Mobile support is a **graceful degradation** target, not a co-equal design mode.

### Per-tab responsive scope

| Tab | Mobile | Tablet | Desktop | Wide |
|---|---|---|---|---|
| Market Overview | ✅ Single-column card stack | ✅ 2-column grid | ✅ 3–4 column grid | ✅ 4-column grid with max-width |
| Portfolio | ✅ Stacked zones, full-width | ✅ Stacked zones | ✅ Stacked zones, wider cards | ✅ Max-width centered |
| Corporate | ⚠️ Stacked panels (usable, not optimal) | ⚠️ Stacked panels | ✅ 35/65 side-by-side split | ✅ 30/70 split with wider board |
| Monte Carlo | ⚠️ Stacked input/result (usable) | ⚠️ Stacked or 40/60 | ✅ 40/60 side-by-side | ✅ 35/65 |
| News Feed | ✅ Single column, natural | ✅ Centered column | ✅ Centered max-width column | ✅ Same, max-width capped |

**⚠️ Usable but not optimal** means: the layout stacks correctly and no content overflows, but the dense analytical workflow is not optimized for small screens. This is acceptable — MoneyView is not a mobile trading app.

### Responsive rules

1. **No horizontal overflow** at any breakpoint. All content must fit within the viewport width.
2. **Sidebar** collapses to hamburger on mobile and tablet; fixed on desktop.
3. **Modals** use `calc(100vw - 16px)` width on mobile, constrained max-width on desktop.
4. **DenseTable** on mobile: allow horizontal scroll within the table container rather than collapsing columns. Never hide financial data columns silently.
5. **Charts** use `ResponsiveContainer` with percentage width. Fixed heights are permitted.
6. **Minimum width target**: `375px`. Content must be usable (not just non-overflowing) at this width for Market Overview and News Feed. For Corporate and Monte Carlo, usable means "the user can interact with inputs and read output" even if the layout is suboptimal.

### Out of scope

- Native mobile app (iOS/Android)
- Progressive Web App installability
- Offline mode
- Touch-optimized gestures (pinch-zoom on charts, swipe navigation)
- Print stylesheets
