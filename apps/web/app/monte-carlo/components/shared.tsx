"use client";

import { fieldInputClass } from "@/components/ui/InlineField";
import { formatNumber, type FormatLocale } from "@/lib/format";
import clsx from "clsx";

// Shared formatter helpers used across all Monte Carlo sections.
// Percent arguments are in percent units (8.5 means 8.5%), so they are divided by 100 for formatNumber.
export function pct(value: number, locale: FormatLocale) {
  return formatNumber(value / 100, "percent", { digits: 2, locale });
}

export function numberText(value: number, locale: FormatLocale) {
  return formatNumber(value, "ratio", { locale });
}

// Shared form primitives keep styling consistent after the file split.
export function NumericField({
  label,
  value,
  onChange,
  suffix,
  step = 1,
  min,
  help,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  step?: number;
  min?: number;
  help?: string;
}) {
  return (
    <label className="type-label grid gap-1 text-[var(--ink)]">
      {label}
      <div className="flex items-center gap-2 rounded-[var(--radius-1)] border border-[var(--line-strong)] bg-[var(--surface-sunken)] px-3 py-2">
        <input
          type="number"
          value={value}
          min={min}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label={label}
          className="type-mono w-full bg-transparent text-[var(--ink)] outline-none"
        />
        {suffix && <span className="type-small text-[var(--ink-muted)]">{suffix}</span>}
      </div>
      {help ? <span className="type-small text-[var(--ink-muted)]">{help}</span> : null}
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="type-label grid gap-1 text-[var(--ink)]">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className={fieldInputClass}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function LegendItem({
  label,
  colorClass,
  lineClass = "",
  swatchOpacity,
}: {
  label: string;
  colorClass?: string;
  lineClass?: string;
  swatchOpacity?: number;
}) {
  return (
    <div className="flex items-center gap-2 type-small text-[var(--ink-muted)]">
      <span className={clsx("inline-block h-2.5 w-6", colorClass, lineClass)} style={swatchOpacity === undefined ? undefined : { opacity: swatchOpacity }} />
      <span>{label}</span>
    </div>
  );
}

export function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-t border-[var(--line)]">
      <td className="p-3 type-small text-[var(--ink)]">{label}</td>
      <td className="p-3 text-right type-mono text-[var(--ink)]">{value}</td>
    </tr>
  );
}

