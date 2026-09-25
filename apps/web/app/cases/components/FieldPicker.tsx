import type { FieldTarget } from "../caseFields";

const control =
  "rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-transparent px-2 py-1 text-[var(--text-primary)]";

export function FieldPicker({ targets, value, onChange }: { targets: FieldTarget[]; value: string; onChange: (key: string) => void }) {
  const segments = [...new Set(targets.filter((t) => t.scope === "segment").map((t) => t.segment as string))];
  return (
    <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
      Field
      <select value={value} onChange={(event) => onChange(event.target.value)} className={control}>
        <option value="">Choose…</option>
        <optgroup label="Case">
          {targets.filter((t) => t.scope === "case").map((t) => (
            <option key={t.key} value={t.key}>{t.meta.label}</option>
          ))}
        </optgroup>
        {segments.map((segment) => (
          <optgroup key={segment} label={`Segment: ${segment}`}>
            {targets.filter((t) => t.segment === segment).map((t) => (
              <option key={t.key} value={t.key}>{t.meta.label}{t.meta.narrated ? " (narrated)" : ""}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export { control as controlClass };
