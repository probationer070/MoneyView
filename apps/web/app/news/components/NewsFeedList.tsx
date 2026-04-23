"use client";

import { ExternalLink } from "lucide-react";

type NewsArticle = {
  id: number;
  ticker: string | null;
  headline: string;
  url: string;
  source: string;
  published_date: string;
  sentiment: string;
  importance: number;
};

type Props = {
  items: NewsArticle[];
  isFetchingNextPage: boolean;
  hasNextPage: boolean | undefined;
  onFetchNextPage: () => void;
};

function isToday(dateText: string) {
  const today = new Date().toISOString().slice(0, 10);
  return dateText?.slice(0, 10) === today;
}

export function NewsFeedList({
  items,
  isFetchingNextPage,
  hasNextPage,
  onFetchNextPage,
}: Props) {
  return (
    <div
      className="max-h-[70vh] space-y-4 overflow-y-auto pr-2"
      onScroll={(event) => {
        const target = event.currentTarget;
        if (
          target.scrollTop + target.clientHeight >= target.scrollHeight - 24 &&
          hasNextPage &&
          !isFetchingNextPage
        ) {
          onFetchNextPage();
        }
      }}
    >
      {items.map((item, index) => {
        const today = isToday(item.published_date);
        return (
          <a
            key={`${item.id}-${index}`}
            href={item.url || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className={`block rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5 transition-all hover:border-[var(--accent)] hover:shadow-sm ${
              today
                ? "border-l-4 border-l-transparent bg-[linear-gradient(90deg,rgba(96,202,173,0.08)_0,rgba(96,202,173,0.03)_20%,transparent_42%)] [border-image:linear-gradient(to_bottom,#60CAAD,#444444)_1]"
                : "border-l-4 border-l-[var(--border)]"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[15px] font-semibold leading-6 text-[var(--text-primary)]">
                    {item.headline}
                  </h3>
                  <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-muted)]">
                  <span>{item.published_date || "Unknown date"}</span>
                  {item.ticker ? (
                    <span className="rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] px-2 py-1 text-[11px] font-semibold text-[var(--text-secondary)]">
                      {item.ticker}
                    </span>
                  ) : null}
                </div>

                <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                  {item.source || "Unknown source"}
                </p>
              </div>

              {today ? (
                <span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] px-2 py-1 text-[11px] font-semibold text-[var(--text-secondary)]">
                  Today
                </span>
              ) : null}
            </div>
          </a>
        );
      })}
      {isFetchingNextPage ? (
        <p className="py-3 text-center text-sm text-[var(--text-muted)]">Loading 5 more articles...</p>
      ) : null}
    </div>
  );
}

export type { NewsArticle };
