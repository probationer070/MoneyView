"use client";

import { useMemo, type ReactNode } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { useT } from "@/lib/i18n/locale";
import { StockTile } from "./StockTile";
import type { NewsArticle, PortfolioStock } from "../page";

export const ALL_GROUPS = "all";

type Translate = ReturnType<typeof useT>;

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
  return resolveFromGroups(availableGroups(stocks), filter);
}

/**
 * What a group is called on screen.
 *
 * The bare group name was actively misleading for one of them: `total` is the group
 * unfollowing moves a stock INTO (page.tsx's `UNFOLLOWED_GROUP`), so an option reading
 * "total" filtered to the stocks the reader does NOT follow -- 136 of 143 on the live
 * database -- while sitting next to an `All` option that really did mean all 143. It named
 * the opposite of what it did.
 *
 * The group names in the data are left alone: renaming `total` would mean migrating
 * stock_targets.json and every stored row, and `UNFOLLOWED_GROUP` is the contract the
 * follow/unfollow round-trip depends on. The label was the defect, so the label is what
 * changed.
 */
export function groupLabel(group: string, followedGroup: string, unfollowedGroup: string, t: Translate): string {
  if (group === followedGroup) return t("portfolio.grid.followed");
  if (group === unfollowedGroup) return t("portfolio.grid.unfollowed");
  return group.replace(/_/g, " ");
}

/** The same rule against a group list the caller already has, so it is not rebuilt. */
function resolveFromGroups(groups: string[], filter: GridFilter): GridFilter {
  if (filter === ALL_GROUPS) return ALL_GROUPS;
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
  /** The group unfollowing moves a stock into. Named here only to label it; see groupLabel. */
  unfollowedGroup: string;
  onToggleFollow: (stock: PortfolioStock) => void;
  /** Rendered right after the grid-count line, inside the same header row. */
  statusSlot?: ReactNode;
  /** Renders the visible stocks as a table instead of tiles; the filter and search above are shared. */
  renderTable?: (visible: PortfolioStock[]) => ReactNode;
  /** Opens the Add stock dialog. Renders a dashed card as the last grid cell, or a row under the table. */
  onAddStock?: () => void;
  addStockLabel?: string;
}

export function StockTileGrid({
  stocks, newsByTicker, filter, onFilterChange, search, onSearchChange, onOpenStock,
  followedGroup, unfollowedGroup, onToggleFollow, statusSlot, renderTable, onAddStock, addStockLabel,
}: StockTileGridProps) {
  const t = useT();
  const groups = useMemo(() => availableGroups(stocks), [stocks]);

  const effectiveFilter = useMemo(() => resolveFromGroups(groups, filter), [groups, filter]);

  const { stocks: visible } = useMemo(
    () => selectVisibleStocks(stocks, effectiveFilter, search),
    [stocks, effectiveFilter, search],
  );

  const followedCount = useMemo(
    () => stocks.filter((stock) => stock.group_name === followedGroup).length,
    [stocks, followedGroup],
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* The count line is a sibling of the controls, not of the grid body, so it survives
          both scrolling (it is inside the sticky header) and the empty state (EmptyState
          replaces the body only). */}
      <div className="sticky top-0 z-10 flex flex-col gap-1 bg-[var(--bg)] pb-2">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={effectiveFilter}
            onChange={(event) => onFilterChange(event.target.value as GridFilter)}
            aria-label={t("portfolio.grid.filter")}
            data-testid="grid-filter"
            className="rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-2 py-1 type-body"
          >
            {groups.map((group) => (
              <option key={group} value={group}>
                {groupLabel(group, followedGroup, unfollowedGroup, t)}
              </option>
            ))}
            <option value={ALL_GROUPS}>{t("portfolio.grid.all")}</option>
          </select>
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t("portfolio.grid.searchPlaceholder")}
            aria-label={t("portfolio.grid.search")}
            data-testid="grid-search"
            className="min-w-[12rem] flex-1 rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-2 py-1 type-body"
          />
        </div>
        {/* Three separate figures, not one: how many the filter and search leave on screen,
            how many exist at all, and how many are followed. A single combined number
            cannot say which of the three moved. */}
        <span
          data-testid="grid-count"
          className="type-small text-[var(--ink-muted)]"
        >
          {t("portfolio.grid.count", { shown: visible.length, total: stocks.length, followed: followedCount })}
        </span>
        {statusSlot}
      </div>

      {visible.length === 0 ? (
        <>
        <EmptyState
          title={stocks.length === 0 ? t("portfolio.grid.noHoldings") : t("portfolio.grid.noneInGroup")}
          description={t("portfolio.grid.emptyHint")}
        />
        {onAddStock ? (
          <button
            type="button"
            onClick={onAddStock}
            className="w-full border border-dashed border-[var(--line)] px-3 py-2 type-body text-[var(--ink-muted)] hover:border-[var(--brand)] hover:text-[var(--ink)]"
          >
            {addStockLabel}
          </button>
        ) : null}
        </>
      ) : renderTable ? (
        <>
          {renderTable(visible)}
          {onAddStock ? (
            <button
              type="button"
              onClick={onAddStock}
              className="w-full border border-dashed border-[var(--line)] px-3 py-2 type-body text-[var(--ink-muted)] hover:border-[var(--brand)] hover:text-[var(--ink)]"
            >
              {addStockLabel}
            </button>
          ) : null}
        </>
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
          {onAddStock ? (
            <button
              type="button"
              onClick={onAddStock}
              className="flex min-h-[8rem] items-center justify-center border border-dashed border-[var(--line)] type-body text-[var(--ink-muted)] hover:border-[var(--brand)] hover:text-[var(--ink)]"
            >
              {addStockLabel}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
