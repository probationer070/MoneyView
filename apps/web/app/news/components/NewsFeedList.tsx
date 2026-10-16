"use client";

import { ExternalLink } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";

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
  const t = useT();
  const { locale } = useLocale();
  return (
    <section
      className="space-y-4"
      aria-label={t("news.resultsRegion")}
    >
    <div
      className="max-h-[70vh] space-y-4 overflow-y-auto pr-2"
      aria-label={t("news.feedRegion")}
      role="feed"
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
            aria-label={t("news.openArticle", { headline: item.headline })}
            className={`block border border-[var(--line)] bg-[var(--surface-raised)] p-5 transition-colors hover:border-[var(--line-strong)] border-l-4 ${
              today ? "border-l-[var(--brand)]" : "border-l-[var(--line)]"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="type-panel-title text-[var(--ink)]">
                    {item.headline}
                  </h3>
                  <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink-muted)]" />
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 type-small text-[var(--ink-muted)]">
                  <span className="type-mono">{item.published_date || t("news.unknownDate")}</span>
                  {item.ticker ? (
                    <span className="type-caption rounded-[var(--radius-2)] bg-[var(--surface)] px-2 py-1 text-[var(--ink-secondary)]">
                      {item.ticker}
                    </span>
                  ) : null}
                </div>

                <p className="mt-2 type-caption text-[var(--ink-muted)]">
                  {item.source || t("news.unknownSource")}
                </p>
              </div>

              {today ? (
                <span className="type-caption shrink-0 rounded-[var(--radius-2)] bg-[var(--brand-soft)] px-2 py-1 text-[var(--brand-text)]">
                  {t("news.today")}
                </span>
              ) : null}
            </div>
          </a>
        );
      })}
      {isFetchingNextPage ? (
        <p className="py-3 text-center type-body text-[var(--ink-muted)]">{t("news.loadingMore", { count: formatNumber(5, "integer", { locale }) })}</p>
      ) : null}
    </div>
    {hasNextPage ? (
      <div className="flex justify-center">
        <button
          type="button"
          onClick={onFetchNextPage}
          disabled={isFetchingNextPage}
          className="type-label inline-flex min-h-9 items-center justify-center rounded-[var(--radius-1)] border border-[var(--line-strong)] bg-[var(--bg)] px-4 py-2 text-[var(--ink)] transition-colors hover:bg-[var(--surface)] disabled:opacity-60"
        >
          {isFetchingNextPage ? t("news.loading") : t("news.loadMore")}
        </button>
      </div>
    ) : null}
    </section>
  );
}

export type { NewsArticle };
