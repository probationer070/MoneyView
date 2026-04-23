"use client";

import { InfoTooltip } from "@/components/ui/InfoTooltip";

export function RangeControl({
  label,
  value,
  min,
  max,
  step,
  suffix = "%",
  description,
  onDetailClick,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  description?: string;
  onDetailClick?: () => void;
  onChange: (value: number) => void;
}) {
  return (
    <label className="group/range block space-y-2">
      <div className="flex items-center justify-between text-xs font-semibold">
        <span className="text-[var(--text-muted)] transition-colors group-hover/range:text-[var(--text-primary)]">
          {onDetailClick ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                onDetailClick();
              }}
              className="text-left underline decoration-dotted underline-offset-4 hover:text-[var(--surface)]"
            >
              {description ? <InfoTooltip label={label} description={description} /> : label}
            </button>
          ) : description ? (
            <InfoTooltip label={label} description={description} />
          ) : (
            label
          )}
        </span>
        <span className="text-[var(--text-primary)] transition-colors group-hover/range:text-[var(--surface)]">
          {value.toFixed(1)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[var(--surface)]"
      />
    </label>
  );
}
