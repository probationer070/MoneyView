"use client";

import { CartesianGrid, Cell, ReferenceLine, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { useT } from "@/lib/i18n/locale";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { GRID_STYLE, fmtPctTick, withAxisProps, withTooltipProps } from "@/lib/chartConfig";
import { valueQuadrant, type ValueQuadrant } from "../../valueQuadrant";
import { type DetailKey, type ValueMatrixPoint, pct } from "./shared";

// Each quadrant's name sits in its own corner. The axis domains always include both reference lines
// (ROIC = WACC and the growth reference), so every corner lies inside the quadrant it names.
// Offsets put each name inside the plot area: the chart margin (20px) on top and right, the Y axis
// (60px) on the left, the X axis plus margin (50px) at the bottom.
const CORNERS: { quadrant: ValueQuadrant; className: string }[] = [
  { quadrant: "growthCreates", className: "right-7 top-6" },
  { quadrant: "returnCash", className: "left-16 top-6" },
  { quadrant: "fixReturns", className: "bottom-14 right-7" },
  { quadrant: "restructure", className: "bottom-14 left-16" },
];

/**
 * A rounded axis range that always contains `include` and leaves headroom above and below the data,
 * so ticks fall on round numbers and no point sits under a corner name.
 */
function niceAxis(values: number[], include: number): { domain: [number, number]; ticks: number[] } {
  const lo = Math.min(...values, include);
  const hi = Math.max(...values, include);
  const raw = Math.max(hi - lo, 1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  const start = Math.floor(lo / step) * step - step;
  const end = Math.ceil(hi / step) * step + step;
  const ticks = Array.from({ length: Math.round((end - start) / step) + 1 }, (_, index) => start + index * step);
  return { domain: [start, end], ticks };
}

export function ValueDriverMatrixGraph({
  companyName,
  valueMatrix,
  growthReference,
  onOpenDetail,
}: {
  companyName: string;
  valueMatrix: ValueMatrixPoint[];
  /** Percent. The long-run growth reference, the risk-free rate (valueQuadrant.ts). */
  growthReference: number;
  onOpenDetail: (key: DetailKey) => void;
}) {
  const t = useT();
  const company = valueMatrix.find((entry) => entry.name === companyName && !entry.illustrative) ?? null;
  const xAxis = niceAxis(valueMatrix.map((entry) => entry.growth), growthReference);
  const yAxis = niceAxis(valueMatrix.map((entry) => entry.spread), 0);
  return (
    <div className="border border-[var(--line)] bg-[var(--surface-raised)] p-5">
      <div className="min-w-0">
        <h3 className="type-panel-title text-[var(--ink)]">4-Quadrant Value Driver Matrix</h3>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenDetail("valueDriverMatrix")}
            className="type-small text-left text-[var(--ink-muted)] underline decoration-dotted underline-offset-4 hover:text-[var(--brand-text)]"
          >
            <InfoTooltip
              label={t("corporate.charts.matrixHelpLabel")}
              description={t("corporate.charts.matrixHelp")}
            />
          </button>
        </div>
      </div>
      <div className="relative h-56 min-h-56 min-w-0">
        <ResponsiveChart className="h-full w-full" minWidth={1} minHeight={1}>
          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis
              type="number"
              dataKey="growth"
              name="Growth"
              domain={xAxis.domain}
              ticks={xAxis.ticks}
              {...withAxisProps({ tickFormatter: (value: number | string) => fmtPctTick(Number(value), 0) })}
            />
            <YAxis
              type="number"
              dataKey="spread"
              name="ROIC - WACC"
              domain={yAxis.domain}
              ticks={yAxis.ticks}
              {...withAxisProps({ tickFormatter: (value: number | string) => fmtPctTick(Number(value), 0) })}
            />
            <ZAxis type="number" dataKey="fcff" range={[90, 520]} name="FCFF" />
            <ReferenceLine y={0} stroke="var(--ink)" />
            <ReferenceLine x={growthReference} stroke="var(--ink)" strokeDasharray="4 4" />
            <Tooltip {...withTooltipProps({ cursor: { strokeDasharray: "3 3" } })} />
            <Scatter data={valueMatrix} name="Capital efficiency">
              {valueMatrix.map((entry) => (
                <Cell key={entry.name} fill={entry.name === companyName && !entry.illustrative ? "var(--chart-1)" : "var(--chart-4)"} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveChart>
        {CORNERS.map(({ quadrant, className }) => (
          <span
            key={quadrant}
            data-testid={`matrix-corner-${quadrant}`}
            className={`type-caption pointer-events-none absolute text-[var(--ink-muted)] ${className}`}
          >
            {t(`corporate.charts.quadrant.${quadrant}`)}
          </span>
        ))}
      </div>
      <p className="type-small mt-2 flex flex-wrap gap-x-3 text-[var(--ink-muted)]">
        {company ? (
          <span data-testid="matrix-company-quadrant" data-quadrant={valueQuadrant(company.growth, company.spread, growthReference)}>
            {companyName}: <span className="text-[var(--ink)]">{t(`corporate.charts.quadrant.${valueQuadrant(company.growth, company.spread, growthReference)}`)}</span>
          </span>
        ) : null}
        <span data-testid="matrix-growth-line" title={t("corporate.charts.growthLineWhy")}>
          {t("corporate.charts.growthLine", { rate: pct(growthReference) })}
        </span>
      </p>
    </div>
  );
}
