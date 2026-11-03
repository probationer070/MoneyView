"use client";

import { CaseApiError } from "@/app/cases/casesApi";
import { Card } from "@/components/ui/Card";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { formatNumber, MISSING } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/i18n/translate";
import { useRelativePricing, type RelativePricingRow } from "@/lib/relativePricing";

const BASIS_LABEL: Record<RelativePricingRow["basis"], MessageKey> = {
  ev_sales: "corporate.relativePricing.basis.ev_sales",
  trailing_pe: "corporate.relativePricing.basis.trailing_pe",
  price_to_book: "corporate.relativePricing.basis.price_to_book",
};

const ROW_REFUSAL: Record<string, MessageKey> = {
  no_multiple: "corporate.relativePricing.refusalCode.no_multiple",
  no_revenue: "corporate.relativePricing.refusalCode.no_revenue",
  no_net_debt: "corporate.relativePricing.refusalCode.no_net_debt",
  no_shares: "corporate.relativePricing.refusalCode.no_shares",
  non_positive_value: "corporate.relativePricing.refusalCode.non_positive_value",
  no_earnings: "corporate.relativePricing.refusalCode.no_earnings",
  no_positive_earnings: "corporate.relativePricing.refusalCode.no_positive_earnings",
  no_book: "corporate.relativePricing.refusalCode.no_book",
  no_positive_book: "corporate.relativePricing.refusalCode.no_positive_book",
};

const REFUSED_REASON: Record<string, MessageKey> = {
  currency_mismatch: "corporate.relativePricing.refusedReason.currency_mismatch",
  thin_industry: "corporate.relativePricing.refusedReason.thin_industry",
  no_industry: "corporate.relativePricing.refusedReason.no_industry",
  unmapped_industry: "corporate.relativePricing.refusedReason.unmapped_industry",
  no_vintage: "corporate.relativePricing.refusedReason.no_vintage",
  no_price: "corporate.relativePricing.refusedReason.no_price",
};

/** The code before the colon in a server sentence "code: sentence". */
function refusalCode(detail: string): string {
  return detail.split(":")[0].trim();
}

/**
 * The industry's average multiples applied to this company (spec §12). A separate card from the
 * intrinsic value: its figures never share a cell with the DCF or the fair value.
 */
export function RelativePricingCard({ ticker }: { ticker: string }) {
  const t = useT();
  const { locale } = useLocale();
  const query = useRelativePricing(ticker || null);
  const title = <p className="type-caption uppercase text-[var(--ink-muted)]">{t("corporate.relativePricing.title")}</p>;

  if (query.error instanceof CaseApiError && query.error.isRefusal) {
    const code = refusalCode(query.error.detail);
    const reasonKey = REFUSED_REASON[code];
    return (
      <section data-testid="relative-pricing" data-state="refused">
        <Card padding="sm" className="flex flex-col gap-1">
          {title}
          <p data-part="refusal" className="type-small text-[var(--ink-secondary)]" title={query.error.detail}>
            {t("corporate.relativePricing.refused", { reason: reasonKey ? t(reasonKey) : query.error.detail })}
          </p>
        </Card>
      </section>
    );
  }

  if (!query.data) {
    return (
      <section data-testid="relative-pricing" data-state={query.isError ? "error" : "loading"}>
        <Card padding="sm" className="flex flex-col gap-1">
          {title}
          <p className="type-small text-[var(--ink-muted)]">
            {t(query.isError ? "corporate.relativePricing.failed" : "corporate.relativePricing.loading")}
          </p>
        </Card>
      </section>
    );
  }

  const data = query.data;
  const range = data.range;
  return (
    <section data-testid="relative-pricing" data-state="valued">
      <Card padding="sm" className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {title}
          <span className="type-small text-[var(--ink-muted)]">
            {t("corporate.relativePricing.caption", { industry: data.industry, firms: formatNumber(data.industry_firms, "integer", { locale }) })}
          </span>
        </div>
        <p data-part="range" className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {range ? (
            <>
              <span className="type-mono text-[var(--ink)]">
                {formatNumber(range.low, "price", { locale })} – {formatNumber(range.high, "price", { locale })}
              </span>
              <span className="type-small text-[var(--ink-muted)]">
                {t("corporate.relativePricing.median", { value: formatNumber(range.mid, "price", { locale }) })}
              </span>
            </>
          ) : (
            <span className="type-small text-[var(--ink-muted)]">{t("corporate.relativePricing.noRange")}</span>
          )}
        </p>
        <table data-part="rows" className="type-small w-full border-collapse text-left">
          <thead className="text-[var(--ink-muted)]">
            <tr>
              <th scope="col" className="type-caption py-0.5 pr-3 text-left">{t("corporate.relativePricing.col.basis")}</th>
              <th scope="col" className="type-caption py-0.5 pr-3 text-right">{t("corporate.relativePricing.col.industry")}</th>
              <th scope="col" className="type-caption py-0.5 pr-3 text-right">{t("corporate.relativePricing.col.value")}</th>
              <th scope="col" className="type-caption py-0.5 text-right">{t("corporate.relativePricing.col.gap")}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const code = row.refusal ? refusalCode(row.refusal) : "";
              const rowReasonKey = ROW_REFUSAL[code];
              return (
                <tr key={row.basis} data-basis={row.basis} className="border-t border-[var(--line)]">
                  <td className="py-0.5 pr-3 text-[var(--ink)]">{t(BASIS_LABEL[row.basis])}</td>
                  <td className="type-mono py-0.5 pr-3 text-right text-[var(--ink-secondary)]">{formatNumber(row.industry_multiple, "ratio", { locale })}</td>
                  <td className="py-0.5 pr-3 text-right">
                    {row.value_per_share !== null ? (
                      <span data-part="per-share" className="type-mono text-[var(--ink)]">{formatNumber(row.value_per_share, "price", { locale })}</span>
                    ) : row.refusal ? (
                      <span data-part="row-refusal" className="text-[var(--ink-secondary)]" title={row.refusal}>
                        {rowReasonKey ? t(rowReasonKey) : row.refusal}
                      </span>
                    ) : (
                      <span className="type-mono text-[var(--ink-muted)]">{MISSING}</span>
                    )}
                  </td>
                  <td className="py-0.5 text-right">{row.gap_pct !== null && <DeltaBadge value={row.gap_pct} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p data-part="note" className="type-caption text-[var(--ink-muted)]">{t("corporate.relativePricing.note")}</p>
      </Card>
    </section>
  );
}
