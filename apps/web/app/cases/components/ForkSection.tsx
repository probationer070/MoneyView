import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fieldTargets, formatWire, unitSuffix, wireValue } from "../caseFields";
import { CaseApiError, casesApi } from "../casesApi";
import { SHAPLEY_INPUT_CAP, type CaseRecord, type ForkRequest } from "../caseTypes";
import { EMPTY_NARRATIVE, buildForkRequest, rowsNamedIn, type ForkRow } from "../changeRows";
import { FieldPicker, controlClass } from "./FieldPicker";
import { NarrativeInputs } from "./NarrativeInputs";
import { Section } from "./Section";

interface Refusal {
  detail: string;
  rowIds: number[];
  name: boolean;
}

export function ForkSection({ record }: { record: CaseRecord }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const targets = useMemo(() => fieldTargets(record), [record]);
  const byKey = useMemo(() => new Map(targets.map((t) => [t.key, t])), [targets]);
  const [caseName, setCaseName] = useState("");
  const [rows, setRows] = useState<ForkRow[]>([]);
  const [nextId, setNextId] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [failed, setFailed] = useState(false);

  const current = (key: string) => {
    const target = byKey.get(key);
    return target ? wireValue(record, target) : null;
  };
  const built = buildForkRequest(caseName, rows, byKey, current);

  const mutation = useMutation({
    mutationFn: (body: ForkRequest) => casesApi.fork(record.id, body),
    onSuccess: ({ id }) => {
      void queryClient.invalidateQueries({ queryKey: ["cases"] });
      router.push(`/cases/${id}`);
    },
    onError: (error) => {
      if (error instanceof CaseApiError && error.isRefusal) {
        setRefusal({
          detail: error.detail,
          rowIds: rowsNamedIn(error.detail, rows, byKey),
          name: error.detail.startsWith("duplicate_case_name"),
        });
        return;
      }
      setFailed(true);
    },
  });

  const update = (id: number, patch: Partial<ForkRow>) =>
    setRows((all) => all.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    setRefusal(null);
    setFailed(false);
    if (!caseName.trim() || built.changedCount === 0 || Object.keys(built.problems).length > 0) return;
    mutation.mutate(built.request);
  };

  const nameProblem = submitted && !caseName.trim();

  return (
    <Section title="Fork this case" testId="case-fork">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex max-w-sm flex-col gap-1 text-xs text-[var(--text-secondary)]">
          New case name
          <input
            value={caseName}
            onChange={(e) => setCaseName(e.target.value)}
            data-highlighted={refusal?.name ? "true" : "false"}
            aria-invalid={refusal?.name || nameProblem ? true : undefined}
            aria-describedby={nameProblem ? "fork-name-problem" : undefined}
            className={`${controlClass} ${refusal?.name ? "border-[var(--chart-negative)]" : ""}`}
          />
        </label>
        {nameProblem && <p id="fork-name-problem" className="text-xs text-[var(--text-secondary)]">A fork needs a name.</p>}
        <p data-testid="fork-counter" className="text-xs text-[var(--text-secondary)]">
          {built.changedCount} of {SHAPLEY_INPUT_CAP} changed inputs
        </p>
        {built.changedCount > SHAPLEY_INPUT_CAP && (
          <p className="text-xs text-[var(--text-secondary)]">
            More than {SHAPLEY_INPUT_CAP} changed inputs: the fork is still valid, but “Why it moved” will not be able to explain it.
          </p>
        )}
        {rows.map((row, index) => {
          const target = byKey.get(row.targetKey);
          const highlighted = refusal?.rowIds.includes(row.id) ?? false;
          const problem = submitted ? built.problems[row.id] : undefined;
          const problemId = `fork-row-${row.id}-problem`;
          return (
            <div
              key={row.id}
              data-testid={`fork-row-${index}`}
              data-highlighted={highlighted ? "true" : "false"}
              className={`flex flex-col gap-2 rounded-[var(--radius-sm)] border p-3 ${highlighted ? "border-[var(--chart-negative)]" : "border-[var(--border)]"}`}
            >
              <div className="flex flex-wrap items-end gap-3">
                <FieldPicker targets={targets} value={row.targetKey} onChange={(key) => update(row.id, { targetKey: key })} />
                {target && (
                  <span className="pb-1 text-xs text-[var(--text-muted)]">Current: {formatWire(target.meta, wireValue(record, target))}</span>
                )}
                <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
                  New value{target && unitSuffix(target.meta) ? ` (${unitSuffix(target.meta)})` : ""}
                  <input
                    value={row.value}
                    onChange={(e) => update(row.id, { value: e.target.value })}
                    inputMode="decimal"
                    aria-invalid={problem || highlighted ? true : undefined}
                    aria-describedby={problem ? problemId : undefined}
                    className={controlClass}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setRows((all) => all.filter((r) => r.id !== row.id))}
                  aria-label={`Remove change ${index + 1}`}
                  className="pb-1 text-xs text-[var(--text-muted)] underline"
                >
                  Remove
                </button>
              </div>
              {target?.meta.narrated && (
                <NarrativeInputs value={row.narrative} onChange={(narrative) => update(row.id, { narrative })} withEvidence />
              )}
              {built.unchanged.includes(row.id) && <p className="text-xs text-[var(--text-muted)]">unchanged, will be ignored</p>}
              {problem && <p id={problemId} data-testid="row-problem" aria-live="polite" className="text-xs text-[var(--text-secondary)]">{problem}</p>}
            </div>
          );
        })}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              setRows((all) => [...all, { id: nextId, targetKey: "", value: "", narrative: EMPTY_NARRATIVE }]);
              setNextId((n) => n + 1);
            }}
            className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-1.5 text-sm"
          >
            Add a change
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            aria-busy={mutation.isPending}
            className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {mutation.isPending ? "Creating…" : "Create fork"}
          </button>
        </div>
        {refusal && (
          <p data-testid="fork-refusal" role="status" aria-live="polite" className="text-sm text-[var(--text-secondary)]">
            {refusal.detail}
          </p>
        )}
        {failed && (
          <p role="alert" data-testid="fork-error" className="text-sm text-[var(--chart-negative)]">
            Could not create the fork.
          </p>
        )}
      </form>
    </Section>
  );
}
