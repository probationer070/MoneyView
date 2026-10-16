"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { useDevMonitorPageLoad } from "@/hooks/useDevMonitorPageLoad";
import { PageHeader } from "@/components/ui/PageHeader";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useT } from "@/lib/i18n/locale";
import { NewsFeedList, type NewsArticle } from "./components/NewsFeedList";

export default function NewsPage() {
  useDevMonitorPageLoad({ component: "news" });
  const t = useT();
  const pageSize = 5;
  const newsQuery = useInfiniteQuery<NewsArticle[]>({
    queryKey: ["market-news-feed"],
    queryFn: ({ pageParam = 0 }) => fetchApi<NewsArticle[]>(`/news/feed?limit=${pageSize}&offset=${pageParam}`, {
      monitor: {
        operation: "frontend.query.news_feed",
        component: "news_page",
      },
    }),
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
        title={t("news.title")}
        subtitle={t("news.subtitle")}
      />

      {newsQuery.isLoading ? (
        <LoadingState variant="skeleton" />
      ) : newsQuery.isError ? (
        <ErrorState
          title={t("news.unavailableTitle")}
          message={newsQuery.error instanceof Error ? newsQuery.error.message : t("news.unavailableFallback")}
        />
      ) : visibleNews.length === 0 ? (
        <EmptyState title={t("news.emptyTitle")} description={t("news.emptyDescription")} />
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
