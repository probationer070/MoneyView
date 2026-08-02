import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

interface DeltaBadgeProps {
  value: number | null | undefined;
  className?: string;
}

export function DeltaBadge({ value, className }: DeltaBadgeProps) {
  const numericValue = typeof value === "number" && Number.isFinite(value) ? value : null;
  const isPositive = (numericValue ?? 0) > 0;
  const isNegative = (numericValue ?? 0) < 0;

  // A span, not a div: this is already `inline-flex`, so the box is identical, and it lets
  // the badge sit inside a <button> or other phrasing-only context. StockTile needs that.
  return (
    <span
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
      <span>
        {numericValue == null ? "N/A" : `${isPositive ? "+" : ""}${numericValue.toFixed(1)}%`}
      </span>
    </span>
  );
}
