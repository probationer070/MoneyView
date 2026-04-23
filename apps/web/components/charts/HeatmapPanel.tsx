"use client";

import { heatColor } from "@/lib/chartConfig";
import { ChartPanelFrame } from "@/components/charts/ChartPanelFrame";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

export interface HeatmapCell {
  x: string;
  y: string;
  value: number;
}

interface HeatmapPanelProps {
  data: HeatmapCell[];
  xLabels: string[];
  yLabels: string[];
  title?: string;
  description?: string;
  loading?: boolean;
  errorMessage?: string | null;
  staleLabel?: string;
  lastUpdatedLabel?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function HeatmapPanel({
  data,
  xLabels,
  yLabels,
  title,
  description,
  loading = false,
  errorMessage,
  staleLabel,
  lastUpdatedLabel,
  emptyTitle = "No heatmap data available",
  emptyDescription = "Run the correlation analysis or refresh the source data to populate this matrix.",
}: HeatmapPanelProps) {
  const getCellColor = (x: string, y: string) => {
    const cell = data.find((d) => d.x === x && d.y === y);
    if (!cell) return "transparent";
    if (x === y) return "var(--chart-positive)";
    return heatColor(cell.value);
  };

  const getCellValue = (x: string, y: string) => {
    const cell = data.find((d) => d.x === x && d.y === y);
    return cell ? cell.value.toFixed(2) : "0.00";
  };

  return (
    <ErrorBoundary>
      <ChartPanelFrame
        title={title}
        description={description}
        loading={loading}
        errorMessage={errorMessage}
        staleLabel={staleLabel}
        lastUpdatedLabel={lastUpdatedLabel}
        empty={!data || data.length === 0}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
        className="h-full flex flex-col"
      >
        <div className="mt-4 flex-grow overflow-hidden rounded-[var(--radius)] border border-[var(--border)]">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="bg-[var(--surface-muted)] text-center">
                <th className="p-3"></th>
                {xLabels.map((x) => (
                  <th key={`head-${x}`} className="p-3 text-[var(--text-primary)]">
                    {x.replace("Asset ", "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {yLabels.map((y) => (
                <tr key={`row-${y}`} className="border-t border-[var(--border)]">
                  <td className="p-3 text-center font-bold text-[var(--text-primary)] bg-[var(--surface-muted)]">
                    {y.replace("Asset ", "")}
                  </td>
                  {xLabels.map((x) => (
                    <td
                      key={`cell-${y}-${x}`}
                      className="p-3 text-center font-bold text-[var(--text-primary)]"
                      style={{ backgroundColor: getCellColor(x, y) }}
                    >
                      {getCellValue(x, y)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartPanelFrame>
    </ErrorBoundary>
  );
}
