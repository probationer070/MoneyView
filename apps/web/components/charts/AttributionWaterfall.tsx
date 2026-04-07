"use client";

import React from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface AttributionWaterfallProps {
  data: Array<{ name: string; value: number }>;
}

const CHART_INITIAL_DIMENSION = { width: 1, height: 1 };

export function AttributionWaterfall({ data }: AttributionWaterfallProps) {
  const formatted = data.map((row) => ({
    ...row,
    bps: row.value * 10000,
  }));

  return (
    <div className="bg-[var(--surface-panel)] rounded-[var(--radius)] border border-[var(--border)] p-4 shadow-sm h-[320px] min-h-[320px] min-w-0">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Attribution Effects (bps)</h3>
      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={CHART_INITIAL_DIMENSION}>
        <BarChart data={formatted}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(value) => `${Number(value ?? 0).toFixed(2)} bps`}
            contentStyle={{ borderRadius: 8, border: "1px solid var(--border)" }}
          />
          <Bar
            dataKey="bps"
            radius={[6, 6, 0, 0]}
            fill="var(--accent)"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
