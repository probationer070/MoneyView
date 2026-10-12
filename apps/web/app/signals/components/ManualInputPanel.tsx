"use client";

import { useState } from "react";
import type { ManualState, SignalResult, SignalRule } from "../../../../../packages/shared-types";
import { SIGNALS_COPY as T } from "../copy";

type Save = (input: { ruleId: string; state: ManualState; note: string }) => Promise<unknown>;

function ManualRow({ rule, current, onSave }: { rule: SignalRule; current?: SignalResult; onSave: Save }) {
  const [state, setState] = useState<ManualState | "">(current && current.state !== "stale" ? current.state : "");
  const [note, setNote] = useState(current?.note ?? "");
  const [saveFailed, setSaveFailed] = useState(false);
  const label = rule.label.en;
  return (
    <form data-testid={`manual-${rule.id}`} className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!state) return;
        setSaveFailed(false);
        onSave({ ruleId: rule.id, state, note }).catch(() => setSaveFailed(true));
      }}>
      <span className="w-56 text-sm">{label}</span>
      <select aria-label={`${label} state`} value={state} onChange={(e) => setState(e.target.value as ManualState)}
        className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 py-1 text-sm">
        <option value="" disabled>{T.notSet}</option>
        {(["triggered", "near", "not_triggered"] as const).map((s) => <option key={s} value={s}>{T.states[s]}</option>)}
      </select>
      <input aria-label={`${label} ${T.note}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)}
        placeholder={T.note} className="flex-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 py-1 text-sm" />
      <button type="submit" disabled={!state}
        className="rounded-[var(--radius-sm)] border border-[var(--border-accent)] px-3 py-1 text-sm disabled:opacity-50">{T.save}</button>
      {saveFailed ? <p role="alert" className="w-full text-xs text-[var(--state-error)]">{T.saveFailed}</p> : null}
    </form>
  );
}

export function ManualInputPanel({ rules, results, onSave }: { rules: SignalRule[]; results: SignalResult[]; onSave: Save }) {
  return (
    <section aria-label="manual" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{T.manual}</h2>
      {rules.map((rule) => (
        <ManualRow key={rule.id} rule={rule} current={results.find((r) => r.rule_id === rule.id)} onSave={onSave} />
      ))}
    </section>
  );
}
