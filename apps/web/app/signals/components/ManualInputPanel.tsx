"use client";

import { useState } from "react";
import type { ManualInputSaved, ManualState, SignalResult, SignalRule, SignalSnapshot } from "../../../../../packages/shared-types";
import { SIGNALS_COPY as T } from "../copy";

type Save = (input: { ruleId: string; state: ManualState; note: string }) => Promise<ManualInputSaved>;

function ManualRow({ rule, current, onSave }: { rule: SignalRule; current?: SignalResult; onSave: Save }) {
  const [state, setState] = useState<ManualState | "">(current && current.state !== "stale" ? current.state : "");
  const [note, setNote] = useState(current?.note ?? "");
  const [saveFailed, setSaveFailed] = useState(false);
  const [notApplied, setNotApplied] = useState(false);
  const label = rule.label.en;
  return (
    <form data-testid={`manual-${rule.id}`} className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!state) return;
        setSaveFailed(false);
        setNotApplied(false);
        onSave({ ruleId: rule.id, state, note })
          .then((reply) => setNotApplied(reply.snapshot === null))
          .catch(() => setSaveFailed(true));
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
      {notApplied ? <p className="w-full text-xs text-[var(--text-secondary)]">{T.savedNotApplied}</p> : null}
    </form>
  );
}

export function ManualInputPanel({ rules, snapshot, onSave }: { rules: SignalRule[]; snapshot: SignalSnapshot | null; onSave: Save }) {
  const results = snapshot?.results ?? [];
  return (
    <section aria-label="manual" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">
        {T.manual}{snapshot ? <span data-testid="manual-week" className="ml-2 font-normal text-[var(--text-secondary)]">{snapshot.iso_week}</span> : null}
      </h2>
      {rules.map((rule) => (
        // Also keyed on the run time, so each row re-reads its state after a new run.
        <ManualRow key={`${rule.id}|${snapshot?.run_at ?? ""}`} rule={rule}
          current={results.find((r) => r.rule_id === rule.id)} onSave={onSave} />
      ))}
    </section>
  );
}
