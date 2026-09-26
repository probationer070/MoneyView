import { CASE_FIELDS, SEGMENT_FIELDS, formatWire } from "../caseFields";
import type { CaseRecord } from "../caseTypes";
import { Section } from "./Section";

const num = (value: unknown) => (typeof value === "number" ? value : null);

export function InputsSection({ record }: { record: CaseRecord }) {
  return (
    <Section title="Inputs" testId="case-inputs">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {CASE_FIELDS.map((m) => (
          <div key={m.field} data-testid={`input-case.${m.field}`} className="flex justify-between gap-3 border-b border-[var(--border)] py-1">
            <dt className="text-[var(--text-secondary)]">{m.label}</dt>
            <dd className="tabular-nums text-[var(--text-primary)]">{formatWire(m, num(record[m.field]))}</dd>
          </div>
        ))}
      </dl>
      {record.segments.map((segment) => (
        <div key={segment.name} className="mt-5">
          <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Segment: {segment.name}</h3>
          <ul className="mt-2 flex flex-col text-sm">
            {SEGMENT_FIELDS.map((m) => {
              const narrative = segment.narratives.find((n) => n.input_field === m.field);
              return (
                <li key={m.field} data-testid={`input-segment.${segment.name}.${m.field}`} className="border-b border-[var(--border)] py-1">
                  <div className="flex justify-between gap-3">
                    <span className="text-[var(--text-secondary)]">{m.label}</span>
                    <span className="tabular-nums text-[var(--text-primary)]">{formatWire(m, num(segment[m.field]))}</span>
                  </div>
                  {narrative && (
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                      “{narrative.claim}” · {narrative.three_p} · {narrative.confidence}
                      {narrative.evidence_source ? ` · ${narrative.evidence_source}` : ""}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </Section>
  );
}
