import { useQuery } from "@tanstack/react-query";
import { fmtPercent } from "../caseFields";
import { casesApi, retryUnlessRefused } from "../casesApi";
import { fmtMoney } from "../format";
import { QueryStatus, Section } from "./Section";

/**
 * Does the DCF agree with what the market pays for this industry? The case's base-year
 * revenue priced at its own industry's EV/Sales, beside the DCF's EV. A refusal (no
 * ticker, no industry, a thin industry, no usable multiple) is content, as everywhere.
 */
export function PricingSection({ caseId }: { caseId: number }) {
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
    <Section title="Market cross-check (EV/Sales)" testId="case-pricing">
      <QueryStatus query={query} what="the market cross-check" testId="case-pricing" />
      {pricing && (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-2">
              <dt className="text-xs text-[var(--text-muted)]">EV at the industry&apos;s EV/Sales</dt>
              <dd data-testid="pricing-implied-ev" className="text-lg font-bold tabular-nums">
                {fmtMoney(pricing.implied_enterprise_value)}
              </dd>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-2">
              <dt className="text-xs text-[var(--text-muted)]">EV from the DCF</dt>
              <dd data-testid="pricing-dcf-ev" className="text-lg font-bold tabular-nums">
                {fmtMoney(pricing.dcf_enterprise_value)}
              </dd>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-2">
              <dt className="text-xs text-[var(--text-muted)]">EV/Sales used</dt>
              <dd data-testid="pricing-multiple" className="text-lg font-bold tabular-nums">
                ×{pricing.ev_sales.toFixed(2)}
              </dd>
            </div>
          </dl>
          <p data-testid="pricing-gap" className="mt-3 text-sm text-[var(--text-primary)]">
            {direction === "at"
              ? "The DCF values the business at what its industry's EV/Sales implies."
              : `The DCF values the business ${fmtPercent(Math.abs(gap), 1)} ${direction} what its industry's EV/Sales implies.`}
          </p>
          <p data-testid="pricing-source" className="mt-1 text-xs text-[var(--text-muted)]">
            {pricing.source}. Both figures are enterprise values in the case&apos;s own units; the
            comparison has no time horizon.
          </p>
        </>
      )}
    </Section>
  );
}
