"use client";

import { useState } from "react";
import type { WatchlistItem } from "../verdictTypes";

/**
 * A plain input with a datalist of watchlist suggestions.
 *
 * The suggestions are OPTIONAL by construction: `items` may be empty while the
 * watchlist request is still in flight (2-3.5s in production, because that
 * endpoint fetches a live quote per ticker), and the input still accepts any
 * symbol typed in. The panel must never wait on suggestions.
 */
export function TickerPicker({
  items,
  onSubmit,
}: {
  items: WatchlistItem[];
  onSubmit: (ticker: string) => void;
}) {
  const [draft, setDraft] = useState("");

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ticker = draft.trim().toUpperCase();
    if (ticker) onSubmit(ticker);
  };

  return (
    <form onSubmit={submit} className="mb-6 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
        Ticker
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          list="valuation-ticker-suggestions"
          className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-transparent px-2 py-1 text-[var(--text-primary)]"
        />
      </label>
      <datalist id="valuation-ticker-suggestions">
        {items.map((item) => (
          <option key={item.ticker} value={item.ticker}>{item.name}</option>
        ))}
      </datalist>
      <button
        type="submit"
        className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)]"
      >
        Show panel
      </button>
    </form>
  );
}
