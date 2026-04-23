/**
 * Shared chart configuration constants.
 * Recharts surfaces should import from here instead of redefining inline styles,
 * tooltip chrome, formatters, or palette rules locally.
 */

export const CHART_MARGIN = { top: 8, right: 16, bottom: 8, left: 16 } as const;

export const CHART_MARGIN_LABELED = { top: 8, right: 24, bottom: 24, left: 24 } as const;

export const AXIS_TICK_STYLE = {
  fontSize: 11,
  fill: "var(--chart-label)",
} as const;

export const AXIS_LINE_STYLE = {
  stroke: "var(--chart-grid)",
} as const;

export const GRID_STYLE = {
  stroke: "var(--chart-grid)",
  strokeDasharray: "3 3",
} as const;

export const TOOLTIP_CONTENT_STYLE = {
  backgroundColor: "var(--bg-surface)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-sm)",
  fontSize: 12,
  padding: "8px 12px",
  boxShadow: "var(--shadow-popover)",
} as const;

export const TOOLTIP_LABEL_STYLE = {
  fontWeight: 600,
  marginBottom: 4,
  color: "var(--text-primary)",
} as const;

export const TOOLTIP_ITEM_STYLE = {
  color: "var(--text-secondary)",
} as const;

export const TOOLTIP_CURSOR_STYLE = {
  fill: "var(--bg-muted)",
  opacity: 0.5,
} as const;

export const DEFAULT_TOOLTIP_PROPS = {
  contentStyle: TOOLTIP_CONTENT_STYLE,
  labelStyle: TOOLTIP_LABEL_STYLE,
  itemStyle: TOOLTIP_ITEM_STYLE,
  cursor: TOOLTIP_CURSOR_STYLE,
} as const;

export const CHART_COLORS = {
  primary: "var(--chart-primary)",
  secondary: "var(--chart-secondary)",
  tertiary: "var(--chart-tertiary)",
  muted: "var(--chart-muted)",
  label: "var(--chart-label)",
  ink: "var(--chart-ink)",
  positive: "var(--chart-positive)",
  negative: "var(--chart-negative)",
} as const;

export const CHART_COLOR_SEQUENCE = [
  CHART_COLORS.primary,
  CHART_COLORS.secondary,
  CHART_COLORS.tertiary,
  CHART_COLORS.ink,
  CHART_COLORS.muted,
  CHART_COLORS.label,
] as const;

export const CHART_REFERENCE_COLORS = {
  baseline: CHART_COLORS.ink,
  highlight: "#f59e0b",
  warning: "#f97316",
  success: "#16a34a",
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

export function seriesColor(index: number): string {
  return CHART_COLOR_SEQUENCE[index % CHART_COLOR_SEQUENCE.length];
}

export function fmtPct(value: number, decimals = 1): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

export function fmtPctTick(value: number, decimals = 0): string {
  return `${Number(value).toFixed(decimals)}%`;
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

export function fmtYearsTick(value: number): string {
  return `${value}Y`;
}

export function fmtCompactThousands(value: number): string {
  return `${Math.round(Number(value) / 1000)}k`;
}
