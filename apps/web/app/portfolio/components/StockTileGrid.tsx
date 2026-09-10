"use client";

import { useMemo } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { StockTile } from "./StockTile";
import type { NewsArticle, PortfolioStock } from "../page";

export const ALL_GROUPS = "all";

/** A watchlist group name, or `all` for every stock regardless of group. */
export type GridFilter = string;

/**
 * The groups present, in a stable order, for the filter dropdown.
 *
 * `custom` first when it exists: it is the curated set in `stock_targets.json` and the
 * one a reader means by "the stocks I follow". The rest sort alphabetically so the list
 * does not reshuffle as tickers move between groups.
 */
export function availableGroups(stocks: PortfolioStock[]): string[] {
  const groups = [...new Set(stocks.map((stock) => stock.group_name).filter(Boolean))];
  return groups.sort((a, b) => {
    if (a === "custom") return -1;
    if (b === "custom") return 1;
    return a.localeCompare(b);
  });
}

/**
 * The group actually shown, given the group the caller asked for.
 *
 * A watchlist seeded from the built-in defaults has only `built_in`, one seeded from
 * stock_targets.json has `custom` and `total`, and a stored preference can name a group
 * that no longer exists. Pinning a literal default would show an empty grid in each of
 * those cases; falling back to the first available group cannot.
 *
 * Exported because the page derives the visible ticker set from it too -- the bulk news
 * query and the Refresh button both act on "what is on screen", and resolving the filter
 * in two places would let them act on a set the grid is not showing.
 */
export function resolveGroupFilter(stocks: PortfolioStock[], filter: GridFilter): GridFilter {
  if (filter === ALL_GROUPS) return ALL_GROUPS;
  const groups = availableGroups(stocks);
  return groups.includes(filter) ? filter : groups[0] ?? ALL_GROUPS;
}

/**
 * Which tiles the grid shows.
 *
 * Membership is `group_name`, not `weight > 0`. Weight is an allocation figure that
 * attribution consumes and refuses above 100%; using it to also mean "do I follow this"
 * left the grid with no answer at all when every weight was 0 -- which was true of all
 * 139 rows -- so it fell back to showing the 12 most recently added stocks behind a
 * banner. Nobody chose those twelve, and the banner did not read as an explanation.
 *
 * A group is a list of names, so curating it costs no numbers, and the empty state now
 * says a group is empty rather than quietly substituting different stocks for it.
 */
export function selectVisibleStocks(
  stocks: PortfolioStock[],
  filter: GridFilter,
  search: string,
): { stocks: PortfolioStock[] } {
  const base = filter === ALL_GROUPS
    ? stocks
    : stocks.filter((stock) => stock.group_name === filter);

  const needle = search.trim().toUpperCase();
  const filtered = needle
    ? base.filter(
        (stock) =>
          stock.ticker.toUpperCase().includes(needle) ||
          stock.name.toUpperCase().includes(needle),
      )
    : base;

  return { stocks: filtered };
}

interface StockTileGridProps {
  stocks: PortfolioStock[];
  newsByTicker: Record<string, { articles: NewsArticle[]; last_checked_at: string | null }>;
  filter: GridFilter;
  onFilterChange: (filter: GridFilter) => void;
  search: string;
  onSearchChange: (search: string) => void;
  onOpenStock: (stock: PortfolioStock) => void;
  /** The group a tile's follow control moves a stock into and out of. */
  followedGroup: string;
  onToggleFollow: (stock: PortfolioStock) => void;
}

export function StockTileGrid({
  stocks, newsByTicker, filter, onFilterChange, search, onSearchChange, onOpenStock,
  followedGroup, onToggleFollow,
}: StockTileGridProps) {
  const groups = useMemo(() => availableGroups(stocks), [stocks]);

  const effectiveFilter = useMemo(() => resolveGroupFilter(stocks, filter), [stocks, filter]);

  const { stocks: visible } = useMemo(
    () => selectVisibleStocks(stocks, effectiveFilter, search),
    [stocks, effectiveFilter, search],
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 bg-[var(--bg-canvas)] pb-2">
        <select
          value={effectiveFilter}
          onChange={(event) => onFilterChange(event.target.value as GridFilter)}
          aria-label="Grid filter"
          data-testid="grid-filter"
          className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-sm"
        >
          {groups.map((group) => (
            <option key={group} value={group}>
              {group === "custom" ? "Followed" : group.replace(/_/g, " ")}
            </option>
          ))}
          <option value={ALL_GROUPS}>All</option>
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

      {visible.length === 0 ? (
        <EmptyState
          title="No stocks in this group"
          description="Follow a stock with the + on its tile in All, or switch the filter to All."
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
              // No entry at all is passed through as undefined, NOT as null. The bulk news
              // query is keyed on the debounced search, so a ticker the newest keystroke
              // just revealed is legitimately absent for a moment; null would claim it had
              // never been checked. StockTile renders the two apart.
              lastCheckedAt={newsByTicker[stock.ticker]?.last_checked_at}
              followed={stock.group_name === followedGroup}
              onToggleFollow={onToggleFollow}
              onOpen={onOpenStock}
            />
          ))}
        </div>
      )}
    </div>
  );
}
