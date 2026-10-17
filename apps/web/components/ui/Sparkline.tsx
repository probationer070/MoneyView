"use client";

import { LineChart, Line, YAxis } from "recharts";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { usePrefersReducedMotion } from "@/lib/motion";
import { windowTone } from "@/lib/sparklineTone";
import { tokens } from "@/lib/tokens.generated";

type SparkTone = "up" | "down" | "brand" | "neutral";
const DRAW_MS = Number.parseFloat(tokens.duration.draw);
const TONE_COLOR: Record<SparkTone, string> = { up: "var(--up)", down: "var(--down)", brand: "var(--brand)", neutral: "var(--ink-muted)" };

interface SparklineProps {
  data: number[];
  /** Explicit stroke; wins over tone. */
  color?: string;
  /** Default: the direction of the whole window (last vs first), via windowTone. */
  tone?: SparkTone;
  height?: number;
  /** Opt-in: the line draws in on mount. Off under reduced motion. */
  draw?: boolean;
}

export function Sparkline({ data, color, tone, height = 40, draw = false }: SparklineProps) {
  const reduced = usePrefersReducedMotion();
  const chartData = data.map((val, i) => ({ value: val, index: i }));
  if (chartData.length === 0) {
    return <div style={{ height, width: "100%", minWidth: 1 }} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  // Add a little padding to the domain so strokes don't get clipped
  const domain = [min - (max - min) * 0.1, max + (max - min) * 0.1];
  const stroke = color ?? TONE_COLOR[tone ?? windowTone(data)];

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
            isAnimationActive={draw && !reduced}
            animationDuration={DRAW_MS}
            animationEasing="ease-out"
          />
        </LineChart>
    </ResponsiveChart>
  );
}
