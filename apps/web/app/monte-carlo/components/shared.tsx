"use client";

import { InfoTooltip } from "@/components/ui/InfoTooltip";
import clsx from "clsx";

// Shared chart constants and formatter helpers used across all Monte Carlo sections.
export const CHART_INITIAL_DIMENSION = { width: 720, height: 320 };
export const TEN_THOUSAND_KRW = 10_000;

export function pct(value: number) {
  return `${value.toFixed(2)}%`;
}

export function krwTenThousands(value: number) {
  return `${(value / TEN_THOUSAND_KRW).toLocaleString(undefined, { maximumFractionDigits: 0 })} M KRW`;
}

export function numberText(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function krwLossFromPercent(principal: number, lossPercent: number) {
  return krwTenThousands(principal * (lossPercent / 100));
}

export function krw(value: number) {
  return `KRW ${Math.round(value).toLocaleString()}`;
}

// Shared navigation and form primitives keep styling consistent after the file split.
export function TabButton({
  active,
  label,
  description,
  onClick,
}: {
  active: boolean;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-[var(--radius)] border px-4 py-3 text-left transition",
        active
          ? "border-[var(--accent)] bg-[var(--surface)] text-white shadow-sm"
          : "border-[var(--border)] bg-white text-[var(--text-primary)] hover:border-[var(--accent)]",
      )}
    >
      <div className="text-sm font-black">{label}</div>
      <div className={clsx("mt-1 text-xs", active ? "text-white/85" : "text-[var(--text-muted)]")}>{description}</div>
    </button>
  );
}

export function NumericField({
  label,
  value,
  onChange,
  suffix,
  step = 1,
  min,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  step?: number;
  min?: number;
}) {
  return (
    <label className="grid gap-1 text-xs font-bold text-[var(--text-primary)]">
      {label}
      <div className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2">
        <input
          type="number"
          value={value}
          min={min}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full bg-transparent text-sm font-bold outline-none"
        />
        {suffix && <span className="text-[var(--text-muted)]">{suffix}</span>}
      </div>
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
    <label className="grid gap-1 text-xs font-bold text-[var(--text-primary)]">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-sm font-bold outline-none"
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

export function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 shadow-sm">
      <div className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className="mt-2 text-2xl font-black text-[var(--text-primary)]">{value}</div>
      <div className="mt-1 text-xs text-[var(--text-muted)]">{detail}</div>
    </div>
  );
}

export function PercentileIndicator({
  label,
  value,
  colorClass,
  description,
}: {
  label: string;
  value: string;
  colorClass: string;
  description: string;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
        <span className={clsx("inline-block h-2.5 w-2.5 rounded-full", colorClass)} />
        <InfoTooltip label={label} description={description} />
      </div>
      <div className="mt-2 text-lg font-black text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

export function LegendItem({
  label,
  colorClass,
  lineClass = "",
}: {
  label: string;
  colorClass?: string;
  lineClass?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-muted)]">
      <span className={clsx("inline-block h-2.5 w-6 rounded-full", colorClass, lineClass)} />
      <span>{label}</span>
    </div>
  );
}

export function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-t border-[var(--border)]">
      <td className="p-3 font-bold text-[var(--text-primary)]">{label}</td>
      <td className="p-3 text-right text-[var(--text-primary)]">{value}</td>
    </tr>
  );
}
