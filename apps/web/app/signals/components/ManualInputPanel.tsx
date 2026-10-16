"use client";

import { useState } from "react";
import type { ManualInputSaved, ManualState, SignalResult, SignalRule, SignalSnapshot } from "../../../../../packages/shared-types";
import { ActionButton } from "@/components/ui/ActionButton";
import { fieldInputClass } from "@/components/ui/InlineField";
import { useLocale, useT } from "@/lib/i18n/locale";

type Save = (input: { ruleId: string; state: ManualState; note: string }) => Promise<ManualInputSaved>;

function ManualRow({ rule, current, onSave }: { rule: SignalRule; current?: SignalResult; onSave: Save }) {
  const t = useT();
  const { locale } = useLocale();
  const [state, setState] = useState<ManualState | "">(current && current.state !== "stale" ? current.state : "");
  const [note, setNote] = useState(current?.note ?? "");
  const [saveFailed, setSaveFailed] = useState(false);
  const [notApplied, setNotApplied] = useState(false);
  const label = rule.label[locale];
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
      <span className="type-body w-56 text-[var(--ink)]">{label}</span>
      <select aria-label={t("signals.stateOf", { label })} value={state} onChange={(e) => setState(e.target.value as ManualState)}
        className={`${fieldInputClass} !w-auto`}>
        <option value="" disabled>{t("signals.notSet")}</option>
        {(["triggered", "near", "not_triggered"] as const).map((s) => <option key={s} value={s}>{t(`signals.states.${s}`)}</option>)}
      </select>
      <input aria-label={`${label} ${t("signals.note")}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)}
        placeholder={t("signals.note")} className={`${fieldInputClass} !w-auto flex-1`} />
      {/* The form's onSubmit saves; the button only submits. */}
      <ActionButton type="submit" size="sm" label={t("signals.save")} disabled={!state} onClick={() => {}} />
      {saveFailed ? <p role="alert" className="type-small w-full text-[var(--status-error-ink)]">{t("signals.saveFailed")}</p> : null}
      {notApplied ? <p className="type-small w-full text-[var(--ink-secondary)]">{t("signals.savedNotApplied")}</p> : null}
    </form>
  );
}

export function ManualInputPanel({ rules, snapshot, onSave }: { rules: SignalRule[]; snapshot: SignalSnapshot | null; onSave: Save }) {
  const t = useT();
  const results = snapshot?.results ?? [];
  return (
    <section aria-label="manual" className="flex flex-col gap-2 border border-[var(--line)] bg-[var(--surface-raised)] p-5">
      <h2 className="type-panel-title text-[var(--ink)]">
        {t("signals.manual")}{snapshot ? <span data-testid="manual-week" className="type-mono ml-2 text-[var(--ink-secondary)]">{snapshot.iso_week}</span> : null}
      </h2>
      {rules.map((rule) => (
        // Also keyed on the run time, so each row re-reads its state after a new run.
        <ManualRow key={`${rule.id}|${snapshot?.run_at ?? ""}`} rule={rule}
          current={results.find((r) => r.rule_id === rule.id)} onSave={onSave} />
      ))}
    </section>
  );
}
