import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

interface DeltaBadgeProps {
  value: number;
  className?: string;
}

export function DeltaBadge({ value, className }: DeltaBadgeProps) {
  const isPositive = value > 0;
  const isNegative = value < 0;

  return (
    <div
      className={clsx(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-sm font-medium",
        isPositive ? "text-[var(--delta-up)] bg-[var(--delta-up)]/10" : "",
        isNegative ? "text-[var(--delta-down)] bg-[var(--delta-down)]/10" : "",
        !isPositive && !isNegative ? "text-[var(--text-muted)] bg-[var(--surface-muted)]" : "",
        className
      )}
    >
      {isPositive && <ArrowUpRight className="h-4 w-4" />}
      {isNegative && <ArrowDownRight className="h-4 w-4" />}
      {!isPositive && !isNegative && <Minus className="h-4 w-4" />}
      <span>{isPositive ? "+" : ""}{value.toFixed(1)}%</span>
    </div>
  );
}
