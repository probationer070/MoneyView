"use client";

import { Sparkline } from "@/components/ui/Sparkline";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
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

interface StockTileProps {
  stock: PortfolioStock;
  news: NewsArticle[];
  lastCheckedAt: string | null;
  showWeight: boolean;
  onOpen: (stock: PortfolioStock) => void;
}

export function StockTile({ stock, news, lastCheckedAt, showWeight, onOpen }: StockTileProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(stock)}
      aria-label={tileLabel(stock)}
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
            <Sparkline data={stock.sparkline} />
          </span>
          {showWeight ? (
            <span className="shrink-0 text-[length:var(--type-helper)] text-[var(--text-muted)]">
              wt {stock.weight.toFixed(1)}%
            </span>
          ) : null}
        </span>
      </span>

      <span className="block border-t border-[var(--border)] p-3">
        {news.length === 0 ? (
          <span className="block text-[length:var(--type-helper)] text-[var(--text-muted)]">
            {lastCheckedAt
              ? `No recent news · last checked ${new Date(lastCheckedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "Never checked for news"}
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
