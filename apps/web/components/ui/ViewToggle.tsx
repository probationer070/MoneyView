"use client";

import clsx from "clsx";

export type ViewMode = "chart" | "table";

interface ViewToggleProps {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
  className?: string;
}

const options: Array<{ value: ViewMode; label: string }> = [
  { value: "chart", label: "Graph" },
  { value: "table", label: "Table" },
];

export function ViewToggle({ value, onChange, className }: ViewToggleProps) {
  return (
    <div
      className={clsx(
        "inline-flex rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-1",
        className
      )}
      role="group"
      aria-label="View mode"
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={clsx(
              "rounded-md px-3 py-1.5 text-[length:var(--type-label)] font-medium transition-colors",
              selected
                ? "bg-[var(--surface)] text-white"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            )}
            aria-pressed={selected}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
