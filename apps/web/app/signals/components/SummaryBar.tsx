"use client";

import type { SignalSnapshot } from "../../../../../packages/shared-types";
import { deltaPp, formatDelta, formatProb, mostLikely } from "@/lib/signals";
import { SIGNALS_COPY as T } from "../copy";

export function SummaryBar({ snapshot, onRun, running }: { snapshot: SignalSnapshot | null; onRun: () => void; running: boolean }) {
  const judged = snapshot ? snapshot.results.filter((r) => r.state !== "stale").length : 0;
  const total = snapshot?.results.length ?? 0;
  return (
    <section aria-label="summary" className="flex flex-wrap items-center gap-6 rounded-[var(--radius)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
      {snapshot ? (
        <>
          <div className="text-sm">{T.mostLikely}: <strong data-testid="most-likely">{mostLikely(snapshot.probs).toUpperCase()}</strong></div>
          <div className="text-xs text-[var(--text-secondary)]" data-testid="evidence">
            {T.judged(judged, total, total - judged)}
            {judged === 0 ? <p className="text-[var(--state-error)]">{T.noEvidence}</p> : null}
          </div>
          {(["a", "b", "c"] as const).map((s) => {
            const delta = deltaPp(snapshot.probs[s], snapshot.previous_probs?.[s] ?? null);
            return (
              <div key={s} className="tabular-nums text-sm" data-testid={`prob-${s}`}>
                {s.toUpperCase()} {formatProb(snapshot.probs[s])}{" "}
                <span className="text-[var(--text-secondary)]">
                  {formatDelta(delta)}
                  {delta !== null && snapshot.previous_iso_week ? ` ${T.vsWeek(snapshot.previous_iso_week)}` : null}
                </span>
              </div>
            );
          })}
          <div className="text-xs text-[var(--text-secondary)]">
            {T.lastRun}: <time dateTime={snapshot.run_at}>{new Date(snapshot.run_at).toLocaleString()}</time> · {snapshot.iso_week}
          </div>
        </>
      ) : (
        <p className="text-sm">{T.noSnapshot}</p>
      )}
      <button type="button" onClick={onRun} disabled={running}
        className="ml-auto rounded-[var(--radius-sm)] border border-[var(--border-accent)] px-3 py-1 text-sm font-semibold disabled:opacity-50">
        {running ? T.running : T.runNow}
      </button>
    </section>
  );
}
