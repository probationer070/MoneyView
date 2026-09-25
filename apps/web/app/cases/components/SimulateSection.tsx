import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { fieldTargets, formatWire, unitSuffix, wireValue } from "../caseFields";
import { CaseApiError, casesApi } from "../casesApi";
import { DEFAULT_RUNS, MAX_RUNS, MIN_RUNS, type CaseRecord, type Shape, type SimulateRequest, type SimulateResult } from "../caseTypes";
import { EMPTY_NARRATIVE, SHAPE_PARAMS, buildSimulateRequest, type SimulateRow } from "../changeRows";
import { FieldPicker, controlClass } from "./FieldPicker";
import { NarrativeInputs } from "./NarrativeInputs";
import { Section } from "./Section";
import { SimulateResults } from "./SimulateResults";

export function SimulateSection({ record, pointValue }: { record: CaseRecord; pointValue: number | null }) {
  const targets = useMemo(() => fieldTargets(record), [record]);
  const byKey = useMemo(() => new Map(targets.map((t) => [t.key, t])), [targets]);
  const [rows, setRows] = useState<SimulateRow[]>([]);
  const [nextId, setNextId] = useState(1);
  const [runs, setRuns] = useState(String(DEFAULT_RUNS));
  const [seed, setSeed] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // The request that produced the currently-shown result, kept so "Rerun with this seed"
  // reproduces what is on screen -- not whatever the form happens to hold right now.
  const [lastRequest, setLastRequest] = useState<SimulateRequest | null>(null);

  const built = buildSimulateRequest(rows, runs, seed, byKey);
  const mutation = useMutation({
    mutationFn: (body: SimulateRequest) => casesApi.simulate(record.id, body),
    onSuccess: (data, variables) => { setResult(data); setLastRequest(variables); },
    onError: (error) => {
      setResult(null);
      if (error instanceof CaseApiError && error.isRefusal) {
        setRefusal(error.detail);
        return;
      }
      setFailed(true);
    },
  });

  const update = (id: number, patch: Partial<SimulateRow>) =>
    setRows((all) => all.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const send = (request: SimulateRequest) => {
    setSubmitted(true);
    setRefusal(null);
    setFailed(false);
    if (rows.length === 0 || built.runsProblem || built.seedProblem || Object.keys(built.problems).length > 0) return;
    mutation.mutate(request);
  };

  // Bypasses the form's own guard: `lastRequest` already produced the result on screen, so
  // it was already valid. A rerun reproduces that request with only the seed changed --
  // never the current (possibly since-edited) form.
  const rerun = (usedSeed: number) => {
    if (!lastRequest) return;
    setSeed(String(usedSeed));
    setRefusal(null);
    setFailed(false);
    mutation.mutate({ ...lastRequest, seed: usedSeed });
  };

  return (
    <Section title="Uncertainty (simulate this case)" testId="case-simulate">
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        State a range for a few inputs; each draw values the case once. Nothing is stored — the seed reproduces a result.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); send(built.request); }} className="flex flex-col gap-3">
        {rows.map((row, index) => {
          const target = byKey.get(row.targetKey);
          const suffix = target ? unitSuffix(target.meta) : "";
          const problem = submitted ? built.problems[row.id] : undefined;
          const problemId = `simulate-row-${row.id}-problem`;
          return (
            <div key={row.id} data-testid={`simulate-row-${index}`} className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] p-3">
              <div className="flex flex-wrap items-end gap-3">
                <FieldPicker targets={targets} value={row.targetKey} onChange={(key) => update(row.id, { targetKey: key })} />
                {target && <span className="pb-1 text-xs text-[var(--text-muted)]">Current: {formatWire(target.meta, wireValue(record, target))}</span>}
                <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
                  Shape
                  <select value={row.shape} onChange={(e) => update(row.id, { shape: e.target.value as Shape, params: {} })} className={controlClass}>
                    <option value="triangular">triangular</option>
                    <option value="normal">normal</option>
                    <option value="uniform">uniform</option>
                  </select>
                </label>
                {SHAPE_PARAMS[row.shape].map((param) => (
                  <label key={param.name} className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
                    <span>{param.label}{suffix ? ` (${suffix})` : ""}</span>
                    <input
                      aria-label={param.label}
                      value={row.params[param.name] ?? ""}
                      onChange={(e) => update(row.id, { params: { ...row.params, [param.name]: e.target.value } })}
                      inputMode="decimal"
                      className={`${controlClass} w-24`}
                    />
                  </label>
                ))}
                <button type="button" onClick={() => setRows((all) => all.filter((r) => r.id !== row.id))} className="pb-1 text-xs text-[var(--text-muted)] underline">
                  Remove
                </button>
              </div>
              {target?.meta.narrated && (
                <NarrativeInputs value={row.narrative} onChange={(narrative) => update(row.id, { narrative })} withEvidence={false} />
              )}
              {problem && <p id={problemId} data-testid="row-problem" aria-live="polite" className="text-xs text-[var(--text-secondary)]">{problem}</p>}
            </div>
          );
        })}
        <div className="flex flex-wrap items-end gap-3">
          <button
            type="button"
            onClick={() => {
              setRows((all) => [...all, { id: nextId, targetKey: "", shape: "triangular", params: {}, narrative: EMPTY_NARRATIVE }]);
              setNextId((n) => n + 1);
            }}
            className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-1.5 text-sm"
          >
            Add an input
          </button>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
            Runs ({MIN_RUNS.toLocaleString("en-US")}–{MAX_RUNS.toLocaleString("en-US")})
            <input value={runs} onChange={(e) => setRuns(e.target.value)} inputMode="numeric" className={`${controlClass} w-28`} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
            Seed (optional)
            <input value={seed} onChange={(e) => setSeed(e.target.value)} inputMode="numeric" className={`${controlClass} w-28`} />
          </label>
          <button type="submit" disabled={mutation.isPending} aria-busy={mutation.isPending} className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-1.5 text-sm font-medium disabled:opacity-50">
            {mutation.isPending ? "Simulating…" : "Simulate"}
          </button>
        </div>
        {submitted && rows.length === 0 && <p aria-live="polite" className="text-xs text-[var(--text-secondary)]">Add at least one input to simulate.</p>}
        {submitted && built.runsProblem && <p aria-live="polite" className="text-xs text-[var(--text-secondary)]">{built.runsProblem}</p>}
        {submitted && built.seedProblem && <p aria-live="polite" className="text-xs text-[var(--text-secondary)]">{built.seedProblem}</p>}
      </form>
      {refusal && (
        <p data-testid="simulate-refusal" role="status" aria-live="polite" className="mt-3 text-sm text-[var(--text-secondary)]">
          {refusal}
        </p>
      )}
      {failed && (
        <p role="alert" data-testid="simulate-error" className="mt-3 text-sm text-[var(--chart-negative)]">
          Could not run the simulation.
        </p>
      )}
      {result && (
        <SimulateResults
          result={result}
          pointValue={pointValue}
          onRerun={rerun}
          rerunDisabled={mutation.isPending}
        />
      )}
    </Section>
  );
}
