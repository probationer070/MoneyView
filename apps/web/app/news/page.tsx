"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { InfoTooltip } from "@/components/ui/InfoTooltip";

interface NewsArticle {
  id: number;
  ticker: string | null;
  headline: string;
  url: string;
  source: string;
  published_date: string;
  sentiment: string;
  importance: number;
}

function isToday(dateText: string) {
  const today = new Date().toISOString().slice(0, 10);
  return dateText?.slice(0, 10) === today;
}

export default function NewsPage() {
  const pageSize = 5;
  const newsQuery = useInfiniteQuery<NewsArticle[]>({
    queryKey: ["market-news-feed"],
    queryFn: ({ pageParam = 0 }) => fetchApi<NewsArticle[]>(`/news/feed?limit=${pageSize}&offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (
      lastPage.length === pageSize ? allPages.length * pageSize : undefined
    ),
    staleTime: 1000 * 60 * 5,
  });

  const visibleNews = newsQuery.data?.pages.flat() ?? [];

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl mx-auto">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">
          Market Intelligence
        </h1>
        <p className="text-[var(--text-muted)] mt-1">
          <InfoTooltip
            label="Aggregated regulatory news and market updates"
            description="Rows are ordered by publication date. The first 5 rows load initially, and 5 more are revealed when you scroll to the bottom."
          />
        </p>
      </header>

      {newsQuery.isLoading ? (
        <div className="p-8 text-center border border-[var(--border)] rounded-[var(--radius)]">
          <p className="text-[var(--text-muted)]">Loading news...</p>
        </div>
      ) : visibleNews.length === 0 ? (
        <div className="p-8 text-center border border-[var(--border)] rounded-[var(--radius)]">
          <p className="text-[var(--text-muted)]">No news articles found.</p>
        </div>
      ) : (
        <div
          className="max-h-[70vh] space-y-4 overflow-y-auto pr-2"
          onScroll={(event) => {
            const target = event.currentTarget;
            if (
              target.scrollTop + target.clientHeight >= target.scrollHeight - 24 &&
              newsQuery.hasNextPage &&
              !newsQuery.isFetchingNextPage
            ) {
              newsQuery.fetchNextPage();
            }
          }}
        >
          {visibleNews.map((item, index) => {
            const today = isToday(item.published_date);
            return (
              <a
                key={`${item.id}-${index}`}
                href={item.url || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className={`block bg-white border border-[var(--border)] rounded-[var(--radius)] p-5 hover:border-[var(--accent)] hover:shadow-sm transition-all ${
                  today
                    ? "border-l-4 border-l-transparent [border-image:linear-gradient(to_bottom,#60CAAD,#444444)_1]"
                    : "border-l-4 border-l-[var(--border)]"
                }`}
              >
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--text-primary)] leading-snug">
                      {item.headline}
                    </h3>
                    <p className="text-xs text-[var(--text-muted)] mt-2">
                      {item.published_date || "Unknown date"}
                    </p>
                  </div>
                  {item.ticker && (
                    <span className="px-2 py-1 text-xs font-bold bg-gray-100 rounded text-gray-600">
                      {item.ticker}
                    </span>
                  )}
                </div>
              </a>
            );
          })}
          {newsQuery.isFetchingNextPage && (
            <p className="py-3 text-center text-sm text-[var(--text-muted)]">Loading 5 more articles...</p>
          )}
        </div>
      )}
    </div>
  );
}
