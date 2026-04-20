"use client";

import { LineChart, Line, YAxis } from "recharts";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";

interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
}

export function Sparkline({ data, color = "var(--accent)", height = 40 }: SparklineProps) {
  const chartData = data.map((val, i) => ({ value: val, index: i }));
  if (chartData.length === 0) {
    return <div style={{ height, width: "100%", minWidth: 1 }} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  // Add a little padding to the domain so strokes don't get clipped
  const domain = [min - (max - min) * 0.1, max + (max - min) * 0.1];

  return (
    <ResponsiveChart style={{ height, width: "100%", minWidth: 1 }} minWidth={1} minHeight={1}>
        <LineChart data={chartData}>
          <YAxis domain={domain} hide />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
    </ResponsiveChart>
  );
}
