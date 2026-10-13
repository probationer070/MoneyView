/**
 * Shared chart configuration constants.
 * Recharts surfaces should import from here instead of redefining inline styles,
 * tooltip chrome, formatters, or palette rules locally.
 */

import { tokens } from "@/lib/tokens.generated";

export const CHART_MARGIN = { top: 8, right: 16, bottom: 8, left: 16 } as const;

export const CHART_MARGIN_LABELED = { top: 8, right: 24, bottom: 24, left: 24 } as const;

export const AXIS_TICK_STYLE = {
  fontSize: Number.parseFloat(tokens.type.caption._),
  fontFamily: "var(--font-family-mono)",
  fill: "var(--ink-muted)",
} as const;

export const AXIS_CATEGORY_TICK_STYLE = {
  ...AXIS_TICK_STYLE,
  fill: "var(--ink)",
  fontWeight: 600,
} as const;

export const AXIS_LINE_STYLE = {
  stroke: "var(--grid)",
} as const;

export const GRID_STYLE = {
  stroke: "var(--grid)",
  strokeDasharray: "3 3",
} as const;

export const DEFAULT_AXIS_PROPS = {
  tick: AXIS_TICK_STYLE,
  axisLine: AXIS_LINE_STYLE,
  tickLine: false,
} as const;

export const DEFAULT_CATEGORY_AXIS_PROPS = {
  tick: AXIS_CATEGORY_TICK_STYLE,
  axisLine: AXIS_LINE_STYLE,
  tickLine: false,
} as const;

export const TOOLTIP_CONTENT_STYLE = {
  backgroundColor: "var(--surface-raised)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-2)",
  fontSize: Number.parseFloat(tokens.type.small._),
  padding: "8px 12px",
} as const;

export const TOOLTIP_LABEL_STYLE = {
  fontWeight: 600,
  marginBottom: 4,
  color: "var(--ink)",
} as const;

export const TOOLTIP_ITEM_STYLE = {
  color: "var(--ink-secondary)",
} as const;

export const TOOLTIP_CURSOR_STYLE = {
  fill: "var(--surface)",
  opacity: 0.5,
} as const;

export const DEFAULT_TOOLTIP_PROPS = {
  contentStyle: TOOLTIP_CONTENT_STYLE,
  labelStyle: TOOLTIP_LABEL_STYLE,
  itemStyle: TOOLTIP_ITEM_STYLE,
  cursor: TOOLTIP_CURSOR_STYLE,
} as const;

export function withTooltipProps<T extends Record<string, unknown>>(overrides?: T) {
  return {
    ...DEFAULT_TOOLTIP_PROPS,
    ...overrides,
  };
}

export function withAxisProps<T extends Record<string, unknown>>(overrides?: T) {
  return {
    ...DEFAULT_AXIS_PROPS,
    ...overrides,
  };
}

export function withCategoryAxisProps<T extends Record<string, unknown>>(overrides?: T) {
  return {
    ...DEFAULT_CATEGORY_AXIS_PROPS,
    ...overrides,
  };
}

export const CHART_COLORS = {
  primary: "var(--chart-1)",
  secondary: "var(--chart-2)",
  tertiary: "var(--chart-3)",
  muted: "var(--chart-4)",
  label: "var(--ink-muted)",
  ink: "var(--ink)",
  positive: "var(--up)",
  negative: "var(--down)",
} as const;

/** Five series (redesign chart-1..5). A sixth category folds into "Other" in chart-4 (M4). */
export const CHART_COLOR_SEQUENCE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

export const CHART_REFERENCE_COLORS = {
  baseline: CHART_COLORS.ink,
  highlight: "var(--brand)",
  warning: "var(--status-warning-ink)",
  success: "var(--status-success-ink)",
  danger: CHART_COLORS.negative,
} as const;

export const PERCENTILE_SERIES_COLORS = {
  p05: CHART_COLORS.negative,
  p10: CHART_REFERENCE_COLORS.warning,
  p25: CHART_COLORS.muted,
  p50: CHART_COLORS.ink,
  p75: CHART_COLORS.muted,
  p90: CHART_COLORS.secondary,
  p95: CHART_REFERENCE_COLORS.success,
} as const;

export const PERCENTILE_FILL_SEQUENCE = [
  CHART_COLORS.primary,
  CHART_COLORS.secondary,
  CHART_COLORS.muted,
] as const;

export const DEFAULT_PERCENTILE_BAR_COLORS = [
  PERCENTILE_SERIES_COLORS.p05,
  PERCENTILE_SERIES_COLORS.p10,
  PERCENTILE_SERIES_COLORS.p25,
  PERCENTILE_SERIES_COLORS.p50,
  PERCENTILE_SERIES_COLORS.p75,
  PERCENTILE_SERIES_COLORS.p90,
  PERCENTILE_SERIES_COLORS.p95,
] as const;

export const HEAT_SCALE = [
  "var(--chart-heat-1)",
  "var(--chart-heat-2)",
  "var(--chart-heat-3)",
  "var(--chart-heat-4)",
  "var(--chart-heat-5)",
  "var(--chart-heat-6)",
  "var(--chart-heat-7)",
] as const;

export function heatColor(value: number): string {
  const clamped = Math.max(-1, Math.min(1, value));
  const index = Math.round(((clamped + 1) / 2) * (HEAT_SCALE.length - 1));
  return HEAT_SCALE[index];
}

/** Series past the fifth share chart-4, the "Other" colour (M4). */
export function seriesColor(index: number): string {
  return CHART_COLOR_SEQUENCE[index] ?? CHART_COLOR_SEQUENCE[3];
}

export function fmtPct(value: number, decimals = 1): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

function normalizeFixedDigits(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(100, Math.max(0, Math.trunc(numeric)));
}

export function fmtPctTick(value: number, decimals = 0): string {
  return `${Number(value).toFixed(normalizeFixedDigits(decimals, 0))}%`;
}

export function fmtRatioTick(value: number, decimals = 2): string {
  return Number(value).toFixed(normalizeFixedDigits(decimals, 2));
}

export function fmtNum(value: number, decimals = 1): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtPlain(value: number, decimals = 0): string {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtCurrencyTick(value: number, decimals = 0, currencySymbol = "$"): string {
  return `${currencySymbol}${fmtPlain(Number(value), decimals)}`;
}

export function fmtCurrencyCompactTick(value: number, currencySymbol = "$"): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return `${currencySymbol}0`;
  return `${currencySymbol}${numericValue.toLocaleString(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  })}`;
}

export function fmtYearsTick(value: number): string {
  return `${value}Y`;
}

export function fmtCompactThousands(value: number): string {
  return `${Math.round(Number(value) / 1000)}k`;
}

export function fmtTenThousandsTick(value: number): string {
  return fmtPlain(Math.round(Number(value) / 10_000));
}
