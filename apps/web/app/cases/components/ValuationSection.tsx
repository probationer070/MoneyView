import type { UseQueryResult } from "@tanstack/react-query";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { useLocale } from "@/lib/i18n/locale";
import { fmtPercent } from "../caseFields";
import type { RunResult } from "../caseTypes";
import { fmtMoney, fmtPerShare } from "../format";
import { QueryStatus, Section } from "./Section";

function Figure({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="border border-[var(--line)] px-3 py-2">
      <p className="type-small text-[var(--ink-muted)]">{label}</p>
      <p data-testid={testId} className="type-mono text-[var(--ink)]">{value}</p>
    </div>
  );
}

export function ValuationSection({ query }: { query: UseQueryResult<RunResult, unknown> }) {
  const run = query.data;
  const { locale } = useLocale();
  return (
    <Section title="Valuation" testId="case-valuation">
      <QueryStatus query={query} what="the valuation" testId="case-valuation" />
      {run && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Figure label="Value per share (diluted)" value={fmtPerShare(run.value_per_share_diluted, locale)} testId="value-per-share-diluted" />
            <Figure label="Value per share (basic)" value={fmtPerShare(run.value_per_share_basic, locale)} testId="value-per-share-basic" />
            <Figure label="Enterprise value" value={fmtMoney(run.enterprise_value)} testId="enterprise-value" />
            <Figure label="Equity value" value={fmtMoney(run.equity_value)} testId="equity-value" />
            <Figure label="Terminal-value share" value={`${run.terminal_value_share_pct.toFixed(1)}%`} testId="terminal-share" />
          </div>
          {run.offering_price !== null && run.offering_implied_value !== null && run.offering_premium_pct !== null && (
            // Damodaran's offer check: the IPO price against the value per share, and the company value the price implies.
            <div data-testid="case-offering" className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Figure label="Offering price" value={fmtPerShare(run.offering_price, locale)} testId="offering-price" />
              <Figure label="Company value at the offer" value={fmtMoney(run.offering_implied_value)} testId="offering-implied-value" />
              <Figure
                label="Offer vs value per share"
                value={`${run.offering_premium_pct >= 0 ? "+" : "−"}${Math.abs(run.offering_premium_pct).toFixed(1)}%`}
                testId="offering-premium"
              />
              <Figure label="New shares" value={run.shares_new_effective.toLocaleString("en-US", { maximumFractionDigits: 4 })} testId="shares-new-effective" />
            </div>
          )}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-right type-body tabular-nums" aria-label="Year by year">
              <thead className="type-caption uppercase text-[var(--ink-muted)]">
                <tr>
                  <th className="px-2 py-1 text-left"><BilingualLabel k="year" /></th>
                  <th className="px-2 py-1"><BilingualLabel k="revenue" /></th>
                  <th className="px-2 py-1"><BilingualLabel k="ebit" /></th>
                  <th className="px-2 py-1"><BilingualLabel k="tax" /></th>
                  <th className="px-2 py-1"><BilingualLabel k="reinvestment" /></th>
                  <th className="px-2 py-1"><BilingualLabel k="fcff" /></th>
                  <th className="px-2 py-1"><BilingualLabel k="wacc" /></th>
                </tr>
              </thead>
              <tbody>
                {run.revenue.map((revenue, i) => (
                  <tr key={i} className="border-t border-[var(--line)]">
                    <td className="px-2 py-1 text-left">{run.base_year + i + 1}</td>
                    <td className="px-2 py-1 type-mono">{fmtMoney(revenue)}</td>
                    <td className="px-2 py-1 type-mono">{fmtMoney(run.ebit[i])}</td>
                    <td className="px-2 py-1 type-mono">{fmtMoney(run.tax[i])}</td>
                    <td className="px-2 py-1 type-mono">{fmtMoney(run.reinvestment[i])}</td>
                    <td className="px-2 py-1 type-mono">{fmtMoney(run.fcff[i])}</td>
                    <td className="px-2 py-1 type-mono">{fmtPercent(run.wacc[i], 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <table className="mt-4 w-full text-right type-body tabular-nums" aria-label="Segments in the target year">
            <thead className="type-caption uppercase text-[var(--ink-muted)]">
              <tr>
                <th className="px-2 py-1 text-left"><BilingualLabel k="segment" /> ({run.target_year})</th>
                <th className="px-2 py-1"><BilingualLabel k="revenue" /></th>
                <th className="px-2 py-1"><BilingualLabel k="margin" /></th>
                <th className="px-2 py-1"><BilingualLabel k="ebit" /></th>
                <th className="px-2 py-1"><BilingualLabel k="reinvestment" /></th>
              </tr>
            </thead>
            <tbody>
              {run.segments.map((s) => (
                <tr key={s.name} className="border-t border-[var(--line)]">
                  <td className="px-2 py-1 text-left">{s.name}</td>
                  <td className="px-2 py-1 type-mono">{fmtMoney(s.revenue[s.revenue.length - 1])}</td>
                  <td className="px-2 py-1 type-mono">{fmtPercent(s.margin[s.margin.length - 1], 1)}</td>
                  <td className="px-2 py-1 type-mono">{fmtMoney(s.ebit[s.ebit.length - 1])}</td>
                  <td className="px-2 py-1 type-mono">{fmtMoney(s.reinvestment[s.reinvestment.length - 1])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Section>
  );
}
