"use client";

import Link from "next/link";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import type { Bar, DetailProfile } from "@/lib/detail/types";

interface DetailHeaderProps {
  ticker: string;
  profile: DetailProfile | undefined;
  bars: Bar[] | undefined;
}

/** The top line: ticker, name, sector, theme, latest close with its change, and the link to Corporate Analysis. */
export function DetailHeader({ ticker, profile, bars }: DetailHeaderProps) {
  const t = useT();
  const { locale } = useLocale();
  const latest = bars && bars.length > 0 ? bars[bars.length - 1] : null;
  const previous = bars && bars.length > 1 ? bars[bars.length - 2] : null;
  const changePct = latest && previous && previous.close !== 0 ? (latest.close / previous.close - 1) * 100 : null;
  const watched = profile?.in_watchlist === true;

  return (
    <header data-testid="detail-header" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border border-[var(--line)] bg-[var(--surface-raised)] px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className="type-heading-5 text-[var(--ink)]">{ticker}</h1>
          {watched && <span className="type-body text-[var(--ink)]">{profile.name}</span>}
        </div>
        <p className="type-small mt-1 text-[var(--ink-muted)]">
          {watched ? (
            <>
              <span>{profile.sector}</span>
              {profile.theme && <span data-testid="detail-theme">{` · ${profile.theme.label[locale]}`}</span>}
            </>
          ) : profile ? (
            <span data-testid="detail-not-watchlist">{t("detail.notWatchlist")}</span>
          ) : null}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {latest && (
          <div className="flex items-center gap-3">
            <span className="type-figure-md text-[var(--ink)]">{formatNumber(latest.close, "price", { locale })}</span>
            <DeltaBadge value={changePct} />
            <span className="type-small text-[var(--ink-muted)]">{t("detail.asOf", { date: latest.date })}</span>
          </div>
        )}
        {watched && (
          <Link href={`/corporate?ticker=${encodeURIComponent(ticker)}`} className="type-small text-[var(--brand-text)] underline">
            {t("detail.openCorporate")}
          </Link>
        )}
      </div>
    </header>
  );
}
