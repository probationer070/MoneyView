"use client";

import { MetricQualityBadge } from "@/components/ui/MetricQualityBadge";
import { useT } from "@/lib/i18n/locale";
import type { AssumptionsApi } from "../corporateTypes";

const STALE_KEYS = ["risk_free", "erp"] as const;

/** Where rf and ERP came from and when; a stale badge per flag the server set. Nothing without an echo. */
export function AssumptionSourceCaption({ assumptions, compact = false }: { assumptions: AssumptionsApi | null; compact?: boolean }) {
  const t = useT();
  if (!assumptions) return null;
  const caption = t("corporate.assumptions.source.caption", {
    rfSource: assumptions.risk_free_source,
    rfAsOf: assumptions.risk_free_as_of,
    erpSource: assumptions.erp_source,
    erpAsOf: assumptions.erp_as_of,
  });
  return (
    <div className={compact ? "flex min-w-0 items-center gap-2" : "flex min-w-0 flex-wrap items-center gap-2"}>
      <p data-testid="assumption-source-caption" title={caption} className="type-small min-w-0 truncate text-[var(--ink-muted)]">{caption}</p>
      {STALE_KEYS.filter((key) => assumptions.stale.includes(key)).map((key) => (
        <span key={key} data-testid="assumption-stale-badge" className="inline-flex shrink-0 items-center gap-1.5">
          <MetricQualityBadge quality="stale" title={t(`corporate.assumptions.stale.${key}`)} />
          <span className={compact ? "sr-only" : "type-small text-[var(--status-warning-ink)]"}>{t(`corporate.assumptions.stale.${key}`)}</span>
        </span>
      ))}
    </div>
  );
}

/** The server's missing keys as reader words, joined; an unmapped key is shown as the server sent it. */
export function readableMissing(missing: string[], t: ReturnType<typeof useT>): string {
  return missing.map((key) => {
    const id = `corporate.assumptions.missing.label.${key}` as Parameters<ReturnType<typeof useT>>[0];
    const label = t(id);
    return label === id ? key : label;
  }).join(", ");
}

/** The refused WACC: title and reason, no number. */
export function WaccRefusedNote({ missing }: { missing: string[] }) {
  const t = useT();
  return (
    <div data-testid="wacc-refused" className="flex flex-col gap-1">
      <span className="type-label text-[var(--ink)]">{t("corporate.assumptions.missing.title")}</span>
      <span className="type-small text-[var(--ink-muted)]">{t("corporate.assumptions.missing.reason", { missing: readableMissing(missing, t) })}</span>
    </div>
  );
}
