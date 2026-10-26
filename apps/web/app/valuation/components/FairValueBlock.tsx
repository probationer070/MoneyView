"use client";

import Link from "next/link";
import { CaseApiError } from "@/app/cases/casesApi";
import { impliedGrowthText } from "@/components/valuation/fairValueText";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { useFairValue } from "@/lib/fairValue";
import { formatNumber, MISSING } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";

function Figure({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="border border-[var(--line)] px-3 py-2">
      <p className="type-small text-[var(--ink-muted)]">{label}</p>
      <p data-testid={testId} className="type-mono text-[var(--ink)]">{value}</p>
    </div>
  );
}

/** The ticker's Damodaran-style fair value, the floor beside it, and every assumption with its claim. */
export function FairValueBlock({ ticker }: { ticker: string }) {
  const t = useT();
  const { locale } = useLocale();
  const query = useFairValue(ticker);
  const price = (value: number | null) => (value === null ? MISSING : formatNumber(value, "price", { locale }));

  let body;
  if (query.isLoading) {
    body = <p role="status" className="type-body text-[var(--ink-secondary)]">{t("valuation.fairValue.loading")}</p>;
  } else if (query.error instanceof CaseApiError && query.error.isRefusal) {
    body = <p data-testid="fair-value-refusal" className="type-body text-[var(--ink-secondary)]">{t("valuation.fairValue.refused", { reason: query.error.detail })}</p>;
  } else if (query.isError || !query.data) {
    body = <p role="alert" className="type-body text-[var(--status-error-ink)]">{t("valuation.fairValue.failed")}</p>;
  } else {
    const summary = query.data;
    body = (
      <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label={t("valuation.fairValue.label")} value={price(summary.value_per_share)} testId="fair-value" />
          <Figure label={t("valuation.fairValue.price")} value={price(summary.price)} testId="fair-value-price" />
          <Figure label={t("valuation.fairValue.floor")} value={price(summary.floor_value_per_share)} testId="fair-value-floor" />
          <div className="border border-[var(--line)] px-3 py-2">
            <p className="type-small text-[var(--ink-muted)]">{t("valuation.fairValue.vsPrice")}</p>
            <div data-testid="fair-value-gap">{summary.gap_pct === null ? MISSING : <DeltaBadge value={summary.gap_pct} />}</div>
          </div>
        </div>
        <p data-testid="fair-value-implied" className="type-body text-[var(--ink)]">{impliedGrowthText(summary, t, locale)}</p>
        {summary.price_date && <p className="type-small text-[var(--ink-muted)]">{t("valuation.fairValue.asOf", { date: summary.price_date })}</p>}
        <details>
          <summary className="type-small cursor-pointer text-[var(--ink-secondary)]">{t("valuation.fairValue.assumptions")}</summary>
          <ul data-testid="fair-value-assumptions" className="mt-2 flex flex-col gap-1">
            {summary.assumptions.map((item) => (
              <li key={item.field} className="type-small text-[var(--ink-secondary)]">
                <span className="type-mono text-[var(--ink)]">{item.field}</span> {item.claim}
              </li>
            ))}
          </ul>
        </details>
        <Link href={`/cases/${summary.case_id}`} className="type-body text-[var(--ink)] underline underline-offset-2">
          {t("valuation.fairValue.openCase")}
        </Link>
      </>
    );
  }
  return (
    <section data-testid="fair-value-block" className="mb-6 flex flex-col gap-3">
      <h2 className="type-panel-title text-[var(--ink)]">{t("valuation.fairValue.title")}</h2>
      {body}
    </section>
  );
}
