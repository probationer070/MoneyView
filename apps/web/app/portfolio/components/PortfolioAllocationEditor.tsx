"use client";

import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { formatNumber } from "@/lib/format";
import React from "react";
// The type, not a copy of it: a clone had to be kept structurally identical to ../page by
// hand, and nothing would have failed if it drifted. `import type` is erased at compile
// time, so importing from the route module adds no runtime cycle -- StockTile does the same.
import type { PortfolioStock } from "../page";

export interface AllocationRow {
  stock: PortfolioStock;
  allocationPercent: number;
  allocatedAmount: number;
  netProjectedValue: number;
  finalProfit: number;
  isSaving: boolean;
}

export interface AllocationSummary {
  netProjectedValue: number;
  transactionFeeAmount: number;
}

interface PortfolioAllocationEditorProps {
  totalInvestmentInput: string;
  setTotalInvestmentInput: (val: string) => void;
  applyAllocationToSnapshot: boolean;
  setApplyAllocationToSnapshot: (val: boolean) => void;
  handleNormalizeWeights: () => void;
  savingAllocationTickers: string[];
  usingStoredWeights: boolean;
  totalStoredWeight: number;
  totalDraftWeightPercent: number;
  allocationSummary: AllocationSummary;
  savingTotalInvestment: boolean;
  draftWeightsOverflow: boolean;
  allocationRows: AllocationRow[];
  editingAllocationTicker: string | null;
  weightInputRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
  weightDrafts: Record<string, string>;
  handleAllocationDraftChange: (stock: PortfolioStock, value: string) => void;
  handleAllocationInputBlur: () => void;
  handleAllocationInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  handleAllocationValueDoubleClick: (stock: PortfolioStock) => void;
  formatCurrencyCompact: (value: number) => string;
  metricToneClass: (value: number | null) => string;
  watchlist: PortfolioStock[];
}

export function PortfolioAllocationEditor({
  totalInvestmentInput,
  setTotalInvestmentInput,
  applyAllocationToSnapshot,
  setApplyAllocationToSnapshot,
  handleNormalizeWeights,
  savingAllocationTickers,
  usingStoredWeights,
  totalStoredWeight,
  totalDraftWeightPercent,
  allocationSummary,
  savingTotalInvestment,
  draftWeightsOverflow,
  allocationRows,
  editingAllocationTicker,
  weightInputRefs,
  weightDrafts,
  handleAllocationDraftChange,
  handleAllocationInputBlur,
  handleAllocationInputKeyDown,
  handleAllocationValueDoubleClick,
  formatCurrencyCompact,
  metricToneClass,
  watchlist,
}: PortfolioAllocationEditorProps) {
  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="type-panel-title text-[var(--ink)]">Portfolio Table</h3>
          <p className="mt-1 type-body text-[var(--ink-muted)]">
            Drag the slider for quick weight changes or double-click the Allocation value for exact manual input. Allocation and investment-amount changes save automatically, and watchlist removal stays in the holdings area instead of this table.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 type-small text-[var(--ink-muted)]">
            Total Investment
            <input
              type="number"
              min="0"
              step="100"
              value={totalInvestmentInput}
              onChange={(event) => setTotalInvestmentInput(event.target.value)}
              aria-label="Total investment amount"
              className="w-32 rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-2 py-1 text-right type-small text-[var(--ink)]"
            />
          </label>
          <label className="inline-flex items-center gap-2 rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 type-small text-[var(--ink-muted)]">
            <input
              type="checkbox"
              checked={applyAllocationToSnapshot}
              onChange={(event) => setApplyAllocationToSnapshot(event.target.checked)}
              aria-label="Apply allocation changes to snapshot"
            />
            Apply To Snapshot
          </label>
          <button
            type="button"
            onClick={() => void handleNormalizeWeights()}
            disabled={savingAllocationTickers.length > 0 || !usingStoredWeights || totalStoredWeight <= 0}
            className="inline-flex items-center justify-center rounded-[var(--radius-1)] border border-[var(--line)] px-3 py-2 type-small text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-50"
          >
            Normalize To 100%
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="border border-[var(--line)] bg-[var(--surface-raised)] p-3 type-body text-[var(--ink-muted)]">
          Draft total: <span className="font-semibold text-[var(--ink)]">{formatNumber(totalDraftWeightPercent / 100, "percent", { digits: 1 })}</span>
        </div>
        <div className="border border-[var(--line)] bg-[var(--surface-raised)] p-3 type-body text-[var(--ink-muted)]">
          Projected net value: <span className="font-semibold text-[var(--ink)]">{formatCurrencyCompact(allocationSummary.netProjectedValue)}</span>
        </div>
        <div className="border border-[var(--line)] bg-[var(--surface-raised)] p-3 type-body text-[var(--ink-muted)]">
          Transaction fee reserve: <span className="font-semibold text-[var(--ink)]">{formatCurrencyCompact(allocationSummary.transactionFeeAmount)}</span>
        </div>
        <div className="border border-[var(--line)] bg-[var(--surface-raised)] p-3 type-body text-[var(--ink-muted)]">
          Auto-save status: <span className="font-semibold text-[var(--ink)]">{savingAllocationTickers.length > 0 || savingTotalInvestment ? "Saving..." : "Synced"}</span>
        </div>
      </div>

      {draftWeightsOverflow && (
        <div className="mt-4 border border-[var(--status-warning-border)] bg-[var(--status-warning-surface)] px-4 py-3 type-body text-[var(--status-warning-ink)]">
          Warning: draft allocation totals currently sum to {formatNumber(totalDraftWeightPercent / 100, "percent", { digits: 1 })}. You can keep editing, but attribution will stay paused until saved weights are 100.0% or below.
        </div>
      )}

      <p className="mt-3 type-small text-[var(--ink-muted)]">
        `Final Profit` uses the current DCF value vs price (a one-off gap, not a rate) for each stock and subtracts a `0.2%` transaction fee from the projected exit value. `Apply To Snapshot` keeps auto-saved allocation changes tied to today&apos;s saved comparison snapshot only when you opt in.
      </p>

      <div
        aria-label="Portfolio table scroll region"
        className="mt-4 max-h-[min(60vh,36rem)] overflow-auto border border-[var(--line)] bg-[var(--surface-raised)]"
      >
        <table className="w-full min-w-[1120px] type-body">
          <thead className="sticky top-0 z-10 bg-[var(--surface)] text-left text-[var(--ink-muted)]">
            <tr>
              <th className="px-4 py-3 type-caption"><BilingualLabel k="ticker" /></th>
              <th className="px-4 py-3 type-caption"><BilingualLabel k="name" /></th>
              <th className="px-4 py-3 text-right type-caption"><BilingualLabel k="allocation" /></th>
              <th className="px-4 py-3 type-caption"><BilingualLabel k="adjust" /></th>
              <th className="px-4 py-3 text-right type-caption"><BilingualLabel k="investedAmount" /></th>
              <th className="px-4 py-3 text-right type-caption"><BilingualLabel k="projectedNetValue" /></th>
              <th className="px-4 py-3 text-right type-caption"><BilingualLabel k="finalProfit" /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--grid)]">
            {allocationRows.map((row) => (
              <tr key={`weight-${row.stock.ticker}`}>
                <td className="px-4 py-3 font-bold text-[var(--ink)]">{row.stock.ticker}</td>
                <td className="px-4 py-3 text-[var(--ink-muted)]">{row.stock.name || row.stock.ticker}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {editingAllocationTicker === row.stock.ticker ? (
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      ref={(element) => {
                        weightInputRefs.current[row.stock.ticker] = element;
                      }}
                      value={weightDrafts[row.stock.ticker] ?? row.allocationPercent.toFixed(1)}
                      onChange={(event) => handleAllocationDraftChange(row.stock, event.target.value)}
                      onBlur={handleAllocationInputBlur}
                      onKeyDown={handleAllocationInputKeyDown}
                      className="w-24 rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-2 py-1 text-right type-body text-[var(--ink)]"
                    />
                  ) : (
                    <button
                      type="button"
                      onDoubleClick={() => handleAllocationValueDoubleClick(row.stock)}
                      className="ml-auto inline-flex rounded-[var(--radius-1)] border border-transparent px-2 py-1 font-semibold text-[var(--ink)] hover:border-[var(--line)]"
                    >
                      {formatNumber(row.allocationPercent / 100, "percent", { digits: 1 })}
                    </button>
                  )}
                  {row.isSaving && <div className="type-caption text-[var(--ink-muted)]">Saving...</div>}
                </td>
                <td className="px-4 py-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="0.1"
                    value={weightDrafts[row.stock.ticker] ?? row.allocationPercent.toFixed(1)}
                    onChange={(event) => handleAllocationDraftChange(row.stock, event.target.value)}
                    aria-label={`${row.stock.ticker} allocation slider`}
                    className="w-full accent-[var(--brand)]"
                  />
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCurrencyCompact(row.allocatedAmount)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCurrencyCompact(row.netProjectedValue)}</td>
                <td className={`px-4 py-3 text-right font-semibold tabular-nums ${metricToneClass(row.finalProfit)}`}>
                  {formatCurrencyCompact(row.finalProfit)}
                </td>
              </tr>
            ))}
            {watchlist.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center type-body text-[var(--ink-muted)]">
                  Add a stock from the search panel to start building the portfolio table.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
