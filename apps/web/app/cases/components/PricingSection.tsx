import { useQuery } from "@tanstack/react-query";
import { fmtPercent } from "../caseFields";
import { casesApi, retryUnlessRefused } from "../casesApi";
import { useLocale, useT } from "@/lib/i18n/locale";
import { formatNumber } from "@/lib/format";
import { fmtMoney } from "../format";
import { QueryStatus, Section } from "./Section";

/**
 * Does the DCF agree with what the market pays for this industry? The case's base-year
 * revenue priced at its own industry's EV/Sales, beside the DCF's EV. A refusal (no
 * ticker, no industry, a thin industry, no usable multiple) is content, as everywhere.
 */
export function PricingSection({ caseId }: { caseId: number }) {
  const { locale } = useLocale();
  const t = useT();
  const query = useQuery({
    queryKey: ["case-pricing", caseId],
    queryFn: () => casesApi.pricing(caseId),
    refetchOnWindowFocus: false,
    retry: retryUnlessRefused,
  });
  const pricing = query.data;
  const gap = pricing?.dcf_to_implied ?? 0;
  const direction = gap > 0 ? "above" : gap < 0 ? "below" : "at";

  return (
    <Section title={t("cases.pricing.title")} testId="case-pricing">
      <QueryStatus query={query} what={t("cases.status.whatCrossCheck")} testId="case-pricing" />
      {pricing && (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="border border-[var(--line)] px-3 py-2">
              <dt className="type-small text-[var(--ink-muted)]">{t("cases.pricing.evAtIndustry")}</dt>
              <dd data-testid="pricing-implied-ev" className="type-mono">
                {fmtMoney(pricing.implied_enterprise_value)}
              </dd>
            </div>
            <div className="border border-[var(--line)] px-3 py-2">
              <dt className="type-small text-[var(--ink-muted)]">{t("cases.pricing.evFromDcf")}</dt>
              <dd data-testid="pricing-dcf-ev" className="type-mono">
                {fmtMoney(pricing.dcf_enterprise_value)}
              </dd>
            </div>
            <div className="border border-[var(--line)] px-3 py-2">
              <dt className="type-small text-[var(--ink-muted)]">{t("cases.pricing.multipleUsed")}</dt>
              <dd data-testid="pricing-multiple" className="type-mono">
                ×{formatNumber(pricing.ev_sales, "ratio", { locale })}
              </dd>
            </div>
          </dl>
          <p data-testid="pricing-gap" className="mt-3 type-body text-[var(--ink)]">
            {direction === "at"
              ? t("cases.pricing.gapAt")
              : t(direction === "above" ? "cases.pricing.gapAbove" : "cases.pricing.gapBelow", { pct: fmtPercent(Math.abs(gap), 1) })}
          </p>
          <p data-testid="pricing-source" className="mt-1 type-small text-[var(--ink-muted)]">
            {t("cases.pricing.source", { source: pricing.source })}
          </p>
        </>
      )}
    </Section>
  );
}
