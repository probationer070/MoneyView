"use client";

import type { ReactNode } from "react";
import { FigureText } from "@/components/market/FigureText";
import { withFigures } from "@/components/market/marketModel";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { Sparkline } from "@/components/ui/Sparkline";
import { formatNumber, MISSING } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import { pctFromHigh, rsi14, sma, trendReturn, volumeMultiple, yesterday } from "@/lib/detail/metrics";
import type { Bar } from "@/lib/detail/types";

// Trading-day windows of the three trend tiles (spec 5.1): 1 week, 1 month, 6 months.
const WEEK = 5;
const MONTH = 21;
const SIX_MONTHS = 126;

const TILE = "flex min-w-0 flex-col gap-1 border border-[var(--line)] bg-[var(--surface-raised)] p-3";

function Tile({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div data-testid={id} className={TILE}>
      <h2 className="type-caption uppercase text-[var(--ink-muted)]">{title}</h2>
      {children}
    </div>
  );
}

function TrendTile({ id, title, bars, days, note }: { id: string; title: string; bars: Bar[]; days: number; note: ReactNode }) {
  const closes = bars.slice(-(days + 1)).map((bar) => bar.close);
  return (
    <Tile id={id} title={title}>
      <div className="flex items-center justify-between gap-2">
        <span data-testid="tile-return"><DeltaBadge value={trendReturn(bars, days)} /></span>
        <div className="w-16 shrink-0"><Sparkline data={closes} height={24} /></div>
      </div>
      <p data-testid="tile-note" className="type-small text-[var(--ink-muted)]">{note}</p>
    </Tile>
  );
}

function Stat({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div data-testid={id} className="flex items-baseline justify-between gap-2">
      <span className="type-small text-[var(--ink-muted)]">{label}</span>
      <span className="type-mono text-[var(--ink)]">{value}</span>
    </div>
  );
}

/** The four tiles of the detail screen: 1W, 1M and 6M trends and the last session. Every value comes from the bars. */
export function TrendTiles({ bars }: { bars: Bar[] }) {
  const t = useT();
  const { locale } = useLocale();
  const average = (days: number) => {
    const value = sma(bars, days);
    const last = bars[bars.length - 1].close;
    if (value === null) return MISSING;
    return <FigureText parts={withFigures(t(last > value ? "detail.tile.aboveAvg" : "detail.tile.belowAvg"), { days: String(days) })} />;
  };
  const fromHigh = pctFromHigh(bars, SIX_MONTHS);
  const session = yesterday(bars);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <TrendTile id="tile-1w" title={t("detail.tile.week")} bars={bars} days={WEEK} note={average(20)} />
      <TrendTile id="tile-1m" title={t("detail.tile.month")} bars={bars} days={MONTH} note={average(50)} />
      <TrendTile
        id="tile-6m" title={t("detail.tile.sixMonth")} bars={bars} days={SIX_MONTHS}
        note={fromHigh === null ? MISSING : (
          <FigureText parts={withFigures(t("detail.tile.fromHigh"), { value: formatNumber(fromHigh / 100, "percent", { signed: true, locale }) })} />
        )}
      />
      <Tile id="tile-yesterday" title={t("detail.tile.yesterday")}>
        <span data-testid="tile-return"><DeltaBadge value={session?.returnPct} /></span>
        <div data-testid="tile-range" className="flex flex-wrap items-baseline gap-x-3">
          <Stat id="tile-high" label={t("detail.tile.high")} value={formatNumber(session?.high, "price", { locale })} />
          <Stat id="tile-low" label={t("detail.tile.low")} value={formatNumber(session?.low, "price", { locale })} />
        </div>
        <Stat id="tile-volume" label={t("detail.tile.volume")} value={formatNumber(volumeMultiple(bars), "multiple", { locale })} />
        <Stat id="tile-rsi" label={t("detail.tile.rsi")} value={formatNumber(rsi14(bars), "ratio", { digits: 1, locale })} />
      </Tile>
    </div>
  );
}
