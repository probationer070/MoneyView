"use client";

import React from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

interface AllocationDonutProps {
  data: Array<{ name: string; value: number }>;
}

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];
const CHART_INITIAL_DIMENSION = { width: 1, height: 1 };

export function AllocationDonut({ data }: AllocationDonutProps) {
  const safeData = data.filter((d) => Number.isFinite(d.value) && d.value > 0);

  return (
    <div className="bg-[var(--surface-panel)] rounded-[var(--radius)] border border-[var(--border)] p-4 shadow-sm h-[320px] min-h-[320px] min-w-0">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Sector Allocation</h3>
      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={CHART_INITIAL_DIMENSION}>
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
            formatter={(value) => `${(Number(value ?? 0) * 100).toFixed(2)}%`}
            contentStyle={{ borderRadius: 8, border: "1px solid var(--border)" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
