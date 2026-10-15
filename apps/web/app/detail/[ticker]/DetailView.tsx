"use client";

import { OHLCVChartCard } from "@/components/charts/OHLCVChartCard";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { DCFWorkbench } from "@/components/workbenches/DCFWorkbench";
import { DiagnosticWorkbench } from "@/components/workbenches/DiagnosticWorkbench";
import { detailChartColours } from "@/lib/detailChartColours";
import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import type { TVCandle, TVVolume } from "@/lib/transformers";

export interface Technicals {
  ticker: string;
  rsi_14: number | null;
  macd: number | null;
  macd_signal: number | null;
  ma_20: number | null;
  ma_50: number | null;
  as_of_date: string | null;
}

export interface DetailData {
  asOf: string;
  close: number;
  deltaPct: number;
  candles: TVCandle[];
  volume: TVVolume[];
}

const ROW = "flex justify-between border-b border-[var(--grid)] pb-2";

/** The ticker page body. The server page fetches; this client component renders in the active locale. */
export function DetailView({ ticker, data, technicals }: { ticker: string; data: DetailData | null; technicals: Technicals | null }) {
  const t = useT();
  const { locale } = useLocale();

  if (!data) {
    return <div className="p-8 text-center type-body text-[var(--ink-muted)]">{t("detail.noData", { ticker })}</div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <header className="flex items-end justify-between border border-[var(--line)] bg-[var(--surface-raised)] p-6">
        <div>
          <h1 className="type-heading-5 text-[var(--ink)]">
            {ticker}
          </h1>
          <p className="type-body mt-1 text-[var(--ink-muted)]">
            {t("detail.asOf", { date: data.asOf })}
          </p>
        </div>
        <div className="text-right">
          <div className="type-figure-md tabular-nums text-[var(--ink)]">
            {formatNumber(data.close, "price", { digits: 1, locale })}
          </div>
          <DeltaBadge value={data.deltaPct} className="mt-2 px-3 py-1 type-label" />
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ErrorBoundary fallbackTitle={t("detail.chartErrorTitle")} fallbackMessage={t("detail.chartErrorBody")}>
          <div className="lg:col-span-2">
            <OHLCVChartCard
              title={t("detail.chartTitle")}
              description={t("detail.chartDescription")}
              data={data.candles}
              volumeData={data.volume}
              height={400}
              tickerName={ticker}
              {...detailChartColours(data.deltaPct)}
              emptyDescription={t("detail.chartEmpty", { ticker })}
            />
          </div>
        </ErrorBoundary>

        {/* Technical Indicators */}
        <div className="border border-[var(--line)] bg-[var(--surface-raised)] p-6">
          <h2 className="type-panel-title mb-4 text-[var(--ink)]">{t("detail.technicals")}</h2>
          {technicals ? (
            <div className="space-y-4 type-body">
              <div className={ROW}>
                <span className="text-[var(--ink-muted)]">{t("detail.rsi")}</span>
                <span className="type-mono text-[var(--ink)]">{formatNumber(technicals.rsi_14, "ratio", { locale })}</span>
              </div>
              <div className={ROW}>
                <span className="text-[var(--ink-muted)]">{t("detail.macd")}</span>
                <span className="type-mono text-[var(--ink)]">{formatNumber(technicals.macd, "price", { locale })}</span>
              </div>
              <div className={ROW}>
                <span className="text-[var(--ink-muted)]">{t("detail.signal")}</span>
                <span className="type-mono text-[var(--ink)]">{formatNumber(technicals.macd_signal, "price", { locale })}</span>
              </div>
              <div className={ROW}>
                <span className="text-[var(--ink-muted)]">{t("detail.ma20")}</span>
                <span className="type-mono text-[var(--ink)]">{formatNumber(technicals.ma_20, "price", { locale })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--ink-muted)]">{t("detail.ma50")}</span>
                <span className="type-mono text-[var(--ink)]">{formatNumber(technicals.ma_50, "price", { locale })}</span>
              </div>
            </div>
          ) : (
            <div className="type-body text-[var(--ink-muted)]">{t("detail.technicalsLoading")}</div>
          )}
        </div>
      </div>

      {/* Interactive DCF React Query Laboratory */}
      <ErrorBoundary fallbackTitle={t("detail.dcfErrorTitle")} fallbackMessage={t("detail.dcfErrorBody")}>
        <DCFWorkbench ticker={ticker} />
      </ErrorBoundary>

      {/* Advanced Visual Recharts Metrics */}
      <ErrorBoundary fallbackTitle={t("detail.diagnosticsErrorTitle")} fallbackMessage={t("detail.diagnosticsErrorBody")}>
        <DiagnosticWorkbench ticker={ticker} />
      </ErrorBoundary>
    </div>
  );
}
