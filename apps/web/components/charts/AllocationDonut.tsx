"use client";

import React from "react";
import { Cell, Pie, PieChart, Tooltip } from "recharts";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { CHART_COLOR_SEQUENCE, withTooltipProps } from "@/lib/chartConfig";
import { ChartPanelFrame } from "@/components/charts/ChartPanelFrame";
import { useLocale, useT } from "@/lib/i18n/locale";
import { formatNumber } from "@/lib/format";
import { foldAllocation } from "@/components/charts/allocationFold";

interface AllocationDonutProps {
  data: Array<{ name: string; value: number }>;
}

// Named sectors take chart-1..3 and chart-5. The folded "Other" slice is always chart-4 (M4).
const NAMED_FILLS = [
  CHART_COLOR_SEQUENCE[0],
  CHART_COLOR_SEQUENCE[1],
  CHART_COLOR_SEQUENCE[2],
  CHART_COLOR_SEQUENCE[4],
  CHART_COLOR_SEQUENCE[3],
];
const OTHER_FILL = CHART_COLOR_SEQUENCE[3];

export function AllocationDonut({ data }: AllocationDonutProps) {
  const { locale } = useLocale();
  const t = useT();
  const safeData = data.filter((d) => Number.isFinite(d.value) && d.value > 0);
  const slices = foldAllocation(safeData, t("common.other"));

  return (
    <ChartPanelFrame
      title="Sector Allocation"
      empty={safeData.length === 0}
      emptyTitle="No allocation data available"
      emptyDescription="Add holdings with positive weights to render the sector allocation donut."
      className="min-h-[320px] min-w-0 bg-[var(--surface-raised)]"
    >
      <div className="mt-3 h-[220px] min-h-[220px]">
        <ResponsiveChart className="h-full w-full" minWidth={1} minHeight={1}>
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius={65}
              outerRadius={95}
              paddingAngle={2}
            >
              {slices.map((entry, index) => (
                <Cell key={entry.name} fill={entry.folded ? OTHER_FILL : NAMED_FILLS[index % NAMED_FILLS.length]} />
              ))}
            </Pie>
            <Tooltip
              {...withTooltipProps()}
              formatter={(value) => formatNumber(Number(value ?? 0), "percent", { locale })}
            />
          </PieChart>
        </ResponsiveChart>
      </div>
    </ChartPanelFrame>
  );
}
