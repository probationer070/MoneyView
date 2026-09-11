"use client";

import { useState } from "react";
import { TickerSearch } from "@/components/ui/TickerSearch";
import type { WatchlistItem } from "../verdictTypes";

/**
 * The Valuation tab's ticker entry, now the shared `TickerSearch`.
 *
 * The two properties this panel depends on are preserved by that component: suggestions
 * are optional, because `items` may be empty while the watchlist request is in flight
 * (2-3.5s in production, since that endpoint fetches a live quote per ticker), and any
 * symbol may be typed whether or not it is on the watchlist.
 *
 * What changed is that a company name now matches too, and the suggestions are clickable
 * rather than a browser `datalist` -- the same behaviour as the other two searches, which
 * is the point of sharing it.
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
      <TickerSearch
        id="valuation-ticker"
        label="Ticker"
        value={draft}
        onChange={setDraft}
        onSelect={(ticker) => {
          setDraft(ticker);
          onSubmit(ticker);
        }}
        items={items}
        className="min-w-[16rem]"
      />
      <button
        type="submit"
        className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)]"
      >
        Show panel
      </button>
    </form>
  );
}
