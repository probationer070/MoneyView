"use client";

import type { CorrelationInput, CorrelationResult } from "../lib/types";
import { Download, Loader2, Play } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { ActionButton } from "@/components/ui/ActionButton";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { fieldInputClass } from "@/components/ui/InlineField";
import {
  AXIS_LINE_STYLE,
  AXIS_TICK_STYLE,
  CHART_COLORS,
  CHART_MARGIN,
  DEFAULT_TOOLTIP_PROPS,
  GRID_STYLE,
  fmtPctTick,
  withTooltipProps,
} from "@/lib/chartConfig";
import { formatNumber } from "@/lib/format";
import { useLocale } from "@/lib/i18n/locale";
import { MetricCard, WarningNotice, numberText, pct } from "./shared";
import { MonteCarloRunPanel } from "./MonteCarloRunPanel";
import { MonteCarloTabSummary } from "./MonteCarloTabSummary";
import { HeatmapPanel } from "@/components/charts/HeatmapPanel";
import { ChartGuard } from "./ChartGuard";

type Props = {
  correlationInput: CorrelationInput;
  correlationResult: CorrelationResult | null;
  correlationStatus: "idle" | "loading" | "error" | "cancelled";
  correlationProgress: number;
  warnings: string[];
  updateCorrelation: <K extends keyof CorrelationInput>(key: K, value: CorrelationInput[K]) => void;
  updateCorrelationAsset: (assetIndex: number, field: "name" | "expectedReturn" | "volatility", value: string | number) => void;
  updateCorrelationCell: (rowIndex: number, columnIndex: number, value: number) => void;
  runCorrelationSimulation: () => void;
  exportCorrelationFrontierCsv: () => void;
  exportCorrelationHeatmapCsv: () => void;
  exportCorrelationSensitivityCsv: () => void;
};

export function CorrelationModelSection({
  correlationInput,
  correlationResult,
  correlationStatus,
  correlationProgress,
  warnings,
  updateCorrelation,
  updateCorrelationAsset,
  updateCorrelationCell,
  runCorrelationSimulation,
  exportCorrelationFrontierCsv,
  exportCorrelationHeatmapCsv,
  exportCorrelationSensitivityCsv,
}: Props) {
  const { locale } = useLocale();
  const summaryStatus = correlationStatus === "loading"
    ? "in-progress"
    : correlationStatus === "error"
      ? "error"
      : correlationStatus === "cancelled"
        ? "canceled"
        : correlationResult
          ? "live"
          : "idle";
  const summaryLabel = correlationStatus === "loading"
    ? "Running correlation analysis"
    : correlationStatus === "error"
      ? "Run failed"
      : correlationStatus === "cancelled"
        ? "Run canceled"
        : correlationResult
          ? "Results ready"
          : "No analysis run yet";

  return (
    <MonteCarloRunPanel
      status={correlationStatus}
      progress={correlationProgress}
      progressLabel="Correlation worker progress"
      errorFallbackMessage="Correlation engine failed."
      cancelledMessage="Correlation simulation cancelled."
      summary={(
        <MonteCarloTabSummary
          title="Correlation Model Summary"
          description="This tab owns the multi-asset setup and run action. Correlation exports stay at this summary boundary before the frontier, heatmap, and sensitivity surfaces."
          status={summaryStatus}
          statusLabel={summaryLabel}
          items={[
            { label: "Assets", value: correlationInput.assets.length.toString() },
            { label: "Simulations", value: formatNumber(correlationInput.simulationCount, "integer", { locale }) },
            { label: "Optimal return", value: correlationResult ? pct(correlationResult.optimal_summary.optimal_return, locale) : "Pending" },
            { label: "Optimal Sharpe", value: correlationResult ? numberText(correlationResult.optimal_summary.optimal_sharpe, locale) : "Pending" },
          ]}
          actions={correlationResult ? (
            <>
              <ActionButton label="Export Frontier CSV" size="sm" onClick={exportCorrelationFrontierCsv} icon={<Download className="h-4 w-4" />} />
              <ActionButton label="Export Sensitivity CSV" size="sm" onClick={exportCorrelationSensitivityCsv} icon={<Download className="h-4 w-4" />} />
              <ActionButton label="Export Heatmap CSV" size="sm" onClick={exportCorrelationHeatmapCsv} icon={<Download className="h-4 w-4" />} />
            </>
          ) : undefined}
        />
      )}
    >
      {/* Three-column layout: inputs, analysis visuals, portfolio metrics */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(340px,0.95fr)_minmax(0,1.45fr)_minmax(260px,0.8fr)]">
        <aside className="space-y-6">
          {/* Left panel: asset assumptions, correlation matrix, and run action */}
          <section className="border border-[var(--line)] bg-[var(--surface-raised)] p-5">
            <h2 className="type-panel-title text-[var(--ink)]">Multi-Asset Setup</h2>
            <table className="mt-3 w-full table-fixed">
              <colgroup>
                <col className="w-[88px]" />
                <col />
                <col />
              </colgroup>
              <thead>
                <tr className="text-left">
                  <th scope="col" className="type-caption pb-2 pr-2 text-[var(--ink-muted)]"><BilingualLabel k="asset" /></th>
                  <th scope="col" className="type-caption pb-2 pr-2 text-[var(--ink-muted)]"><BilingualLabel k="mu" /></th>
                  <th scope="col" className="type-caption pb-2 text-[var(--ink-muted)]"><BilingualLabel k="sigma" /></th>
                </tr>
              </thead>
              <tbody>
                {correlationInput.assets.map((asset, assetIndex) => (
                  <tr key={`setup-${assetIndex}`}>
                    <td className="pb-3 pr-2 type-label text-[var(--ink)]">{asset.name}</td>
                    <td className="pb-3 pr-2">
                      <input type="number" value={asset.expectedReturn} onChange={(event) => updateCorrelationAsset(assetIndex, "expectedReturn", Number(event.target.value))} className={fieldInputClass} aria-label={`${asset.name} mu`} />
                    </td>
                    <td className="pb-3">
                      <input type="number" value={asset.volatility} onChange={(event) => updateCorrelationAsset(assetIndex, "volatility", Number(event.target.value))} className={fieldInputClass} aria-label={`${asset.name} sigma`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-6">
              <h3 className="type-label text-[var(--ink)]">Correlation Matrix rho</h3>
              <div className="mt-3 overflow-hidden border border-[var(--line)]">
                <table className="w-full table-fixed">
                  <thead>
                    <tr className="bg-[var(--surface)] text-center">
                      <th className="p-3" />
                      {correlationInput.assets.map((asset) => (
                        <th key={`matrix-head-${asset.name}`} className="p-3 type-label text-[var(--ink)]">
                          {asset.name.replace("Asset ", "")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {correlationInput.assets.map((assetY, rowIndex) => (
                      <tr key={`matrix-row-${assetY.name}`} className="border-t border-[var(--line)]">
                        <td className="p-3 text-center type-label text-[var(--ink)]">{assetY.name.replace("Asset ", "")}</td>
                        {correlationInput.assets.map((assetX, columnIndex) => {
                          const value = correlationInput.correlationMatrix[rowIndex][columnIndex];
                          if (rowIndex === columnIndex) {
                            return <td key={`matrix-cell-${assetY.name}-${assetX.name}`} className="bg-[var(--surface)] p-3 text-center type-mono text-[var(--ink)]">1.00</td>;
                          }
                          if (rowIndex < columnIndex) {
                            return (
                              <td key={`matrix-cell-${assetY.name}-${assetX.name}`} className="p-2">
                                <input
                                  type="number"
                                  min={-1}
                                  max={1}
                                  step={0.05}
                                  value={value}
                                  onChange={(event) => updateCorrelationCell(rowIndex, columnIndex, Number(event.target.value))}
                                  className={fieldInputClass}
                                />
                              </td>
                            );
                          }
                          return <td key={`matrix-cell-${assetY.name}-${assetX.name}`} className="bg-[var(--surface)] p-3 text-center type-mono text-[var(--ink)]">{formatNumber(value, "ratio", { locale })}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <div className="flex items-center justify-between type-label text-[var(--ink)]">
                <span>Number of Simulations</span>
                <span className="type-mono">{formatNumber(correlationInput.simulationCount, "integer", { locale })}</span>
              </div>
              <input type="range" min={500} max={5000} step={100} value={correlationInput.simulationCount} onChange={(event) => updateCorrelation("simulationCount", Number(event.target.value))} className="w-full accent-[var(--brand)]" />
              <button type="button" onClick={runCorrelationSimulation} disabled={correlationStatus === "loading"} className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-1)] bg-[var(--brand)] px-5 py-3 type-label text-[var(--on-brand)] disabled:opacity-60">
                {correlationStatus === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Run Correlation Analysis
              </button>
            </div>
          </section>
        </aside>

        <div className="space-y-6">
          {!correlationResult ? (
            <div className="border border-dashed border-[var(--line)] bg-[var(--surface-raised)] p-10 text-center type-body text-[var(--ink-muted)]">
              Run the portfolio correlation engine to generate efficient frontier, correlation matrix, and sensitivity diagnostics.
            </div>
          ) : (
            <>
              <WarningNotice warnings={warnings} title="Correlation-output normalization warnings" />

              {/* Middle panel: efficient frontier */}
              <ChartGuard
                title="Efficient Frontier"
                description="Scatter plot of 400 random portfolios. The highest-Sharpe portfolio is drawn apart from the sampled set."
                state={correlationResult.efficient_frontier.length > 0 ? "ready" : "invalid"}
                emptyTitle="No efficient-frontier data yet"
                emptyDescription="Run the correlation engine to generate efficient-frontier portfolios."
                invalidTitle="Efficient-frontier data is invalid"
                invalidDescription="The worker result did not contain chart-safe efficient-frontier rows, so the panel was withheld instead of rendering blank."
                chartHeight={320}
              >
                    <ScatterChart margin={CHART_MARGIN}>
                      <CartesianGrid {...GRID_STYLE} />
                      <XAxis dataKey="risk" name="Risk sigma" tickFormatter={fmtPctTick} tick={AXIS_TICK_STYLE} axisLine={AXIS_LINE_STYLE} tickLine={false} />
                      <YAxis dataKey="return" name="Return mu" tickFormatter={fmtPctTick} tick={AXIS_TICK_STYLE} axisLine={AXIS_LINE_STYLE} tickLine={false} />
                      <ZAxis dataKey="sharpe" range={[30, 180]} />
                      <Tooltip
                        {...DEFAULT_TOOLTIP_PROPS}
                        formatter={(value, name) => {
                          if (name === "risk" || name === "return") return formatNumber(Number(value) / 100, "percent", { digits: 2, locale });
                          return formatNumber(Number(value), "ratio", { digits: 4, locale });
                        }}
                        labelFormatter={() => "Portfolio"}
                      />
                      <Scatter data={correlationResult.efficient_frontier.filter((point) => !point.is_optimal)} fill={CHART_COLORS.tertiary} />
                      <Scatter data={correlationResult.efficient_frontier.filter((point) => point.is_optimal)} fill={CHART_COLORS.positive} />
                    </ScatterChart>
              </ChartGuard>

              {/* Middle panel: sensitivity analysis and full heatmap */}
              <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <ChartGuard
                  title="Spearman rho Sensitivity"
                  description="Rank correlation between each asset return and the portfolio return. Positive exposures are drawn in red and negative exposures in blue, fading with strength."
                  state={correlationResult.spearman_sensitivity.length > 0 ? "ready" : "invalid"}
                  emptyTitle="No sensitivity data yet"
                  emptyDescription="Run the correlation engine to generate Spearman sensitivity rows."
                  invalidTitle="Spearman sensitivity data is invalid"
                  invalidDescription="The worker result did not contain chart-safe sensitivity rows, so the panel was withheld instead of rendering blank."
                  chartHeight={320}
                >
                  <BarChart data={correlationResult.spearman_sensitivity} layout="vertical">
                    <CartesianGrid {...GRID_STYLE} />
                    <XAxis type="number" domain={[-1, 1]} tick={AXIS_TICK_STYLE} axisLine={AXIS_LINE_STYLE} tickLine={false} />
                    <YAxis type="category" dataKey="asset" width={70} tick={AXIS_TICK_STYLE} axisLine={AXIS_LINE_STYLE} tickLine={false} />
                    <Tooltip {...withTooltipProps()} />
                    <Bar dataKey="spearman_rho_sensitivity">
                      {correlationResult.spearman_sensitivity.map((row) => {
                        const value = Number(row.spearman_rho_sensitivity);
                        const alpha = Math.min(Math.abs(value), 1);
                        const fill = value >= 0 ? CHART_COLORS.positive : CHART_COLORS.negative;
                        return <Cell key={`spearman-${row.asset}`} fill={fill} fillOpacity={alpha} />;
                      })}
                    </Bar>
                  </BarChart>
                </ChartGuard>

                <HeatmapPanel
                  title="Correlation Coefficient Heatmap"
                  data={correlationResult.heatmap.map((d) => ({
                    x: d.asset_x,
                    y: d.asset_y,
                    value: d.correlation,
                  }))}
                  xLabels={correlationResult.assets}
                  yLabels={correlationResult.assets}
                  emptyTitle="Correlation heatmap data is invalid"
                  emptyDescription="The worker result did not contain a complete heatmap matrix, so the panel was withheld instead of rendering blank."
                />
              </section>
            </>
          )}
        </div>

        <aside className="space-y-6">
          {!correlationResult ? null : (
            /* Right panel: optimal portfolio outcome metrics */
            <section className="grid grid-cols-1 gap-4">
              <MetricCard label="Optimal Portfolio Mu" value={pct(correlationResult.optimal_summary.optimal_return, locale)} detail="Annual expected return of the highest-Sharpe portfolio" />
              <MetricCard label="Portfolio Sigma" value={pct(correlationResult.optimal_summary.optimal_volatility, locale)} detail="Actual portfolio volatility after applying correlations" />
              <MetricCard label="Diversification Effect" value={`${formatNumber(correlationResult.optimal_summary.diversification_effect, "ratio", { locale })}%pt`} detail="Reduction versus the simple average of individual asset volatilities" />
              <MetricCard label="Optimal Sharpe" value={numberText(correlationResult.optimal_summary.optimal_sharpe, locale)} detail="Highest Sharpe ratio among 400 randomly generated portfolios" />
            </section>
          )}
        </aside>
      </div>
    </MonteCarloRunPanel>
  );
}
