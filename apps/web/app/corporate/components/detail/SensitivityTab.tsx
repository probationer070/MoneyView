"use client";

import { useSyncExternalStore } from "react";
import type { DcfSummaryResponse } from "../../../../../../packages/shared-types";
import { ActionButton } from "@/components/ui/ActionButton";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { bridgedEstimatedValue, bridgedUpsidePct } from "@/lib/bridgeQuality";
import { DcfRefusalError, postDcf } from "@/lib/dcfRefusal";
import { formatNumber, MISSING } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import { assumptionRow, formatAssumption, formatDelta, sensitivityPlan, type DcfRequestBody } from "../../assumptionRows";
import type { DcfRequestSnapshot } from "../../corporateTypes";
import type { CalculationDetailKey } from "../calculationDetailTypes";
import { TABLE, TD, TD_FIGURE, THEAD, TR } from "./detailParts";

type Side =
  | { state: "done"; intrinsic: number | null; upside: number | null }
  | { state: "refused"; message: string }
  | { state: "error"; message: string };
interface Runs {
  down: Side;
  up: Side;
}

// One entry per (ticker, metric): the last pair of runs and the snapshot they were made for. A
// changed assumption changes the snapshot, so the entry stops applying and Calculate asks again.
// It is module-level so that closing and reopening the modal keeps the results (spec §4.1). A run in
// flight is an entry with `runs: null`; listeners re-read the entry when it starts and when it settles,
// so a tab closed and reopened mid-run still shows it as running.
type RunEntry = { snapshot: string; runs: Runs | null };
const runCache = new Map<string, RunEntry>();
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publish(key: string, entry: RunEntry) {
  runCache.set(key, entry);
  listeners.forEach((listener) => listener());
}

// Each run settles on its own, so one failure leaves the other result on screen (spec §6). A refusal
// is the backend's reason, shown as content; anything else is a failed run.
async function settle(ticker: string, body: DcfRequestBody): Promise<Side> {
  try {
    const summary = await postDcf<DcfSummaryResponse>(`/corporate/dcf/${ticker}`, body);
    return { state: "done", intrinsic: bridgedEstimatedValue(summary), upside: bridgedUpsidePct(summary) };
  } catch (error) {
    if (error instanceof DcfRefusalError) return { state: "refused", message: error.readerText };
    return { state: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

export function SensitivityTab({
  detailKey,
  ticker,
  snapshot,
  base,
}: {
  detailKey: CalculationDetailKey;
  ticker: string;
  snapshot: DcfRequestSnapshot;
  base: { intrinsic: number | null; upside: number | null } | null;
}) {
  const t = useT();
  const { locale } = useLocale();
  const cacheKey = `${ticker}|${detailKey}`;
  const snapshotKey = JSON.stringify(snapshot);
  const entry = useSyncExternalStore(subscribe, () => runCache.get(cacheKey));
  const row = assumptionRow(detailKey);
  const plan = sensitivityPlan(snapshot, detailKey);
  if (!row || !plan) return <EmptyState title={t("corporate.detail.sensitivity.notDcf")} />;

  const current = entry && entry.snapshot === snapshotKey ? entry : null;
  const runs = current?.runs ?? null;
  const loading = current !== null && runs === null;

  const run = () => {
    const pending: RunEntry = { snapshot: snapshotKey, runs: null };
    publish(cacheKey, pending);
    void Promise.all([settle(ticker, plan.down.body), settle(ticker, plan.up.body)]).then(([down, up]) => {
      // A run superseded by a newer one (another snapshot) does not overwrite it.
      if (runCache.get(cacheKey) === pending) publish(cacheKey, { snapshot: snapshotKey, runs: { down, up } });
    });
  };

  const label = t(`corporate.assumption.${row.key}`);
  const delta = formatDelta(row);
  // Mono figures through formatNumber in the active locale: price digits, "$" in front.
  const money = (value: number | null) => (value === null ? MISSING : `$${formatNumber(value, "price", { locale })}`);

  const resultCells = (side: "down" | "up") => {
    if (loading) return <td colSpan={2} className={`${TD} text-right`}>{t("corporate.detail.sensitivity.running")}</td>;
    const result = runs?.[side];
    if (!result) return <td colSpan={2} className={`${TD} text-right`}>{MISSING}</td>;
    if (result.state === "done") {
      return (
        <>
          <td className={`${TD_FIGURE} text-right`}>{money(result.intrinsic)}</td>
          <td className="px-3 py-2 text-right"><DeltaBadge value={result.upside} /></td>
        </>
      );
    }
    if (result.state === "refused") {
      return <td colSpan={2} className="type-small px-3 py-2 text-right text-[var(--ink-secondary)]">{result.message}</td>;
    }
    return (
      <td colSpan={2} role="alert" className="type-small px-3 py-2 text-right text-[var(--status-error-ink)]">
        {t("corporate.detail.sensitivity.failed", { message: result.message })}
      </td>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="type-body text-[var(--ink-secondary)]">{t("corporate.detail.sensitivity.intro", { label, delta })}</p>
      <ActionButton
        label={t(loading ? "corporate.detail.sensitivity.running" : "corporate.detail.sensitivity.run")}
        size="sm"
        variant="secondary"
        disabled={loading}
        onClick={run}
        className="self-start"
      />
      <div className="overflow-x-auto border border-[var(--line)]">
        <table data-testid="sensitivity-table" className={TABLE}>
          <thead className={THEAD}>
            <tr>
              <th scope="col" className="px-3 py-2"><BilingualLabel k="scenario" /></th>
              <th scope="col" className="px-3 py-2 text-right"><BilingualLabel k="value" /></th>
              <th scope="col" className="px-3 py-2 text-right"><BilingualLabel k="intrinsicValue" /></th>
              <th scope="col" className="px-3 py-2 text-right"><BilingualLabel k="upside" /></th>
            </tr>
          </thead>
          <tbody>
            <tr data-testid="sensitivity-row-current" className={TR}>
              <td className={TD}>{t("corporate.detail.sensitivity.current")}</td>
              <td className={`${TD_FIGURE} text-right`}>{formatAssumption(row, plan.current)}</td>
              <td className={`${TD_FIGURE} text-right`}>{money(base?.intrinsic ?? null)}</td>
              <td className="px-3 py-2 text-right"><DeltaBadge value={base?.upside ?? null} /></td>
            </tr>
            {(["down", "up"] as const).map((side) => {
              const step = plan[side];
              return (
                <tr key={side} data-testid={`sensitivity-row-${side}`} className={TR}>
                  <td className={TD}>{t(side === "down" ? "corporate.detail.sensitivity.minus" : "corporate.detail.sensitivity.plus", { delta })}</td>
                  <td className={`${TD_FIGURE} text-right`}>
                    {formatAssumption(row, step.value)}
                    {step.clamped ? <span className="type-caption ml-1 block text-[var(--status-warning-ink)]">{t("corporate.detail.sensitivity.clamped")}</span> : null}
                  </td>
                  {resultCells(side)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
