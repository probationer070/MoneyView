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
  sm: "text-[length:var(--type-metric-md)] font-semibold",
  md: "text-[length:var(--type-metric-md)] font-semibold",
  lg: "text-[length:var(--type-metric-lg)] font-bold",
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
      <span className="text-[length:var(--type-label)] font-medium text-[var(--text-muted)] leading-tight tracking-wide">
        {label}
      </span>

      {loading ? (
        <div className="h-8 w-24 rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] animate-pulse" />
      ) : (
        <span
          className={clsx(
            "text-[var(--text-primary)] leading-none tabular-nums",
            valueSizeMap[size],
          )}
          style={{ letterSpacing: size === "lg" ? "-0.015em" : "-0.01em" }}
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
