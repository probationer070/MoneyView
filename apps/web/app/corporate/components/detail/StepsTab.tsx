"use client";

import type { CorporateMetricAudit } from "../../../../../../packages/shared-types";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { MetricAuditPanel } from "@/components/ui/MetricAuditPanel";
import { useT } from "@/lib/i18n/locale";
import type { CalculationDetail, CalculationRow } from "../calculationDetailTypes";
import { DenseRowsTable, SectionCard } from "./detailParts";

// Spec §4 "Calculation steps": the audit (Step 1..N), data lineage and supporting rows.
export function StepsTab({
  detail,
  ticker,
  metricAudit,
  metricAuditIsLoading,
  metricAuditIsError,
}: {
  detail: CalculationDetail;
  ticker: string;
  metricAudit: CorporateMetricAudit | null;
  metricAuditIsLoading: boolean;
  metricAuditIsError: boolean;
}) {
  const t = useT();
  const lineageRows = [...detail.sourcing, ...detail.summary.slice(0, 3)];
  const rawAccessRows: CalculationRow[] = [
    ...detail.simulation.map((row) => ({ label: `Step ${row.label}`, value: row.value, source: `Output: ${row.source}; Data Period: ${detail.timeHorizon}` })),
    ...detail.sourcing.map((row) => ({ label: row.label, value: row.value, source: `${row.source}; Data Period: ${detail.timeHorizon}` })),
  ];
  const tables: { title: string; description: string; rows: CalculationRow[] }[] = [
    { title: t("corporate.detail.lineage"), description: t("corporate.detail.lineageBody"), rows: lineageRows },
    { title: t("corporate.detail.supporting"), description: t("corporate.detail.supportingBody"), rows: [...detail.components, ...detail.simulation] },
    { title: t("corporate.detail.rawAccess"), description: t("corporate.detail.rawAccessBody"), rows: rawAccessRows },
  ];
  return (
    <div className="flex flex-col gap-4">
      {detail.auditMetric ? (
        metricAuditIsLoading ? (
          <SectionCard title={t("corporate.detail.auditTitle")}>
            <EmptyState title={t("corporate.detail.auditLoading")} />
          </SectionCard>
        ) : metricAuditIsError ? (
          <SectionCard title={t("corporate.detail.auditTitle")}>
            <ErrorState title={t("corporate.detail.auditUnavailable")} message={t("corporate.detail.auditError", { ticker })} />
          </SectionCard>
        ) : (
          <MetricAuditPanel
            audit={metricAudit}
            metric={detail.auditMetric}
            title={detail.auditMetric === "spread" ? "ROIC - WACC Audit" : detail.auditMetric === "growth" ? "Growth Audit" : `${detail.auditMetric.toUpperCase()} Audit`}
          />
        )
      ) : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="type-caption uppercase text-[var(--ink-muted)]">{t("corporate.detail.resultLabel")}</div>
          <p className="type-body mt-2 text-[var(--ink)]">{detail.result}</p>
        </div>
        <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="type-caption uppercase text-[var(--ink-muted)]">{t("corporate.detail.horizonLabel")}</div>
          <p className="type-body mt-2 text-[var(--ink)]">{detail.timeHorizon}</p>
        </div>
      </div>
      {tables.map((table) => (
        <SectionCard key={table.title} title={table.title} description={table.description}>
          <DenseRowsTable rows={table.rows} columns={["dataPoint", "value", "source"]} emptyTitle={t("corporate.detail.noRows")} emptyDescription={t("corporate.detail.noRowsBody")} />
        </SectionCard>
      ))}
    </div>
  );
}
