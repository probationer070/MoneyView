import type { FieldTarget } from "../caseFields";
import { useT } from "@/lib/i18n/locale";

const control =
  "rounded-[var(--radius-1)] border border-[var(--line)] bg-transparent px-2 py-1 text-[var(--ink)]";

export function FieldPicker({ targets, value, onChange }: { targets: FieldTarget[]; value: string; onChange: (key: string) => void }) {
  const tr = useT();
  const segments = [...new Set(targets.filter((t) => t.scope === "segment").map((t) => t.segment as string))];
  return (
    <label className="flex flex-col gap-1 type-small text-[var(--ink-secondary)]">
      {tr("cases.field.label")}
      <select value={value} onChange={(event) => onChange(event.target.value)} className={control}>
        <option value="">{tr("cases.field.choose")}</option>
        <optgroup label={tr("cases.field.caseGroup")}>
          {targets.filter((t) => t.scope === "case").map((t) => (
            <option key={t.key} value={t.key}>{tr(t.meta.labelKey)}</option>
          ))}
        </optgroup>
        {segments.map((segment) => (
          <optgroup key={segment} label={tr("cases.field.segment", { name: segment })}>
            {targets.filter((t) => t.segment === segment).map((t) => (
              <option key={t.key} value={t.key}>{tr(t.meta.labelKey)}{t.meta.narrated ? tr("cases.field.narrated") : ""}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export { control as controlClass };
