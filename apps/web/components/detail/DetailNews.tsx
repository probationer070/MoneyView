"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { useLocale, useT } from "@/lib/i18n/locale";
import { clockTime } from "@/lib/detail/clockTime";
import { useDetailNews } from "@/lib/detail/useDetail";
import type { NewsRow } from "@/lib/detail/types";

function Group({ id, title, query }: { id: string; title: string; query: UseQueryResult<NewsRow[]> }) {
  const t = useT();
  const { locale } = useLocale();
  const rows = query.data ?? [];
  // The clock time only when the article carries one; a date-only row shows its date and nothing invented.
  const when = (row: NewsRow) => (row.published_at === null ? row.published_date : clockTime(row.published_at, locale));
  return (
    <section data-testid={id} className="flex flex-col gap-1">
      <h3 className="type-panel-title text-[var(--ink)]">{title}</h3>
      {query.isError ? (
        <p className="type-small text-[var(--ink-muted)]">{t("detail.newsLoadError")}</p>
      ) : query.isPending ? (
        <p className="type-small text-[var(--ink-muted)]">{t("detail.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="type-small text-[var(--ink-muted)]">{t("detail.newsEmpty")}</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((row, index) => (
            <li key={row.id ?? `${row.url}-${index}`} data-testid="news-row" className="flex flex-col border-b border-[var(--line)] py-1">
              <a href={row.url} target="_blank" rel="noopener noreferrer" className="type-small text-[var(--ink)] underline-offset-2 hover:underline">{row.headline}</a>
              <span className="type-caption text-[var(--ink-muted)]">
                {row.source} · <span data-testid="news-when" className="type-mono">{when(row)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The news column: this stock's rows and its theme's rows, around the clicked day or the latest when none is clicked. */
export function DetailNews({ ticker, themeId, date }: { ticker: string; themeId: string | null; date: string | null }) {
  const t = useT();
  const { stock, theme } = useDetailNews(ticker, themeId, date);
  return (
    <div className="flex flex-col gap-3 p-3">
      <h2 data-testid="news-heading" className="type-panel-title text-[var(--ink)]">
        {date === null ? t("detail.newsLatest") : t("detail.newsAround", { date })}
      </h2>
      <Group id="news-group-stock" title={t("detail.newsStock")} query={stock} />
      {themeId !== null && <Group id="news-group-theme" title={t("detail.newsTheme")} query={theme} />}
    </div>
  );
}
