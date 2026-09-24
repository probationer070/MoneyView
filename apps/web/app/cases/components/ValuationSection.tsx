import type { UseQueryResult } from "@tanstack/react-query";
import type { RunResult } from "../caseTypes";
import { fmtMoney, fmtPerShare } from "../format";
import { QueryStatus, Section } from "./Section";

function Figure({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-2">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p data-testid={testId} className="text-lg font-bold tabular-nums text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

export function ValuationSection({ query }: { query: UseQueryResult<RunResult, unknown> }) {
  const run = query.data;
  return (
    <Section title="Valuation" testId="case-valuation">
      <QueryStatus query={query} what="the valuation" testId="case-valuation" />
      {run && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Figure label="Value per share (diluted)" value={fmtPerShare(run.value_per_share_diluted)} testId="value-per-share-diluted" />
            <Figure label="Value per share (basic)" value={fmtPerShare(run.value_per_share_basic)} testId="value-per-share-basic" />
            <Figure label="Enterprise value" value={fmtMoney(run.enterprise_value)} testId="enterprise-value" />
            <Figure label="Equity value" value={fmtMoney(run.equity_value)} testId="equity-value" />
            <Figure label="Terminal-value share" value={`${run.terminal_value_share_pct.toFixed(1)}%`} testId="terminal-share" />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-right text-sm tabular-nums" aria-label="Year by year">
              <thead className="text-xs text-[var(--text-muted)]">
                <tr>
                  <th className="px-2 py-1 text-left">Year</th>
                  <th className="px-2 py-1">Revenue</th>
                  <th className="px-2 py-1">EBIT</th>
                  <th className="px-2 py-1">Tax</th>
                  <th className="px-2 py-1">Reinvestment</th>
                  <th className="px-2 py-1">FCFF</th>
                  <th className="px-2 py-1">WACC</th>
                </tr>
              </thead>
              <tbody>
                {run.revenue.map((revenue, i) => (
                  <tr key={i} className="border-t border-[var(--border)]">
                    <td className="px-2 py-1 text-left">{run.base_year + i + 1}</td>
                    <td className="px-2 py-1">{fmtMoney(revenue)}</td>
                    <td className="px-2 py-1">{fmtMoney(run.ebit[i])}</td>
                    <td className="px-2 py-1">{fmtMoney(run.tax[i])}</td>
                    <td className="px-2 py-1">{fmtMoney(run.reinvestment[i])}</td>
                    <td className="px-2 py-1">{fmtMoney(run.fcff[i])}</td>
                    <td className="px-2 py-1">{(run.wacc[i] * 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <table className="mt-4 w-full text-right text-sm tabular-nums" aria-label="Segments in the target year">
            <thead className="text-xs text-[var(--text-muted)]">
              <tr>
                <th className="px-2 py-1 text-left">Segment ({run.target_year})</th>
                <th className="px-2 py-1">Revenue</th>
                <th className="px-2 py-1">Margin</th>
                <th className="px-2 py-1">EBIT</th>
                <th className="px-2 py-1">Reinvestment</th>
              </tr>
            </thead>
            <tbody>
              {run.segments.map((s) => (
                <tr key={s.name} className="border-t border-[var(--border)]">
                  <td className="px-2 py-1 text-left">{s.name}</td>
                  <td className="px-2 py-1">{fmtMoney(s.revenue[s.revenue.length - 1])}</td>
                  <td className="px-2 py-1">{(s.margin[s.margin.length - 1] * 100).toFixed(1)}%</td>
                  <td className="px-2 py-1">{fmtMoney(s.ebit[s.ebit.length - 1])}</td>
                  <td className="px-2 py-1">{fmtMoney(s.reinvestment[s.reinvestment.length - 1])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Section>
  );
}
