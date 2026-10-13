"use client";

import React from "react";
import { Cell, Pie, PieChart, Tooltip } from "recharts";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { withTooltipProps } from "@/lib/chartConfig";
import { ChartPanelFrame } from "@/components/charts/ChartPanelFrame";

interface AllocationDonutProps {
  data: Array<{ name: string; value: number }>;
}

const COLORS = [
  "var(--chart-primary)",
  "var(--chart-secondary)",
  "var(--chart-tertiary)",
  "var(--chart-muted)",
  "var(--chart-label)",
  "var(--chart-ink)",
];
export function AllocationDonut({ data }: AllocationDonutProps) {
  const safeData = data.filter((d) => Number.isFinite(d.value) && d.value > 0);

  return (
    <ChartPanelFrame
      title="Sector Allocation"
      empty={safeData.length === 0}
      emptyTitle="No allocation data available"
      emptyDescription="Add holdings with positive weights to render the sector allocation donut."
      className="min-h-[320px] min-w-0 bg-[var(--surface-panel)]"
    >
      <div className="mt-3 h-[220px] min-h-[220px]">
        <ResponsiveChart className="h-full w-full" minWidth={1} minHeight={1}>
          <PieChart>
            <Pie
              data={safeData}
              dataKey="value"
              nameKey="name"
              innerRadius={65}
              outerRadius={95}
              paddingAngle={2}
            >
              {safeData.map((entry, index) => (
                <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              {...withTooltipProps()}
              formatter={(value) => `${(Number(value ?? 0) * 100).toFixed(1)}%`}
            />
          </PieChart>
        </ResponsiveChart>
      </div>
    </ChartPanelFrame>
  );
}
