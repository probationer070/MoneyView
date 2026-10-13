"use client";

import type { CorporateMetricAudit, CorporateMetricAuditEntry } from "../../../../packages/shared-types";
import { EmptyState } from "@/components/ui/EmptyState";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { MetricQualityBadge } from "@/components/ui/MetricQualityBadge";
import { formatAuditMetricValue, isDecisionGradeMetric, metricAuditReason, metricQualityTone } from "@/lib/metricAudit";

function AuditInputsTable({ entry }: { entry: CorporateMetricAuditEntry }) {
  return (
    <div className="overflow-x-auto border border-[var(--line)]">
      <table className="w-full min-w-[34rem] text-left type-body">
        <thead className="bg-[var(--surface)] type-caption text-[var(--ink)]">
          <tr>
            <th className="px-3 py-2"><BilingualLabel k="input" /></th>
            <th className="px-3 py-2"><BilingualLabel k="value" /></th>
            <th className="px-3 py-2"><BilingualLabel k="source" /></th>
          </tr>
        </thead>
        <tbody>
          {entry.inputs_used.map((input) => (
            <tr key={input.field} className="border-t border-[var(--line)]">
              <td className="px-3 py-2 text-[var(--ink)]">{input.label}</td>
              <td className="px-3 py-2 tabular-nums text-[var(--ink)]">{input.display_value}</td>
              <td className="px-3 py-2 text-[var(--ink-muted)]">{input.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MetricAuditPanel({
  audit,
  metric,
  title,
}: {
  audit: CorporateMetricAudit | null;
  metric: "growth" | "roic" | "wacc" | "spread";
  title: string;
}) {
  if (!audit) {
    return <EmptyState title={`${title} audit unavailable`} description="Refresh or reopen the metric detail to load the calculation audit." />;
  }

  const entry = audit[metric];
  if (!entry) {
    return <EmptyState title={`${title} audit unavailable`} description="Refresh or reopen the metric detail to load the calculation audit." />;
  }

  return (
    <section className="border border-[var(--line)] bg-[var(--surface-raised)] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="type-body text-[var(--ink)]">{title}</h3>
          <div className="mt-2 flex flex-col gap-2 type-small text-[var(--ink-muted)]">
            <p className="overflow-wrap-anywhere">
              Source: <span className="text-[var(--ink)]">{entry.source || "Unavailable"}</span>
              {entry.as_of ? <span title={entry.as_of}> • As of {entry.as_of}</span> : null}
            </p>
            {entry.calculation_version ? (
              <div
                className="overflow-mono-block rounded-[var(--radius-2)] bg-[var(--surface)] px-2 py-1 type-caption text-[var(--ink)]"
                title={entry.calculation_version}
              >
                Calculation version: {entry.calculation_version}
              </div>
            ) : null}
            <p>
              Method: <span className="text-[var(--ink)]">{entry.method || "Unavailable"}</span>
              {" "}
              Confidence: <span className="text-[var(--ink)]">{Math.round(entry.confidence * 100)}%</span>
            </p>
          </div>
        </div>
        <MetricQualityBadge quality={entry.quality} />
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className={`type-figure-md tabular-nums ${metricQualityTone(entry.quality)}`}>
          {formatAuditMetricValue(entry)}
        </div>
        {!isDecisionGradeMetric(entry) ? (
          <div className="max-w-xl type-small text-[var(--ink-muted)]">{metricAuditReason(entry)}</div>
        ) : null}
      </div>
      {entry.warnings.length > 0 ? (
        <div className="mt-3 border border-[var(--status-warning-border)] bg-[var(--status-warning-surface)] p-3 type-body text-[var(--status-warning-ink)]">
          {entry.warnings.join(" ")}
        </div>
      ) : null}
      {entry.inputs_used.length > 0 ? (
        <div className="mt-3">
          <AuditInputsTable entry={entry} />
        </div>
      ) : null}
    </section>
  );
}
