"use client";

import clsx from "clsx";
import { KPIBlock } from "@/components/ui/KPIBlock";
import { ComponentProps } from "react";

interface MetricGridProps {
  metrics: ComponentProps<typeof KPIBlock>[];
  columns?: 2 | 3 | 4;
  className?: string;
}

export function MetricGrid({ metrics, columns = 3, className }: MetricGridProps) {
  return (
    <div
      className={clsx(
        "grid gap-4",
        {
          "grid-cols-2": columns === 2,
          "grid-cols-3": columns === 3,
          "grid-cols-4": columns === 4,
        },
        className
      )}
    >
      {metrics.map((metric, i) => (
        <KPIBlock key={i} {...metric} />
      ))}
    </div>
  );
}
