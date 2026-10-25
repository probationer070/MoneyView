"use client";

import { DetailHeader } from "@/components/detail/DetailHeader";
import { MoversColumn } from "@/components/detail/MoversColumn";
import { TrendTiles } from "@/components/detail/TrendTiles";
import { useT } from "@/lib/i18n/locale";
import { useDetailBars, useDetailProfile, useLatestMovers } from "@/lib/detail/useDetail";

const PANEL = "relative min-h-0 overflow-auto border border-[var(--line)] bg-[var(--surface-raised)]";

/** The stock detail screen. It fits the viewport: the header and tiles take their height, the panels below share the rest and scroll inside. */
export function DetailView({ ticker }: { ticker: string }) {
  const t = useT();
  const bars = useDetailBars(ticker);
  const profile = useDetailProfile(ticker);
  const movers = useLatestMovers();
  const watched = profile.data?.in_watchlist === true;
  const hasBars = bars.data !== undefined && bars.data.length > 0;
  const columns = watched
    ? "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] grid-rows-[repeat(3,minmax(0,1fr))] lg:grid-rows-1"
    : "lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)] grid-rows-[repeat(2,minmax(0,1fr))] lg:grid-rows-1";

  return (
    <div className="mx-auto flex h-[calc(100dvh_-_var(--main-pad-top,0px)_-_var(--main-pad-bottom,0px))] max-w-7xl flex-col gap-3">
      <DetailHeader ticker={ticker} profile={profile.data} bars={bars.data} />
      {hasBars ? (
        <>
          <TrendTiles bars={bars.data!} />
          <div className={`grid min-h-0 flex-1 gap-3 ${columns}`}>
            {/* Region for the chart (the next task fills it). */}
            <section data-testid="detail-chart-slot" aria-label={t("detail.chartRegion")} className={PANEL} />
            {/* Region for the news column; a ticker off the watchlist has none. The next task fills it. */}
            {watched && <section data-testid="detail-news-slot" aria-label={t("detail.newsRegion")} className={PANEL} />}
            <aside className={`${PANEL} p-3`}>
              <MoversColumn movers={movers.data} loading={movers.isPending} failed={movers.isError} current={ticker} />
            </aside>
          </div>
        </>
      ) : (
        <p className="p-8 text-center type-body text-[var(--ink-muted)]">
          {bars.isPending ? t("detail.loading") : t("detail.noData", { ticker })}
        </p>
      )}
    </div>
  );
}
