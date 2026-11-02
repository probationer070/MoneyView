"use client";

import { Bar, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { useT } from "@/lib/i18n/locale";
import { ExampleBadge } from "./ExampleBadge";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { GRID_STYLE, fmtPctTick, withAxisProps, withCategoryAxisProps, withTooltipProps } from "@/lib/chartConfig";
import { type DetailKey, type HurdleBarPoint, type RegionalHurdlePoint, pct, pct2 } from "./shared";

export function HurdleRateDecompositionGraph({
  hurdleBars,
  regionalHurdle,
  onOpenDetail,
}: {
  hurdleBars: HurdleBarPoint[];
  regionalHurdle: RegionalHurdlePoint[];
  onOpenDetail: (key: DetailKey) => void;
}) {
  const t = useT();
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
          <ExampleBadge testId="example-badge-regions" why={t("corporate.charts.exampleRegions")} />
        </div>
      </div>
      <div className="h-56 min-h-56 min-w-0">
        <ResponsiveChart className="h-full w-full" minWidth={1} minHeight={1}>
          <ComposedChart data={regionalHurdle} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="region" {...withCategoryAxisProps()} />
            <YAxis {...withAxisProps({ tickFormatter: (value: number | string) => fmtPctTick(Number(value), 0) })} />
            <ZAxis dataKey="revenue" range={[80, 520]} />
            <Tooltip {...withTooltipProps()} formatter={(value, name) => (name === "Implied ERP" ? pct2(Number(value)) : pct(Number(value)))} />
            <Bar dataKey="crp" name="CRP" fill="var(--ink)" />
            <Line dataKey="erp" name="Implied ERP" stroke="var(--chart-1)" strokeWidth={3} dot={{ r: 4 }} />
          </ComposedChart>
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
    </div>
  );
}
