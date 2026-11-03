"use client";

import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { useFairValue } from "@/lib/fairValue";
import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";

/**
 * The Damodaran-style 10-year case value under a refused 5-year DCF verdict. Labelled with its source and
 * never mixed into the DCF numbers. Renders nothing while loading, on error, on a refusal, or for a non-positive value.
 */
export function VerdictFallback({ ticker }: { ticker: string }) {
  const t = useT();
  const { locale } = useLocale();
  const query = useFairValue(ticker || null);
  const data = query.data;
  if (!data || data.value_per_share === null || data.value_note) return null;
  const { value_per_share: value, gap_pct: gap } = data;

  return (
    <div data-testid="verdict-fallback" className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="type-small text-[var(--ink-muted)]">{t("corporate.verdict.fallbackLabel")}</span>
        <span data-part="fallback-value" className="type-figure-md text-[var(--ink)]">{formatNumber(value, "price", { locale })}</span>
        {gap !== null && <DeltaBadge value={gap} />}
      </div>
      <p data-part="fallback-source" className="type-caption text-[var(--ink-muted)]">{t("corporate.verdict.fallbackSource")}</p>
    </div>
  );
}
