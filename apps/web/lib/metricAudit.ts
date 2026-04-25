import type { CorporateMetricAuditEntry, MetricQuality } from "../../../packages/shared-types";

export function metricQualityTone(quality: MetricQuality) {
  switch (quality) {
    case "ok":
      return "text-[var(--state-success)]";
    case "estimated":
    case "stale":
      return "text-[var(--state-warning)]";
    case "suspicious":
    case "invalid":
      return "text-[var(--state-error)]";
    case "missing":
    default:
      return "text-[var(--text-muted)]";
  }
}

export function formatAuditMetricValue(entry: CorporateMetricAuditEntry) {
  if (entry.quality === "invalid" || entry.quality === "missing") {
    return "N/A";
  }
  return entry.display_value || "N/A";
}

export function metricAuditReason(entry: CorporateMetricAuditEntry) {
  return entry.reason ?? entry.warnings[0] ?? "No additional audit note.";
}

export function isDecisionGradeMetric(entry: CorporateMetricAuditEntry) {
  return entry.quality === "ok";
}
