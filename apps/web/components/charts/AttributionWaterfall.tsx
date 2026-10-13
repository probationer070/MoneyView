"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { ChartPanelFrame } from "@/components/charts/ChartPanelFrame";
import { useLocale } from "@/lib/i18n/locale";
import { formatNumber } from "@/lib/format";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { GRID_STYLE, fmtPctTick, withAxisProps, withCategoryAxisProps, withTooltipProps } from "@/lib/chartConfig";

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
  return formatNumber(value, "percent", { digits: 2 });
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
  const { locale } = useLocale();
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
    <>
      <ChartPanelFrame
        empty={formatted.length === 0}
        emptyTitle="No attribution effects available"
        emptyDescription="Refresh attribution results to compare allocation, selection, interaction, and active return."
        className="min-h-[320px] min-w-0 bg-[var(--surface-raised)]"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="type-body text-[var(--ink)]">
            <InfoTooltip
              label="Attribution Effects (%)"
              description="Brinson-style attribution decomposes active return into allocation, selection, and interaction effects. Positive percentages add value versus the benchmark; negative percentages detract."
            />
          </h3>
          <button
            type="button"
            onClick={() => setIsDetailOpen(true)}
            className="rounded-[var(--radius-1)] border border-[var(--line)] px-2 py-1 type-small text-[var(--ink-muted)] transition hover:border-[var(--brand)] hover:text-[var(--ink)]"
          >
            Details
          </button>
        </div>
        <div className="h-[220px] min-h-[220px]">
          <ResponsiveChart className="h-full w-full" minWidth={1} minHeight={1}>
            <BarChart data={formatted}>
              <CartesianGrid {...GRID_STYLE} vertical={false} />
              <XAxis dataKey="name" {...withCategoryAxisProps()} />
              <YAxis {...withAxisProps({ tickFormatter: (value: number | string) => fmtPctTick(Number(value), 0) })} />
              <Tooltip
                {...withTooltipProps()}
                formatter={(value) => formatNumber(Number(value ?? 0) / 100, "percent", { digits: 2, locale })}
              />
              <Bar
                dataKey="percentage"
                radius={[6, 6, 0, 0]}
                fill="var(--brand)"
              />
            </BarChart>
          </ResponsiveChart>
        </div>
      </ChartPanelFrame>
      {isDetailOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)] p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Attribution effects methodology"
          onMouseDown={() => setIsDetailOpen(false)}
        >
          <div
            className="max-h-[88vh] w-full max-w-3xl overflow-y-auto border border-[var(--line)] bg-[var(--surface-raised)] p-5"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] pb-4">
              <div>
                <h2 className="type-panel-title text-[var(--ink)]">Attribution Effects Methodology</h2>
                <p className="mt-1 type-body text-[var(--ink-muted)]">
                  X-axis values explain which source of active return added or detracted from benchmark-relative performance.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDetailOpen(false)}
                className="rounded-[var(--radius-1)] border border-[var(--line)] px-3 py-1 type-body text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {effectDetails.map((effect) => (
                <section key={effect.name} className="border border-[var(--line)] p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                    <h3 className="type-body text-[var(--ink)]">{effect.name}</h3>
                    <div className={`type-body tabular-nums ${effect.value >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}>
                      {percentText(effect.value)}
                    </div>
                  </div>
                  <p className="mt-2 type-body text-[var(--ink)]">{effect.represents}</p>
                  <p className="mt-2 type-small text-[var(--ink-muted)]">
                    <span className="text-[var(--ink)]">Calculation: </span>
                    {effect.calculation}
                  </p>
                  <p className="mt-2 type-small text-[var(--ink-muted)]">
                    <span className="text-[var(--ink)]">Largest observed driver: </span>
                    {effect.driver}
                  </p>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
