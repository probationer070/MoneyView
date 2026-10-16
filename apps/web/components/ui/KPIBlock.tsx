"use client";

import clsx from "clsx";
import { DeltaBadge } from "@/components/ui/DeltaBadge";

type KPISize = "sm" | "md" | "lg";

interface KPIBlockProps {
  label: string;
  value: string | number;
  delta?: number;
  size?: KPISize;
  onClick?: () => void;
  loading?: boolean;
  className?: string;
}

const valueSizeMap: Record<KPISize, string> = {
  sm: "type-figure-md",
  md: "type-figure-md",
  lg: "type-figure",
};

export function KPIBlock({
  label,
  value,
  delta,
  size = "md",
  onClick,
  loading = false,
  className,
}: KPIBlockProps) {
  return (
    <div
      className={clsx(
        "flex flex-col gap-1",
        onClick && "cursor-pointer",
        className
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") onClick(); } : undefined}
    >
      <span className="type-label text-[var(--ink-secondary)]">
        {label}
      </span>

      {loading ? (
        <div className="h-8 w-24 bg-[var(--surface)] animate-pulse" />
      ) : (
        <span
          className={clsx(
            "text-[var(--ink)]",
            valueSizeMap[size],
          )}
        >
          {value}
        </span>
      )}

      {delta !== undefined && !loading && (
        <DeltaBadge value={delta} className="self-start mt-0.5" />
      )}
    </div>
  );
}
