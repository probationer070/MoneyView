"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { useT } from "@/lib/i18n/locale";
import { useSignals } from "@/lib/useSignals";
import { ManualInputPanel } from "./components/ManualInputPanel";
import { ProbabilityTrendChart } from "./components/ProbabilityTrendChart";
import { SignalTable } from "./components/SignalTable";
import { SummaryBar } from "./components/SummaryBar";

export default function SignalsPage() {
  const t = useT();
  const { latest, history, manualRules, status, runNow, running, lastRunFailed, lastRunFailures, saveManual } = useSignals();
  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title={t("signals.title")} subtitle={t("signals.subtitle")} />
      {status === "loading" ? <p className="type-body text-[var(--ink-muted)]">{t("signals.loading")}</p> : null}
      {status === "unavailable" ? <p role="alert" className="type-body text-[var(--ink)]">{t("signals.unavailable")}</p> : null}
      {status === "ready" ? (
        <>
          <SummaryBar snapshot={latest} onRun={runNow} running={running} />
          {lastRunFailed ? <p role="alert" className="type-body text-[var(--status-error-ink)]">{t("signals.runFailed")}</p> : null}
          {lastRunFailures.length ? (
            <div role="status" className="type-small text-[var(--ink-secondary)]">
              {t("signals.failures")}:
              <ul>{lastRunFailures.map((f, i) => <li key={`${i}:${f}`}>{f}</li>)}</ul>
            </div>
          ) : null}
          {latest ? <SignalTable results={latest.results} /> : null}
          <ProbabilityTrendChart history={history} />
          <ManualInputPanel rules={manualRules} snapshot={latest} onSave={saveManual} />
        </>
      ) : null}
      <footer className="type-small border-t border-[var(--line)] pt-3 text-[var(--ink-secondary)]" data-testid="disclaimer">
        {t("signals.disclaimer")}
      </footer>
    </div>
  );
}
