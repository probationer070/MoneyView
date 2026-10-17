"use client";

import type { CorrelationInput, CorrelationResult } from "../lib/types";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { fieldInputClass } from "@/components/ui/InlineField";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { HeatmapPanel } from "@/components/charts/HeatmapPanel";
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
import { useLocale, useT } from "@/lib/i18n/locale";
import { runStatusView } from "../lib/resultModel";
import { ChartGuard } from "./ChartGuard";
import { ResultHeader, type ResultFigure } from "./ResultHeader";
import { RunButton } from "./RunButton";
import { RunNotice } from "./RunNotice";
import { SimulationRail } from "./SimulationRail";
import { WarningBanner } from "./WarningBanner";
import { numberText, pct } from "./shared";

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

type DetailView = "sensitivity" | "heatmap";

// Narrow cell input: the 320px rail leaves about 52px per matrix cell, so the field drops the wide label padding.
const matrixInputClass = "type-mono h-[var(--component-input-height)] w-full min-w-0 rounded-[var(--radius-1)] border border-[var(--line-strong)] bg-[var(--surface-sunken)] px-1 text-center text-[var(--ink)] focus:border-[var(--brand)]";

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
  const t = useT();
  const [view, setView] = useState<DetailView>("sensitivity");
  // Correlation has a run action and no cancel: a superseding run returns this tab to idle, never "canceled".
  const running = correlationStatus === "loading";
  const summary = correlationResult?.optimal_summary;
  const frontier = correlationResult?.efficient_frontier ?? [];
  const sensitivity = correlationResult?.spearman_sensitivity ?? [];
  const heatmap = correlationResult?.heatmap ?? [];
  const assetNames = correlationResult?.assets ?? [];

  const figures: ResultFigure[] = [
    { key: "optimalMu", label: t("monteCarlo.correlation.figures.optimalMu"), value: summary?.optimal_return ?? null, format: (n) => pct(n, locale), hint: t("monteCarlo.correlation.hints.optimalMu") },
    { key: "portfolioSigma", label: t("monteCarlo.correlation.figures.portfolioSigma"), value: summary?.optimal_volatility ?? null, format: (n) => pct(n, locale), hint: t("monteCarlo.correlation.hints.portfolioSigma") },
    { key: "diversification", label: t("monteCarlo.correlation.figures.diversification"), value: summary?.diversification_effect ?? null, format: (n) => t("monteCarlo.correlation.pctPoint", { value: formatNumber(n, "ratio", { locale }) }), hint: t("monteCarlo.correlation.hints.diversification") },
    { key: "optimalSharpe", label: t("monteCarlo.correlation.figures.optimalSharpe"), value: summary?.optimal_sharpe ?? null, format: (n) => numberText(n, locale), hint: t("monteCarlo.correlation.hints.optimalSharpe") },
  ];

  const heatmapState = !correlationResult ? "empty" : heatmap.length > 0 ? "ready" : "invalid";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
      <SimulationRail
        actions={(
          <RunButton label={t("monteCarlo.correlation.run")} onClick={runCorrelationSimulation} running={running} testId="mc-run-correlation" />
        )}
      >
        <table className="w-full table-fixed">
          <colgroup>
            <col className="w-20" />
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
                  <input type="number" value={asset.expectedReturn} onChange={(event) => updateCorrelationAsset(assetIndex, "expectedReturn", Number(event.target.value))} className={fieldInputClass} aria-label={t("monteCarlo.correlation.assetMu", { asset: asset.name })} />
                </td>
                <td className="pb-3">
                  <input type="number" value={asset.volatility} onChange={(event) => updateCorrelationAsset(assetIndex, "volatility", Number(event.target.value))} className={fieldInputClass} aria-label={t("monteCarlo.correlation.assetSigma", { asset: asset.name })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div>
          <h3 className="type-label text-[var(--ink)]">{t("monteCarlo.correlation.matrix")}</h3>
          <table data-testid="mc-correlation-matrix" className="mt-2 w-full table-fixed border border-[var(--line)] bg-[var(--surface-raised)]">
            <colgroup>
              <col className="w-6" />
            </colgroup>
            <thead>
              <tr className="bg-[var(--surface)]">
                <th scope="col" className="p-1" />
                {correlationInput.assets.map((asset) => (
                  <th key={`matrix-head-${asset.name}`} scope="col" className="p-1 text-center type-label text-[var(--ink)]">
                    {asset.name.replace("Asset ", "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {correlationInput.assets.map((assetY, rowIndex) => (
                <tr key={`matrix-row-${assetY.name}`} className="border-t border-[var(--line)]">
                  <th scope="row" className="bg-[var(--surface)] p-1 text-center type-label text-[var(--ink)]">{assetY.name.replace("Asset ", "")}</th>
                  {correlationInput.assets.map((assetX, columnIndex) => {
                    const value = correlationInput.correlationMatrix[rowIndex][columnIndex];
                    const key = `matrix-cell-${assetY.name}-${assetX.name}`;
                    if (rowIndex === columnIndex) {
                      return <td key={key} className="bg-[var(--surface)] p-1 text-center type-mono text-[var(--ink)]">1.00</td>;
                    }
                    if (rowIndex < columnIndex) {
                      return (
                        <td key={key} className="p-1">
                          <input
                            type="number"
                            min={-1}
                            max={1}
                            step={0.05}
                            value={value}
                            aria-label={t("monteCarlo.correlation.cell", { row: assetY.name, column: assetX.name })}
                            onChange={(event) => updateCorrelationCell(rowIndex, columnIndex, Number(event.target.value))}
                            className={matrixInputClass}
                          />
                        </td>
                      );
                    }
                    return <td key={key} className="bg-[var(--surface)] p-1 text-center type-mono text-[var(--ink)]">{formatNumber(value, "ratio", { locale })}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between type-label text-[var(--ink)]">
            <span>{t("monteCarlo.correlation.simulations")}</span>
            <span className="type-mono">{formatNumber(correlationInput.simulationCount, "integer", { locale })}</span>
          </div>
          <input
            type="range"
            min={500}
            max={5000}
            step={100}
            value={correlationInput.simulationCount}
            aria-label={t("monteCarlo.correlation.simulations")}
            onChange={(event) => updateCorrelation("simulationCount", Number(event.target.value))}
            className="w-full accent-[var(--brand)]"
          />
        </div>
      </SimulationRail>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-auto lg:overflow-visible">
        <ResultHeader
          status={runStatusView(correlationStatus, correlationProgress, correlationResult !== null)}
          figures={figures}
          exports={correlationResult ? [
            { key: "frontier", label: t("monteCarlo.correlation.exports.frontier"), onSelect: exportCorrelationFrontierCsv },
            { key: "sensitivity", label: t("monteCarlo.correlation.exports.sensitivity"), onSelect: exportCorrelationSensitivityCsv },
            { key: "heatmap", label: t("monteCarlo.correlation.exports.heatmap"), onSelect: exportCorrelationHeatmapCsv },
          ] : []}
        />

        {correlationStatus === "error" ? <RunNotice tone="error">{t("monteCarlo.correlation.runFailed")}</RunNotice> : null}
        <WarningBanner title={t("monteCarlo.correlation.warningsTitle")} warnings={warnings} />

        <section className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="flex min-h-0 min-w-0 flex-col lg:col-span-2">
            <ChartGuard
              title={t("monteCarlo.correlation.frontier.title")}
              description={t("monteCarlo.correlation.frontier.description")}
              state={!correlationResult ? "empty" : frontier.length > 0 ? "ready" : "invalid"}
              emptyTitle={t("monteCarlo.correlation.frontier.empty")}
              emptyDescription={t("monteCarlo.correlation.frontier.emptyHint")}
              invalidTitle={t("monteCarlo.correlation.frontier.invalid")}
              invalidDescription={t("monteCarlo.correlation.frontier.invalidHint")}
              chartHeight="fill"
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
                <Scatter data={frontier.filter((point) => !point.is_optimal)} fill={CHART_COLORS.tertiary} />
                <Scatter data={frontier.filter((point) => point.is_optimal)} fill={CHART_COLORS.positive} />
              </ScatterChart>
            </ChartGuard>
          </div>

          <div className="flex min-h-0 min-w-0 flex-col gap-3">
            <div>
              <ToggleGroup
                ariaLabel={t("monteCarlo.correlation.view.aria")}
                size="sm"
                value={view}
                onChange={(next) => setView(next === "heatmap" ? "heatmap" : "sensitivity")}
                options={[
                  { value: "sensitivity", label: t("monteCarlo.correlation.view.sensitivity") },
                  { value: "heatmap", label: t("monteCarlo.correlation.view.heatmap") },
                ]}
              />
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              {view === "sensitivity" ? (
                <ChartGuard
                  title={t("monteCarlo.correlation.sensitivity.title")}
                  description={t("monteCarlo.correlation.sensitivity.description")}
                  state={!correlationResult ? "empty" : sensitivity.length > 0 ? "ready" : "invalid"}
                  emptyTitle={t("monteCarlo.correlation.sensitivity.empty")}
                  emptyDescription={t("monteCarlo.correlation.sensitivity.emptyHint")}
                  invalidTitle={t("monteCarlo.correlation.sensitivity.invalid")}
                  invalidDescription={t("monteCarlo.correlation.sensitivity.invalidHint")}
                  chartHeight="fill"
                >
                  <BarChart data={sensitivity} layout="vertical">
                    <CartesianGrid {...GRID_STYLE} />
                    <XAxis type="number" domain={[-1, 1]} tick={AXIS_TICK_STYLE} axisLine={AXIS_LINE_STYLE} tickLine={false} />
                    <YAxis type="category" dataKey="asset" width={70} tick={AXIS_TICK_STYLE} axisLine={AXIS_LINE_STYLE} tickLine={false} />
                    <Tooltip {...withTooltipProps()} />
                    <Bar dataKey="spearman_rho_sensitivity">
                      {sensitivity.map((row) => {
                        const value = Number(row.spearman_rho_sensitivity);
                        const alpha = Math.min(Math.abs(value), 1);
                        const fill = value >= 0 ? CHART_COLORS.positive : CHART_COLORS.negative;
                        return <Cell key={`spearman-${row.asset}`} fill={fill} fillOpacity={alpha} />;
                      })}
                    </Bar>
                  </BarChart>
                </ChartGuard>
              ) : (
                <HeatmapPanel
                  title={t("monteCarlo.correlation.heatmap.title")}
                  data={heatmap.map((d) => ({
                    x: d.asset_x,
                    y: d.asset_y,
                    value: d.correlation,
                  }))}
                  xLabels={assetNames}
                  yLabels={assetNames}
                  emptyTitle={heatmapState === "invalid" ? t("monteCarlo.correlation.heatmap.invalid") : t("monteCarlo.correlation.heatmap.empty")}
                  emptyDescription={heatmapState === "invalid" ? t("monteCarlo.correlation.heatmap.invalidHint") : t("monteCarlo.correlation.heatmap.emptyHint")}
                />
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
