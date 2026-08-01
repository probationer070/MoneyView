"use client";

import { useMemo } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { StockTile } from "./StockTile";
import type { NewsArticle, PortfolioStock } from "../page";

export const FALLBACK_TILE_COUNT = 12;

export type GridFilter = "held" | "all";

export function selectVisibleStocks(
  stocks: PortfolioStock[],
  filter: GridFilter,
  search: string,
): { stocks: PortfolioStock[]; isFallback: boolean } {
  const held = stocks.filter((stock) => stock.weight > 0);
  const anyHeld = held.length > 0;

  // All-or-nothing: the moment any weight exists the fallback is off entirely. Mixing
  // held and recent would leave the user unable to tell which tiles are holdings.
  let base: PortfolioStock[];
  let isFallback = false;
  if (filter === "all") {
    base = stocks;
  } else if (anyHeld) {
    base = held;
  } else {
    base = [...stocks].sort((a, b) => b.id - a.id).slice(0, FALLBACK_TILE_COUNT);
    isFallback = true;
  }

  const needle = search.trim().toUpperCase();
  const filtered = needle
    ? base.filter(
        (stock) =>
          stock.ticker.toUpperCase().includes(needle) ||
          stock.name.toUpperCase().includes(needle),
      )
    : base;

  return { stocks: filtered, isFallback };
}

interface StockTileGridProps {
  stocks: PortfolioStock[];
  newsByTicker: Record<string, { articles: NewsArticle[]; last_checked_at: string | null }>;
  filter: GridFilter;
  onFilterChange: (filter: GridFilter) => void;
  search: string;
  onSearchChange: (search: string) => void;
  onOpenStock: (stock: PortfolioStock) => void;
}

export function StockTileGrid({
  stocks, newsByTicker, filter, onFilterChange, search, onSearchChange, onOpenStock,
}: StockTileGridProps) {
  const { stocks: visible, isFallback } = useMemo(
    () => selectVisibleStocks(stocks, filter, search),
    [stocks, filter, search],
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 bg-[var(--bg-canvas)] pb-2">
        <select
          value={filter}
          onChange={(event) => onFilterChange(event.target.value as GridFilter)}
          aria-label="Grid filter"
          data-testid="grid-filter"
          className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-sm"
        >
          <option value="held">Held</option>
          <option value="all">All</option>
        </select>
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search ticker or name"
          aria-label="Search stocks"
          data-testid="grid-search"
          className="min-w-[12rem] flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-sm"
        />
      </div>

      {/* An empty watchlist is fallback-eligible but has nothing to show, and the banner
          would then contradict the empty state directly below it. */}
      {isFallback && visible.length > 0 ? (
        <p data-testid="grid-fallback-banner" className="text-[length:var(--type-helper)] text-[var(--text-muted)]">
          No weights set — showing {FALLBACK_TILE_COUNT} most recent. Set allocation weights
          to make this your holdings view.
        </p>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          title="No stocks to show"
          description="Add stocks from the allocation panel, or switch the filter to All."
        />
      ) : (
        <div
          data-testid="stock-tile-grid"
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}
        >
          {visible.map((stock) => (
            <StockTile
              key={stock.ticker}
              stock={stock}
              news={newsByTicker[stock.ticker]?.articles ?? []}
              lastCheckedAt={newsByTicker[stock.ticker]?.last_checked_at ?? null}
              showWeight={!isFallback}
              onOpen={onOpenStock}
            />
          ))}
        </div>
      )}
    </div>
  );
}
