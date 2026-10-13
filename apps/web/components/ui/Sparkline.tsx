"use client";

import { LineChart, Line, YAxis } from "recharts";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";

type SparkTone = "up" | "down" | "brand" | "neutral";
const TONE_COLOR: Record<SparkTone, string> = { up: "var(--up)", down: "var(--down)", brand: "var(--brand)", neutral: "var(--ink-muted)" };

interface SparklineProps {
  data: number[];
  /** Explicit stroke; wins over tone. */
  color?: string;
  /** Default: the direction of the whole window (last vs first), as in the redesign. */
  tone?: SparkTone;
  height?: number;
}

export function Sparkline({ data, color, tone, height = 40 }: SparklineProps) {
  const chartData = data.map((val, i) => ({ value: val, index: i }));
  if (chartData.length === 0) {
    return <div style={{ height, width: "100%", minWidth: 1 }} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  // Add a little padding to the domain so strokes don't get clipped
  const domain = [min - (max - min) * 0.1, max + (max - min) * 0.1];
  const stroke = color ?? TONE_COLOR[tone ?? (data[data.length - 1] >= data[0] ? "up" : "down")];

  return (
    <ResponsiveChart style={{ height, width: "100%", minWidth: 1 }} minWidth={1} minHeight={1}>
        <LineChart data={chartData}>
          <YAxis domain={domain} hide />
          <Line
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
    </ResponsiveChart>
  );
}
