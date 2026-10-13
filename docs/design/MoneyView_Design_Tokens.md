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

Font families (SIL OFL 1.1, vendored in `apps/web/app/fonts/`, loaded via `next/font/local`): **Host Grotesk** for Latin (`--font-host-grotesk`), **Pretendard** for Hangul (`--font-pretendard`), **Geist Mono** for figures (`--font-geist-mono`). `--font-family-sans` and `--font-family-mono` stack them; see the generated token table at the end of this file.

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

## Generated token table

<!-- tokens:generated:start -->
<!-- GENERATED by apps/web/scripts/build-tokens.mjs from tokens/moneyview.tokens.json. Do not edit. -->
| Token | CSS variable | Value | Notes |
|---|---|---|---|
| `bg` | `--bg` | `#ffffff` | Page ground. |
| `bg.canvas` | `--bg-canvas` | `#ffffff` | deprecated: use --bg |
| `bg.primary` | `--bg-primary` | `#ffffff` | deprecated: use --bg |
| `bg.surface` | `--bg-surface` | `#f0f0f0` | deprecated: use --surface-raised |
| `bg.elevated` | `--bg-elevated` | `#f0f0f0` | deprecated: use --surface-raised |
| `bg.subtle` | `--bg-subtle` | `#f5f5ed` | deprecated: use --surface |
| `bg.sidebar` | `--bg-sidebar` | `#f5f5ed` | deprecated: use --surface |
| `bg.secondary` | `--bg-secondary` | `#f5f5ed` | deprecated: use --surface |
| `surface` | `--surface` | `#f5f5ed` | Section bands, alternating and hovered rows. |
| `surface.raised` | `--surface-raised` | `#f0f0f0` | Panels, cards, menus, chart plots. |
| `surface.sunken` | `--surface-sunken` | `#fafaf6` | Inputs and code wells. |
| `surface.panel` | `--surface-panel` | `#f0f0f0` | deprecated: use --surface-raised |
| `surface.muted` | `--surface-muted` | `#f5f5ed` | deprecated: use --surface |
| `grid` | `--grid` | `#e6e6e0` | Chart gridlines and table row rules; never a control border. |
| `line` | `--line` | `#b3b3af` | The 1px hairline: panel frames, dividers (decorative, 2.1:1). |
| `line.strong` | `--line-strong` | `#72726f` | Control edges: inputs, outline buttons, segmented controls. |
| `ink` | `--ink` | `#282828` | Primary text and figures. |
| `ink.secondary` | `--ink-secondary` | `#414140` | Body copy, table text. |
| `ink.muted` | `--ink-muted` | `#626260` | Captions, axis labels, metadata, the flat state. |
| `ink.disabled` | `--ink-disabled` | `#b4b4b0` | Disabled labels only. |
| `text.primary` | `--text-primary` | `#282828` | deprecated: use --ink |
| `text.secondary` | `--text-secondary` | `#414140` | deprecated: use --ink-secondary |
| `text.muted` | `--text-muted` | `#626260` | deprecated: use --ink-muted |
| `text.disabled` | `--text-disabled` | `#b4b4b0` | deprecated: use --ink-disabled |
| `text.inverse` | `--text-inverse` | `#ffffff` | deprecated: use --bg on an ink fill, --on-brand on a brand fill |
| `border` | `--border` | `#b3b3af` | deprecated: use --line |
| `border.default` | `--border-default` | `#b3b3af` | deprecated: use --line |
| `border.soft` | `--border-soft` | `#e6e6e0` | deprecated: use --grid |
| `border.strong` | `--border-strong` | `#72726f` | deprecated: use --line-strong |
| `border.accent` | `--border-accent` | `#fa3600` | deprecated: use --brand |
| `brand` | `--brand` | `#fa3600` | Signal orange. Fills only: primary button, selection, focus ring, the subject chart series, the active nav marker. Never on price changes. |
| `brand.text` | `--brand-text` | `#c42b00` | Brand as text: links, eyebrow index. |
| `brand.soft` | `--brand-soft` | `#ffe6dc` | Tinted ground behind brand-text: selected rows, active chips. |
| `accent` | `--accent` | `#ffe6dc` | deprecated: use --brand-soft (ground) or --brand-text (text, icon) |
| `on.brand` | `--on-brand` | `#101010` | Text and icons on a brand fill (white on brand is only 3.8:1). |
| `focus.ring` | `--focus-ring` | `#fa3600` | 2px solid, 2px offset (globals.css :focus-visible). |
| `link` | `--link` | `#c42b00` |  |
| `up` | `--up` | `#d21f3c` | 상승. Always with ▲ and +. |
| `up.soft` | `--up-soft` | `#fdeef0` |  |
| `down` | `--down` | `#1e5bd8` | 하락. Always with ▼ and -. |
| `down.soft` | `--down-soft` | `#e3ecfd` |  |
| `flat` | `--flat` | `#626260` | 보합: 0.0% and missing data. |
| `delta.up` | `--delta-up` | `#d21f3c` | deprecated: use --up |
| `delta.down` | `--delta-down` | `#1e5bd8` | deprecated: use --down |
| `state.positive` | `--state-positive` | `#d21f3c` | deprecated: use --up |
| `state.negative` | `--state-negative` | `#1e5bd8` | deprecated: use --down |
| `state.warning` | `--state-warning` | `#7a6a00` | deprecated: use --status-warning-ink |
| `state.success` | `--state-success` | `#0b6e62` | deprecated: use --status-success-ink |
| `state.error` | `--state-error` | `#d21f3c` | deprecated: use --status-error-ink |
| `state.info` | `--state-info` | `#fa3600` | deprecated: use --brand (fill) or --brand-text (text) |
| `status.error.ink` | `--status-error-ink` | `#d21f3c` |  |
| `status.error.surface` | `--status-error-surface` | `#fdeef0` |  |
| `status.error.border` | `--status-error-border` | `#d21f3c` |  |
| `status.warning.ink` | `--status-warning-ink` | `#7a6a00` |  |
| `status.warning.surface` | `--status-warning-surface` | `#fbf5d9` |  |
| `status.warning.border` | `--status-warning-border` | `#9a8600` |  |
| `status.success.ink` | `--status-success-ink` | `#0b6e62` |  |
| `status.success.surface` | `--status-success-surface` | `#e2f3f0` |  |
| `status.success.border` | `--status-success-border` | `#0e8c7c` |  |
| `overlay.scrim` | `--overlay-scrim` | `rgb(16 16 16 / 0.45)` | Not in the redesign: modal backdrop, on-brand black at 45%. |
| `chart.1` | `--chart-1` | `#fa3600` | The subject series (the one asset the chart is about). |
| `chart.2` | `--chart-2` | `#0e8c7c` | Benchmark or comparison line. |
| `chart.3` | `--chart-3` | `#8a7650` | Secondary comparison, area fills. |
| `chart.4` | `--chart-4` | `#626260` | Everything else: the market average, the folded 'Other'. |
| `chart.5` | `--chart-5` | `#9a8600` | A fifth series only when unavoidable. |
| `chart.area-opacity` | `--chart-area-opacity` | `0.12` | Fill opacity under a line and for percentile bands (Main.dc.html). |
| `chart.heat-1` | `--chart-heat-1` | `#1e5bd8` |  |
| `chart.heat-2` | `--chart-heat-2` | `#81a4eb` |  |
| `chart.heat-3` | `--chart-heat-3` | `#e3ecfd` |  |
| `chart.heat-4` | `--chart-heat-4` | `#f5f5ed` |  |
| `chart.heat-5` | `--chart-heat-5` | `#fdeef0` |  |
| `chart.heat-6` | `--chart-heat-6` | `#e88796` |  |
| `chart.heat-7` | `--chart-heat-7` | `#d21f3c` |  |
| `chart.primary` | `--chart-primary` | `#fa3600` | deprecated: use --chart-1 |
| `chart.secondary` | `--chart-secondary` | `#0e8c7c` | deprecated: use --chart-2 |
| `chart.tertiary` | `--chart-tertiary` | `#8a7650` | deprecated: use --chart-3 |
| `chart.muted` | `--chart-muted` | `#626260` | deprecated: use --chart-4 |
| `chart.label` | `--chart-label` | `#626260` | deprecated: use --ink-muted |
| `chart.ink` | `--chart-ink` | `#282828` | deprecated: use --ink |
| `chart.grid` | `--chart-grid` | `#e6e6e0` | deprecated: use --grid |
| `chart.positive` | `--chart-positive` | `#d21f3c` | deprecated: use --up |
| `chart.negative` | `--chart-negative` | `#1e5bd8` | deprecated: use --down |
| `space.1` | `--space-1` | `4px` |  |
| `space.2` | `--space-2` | `8px` |  |
| `space.3` | `--space-3` | `12px` |  |
| `space.4` | `--space-4` | `16px` |  |
| `space.5` | `--space-5` | `20px` |  |
| `space.6` | `--space-6` | `24px` |  |
| `space.8` | `--space-8` | `32px` |  |
| `space.16` | `--space-16` | `64px` |  |
| `space.32` | `--space-32` | `128px` |  |
| `radius.0` | `--radius-0` | `0px` | Panels, tables, charts, modals: the default (no rounded class). |
| `radius.1` | `--radius-1` | `2px` | Buttons, inputs, segmented controls. |
| `radius.2` | `--radius-2` | `4px` | Tooltips, menus, delta chips. |
| `radius.pill` | `--radius-pill` | `999px` | Status dots. |
| `radius` | `--radius` | `0px` | deprecated: use no rounded class (square), or --radius-1/2 by role |
| `radius.sm` | `--radius-sm` | `4px` | deprecated: use --radius-2 |
| `radius.md` | `--radius-md` | `0px` | deprecated: use no rounded class (square), or --radius-1/2 by role |
| `radius.lg` | `--radius-lg` | `0px` | deprecated: use no rounded class (square) |
| `shadow.card-hover` | `--shadow-card-hover` | `none` | deprecated: no shadows: use border border-[var(--line)] |
| `shadow.modal` | `--shadow-modal` | `none` | deprecated: no shadows: use border border-[var(--line)] |
| `shadow.popover` | `--shadow-popover` | `none` | deprecated: no shadows: use border border-[var(--line)] |
| `shadow.sidebar` | `--shadow-sidebar` | `none` | deprecated: no shadows: use border border-[var(--line)] |
| `hairline` | `--hairline` | `1px` | Every border and rule; no 2px borders except the focus ring. |
| `duration.fast` | `--duration-fast` | `100ms` |  |
| `duration.normal` | `--duration-normal` | `200ms` |  |
| `duration.slow` | `--duration-slow` | `350ms` |  |
| `easing.default` | `--easing-default` | `cubic-bezier(0.4, 0, 0.2, 1)` |  |
| `easing.enter` | `--easing-enter` | `cubic-bezier(0, 0, 0.2, 1)` |  |
| `easing.exit` | `--easing-exit` | `cubic-bezier(0.4, 0, 1, 1)` |  |
| `bp.desktop` | `--bp-desktop` | `992px` |  |
| `bp.tablet` | `--bp-tablet` | `768px` |  |
| `bp.mobile` | `--bp-mobile` | `480px` |  |
| `content.max` | `--content-max` | `1280px` |  |
| `gutter` | `--gutter` | `24px` | Grid gutter (16px under 768px). |
| `component.button.height-sm` | `--component-button-height-sm` | `32px` |  |
| `component.button.height-md` | `--component-button-height-md` | `44px` |  |
| `component.input.height` | `--component-input-height` | `44px` |  |
| `component.tick.size` | `--component-tick-size` | `8px` | Panel corner ticks. |
| `component.delta.glyph` | `--component-delta-glyph` | `9px` | ▲▼■ inside a delta. |
| `font.family.sans` | `--font-family-sans` | `var(--font-host-grotesk), var(--font-pretendard), system-ui, "Malgun Gothic", sans-serif` |  |
| `font.family.mono` | `--font-family-mono` | `var(--font-geist-mono), var(--font-pretendard), ui-monospace, monospace` |  |
| `type.display` | `--type-display` | `62px` |  |
| `type.display.line-height` | `--type-display-line-height` | `64px` |  |
| `type.display.weight` | `--type-display-weight` | `600` |  |
| `type.display.tracking` | `--type-display-tracking` | `-0.03em` |  |
| `type.display.family` | `--type-display-family` | `var(--font-host-grotesk), var(--font-pretendard), system-ui, "Malgun Gothic", sans-serif` |  |
| `type.heading-1` | `--type-heading-1` | `53px` |  |
| `type.heading-1.line-height` | `--type-heading-1-line-height` | `58px` |  |
| `type.heading-1.weight` | `--type-heading-1-weight` | `600` |  |
| `type.heading-1.tracking` | `--type-heading-1-tracking` | `-0.025em` |  |
| `type.heading-1.family` | `--type-heading-1-family` | `var(--font-host-grotesk), var(--font-pretendard), system-ui, "Malgun Gothic", sans-serif` |  |
| `type.heading-2` | `--type-heading-2` | `44px` |  |
| `type.heading-2.line-height` | `--type-heading-2-line-height` | `50px` |  |
| `type.heading-2.weight` | `--type-heading-2-weight` | `600` |  |
| `type.heading-2.tracking` | `--type-heading-2-tracking` | `-0.02em` |  |
| `type.heading-2.family` | `--type-heading-2-family` | `var(--font-host-grotesk), var(--font-pretendard), system-ui, "Malgun Gothic", sans-serif` |  |
| `type.heading-3` | `--type-heading-3` | `36px` |  |
| `type.heading-3.line-height` | `--type-heading-3-line-height` | `42px` |  |
| `type.heading-3.weight` | `--type-heading-3-weight` | `500` |  |
| `type.heading-3.tracking` | `--type-heading-3-tracking` | `-0.015em` |  |
| `type.heading-3.family` | `--type-heading-3-family` | `var(--font-host-grotesk), var(--font-pretendard), system-ui, "Malgun Gothic", sans-serif` |  |
| `type.heading-4` | `--type-heading-4` | `31px` |  |
| `type.heading-4.line-height` | `--type-heading-4-line-height` | `38px` |  |
| `type.heading-4.weight` | `--type-heading-4-weight` | `500` |  |
| `type.heading-4.tracking` | `--type-heading-4-tracking` | `-0.01em` |  |
| `type.heading-4.family` | `--type-heading-4-family` | `var(--font-host-grotesk), var(--font-pretendard), system-ui, "Malgun Gothic", sans-serif` |  |
| `type.heading-5` | `--type-heading-5` | `27px` |  |
| `type.heading-5.line-height` | `--type-heading-5-line-height` | `34px` |  |
| `type.heading-5.weight` | `--type-heading-5-weight` | `500` |  |
| `type.heading-5.tracking` | `--type-heading-5-tracking` | `-0.01em` |  |
| `type.heading-5.family` | `--type-heading-5-family` | `var(--font-host-grotesk), var(--font-pretendard), system-ui, "Malgun Gothic", sans-serif` |  |
| `type.panel-title` | `--type-panel-title` | `18px` |  |
| `type.panel-title.line-height` | `--type-panel-title-line-height` | `24px` |  |
| `type.panel-title.weight` | `--type-panel-title-weight` | `600` |  |
| `type.panel-title.tracking` | `--type-panel-title-tracking` | `-0.01em` |  |
| `type.panel-title.family` | `--type-panel-title-family` | `var(--font-host-grotesk), var(--font-pretendard), system-ui, "Malgun Gothic", sans-serif` |  |
| `type.body-lg` | `--type-body-lg` | `18px` |  |
| `type.body-lg.line-height` | `--type-body-lg-line-height` | `30px` |  |
| `type.body-lg.weight` | `--type-body-lg-weight` | `400` |  |
| `type.body-lg.tracking` | `--type-body-lg-tracking` | `-0.005em` |  |
| `type.body-lg.family` | `--type-body-lg-family` | `var(--font-host-grotesk), var(--font-pretendard), system-ui, "Malgun Gothic", sans-serif` |  |
| `type.body` | `--type-body` | `15px` |  |
| `type.body.line-height` | `--type-body-line-height` | `24px` |  |
| `type.body.weight` | `--type-body-weight` | `400` |  |
| `type.body.tracking` | `--type-body-tracking` | `0` |  |
| `type.body.family` | `--type-body-family` | `var(--font-host-grotesk), var(--font-pretendard), system-ui, "Malgun Gothic", sans-serif` |  |
| `type.label` | `--type-label` | `15px` |  |
| `type.label.line-height` | `--type-label-line-height` | `20px` |  |
| `type.label.weight` | `--type-label-weight` | `600` |  |
| `type.label.tracking` | `--type-label-tracking` | `0` |  |
| `type.label.family` | `--type-label-family` | `var(--font-host-grotesk), var(--font-pretendard), system-ui, "Malgun Gothic", sans-serif` |  |
| `type.small` | `--type-small` | `13px` |  |
| `type.small.line-height` | `--type-small-line-height` | `18px` |  |
| `type.small.weight` | `--type-small-weight` | `400` |  |
| `type.small.tracking` | `--type-small-tracking` | `0` |  |
| `type.small.family` | `--type-small-family` | `var(--font-host-grotesk), var(--font-pretendard), system-ui, "Malgun Gothic", sans-serif` |  |
| `type.figure` | `--type-figure` | `44px` |  |
| `type.figure.line-height` | `--type-figure-line-height` | `44px` |  |
| `type.figure.weight` | `--type-figure-weight` | `500` |  |
| `type.figure.tracking` | `--type-figure-tracking` | `-0.03em` |  |
| `type.figure.family` | `--type-figure-family` | `var(--font-geist-mono), var(--font-pretendard), ui-monospace, monospace` |  |
| `type.figure-md` | `--type-figure-md` | `32px` |  |
| `type.figure-md.line-height` | `--type-figure-md-line-height` | `32px` |  |
| `type.figure-md.weight` | `--type-figure-md-weight` | `500` |  |
| `type.figure-md.tracking` | `--type-figure-md-tracking` | `-0.03em` |  |
| `type.figure-md.family` | `--type-figure-md-family` | `var(--font-geist-mono), var(--font-pretendard), ui-monospace, monospace` |  |
| `type.mono-link` | `--type-mono-link` | `16px` |  |
| `type.mono-link.line-height` | `--type-mono-link-line-height` | `20px` |  |
| `type.mono-link.weight` | `--type-mono-link-weight` | `500` |  |
| `type.mono-link.tracking` | `--type-mono-link-tracking` | `0.02em` |  |
| `type.mono-link.family` | `--type-mono-link-family` | `var(--font-geist-mono), var(--font-pretendard), ui-monospace, monospace` |  |
| `type.mono` | `--type-mono` | `13px` |  |
| `type.mono.line-height` | `--type-mono-line-height` | `18px` |  |
| `type.mono.weight` | `--type-mono-weight` | `500` |  |
| `type.mono.tracking` | `--type-mono-tracking` | `0` |  |
| `type.mono.family` | `--type-mono-family` | `var(--font-geist-mono), var(--font-pretendard), ui-monospace, monospace` |  |
| `type.caption` | `--type-caption` | `11px` |  |
| `type.caption.line-height` | `--type-caption-line-height` | `14px` |  |
| `type.caption.weight` | `--type-caption-weight` | `500` |  |
| `type.caption.tracking` | `--type-caption-tracking` | `0.08em` |  |
| `type.caption.family` | `--type-caption-family` | `var(--font-geist-mono), var(--font-pretendard), ui-monospace, monospace` |  |
| `type.caption-ko` | `--type-caption-ko` | `12px` |  |
| `type.caption-ko.line-height` | `--type-caption-ko-line-height` | `16px` |  |
| `type.caption-ko.weight` | `--type-caption-ko-weight` | `500` |  |
| `type.caption-ko.tracking` | `--type-caption-ko-tracking` | `0` |  |
| `type.caption-ko.family` | `--type-caption-ko-family` | `var(--font-geist-mono), var(--font-pretendard), ui-monospace, monospace` |  |
| `type.page-title` | `--type-page-title` | `27px` | deprecated: use type-heading-5 |
| `type.metric-lg` | `--type-metric-lg` | `32px` | deprecated: use type-figure-md |
| `type.section-title` | `--type-section-title` | `18px` | deprecated: use type-panel-title |
| `type.card-title` | `--type-card-title` | `18px` | deprecated: use type-panel-title |
| `type.metric-md` | `--type-metric-md` | `18px` | deprecated: use type-panel-title (figures: type-figure-md) |
| `type.table-header` | `--type-table-header` | `11px` | deprecated: use type-caption |
| `type.table-body` | `--type-table-body` | `13px` | deprecated: use type-small (figures: type-mono) |
| `type.helper` | `--type-helper` | `13px` | deprecated: use type-small |
<!-- tokens:generated:end -->
