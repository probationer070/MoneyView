"use client";

import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from "recharts";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { useT } from "@/lib/i18n/locale";
import { ExampleBadge } from "./ExampleBadge";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { GRID_STYLE, fmtRatioTick, withAxisProps, withCategoryAxisProps, withTooltipProps } from "@/lib/chartConfig";
import { type BetaPoint, type DetailKey } from "./shared";

/**
 * Bottom-up beta bars. The WACC "U-curve" beside them was removed (plan 2026-11-02 §6.5, owner
 * 2026-11-03): it was a fixed quadratic with its minimum at 41% debt for every company, not an
 * optimal-capital-structure model. The file and export keep their names to keep the diff small.
 */
export function BetaWaccCurveGraph({
  betaTreemapProxy,
  onOpenDetail,
}: {
  betaTreemapProxy: BetaPoint[];
  onOpenDetail: (key: DetailKey) => void;
}) {
  const t = useT();
  const hasExamples = betaTreemapProxy.some((entry) => entry.illustrative);
  return (
    <div className="border border-[var(--line)] bg-[var(--surface-raised)] p-5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onOpenDetail("betaWaccCurve")}
          className="type-panel-title text-left text-[var(--ink)] underline decoration-dotted underline-offset-4 hover:text-[var(--brand-text)]"
        >
          <InfoTooltip
            label="Bottom-up Beta"
            description={t("corporate.charts.betaHelp")}
          />
        </button>
        {hasExamples ? <ExampleBadge testId="example-badge-beta" why={t("corporate.charts.exampleBeta")} /> : null}
      </div>
      <div className="h-56 min-h-56 min-w-0">
        <ResponsiveChart className="h-full w-full" minWidth={1} minHeight={1}>
          <BarChart data={betaTreemapProxy}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="name" {...withCategoryAxisProps()} />
            <YAxis {...withAxisProps({ tickFormatter: (value: number | string) => fmtRatioTick(Number(value), 2) })} />
            <Tooltip {...withTooltipProps()} />
            <Bar dataKey="beta" name="Beta">
              {betaTreemapProxy.map((entry) => (
                // An example bar is grey, like the matrix's example points: it is not this company's value.
                <Cell key={entry.name} data-illustrative={entry.illustrative ? "true" : undefined} fill={entry.illustrative ? "var(--chart-4)" : entry.beta > 1.3 ? "var(--ink)" : "var(--chart-1)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveChart>
      </div>
    </div>
  );
}
