"use client";

import type { ReactNode } from "react";
import { ChartPanelFrame } from "@/components/charts/ChartPanelFrame";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";

type ChartGuardState = "ready" | "empty" | "invalid";

interface ChartGuardProps {
  title: string;
  description: string;
  state: ChartGuardState;
  emptyTitle: string;
  emptyDescription: string;
  invalidTitle: string;
  invalidDescription: string;
  warnings?: string[];
  /** Pixels, or "fill" to take the height the parent gives (never below the chart minimum). */
  chartHeight?: number | "fill";
  legend?: ReactNode;
  children: ReactNode;
}

export function ChartGuard({
  title,
  description,
  state,
  emptyTitle,
  emptyDescription,
  invalidTitle,
  invalidDescription,
  warnings = [],
  chartHeight = 320,
  legend,
  children,
}: ChartGuardProps) {
  const fill = chartHeight === "fill";
  return (
    <ChartPanelFrame
      title={title}
      description={description}
      empty={state !== "ready"}
      emptyTitle={state === "invalid" ? invalidTitle : emptyTitle}
      emptyDescription={state === "invalid" ? invalidDescription : emptyDescription}
      className={fill ? "flex h-full min-h-0 flex-col" : "h-full"}
    >
      {legend ? <div className="mt-3">{legend}</div> : null}
      {warnings.length > 0 ? (
        <div className="mt-4 border border-[var(--status-warning-border)] bg-[var(--status-warning-surface)] px-3 py-2 type-small text-[var(--status-warning-ink)]">
          {warnings.join(" ")}
        </div>
      ) : null}
      <div
        className={fill ? "mt-4 min-h-[var(--component-chart-min-height)] flex-1" : "mt-4"}
        style={fill ? undefined : { height: chartHeight }}
      >
        <ResponsiveChart className="h-full w-full" minWidth={1} minHeight={1}>
          {children}
        </ResponsiveChart>
      </div>
    </ChartPanelFrame>
  );
}
