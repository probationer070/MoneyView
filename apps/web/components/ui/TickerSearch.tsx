"use client";

import { useId, useMemo, useState } from "react";

/**
 * One ticker search, used everywhere a ticker or company is looked up.
 *
 * Three separate implementations had grown: Valuation used a plain input with a
 * `datalist`, Corporate Analysis a filtered overlay of clickable company names, and the
 * Decision Log a bare input with no suggestions at all. Same job, three matching rules,
 * three behaviours to learn.
 *
 * The shared behaviour is modelled on the richest of the three rather than the thinnest.
 * Unifying downward onto the `datalist` would have cost Corporate its click-to-select
 * list -- an affordance an existing spec depends on, and the only one that lets a reader
 * find a company whose ticker they do not know.
 *
 * Two properties carried over from Valuation's version, both load-bearing:
 *
 * - Suggestions are OPTIONAL. `items` may be empty while the watchlist request is in
 *   flight (2-3.5s in production, because that endpoint fetches a live quote per ticker).
 *   The input must never wait on them.
 * - Any symbol may be typed. The suggestion list is a convenience, never a whitelist; a
 *   ticker absent from the watchlist is still a valid thing to ask about.
 */

export interface TickerSearchItem {
  ticker: string;
  name?: string;
}

interface TickerSearchProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Chosen from the list, or submitted as typed. Receives the upper-cased ticker. */
  onSelect: (ticker: string) => void;
  items: TickerSearchItem[];
  placeholder?: string;
  /** Marks the currently active ticker in the list, where the caller tracks one. */
  selectedTicker?: string;
  id?: string;
  className?: string;
  maxSuggestions?: number;
}

/**
 * Matches a ticker prefix or any part of a company name.
 *
 * One rule for every caller: Corporate searched names only, Valuation's `datalist`
 * matched however the browser chose to, and the Decision Log matched nothing. A reader
 * who types "micro" wants Microsoft, and one who types "MS" wants the ticker.
 */
export function matchTickerItems(
  items: TickerSearchItem[],
  query: string,
  limit = 8,
): TickerSearchItem[] {
  const needle = query.trim().toUpperCase();
  if (!needle) return [];
  return items
    .filter((item) => {
      const ticker = item.ticker.toUpperCase();
      const name = (item.name ?? "").toUpperCase();
      return ticker.startsWith(needle) || name.includes(needle);
    })
    .slice(0, limit);
}

export function TickerSearch({
  label,
  value,
  onChange,
  onSelect,
  items,
  placeholder = "Ticker or company name",
  selectedTicker,
  id,
  className = "",
  maxSuggestions = 8,
}: TickerSearchProps) {
  const generatedId = useId();
  const inputId = id ?? `ticker-search-${generatedId}`;
  const [open, setOpen] = useState(false);

  const matches = useMemo(
    () => matchTickerItems(items, value, maxSuggestions),
    [items, value, maxSuggestions],
  );

  const commit = (ticker: string) => {
    const normalized = ticker.trim().toUpperCase();
    if (!normalized) return;
    setOpen(false);
    onSelect(normalized);
  };

  return (
    <div className={`relative flex flex-col gap-1 ${className}`}>
      <label htmlFor={inputId} className="text-xs text-[var(--text-secondary)]">
        {label}
      </label>
      <input
        id={inputId}
        // A distinctive name keeps the browser's own form history out of the way; it
        // would otherwise cover the suggestion list with values from other pages.
        name={`${inputId}-no-history`}
        type="text"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // A click on a suggestion blurs the input first, so closing on blur immediately
        // would unmount the button before its click lands.
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(matches.length === 1 ? matches[0].ticker : value);
          }
          if (event.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={`${inputId}-listbox`}
        aria-autocomplete="list"
        data-testid={`${inputId}-input`}
        className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-transparent px-2 py-1 text-[var(--text-primary)]"
      />
      {open && matches.length > 0 ? (
        <div
          id={`${inputId}-listbox`}
          role="listbox"
          // Absolutely positioned so opening the list never pushes the layout below it.
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-1 shadow-lg"
        >
          {matches.map((item) => (
            <button
              key={item.ticker}
              type="button"
              role="option"
              aria-selected={item.ticker === selectedTicker}
              onClick={() => commit(item.ticker)}
              className={`block w-full rounded px-3 py-2 text-left text-sm transition hover:bg-[var(--surface)] ${
                item.ticker === selectedTicker
                  ? "bg-[var(--surface)] font-bold text-[var(--text-primary)]"
                  : "text-[var(--text-muted)]"
              }`}
            >
              {/* The space is load-bearing: without it the accessible name reads
                  "MicrosoftMSFT", which no reasonable selector or screen reader expects. */}
              {item.name ? `${item.name} ` : ""}
              <span className={item.name ? "text-xs text-[var(--text-muted)]" : ""}>
                {item.ticker}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
