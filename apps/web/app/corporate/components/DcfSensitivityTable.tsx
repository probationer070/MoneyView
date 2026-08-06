"use client";

import type { DcfSensitivityCell, DcfSensitivityGrid } from "../../../../../packages/shared-types";
import { UNBRIDGED_PLACEHOLDER, UNBRIDGED_REASON } from "@/lib/bridgeQuality";

/** What a cell with no valuation renders as. Distinct in meaning from UNBRIDGED_PLACEHOLDER,
 *  which says the ticker has no equity bridge rather than that the model has no value here. */
const UNDEFINED_PLACEHOLDER = "n/a";

/**
 * Why a cell carries no valuation. The backend sends a closed set of two
 * (packages/core_finance/dcf.py); an unrecognised value still renders as undefined
 * rather than as a number, with the raw reason in the tooltip.
 */
const UNDEFINED_REASON_TEXT: Record<string, string> = {
  wacc_not_above_terminal_growth:
    "WACC is not above terminal growth at this point, so the Gordon growth model has no value here.",
  wacc_not_positive:
    "A WACC at or below zero is not a discount rate, so there is no valuation at this point.",
};

/**
 * A suppressed per-share value and an undefined cell are different absences and must not
 * render alike: the first says this ticker has no equity bridge, the second says the model
 * itself breaks down at these assumptions.
 */
function cellTitle(cell: DcfSensitivityCell): string {
  if (cell.undefined_reason) {
    return UNDEFINED_REASON_TEXT[cell.undefined_reason] ?? `No valuation at this point (${cell.undefined_reason}).`;
  }
  if (cell.intrinsic_value_per_share === null) return UNBRIDGED_REASON;
  return `WACC ${(cell.wacc * 100).toFixed(2)}%, terminal growth ${(cell.terminal_growth * 100).toFixed(2)}%`;
}

export function DcfSensitivityTable({
  sensitivity,
  formatNumber,
  formatPct,
}: {
  sensitivity: DcfSensitivityGrid;
  formatNumber: (value: number) => string;
  formatPct: (value: number) => string;
}) {
  const width = sensitivity.terminal_growth_values.length;

  return (
    <div className="space-y-2">
      <div>
        <h4 className="text-sm font-bold text-[var(--text-primary)]">WACC x Terminal Growth Sensitivity</h4>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Each cell revalues the same five projected FCFF years at that discount rate and perpetuity growth.
          The upper figure is intrinsic value per share, the lower one the share of enterprise value coming
          from the terminal period. A cell reading &quot;{UNDEFINED_PLACEHOLDER}&quot; is one where WACC is not
          above terminal growth, so the model has no value there rather than a large one.
        </p>
      </div>
      <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
        <table className="w-full min-w-[42rem] table-fixed text-left text-sm">
          <thead className="bg-[var(--surface)] text-[length:var(--type-table-header)] font-bold uppercase tracking-wide text-[var(--text-primary)]">
            <tr>
              <th className="px-3 py-2">WACC \ Terminal g</th>
              {sensitivity.terminal_growth_values.map((growth) => (
                <th key={`sensitivity-growth-${growth}`} className="px-3 py-2 tabular-nums">
                  {formatPct(growth * 100)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sensitivity.wacc_values.map((wacc, row) => (
              <tr key={`sensitivity-wacc-${wacc}`} className="border-t border-[var(--border)]">
                <td className="px-3 py-2 font-bold tabular-nums text-[var(--text-primary)]">{formatPct(wacc * 100)}</td>
                {sensitivity.terminal_growth_values.map((growth, column) => {
                  const cell = sensitivity.cells[row * width + column];
                  if (!cell) return <td key={`sensitivity-cell-${wacc}-${growth}`} className="px-3 py-2" />;

                  return (
                    <td
                      key={`sensitivity-cell-${wacc}-${growth}`}
                      title={cellTitle(cell)}
                      className={`px-3 py-2 ${cell.is_base ? "bg-[var(--surface-muted)] ring-1 ring-inset ring-[var(--accent)]" : ""}`}
                    >
                      <div className="font-bold tabular-nums text-[var(--text-primary)]">
                        {cell.undefined_reason
                          ? UNDEFINED_PLACEHOLDER
                          : cell.intrinsic_value_per_share === null
                            ? UNBRIDGED_PLACEHOLDER
                            : formatNumber(cell.intrinsic_value_per_share)}
                      </div>
                      <div className="text-xs tabular-nums text-[var(--text-muted)]">
                        {cell.terminal_value_share_pct === null
                          ? UNDEFINED_PLACEHOLDER
                          : `${formatPct(cell.terminal_value_share_pct)} terminal`}
                      </div>
                      {cell.is_base ? (
                        <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--accent)]">Base</div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
