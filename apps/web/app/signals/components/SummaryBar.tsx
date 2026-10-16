"use client";

import type { SignalSnapshot } from "../../../../../packages/shared-types";
import { ActionButton } from "@/components/ui/ActionButton";
import { useT } from "@/lib/i18n/locale";
import { deltaPp, formatDelta, formatProb, mostLikely } from "@/lib/signals";

export function SummaryBar({ snapshot, onRun, running }: { snapshot: SignalSnapshot | null; onRun: () => void; running: boolean }) {
  const t = useT();
  const judged = snapshot ? snapshot.results.filter((r) => r.state !== "stale").length : 0;
  const total = snapshot?.results.length ?? 0;
  return (
    <section aria-label="summary" className="flex flex-wrap items-center gap-6 border border-[var(--line)] bg-[var(--surface-raised)] p-4 text-[var(--ink)]">
      {snapshot ? (
        <>
          <div className="type-body">{t("signals.mostLikely")}: <strong data-testid="most-likely" className="type-figure-md">{mostLikely(snapshot.probs).toUpperCase()}</strong></div>
          <div className="type-small text-[var(--ink-secondary)]" data-testid="evidence">
            {t("signals.judged", { judged, total, stale: total - judged })}
            {judged === 0 ? <p className="text-[var(--status-error-ink)]">{t("signals.noEvidence")}</p> : null}
          </div>
          {(["a", "b", "c"] as const).map((s) => {
            const delta = deltaPp(snapshot.probs[s], snapshot.previous_probs?.[s] ?? null);
            return (
              <div key={s} className="type-mono" data-testid={`prob-${s}`}>
                {s.toUpperCase()} {formatProb(snapshot.probs[s])}{" "}
                <span className="text-[var(--ink-secondary)]">
                  {formatDelta(delta)}
                  {delta !== null && snapshot.previous_iso_week ? ` ${t("signals.vsWeek", { week: snapshot.previous_iso_week })}` : null}
                </span>
              </div>
            );
          })}
          <div className="type-small text-[var(--ink-secondary)]">
            {t("signals.lastRun")}: <time dateTime={snapshot.run_at} className="type-mono">{new Date(snapshot.run_at).toLocaleString()}</time> · <span className="type-mono">{snapshot.iso_week}</span>
          </div>
        </>
      ) : (
        <p className="type-body">{t("signals.noSnapshot")}</p>
      )}
      <ActionButton className="ml-auto" size="sm" variant="primary" onClick={onRun} disabled={running}
        label={running ? t("signals.running") : t("signals.runNow")} />
    </section>
  );
}
