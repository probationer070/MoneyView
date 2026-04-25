"use client";

import clsx from "clsx";

type ToggleGroupSize = "sm" | "md";

interface ToggleGroupOption {
  value: string;
  label: string;
}

interface ToggleGroupProps {
  options: ToggleGroupOption[];
  value: string;
  onChange: (value: string) => void;
  size?: ToggleGroupSize;
  ariaLabel?: string;
  className?: string;
}

const sizeStyles: Record<ToggleGroupSize, string> = {
  sm: "min-h-8 px-[var(--space-3)] text-[length:var(--type-helper)]",
  md: "min-h-9 px-[var(--space-4)] text-[length:var(--type-label)]",
};

export function ToggleGroup({
  options,
  value,
  onChange,
  size = "md",
  ariaLabel = "Toggle group",
  className,
}: ToggleGroupProps) {
  return (
    <div
      className={clsx(
        "inline-flex flex-wrap items-center gap-[var(--space-1)] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-muted)] p-[var(--space-1)]",
        className
      )}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            className={clsx(
              "inline-flex items-center justify-center rounded-[calc(var(--radius-md)-2px)] font-medium transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-info)] focus-visible:ring-offset-1",
              sizeStyles[size],
              selected
                ? "border border-transparent bg-[var(--bg-surface)] text-[var(--text-primary)]"
                : "border border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
