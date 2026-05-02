"use client";

import type { CorporateMetricAudit, CorporateMetricAuditEntry } from "../../../../packages/shared-types";
import { EmptyState } from "@/components/ui/EmptyState";
import { MetricQualityBadge } from "@/components/ui/MetricQualityBadge";
import { formatAuditMetricValue, isDecisionGradeMetric, metricAuditReason, metricQualityTone } from "@/lib/metricAudit";

function AuditInputsTable({ entry }: { entry: CorporateMetricAuditEntry }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <thead className="bg-[var(--surface)] text-[length:var(--type-table-header)] font-bold uppercase tracking-wide text-[var(--text-primary)]">
          <tr>
            <th className="px-3 py-2">Input</th>
            <th className="px-3 py-2">Value</th>
            <th className="px-3 py-2">Source</th>
          </tr>
        </thead>
        <tbody>
          {entry.inputs_used.map((input) => (
            <tr key={input.field} className="border-t border-[var(--border)]">
              <td className="px-3 py-2 font-bold text-[var(--text-primary)]">{input.label}</td>
              <td className="px-3 py-2 font-bold tabular-nums text-[var(--text-primary)]">{input.display_value}</td>
              <td className="px-3 py-2 text-[var(--text-muted)]">{input.source}</td>
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
    <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-bold text-[var(--text-primary)]">{title}</h3>
          <div className="mt-2 flex flex-col gap-2 text-xs text-[var(--text-muted)]">
            <p className="overflow-wrap-anywhere">
              Source: <span className="font-semibold text-[var(--text-primary)]">{entry.source || "Unavailable"}</span>
              {entry.as_of ? <span title={entry.as_of}> • As of {entry.as_of}</span> : null}
            </p>
            {entry.calculation_version ? (
              <div
                className="overflow-mono-block rounded-[var(--radius-sm)] bg-[var(--surface-muted)] px-2 py-1 text-[11px] text-[var(--text-primary)]"
                title={entry.calculation_version}
              >
                Calculation version: {entry.calculation_version}
              </div>
            ) : null}
            <p>
              Method: <span className="font-semibold text-[var(--text-primary)]">{entry.method || "Unavailable"}</span>
              {" "}
              Confidence: <span className="font-semibold text-[var(--text-primary)]">{Math.round(entry.confidence * 100)}%</span>
            </p>
          </div>
        </div>
        <MetricQualityBadge quality={entry.quality} />
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className={`text-2xl font-black tabular-nums ${metricQualityTone(entry.quality)}`}>
          {formatAuditMetricValue(entry)}
        </div>
        {!isDecisionGradeMetric(entry) ? (
          <div className="max-w-xl text-xs text-[var(--text-muted)]">{metricAuditReason(entry)}</div>
        ) : null}
      </div>
      {entry.warnings.length > 0 ? (
        <div className="mt-3 rounded-[var(--radius)] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
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
