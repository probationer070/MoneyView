"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { useSignals } from "@/lib/useSignals";
import { ManualInputPanel } from "./components/ManualInputPanel";
import { ProbabilityTrendChart } from "./components/ProbabilityTrendChart";
import { SignalTable } from "./components/SignalTable";
import { SummaryBar } from "./components/SummaryBar";
import { SIGNALS_COPY as T } from "./copy";

export default function SignalsPage() {
  const { latest, history, manualRules, status, runNow, running, lastRunFailed, lastRunFailures, saveManual } = useSignals();
  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title={T.title} subtitle={T.subtitle} />
      {status === "loading" ? <p className="text-sm text-[var(--text-muted)]">{T.loading}</p> : null}
      {status === "unavailable" ? <p role="alert" className="text-sm">{T.unavailable}</p> : null}
      {status === "ready" ? (
        <>
          <SummaryBar snapshot={latest} onRun={runNow} running={running} />
          {lastRunFailed ? <p role="alert" className="text-sm text-[var(--state-error)]">{T.runFailed}</p> : null}
          {lastRunFailures.length ? (
            <div role="status" className="text-xs text-[var(--text-secondary)]">
              {T.failures}:
              <ul>{lastRunFailures.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          ) : null}
          {latest ? <SignalTable results={latest.results} /> : null}
          <ProbabilityTrendChart history={history} />
          <ManualInputPanel rules={manualRules} results={latest?.results ?? []} onSave={saveManual} />
        </>
      ) : null}
      <footer className="border-t border-[var(--border-soft)] pt-3 text-xs text-[var(--text-secondary)]" data-testid="disclaimer">
        {T.disclaimer}
      </footer>
    </div>
  );
}
