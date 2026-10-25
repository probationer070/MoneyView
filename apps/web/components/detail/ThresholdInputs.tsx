"use client";

import { useState } from "react";
import { PRICE_RANGE, VOLUME_RANGE, clampThreshold, type Thresholds } from "@/lib/detail/thresholds";
import { useT } from "@/lib/i18n/locale";

const INPUT = "w-16 rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface)] px-2 py-1 type-mono text-[var(--ink)]";

interface FieldProps {
  testId: string;
  label: string;
  value: number;
  range: { min: number; max: number };
  onChange: (value: number) => void;
}

/** A numeric field that applies every valid keystroke at once and snaps the shown text into range on blur. */
function Field({ testId, label, value, range, onChange }: FieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="flex items-center gap-2 type-small text-[var(--ink-muted)]">
      {label}
      <input
        type="number"
        data-testid={testId}
        className={INPUT}
        step={0.1}
        min={range.min}
        max={range.max}
        value={draft ?? String(value)}
        onChange={(event) => {
          setDraft(event.target.value);
          const typed = event.target.valueAsNumber;
          if (Number.isFinite(typed)) onChange(clampThreshold(typed, range, value));
        }}
        onBlur={() => setDraft(null)}
      />
    </label>
  );
}

/** The two big-move thresholds. Changes apply immediately; the parent owns the values. */
export function ThresholdInputs({ value, onChange }: { value: Thresholds; onChange: (next: Thresholds) => void }) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-3" title={t("detail.thresholdHint")}>
      <Field testId="threshold-price" label={t("detail.priceThreshold")} value={value.price} range={PRICE_RANGE} onChange={(price) => onChange({ ...value, price })} />
      <Field testId="threshold-volume" label={t("detail.volumeThreshold")} value={value.volume} range={VOLUME_RANGE} onChange={(volume) => onChange({ ...value, volume })} />
    </div>
  );
}
