"use client";

import Link from "next/link";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { useLocale, useT } from "@/lib/i18n/locale";
import type { LatestMovers, MoverRow } from "@/lib/detail/types";

function MoverList({ id, title, date, rows, current }: { id: string; title: string; date: string | null; rows: MoverRow[]; current: string }) {
  const { locale } = useLocale();
  return (
    <section data-testid={id} className="flex flex-col gap-1">
      <h2 className="type-panel-title text-[var(--ink)]">
        {title}
        {date && <span data-testid="movers-date" className="type-mono text-[var(--ink-muted)]">{` · ${date}`}</span>}
      </h2>
      <ul className="flex flex-col">
        {rows.map((row) => {
          const isCurrent = row.ticker === current;
          return (
            <li key={row.ticker}>
              <Link
                href={`/detail/${encodeURIComponent(row.ticker)}`}
                aria-current={isCurrent ? "page" : undefined}
                className={`flex items-center justify-between gap-2 border-b border-[var(--line)] px-2 py-1 ${isCurrent ? "bg-[var(--brand-soft)]" : ""}`}
              >
                <span className="min-w-0">
                  <span className="type-mono block text-[var(--ink)]">{row.ticker}</span>
                  {row.theme && <span className="type-caption block truncate text-[var(--ink-muted)]">{row.theme.label[locale]}</span>}
                </span>
                <DeltaBadge value={row.return_pct} />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Yesterday's biggest gainers and decliners across the watchlist; a row opens that ticker's detail. */
export function MoversColumn({ movers, loading, failed, current }: { movers: LatestMovers | undefined; loading: boolean; failed: boolean; current: string }) {
  const t = useT();
  if (failed) return <p className="type-small text-[var(--ink-muted)]">{t("detail.movers.loadError")}</p>;
  if (loading || !movers) return <p className="type-small text-[var(--ink-muted)]">{t("detail.loading")}</p>;
  if (movers.up.length === 0 && movers.down.length === 0) return <p className="type-small text-[var(--ink-muted)]">{t("detail.movers.empty")}</p>;
  return (
    <div className="flex flex-col gap-3">
      <MoverList id="detail-movers-up" title={t("detail.movers.up")} date={movers.date} rows={movers.up} current={current} />
      <MoverList id="detail-movers-down" title={t("detail.movers.down")} date={movers.date} rows={movers.down} current={current} />
    </div>
  );
}
