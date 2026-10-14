"use client";

import type { DcfFullReport } from "../../../../../packages/shared-types";
import type { BenchmarkPreset } from "@/lib/benchmarkPresets";
import { bridgedEstimatedValue, bridgedUpsidePct, UNBRIDGED_PLACEHOLDER, UNBRIDGED_REASON } from "@/lib/bridgeQuality";
import { Bar, BarChart, CartesianGrid, Cell, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { GRID_STYLE, fmtCurrencyCompactTick, fmtPctTick, withAxisProps, withCategoryAxisProps, withTooltipProps } from "@/lib/chartConfig";
import { ActionButton } from "@/components/ui/ActionButton";
import { fieldInputClass } from "@/components/ui/InlineField";
import { MISSING } from "@/lib/format";
import { useT } from "@/lib/i18n/locale";
import { CorporateComparisonTable } from "./CorporateComparisonTable";
import type { CalculationDetailKey } from "./calculationDetailTypes";
import type { ComparisonSortKey } from "../corporateTypes";

// One skip per line in the tooltip. Declared here because a "\n" written inline in
// JSX is easy to mangle and hard to see when it breaks.
const SKIP_TOOLTIP_SEPARATOR = "\n";

type ComparisonUniverse = "watchlist_plus_benchmark" | "custom";

interface ComparisonRow {
  ticker: string;
  name: string;
  sector: string;
  group_name: string;
  weight: number;
  roic_minus_wacc: number;
  dcf_value: number | null;
  current_price: number;
  dcf_implied_return: number | null;
  capm_expected_return: number;
  market_expected_return: number;
  market_implied_return: number | null;
  implied_return_spread: number | null;
  implied_return_refusal: string | null;
  dcf_refusal: string | null;
  has_price_data: boolean;
  bridge_quality?: string;
}

interface ComparisonData {
  market_expected_return: number;
  risk_free_rate: number;
  equity_risk_premium: number;
  stock_expected_return_method: string;
  comparison_reference_return_method: string;
  snapshot: {
    comparison_universe: "portfolio_plus_benchmark" | "watchlist_plus_benchmark" | "custom";
    benchmark_ticker: string;
    custom_tickers: string[];
    generated_at: string;
  };
  rows: ComparisonRow[];
}

interface ComparisonBarRow {
  ticker: string;
  roic_minus_wacc: number;
  implied_return_spread: number | null;
  isSelected: boolean;
}

interface ComparisonScatterRow {
  ticker: string;
  current_price: number;
  dcf_value: number;
  implied_return_spread: number | null;
  bubble_size: number;
}

interface WatchlistCoverage {
  isSynchronized: boolean;
  liveWatchlistCount: number;
  registryCount: number;
  missingTickers: string[];
}

export function TargetStockComparisonSection({
  comparisonData,
  comparisonDisplayLastUpdatedAt,
  comparisonIsStale,
  comparisonUniverse,
  comparisonBenchmarkTicker,
  comparisonBenchmarkOptions,
  comparisonCustomTickersInput,
  comparisonSortKey,
  comparisonSortDirection,
  onComparisonUniverseChange,
  onComparisonBenchmarkTickerChange,
  onComparisonCustomTickersInputChange,
  onComparisonSortKeyChange,
  onComparisonSortDirectionChange,
  onRefreshComparison,
  onVerifyWatchlistSync,
  onOpenPortfolio,
  watchlistCoverage,
  watchlistSyncLoading,
  comparisonIsLoading,
  comparisonIsFetching,
  comparisonIsError,
  sortedComparisonRows,
  selectedComparisonTicker,
  selectedComparisonSector,
  similarComparisonBarData,
  similarComparisonScatterPeers,
  similarComparisonScatterSelected,
  currentTicker,
  onSelectTicker,
  onOpenCalculationForTicker,
  bulkDcfReportsLoading,
  bulkDcfReportsError,
  bulkDcfReports,
  bulkDcfReportsLastUpdatedAt,
  bulkDcfSkipped,
  onCalculateAllDcfReports,
  formatPct2,
  formatMoney,
  formatDateTime,
}: {
  comparisonData: ComparisonData | null;
  comparisonDisplayLastUpdatedAt: string | null;
  comparisonIsStale: boolean;
  comparisonUniverse: ComparisonUniverse;
  comparisonBenchmarkTicker: string;
  comparisonBenchmarkOptions: BenchmarkPreset[];
  comparisonCustomTickersInput: string;
  comparisonSortKey: ComparisonSortKey;
  comparisonSortDirection: "desc" | "asc";
  onComparisonUniverseChange: (value: ComparisonUniverse) => void;
  onComparisonBenchmarkTickerChange: (value: string) => void;
  onComparisonCustomTickersInputChange: (value: string) => void;
  onComparisonSortKeyChange: (value: ComparisonSortKey) => void;
  onComparisonSortDirectionChange: (value: "desc" | "asc") => void;
  onRefreshComparison: () => void;
  onVerifyWatchlistSync: () => void;
  onOpenPortfolio: () => void;
  watchlistCoverage: WatchlistCoverage;
  watchlistSyncLoading: boolean;
  comparisonIsLoading: boolean;
  comparisonIsFetching: boolean;
  comparisonIsError: boolean;
  sortedComparisonRows: ComparisonRow[];
  selectedComparisonTicker: string;
  selectedComparisonSector: string;
  similarComparisonBarData: ComparisonBarRow[];
  similarComparisonScatterPeers: ComparisonScatterRow[];
  similarComparisonScatterSelected: ComparisonScatterRow[];
  currentTicker: string;
  onSelectTicker: (ticker: string) => void;
  onOpenCalculationForTicker: (ticker: string, key: CalculationDetailKey) => void;
  bulkDcfReportsLoading: boolean;
  bulkDcfReportsError: string | null;
  bulkDcfReports: DcfFullReport[];
  bulkDcfReportsLastUpdatedAt: string | null;
  bulkDcfSkipped: { ticker: string; reason: string }[];
  onCalculateAllDcfReports: () => void;
  formatPct2: (value: number) => string;
  formatMoney: (value: number) => string;
  formatDateTime: (value: string) => string;
}) {
  const selectedBenchmarkLabel = comparisonBenchmarkOptions.find((preset) => preset.ticker === comparisonBenchmarkTicker)?.label ?? comparisonBenchmarkTicker;

  const t = useT();
  const universeShown = comparisonData?.snapshot.comparison_universe ?? comparisonUniverse;
  const customTickers = (comparisonData?.snapshot.custom_tickers
    ?? comparisonCustomTickersInput.split(",").map((ticker) => ticker.trim()).filter(Boolean)).join(", ");
  const syncedCount = watchlistCoverage.liveWatchlistCount - watchlistCoverage.missingTickers.length;
  const hasNonBenchmarkRows = sortedComparisonRows.some((row) => row.group_name !== "benchmark");
  // Spec §2.5: the three explanatory paragraphs and the method tiles live in this ⓘ now.
  const about = t("corporate.comparison.about", {
    riskFree: comparisonData ? formatPct2(comparisonData.risk_free_rate) : MISSING,
    erp: comparisonData ? formatPct2(comparisonData.equity_risk_premium) : MISSING,
    marketReturn: comparisonData ? formatPct2(comparisonData.market_expected_return) : MISSING,
    stockMethod: comparisonData ? comparisonData.stock_expected_return_method.replaceAll("_", " ") : MISSING,
    referenceMethod: comparisonData ? comparisonData.comparison_reference_return_method.replaceAll("_", " ") : MISSING,
    generatedAt: comparisonData ? formatDateTime(comparisonData.snapshot.generated_at) : MISSING,
  });
  const fieldLabel = "type-label flex w-40 flex-col gap-1 text-[var(--ink-muted)]";

  return (
    <div data-testid="comparison-tab" className="flex flex-col gap-3">
      <span data-testid="comparison-about" className="type-small self-start text-[var(--ink-muted)]">
        <InfoTooltip label={t("corporate.tabs.about")} description={about} />
      </span>

      {/* Spec §3.3 toolbar: universe · benchmark · sort · direction | refresh · all DCF · sync check. */}
      <div data-testid="comparison-toolbar" className="flex flex-wrap items-end gap-2">
        <label className={fieldLabel}>
          {t("corporate.comparison.universe")}
          <select
            aria-label={t("corporate.comparison.universeAria")}
            value={comparisonUniverse}
            onChange={(event) => onComparisonUniverseChange(event.target.value as ComparisonUniverse)}
            className={fieldInputClass}
          >
            <option value="watchlist_plus_benchmark">{t("corporate.comparison.universeLabel.watchlist_plus_benchmark")}</option>
            <option value="custom">{t("corporate.comparison.universeLabel.custom")}</option>
          </select>
        </label>
        <label className={fieldLabel}>
          {t("corporate.comparison.benchmarkLabel")}
          <select
            aria-label={t("corporate.comparison.benchmarkAria")}
            value={comparisonBenchmarkTicker}
            onChange={(event) => onComparisonBenchmarkTickerChange(event.target.value)}
            className={fieldInputClass}
          >
            {comparisonBenchmarkOptions.map((preset) => (
              <option key={preset.id} value={preset.ticker}>{preset.label}</option>
            ))}
          </select>
        </label>
        {comparisonUniverse === "custom" ? (
          <label className={fieldLabel}>
            {t("corporate.comparison.customLabel")}
            <input
              aria-label={t("corporate.comparison.customAria")}
              value={comparisonCustomTickersInput}
              onChange={(event) => onComparisonCustomTickersInputChange(event.target.value.toUpperCase())}
              placeholder="AAPL, MSFT, NVDA"
              className={fieldInputClass}
            />
          </label>
        ) : null}
        <label className={fieldLabel}>
          {t("corporate.comparison.sortLabel")}
          <select
            aria-label={t("corporate.comparison.sortAria")}
            value={comparisonSortKey}
            onChange={(event) => onComparisonSortKeyChange(event.target.value as ComparisonSortKey)}
            className={fieldInputClass}
          >
            <option value="implied_return_spread">{t("corporate.comparison.sortImplied")}</option>
            <option value="roic_minus_wacc">{t("corporate.comparison.sortSpread")}</option>
            <option value="dcf_value">{t("corporate.comparison.sortDcf")}</option>
          </select>
        </label>
        <label className={fieldLabel}>
          {t("corporate.comparison.directionLabel")}
          <select
            aria-label={t("corporate.comparison.directionAria")}
            value={comparisonSortDirection}
            onChange={(event) => onComparisonSortDirectionChange(event.target.value as "desc" | "asc")}
            className={fieldInputClass}
          >
            <option value="desc">{t("corporate.comparison.desc")}</option>
            <option value="asc">{t("corporate.comparison.asc")}</option>
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton size="sm" variant="secondary" label={t("corporate.comparison.refresh")} onClick={onRefreshComparison} disabled={comparisonIsFetching} />
          <ActionButton
            size="sm"
            variant="secondary"
            label={t(bulkDcfReportsLoading ? "corporate.comparison.calculatingAll" : "corporate.comparison.calculateAll")}
            onClick={onCalculateAllDcfReports}
            disabled={bulkDcfReportsLoading || !hasNonBenchmarkRows}
          />
          <ActionButton size="sm" variant="secondary" label={t("corporate.comparison.verifySync")} onClick={onVerifyWatchlistSync} disabled={watchlistSyncLoading} />
        </div>
      </div>

      {/* Spec §3.3 status line: the sync box, benchmark and timestamp in one line. */}
      <div data-testid="comparison-status" className="type-small flex flex-wrap items-center gap-x-2 gap-y-1 text-[var(--ink-muted)]">
        <span>{t(`corporate.comparison.universeLabel.${universeShown}`)}</span>
        <span aria-hidden="true">·</span>
        <span>
          {watchlistSyncLoading
            ? t("corporate.comparison.verifying")
            : watchlistCoverage.isSynchronized
              ? t("corporate.comparison.synced", { n: syncedCount, m: watchlistCoverage.liveWatchlistCount })
              : t("corporate.comparison.missing", { tickers: watchlistCoverage.missingTickers.join(", ") })}
        </span>
        <span aria-hidden="true">·</span>
        <span>{t("corporate.comparison.benchmark", { ticker: comparisonData?.snapshot.benchmark_ticker ?? comparisonBenchmarkTicker })}</span>
        <span>{t("corporate.comparison.preset", { label: selectedBenchmarkLabel, ticker: comparisonBenchmarkTicker })}</span>
        {universeShown === "custom" ? <span>{t("corporate.comparison.custom", { tickers: customTickers || t("corporate.comparison.none") })}</span> : null}
        <span aria-hidden="true">·</span>
        <span>
          {comparisonDisplayLastUpdatedAt
            ? t("corporate.assumptions.updated", { time: formatDateTime(comparisonDisplayLastUpdatedAt) })
            : t("corporate.comparison.notCalculated")}
        </span>
        {comparisonIsStale ? (
          <span className="type-caption rounded-[var(--radius-2)] bg-[var(--status-warning-surface)] px-2 py-0.5 uppercase text-[var(--status-warning-ink)]">
            {t("corporate.comparison.stale")}
          </span>
        ) : null}
        <button type="button" onClick={onOpenPortfolio} className="type-small text-[var(--brand-text)] underline decoration-dotted underline-offset-4">
          {t("corporate.comparison.openPortfolio")}
        </button>
      </div>

      {comparisonIsLoading && !comparisonData ? <LoadingState variant="spinner" label={t("corporate.comparison.loading")} /> : null}
      {comparisonIsError ? <ErrorState title={t("corporate.comparison.errorTitle")} message={t("corporate.comparison.errorBody")} /> : null}
      {!comparisonData && !comparisonIsFetching && !comparisonIsError ? (
        <EmptyState title={t("corporate.comparison.idleTitle")} description={t("corporate.comparison.idleBody")} />
      ) : null}

      {comparisonData && sortedComparisonRows.length > 0 && (
        <>
          <div data-testid="comparison-table-scroll" className="max-h-80 overflow-y-auto [contain:inline-size]">
            <CorporateComparisonTable
              rows={sortedComparisonRows}
              currentTicker={currentTicker}
              onSelectTicker={onSelectTicker}
              onOpenCalculationForTicker={onOpenCalculationForTicker}
              formatPct2={formatPct2}
              formatMoney={formatMoney}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-panel)] p-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-bold text-[var(--text-primary)]">Similar Stocks Spread View</h3>
                <p className="text-sm text-[var(--text-muted)]">
                  Compares {selectedComparisonTicker || currentTicker} with {selectedComparisonSector || "the current comparison universe"}. When there are not enough same-sector names, the chart falls back to the active comparison rows.
                </p>
              </div>
              <ResponsiveChart className="mt-4 h-[320px]" minWidth={1} minHeight={1}>
                <BarChart data={similarComparisonBarData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid {...GRID_STYLE} />
                  <XAxis dataKey="ticker" {...withCategoryAxisProps()} />
                  <YAxis {...withAxisProps({ tickFormatter: (value: number | string) => fmtPctTick(Number(value), 0), width: 52 })} />
                  <Tooltip
                    {...withTooltipProps()}
                    formatter={(value, name) => {
                      const label = name === "roic_minus_wacc" ? "ROIC - WACC" : "Implied return vs WACC (pts per year)";
                      // A refused row's spread is null; Number(null) would print a false 0.00%.
                      if (value == null) return ["none (refused)", label];
                      const numericValue = typeof value === "number" ? value : Number(value);
                      return [`${numericValue.toFixed(2)}%`, label];
                    }}
                  />
                  <Bar dataKey="roic_minus_wacc" name="roic_minus_wacc" radius={[6, 6, 0, 0]}>
                    {similarComparisonBarData.map((row) => (
                      <Cell key={`${row.ticker}-roic`} fill={row.isSelected ? "#0F766E" : "#60CAAD"} />
                    ))}
                  </Bar>
                  <Bar dataKey="implied_return_spread" name="implied_return_spread" radius={[6, 6, 0, 0]}>
                    {similarComparisonBarData.map((row) => (
                      <Cell key={`${row.ticker}-spread`} fill={row.isSelected ? "#1D4ED8" : "#94A3B8"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveChart>
              {similarComparisonBarData.some((row) => row.implied_return_spread === null) ? (
                <p data-testid="similar-spread-refused-note" className="mt-2 text-xs text-[var(--text-muted)]">
                  No implied return for {similarComparisonBarData.filter((row) => row.implied_return_spread === null).map((row) => row.ticker).join(", ")}; shown without a spread bar, and at the base bubble size in the price-vs-value map.
                </p>
              ) : null}
            </section>

            <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-panel)] p-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-bold text-[var(--text-primary)]">Price Vs Fair Value Map</h3>
                <p className="text-sm text-[var(--text-muted)]">
                  DCF fair value sits on the vertical axis and current price sits on the horizontal axis. Bubble size expands with the implied return vs WACC so outliers stand out quickly.
                </p>
              </div>
              <ResponsiveChart className="mt-4 h-[320px]" minWidth={1} minHeight={1}>
                <ScatterChart margin={{ top: 8, right: 16, bottom: 12, left: 8 }}>
                  <CartesianGrid {...GRID_STYLE} />
                  <XAxis
                    type="number"
                    dataKey="current_price"
                    name="Current price"
                    {...withAxisProps({ tickFormatter: (value: number | string) => fmtCurrencyCompactTick(Number(value)) })}
                    domain={["auto", "auto"]}
                  />
                  <YAxis
                    type="number"
                    dataKey="dcf_value"
                    name="DCF value"
                    {...withAxisProps({ tickFormatter: (value: number | string) => fmtCurrencyCompactTick(Number(value)), width: 76 })}
                    domain={["auto", "auto"]}
                  />
                  <ZAxis type="number" dataKey="bubble_size" range={[80, 260]} />
                  <Tooltip
                    {...withTooltipProps({ cursor: { strokeDasharray: "3 3" } })}
                    formatter={(value, name) => {
                      if (name === "implied_return_spread" && value == null) return ["none (refused)", "Implied return vs WACC (pts per year)"];
                      const numericValue = typeof value === "number" ? value : Number(value ?? 0);
                      if (name === "implied_return_spread") return [`${numericValue.toFixed(2)}%`, "Implied return vs WACC (pts per year)"];
                      return [formatMoney(numericValue), name === "current_price" ? "Current price" : "DCF value"];
                    }}
                  />
                  <Scatter data={similarComparisonScatterPeers} fill="#94A3B8" name="Peer set" />
                  <Scatter data={similarComparisonScatterSelected} fill="#0F766E" name="Selected ticker" />
                </ScatterChart>
              </ResponsiveChart>
            </section>
          </div>

          {(bulkDcfReportsLoading || bulkDcfReportsError || bulkDcfReports.length > 0) && (
            <section className="mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-panel)] p-4">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">Batch DCF Reports</h3>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">
                    Calculates backend full reports for every non-benchmark stock currently shown in Target Stock Comparison.
                  </p>
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  {bulkDcfReportsLastUpdatedAt ? `Last calculated ${formatDateTime(bulkDcfReportsLastUpdatedAt)}` : "No batch reports calculated yet"}
                  {bulkDcfSkipped.length > 0 ? (
                    <span className="ml-2 text-[var(--text-muted)]">
                      · {bulkDcfSkipped.length} skipped:{" "}
                      <span title={bulkDcfSkipped.map((skip) => `${skip.ticker}: ${skip.reason}`).join(SKIP_TOOLTIP_SEPARATOR)}>
                        {bulkDcfSkipped.map((skip) => skip.ticker).join(", ")}
                      </span>
                    </span>
                  ) : null}
                </div>
              </div>
              {bulkDcfReportsLoading && (
                <div className="mt-4 text-sm text-[var(--text-muted)]">Calculating full reports for the current comparison universe...</div>
              )}
              {bulkDcfReportsError && (
                <div className="mt-4 rounded-[var(--radius)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {bulkDcfReportsError}
                </div>
              )}
              {!bulkDcfReportsLoading && bulkDcfReports.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--surface-muted)] text-left text-[var(--text-muted)]">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Ticker</th>
                        <th className="px-4 py-3 font-semibold">Report ID</th>
                        <th className="px-4 py-3 text-right font-semibold">Fair Value</th>
                        <th className="px-4 py-3 text-right font-semibold">Current Price</th>
                        <th className="px-4 py-3 text-right font-semibold">Upside</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]/60">
                      {bulkDcfReports.map((report) => {
                        // Both numbers come from the helpers, not the raw fields: an
                        // unresolved bridge leaves estimated_value an enterprise value and
                        // upside_pct a hardcoded 0.0 that would read as fairly valued.
                        const fairValue = bridgedEstimatedValue(report.summary);
                        const upside = bridgedUpsidePct(report.summary);
                        return (
                        <tr key={report.summary.report_id}>
                          <td className="px-4 py-3 font-bold text-[var(--text-primary)]">
                            <button
                              type="button"
                              onClick={() => onSelectTicker(report.summary.ticker)}
                              className="rounded underline decoration-dotted underline-offset-4"
                            >
                              {report.summary.ticker}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-[var(--text-muted)]">{report.summary.report_id}</td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums" title={fairValue === null ? UNBRIDGED_REASON : undefined}>
                            {fairValue === null ? UNBRIDGED_PLACEHOLDER : formatMoney(fairValue)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatMoney(report.summary.current_price)}</td>
                          <td className={`px-4 py-3 text-right font-semibold tabular-nums ${upside === null ? "text-[var(--text-muted)]" : upside >= 0 ? "text-[var(--delta-up)]" : "text-[var(--delta-down)]"}`} title={upside === null ? UNBRIDGED_REASON : undefined}>
                            {upside === null ? UNBRIDGED_PLACEHOLDER : formatPct2(upside)}
                          </td>
                          <td className="px-4 py-3 text-[var(--text-muted)]">{report.summary.status}</td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
