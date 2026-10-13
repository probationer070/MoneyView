"use client";

import clsx from "clsx";
import { SEGMENT_BUTTON, SEGMENT_CONTAINER, SEGMENT_SELECTED, SEGMENT_UNSELECTED } from "@/components/ui/ToggleGroup";

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
        SEGMENT_CONTAINER,
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
              SEGMENT_BUTTON,
              selected ? SEGMENT_SELECTED : SEGMENT_UNSELECTED
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
