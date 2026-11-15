"use client";

import type { Ref } from "react";

export interface SearchableCompany {
  ticker: string;
  name: string;
  sector?: string;
  source?: string;
}

interface StockSearchAddProps {
  search: string;
  onSearchChange: (value: string) => void;
  results: SearchableCompany[];
  watchlistTickers: string[];
  onAdd: (company: SearchableCompany) => void;
  adding: boolean;
  /** Omit to hide the Open Detail button (the Add stock dialog has no detail to open). */
  onOpenDetail?: (company: SearchableCompany) => void;
  formatSectorLabel: (value: string) => string;
  inputRef?: Ref<HTMLInputElement>;
  labels: {
    search: string;
    placeholder: string;
    ariaLabel: string;
    add: string;
    added: string;
    openDetail: string;
    empty: string;
  };
}

/** Company search with a per-result Add button; shared by the Weights tab and the Add stock dialog. */
export function StockSearchAdd({
  search, onSearchChange, results, watchlistTickers, onAdd, adding, onOpenDetail, formatSectorLabel, inputRef, labels,
}: StockSearchAddProps) {
  const watchlistTickerSet = new Set(watchlistTickers.map((ticker) => ticker.toUpperCase()));

  return (
    <>
      <div className="mt-4">
        <label className="flex flex-col gap-1 type-small text-[var(--ink-muted)]">
          {labels.search}
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={labels.placeholder}
            aria-label={labels.ariaLabel}
            className="rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 type-body text-[var(--ink)]"
          />
        </label>
      </div>

      <div className="mt-4 max-h-96 space-y-2 overflow-y-auto pr-1">
        {results.map((company) => {
          const alreadyAdded = watchlistTickerSet.has(company.ticker.toUpperCase());
          return (
            <div
              key={`browser-${company.ticker}`}
              className={`flex items-center justify-between gap-3 border px-3 py-3 ${
                alreadyAdded ? "border-[var(--line)] bg-[var(--surface)] opacity-70" : "border-[var(--line)] bg-[var(--surface-raised)]"
              }`}
            >
              <div className="min-w-0">
                <div className="type-mono  text-[var(--ink)]">{company.ticker}</div>
                <div className="truncate type-body text-[var(--ink-muted)]">{company.name}</div>
                <div className="type-small text-[var(--ink-muted)]">{formatSectorLabel(company.sector ?? "")}</div>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                {onOpenDetail ? (
                  <button
                    type="button"
                    onClick={() => onOpenDetail(company)}
                    className="inline-flex items-center justify-center rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 type-small text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  >
                    {labels.openDetail}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onAdd(company)}
                  disabled={alreadyAdded || adding}
                  className={`inline-flex items-center justify-center rounded-[var(--radius-1)] border px-3 py-2 type-small ${
                    alreadyAdded
                      ? "border-[var(--line)] bg-[var(--surface)] text-[var(--ink-muted)]"
                      : "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]"
                  } disabled:opacity-60`}
                >
                  {alreadyAdded ? labels.added : labels.add}
                </button>
              </div>
            </div>
          );
        })}
        {results.length === 0 && (
          <div className="border border-dashed border-[var(--line)] bg-[var(--surface-raised)] px-4 py-6 type-body text-[var(--ink-muted)]">
            {labels.empty}
          </div>
        )}
      </div>
    </>
  );
}
