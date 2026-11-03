"use client";

import { Bar, BarChart, Cell, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { useT } from "@/lib/i18n/locale";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { GRID_STYLE, fmtPctTick, withAxisProps, withCategoryAxisProps, withTooltipProps } from "@/lib/chartConfig";
import { type DetailKey, type HurdleBarPoint, pct } from "./shared";

/**
 * The company's own Ke components (plan 2026-11-02 §3 V4, D4(a)): risk-free rate, levered beta x ERP and CRP.
 * The fixed regional bars were examples for every company and are gone.
 */
export function HurdleRateDecompositionGraph({
  hurdleBars,
  onOpenDetail,
}: {
  hurdleBars: HurdleBarPoint[];
  onOpenDetail: (key: DetailKey) => void;
}) {
  const t = useT();
  const componentSum = hurdleBars.reduce((total, item) => total + item.value, 0);
  return (
    <div className="border border-[var(--line)] bg-[var(--surface-raised)] p-5">
      <div className="min-w-0">
        <h3 className="type-panel-title text-[var(--ink)]">Hurdle Rate Decomposition</h3>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenDetail("hurdleDecomposition")}
            className="type-small text-left text-[var(--ink-muted)] underline decoration-dotted underline-offset-4 hover:text-[var(--brand-text)]"
          >
            <InfoTooltip
              label={t("corporate.charts.hurdleHelpLabel")}
              description={t("corporate.charts.hurdleHelp")}
            />
          </button>
        </div>
      </div>
      <div className="h-56 min-h-56 min-w-0">
        <ResponsiveChart className="h-full w-full" minWidth={1} minHeight={1}>
          <BarChart data={hurdleBars} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="name" {...withCategoryAxisProps()} />
            <YAxis {...withAxisProps({ tickFormatter: (value: number | string) => fmtPctTick(Number(value), 0) })} />
            <Tooltip {...withTooltipProps()} formatter={(value) => pct(Number(value))} />
            <Bar dataKey="value" name="Component">
              {hurdleBars.map((item) => (
                <Cell key={item.name} fill={item.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveChart>
      </div>
      <div className="type-small mt-2 grid grid-cols-1 gap-2 text-[var(--ink-muted)] sm:grid-cols-2 lg:grid-cols-3">
        {hurdleBars.map((item) => (
          <button
            key={item.name}
            type="button"
            onClick={() => {
              if (item.name === "CRP") onOpenDetail("crp");
              else if (item.name === "Beta x ERP") onOpenDetail("erp");
              else onOpenDetail("bottomUpKe");
            }}
            className="flex items-center gap-2 text-left transition hover:text-[var(--brand-text)]"
          >
            {/* rounded-full: dot, a colour key in the legend. */}
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.fill }} />
            {item.name}: {pct(item.value)}
          </button>
        ))}
      </div>
      <p className="type-small mt-2 text-[var(--ink)]">Total (sum of the three): {pct(componentSum)}</p>
    </div>
  );
}
