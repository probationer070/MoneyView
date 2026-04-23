# MoneyView Interaction Rules

> Interaction patterns, state visibility rules, progressive disclosure, and input philosophy for the MoneyView frontend.

---

## 1. Explicit Refresh Model

MoneyView does **not** auto-run heavy analysis on page mount. This is a core design decision that applies across Corporate, Portfolio, and Monte Carlo.

### 1.1 Refresh Zones

| Tab | Refresh Zone | Trigger |
|---|---|---|
| Corporate | DCF calculation | User clicks `Refresh DCF` |
| Corporate | Source data (statements, price) | User clicks `Refresh Source Data` |
| Corporate | Peer comparison | User clicks `Refresh Comparison` |
| Portfolio | Attribution analysis | User clicks `Refresh Analysis` |
| Portfolio | Snapshot save | User clicks `Save Current As Snapshot` |
| Monte Carlo | Path simulation | User clicks `Run Path Simulation` |
| Monte Carlo | Corporate valuation | User clicks `Run Valuation` |
| Monte Carlo | Correlation analysis | User clicks `Run Correlation Analysis` |
| Market Overview | Market data | SSR on page load; no manual refresh needed |
| News Feed | Article feed | Initial load + infinite scroll |

### 1.2 Stale State Visibility

When cached data is older than the current session or a user-defined threshold:

- Show a `StatusBadge` with `stale` status next to the refresh control
- Display the last-updated timestamp in `type.caption` / `text.muted`
- Never silently serve stale data as if it were current
- The refresh button remains always visible, not hidden behind a menu

### 1.3 Idle-First Behavior

On first visit to Corporate or Monte Carlo with no prior data:

- Show an `idle` status badge: "No analysis run yet"
- Display the input controls in their default state
- Output zones show `EmptyState` with a prompt to run the first analysis
- Do not auto-fetch heavy computations

---

## 2. State Visibility System

Every data-displaying section must handle these states. Each state has a defined visual treatment:

| State | Visual | Component |
|---|---|---|
| **loading** | Skeleton pulse or spinner | `LoadingState` |
| **stale** | Amber badge + timestamp | `StatusBadge(stale)` + caption |
| **idle** | Muted badge + empty prompt | `StatusBadge(idle)` + `EmptyState` |
| **unavailable** | Disabled badge + explanation | `StatusBadge(unavailable)` + message |
| **empty** | Icon + title + optional action | `EmptyState` |
| **error** | Red border or badge + retry | `ErrorState` |
| **in-progress** | Progress bar + cancel option | `LoadingState(progress)` + cancel button |
| **canceled** | Warning badge + partial result note | `StatusBadge(canceled)` |
| **saved** | Confirmation badge (brief) | `StatusBadge(saved)` — auto-dismiss after 3s |

### 2.1 State Priority

When multiple states overlap, show the highest-priority one:

```
error > in-progress > loading > stale > idle > saved > empty > unavailable
```

### 2.2 Tab-Specific State Examples

**Portfolio**:
- `Portfolio Data Unavailable` — API unreachable
- `No Holdings Yet` — empty watchlist
- `Attribution Pending Portfolio` — no weights assigned
- `Allocation Weights Exceed 100%` — validation warning
- `Snapshot History Unavailable` — no saved snapshots

**Corporate**:
- `No company selected` — idle, no ticker
- `Source data stale` — cached data older than session
- `DCF calculation failed` — error from backend

**Monte Carlo**:
- `Simulation running... 43%` — in-progress with progress bar
- `Simulation canceled` — user stopped mid-run
- `No simulation results` — idle, never run

---

## 3. Progressive Disclosure

Use three depth levels to manage information density:

### Level 1 — Summary View (default page state)

| Content Type | Examples |
|---|---|
| KPI cards | Portfolio Return, ROIC-WACC, VaR |
| Badges | Delta percentages, status indicators |
| Sparklines | Compact trend cues |
| Top-line outputs | Current value, active experiment type |

**Rule**: Level 1 must be scannable in under 3 seconds.

### Level 2 — Analytical View (expanded sections, same page)

| Content Type | Examples |
|---|---|
| Tables | Holdings grid, peer comparison, indicator grids |
| Charts | Waterfall, donut, diagnostic graphs, histograms |
| Matrices | Correlation matrix, value-driver matrix |
| Comparisons | Multi-ticker metric tables |

**Rule**: Level 2 is visible by scrolling or toggling a view mode. No navigation required.

### Level 3 — Audit View (modals)

| Content Type | Examples |
|---|---|
| Raw data rows | Supporting calculation rows, raw datasets |
| Formula lineage | Step-by-step calculation explanation |
| Data provenance | Source → transform → output chain |
| Export actions | CSV downloads, PNG chart exports |

**Rule**: Level 3 is accessed through modal clicks on KPIs, chart elements, or dedicated "detail" buttons. Never force audit-level detail into the main page flow.

---

## 4. Input Philosophy

For dense analytical control surfaces (Corporate assumptions, Monte Carlo inputs, allocation editor):

### 4.1 Label Rules
- Labels are **always visible** — never placeholder-only
- Labels use `type.label` in `text.secondary`
- Current value is always legible next to or below the label

### 4.2 Helper Text Rules
- Helper text is **minimal** — one short phrase if needed
- Shown below the input in `type.helper` / `text.muted`
- Not used as the primary label

### 4.3 Grouping Rules
- Related parameters are grouped tightly (e.g., Growth Basis + Growth Rate + Growth Year)
- Groups separated by `space.5` (24px) vertical gap
- Within groups, fields separated by `space.3` (12px)

### 4.4 Destructive Action Separation
- Destructive actions (delete holding, reset assumptions) are visually separated from primary actions
- Use `variant="danger"` or place at the bottom of the control area
- Require confirmation for irreversible actions

### 4.5 Slider Conventions
- Sliders show the current numeric value at all times
- Value label positioned to the right of the slider track
- Slider range should reflect realistic financial ranges
- Slider step granularity: 0.1% for rates, 0.01 for ratios

---

## 5. Navigation and Drill-Down Rules

### 5.1 Click-to-Detail Contract

| Source | Target | Method |
|---|---|---|
| Market card / table row | Market Detail Modal | `ModalShell` |
| Portfolio holding card / row | Stock Detail Modal | `ModalShell` |
| Corporate KPI card | Calculation Detail Modal | `ModalShell` |
| Corporate diagnostic chart | Calculation Detail Modal | `ModalShell` |
| Portfolio snapshot summary | Snapshot History Modal | `ModalShell` |
| News card | External URL | New tab (`target="_blank"`) |

### 5.2 Modal Behavior Rules
- Modals **do not** navigate away from the current page
- Modals are dismissible via close button, Escape key, or backdrop click
- Modal content scrolls independently; page scroll is locked
- Modal state is **not** persisted in URL (no query params for modal)
- Opening a modal does not trigger a re-fetch of the parent page data

### 5.3 Cross-Tab Navigation
- Corporate → Portfolio: `Open Portfolio Testing` button in comparison zone
- Portfolio → Corporate: no direct link (separate analysis contexts)
- All tabs are accessible via sidebar; no sequential tab flow is enforced

---

## 6. Loading and Transition Patterns

### 6.1 Skeleton Loading
- Use skeleton loading for initial page data (SSR miss or client fetch)
- Skeleton matches the shape of the target content (card-shaped, table-row-shaped)
- Skeleton uses `--bg-subtle` with pulse animation

### 6.2 Progress Loading
- Use progress bar for long-running computations (Monte Carlo, DCF)
- Show numeric percentage when available
- Always pair with a visible cancel button
- Progress bar uses `--state-info` fill on `--bg-subtle` track

### 6.3 Optimistic Updates
- Watchlist add/delete: optimistic UI with rollback on error
- Allocation weight save: optimistic badge, confirmed on API success
- Snapshot save: show saving state, then success confirmation

### 6.4 Transition Timing
- Modal open/close: `350ms` (`duration.slow`)
- View toggle (chart ↔ table): `200ms` (`duration.normal`)
- Sidebar slide: `200ms` (`duration.normal`)
- Button state change: `100ms` (`duration.fast`)

---

## 7. Responsive Behavior

### 7.1 Breakpoints

| Name | Width | Layout Change |
|---|---|---|
| Mobile | `< 768px` | Single column, hamburger sidebar |
| Tablet | `768px – 1023px` | Single column, collapsible sidebar |
| Desktop | `≥ 1024px` | Fixed sidebar, multi-column layouts |

### 7.2 Per-Tab Responsive Rules

| Tab | Mobile | Desktop |
|---|---|---|
| Market Overview | Single-column card stack | 3–4 column card grid |
| Portfolio | Stacked zones | Stacked zones (already vertical) |
| Corporate | Stacked left/right panels | Side-by-side 35/65 split |
| Monte Carlo | Stacked input/result | Side-by-side or stacked per sub-tab |
| News | Single column (natural) | Centered max-width column |

### 7.3 Modal Responsive Rules
- Desktop: centered overlay with max-width constraints
- Mobile: full-width, bottom-anchored or full-screen modal
- Modal size `full` takes `calc(100vw - 16px)` on mobile

---

## 8. Accessibility Rules

- All interactive elements have unique `id` attributes
- All buttons have `aria-label` when icon-only
- Sidebar toggle uses `aria-expanded` and `aria-controls`
- Color is never the only means of conveying state (pair with icons or text)
- Focus order follows visual reading order
- Modal traps focus within its content area
- Escape key dismisses modals and popovers
- Delta colors are paired with `▲`/`▼` arrows for colorblind accessibility
