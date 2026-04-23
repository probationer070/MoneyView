"use client";

import type { CalculationDetailKey } from "./calculationDetailTypes";

export interface ComparisonTableRow {
  ticker: string;
  name: string;
  sector: string;
  group_name: string;
  weight: number;
  roic_minus_wacc: number;
  dcf_value: number;
  current_price: number;
  dcf_implied_return: number;
  capm_expected_return: number;
  market_expected_return: number;
  expected_return_spread: number;
  has_price_data: boolean;
}

interface CorporateComparisonTableProps {
  rows: ComparisonTableRow[];
  currentTicker: string;
  onSelectTicker: (ticker: string) => void;
  onOpenCalculationForTicker: (ticker: string, key: CalculationDetailKey) => void;
  formatPct2: (value: number) => string;
  formatMoney: (value: number) => string;
}

export function CorporateComparisonTable({
  rows,
  currentTicker,
  onSelectTicker,
  onOpenCalculationForTicker,
  formatPct2,
  formatMoney,
}: CorporateComparisonTableProps) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-[var(--surface-muted)] text-left text-[var(--text-muted)]">
          <tr>
            <th className="px-4 py-3 font-semibold">Ticker</th>
            <th className="px-4 py-3 font-semibold">Company</th>
            <th className="px-4 py-3 font-semibold">Sector</th>
            <th className="px-4 py-3 text-right font-semibold">Weight</th>
            <th className="px-4 py-3 text-right font-semibold">ROIC - WACC</th>
            <th className="px-4 py-3 text-right font-semibold">DCF Value</th>
            <th className="px-4 py-3 text-right font-semibold">Current Price</th>
            <th className="px-4 py-3 text-right font-semibold">DCF Return</th>
            <th className="px-4 py-3 text-right font-semibold">CAPM Return</th>
            <th className="px-4 py-3 text-right font-semibold">Market Return</th>
            <th className="px-4 py-3 text-right font-semibold">Spread</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]/60">
          {rows.map((row) => (
            <tr key={`comparison-${row.ticker}`} className={row.ticker === currentTicker ? "bg-[var(--surface-muted)]/50" : ""}>
              <td className="px-4 py-3 font-bold text-[var(--text-primary)]">
                {row.group_name !== "benchmark" ? (
                  <button
                    type="button"
                    onClick={() => onSelectTicker(row.ticker)}
                    className="rounded underline decoration-dotted underline-offset-4"
                  >
                    {row.ticker}
                  </button>
                ) : row.ticker}
              </td>
              <td className="px-4 py-3 text-[var(--text-muted)]">{row.name || row.ticker}</td>
              <td className="px-4 py-3 text-[var(--text-muted)]">{row.sector || "N/A"}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatPct2(row.weight * 100)}</td>
              <td className="px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() => onOpenCalculationForTicker(row.ticker, "spread")}
                  disabled={row.group_name === "benchmark"}
                  className={`font-bold tabular-nums ${row.roic_minus_wacc >= 0 ? "text-[var(--surface)]" : "text-[var(--delta-down)]"} ${row.group_name === "benchmark" ? "cursor-default" : "underline decoration-dotted underline-offset-4 hover:opacity-80"}`}
                >
                  {formatPct2(row.roic_minus_wacc)}
                </button>
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() => onOpenCalculationForTicker(row.ticker, "backendFairValue")}
                  disabled={row.group_name === "benchmark"}
                  className={`font-bold tabular-nums text-[var(--text-primary)] ${row.group_name === "benchmark" ? "cursor-default" : "underline decoration-dotted underline-offset-4 hover:opacity-80"}`}
                >
                  {formatMoney(row.dcf_value)}
                </button>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{row.has_price_data ? formatMoney(row.current_price) : "N/A"}</td>
              <td className="px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() => onOpenCalculationForTicker(row.ticker, "backendDcf")}
                  disabled={row.group_name === "benchmark"}
                  className={`tabular-nums text-[var(--text-primary)] ${row.group_name === "benchmark" ? "cursor-default" : "underline decoration-dotted underline-offset-4 hover:opacity-80"}`}
                >
                  {formatPct2(row.dcf_implied_return)}
                </button>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{formatPct2(row.capm_expected_return)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatPct2(row.market_expected_return)}</td>
              <td className="px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() => onOpenCalculationForTicker(row.ticker, "riskReturnMinard")}
                  disabled={row.group_name === "benchmark"}
                  className={`font-bold tabular-nums ${row.expected_return_spread >= 0 ? "text-[var(--surface)]" : "text-[var(--delta-down)]"} ${row.group_name === "benchmark" ? "cursor-default" : "underline decoration-dotted underline-offset-4 hover:opacity-80"}`}
                >
                  {formatPct2(row.expected_return_spread)}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
