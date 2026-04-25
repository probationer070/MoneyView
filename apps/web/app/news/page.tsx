"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { NewsFeedList, type NewsArticle } from "./components/NewsFeedList";

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
      <PageHeader
        title="Market Intelligence"
        subtitle="Aggregated regulatory news and market updates"
      />

      {newsQuery.isLoading ? (
        <LoadingState variant="skeleton" />
      ) : newsQuery.isError ? (
        <ErrorState
          title="News Feed Unavailable"
          message={newsQuery.error instanceof Error ? newsQuery.error.message : "Could not load market news from the backend feed."}
        />
      ) : visibleNews.length === 0 ? (
        <EmptyState title="No news articles found" description="Check back later or ensure the backend feed is running." />
      ) : (
        <NewsFeedList
          items={visibleNews}
          hasNextPage={newsQuery.hasNextPage}
          isFetchingNextPage={newsQuery.isFetchingNextPage}
          onFetchNextPage={() => {
            void newsQuery.fetchNextPage();
          }}
        />
      )}
    </div>
  );
}
