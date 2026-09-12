"use client";

import clsx from "clsx";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { TileSparkline } from "./TileSparkline";
import type { NewsArticle, PortfolioStock } from "../page";

function relativeAge(published: string): string {
  if (!published) return "";
  const then = new Date(published).getTime();
  if (Number.isNaN(then)) return "";
  const hours = Math.floor((Date.now() - then) / 3_600_000);
  if (hours < 1) return "now";
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// A missing close stays missing: a neutral dash, never a stand-in 0.
function formatClose(lastClose: number | null): string {
  // `Number.isFinite` is not a type guard for null, so the null arm is explicit. The
  // runtime behaviour is unchanged -- Number.isFinite(null) is already false.
  if (lastClose === null || !Number.isFinite(lastClose)) return "—";
  return `${lastClose.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}$`;
}

// The button's accessible name is its action, not its contents: ticker, price and delta
// only. A missing price or delta is omitted outright rather than voiced as 0.
function tileLabel(stock: PortfolioStock): string {
  const parts: string[] = [stock.ticker];
  if (Number.isFinite(stock.last_close)) {
    parts.push(formatClose(stock.last_close));
  }
  const deltaPct = stock.delta?.delta_pct;
  if (typeof deltaPct === "number" && Number.isFinite(deltaPct)) {
    parts.push(`${deltaPct < 0 ? "down" : "up"} ${Math.abs(deltaPct).toFixed(1)}%`);
  }
  return `Open details for ${parts.join(", ")}`;
}

// The three news states are distinct claims and only two of them are about the data.
// A null last_checked_at means the backend told us this ticker has never been checked;
// undefined means we have not been told anything about it yet, because the bulk query is
// keyed on the debounced search and a ticker revealed by the newest keystroke is not in
// the current response. Collapsing the second into the first would state "never checked"
// about a ticker that may well have been checked a minute ago.
function emptyNewsSummary(lastCheckedAt: string | null | undefined): string {
  if (lastCheckedAt === undefined) return "News not loaded yet";
  if (lastCheckedAt === null) return "Never checked for news";
  const at = new Date(lastCheckedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `No recent news · last checked ${at}`;
}

interface StockTileProps {
  stock: PortfolioStock;
  news: NewsArticle[];
  /** `null` = never checked; `undefined` = not yet known. See newsSummary. */
  lastCheckedAt: string | null | undefined;
  /** Whether this stock is in the group the grid currently treats as "followed". */
  followed: boolean;
  onToggleFollow: (stock: PortfolioStock) => void;
  onOpen: (stock: PortfolioStock) => void;
}

export function StockTile({ stock, news, lastCheckedAt, followed, onToggleFollow, onOpen }: StockTileProps) {
  // aria-label names the button, and an explicit name suppresses the descendant text, so
  // the headlines -- the thing this tile exists to show -- are not in the name. They are
  // attached as the button's DESCRIPTION instead, which assistive tech announces after the
  // name rather than in place of it.
  const newsId = `stock-tile-news-${stock.ticker}`;
  return (
    // The follow control is a SIBLING of the tile button, not a child: the tile is itself
    // a <button>, and a nested button is invalid HTML that browsers reparent -- there is a
    // spec test asserting the tile holds only phrasing content. It is absolutely positioned
    // over the tile's top-right corner, which the header row does NOT leave free -- the
    // DeltaBadge is right-aligned into exactly that corner. The header row reserves the
    // button's footprint with `pr-6`; see the note there.
    <div className="relative" data-testid={`stock-tile-cell-${stock.ticker}`}>
    <button
      type="button"
      onClick={() => onOpen(stock)}
      aria-label={tileLabel(stock)}
      aria-describedby={newsId}
      data-testid={`stock-tile-${stock.ticker}`}
      // `w-full` because a <button> is fit-content sized: without it the card was only as
      // wide as its content, so a tile with short headlines stopped well short of its grid
      // cell (measured: 182px of a 382px cell) while the follow control -- positioned
      // against the CELL -- sat in the gap to the right of the card, outside it. Card width
      // must not depend on how long today's headline is.
      className="flex w-full flex-col gap-0 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] text-left transition-colors hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-info)]"
    >
      <span className="flex flex-col gap-1 p-3">
        {/* `pr-6` reserves the follow button's footprint. The button is `h-7 w-7` (28px) at
            `right-1` (4px), so it spans 4-32px from the tile's right edge; content starts
            12px in (`p-3`), so 24px of padding clears it. Without this the DeltaBadge --
            right-aligned by `justify-between` -- renders underneath the button. */}
        <span className="flex items-baseline justify-between gap-2 pr-6">
          <span className="font-bold text-[var(--text-primary)]">{stock.ticker}</span>
          <DeltaBadge value={stock.delta?.delta_pct} />
        </span>
        <span className="text-lg tabular-nums text-[var(--text-primary)]">
          {formatClose(stock.last_close)}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className="block min-w-0 flex-1">
            <TileSparkline data={stock.sparkline} />
          </span>
          {/* Only when there is one to show: every tile reading "wt 0.0%" is noise, and
              the grid no longer decides membership by weight. `weight` is stored as a
              fraction -- PortfolioAllocationEditor edits it as `weight * 100` -- so
              rendering it raw published 0.25 as "wt 0.3%" rather than "wt 25.0%". */}
          {stock.weight > 0 ? (
            <span className="shrink-0 text-[length:var(--type-helper)] text-[var(--text-muted)]">
              wt {(stock.weight * 100).toFixed(1)}%
            </span>
          ) : null}
        </span>
      </span>

      <span id={newsId} className="block border-t border-[var(--border)] p-3">
        {news.length === 0 ? (
          <span className="block text-[length:var(--type-helper)] text-[var(--text-muted)]">
            {emptyNewsSummary(lastCheckedAt)}
          </span>
        ) : (
          <span className="flex flex-col gap-1.5">
            {news.slice(0, 3).map((article) => (
              <span key={article.url || article.headline} className="flex gap-2 text-[length:var(--type-helper)]">
                <span className="line-clamp-2 flex-1 text-[var(--text-primary)]">{article.headline}</span>
                <span className="shrink-0 text-[var(--text-muted)]">{relativeAge(article.published_date)}</span>
              </span>
            ))}
          </span>
        )}
      </span>
    </button>
      <button
        type="button"
        onClick={() => onToggleFollow(stock)}
        aria-pressed={followed}
        aria-label={followed ? `Unfollow ${stock.ticker}` : `Follow ${stock.ticker}`}
        title={followed ? "Followed — click to remove" : "Follow this stock"}
        data-testid={`stock-tile-follow-${stock.ticker}`}
        className={clsx(
          "absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)]",
          "text-sm font-bold leading-none transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-info)]",
          followed
            ? "bg-[var(--state-info)] text-[var(--bg-surface)]"
            : "border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]",
        )}
      >
        {followed ? "✓" : "+"}
      </button>
    </div>
  );
}
