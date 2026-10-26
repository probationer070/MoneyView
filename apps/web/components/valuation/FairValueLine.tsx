"use client";

import { CaseApiError } from "@/app/cases/casesApi";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { useFairValue } from "@/lib/fairValue";
import { formatNumber, MISSING } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import { impliedGrowthText } from "./fairValueText";

/**
 * The Damodaran-style fair value in one line under the corporate header's DCF verdict: value, its
 * gap to the price, and the growth the price implies. A refusal is shown in its own words.
 */
export function FairValueLine({ ticker }: { ticker: string }) {
  const t = useT();
  const { locale } = useLocale();
  const query = useFairValue(ticker || null);
  const base = "type-small inline-flex min-w-0 flex-wrap items-center gap-2 text-[var(--ink-secondary)]";

  if (query.isLoading) return <p data-testid="fair-value-line" data-state="loading" className={base}>{t("valuation.fairValue.loading")}</p>;
  if (query.error instanceof CaseApiError && query.error.isRefusal) {
    return (
      <p data-testid="fair-value-line" data-state="refused" className={base} title={query.error.detail}>
        {t("valuation.fairValue.refused", { reason: query.error.detail.split(":")[0] })}
      </p>
    );
  }
  if (query.isError || !query.data) {
    return query.isError ? <p data-testid="fair-value-line" data-state="error" className={base}>{t("valuation.fairValue.failed")}</p> : null;
  }
  const summary = query.data;
  return (
    <p data-testid="fair-value-line" data-state="valued" className={base}>
      <span>{t("valuation.fairValue.label")}</span>
      <span data-part="fair" className="type-mono text-[var(--ink)]">
        {summary.value_per_share === null ? MISSING : formatNumber(summary.value_per_share, "price", { locale })}
      </span>
      {summary.gap_pct !== null && <DeltaBadge value={summary.gap_pct} />}
      <span data-part="implied">{impliedGrowthText(summary, t, locale)}</span>
    </p>
  );
}
