import { CONFIDENCE_VALUES, THREE_P_VALUES, type Confidence, type ThreeP } from "../caseTypes";
import type { NarrativeState } from "../changeRows";
import { controlClass } from "./FieldPicker";

/**
 * A narrated field's reason. three_p has no default on purpose: the API refuses to pick an
 * epistemic confidence for the caller, so the form does not either.
 */
export function NarrativeInputs({
  value, onChange, withEvidence,
}: { value: NarrativeState; onChange: (next: NarrativeState) => void; withEvidence: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
      <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)] sm:col-span-2">
        Claim
        <input value={value.claim} onChange={(e) => onChange({ ...value, claim: e.target.value })} className={controlClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
        Three-P
        <select value={value.threeP} onChange={(e) => onChange({ ...value, threeP: e.target.value as ThreeP | "" })} className={controlClass}>
          <option value="">Choose…</option>
          {THREE_P_VALUES.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
        Confidence (optional)
        <select value={value.confidence} onChange={(e) => onChange({ ...value, confidence: e.target.value as Confidence | "" })} className={controlClass}>
          <option value="">Default (assumed)</option>
          {CONFIDENCE_VALUES.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </label>
      {withEvidence && (
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)] sm:col-span-4">
          Evidence source (optional)
          <input value={value.evidenceSource} onChange={(e) => onChange({ ...value, evidenceSource: e.target.value })} className={controlClass} />
        </label>
      )}
    </div>
  );
}
