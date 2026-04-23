# MoneyView Design Tokens

> Canonical token reference for the MoneyView frontend design system.
> All tokens map to CSS custom properties defined in `apps/web/app/globals.css`.

---

## 1. Design Philosophy

MoneyView follows a **white-surface, Rams-inspired** visual language:

- **Hierarchy through typography**, not color saturation
- **Emphasis through spacing and alignment**, not elevation or shadow
- **Positive/negative state through deliberate accent colors**, not decoration
- **Chart clarity through restrained palettes**, not rainbow gradients

The existing `globals.css` establishes a muted green-white palette with red-up / blue-down delta convention. This spec formalizes and extends those tokens into a complete system.

---

## 2. Color Tokens

### 2.1 Background

| Token | CSS Variable | Value | Usage |
|---|---|---|---|
| `bg.canvas` | `--bg-canvas` | `#FBFBFB` | Page-level background (maps to existing `--bg-primary`) |
| `bg.subtle` | `--bg-subtle` | `#F3F5EF` | Recessed zones, sidebar background (maps to existing `--surface-muted`) |
| `bg.surface` | `--bg-surface` | `#FFFFFF` | Cards, panels, modals (maps to existing `--surface-panel`) |
| `bg.elevated` | `--bg-elevated` | `#FFFFFF` | Modal overlays, popovers (same as surface, differentiated by shadow) |
| `bg.sidebar` | `--bg-sidebar` | `#E0E4D6` | Sidebar background (maps to existing `--bg-secondary`) |

### 2.2 Text

| Token | CSS Variable | Value | Usage |
|---|---|---|---|
| `text.primary` | `--text-primary` | `#444444` | Body text, headings, KPI values |
| `text.secondary` | `--text-secondary` | `#6B7370` | Subtitles, helper labels, secondary info |
| `text.muted` | `--text-muted` | `#9DA5A2` | Timestamps, source labels, metadata |
| `text.disabled` | `--text-disabled` | `#C4C9C6` | Inactive controls, disabled labels |
| `text.inverse` | `--text-inverse` | `#FFFFFF` | Text on active sidebar items, filled buttons |

### 2.3 Border

| Token | CSS Variable | Value | Usage |
|---|---|---|---|
| `border.default` | `--border-default` | `#B6CCBB` | Card borders, section dividers (maps to existing `--border`) |
| `border.soft` | `--border-soft` | `#E0E4D6` | Subtle separators, inner dividers |
| `border.strong` | `--border-strong` | `#9DA5A2` | Focused inputs, active states |
| `border.accent` | `--border-accent` | `#60CAAD` | Today-highlight, active selection borders |

### 2.4 State Colors

| Token | CSS Variable | Value | Usage |
|---|---|---|---|
| `state.positive` | `--state-positive` | `#E54545` | Price up, positive delta, value creation (maps to `--delta-up`) |
| `state.negative` | `--state-negative` | `#4589E5` | Price down, negative delta, value destruction (maps to `--delta-down`) |
| `state.warning` | `--state-warning` | `#E5A545` | Stale data, threshold breach, caution |
| `state.info` | `--state-info` | `#60CAAD` | Informational hints, active surface accent |
| `state.success` | `--state-success` | `#4BAF6E` | Completed operations, saved confirmations |
| `state.error` | `--state-error` | `#D93025` | Failed operations, critical errors |

> **Delta convention**: Red = price up, Blue = price down. This follows Korean market convention and is intentional. Do not invert.

### 2.5 Chart Palette

| Token | CSS Variable | Value | Usage |
|---|---|---|---|
| `chart.primary` | `--chart-primary` | `#39F1C0` | Primary series, lead line (maps to `--chart-1`) |
| `chart.secondary` | `--chart-secondary` | `#60CAAD` | Secondary series, comparison line (maps to `--chart-2`) |
| `chart.tertiary` | `--chart-tertiary` | `#B6CCBB` | Tertiary series, grid emphasis (maps to `--chart-3`) |
| `chart.muted` | `--chart-muted` | `#E0E4D6` | Background fills, area shading (maps to `--chart-4`) |
| `chart.label` | `--chart-label` | `#9DA5A2` | Axis labels, tick marks (maps to `--chart-5`) |
| `chart.ink` | `--chart-ink` | `#444444` | Annotation text, reference lines (maps to `--chart-6`) |
| `chart.grid` | `--chart-grid` | `#F0F2EC` | Gridlines, guide rules |
| `chart.positive` | `--chart-positive` | `#E54545` | Up candles, gain bars |
| `chart.negative` | `--chart-negative` | `#4589E5` | Down candles, loss bars |

#### Heat Scale (for heatmaps, correlation matrices)

| Token | CSS Variable | Value |
|---|---|---|
| `chart.heat.1` | `--chart-heat-1` | `#4589E5` |
| `chart.heat.2` | `--chart-heat-2` | `#89B5E5` |
| `chart.heat.3` | `--chart-heat-3` | `#C4D9F2` |
| `chart.heat.4` | `--chart-heat-4` | `#F0F2EC` |
| `chart.heat.5` | `--chart-heat-5` | `#F2D9C4` |
| `chart.heat.6` | `--chart-heat-6` | `#E5A589` |
| `chart.heat.7` | `--chart-heat-7` | `#E54545` |

---

## 3. Typography Tokens

Font family: **Inter** (loaded via `next/font/google`, assigned to `--font-inter`).

### 3.1 Type Scale

| Token | CSS Variable | Size | Weight | Line Height | Letter Spacing | Usage |
|---|---|---|---|---|---|---|
| `type.display.xl` | `--type-display-xl` | `36px` | `700` | `1.15` | `-0.02em` | Hero headings (rarely used) |
| `type.page.title` | `--type-page-title` | `28px` | `700` | `1.2` | `-0.015em` | Page headers (h1) |
| `type.section.title` | `--type-section-title` | `20px` | `600` | `1.3` | `-0.01em` | Section headers (h2) |
| `type.card.title` | `--type-card-title` | `15px` | `600` | `1.4` | `0` | Card headers, panel titles |
| `type.metric.value.lg` | `--type-metric-lg` | `28px` | `700` | `1.1` | `-0.015em` | Large KPI values |
| `type.metric.value.md` | `--type-metric-md` | `20px` | `600` | `1.2` | `-0.01em` | Medium KPI values, inline metrics |
| `type.label` | `--type-label` | `13px` | `500` | `1.4` | `0.01em` | Form labels, KPI labels, badges |
| `type.body` | `--type-body` | `14px` | `400` | `1.6` | `0` | Default body text |
| `type.table.header` | `--type-table-header` | `12px` | `600` | `1.4` | `0.03em` | Table column headers |
| `type.table.body` | `--type-table-body` | `13px` | `400` | `1.4` | `0` | Table cell text |
| `type.helper` | `--type-helper` | `12px` | `400` | `1.5` | `0` | Helper text, tooltips |
| `type.caption` | `--type-caption` | `11px` | `400` | `1.4` | `0.02em` | Footnotes, timestamps, metadata |

### 3.2 Typography Rules

1. **Typography carries hierarchy more than color.** Size and weight differences must be visually obvious between levels.
2. **Numeric values use `font-variant-numeric: tabular-nums`** for proper column alignment in tables and KPI displays.
3. **Metric values are always right-aligned** in table columns and left-aligned in KPI cards.
4. **Table headers use uppercase sparingly** — only in dense data tables, not in card titles.
5. **Line height is tighter for metrics** (1.1–1.2) and looser for reading text (1.5–1.6).

---

## 4. Spacing Tokens

Geometric 4px-base scale:

| Token | CSS Variable | Value | Usage |
|---|---|---|---|
| `space.1` | `--space-1` | `4px` | Inline gaps, icon-to-label spacing |
| `space.2` | `--space-2` | `8px` | Tight element gaps, badge padding |
| `space.3` | `--space-3` | `12px` | Form field gaps, inner card padding |
| `space.4` | `--space-4` | `16px` | Standard card padding, column gaps |
| `space.5` | `--space-5` | `24px` | Section gaps, card-to-card spacing |
| `space.6` | `--space-6` | `32px` | Zone separators, panel margins |
| `space.7` | `--space-7` | `48px` | Major zone transitions |
| `space.8` | `--space-8` | `64px` | Page outer margins (desktop only) |

### 4.1 Contextual Spacing Rules

| Context | Token |
|---|---|
| Page outer padding (mobile) | `space.4` (16px) |
| Page outer padding (desktop) | `space.8` (64px) |
| Card internal padding | `space.4` to `space.5` |
| Section gap (between cards) | `space.5` to `space.6` |
| Modal internal padding | `space.5` to `space.6` |
| Dense table row height | `40px` minimum |
| Standard table row height | `48px` |
| Input control height | `36px` |
| Button height | `36px` standard, `32px` compact |

---

## 5. Shape Tokens

### 5.1 Border Radius

| Token | CSS Variable | Value | Usage |
|---|---|---|---|
| `radius.sm` | `--radius-sm` | `4px` | Badges, small buttons, inline tags |
| `radius.md` | `--radius-md` | `8px` | Cards, inputs, standard buttons (maps to existing `--radius: 0.5rem`) |
| `radius.lg` | `--radius-lg` | `12px` | Modals, large panels |

Cards should be square or lightly rounded. Avoid playful roundness (`16px+`). The design language is analytical, not consumer-app.

### 5.2 Border Thickness

| Context | Value |
|---|---|
| Card border | `1px solid var(--border-default)` |
| Divider | `1px solid var(--border-soft)` |
| Active input | `1.5px solid var(--border-strong)` |
| Today-highlight left border | `3px solid var(--border-accent)` |

---

## 6. Shadow Policy

| Context | Shadow | Rationale |
|---|---|---|
| Default cards | `none` | Emphasis comes from border and spacing, not elevation |
| Hover cards | `0 1px 3px rgba(0,0,0,0.04)` | Subtle lift cue only |
| Modal overlay | `0 4px 24px rgba(0,0,0,0.08)` | Very soft, distinguishes from page layer |
| Dropdown / popover | `0 2px 12px rgba(0,0,0,0.06)` | Light float above surface |
| Sidebar (mobile) | `4px 0 24px rgba(0,0,0,0.08)` | Edge shadow for slide-in |

MoneyView uses a **flat design with minimal shadow**. Depth is communicated through border weight, background tone, and spacing — not elevation stacking.

---

## 7. Motion Tokens

| Token | Value | Usage |
|---|---|---|
| `duration.fast` | `100ms` | Button state changes, toggle switches |
| `duration.normal` | `200ms` | Card hover, sidebar transitions |
| `duration.slow` | `350ms` | Modal open/close, page transitions |
| `easing.default` | `cubic-bezier(0.4, 0, 0.2, 1)` | Standard ease |
| `easing.enter` | `cubic-bezier(0, 0, 0.2, 1)` | Elements appearing |
| `easing.exit` | `cubic-bezier(0.4, 0, 1, 1)` | Elements disappearing |

---

## 8. Migration from Current globals.css

The current `globals.css` defines 19 CSS variables. This spec preserves all existing variable names for backward compatibility and introduces new semantic aliases:

| Current Variable | New Semantic Token | Action |
|---|---|---|
| `--bg-primary` | `--bg-canvas` | Alias (keep both) |
| `--bg-secondary` | `--bg-sidebar` | Alias |
| `--accent` | `--state-info` | Alias |
| `--text-primary` | (unchanged) | Keep |
| `--text-muted` | (unchanged) | Keep |
| `--border` | `--border-default` | Alias |
| `--surface` | `--chart-secondary` / `--state-info` | Split by context |
| `--surface-panel` | `--bg-surface` | Alias |
| `--surface-muted` | `--bg-subtle` | Alias |
| `--chart-1` … `--chart-6` | `--chart-primary` … `--chart-ink` | Alias |
| `--delta-up` | `--state-positive` | Alias |
| `--delta-down` | `--state-negative` | Alias |
| `--radius` | `--radius-md` | Alias |

Do not remove existing variable names in Phase 1. Add semantic aliases alongside them. Migrate component references gradually.

---

## 9. Dark Mode Preparedness

The current system is light-only. When dark mode is added later:

- `--bg-canvas` → `#1A1A1A`
- `--bg-surface` → `#242424`
- `--text-primary` → `#E8E8E8`
- Chart and state colors remain unchanged (designed for both contexts)
- Toggle via `[data-theme="dark"]` or `prefers-color-scheme` media query

No dark mode implementation is needed now. The token structure supports it without restructuring.
