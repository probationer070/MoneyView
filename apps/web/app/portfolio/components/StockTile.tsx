"use client";

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
function formatClose(lastClose: number): string {
  if (!Number.isFinite(lastClose)) return "—";
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
  showWeight: boolean;
  onOpen: (stock: PortfolioStock) => void;
}

export function StockTile({ stock, news, lastCheckedAt, showWeight, onOpen }: StockTileProps) {
  // aria-label names the button, and an explicit name suppresses the descendant text, so
  // the headlines -- the thing this tile exists to show -- are not in the name. They are
  // attached as the button's DESCRIPTION instead, which assistive tech announces after the
  // name rather than in place of it.
  const newsId = `stock-tile-news-${stock.ticker}`;
  return (
    <button
      type="button"
      onClick={() => onOpen(stock)}
      aria-label={tileLabel(stock)}
      aria-describedby={newsId}
      data-testid={`stock-tile-${stock.ticker}`}
      className="flex flex-col gap-0 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] text-left transition-colors hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-info)]"
    >
      <span className="flex flex-col gap-1 p-3">
        <span className="flex items-baseline justify-between gap-2">
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
          {showWeight ? (
            <span className="shrink-0 text-[length:var(--type-helper)] text-[var(--text-muted)]">
              wt {stock.weight.toFixed(1)}%
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
  );
}
