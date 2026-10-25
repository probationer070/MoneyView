"use client";

import { useCallback, useState } from "react";
import { DetailHeader } from "@/components/detail/DetailHeader";
import { DetailNews } from "@/components/detail/DetailNews";
import { MoveCard } from "@/components/detail/MoveCard";
import { MoveChart } from "@/components/detail/MoveChart";
import { MoversColumn } from "@/components/detail/MoversColumn";
import { TrendTiles } from "@/components/detail/TrendTiles";
import { useT } from "@/lib/i18n/locale";
import { useDetailBars, useDetailProfile, useLatestMovers } from "@/lib/detail/useDetail";

const PANEL = "relative min-h-0 overflow-auto border border-[var(--line)] bg-[var(--surface-raised)]";

/**
 * The stock detail screen. It fits the viewport: the header and tiles take their height, the panels below share the rest.
 * A clicked day's card takes the right-hand column in place of the movers (the chart panel has no room under the chart); closing it brings them back.
 */
export function DetailView({ ticker }: { ticker: string }) {
  const t = useT();
  const bars = useDetailBars(ticker);
  const profile = useDetailProfile(ticker);
  const movers = useLatestMovers();
  // The clicked day belongs to a ticker, so a navigation to another ticker starts with none selected.
  const [selection, setSelection] = useState<{ ticker: string; date: string | null }>({ ticker, date: null });
  const selectedDate = selection.ticker === ticker ? selection.date : null;
  const select = useCallback((date: string | null) => setSelection({ ticker, date }), [ticker]);
  const closeCard = useCallback(() => select(null), [select]);
  const watched = profile.data?.in_watchlist === true;
  const hasBars = bars.data !== undefined && bars.data.length > 0;
  const columns = watched
    ? "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] grid-rows-[repeat(3,minmax(0,1fr))] lg:grid-rows-1"
    : "lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)] grid-rows-[repeat(2,minmax(0,1fr))] lg:grid-rows-1";

  return (
    <div className="mx-auto flex h-[calc(100dvh_-_var(--main-pad-top,0px)_-_var(--main-pad-bottom,0px))] max-w-7xl flex-col gap-3">
      <DetailHeader ticker={ticker} profile={profile.data} bars={bars.data} />
      {profile.isError && <p data-testid="detail-profile-error" className="type-small text-[var(--status-error-ink)]">{t("detail.profileLoadError")}</p>}
      {hasBars ? (
        <>
          <TrendTiles bars={bars.data!} />
          <div className={`grid min-h-0 flex-1 gap-3 ${columns}`}>
            <section data-testid="detail-chart-slot" aria-label={t("detail.chartRegion")} className={`${PANEL} p-3`}>
              <MoveChart bars={bars.data!} selectedDate={selectedDate} onSelect={select} />
            </section>
            {/* A ticker off the watchlist has no news column (S-D12). */}
            {watched && (
              <section data-testid="detail-news-slot" aria-label={t("detail.newsRegion")} className={PANEL}>
                <DetailNews ticker={ticker} themeId={profile.data?.theme?.id ?? null} date={selectedDate} />
              </section>
            )}
            <aside className={`${PANEL} p-3`}>
              {selectedDate !== null ? (
                <MoveCard key={selectedDate} ticker={ticker} date={selectedDate} onClose={closeCard} />
              ) : (
                <MoversColumn movers={movers.data} loading={movers.isPending} failed={movers.isError} current={ticker} />
              )}
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
