"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";

interface AttributionWaterfallProps {
  data: Array<{ name: string; value: number }>;
  sectorBreakdowns?: Array<{
    sector: string;
    allocation_effect: number;
    selection_effect: number;
    interaction_effect: number;
    active_contribution: number;
  }>;
}

function percentText(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function topSectorDriver(
  sectorBreakdowns: NonNullable<AttributionWaterfallProps["sectorBreakdowns"]>,
  key: "allocation_effect" | "selection_effect" | "interaction_effect" | "active_contribution",
) {
  const top = sectorBreakdowns
    .filter((row) => Number.isFinite(row[key]))
    .sort((a, b) => Math.abs(b[key]) - Math.abs(a[key]))[0];
  if (!top || Math.abs(top[key]) < 0.00005) return "No single sector materially dominated this effect.";
  return `Largest sector driver: ${top.sector} contributed ${percentText(top[key])}.`;
}

export function AttributionWaterfall({ data, sectorBreakdowns = [] }: AttributionWaterfallProps) {
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const formatted = data.map((row) => ({
    ...row,
    percentage: row.value * 100,
  }));

  const effectDetails = useMemo(() => {
    const values = Object.fromEntries(data.map((row) => [row.name, row.value]));
    return [
      {
        name: "Allocation",
        value: values.Allocation ?? 0,
        represents: "Whether the portfolio was overweight or underweight sectors versus the benchmark.",
        calculation: "Allocation_i = (portfolio weight_i - benchmark weight_i) x (benchmark sector return_i - total benchmark return); total allocation is the sum across sectors.",
        driver: topSectorDriver(sectorBreakdowns, "allocation_effect"),
      },
      {
        name: "Selection",
        value: values.Selection ?? 0,
        represents: "Whether selected holdings outperformed or underperformed their matched benchmark or sector return.",
        calculation: "Selection_i = benchmark weight_i x (portfolio sector return_i - benchmark sector return_i); total selection is the sum across sectors.",
        driver: topSectorDriver(sectorBreakdowns, "selection_effect"),
      },
      {
        name: "Interaction",
        value: values.Interaction ?? 0,
        represents: "The combined effect of active sector weights and active stock selection happening together.",
        calculation: "Interaction_i = (portfolio weight_i - benchmark weight_i) x (portfolio sector return_i - benchmark sector return_i); total interaction is the sum across sectors.",
        driver: topSectorDriver(sectorBreakdowns, "interaction_effect"),
      },
      {
        name: "Active Return",
        value: values["Active Return"] ?? 0,
        represents: "The total excess return of the portfolio versus the benchmark.",
        calculation: "Active Return = Portfolio Return - Benchmark Return = Allocation + Selection + Interaction.",
        driver: topSectorDriver(sectorBreakdowns, "active_contribution"),
      },
    ];
  }, [data, sectorBreakdowns]);

  useEffect(() => {
    if (!isDetailOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsDetailOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isDetailOpen]);

  return (
    <div className="bg-[var(--surface-panel)] rounded-[var(--radius)] border border-[var(--border)] p-4 shadow-sm h-[320px] min-h-[320px] min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          <InfoTooltip
            label="Attribution Effects (%)"
            description="Brinson-style attribution decomposes active return into allocation, selection, and interaction effects. Positive percentages add value versus the benchmark; negative percentages detract."
          />
        </h3>
        <button
          type="button"
          onClick={() => setIsDetailOpen(true)}
          className="rounded-[var(--radius)] border border-[var(--border)] px-2 py-1 text-xs font-semibold text-[var(--text-muted)] transition hover:border-[var(--surface)] hover:text-[var(--text-primary)]"
        >
          Details
        </button>
      </div>
      <ResponsiveChart minWidth={1} minHeight={1}>
        <BarChart data={formatted}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(value) => `${Number(value ?? 0).toFixed(2)}%`}
            contentStyle={{ borderRadius: 8, border: "1px solid var(--border)" }}
          />
          <Bar
            dataKey="percentage"
            radius={[6, 6, 0, 0]}
            fill="var(--accent)"
          />
        </BarChart>
      </ResponsiveChart>
      {isDetailOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Attribution effects methodology"
          onMouseDown={() => setIsDetailOpen(false)}
        >
          <div
            className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-[var(--radius)] bg-[var(--bg-surface)] p-5 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] pb-4">
              <div>
                <h2 className="text-lg font-black text-[var(--text-primary)]">Attribution Effects Methodology</h2>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  X-axis values explain which source of active return added or detracted from benchmark-relative performance.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDetailOpen(false)}
                className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {effectDetails.map((effect) => (
                <section key={effect.name} className="rounded-[var(--radius)] border border-[var(--border)] p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                    <h3 className="text-sm font-bold text-[var(--text-primary)]">{effect.name}</h3>
                    <div className={`text-sm font-black tabular-nums ${effect.value >= 0 ? "text-[var(--delta-up)]" : "text-[var(--delta-down)]"}`}>
                      {percentText(effect.value)}
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-[var(--text-primary)]">{effect.represents}</p>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">
                    <span className="font-bold text-[var(--text-primary)]">Calculation: </span>
                    {effect.calculation}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">
                    <span className="font-bold text-[var(--text-primary)]">Largest observed driver: </span>
                    {effect.driver}
                  </p>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
