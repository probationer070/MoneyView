"use client";

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { buildApiUrl, fetchApi } from "@/lib/api";
import { fmtPct } from "@/lib/chartConfig";
import { useLocale, useT } from "@/lib/i18n/locale";
import { DECISION_ACTIONS, type DecisionAction, type DecisionRow } from "../decisionTypes";

// NOTE: `fmtPct` already prepends "+" for non-negative values
// (lib/chartConfig.ts) -- do NOT add a sign wrapper around it, or every
// positive figure renders as "++50.0%".

/**
 * The two figures are deliberately rendered as a PAIR with separate basis
 * lines. They share a unit and nothing else: the gap is total upside with no
 * horizon, the move is a change over a stated period. Presenting them without
 * their bases is what would invite someone to subtract one from the other.
 */
function FigurePair({ decision }: { decision: DecisionRow }) {
  const t = useT();
  const { outcome } = decision;
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="border border-[var(--line)] p-3">
        <p className="type-small text-[var(--ink-secondary)]">
          {t("decisions.list.gap")}
        </p>
        <p className="type-mono text-[var(--ink)]">
          {decision.dcf_implied_return_pct === null
            ? "—"
            : fmtPct(decision.dcf_implied_return_pct, 1)}
        </p>
        <p className="type-small text-[var(--ink-muted)]">{t("decisions.list.noHorizon")}</p>
        {decision.figures_unavailable_reason && (
          <p className="mt-1 type-small text-[var(--ink-secondary)]">
            {decision.figures_unavailable_reason}
          </p>
        )}
      </div>

      <div className="border border-[var(--line)] p-3">
        <p className="type-small text-[var(--ink-secondary)]">{t("decisions.list.move")}</p>
        <p className="type-mono text-[var(--ink)]">
          {outcome.price_move_pct === null ? "—" : fmtPct(outcome.price_move_pct, 1)}
        </p>
        <p className="type-small text-[var(--ink-muted)]">
          {outcome.price_date
            ? t("decisions.list.span", { from: outcome.decided_on, to: outcome.price_date })
            : t("decisions.list.since", { from: outcome.decided_on })}
        </p>
        {outcome.reason && (
          <p className="mt-1 type-small text-[var(--ink-secondary)]">{outcome.reason}</p>
        )}
      </div>
    </div>
  );
}

const FIELD_CLASS = "rounded-[var(--radius-1)] border border-[var(--line)] bg-transparent px-2 py-1 type-body text-[var(--ink)]";
const TEXT_BUTTON_CLASS = "rounded-[var(--radius-1)] border border-[var(--line)] px-3 py-1 type-small text-[var(--ink)] disabled:opacity-50";

function editedLabel(iso: string, locale: "en" | "ko"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

// DELETE answers 204 with no body, which fetchApi would try to parse, so it goes through fetch directly
// (the same reason lib/marketEventsApi.ts has its own `send`).
async function deleteDecision(id: number): Promise<void> {
  const response = await fetch(buildApiUrl(`/decisions/${id}`).toString(), { method: "DELETE" });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
}

/**
 * One decision. Action and memo can be corrected (PATCH sends exactly those two; the server refuses
 * anything else), and a corrected card says when. Delete asks once more inside the card: a browser
 * confirm() would block the page and the test runner. Spec 2026-11-01 decision edit/delete.
 */
function DecisionCard({ decision }: { decision: DecisionRow }) {
  const t = useT();
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"view" | "edit" | "confirmDelete">("view");
  const [action, setAction] = useState<DecisionAction>(decision.action as DecisionAction);
  const [memo, setMemo] = useState(decision.memo);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["decisions"] });
  const save = useMutation({
    mutationFn: (body: { action: string; memo: string }) =>
      fetchApi<DecisionRow>(`/decisions/${decision.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        monitor: { operation: "frontend.mutation.edit_decision", component: "decisions_page" },
      }),
    onSuccess: async () => { await refresh(); setMode("view"); setError(null); },
    onError: () => setError(t("decisions.saveFailed")),
  });
  const remove = useMutation({
    mutationFn: () => deleteDecision(decision.id),
    onSuccess: () => refresh(),
    onError: () => setError(t("decisions.deleteFailed")),
  });

  const startEdit = () => { setAction(decision.action as DecisionAction); setMemo(decision.memo); setError(null); setMode("edit"); };
  const cancel = () => { setError(null); setMode("view"); };

  return (
    <article data-testid={`decision-card-${decision.id}`} className="border border-[var(--line)] bg-[var(--surface-raised)] p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="type-panel-title text-[var(--ink)]">{decision.ticker}</h3>
        <span className="rounded-[var(--radius-2)] border border-[var(--line)] px-2 py-0.5 type-caption uppercase text-[var(--ink-secondary)]">
          {decision.action}
        </span>
        <span className="type-small text-[var(--ink-muted)]">{decision.outcome.decided_on}</span>
        {decision.edited_at ? (
          <span data-testid="decision-edited" className="type-small text-[var(--ink-muted)]">
            {t("decisions.edited", { time: editedLabel(decision.edited_at, locale) })}
          </span>
        ) : null}
        {mode === "view" ? (
          <span className="ml-auto flex gap-1">
            <IconButton size="sm" label={t("decisions.edit")} icon={<Pencil className="h-4 w-4" aria-hidden="true" />} onClick={startEdit} />
            <IconButton size="sm" label={t("decisions.delete")} icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => { setError(null); setMode("confirmDelete"); }} />
          </span>
        ) : null}
      </div>

      {mode === "edit" ? (
        <form
          className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => { event.preventDefault(); save.mutate({ action, memo }); }}
        >
          <label className="flex flex-col gap-1 type-small text-[var(--ink-secondary)]">
            {t("decisions.action")}
            <select value={action} onChange={(event) => setAction(event.target.value as DecisionAction)} className={FIELD_CLASS}>
              {DECISION_ACTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 type-small text-[var(--ink-secondary)]">
            {t("decisions.memo")}
            <textarea value={memo} onChange={(event) => setMemo(event.target.value)} rows={2} className={FIELD_CLASS} />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={save.isPending} className={TEXT_BUTTON_CLASS}>{t("decisions.save")}</button>
            <button type="button" onClick={cancel} className={TEXT_BUTTON_CLASS}>{t("decisions.cancel")}</button>
          </div>
        </form>
      ) : (
        <p className="mt-2 type-body text-[var(--ink)]">{decision.memo}</p>
      )}

      {mode === "confirmDelete" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border border-[var(--line)] p-3">
          <p className="type-small text-[var(--ink)]">{t("decisions.deletePrompt")}</p>
          <button type="button" disabled={remove.isPending} onClick={() => remove.mutate()} className={TEXT_BUTTON_CLASS}>
            {t("decisions.confirmDelete")}
          </button>
          <button type="button" onClick={cancel} className={TEXT_BUTTON_CLASS}>{t("decisions.cancel")}</button>
        </div>
      ) : null}

      {error ? <p role="alert" className="mt-2 type-small text-[var(--status-error-ink)]">{error}</p> : null}
      <FigurePair decision={decision} />
    </article>
  );
}

export function DecisionList({ decisions }: { decisions: DecisionRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      {decisions.map((decision) => <DecisionCard key={decision.id} decision={decision} />)}
    </div>
  );
}
