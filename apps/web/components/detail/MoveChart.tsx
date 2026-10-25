"use client";

import { useCallback, useMemo, useState } from "react";
import { OHLCVChartCard } from "@/components/charts/OHLCVChartCard";
import type { ChartMarker } from "@/components/charts/TVChart";
import { ThresholdInputs } from "@/components/detail/ThresholdInputs";
import { detectBigMoves } from "@/lib/detail/bigMoves";
import { readThresholds, writeThresholds, type Thresholds } from "@/lib/detail/thresholds";
import type { Bar } from "@/lib/detail/types";
import { detailChartColours } from "@/lib/detailChartColours";
import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import { transformToTVCandles, transformToTVVolume } from "@/lib/transformers";

type Period = "6m" | "1y" | "5y";
const PERIOD_DAYS: Record<Period, number> = { "6m": 126, "1y": 252, "5y": Infinity };
const PERIODS: Period[] = ["6m", "1y", "5y"];

interface MoveChartProps {
  bars: Bar[];
  selectedDate: string | null;
  /** A mark or list entry was activated; null when the selected one is activated again. */
  onSelect: (date: string | null) => void;
}

/** The price chart with big-move marks, the period buttons and the threshold inputs, plus the list of marked days. */
export function MoveChart({ bars, selectedDate, onSelect }: MoveChartProps) {
  const t = useT();
  const { locale } = useLocale();
  const [period, setPeriod] = useState<Period>("6m");
  const [thresholds, setThresholds] = useState<Thresholds>(() => readThresholds());

  const visible = useMemo(() => bars.slice(-Math.min(PERIOD_DAYS[period], bars.length)), [bars, period]);
  const candles = useMemo(() => transformToTVCandles(visible), [visible]);
  const volume = useMemo(() => transformToTVVolume(visible), [visible]);
  const moves = useMemo(() => detectBigMoves(bars, thresholds, visible[0]?.date), [bars, thresholds, visible]);
  const markers = useMemo<ChartMarker[]>(
    () => moves.map((move) => ({ date: move.date, shape: move.strong ? "filled" : "hollow", up: move.up })),
    [moves],
  );

  const last = bars[bars.length - 1];
  const previous = bars[bars.length - 2];
  const colours = detailChartColours(last && previous ? (last.close / previous.close - 1) * 100 : 0);

  const changeThresholds = useCallback((next: Thresholds) => {
    setThresholds(next);
    writeThresholds(next);
  }, []);
  const toggle = useCallback((date: string) => onSelect(date === selectedDate ? null : date), [onSelect, selectedDate]);

  const periodOptions = PERIODS.map((value) => ({ value, label: t(`detail.period${value}` as "detail.period6m") }));

  return (
    <OHLCVChartCard
      title=""
      data={candles}
      volumeData={volume}
      height={260}
      {...colours}
      timeframe={period}
      timeframeOptions={periodOptions}
      onTimeframeChange={(value) => setPeriod(value as Period)}
      eventToggle="single"
      markers={markers}
      onMarkerClick={toggle}
      actions={<ThresholdInputs value={thresholds} onChange={changeThresholds} />}
      footer={
        <div className="flex flex-col gap-2">
          <p className="type-label text-[var(--ink)]">
            {t("detail.bigMoveCount")} <span data-testid="big-move-count" className="type-mono">{formatNumber(moves.length, "integer", { locale })}</span>
          </p>
          <ul data-testid="big-move-list" aria-label={t("detail.bigMoveList")} className="flex max-h-16 flex-wrap gap-2 overflow-auto">
            {moves.length === 0 ? <li className="type-small text-[var(--ink-muted)]">{t("detail.bigMoveNone")}</li> : null}
            {moves.map((move) => {
              const pct = formatNumber(move.returnPct / 100, "percent", { signed: true, locale });
              const kind = t(move.strong ? "detail.kindFilled" : "detail.kindHollow");
              return (
                <li key={move.date}>
                  <button
                    type="button"
                    data-date={move.date}
                    data-shape={move.strong ? "filled" : "hollow"}
                    aria-pressed={move.date === selectedDate}
                    aria-label={t("detail.bigMoveItem", { date: move.date, kind, pct })}
                    onClick={() => toggle(move.date)}
                    className={`flex items-center gap-1 rounded-[var(--radius-1)] border px-2 py-1 type-mono ${
                      move.date === selectedDate ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)] hover:bg-[var(--surface)]"
                    } ${move.up ? "text-[var(--up)]" : "text-[var(--down)]"}`}
                  >
                    <span aria-hidden>{move.strong ? "●" : "○"}</span>
                    <span aria-hidden>{move.up ? "▲" : "▼"}</span>
                    <span aria-hidden>{move.date}</span>
                    <span aria-hidden>{pct}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      }
    />
  );
}
