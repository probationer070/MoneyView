"use client";

import type { ReactNode } from "react";
import { useT } from "@/lib/i18n/locale";
import type { CalculationDetail, CalculationDetailKey } from "../calculationDetailTypes";
import { DenseRowsTable } from "./detailParts";

// Spec §4 Summary: big value, status, one-line meaning, the formula with current values, inputs.
export function SummaryTab({
  detail,
  detailKey,
  status,
  substituted,
  waccInput,
  asOf,
}: {
  detail: CalculationDetail;
  detailKey: CalculationDetailKey;
  status: ReactNode;
  substituted: string | null;
  /** The slider WACC when the audit's WACC differs from it (spec §4); null otherwise. */
  waccInput: number | null;
  asOf: string | null;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span data-testid="detail-result" className="type-figure-md text-[var(--ink)]">{detail.result}</span>
        {status}
      </div>
      <p className="type-body text-[var(--ink-secondary)]">{t(`corporate.detail.meaning.${detailKey}`)}</p>
      <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="type-caption uppercase text-[var(--ink-muted)]">{t("corporate.detail.formula")}</div>
        <p className="type-mono mt-2 whitespace-pre-wrap text-[var(--ink)]">{detail.formula}</p>
        {substituted ? (
          <>
            <div className="type-caption mt-3 uppercase text-[var(--ink-muted)]">{t("corporate.detail.substituted")}</div>
            <p data-testid="substituted-formula" className="type-mono mt-2 text-[var(--ink)]">{substituted}</p>
            {waccInput !== null ? (
              <p data-testid="wacc-input-note" className="type-small mt-2 text-[var(--ink-muted)]">
                {t("corporate.detail.waccInputNote", { input: `${waccInput.toFixed(1)}%` })}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
      <section className="flex flex-col gap-2">
        <h3 className="type-panel-title text-[var(--ink)]">{t("corporate.detail.inputsTitle")}</h3>
        <DenseRowsTable
          rows={detail.summary}
          columns={["dataPoint", "value", "source"]}
          asOf={asOf}
          emptyTitle={t("corporate.detail.noInputs")}
          emptyDescription={t("corporate.detail.noInputsBody")}
        />
      </section>
    </div>
  );
}
