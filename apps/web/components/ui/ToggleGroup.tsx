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
  sm: "min-h-6",
  md: "min-h-8",
};

// Shared with ViewToggle, the other segmented control (redesign .mv-seg).
export const SEGMENT_CONTAINER = "inline-flex flex-wrap items-center gap-0.5 rounded-[var(--radius-1)] border border-[var(--line-strong)] p-0.5";
export const SEGMENT_BUTTON = "type-caption inline-flex items-center justify-center rounded-[var(--radius-1)] px-3 py-1 uppercase transition-colors duration-[var(--duration-normal)]";
export const SEGMENT_SELECTED = "bg-[var(--ink)] text-[var(--bg)]";
export const SEGMENT_UNSELECTED = "text-[var(--ink-muted)] hover:text-[var(--ink)]";

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
        SEGMENT_CONTAINER,
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
              SEGMENT_BUTTON,
              sizeStyles[size],
              selected ? SEGMENT_SELECTED : SEGMENT_UNSELECTED
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
