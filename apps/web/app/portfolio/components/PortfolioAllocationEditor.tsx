"use client";

import React from "react";

export interface WatchlistDelta {
  delta_pct: number;
}

export interface PortfolioStock {
  ticker: string;
  name: string;
  sector: string;
  group_name: string;
  weight: number;
  last_close: number;
  delta: WatchlistDelta;
  sparkline: number[];
  // Mirrors PortfolioStock in ../page; the two must stay structurally identical.
  id: number;
}

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
          <h3 className="text-sm font-bold text-[var(--text-primary)]">Portfolio Table</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Drag the slider for quick weight changes or double-click the Allocation value for exact manual input. Allocation and investment-amount changes save automatically, and watchlist removal stays in the holdings area instead of this table.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">
            Total Investment
            <input
              type="number"
              min="0"
              step="100"
              value={totalInvestmentInput}
              onChange={(event) => setTotalInvestmentInput(event.target.value)}
              aria-label="Total investment amount"
              className="w-32 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-right text-xs text-[var(--text-primary)]"
            />
          </label>
          <label className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">
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
            className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            Normalize To 100%
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-sm text-[var(--text-muted)]">
          Draft total: <span className="font-semibold text-[var(--text-primary)]">{totalDraftWeightPercent.toFixed(1)}%</span>
        </div>
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-sm text-[var(--text-muted)]">
          Projected net value: <span className="font-semibold text-[var(--text-primary)]">{formatCurrencyCompact(allocationSummary.netProjectedValue)}</span>
        </div>
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-sm text-[var(--text-muted)]">
          Transaction fee reserve: <span className="font-semibold text-[var(--text-primary)]">{formatCurrencyCompact(allocationSummary.transactionFeeAmount)}</span>
        </div>
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-sm text-[var(--text-muted)]">
          Auto-save status: <span className="font-semibold text-[var(--text-primary)]">{savingAllocationTickers.length > 0 || savingTotalInvestment ? "Saving..." : "Synced"}</span>
        </div>
      </div>

      {draftWeightsOverflow && (
        <div className="mt-4 rounded-[var(--radius)] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Warning: draft allocation totals currently sum to {totalDraftWeightPercent.toFixed(1)}%. You can keep editing, but attribution will stay paused until saved weights are 100.0% or below.
        </div>
      )}

      <p className="mt-3 text-xs text-[var(--text-muted)]">
        `Final Profit` uses the current DCF upside metric for each stock and subtracts a `0.2%` transaction fee from the projected exit value. `Apply To Snapshot` keeps auto-saved allocation changes tied to today&apos;s saved comparison snapshot only when you opt in.
      </p>

      <div
        aria-label="Portfolio table scroll region"
        className="mt-4 max-h-[min(60vh,36rem)] overflow-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)]"
      >
        <table className="w-full min-w-[1120px] text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--surface-muted)] text-left text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-semibold">Ticker</th>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 text-right font-semibold">Allocation</th>
              <th className="px-4 py-3 font-semibold">Adjust</th>
              <th className="px-4 py-3 text-right font-semibold">Invested Amount</th>
              <th className="px-4 py-3 text-right font-semibold">Projected Net Value</th>
              <th className="px-4 py-3 text-right font-semibold">Final Profit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]/60">
            {allocationRows.map((row) => (
              <tr key={`weight-${row.stock.ticker}`}>
                <td className="px-4 py-3 font-bold text-[var(--text-primary)]">{row.stock.ticker}</td>
                <td className="px-4 py-3 text-[var(--text-muted)]">{row.stock.name || row.stock.ticker}</td>
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
                      className="w-24 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-right text-sm text-[var(--text-primary)]"
                    />
                  ) : (
                    <button
                      type="button"
                      onDoubleClick={() => handleAllocationValueDoubleClick(row.stock)}
                      className="ml-auto inline-flex rounded-[var(--radius)] border border-transparent px-2 py-1 font-semibold text-[var(--text-primary)] hover:border-[var(--border)]"
                    >
                      {row.allocationPercent.toFixed(1)}%
                    </button>
                  )}
                  {row.isSaving && <div className="text-[length:var(--type-caption)] text-[var(--text-muted)]">Saving...</div>}
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
                    className="w-full accent-[var(--accent)]"
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
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">
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
