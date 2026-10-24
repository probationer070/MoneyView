"use client";

import { useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, Tooltip, XAxis, YAxis } from "recharts";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { CHART_MARGIN, DEFAULT_AXIS_PROPS, GRID_STYLE, withTooltipProps } from "@/lib/chartConfig";
import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import { tokens } from "@/lib/tokens.generated";
import { useThemeLabels, useThemeLevel } from "@/lib/useRisk";
import type { LabelOut } from "../../../../packages/shared-types";

// The record report's theme level line (risk UI spec §4 "차트"): one theme's level rebased to 100, from 40 days
// before the signal to 20 days after it ended (or today), with the signal window shaded.

const DAY_MS = 86_400_000;
const BEFORE_DAYS = 40;
const AFTER_DAYS = 20;
// GET /themes/{theme}/level refuses more than 400 trading days; 400 calendar days stays inside that.
const MAX_RANGE_DAYS = 400;

const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The request window: start−40d to end+20d, or to today while the signal is open or end+20d is still ahead. */
export function levelRange(start: string, end: string | null, today: string): { from: string; to: string } {
  const to = Math.min(end === null ? dayMs(today) : dayMs(end) + AFTER_DAYS * DAY_MS, dayMs(today));
  const from = Math.max(dayMs(start) - BEFORE_DAYS * DAY_MS, to - MAX_RANGE_DAYS * DAY_MS);
  return { from: isoDay(from), to: isoDay(to) };
}

// Spec §2 colours: a risk window in the --down family, a surge window in the --up family.
const SHADE = { risk: tokens.down._, surge: tokens.up._ } as const;

interface ThemeLevelChartProps {
  theme: string;
  /** The theme's label as the API sent it, used when the watchlist themes do not name the id (^SOX). */
  label?: LabelOut;
  start: string;
  /** The release or end day; null while the signal is open. */
  end: string | null;
  tone: keyof typeof SHADE;
}

export function ThemeLevelChart({ theme, label, start, end, tone }: ThemeLevelChartProps) {
  const t = useT();
  const { locale } = useLocale();
  const themeName = useThemeLabels();
  // Read once per mount, so a re-render never moves the request window.
  const [today] = useState(() => isoDay(Date.now()));
  const { from, to } = levelRange(start, end, today);
  const level = useThemeLevel(theme, from, to);
  const points = (level.data ?? []).map((point) => ({ x: dayMs(point.date), level: point.level }));
  const title = t("risk.report.chart", { theme: themeName(theme, label) });

  let body;
  if (level.isError) {
    body = <p className="type-small text-[var(--ink-muted)]">{t("risk.report.chartError")}</p>;
  } else if (level.data === undefined) {
    body = <p className="type-small text-[var(--ink-muted)]">{t("risk.report.loading")}</p>;
  } else if (points.length === 0) {
    body = <p className="type-small text-[var(--ink-muted)]">{t("risk.report.chartEmpty")}</p>;
  } else {
    body = (
      <div data-testid="theme-level-chart" className="h-40">
        <ResponsiveChart className="h-full w-full" monitorName="risk_theme_level">
          <LineChart data={points} margin={CHART_MARGIN}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="x" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={isoDay} minTickGap={32} {...DEFAULT_AXIS_PROPS} />
            <YAxis domain={["auto", "auto"]} width={40} tickFormatter={(v: number) => formatNumber(v, "integer", { locale })} {...DEFAULT_AXIS_PROPS} />
            <Tooltip {...withTooltipProps()} labelFormatter={(v) => isoDay(Number(v))} formatter={(v) => formatNumber(Number(v), "ratio", { locale })} />
            <ReferenceArea
              x1={dayMs(start)}
              x2={end === null ? points[points.length - 1].x : dayMs(end)}
              fill={SHADE[tone]}
              fillOpacity={Number(tokens.chart["area-opacity"])}
              stroke="none"
              ifOverflow="hidden"
            />
            <Line dataKey="level" name={themeName(theme, label)} stroke={tokens.chart["1"]} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveChart>
      </div>
    );
  }
  return (
    <section data-section="chart" aria-label={title}>
      <h3 className="type-label mb-2 text-[var(--ink)]">{title}</h3>
      {body}
    </section>
  );
}
