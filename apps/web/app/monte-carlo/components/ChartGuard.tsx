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
  chartHeight?: number;
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
  return (
    <ChartPanelFrame
      title={title}
      description={description}
      empty={state !== "ready"}
      emptyTitle={state === "invalid" ? invalidTitle : emptyTitle}
      emptyDescription={state === "invalid" ? invalidDescription : emptyDescription}
      className="h-full"
    >
      {legend ? <div className="mt-3">{legend}</div> : null}
      {warnings.length > 0 ? (
        <div className="mt-4 rounded-[var(--radius)] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {warnings.join(" ")}
        </div>
      ) : null}
      <div className="mt-4" style={{ height: chartHeight }}>
        <ResponsiveChart className="h-full w-full" minWidth={1} minHeight={1}>
          {children}
        </ResponsiveChart>
      </div>
    </ChartPanelFrame>
  );
}
