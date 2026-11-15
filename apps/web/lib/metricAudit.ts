import type { CorporateMetricAuditEntry, MetricQuality } from "../../../packages/shared-types";
import { englishTr, type Tr } from "../app/cases/caseFields";

export function metricQualityTone(quality: MetricQuality) {
  switch (quality) {
    case "ok":
      return "text-[var(--status-success-ink)]";
    case "estimated":
    case "stale":
      return "text-[var(--status-warning-ink)]";
    case "suspicious":
    case "invalid":
      return "text-[var(--status-error-ink)]";
    case "missing":
    default:
      return "text-[var(--ink-muted)]";
  }
}

export function formatAuditMetricValue(entry: CorporateMetricAuditEntry, t: Tr = englishTr) {
  if (entry.quality === "invalid" || entry.quality === "missing") {
    return t("metricAudit.notAvailable");
  }
  return entry.display_value || t("metricAudit.notAvailable");
}

export function metricAuditReason(entry: CorporateMetricAuditEntry, t: Tr = englishTr) {
  return entry.reason ?? entry.warnings[0] ?? t("metricAudit.noNote");
}

export function isDecisionGradeMetric(entry: CorporateMetricAuditEntry) {
  return entry.quality === "ok";
}
