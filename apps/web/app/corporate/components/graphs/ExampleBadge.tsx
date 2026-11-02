"use client";

import { StatusBadge } from "@/components/ui/StatusBadge";
import { useT } from "@/lib/i18n/locale";

/**
 * Marks a chart element that is a fixed example, the same for every company, not this company's value
 * (spec 2026-11-02-corporate-explainers-plan §3 V4-V7, D1(a)). The reason is the hover title and the
 * accessible name, so a screen reader hears what the example is.
 */
export function ExampleBadge({ testId, why }: { testId: string; why: string }) {
  const t = useT();
  return (
    <span data-testid={testId} title={why} aria-label={`${t("corporate.charts.example")}: ${why}`} className="inline-flex">
      <StatusBadge status="stale" label={t("corporate.charts.example")} />
    </span>
  );
}
